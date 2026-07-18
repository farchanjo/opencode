import { describe, expect, test } from "bun:test"
import type { JobDefinitionSummary } from "@opencode-ai/protocol/jobs/commands"
import { deriveDefinitionCardView } from "./card"

function summary(overrides: Partial<JobDefinitionSummary> = {}): JobDefinitionSummary {
  return {
    jobDefinitionId: "jobdef_1",
    name: "nightly-cleanup",
    description: "Sweep stale worktrees",
    enabled: true,
    schedule: { scheduleId: "sched_1", cronExpression: "0 3 * * *", ianaTimezone: "UTC" },
    actionType: "native_maintenance",
    overlapPolicy: "forbid",
    misfirePolicy: "skip",
    registrationState: "registered",
    nextDueAt: "2026-07-19T03:00:00.000Z",
    lastOutcome: "completed",
    version: 3,
    updatedAt: "2026-07-18T03:00:00.000Z",
    ...overrides,
  }
}

describe("jobs-panel definition card projection (FR30, C12)", () => {
  test("derives text-first fields, never color-only", () => {
    const view = deriveDefinitionCardView(summary())
    expect(view.jobDefinitionId).toBe("jobdef_1")
    expect(view.nameText).toBe("nightly-cleanup")
    expect(view.registrationStateText).toBe("registered")
    expect(view.enabledText).toBe("enabled")
    expect(view.scheduleText).toBe("0 3 * * * (UTC)")
    expect(view.nextDueText).toBe("2026-07-19T03:00:00.000Z")
    expect(view.lastOutcomeText).toBe("completed")
    expect(view.actionTypeText).toBe("native maintenance")
    expect(view.overlapPolicyText).toBe("forbid")
    expect(view.misfirePolicyText).toBe("skip")
    expect(view.versionText).toBe("v3")
  })

  test("a never-triggered, unregistered job renders honest fallback text", () => {
    const view = deriveDefinitionCardView(
      summary({ registrationState: "pending", nextDueAt: null, lastOutcome: null, enabled: false }),
    )
    expect(view.registrationStateText).toBe("pending registration")
    expect(view.nextDueText).toBe("not scheduled")
    expect(view.lastOutcomeText).toBe("no runs yet")
    expect(view.enabledText).toBe("disabled")
  })

  test("an unknown registration state (needs reconcile) is surfaced textually", () => {
    const view = deriveDefinitionCardView(summary({ registrationState: "unknown" }))
    expect(view.registrationStateText).toBe("unknown (needs reconcile)")
  })
})
