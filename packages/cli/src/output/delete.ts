import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.delete,
  Effect.fn("cli.output.delete")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "output.delete",
      payload: { outputRef: input.outputRef, expectedVersion: input.expectedVersion },
    })
    Output.emit(result, input.json, OutputRender.renderRefAudit)
  }),
)
