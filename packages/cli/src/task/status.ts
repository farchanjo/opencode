import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TaskRender } from "./render"

export default Runtime.handler(
  Commands.commands.task.commands.status,
  Effect.fn("cli.task.status")(function* (input) {
    const result = yield* Dispatch.dispatch({ id: "task.status", payload: { taskId: input.taskId } })
    Output.emit(result, input.json, TaskRender.renderStatus)
  }),
)
