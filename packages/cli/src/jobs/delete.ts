import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands.delete,
  Effect.fn("cli.jobs.delete")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "jobs.delete",
      payload: { jobDefinitionId: input.jobDefinitionId, expectedVersion: input.expectedVersion },
    })
    Output.emit(result, input.json, JobsRender.renderDelete)
  }),
)
