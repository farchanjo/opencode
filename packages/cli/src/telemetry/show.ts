import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TelemetryRender } from "./render"

export default Runtime.handler(
  Commands.commands.telemetry.commands.show,
  Effect.fn("cli.telemetry.show")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "telemetry.show" })
    Output.emit(result, input.json, TelemetryRender.renderShow)
  }),
)
