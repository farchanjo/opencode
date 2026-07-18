import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands.update,
  Effect.fn("cli.jobs.update")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const name = Option.getOrUndefined(input.name)
    const description = Option.getOrUndefined(input.description)
    const cron = Option.getOrUndefined(input.cron)
    const timezone = Option.getOrUndefined(input.timezone)
    const actionType = Option.getOrUndefined(input.actionType)
    const overlapPolicy = Option.getOrUndefined(input.overlapPolicy)
    const misfirePolicy = Option.getOrUndefined(input.misfirePolicy)
    const payloadRef = Option.getOrUndefined(input.payloadRef)
    const result = yield* Dispatch.dispatch({
      id: "jobs.update",
      scope,
      payload: {
        jobDefinitionId: input.jobDefinitionId,
        expectedVersion: input.expectedVersion,
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
        ...(cron === undefined ? {} : { cronExpression: cron }),
        ...(timezone === undefined ? {} : { ianaTimezone: timezone }),
        ...(actionType === undefined ? {} : { actionType }),
        ...(overlapPolicy === undefined ? {} : { overlapPolicy }),
        ...(misfirePolicy === undefined ? {} : { misfirePolicy }),
        ...(payloadRef === undefined ? {} : { payloadRef }),
      },
    })
    Output.emit(result, input.json, JobsRender.renderMutation)
  }),
)
