import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { LangLockRender } from "./render"

export default Runtime.handler(
  Commands.commands.langlock.commands.show,
  Effect.fn("cli.langlock.show")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({ id: "langlock.show", scope, payload: { scope: scope.kind } })
    Output.emit(result, input.json, LangLockRender.renderPolicy)
  }),
)
