import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TelemetryRender } from "./render"

export default Runtime.handler(
  Commands.commands.telemetry.commands.off,
  Effect.fn("cli.telemetry.off")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({ id: "telemetry.off", scope, payload: { scope: scope.kind } })
    Output.emit(result, input.json, TelemetryRender.renderStatus)
  }),
)
