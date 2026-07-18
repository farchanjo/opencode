import * as Effect from "effect/Effect"
import { Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands/commands"
import { Runtime } from "../framework/runtime"
import { Dispatch } from "../operator/dispatch"
import { ProcessPoll } from "../process/poll"
import { OutputFollowPlan } from "./follow-plan"
import { OutputRender } from "./render"

/**
 * Feature 005 / T038 (S26) — bounded-polling `follow` reconnect loop.
 *
 * `SpoolReaderPort.follow` (`contracts/ports.ts`) resumes from one opaque
 * cursor per call and returns the next cursor to resume from — there is no
 * live push/SSE transport on the CLI operator client
 * (`../operator/dispatch.ts`), so this mirrors the `process watch` bounded
 * degrade path (`../process/poll.ts`, `../process/watch.ts`): each iteration
 * re-dispatches `output.follow` with the cursor returned by the PREVIOUS
 * call, never the original one, so a killed-and-restarted CLI process
 * resumes exactly where it left off rather than rewinding (C14, C18). The
 * loop stops at `eof` (channel sealed/aborted and fully consumed) or when
 * `maxPolls` is exhausted.
 *
 * Honest gap: no `output.*` command mints a bootstrap cursor from a bare
 * OutputRef — `output.read`'s `ReadPage` carries no cursor field
 * (`@opencode-ai/protocol/outputspool/commands` `ReadOutput`/`FollowInput`).
 * A caller must already hold a cursor (e.g. from a prior `output follow`
 * response) before this command can be used; this is a spec-level gap
 * flagged for the working feature dir, not something this handler fakes.
 */
export default Runtime.handler(
  Commands.commands.output.commands.follow,
  Effect.fn("cli.output.follow")(function* (input) {
    const plan = ProcessPoll.resolvePollPlan(Option.getOrUndefined(input.interval), Option.getOrUndefined(input.maxPolls))
    let cursor = input.cursor
    let remaining = plan.maxPolls
    while (remaining > 0) {
      const result = yield* Dispatch.dispatch({ id: "output.follow", payload: { cursor } })
      remaining -= 1
      if (!result.ok) {
        if (input.json) process.stdout.write(JSON.stringify(result) + EOL)
        else process.stderr.write(`error: ${result.error?.code ?? result.outcome}: ${result.error?.message ?? "follow failed"}${EOL}`)
        process.exitCode = 1
        return
      }
      if (input.json) process.stdout.write(JSON.stringify(result.effective) + EOL)
      else process.stdout.write(OutputRender.renderFollowFrame(result.effective) + EOL)

      cursor = OutputFollowPlan.nextFollowCursor(result.effective, cursor)
      if (OutputFollowPlan.isFollowEof(result.effective)) {
        process.exitCode = 0
        return
      }
      if (remaining <= 0) {
        if (!input.json) process.stderr.write(`follow: gave up after ${plan.maxPolls} polls without reaching eof${EOL}`)
        process.exitCode = 1
        return
      }
      yield* Effect.sleep(`${plan.intervalMs} millis`)
    }
  }),
)
