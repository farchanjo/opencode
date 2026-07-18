import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { ProcessRender } from "./render"

export default Runtime.handler(
  Commands.commands.process.commands.handoff,
  Effect.fn("cli.process.handoff")(function* (input) {
    const reason = Option.getOrNull(input.reason)
    const result = yield* Dispatch.dispatch({
      id: "process.handoff",
      payload: { processId: input.processId, targetSessionId: input.targetSessionId, reason },
    })
    Output.emit(result, input.json, ProcessRender.renderHandoff)
  }),
)
