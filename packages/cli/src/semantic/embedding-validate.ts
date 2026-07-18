import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.embedding.commands.validate,
  Effect.fn("cli.semantic.embedding.validate")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.embedding.validate",
      payload: { id: input.id },
    })
    Output.emit(result, input.json, SemanticRender.renderBindingMutation)
  }),
)
