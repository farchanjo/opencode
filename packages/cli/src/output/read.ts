import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.read,
  Effect.fn("cli.output.read")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "output.read",
      payload: { outputRef: input.outputRef, offset: input.offset, limit: input.limit },
    })
    Output.emit(result, input.json, OutputRender.renderPage)
  }),
)
