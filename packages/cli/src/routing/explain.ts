import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { RoutingRender } from "./render"

export default Runtime.handler(
  Commands.commands.routing.commands.explain,
  Effect.fn("cli.routing.explain")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "routing.explain", payload: { decisionId: input.decisionId } })
    Output.emit(result, input.json, RoutingRender.renderExplain)
  }),
)
