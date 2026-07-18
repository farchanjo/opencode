import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.reranker.commands.rollback,
  Effect.fn("cli.semantic.reranker.rollback")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.reranker.rollback",
      payload: { targetBindingVersion: input.targetBindingVersion, casToken: input.casToken, confirmed: input.confirm },
    })
    Output.emit(result, input.json, SemanticRender.renderBindingMutation)
  }),
)
