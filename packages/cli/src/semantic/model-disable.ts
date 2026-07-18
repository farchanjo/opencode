import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.model.commands.disable,
  Effect.fn("cli.semantic.model.disable")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.model.disable",
      payload: { id: input.id, expectedVersion: input.expectedVersion },
    })
    Output.emit(result, input.json, SemanticRender.renderModel)
  }),
)
