import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TaskRender } from "./render"

export default Runtime.handler(
  Commands.commands.task.commands.cancel,
  Effect.fn("cli.task.cancel")(function* (input) {
    const reason = Option.getOrNull(input.reason)
    const result = yield* Dispatch.dispatch({ id: "task.cancel", payload: { taskId: input.taskId, reason } })
    Output.emit(result, input.json, TaskRender.renderCancel)
  }),
)
