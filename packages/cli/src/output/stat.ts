import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.stat,
  Effect.fn("cli.output.stat")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "output.stat", payload: { outputRef: input.outputRef } })
    Output.emit(result, input.json, OutputRender.renderStat)
  }),
)
