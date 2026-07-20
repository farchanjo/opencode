import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { BashTool } from "@opencode-ai/core/tool/bash"
import { NativeLoader } from "@opencode-ai/core/tool/native/loader"
import { loadNativePty } from "@opencode-ai/core/tool/native/pty.native"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "../../fixture/location"
import { tmpdir } from "../../fixture/tmpdir"
import { testEffect } from "../../lib/effect"
import { toolIdentity, executeTool, settleTool } from "../../lib/tool"

/**
 * Feature 010 — bash `pty: true` integration (T015, T016, S13).
 *
 * Asserts the permission gate runs FIRST (no PTY or ChildProcess spawn on denial —
 * AC15), the default path is byte-for-byte unchanged when `pty` is unset or the flag is
 * off (AC16), and — against the real dylib — a `pty: true` run is served by a native
 * terminal after the permission check. The permission gate never moves into native code.
 */

const sessionID = SessionV2.ID.make("ses_pty_bash_test")
const assertions: PermissionV2.AssertInput[] = []
const runs: Array<{ readonly command: string }> = []
let denyAction: string | undefined
// Feature 023 FR-A: tri-state so the tests distinguish an ABSENT flag (now default ON)
// from an EXPLICIT `native_pty: false` (the opt-out) from an explicit `true`.
let nativePtySetting: boolean | undefined = undefined

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const appProcess = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({
    run: (command: ChildProcess.Command) =>
      Effect.suspend(() => {
        if (command._tag !== "StandardCommand") throw new Error("expected standard command")
        runs.push({ command: command.command })
        return Effect.succeed({
          command: "mock",
          exitCode: 0,
          output: Buffer.from("hello\n"),
          stdout: Buffer.from("hello\n"),
          stderr: Buffer.alloc(0),
          outputTruncated: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        })
      }),
  } as unknown as AppProcess.Interface),
)

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed(
        nativePtySetting === undefined
          ? []
          : [{ type: "document", info: { experimental: { native_pty: nativePtySetting } } } as never],
      ),
  }),
)

const reset = () => {
  assertions.length = 0
  runs.length = 0
  denyAction = undefined
  nativePtySetting = undefined
}

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, BashTool.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [AppProcess.node, appProcess],
          [Config.node, config],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const call = (input: typeof BashTool.Input.Type, id = "call-pty") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "bash", input },
})

const nativeReady = loadNativePty(new NativeLoader(), true).kind === "ok"
const it = testEffect(Layer.empty)

describe("bash pty:true — default path unchanged (T016, AC16)", () => {
  it.live("pty unset uses the ChildProcess path exactly as before", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "pwd" }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(runs).toHaveLength(1)
              expect(settled.output?.structured).toMatchObject({ exit: 0 })
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("pty:true with an explicit native_pty:false falls through to ChildProcess (opt-out, FR-A)", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        nativePtySetting = false
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "pwd", pty: true }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              // The native PTY was disabled explicitly: the ChildProcess path served the call.
              expect(runs).toHaveLength(1)
              expect(settled.output?.structured).toMatchObject({ exit: 0 })
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

describe("bash pty:true — permission gate first (T016, AC15)", () => {
  it.live("a bash denial spawns nothing — no PTY, no ChildProcess", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          reset()
          nativePtySetting = true
          denyAction = "bash"
          yield* withTool(tmp.path, (registry) => executeTool(registry, call({ command: "pwd", pty: true })))
          // permission.assert("bash") ran, and because it denied, nothing spawned:
          // the permission-first invariant (FR13, AC15) — native code never runs first.
          expect(assertions.map((item) => item.action)).toEqual(["bash"])
          expect(runs).toEqual([])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

if (process.platform !== "win32" && nativeReady) {
  describe("bash pty:true — served by a real terminal after permission (T016, AC8, AC15)", () => {
    it.live("a granted pty:true run streams native terminal output", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          nativePtySetting = true
          return withTool(tmp.path, (registry) =>
            settleTool(registry, call({ command: "printf pty-ok", pty: true })),
          ).pipe(
            Effect.andThen((settled) =>
              Effect.sync(() => {
                // Permission was evaluated before the native spawn.
                expect(assertions.map((item) => item.action)).toEqual(["bash"])
                // Served natively (no ChildProcess run recorded) and captured the output.
                expect(runs).toEqual([])
                const text = settled.output?.content?.[0]
                expect(text).toMatchObject({ type: "text", text: expect.stringContaining("pty-ok") })
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )

    it.live("Feature 023 FR-A: pty:true with the flag ABSENT selects native by default", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          // No experimental block at all — the default is now ON, so native serves it.
          nativePtySetting = undefined
          return withTool(tmp.path, (registry) =>
            settleTool(registry, call({ command: "printf pty-default-ok", pty: true })),
          ).pipe(
            Effect.andThen((settled) =>
              Effect.sync(() => {
                expect(assertions.map((item) => item.action)).toEqual(["bash"])
                // Served natively by default — no ChildProcess run recorded.
                expect(runs).toEqual([])
                const text = settled.output?.content?.[0]
                expect(text).toMatchObject({ type: "text", text: expect.stringContaining("pty-default-ok") })
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  })
}
