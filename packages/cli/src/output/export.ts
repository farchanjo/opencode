import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.export,
  Effect.fn("cli.output.export")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "output.export",
      payload: { outputRef: input.outputRef, expectedVersion: input.expectedVersion },
    })
    Output.emit(result, input.json, OutputRender.renderExport)
  }),
)
