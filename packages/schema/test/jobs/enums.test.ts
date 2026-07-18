import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Enums } from "../../src/jobs/enums"
import { EnumsEvent } from "../../src/jobs/enums-event"
import { EnumsNotification } from "../../src/jobs/enums-notification"
import { EventTypes } from "../../src/jobs/event-types"

// Feature 003 / T032 — the closed jobs enums mirror doc/arch/schemas/jobs/
// enums.cue, enums-event.cue, enums-notification.cue and event-types.cue
// one-to-one (FR6, FR11, FR15, FR16, FR28, C3, C5, C9, C13, C19).

describe("Enums.RegistrationState / RegistrationIntent (FR6, C5)", () => {
  test("decodes every registration state member", () => {
    for (const value of ["pending", "registered", "unregistered", "unknown", "reconciled"] as const) {
      expect(Schema.decodeUnknownSync(Enums.RegistrationState)(value)).toBe(value)
    }
  })

  test("rejects an out-of-vocabulary state", () => {
    expect(() => Schema.decodeUnknownSync(Enums.RegistrationState)("registering")).toThrow()
  })

  test("decodes register and unregister intents only", () => {
    expect(Schema.decodeUnknownSync(Enums.RegistrationIntent)("register")).toBe("register")
    expect(Schema.decodeUnknownSync(Enums.RegistrationIntent)("unregister")).toBe("unregister")
    expect(() => Schema.decodeUnknownSync(Enums.RegistrationIntent)("reregister")).toThrow()
  })
})

describe("Enums.OccurrenceState — the fifteen-member closed state machine (FR11, C6)", () => {
  test("decodes every one of the fifteen members", () => {
    const members = [
      "due",
      "claimed",
      "admitted",
      "executing",
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "skipped",
      "coalesced",
      "misfired",
      "overlap_rejected",
      "overlap_replaced",
      "reconciled",
      "unknown",
    ] as const
    expect(members.length).toBe(15)
    for (const value of members) {
      expect(Schema.decodeUnknownSync(Enums.OccurrenceState)(value)).toBe(value)
    }
    expect(Enums.OccurrenceState.literals.length).toBe(15)
  })

  test("rejects an out-of-vocabulary state", () => {
    expect(() => Schema.decodeUnknownSync(Enums.OccurrenceState)("paused")).toThrow()
  })
})

describe("Enums.MisfirePolicy — no infinite catch-up permitted (FR15, C19)", () => {
  test("decodes every closed member", () => {
    for (const value of ["skip", "fire_once", "bounded_catch_up", "coalesce"] as const) {
      expect(Schema.decodeUnknownSync(Enums.MisfirePolicy)(value)).toBe(value)
    }
  })

  test("rejects an infinite/unbounded catch-up alias", () => {
    expect(() => Schema.decodeUnknownSync(Enums.MisfirePolicy)("infinite_catch_up")).toThrow()
  })
})

describe("Enums.OverlapPolicy — default forbid; non-default values are capability-gated (FR16, C3)", () => {
  test("decodes every closed member including the default", () => {
    for (const value of ["allow", "forbid", "queue", "replace"] as const) {
      expect(Schema.decodeUnknownSync(Enums.OverlapPolicy)(value)).toBe(value)
    }
  })

  test("rejects an out-of-vocabulary policy", () => {
    expect(() => Schema.decodeUnknownSync(Enums.OverlapPolicy)("kill")).toThrow()
  })
})

describe("Enums.ActionType / Scope / CapabilitySurface / ReconcileOutcome / EventClass", () => {
  test("ActionType decodes every closed member (FR28)", () => {
    for (const value of [
      "native_maintenance",
      "operator_notification",
      "main_context_wake",
      "smart_routing_dispatch",
      "approved_workflow",
    ] as const) {
      expect(Schema.decodeUnknownSync(Enums.ActionType)(value)).toBe(value)
    }
  })

  test("Scope defaults conceptually to project but decodes every closed member (C12)", () => {
    for (const value of ["global", "project", "root", "session"] as const) {
      expect(Schema.decodeUnknownSync(Enums.Scope)(value)).toBe(value)
    }
  })

  test("CapabilitySurface distinguishes in_process from the deferred os_level form (C1, C2)", () => {
    expect(Schema.decodeUnknownSync(Enums.CapabilitySurface)("in_process")).toBe("in_process")
    expect(Schema.decodeUnknownSync(Enums.CapabilitySurface)("os_level")).toBe("os_level")
    expect(() => Schema.decodeUnknownSync(Enums.CapabilitySurface)("distributed")).toThrow()
  })

  test("ReconcileOutcome never claims past execution — reconciled or unknown only (FR14, C5)", () => {
    expect(Schema.decodeUnknownSync(Enums.ReconcileOutcome)("reconciled")).toBe("reconciled")
    expect(Schema.decodeUnknownSync(Enums.ReconcileOutcome)("unknown")).toBe("unknown")
    expect(() => Schema.decodeUnknownSync(Enums.ReconcileOutcome)("succeeded")).toThrow()
  })

  test("EventClass separates durable from live job.* events (C8)", () => {
    expect(Schema.decodeUnknownSync(Enums.EventClass)("durable")).toBe("durable")
    expect(Schema.decodeUnknownSync(Enums.EventClass)("live")).toBe("live")
  })
})

