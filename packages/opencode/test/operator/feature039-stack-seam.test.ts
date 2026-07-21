/**
 * Feature 039 — the operator-stack candidate/agent seams must bind `InstanceRef`.
 *
 * In `operator/stack-live.ts` the catalog candidate resolver
 * (`catalogCandidates.listModels` → `Provider.list()`) and the agent resolver
 * (`agentResolver.resolveAgents` → `Agent.listSpecialists()`) run their effects on an
 * `AppRuntime.runPromise` fiber. Both services are `InstanceState`-backed, and every
 * `InstanceState` read funnels through `InstanceState.context`, which
 * `Effect.die("InstanceRef not provided")` when no `InstanceRef` is bound. Before this
 * fix those two seams (unlike the config seam) did NOT
 * `.pipe(Effect.provideService(InstanceRef, instance))`, so candidate/agent resolution
 * died — breaking `routing.test`, `capability inspect`, and (once Feature 038 wired
 * catalog validation into `pools.set`) the CLI `op pools set`.
 *
 * This pins the seam-binding contract at its exact failure point: the shared
 * `InstanceState.context` check the two seams funnel through DIES without the bind and
 * RESOLVES with it. It is deliberately harness-light (plain Effect runtime, no live
 * Provider/Agent services) — the die is purely a function of whether `InstanceRef` is
 * provided on the fiber, which is exactly what the two one-line seam fixes add.
 */
import { describe, expect, test } from "bun:test"
import { Cause, Effect } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"

// A minimal InstanceContext double: `InstanceState.context` only checks presence, and
// `InstanceState.directory` reads `.directory` — no project/worktree machinery needed.
const INSTANCE: InstanceContext = {
  directory: "/tmp/feature039",
  worktree: "/tmp/feature039",
  project: { id: "proj_039" } as InstanceContext["project"],
}

// Faithful to the seam bodies: an effect that reads an InstanceState-backed value the
// way Provider.Service / Agent.Service do (both go through `InstanceState.context`).
const seam = InstanceState.directory

describe("Feature 039 — stack candidate/agent seams bind InstanceRef", () => {
  test("WITHOUT the bind the seam dies `InstanceRef not provided` (the pre-fix defect)", async () => {
    // The die defect (an `Error`) does not survive `Cause.toJSON`; `Cause.pretty`
    // renders its message, so we assert the exact reproduced failure.
    const exit = await Effect.runPromiseExit(seam)
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") expect(Cause.pretty(exit.cause)).toContain("InstanceRef not provided")
  })

  test("WITH `.pipe(Effect.provideService(InstanceRef, instance))` the seam resolves (the fix)", async () => {
    const resolved = await Effect.runPromise(seam.pipe(Effect.provideService(InstanceRef, INSTANCE)))
    expect(resolved).toBe(INSTANCE.directory)
  })
})
