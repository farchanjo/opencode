import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.retention.commands.set,
  Effect.fn("cli.output.retention.set")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "output.retention.set",
      scope,
      payload: { ttlSeconds: input.ttlSeconds, legalHold: input.legalHold, expectedVersion: input.expectedVersion },
    })
    Output.emit(result, input.json, OutputRender.renderRetention)
  }),
)
