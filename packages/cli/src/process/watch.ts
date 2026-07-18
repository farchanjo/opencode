import * as Effect from "effect/Effect"
import { Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { ProcessRender } from "./render"
import { ProcessPoll } from "./poll"

/**
 * Bounded-polling `watch` degrade path — see `./poll.ts` for why this is a
 * poll loop rather than a live subscription (no CLI push transport yet).
 */
export default Runtime.handler(
  Commands.commands.process.commands.watch,
  Effect.fn("cli.process.watch")(function* (input) {
    const plan = ProcessPoll.resolvePollPlan(Option.getOrUndefined(input.interval), Option.getOrUndefined(input.maxPolls))
    let remaining = plan.maxPolls
    while (remaining > 0) {
      const result = yield* Dispatch.dispatch({ id: "process.watch", payload: { processId: input.processId } })
      remaining -= 1
      if (!result.ok) {
        if (input.json) process.stdout.write(JSON.stringify(result) + EOL)
        else process.stderr.write(`error: ${result.error?.code ?? result.outcome}: ${result.error?.message ?? "watch failed"}${EOL}`)
        process.exitCode = 1
        return
      }
      if (input.json) process.stdout.write(JSON.stringify(result.effective) + EOL)
      else process.stdout.write(ProcessRender.renderWatchFrame(result.effective) + EOL)

      const outcome = ProcessPoll.pollOutcome(result.effective, remaining)
      if (outcome === "terminal") {
        process.exitCode = 0
        return
      }
      if (outcome === "exhausted") {
        if (!input.json) process.stderr.write(`watch: gave up after ${plan.maxPolls} polls without a terminal state${EOL}`)
        process.exitCode = 1
        return
      }
      yield* Effect.sleep(`${plan.intervalMs} millis`)
    }
  }),
)
