import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.provider.commands.update,
  Effect.fn("cli.semantic.provider.update")(function* (input) {
    const name = Option.getOrUndefined(input.name)
    const baseUrl = Option.getOrUndefined(input.baseUrl)
    const result = yield* Dispatch.dispatch({
      id: "semantic.provider.update",
      payload: {
        id: input.id,
        expectedVersion: input.expectedVersion,
        patch: {
          ...(name === undefined ? {} : { name }),
          ...(baseUrl === undefined ? {} : { baseUrl }),
        },
      },
    })
    Output.emit(result, input.json, SemanticRender.renderProvider)
  }),
)
