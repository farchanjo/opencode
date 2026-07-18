import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.provider.commands["rotate-secret"],
  Effect.fn("cli.semantic.provider.rotate-secret")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.provider.rotate-secret",
      payload: { id: input.id, expectedVersion: input.expectedVersion, newSecretRef: input.newSecretRef, confirmed: input.confirm },
    })
    Output.emit(result, input.json, SemanticRender.renderProvider)
  }),
)
