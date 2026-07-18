import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.model.commands.validate,
  Effect.fn("cli.semantic.model.validate")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.model.validate",
      payload: { id: input.id },
    })
    Output.emit(result, input.json, SemanticRender.renderModel)
  }),
)
