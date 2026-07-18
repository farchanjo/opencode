import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.binding.commands.history,
  Effect.fn("cli.semantic.binding.history")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "semantic.binding.history",
      scope,
      payload: { slot: input.slot, limit: input.limit },
    })
    Output.emit(result, input.json, SemanticRender.renderBindingHistory)
  }),
)
