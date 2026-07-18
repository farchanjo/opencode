import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { LangLockRender } from "./render"

export default Runtime.handler(
  Commands.commands.langlock.commands.reset,
  Effect.fn("cli.langlock.reset")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "langlock.reset",
      scope,
      payload: { scope: scope.kind, expectedVersion: input.expectedVersion },
    })
    Output.emit(result, input.json, LangLockRender.renderMutation)
  }),
)
