import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.reranker.commands.select,
  Effect.fn("cli.semantic.reranker.select")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.reranker.select",
      payload: { modelDescriptorId: input.modelDescriptorId, compatibilityMode: input.compatibilityMode },
    })
    Output.emit(result, input.json, SemanticRender.renderBindingMutation)
  }),
)
