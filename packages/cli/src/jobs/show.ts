import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands.show,
  Effect.fn("cli.jobs.show")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "jobs.show",
      payload: {
        jobDefinitionId: input.jobDefinitionId,
        occurrenceLimit: Option.getOrUndefined(input.occurrenceLimit) ?? 20,
      },
    })
    Output.emit(result, input.json, JobsRender.renderShow)
  }),
)
