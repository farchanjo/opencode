import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands["run-now"],
  Effect.fn("cli.jobs.run-now")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "jobs.run-now",
      payload: { jobDefinitionId: input.jobDefinitionId },
    })
    Output.emit(result, input.json, JobsRender.renderRunNow)
  }),
)
