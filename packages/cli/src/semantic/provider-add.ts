import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.provider.commands.add,
  Effect.fn("cli.semantic.provider.add")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const secretRef = Option.getOrUndefined(input.secretRef)
    const residency = Option.getOrUndefined(input.residency)
    const result = yield* Dispatch.dispatch({
      id: "semantic.provider.add",
      scope,
      payload: {
        name: input.name,
        baseUrl: input.baseUrl,
        allowInsecureLocalProfile: input.allowInsecureLocalProfile,
        ...(secretRef === undefined ? {} : { secretRef }),
        ...(residency === undefined ? {} : { residency }),
      },
    })
    Output.emit(result, input.json, SemanticRender.renderProvider)
  }),
)
