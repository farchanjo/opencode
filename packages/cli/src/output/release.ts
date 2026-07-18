import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.release,
  Effect.fn("cli.output.release")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "output.release", payload: { outputRef: input.outputRef } })
    Output.emit(result, input.json, OutputRender.renderRefAudit)
  }),
)
