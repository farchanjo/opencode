import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../../commands/commands"
import { Runtime } from "../../framework/runtime"
import { Dispatch } from "../../operator/dispatch"
import { Output } from "../../operator/output"
import { RoutingRender } from "../render"

export default Runtime.handler(
  Commands.commands.routing.commands.capability.commands.inspect,
  Effect.fn("cli.routing.capability.inspect")(function* (input) {
    const modelId = Option.getOrUndefined(input.modelId)
    const result = yield* Dispatch.dispatch({
      id: "routing.capability.inspect",
      payload: modelId === undefined ? {} : { modelId },
    })
    Output.emit(result, input.json, RoutingRender.renderCapabilityInspect)
  }),
)
