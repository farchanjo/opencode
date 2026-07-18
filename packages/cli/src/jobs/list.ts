import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { JobsRender } from "./render"

export default Runtime.handler(
  Commands.commands.jobs.commands.list,
  Effect.fn("cli.jobs.list")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "jobs.list",
      scope,
      payload: {
        enabledOnly: input.enabledOnly,
        limit: Option.getOrUndefined(input.limit) ?? 50,
        cursor: Option.getOrUndefined(input.cursor),
      },
    })
    Output.emit(result, input.json, JobsRender.renderList)
  }),
)
