import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TelemetryRender } from "./render"

export default Runtime.handler(
  Commands.commands.telemetry.commands.configure,
  Effect.fn("cli.telemetry.configure")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({ id: "telemetry.configure", scope, payload: { scope: scope.kind } })
    Output.emit(result, input.json, TelemetryRender.renderConfigure)
  }),
)
