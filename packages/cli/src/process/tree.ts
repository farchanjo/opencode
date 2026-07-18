import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { ProcessRender } from "./render"

export default Runtime.handler(
  Commands.commands.process.commands.tree,
  Effect.fn("cli.process.tree")(function* (input) {
    const session = Option.getOrUndefined(input.session)
    const result = yield* Dispatch.dispatch({
      id: "process.tree",
      payload: { rootProcessId: input.rootProcessId, ...(session === undefined ? {} : { sessionId: session }) },
    })
    Output.emit(result, input.json, ProcessRender.renderTree)
  }),
)
