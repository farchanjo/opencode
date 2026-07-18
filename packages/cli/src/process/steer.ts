import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { ProcessRender } from "./render"

export default Runtime.handler(
  Commands.commands.process.commands.steer,
  Effect.fn("cli.process.steer")(function* (input) {
    const result = yield* Dispatch.dispatch({
      id: "process.steer",
      payload: { processId: input.processId, instruction: input.instruction },
    })
    Output.emit(result, input.json, ProcessRender.renderSteer)
  }),
)
