/**
 * Feature 004 / T030 (S15) — content-free `langlock.*` audit/advisory projection.
 *
 * Projects the closed `langlock.*` audit and advisory-violation events over the
 * REUSED `publishLangLockEvent` bridge boundary (Feature 001 / T022) per ADR-0001
 * — no second channel exists (FR27, Security 5, C8, AC14). Every projected event
 * carries only bounded enums / buckets / counts and opaque execution/correlation
 * ids; it NEVER carries file text, diff, prompt, message, path, snippet,
 * reasoning, tool payload, or a secret. The `redacted_metadata` map is scrubbed of
 * any sensitive-looking key before the event is built, so a caller cannot smuggle
 * content through it.
 *
 * The module builds the `LangLockEvent` values from bounded content-free inputs
 * (decoding through the canonical `@opencode-ai/schema/langlock/*` schemas so a
 * malformed projection fails fast) and hands them to the injected publish
 * function. The composition root binds the real `EventV2Bridge.publishLangLockEvent`;
 * unit tests bind a recording double.
 */
export * as LangLockAudit from "./audit"

import { Schema } from "effect"
import type { Effect } from "effect"
import { Events } from "@opencode-ai/schema/langlock/events"
import { Envelope } from "@opencode-ai/schema/langlock/envelope"
import type {
  ConfidenceBucket,
  EnforcementMode,
  ExceptionCategory,
  Origin,
  PathKind,
  RemediationStatus,
  Scope,
} from "@opencode-ai/schema/langlock/enums"
import type { ActorKind, EventClass, EventSource } from "@opencode-ai/schema/langlock/enums-event"

/** The injected publish boundary (the bridge `publishLangLockEvent`); returns the published payload. */
export type PublishLangLockEvent = (event: Events.LangLockEvent) => Effect.Effect<unknown>

export interface LangLockAuditDeps {
  readonly publish: PublishLangLockEvent
}

/** Substrings that mark a metadata key as content-bearing and force its removal (Security 5, AC14). */
export const SENSITIVE_KEY_PATTERN =
  /prompt|secret|password|api[_-]?key|token|credential|content|text|diff|path|snippet|reasoning|payload|message/i

/** Drop any content-bearing key from a bounded `redacted_metadata` map (defensive, Security 5). */
export function scrubMetadata(metadata: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    out[key] = value
  }
  return out
}

/** The bounded, content-free envelope inputs shared by every projected event (Security 5, C8). */
export interface EnvelopeInput {
  readonly eventId: string
  readonly schemaVersion: number
  readonly eventClass: EventClass
  readonly source: EventSource
  readonly actorKind: ActorKind
  readonly principal: string
  readonly scope: Scope
  readonly sequence: number
  readonly correlationId: string
  readonly causationId: string | null
  readonly executionId: string
  readonly timestampMs: number
  readonly redactedMetadata?: Readonly<Record<string, string>>
}

/**
 * Build the plain ENCODED envelope record (timestamp as epoch millis), scrubbing
 * metadata of content-bearing keys (Security 5). The event builders nest this in
 * the member and decode the whole event ONCE, so the `DateTimeUtcFromMillis` field
 * is never double-decoded.
 */
function envelopeRecord(input: EnvelopeInput, eventType: string): Record<string, unknown> {
  return {
    event_id: input.eventId,
    kind: {
      event_type: eventType,
      schema_version: input.schemaVersion,
      event_class: input.eventClass,
      source: input.source,
    },
    actor: { actor_kind: input.actorKind, principal: input.principal, scope: input.scope },
    ordering: { sequence: input.sequence, correlation_id: input.correlationId, causation_id: input.causationId },
    delivery: {
      execution_id: input.executionId,
      timestamp: input.timestampMs,
      redacted_metadata: scrubMetadata(input.redactedMetadata ?? {}),
    },
  }
}

/** Build the content-free, typed `LangLockEnvelope` (for direct inspection/testing). */
export function buildEnvelope(input: EnvelopeInput, eventType: string): Envelope.LangLockEnvelope {
  return Schema.decodeUnknownSync(Envelope.LangLockEnvelope)(envelopeRecord(input, eventType))
}

/** Bounded policy-mutation detail (durable audit members). */
export interface PolicyDetailInput {
  readonly tag: string
  readonly scope: Scope
  readonly policyVersion: number
}

/** Bounded override-authorization detail (durable audit members). */
export interface OverrideDetailInput {
  readonly overrideAuthorized: boolean
  readonly scope: Scope
  readonly hardFloor: boolean
}

