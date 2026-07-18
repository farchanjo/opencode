import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.embedding.commands.show,
  Effect.fn("cli.semantic.embedding.show")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "semantic.embedding.show",
      scope,
      payload: {},
    })
    Output.emit(result, input.json, SemanticRender.renderBindingShow)
  }),
)
