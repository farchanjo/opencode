import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { RoutingRender } from "./render"

export default Runtime.handler(
  Commands.commands.routing.commands.test,
  Effect.fn("cli.routing.test")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "routing.test",
      scope,
      payload: { taskDescription: input.task, scope: scope.kind },
    })
    Output.emit(result, input.json, RoutingRender.renderTest)
  }),
)
