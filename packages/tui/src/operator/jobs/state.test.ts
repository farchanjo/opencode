import { describe, expect, test } from "bun:test"
import type { JobDefinitionSummary, NotificationEnvelope, Occurrence } from "@opencode-ai/protocol/jobs/commands"
import {
  deriveDefinitionHistory,
  deriveVisibleDefinitionCards,
  EMPTY_JOBS_PANEL_SIGNAL,
  MAX_VISIBLE_DEFINITIONS,
  projectJobsSignal,
  type JobsPanelSignal,
} from "./state"

function summary(id: string): JobDefinitionSummary {
  return {
    jobDefinitionId: id,
    name: id,
    description: "",
    enabled: true,
    schedule: { scheduleId: `sched_${id}`, cronExpression: "* * * * *", ianaTimezone: "UTC" },
    actionType: "native_maintenance",
    overlapPolicy: "forbid",
    misfirePolicy: "skip",
    registrationState: "registered",
    nextDueAt: null,
    lastOutcome: null,
    version: 1,
    updatedAt: "2026-07-18T00:00:00.000Z",
  }
}

function occurrence(id: string, jobDefinitionId: string): Occurrence {
  return {
    occurrenceId: id,
    jobDefinitionId,
    scheduleId: `sched_${jobDefinitionId}`,
    nominalDueTime: "2026-07-18T00:00:00.000Z",
    generation: 1,
    correlationId: `corr_${id}`,
    causationId: null,
    sessionId: null,
    rootSessionId: null,
    processId: null,
    attempt: null,
    state: "due",
    outcome: null,
  }
}

function notification(id: string, jobDefinitionId: string): NotificationEnvelope {
  return {
    notificationId: id,
    eventId: `evt_${id}`,
    occurrenceId: `occ_${id}`,
    jobDefinitionId,
    targetRootSessionId: "root_1",
    targetSessionId: null,
    source: "scheduler",
    type: "occurrence_completed",
    priority: "normal",
    createdAt: "2026-07-18T00:00:00.000Z",
    expiresAt: "2026-07-19T00:00:00.000Z",
    correlationId: `corr_${id}`,
    causationId: null,
    summary: "done",
    outputRef: null,
    deliveryState: "pending",
    ackState: "unacknowledged",
  }
}

describe("jobs-panel signal + projections (FR30, C12)", () => {
  test("the empty baseline renders no definitions and no history", () => {
    expect(deriveVisibleDefinitionCards(EMPTY_JOBS_PANEL_SIGNAL)).toEqual([])
    expect(deriveDefinitionHistory(EMPTY_JOBS_PANEL_SIGNAL, "jobdef_1")).toEqual({
      occurrences: [],
      notifications: [],
    })
  })

  test("the visible definition count is bounded", () => {
    const definitions = Array.from({ length: MAX_VISIBLE_DEFINITIONS + 10 }, (_, i) => summary(`jobdef_${i}`))
    const signal: JobsPanelSignal = { definitions, occurrences: [], notifications: [] }
    expect(deriveVisibleDefinitionCards(signal).length).toBe(MAX_VISIBLE_DEFINITIONS)
  })

  test("history is filtered to only the selected Job Definition's occurrences and notifications", () => {
    const signal: JobsPanelSignal = {
      definitions: [summary("jobdef_a"), summary("jobdef_b")],
      occurrences: [occurrence("occ_a1", "jobdef_a"), occurrence("occ_b1", "jobdef_b")],
      notifications: [notification("notif_a1", "jobdef_a"), notification("notif_b1", "jobdef_b")],
    }
    const history = deriveDefinitionHistory(signal, "jobdef_a")
    expect(history.occurrences.map((o) => o.occurrenceId)).toEqual(["occ_a1"])
    expect(history.notifications.map((n) => n.notificationId)).toEqual(["notif_a1"])
  })
})

describe("projectJobsSignal — total structured-result projection (Feature 012 T005, FR4, FR8)", () => {
  test("a jobs.list effective projects the definitions (projected)", () => {
    const result = projectJobsSignal({ definitions: [summary("jobdef_a"), summary("jobdef_b")], cursor: null })
    expect(result.outcome).toBe("projected")
    expect(result.signal.definitions.map((d) => d.jobDefinitionId)).toEqual(["jobdef_a", "jobdef_b"])
    expect(result.signal.occurrences).toEqual([])
  })

  test("a jobs.show effective projects the single definition plus its occurrences", () => {
    const result = projectJobsSignal({ definition: summary("jobdef_a"), occurrences: [occurrence("occ_a1", "jobdef_a")] })
    expect(result.outcome).toBe("projected")
    expect(result.signal.definitions.map((d) => d.jobDefinitionId)).toEqual(["jobdef_a"])
    expect(result.signal.occurrences.map((o) => o.occurrenceId)).toEqual(["occ_a1"])
  })

  test("an absent effective degrades to the honest empty baseline (empty_fallback)", () => {
    for (const absent of [undefined, null]) {
      const result = projectJobsSignal(absent)
      expect(result.outcome).toBe("empty_fallback")
      expect(result.signal).toBe(EMPTY_JOBS_PANEL_SIGNAL)
    }
  })

  test("a malformed effective degrades to the honest empty baseline without throwing (shape_mismatch)", () => {
    for (const bad of [7, "jobs", [], {}, { definitions: [{ name: "x" }] }, { definition: { jobDefinitionId: 1 } }]) {
      const result = projectJobsSignal(bad)
      expect(result.outcome).toBe("shape_mismatch")
      expect(result.signal).toBe(EMPTY_JOBS_PANEL_SIGNAL)
    }
  })
})
