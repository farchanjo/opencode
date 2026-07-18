import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.embedding.commands.cutover,
  Effect.fn("cli.semantic.embedding.cutover")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.embedding.cutover",
      payload: { id: input.id, generationId: input.generationId, casToken: input.casToken, confirmed: input.confirm },
    })
    Output.emit(result, input.json, SemanticRender.renderBindingMutation)
  }),
)
