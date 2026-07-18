import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { TaskRender } from "./render"

export default Runtime.handler(
  Commands.commands.task.commands.tree,
  Effect.fn("cli.task.tree")(function* (input) {
    const session = Option.getOrUndefined(input.session)
    const result = yield* Dispatch.dispatch({
      id: "task.tree",
      payload: { taskId: input.taskId, ...(session === undefined ? {} : { sessionId: session }) },
    })
    Output.emit(result, input.json, TaskRender.renderTree)
  }),
)
