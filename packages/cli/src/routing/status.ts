import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { RoutingRender } from "./render"

export default Runtime.handler(
  Commands.commands.routing.commands.status,
  Effect.fn("cli.routing.status")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "routing.status" })
    Output.emit(result, input.json, RoutingRender.renderStatus)
  }),
)
