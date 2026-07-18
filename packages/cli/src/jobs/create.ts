import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands.create,
  Effect.fn("cli.jobs.create")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "jobs.create",
      scope,
      payload: {
        name: input.name,
        description: Option.getOrUndefined(input.description) ?? "",
        cronExpression: input.cron,
        ianaTimezone: input.timezone,
        actionType: input.actionType,
        overlapPolicy: input.overlapPolicy,
        misfirePolicy: input.misfirePolicy,
        payloadRef: input.payloadRef,
      },
    })
    Output.emit(result, input.json, JobsRender.renderMutation)
  }),
)
