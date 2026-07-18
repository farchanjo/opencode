import { describe, expect, test } from "bun:test"
import type { NotificationEnvelope, Occurrence } from "@opencode-ai/protocol/jobs/commands"
import { deriveNotificationRowView, deriveOccurrenceRowView } from "./history"

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    occurrenceId: "occ_1",
    jobDefinitionId: "jobdef_1",
    scheduleId: "sched_1",
    nominalDueTime: "2026-07-18T03:00:00.000Z",
    generation: 1,
    correlationId: "corr_1",
    causationId: null,
    sessionId: null,
    rootSessionId: null,
    processId: null,
    attempt: null,
    state: "due",
    outcome: null,
    ...overrides,
  }
}

function notification(overrides: Partial<NotificationEnvelope> = {}): NotificationEnvelope {
  return {
    notificationId: "notif_1",
    eventId: "evt_1",
    occurrenceId: "occ_1",
    jobDefinitionId: "jobdef_1",
    targetRootSessionId: "root_1",
    targetSessionId: null,
    source: "scheduler",
    type: "occurrence_completed",
    priority: "normal",
    createdAt: "2026-07-18T03:00:05.000Z",
    expiresAt: "2026-07-19T03:00:05.000Z",
    correlationId: "corr_1",
    causationId: null,
    summary: "Occurrence completed successfully",
    outputRef: null,
    deliveryState: "pending",
    ackState: "unacknowledged",
    ...overrides,
  }
}

describe("jobs-panel occurrence history projection (FR10, C6)", () => {
  test("a due occurrence with no attempt yet renders honest fallback text", () => {
    const view = deriveOccurrenceRowView(occurrence())
    expect(view.occurrenceId).toBe("occ_1")
    expect(view.stateText).toBe("due")
    expect(view.outcomeText).toBe("not settled")
    expect(view.attemptText).toBe("not attempted")
    expect(view.processText).toBe("no process yet")
  })

  test("a settled, admitted occurrence renders its attempt and process id", () => {
    const view = deriveOccurrenceRowView(
      occurrence({ state: "completed", outcome: "completed", attempt: 1, processId: "proc_1" }),
    )
    expect(view.stateText).toBe("completed")
    expect(view.outcomeText).toBe("completed")
    expect(view.attemptText).toBe("attempt 1")
    expect(view.processText).toBe("proc_1")
  })
})

describe("jobs-panel notification history projection (FR22, C15)", () => {
  test("derives text-first fields from the bounded, redacted envelope", () => {
    const view = deriveNotificationRowView(notification())
    expect(view.notificationId).toBe("notif_1")
    expect(view.typeText).toBe("occurrence_completed")
    expect(view.priorityText).toBe("normal")
    expect(view.summaryText).toBe("Occurrence completed successfully")
    expect(view.deliveryStateText).toBe("pending")
    expect(view.ackStateText).toBe("unacknowledged")
  })

  test("never widens the summary beyond what the backend already produced", () => {
    const view = deriveNotificationRowView(notification({ summary: "bounded" }))
    expect(view.summaryText).toBe("bounded")
  })
})
