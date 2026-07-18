import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TelemetryRender } from "./render"

export default Runtime.handler(
  Commands.commands.telemetry.commands.test,
  Effect.fn("cli.telemetry.test")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "telemetry.test", payload: { mode: input.mode } })
    Output.emit(result, input.json, TelemetryRender.renderTest)
  }),
)