/** Bounded exemption detail (durable audit members). */
export interface ExceptionDetailInput {
  readonly category: ExceptionCategory
  readonly scope: Scope
}

/** Bounded injection/reapply/stamp detail (live members). */
export interface InjectionDetailInput {
  readonly enforcementMode: EnforcementMode
  readonly origin: Origin
}

/** Bounded advisory detail (live members). */
export interface AdvisoryDetailInput {
  readonly pathKind: PathKind
  readonly confidence: ConfidenceBucket
  readonly remediation: RemediationStatus
}

/** Bounded resolution detail (live members). */
export interface ResolutionDetailInput {
  readonly scope: Scope
  readonly origin: Origin
}

const decodePolicySet = Schema.decodeUnknownSync(Events.LangLockPolicySetEvent)
const decodePolicyReset = Schema.decodeUnknownSync(Events.LangLockPolicyResetEvent)
const decodeOverrideAuthorized = Schema.decodeUnknownSync(Events.LangLockOverrideAuthorizedEvent)
const decodeOverrideDenied = Schema.decodeUnknownSync(Events.LangLockOverrideDeniedEvent)
const decodeAdvisoryFlagged = Schema.decodeUnknownSync(Events.LangLockAdvisoryFlaggedEvent)
const decodeDetectorUnknown = Schema.decodeUnknownSync(Events.LangLockDetectorUnknownEvent)
const decodeResolutionRetained = Schema.decodeUnknownSync(Events.LangLockResolutionRetainedEvent)

/**
 * The content-free audit/advisory projector (FR27, C8, AC14). Every method builds
 * a bounded `langlock.*` event and publishes it over the injected bridge; none
 * carries content. The six durable audit members and the key live advisory
 * members are covered — the projection is additive, never coalesced.
 */
export function createAuditProjector(deps: LangLockAuditDeps) {
  const policySet = (envelope: EnvelopeInput, detail: PolicyDetailInput) =>
    deps.publish(
      decodePolicySet({
        type: "langlock.policy_set",
        envelope: envelopeRecord(envelope, "langlock.policy_set"),
        detail: { tag: detail.tag, scope: detail.scope, policy_version: detail.policyVersion },
      }),
    )

  const policyReset = (envelope: EnvelopeInput, detail: PolicyDetailInput) =>
    deps.publish(
      decodePolicyReset({
        type: "langlock.policy_reset",
        envelope: envelopeRecord(envelope, "langlock.policy_reset"),
        detail: { tag: detail.tag, scope: detail.scope, policy_version: detail.policyVersion },
      }),
    )

  const overrideAuthorized = (envelope: EnvelopeInput, detail: OverrideDetailInput) =>
    deps.publish(
      decodeOverrideAuthorized({
        type: "langlock.override_authorized",
        envelope: envelopeRecord(envelope, "langlock.override_authorized"),
        detail: { override_authorized: detail.overrideAuthorized, scope: detail.scope, hard_floor: detail.hardFloor },
      }),
    )

  const overrideDenied = (envelope: EnvelopeInput, detail: OverrideDetailInput) =>
    deps.publish(
      decodeOverrideDenied({
        type: "langlock.override_denied",
        envelope: envelopeRecord(envelope, "langlock.override_denied"),
        detail: { override_authorized: detail.overrideAuthorized, scope: detail.scope, hard_floor: detail.hardFloor },
      }),
    )

  const advisoryFlagged = (envelope: EnvelopeInput, detail: AdvisoryDetailInput) =>
    deps.publish(
      decodeAdvisoryFlagged({
        type: "langlock.advisory_flagged",
        envelope: envelopeRecord(envelope, "langlock.advisory_flagged"),
        detail: { path_kind: detail.pathKind, confidence: detail.confidence, remediation: detail.remediation },
      }),
    )

  const detectorUnknown = (envelope: EnvelopeInput, detail: AdvisoryDetailInput) =>
    deps.publish(
      decodeDetectorUnknown({
        type: "langlock.detector_unknown",
        envelope: envelopeRecord(envelope, "langlock.detector_unknown"),
        detail: { path_kind: detail.pathKind, confidence: detail.confidence, remediation: detail.remediation },
      }),
    )

  const resolutionRetained = (envelope: EnvelopeInput, detail: ResolutionDetailInput) =>
    deps.publish(
      decodeResolutionRetained({
        type: "langlock.resolution_retained",
        envelope: envelopeRecord(envelope, "langlock.resolution_retained"),
        detail: { scope: detail.scope, origin: detail.origin },
      }),
    )

  return { policySet, policyReset, overrideAuthorized, overrideDenied, advisoryFlagged, detectorUnknown, resolutionRetained }
}
