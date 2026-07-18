import * as Effect from "effect/Effect"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { Output } from "../operator/output"
import { OutputRender } from "./render"

export default Runtime.handler(
  Commands.commands.output.commands.quota.commands.set,
  Effect.fn("cli.output.quota.set")(function* (input) {
    const scope = Dispatch.scopeFromFlag(input.scope)
    const result = yield* Dispatch.dispatch({
      id: "output.quota.set",
      scope,
      payload: {
        quotaScope: input.quotaScope,
        maxBytes: input.maxBytes,
        maxQueueDepthBytes: input.maxQueueDepthBytes,
        expectedVersion: input.expectedVersion,
      },
    })
    Output.emit(result, input.json, OutputRender.renderQuota)
  }),
)
