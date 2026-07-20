export * as GrepTool from "./grep"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { Config } from "../config"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { contentRequest, runNativeGrep } from "./native/grep.native"
import { sharedLoader } from "./native/loader"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "grep"

export const Input = Schema.Struct({
  pattern: FileSystem.GrepInput.fields.pattern.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: FileSystem.GrepInput.fields.limit.annotate({
    description: "Maximum matches to return",
  }),
})

export const Output = Schema.Array(FileSystem.Match)
type ModelOutput = typeof Output.Encoded

/** Format raw search matches into the familiar concise model output. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : [`Found ${output.length} matches`]
  let current = ""
  for (const match of output) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  return lines.join("\n")
}

/** Grep leaf that defaults its filesystem root to the active Location. */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service
    const config = yield* Config.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search file contents by regular expression within the active Location or an absolute managed tool-output file. Use a path to narrow the search, include to filter files by glob, and limit to bound the match count. Returns concise file resources, line numbers, and bounded line previews.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((match) => ({
                  ...match,
                  entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) },
                })),
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
                  root: ".",
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const target = path.resolve(location.directory, input.path ?? ".")
              const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
              const cwd = info?.type === "Directory" ? target : path.dirname(target)
              const relocate = (matches: readonly FileSystem.Match[]) =>
                matches.map((match) =>
                  FileSystem.Match.make({
                    ...match,
                    entry: FileSystem.Entry.make({
                      ...match.entry,
                      path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, match.entry.path))),
                    }),
                  }),
                )
              // Native backend selection before the Ripgrep.Service call (FR6, C5;
              // Feature 023 FR-A): the embedded engine serves a directory search by
              // DEFAULT — only an explicit `native_tools: false` opts out (`!== false`).
              // Any gap or FFI error still falls back through the external-`rg` seam.
              const entries = yield* config.entries()
              const nativeTools = Config.latest(entries, "experimental")?.native_tools !== false
              if (nativeTools && info?.type === "Directory") {
                const outcome = runNativeGrep(
                  sharedLoader(),
                  true,
                  contentRequest({ cwd, pattern: input.pattern, include: input.include }),
                )
                if (outcome.kind === "ok")
                  return relocate(outcome.matches.slice(0, input.limit ?? Number.MAX_SAFE_INTEGER))
              }
              return yield* ripgrep
                .grep({
                  cwd,
                  pattern: input.pattern,
                  file: info?.type === "File" ? path.basename(target) : undefined,
                  include: input.include,
                  limit: input.limit ?? Number.MAX_SAFE_INTEGER,
                })
                .pipe(Effect.map(relocate))
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to grep for ${input.pattern}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/grep",
  layer,
  deps: [ToolRegistry.node, FSUtil.node, Ripgrep.node, Location.node, PermissionV2.node, Config.node],
})
