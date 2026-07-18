import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.index.commands.reindex,
  Effect.fn("cli.semantic.index.reindex")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.index.reindex",
      payload: { collection: input.collection },
    })
    Output.emit(result, input.json, SemanticRender.renderIndexJob)
  }),
)
