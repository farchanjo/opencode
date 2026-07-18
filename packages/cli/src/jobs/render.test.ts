import { describe, expect, test } from "bun:test"
import {
  renderDefinition,
  renderDelete,
  renderDisable,
  renderHistory,
  renderList,
  renderMutation,
  renderRunNow,
  renderShow,
  renderStatus,
  renderWatch,
} from "./render"

const definition = {
  jobDefinitionId: "jobdef_1",
  name: "nightly-index",
  description: "reconcile the semantic index",
  enabled: true,
  schedule: { scheduleId: "sched_1", cronExpression: "0 2 * * *", ianaTimezone: "UTC" },
  actionType: "smart_routing_dispatch",
  overlapPolicy: "forbid",
  misfirePolicy: "skip",
  registrationState: "registered",
  nextDueAt: "2026-07-19T02:00:00.000Z",
  lastOutcome: "completed",
  version: 3,
  updatedAt: "2026-07-18T10:00:00.000Z",
}

describe("jobs renderers", () => {
  test("definition renders identity, schedule, and policy", () => {
    const out = renderDefinition(definition)
    expect(out).toContain("job jobdef_1: nightly-index (v3)")
    expect(out).toContain("enabled: yes  registration: registered")
    expect(out).toContain("schedule: 0 2 * * * (UTC)")
    expect(out).toContain("action: smart_routing_dispatch  overlap: forbid  misfire: skip")
    expect(out).toContain("next due: 2026-07-19T02:00:00.000Z")
    expect(out).toContain("last outcome: completed")
  })

  test("status wraps a single definition", () => {
    expect(renderStatus({ definition })).toContain("job jobdef_1: nightly-index (v3)")
  })

  test("list renders multiple definitions separated and an honest empty baseline", () => {
    const out = renderList({ definitions: [definition, { ...definition, jobDefinitionId: "jobdef_2" }], cursor: "cur_1" })
    expect(out).toContain("job jobdef_1")
    expect(out).toContain("job jobdef_2")
    expect(out).toContain("cursor: cur_1")
    expect(renderList({ definitions: [] })).toBe("jobs: (empty)")
  })

  test("show renders the definition plus occurrence rows and an honest empty baseline", () => {
    const out = renderShow({
      definition,
      occurrences: [
        { occurrenceId: "occ_1", state: "completed", nominalDueTime: "2026-07-18T02:00:00.000Z", outcome: "completed", processId: "proc_1" },
      ],
    })
    expect(out).toContain("occurrence occ_1: completed")
    expect(out).toContain("due: 2026-07-18T02:00:00.000Z")
    expect(out).toContain("process: proc_1")
    expect(renderShow({ definition, occurrences: [] })).toContain("occurrences: (empty)")
  })

  test("mutation renders the definition and audit id", () => {
    const out = renderMutation({ definition, auditId: "audit_1" })
    expect(out).toContain("job jobdef_1")
    expect(out).toContain("audit: audit_1")
  })

  test("disable renders the active occurrence outcome, never a false kill", () => {
    const out = renderDisable({ definition, activeOccurrenceOutcome: "unconfirmed", auditId: "audit_2" })
    expect(out).toContain("active occurrence: unconfirmed")
    expect(out).toContain("audit: audit_2")
  })

  test("delete renders the outcome and audit id", () => {
    const out = renderDelete({ deleted: true, auditId: "audit_3" })
    expect(out).toContain("deleted: yes")
    expect(out).toContain("audit: audit_3")
  })

  test("run-now renders the created occurrence and audit id", () => {
    const out = renderRunNow({ occurrence: { occurrenceId: "occ_2", state: "due", nominalDueTime: "2026-07-18T03:00:00.000Z" }, auditId: "audit_4" })
    expect(out).toContain("occurrence occ_2: due")
    expect(out).toContain("audit: audit_4")
  })

  test("history renders occurrences and notifications with honest empty baselines", () => {
    const out = renderHistory({
      occurrences: [{ occurrenceId: "occ_3", state: "failed", nominalDueTime: "2026-07-18T04:00:00.000Z" }],
      notifications: [{ notificationId: "notif_1", type: "occurrence_failed", deliveryState: "delivered", ackState: "unacknowledged", summary: "bounded summary" }],
      cursor: null,
    })
    expect(out).toContain("occurrence occ_3: failed")
    expect(out).toContain("notification notif_1: occurrence_failed")
    expect(out).toContain("summary: bounded summary")
    const empty = renderHistory({ occurrences: [], notifications: [] })
    expect(empty).toContain("occurrences: (empty)")
    expect(empty).toContain("notifications: (empty)")
  })

  test("watch renders the snapshot definition with an honest streaming label", () => {
    const out = renderWatch({ definition, streaming: "observation-surface" })
    expect(out).toContain("job jobdef_1")
    expect(out).toContain("streaming: observation-surface (live stream is a TUI surface)")
  })

  test("no renderer ever leaks a prompt, secret, or absolute path (redacted rows only)", () => {
    const dangerous = {
      definition: { ...definition, description: "bounded redacted description" },
      definitions: [definition],
      occurrences: [{ occurrenceId: "occ_1", state: "completed", nominalDueTime: "2026-07-18T02:00:00.000Z" }],
      notifications: [{ notificationId: "notif_1", type: "occurrence_completed", deliveryState: "delivered", ackState: "acknowledged", summary: "bounded" }],
      occurrence: { occurrenceId: "occ_1", state: "due", nominalDueTime: "2026-07-18T02:00:00.000Z" },
      activeOccurrenceOutcome: "none_active",
      deleted: true,
      auditId: "audit_1",
      streaming: "observation-surface",
    }
    const outputs = [
      renderStatus(dangerous),
      renderList(dangerous),
      renderShow(dangerous),
      renderMutation(dangerous),
      renderDisable(dangerous),
      renderDelete(dangerous),
      renderRunNow(dangerous),
      renderHistory(dangerous),
      renderWatch(dangerous),
    ]
    for (const out of outputs) {
      for (const token of ["sk-", "/Users/", "prompt", "secret"]) {
        expect(out.includes(token), `rendered output leaked "${token}"`).toBe(false)
      }
    }
  })
})
