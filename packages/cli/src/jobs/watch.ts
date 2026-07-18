import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

/**
 * `jobs.watch` is a request/response snapshot today: the operator command
 * port (`jobs-command-port.ts`) returns the bounded current Job Definition
 * frame plus a `streaming: "observation-surface"` marker rather than a live
 * subscription — the CLI operator transport (`../operator/dispatch.ts`) is
 * request/response only, matching the honest degrade posture documented in
 * `../process/poll.ts`. The live `job.*` stream over the Feature 002
 * observation seam attaches on the TUI jobs panel (T030); this handler never
 * fakes a push transport it does not have.
 */
export default Runtime.handler(
  Commands.commands.jobs.commands.watch,
  Effect.fn("cli.jobs.watch")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "jobs.watch",
      payload: { jobDefinitionId: input.jobDefinitionId },
    })
    Output.emit(result, input.json, JobsRender.renderWatch)
  }),
)
