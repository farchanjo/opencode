export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { PermissionV2 } from "../permission"
import { globRequest, runNativeGlob } from "./native/glob.native"
import { sharedLoader } from "./native/loader"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: "Maximum results to return",
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type ModelOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : output.map((item) => item.path)
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service
    const config = yield* Config.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Find files by glob pattern within the active Location. Returns concise relative file resources. Use a relative path to narrow the search and limit to bound the result count.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
              ),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: input.path ?? ".",
                  path: input.path,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const cwd = path.resolve(location.directory, input.path ?? ".")
              const relocate = (entries: readonly FileSystem.Entry[]) =>
                entries.map((entry) =>
                  FileSystem.Entry.make({
                    ...entry,
                    path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                  }),
                )
              // Native backend selection before the Ripgrep.Service call (FR5, C5;
              // Feature 023 FR-A): the embedded ignore+globset engine serves the search
              // by DEFAULT — only an explicit `native_tools: false` opts out (`!== false`).
              // Any gap or FFI error still falls back through the external-`rg` seam.
              const entries = yield* config.entries()
              const nativeTools = Config.latest(entries, "experimental")?.native_tools !== false
              if (nativeTools) {
                const outcome = runNativeGlob(
                  sharedLoader(),
                  true,
                  globRequest({ cwd, pattern: input.pattern, limit: input.limit }),
                )
                if (outcome.kind === "ok") return relocate(outcome.entries)
              }
              return yield* ripgrep
                .glob({
                  cwd,
                  pattern: input.pattern,
                  limit: input.limit ?? Number.MAX_SAFE_INTEGER,
                })
                .pipe(Effect.map(relocate))
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/glob",
  layer,
  deps: [ToolRegistry.node, Ripgrep.node, Location.node, PermissionV2.node, Config.node],
})
