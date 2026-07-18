import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SmartRender } from "./render"

export default Runtime.handler(
  Commands.commands.smart.commands.auto,
  Effect.fn("cli.smart.auto")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({ id: "smart.auto", scope, payload: { scope: scope.kind } })
    Output.emit(result, input.json, SmartRender.renderStatus)
  }),
)
