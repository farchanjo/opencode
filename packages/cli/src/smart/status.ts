import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SmartRender } from "./render"

export default Runtime.handler(
  Commands.commands.smart.commands.status,
  Effect.fn("cli.smart.status")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "smart.status" })
    Output.emit(result, input.json, SmartRender.renderStatus)
  }),
)
