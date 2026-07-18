import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands.reschedule,
  Effect.fn("cli.jobs.reschedule")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "jobs.reschedule",
      payload: {
        jobDefinitionId: input.jobDefinitionId,
        expectedVersion: input.expectedVersion,
        cronExpression: input.cron,
        ianaTimezone: input.timezone,
      },
    })
    Output.emit(result, input.json, JobsRender.renderMutation)
  }),
)
