import * as Effect from "effect/Effect"
import { Option } from "effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { SemanticRender } from "./render"

export default Runtime.handler(
  Commands.commands.semantic.commands.index.commands.reconcile,
  Effect.fn("cli.semantic.index.reconcile")(function* (input) {
    const scheduledOccurrenceId = Option.getOrUndefined(input.scheduledOccurrenceId)
    const result = yield* Dispatch.dispatch({
      id: "semantic.index.reconcile",
      payload: {
        collection: input.collection,
        ...(scheduledOccurrenceId === undefined ? {} : { scheduledOccurrenceId }),
      },
    })
    Output.emit(result, input.json, SemanticRender.renderIndexJob)
  }),
)
