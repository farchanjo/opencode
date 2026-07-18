import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.model.commands.register,
  Effect.fn("cli.semantic.model.register")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "semantic.model.register",
      payload: {
        providerProfileId: input.providerProfileId,
        modelRef: input.modelRef,
        displayName: input.displayName,
        endpointMode: input.endpointMode,
        declaredCapabilityKinds: input.capability,
      },
    })
    Output.emit(result, input.json, SemanticRender.renderModel)
  }),
)
