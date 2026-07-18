import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { ProcessRender } from "./render"

export default Runtime.handler(
  Commands.commands.process.commands.status,
  Effect.fn("cli.process.status")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "process.status", payload: { processId: input.processId } })
    Output.emit(result, input.json, ProcessRender.renderStatus)
  }),
)
