import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.index.commands.status,
  Effect.fn("cli.semantic.index.status")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "semantic.index.status",
      scope,
      payload: { collection: input.collection },
    })
    Output.emit(result, input.json, SemanticRender.renderIndexStatus)
  }),
)