describe("EnumsEvent.JobSource / ActorKind / Visibility", () => {
  test("JobSource decodes every closed member (FR12)", () => {
    for (const value of ["runtime", "scheduler", "executor", "reconciler", "operator"] as const) {
      expect(Schema.decodeUnknownSync(EnumsEvent.JobSource)(value)).toBe(value)
    }
  })

  test("ActorKind never includes an LLM/agent actor (FR28, AC17)", () => {
    for (const value of ["runtime", "operator", "executor"] as const) {
      expect(Schema.decodeUnknownSync(EnumsEvent.ActorKind)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(EnumsEvent.ActorKind)("llm")).toThrow()
    expect(() => Schema.decodeUnknownSync(EnumsEvent.ActorKind)("agent")).toThrow()
  })

  test("Visibility enforces the authorization scope before delivery/projection (FR21, C10)", () => {
    for (const value of ["session", "tree", "project", "global_privileged"] as const) {
      expect(Schema.decodeUnknownSync(EnumsEvent.Visibility)(value)).toBe(value)
    }
  })
})

describe("EnumsNotification — the bounded, authorized async channel enums (FR20, FR22, FR24, C8, C9)", () => {
  test("NotificationType decodes every closed member", () => {
    for (const value of [
      "occurrence_settled",
      "occurrence_failed",
      "occurrence_cancelled",
      "occurrence_timed_out",
      "misfire",
      "reconciled",
      "operator_advisory",
    ] as const) {
      expect(Schema.decodeUnknownSync(EnumsNotification.NotificationType)(value)).toBe(value)
    }
  })

  test("NotificationPriority is a bounded bucket, never a high-cardinality label (C18)", () => {
    for (const value of ["low", "normal", "high", "urgent"] as const) {
      expect(Schema.decodeUnknownSync(EnumsNotification.NotificationPriority)(value)).toBe(value)
    }
  })

  test("DeliveryState / AckState decode every closed member", () => {
    for (const value of ["enqueued", "queued", "coalesced", "delivered", "expired"] as const) {
      expect(Schema.decodeUnknownSync(EnumsNotification.DeliveryState)(value)).toBe(value)
    }
    for (const value of ["unacknowledged", "acknowledged", "expired"] as const) {
      expect(Schema.decodeUnknownSync(EnumsNotification.AckState)(value)).toBe(value)
    }
  })

  test("DeliveryAction — operator_only is the default; wake/queue/child are explicit (FR24, C9)", () => {
    for (const value of ["operator_only", "manager_wake", "input_queue", "child_session"] as const) {
      expect(Schema.decodeUnknownSync(EnumsNotification.DeliveryAction)(value)).toBe(value)
    }
  })

  test("SafeBoundary flags safe active-turn delivery only (FR25, AC7)", () => {
    expect(Schema.decodeUnknownSync(EnumsNotification.SafeBoundary)("safe")).toBe("safe")
    expect(Schema.decodeUnknownSync(EnumsNotification.SafeBoundary)("unsafe")).toBe("unsafe")
  })
})

describe("EventTypes.JobEventType — the closed 30-member job.* vocabulary (FR11)", () => {
  test("has exactly thirty members, every one prefixed job.", () => {
    expect(EventTypes.JobEventType.literals.length).toBe(30)
    for (const value of EventTypes.JobEventType.literals) {
      expect(value.startsWith("job.")).toBe(true)
      expect(Schema.decodeUnknownSync(EventTypes.JobEventType)(value)).toBe(value)
    }
  })

  test("rejects an unregistered job.* member and the jobs.* operator-command namespace (C13)", () => {
    expect(() => Schema.decodeUnknownSync(EventTypes.JobEventType)("job.paused")).toThrow()
    expect(() => Schema.decodeUnknownSync(EventTypes.JobEventType)("jobs.list")).toThrow()
  })

  test("every member is unique", () => {
    expect(new Set(EventTypes.JobEventType.literals).size).toBe(30)
  })
})
