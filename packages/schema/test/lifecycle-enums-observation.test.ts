import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { EnumsObservation } from "../src/lifecycle/enums-observation"

// Each enum is a closed Schema.Literals set; decode accepts every member and
// rejects any value outside the closed vocabulary.

const assertClosed = <A extends string>(schema: Schema.Codec<A, A>, valid: readonly A[], invalid: string) => {
  for (const member of valid) {
    expect(Schema.decodeUnknownSync(schema)(member)).toBe(member)
  }
  expect(() => Schema.decodeUnknownSync(schema)(invalid)).toThrow()
}

describe("lifecycle enums-observation", () => {
  test("decodes every closed-union member and rejects outsiders", () => {
    assertClosed(EnumsObservation.UsageProvenance, ["estimated", "reported"], "guessed")
    assertClosed(EnumsObservation.UsageSource, ["provider", "runtime", "local_estimate"], "cache")
    assertClosed(
      EnumsObservation.ActivityKind,
      ["read", "edit", "run_command", "search", "waiting", "generating", "settling"],
      "delete",
    )
    assertClosed(EnumsObservation.HierarchyRole, ["architect", "manager", "worker"], "owner")
    assertClosed(EnumsObservation.ValidationOutcome, ["passed", "failed", "low_confidence", "escalated"], "skipped")
    assertClosed(EnumsObservation.AnomalyKind, ["duplicate", "out_of_order", "unknown_event", "unreconciled"], "corrupt")
    assertClosed(EnumsObservation.CancelOutcome, ["requested", "accepted", "rejected", "unknown", "unconfirmed"], "killed")
    assertClosed(
      EnumsObservation.WatchdogOutcome,
      ["owner_lost", "zombie_detected", "unknown", "reconciled"],
      "provider_stopped",
    )
    assertClosed(
      EnumsObservation.AdmissionScope,
      ["global", "root", "session", "child", "provider", "agent", "tool", "event_queue", "otel_queue", "sqlite", "token", "cost"],
      "cluster",
    )
    assertClosed(EnumsObservation.AdmissionDecision, ["granted", "partial", "queued", "rejected"], "deferred")
    assertClosed(EnumsObservation.ObservationKind, ["session", "process", "tree", "global"], "workspace")
  })

  test("AdmissionScope pins the full twelve-scope budget vocabulary", () => {
    expect(EnumsObservation.AdmissionScope.literals.length).toBe(12)
  })

  test("every enum exposes a stable root identifier", () => {
    const identifiers = [
      EnumsObservation.UsageProvenance,
      EnumsObservation.UsageSource,
      EnumsObservation.ActivityKind,
      EnumsObservation.HierarchyRole,
      EnumsObservation.ValidationOutcome,
      EnumsObservation.AnomalyKind,
      EnumsObservation.CancelOutcome,
      EnumsObservation.WatchdogOutcome,
      EnumsObservation.AdmissionScope,
      EnumsObservation.AdmissionDecision,
      EnumsObservation.ObservationKind,
    ].map((schema) => schema.ast.annotations?.identifier)
    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })
})
