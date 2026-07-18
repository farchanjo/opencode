/**
 * Feature 004 / T039 (S20) — content-free `langlock.*` audit/advisory projection
 * over the single EventV2 authority (FR27, Security 5, C8, AC14). Every projected
 * event carries only bounded enums/buckets/counts and opaque ids; the
 * `redacted_metadata` map is scrubbed of any content-bearing key; each projection
 * method publishes exactly once over the injected `publishLangLockEvent` boundary.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LangLockAudit } from "@/langlock/audit"

function recorder() {
  const published: unknown[] = []
  const publish: LangLockAudit.PublishLangLockEvent = (event) =>
    Effect.sync(() => {
      published.push(event)
      return event
    })
  return { published, projector: LangLockAudit.createAuditProjector({ publish }) }
}

const envelope = (
  overrides: Partial<LangLockAudit.EnvelopeInput> = {},
): LangLockAudit.EnvelopeInput => ({
  eventId: "evt_1",
  schemaVersion: 1,
  eventClass: "durable",
  source: "operator",
  actorKind: "operator",
  principal: "operator:root",
  scope: "project",
  sequence: 0,
  correlationId: "corr_1",
  causationId: null,
  executionId: "exec_1",
  timestampMs: 1_721_260_800_000,
  ...overrides,
})

describe("T039 audit — durable audit projection is content-free (FR27, AC14)", () => {
  test("policy_set publishes exactly one bounded event with no content field", async () => {
    const { published, projector } = recorder()
    await Effect.runPromise(projector.policySet(envelope(), { tag: "pt-BR", scope: "project", policyVersion: 2 }))
    expect(published.length).toBe(1)
    const doc = JSON.stringify(published[0])
    expect(doc).toContain("langlock.policy_set")
    expect(doc).toContain("pt-BR")
    expect(doc).not.toContain("prompt")
    expect(doc).not.toContain("diff")
    expect(doc).not.toContain("BEGIN PRIVATE KEY")
  })

  test("override_denied publishes a bounded override-authorization event once", async () => {
    const { published, projector } = recorder()
    await Effect.runPromise(
      projector.overrideDenied(envelope(), { overrideAuthorized: false, scope: "project", hardFloor: true }),
    )
    expect(published.length).toBe(1)
    expect(JSON.stringify(published[0])).toContain("langlock.override_denied")
  })
})

describe("T039 audit — live advisory projection is content-free (Security 5, AC14)", () => {
  test("advisory_flagged carries only a path kind, bucket, and remediation", async () => {
    const { published, projector } = recorder()
    await Effect.runPromise(
      projector.advisoryFlagged(envelope({ eventClass: "live" }), {
        pathKind: "prose_markdown",
        confidence: "high",
        remediation: "flagged",
      }),
    )
    const doc = JSON.stringify(published[0])
    expect(doc).toContain("langlock.advisory_flagged")
    expect(doc).toContain("prose_markdown")
    expect(doc).not.toContain("snippet")
    expect(doc).not.toContain("reasoning")
  })
})

describe("T039 audit — redacted_metadata scrubbing (Security 5)", () => {
  test("scrubMetadata drops content-bearing keys and keeps bounded ones", () => {
    const scrubbed = LangLockAudit.scrubMetadata({
      origin: "operator",
      prompt: "hello world",
      api_key: "sk-123",
      file_path: "/Users/x/secret.md",
      reason_code: "set",
    })
    expect(scrubbed.origin).toBe("operator")
    expect(scrubbed.reason_code).toBe("set")
    expect(scrubbed.prompt).toBeUndefined()
    expect(scrubbed.api_key).toBeUndefined()
    expect(scrubbed.file_path).toBeUndefined()
  })

  test("a projected event cannot smuggle content through redacted_metadata", async () => {
    const { published, projector } = recorder()
    await Effect.runPromise(
      projector.policySet(
        envelope({ redactedMetadata: { origin: "operator", secret: "leak", content: "x" } }),
        { tag: "en-US", scope: "project", policyVersion: 1 },
      ),
    )
    const doc = JSON.stringify(published[0])
    expect(doc).toContain("operator")
    expect(doc).not.toContain("leak")
  })
})
