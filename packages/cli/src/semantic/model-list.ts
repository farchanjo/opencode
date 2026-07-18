import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.model.commands.list,
  Effect.fn("cli.semantic.model.list")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const providerProfileId = Option.getOrUndefined(input.providerProfileId)
    const result = yield* Dispatch.dispatch({
      id: "semantic.model.list",
      scope,
      payload: {
        ...(providerProfileId === undefined ? {} : { providerProfileId }),
      },
    })
    Output.emit(result, input.json, SemanticRender.renderModelList)
  }),
)
