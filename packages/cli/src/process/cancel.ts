import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { ProcessRender } from "./render"

export default Runtime.handler(
  Commands.commands.process.commands.cancel,
  Effect.fn("cli.process.cancel")(function* (input) {
    const reason = Option.getOrNull(input.reason)
    const result = yield* Dispatch.dispatch({
      id: "process.cancel",
      payload: { processId: input.processId, reason },
    })
    Output.emit(result, input.json, ProcessRender.renderCancel)
  }),
)
