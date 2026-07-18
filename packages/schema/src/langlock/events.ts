export * as Events from "./events"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Envelope } from "./envelope"
import { TextValues } from "./text-values"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/events.cue, events-audit.cue and
// events-advisory.cue one-to-one — the closed 15-member LangLockEvent tagged
// union plus the cohesive detail sub-objects distinct members carry (FR27, FR34,
// C8). Policy-mutation, override, exception, injection, advisory and resolution
// stay distinct semantic events and are never collapsed into a generic status
// update.
//
// AUTHORITATIVE MODULE: every detail sub-object, all 15 member Structs, and the
// LangLockEvent union are defined here. events-audit.ts and events-advisory.ts
// re-export the durable/live member subsets (with grouping arrays for the bus
// layer, T021). Defining members in the split files while the union stays here
// would force an ESM circular initialization — the union needs the members and
// the members need these details — so the details and members share this one
// module and the split files are cycle-free re-export views (mirrors the
// Feature 002/003 events.ts / events-durable.ts / events-live.ts pattern).
//
// Mirroring Feature 002/003, each member is registered as its own EventV2.define
// Definition on the EventV2Bridge (dataFields(Member.fields)); no raw tagged
// union is wired to the bus (C8). Durable audit members carry the EventV2
// durable {version, aggregate} annotation; live members omit it (C8).

// --- events.cue: detail sub-objects ---

// PolicyDetail carries the tag, scope and CAS version for a policy mutation event (FR34, C8).
export const PolicyDetail = Schema.Struct({
  tag: Ids.LanguageTag,
  scope: Enums.Scope,
  policy_version: Values.PolicyVersion,
}).annotate({ identifier: "LangLockEvent.PolicyDetail" })
export type PolicyDetail = Schema.Schema.Type<typeof PolicyDetail>

// OverrideDetail carries the override authorization outcome, scope and floor state (FR5, Security 1, AC6).
export const OverrideDetail = Schema.Struct({
  override_authorized: TextValues.OverrideAuthorized,
  scope: Enums.Scope,
  hard_floor: TextValues.HardFloor,
}).annotate({ identifier: "LangLockEvent.OverrideDetail" })
export type OverrideDetail = Schema.Schema.Type<typeof OverrideDetail>

// ExceptionDetail carries the exemption category and its authority scope (FR14, C16).
export const ExceptionDetail = Schema.Struct({
  category: Enums.ExceptionCategory,
  scope: Enums.Scope,
}).annotate({ identifier: "LangLockEvent.ExceptionDetail" })
export type ExceptionDetail = Schema.Schema.Type<typeof ExceptionDetail>

// InjectionDetail carries the enforcement mode and origin of an injection/reapply/stamp event (FR17, C4).
export const InjectionDetail = Schema.Struct({
  enforcement_mode: Enums.EnforcementMode,
  origin: Enums.Origin,
}).annotate({ identifier: "LangLockEvent.InjectionDetail" })
export type InjectionDetail = Schema.Schema.Type<typeof InjectionDetail>

// AdvisoryDetail carries the path kind, confidence bucket and remediation status (FR21, C5, C6).
export const AdvisoryDetail = Schema.Struct({
  path_kind: Enums.PathKind,
  confidence: Enums.ConfidenceBucket,
  remediation: Enums.RemediationStatus,
}).annotate({ identifier: "LangLockEvent.AdvisoryDetail" })
export type AdvisoryDetail = Schema.Schema.Type<typeof AdvisoryDetail>

// ResolutionDetail carries the resolved scope and origin of a retained resolution (FR5, C2).
export const ResolutionDetail = Schema.Struct({
  scope: Enums.Scope,
  origin: Enums.Origin,
}).annotate({ identifier: "LangLockEvent.ResolutionDetail" })
export type ResolutionDetail = Schema.Schema.Type<typeof ResolutionDetail>

// --- events-audit.cue: durable audit members (six; C8) ---

// policy_set — a durable policy was set under CAS through Feature 007 (FR34, C3).
export const LangLockPolicySetEvent = Schema.Struct({
  type: Schema.Literal("langlock.policy_set"),
  envelope: Envelope.LangLockEnvelope,
  detail: PolicyDetail,
}).annotate({ identifier: "LangLockEvent.LangLockPolicySetEvent" })
export type LangLockPolicySetEvent = Schema.Schema.Type<typeof LangLockPolicySetEvent>

// policy_reset — a policy was reset to the global/default under CAS (FR34, C3).
export const LangLockPolicyResetEvent = Schema.Struct({
  type: Schema.Literal("langlock.policy_reset"),
  envelope: Envelope.LangLockEnvelope,
  detail: PolicyDetail,
}).annotate({ identifier: "LangLockEvent.LangLockPolicyResetEvent" })
export type LangLockPolicyResetEvent = Schema.Schema.Type<typeof LangLockPolicyResetEvent>

// override_authorized — a project override was authorized under langlock.override (FR5, Security 1, AC6).
export const LangLockOverrideAuthorizedEvent = Schema.Struct({
  type: Schema.Literal("langlock.override_authorized"),
  envelope: Envelope.LangLockEnvelope,
  detail: OverrideDetail,
}).annotate({ identifier: "LangLockEvent.LangLockOverrideAuthorizedEvent" })
export type LangLockOverrideAuthorizedEvent = Schema.Schema.Type<typeof LangLockOverrideAuthorizedEvent>

// override_denied — a project override was denied and the global value retained (FR5, AC5).
export const LangLockOverrideDeniedEvent = Schema.Struct({
  type: Schema.Literal("langlock.override_denied"),
  envelope: Envelope.LangLockEnvelope,
  detail: OverrideDetail,
}).annotate({ identifier: "LangLockEvent.LangLockOverrideDeniedEvent" })
export type LangLockOverrideDeniedEvent = Schema.Schema.Type<typeof LangLockOverrideDeniedEvent>

// exception_registered — an operator registered a schema-validated exemption (FR14, C16, AC9).
export const LangLockExceptionRegisteredEvent = Schema.Struct({
  type: Schema.Literal("langlock.exception_registered"),
  envelope: Envelope.LangLockEnvelope,
  detail: ExceptionDetail,
}).annotate({ identifier: "LangLockEvent.LangLockExceptionRegisteredEvent" })
export type LangLockExceptionRegisteredEvent = Schema.Schema.Type<typeof LangLockExceptionRegisteredEvent>

// exception_revoked — an operator revoked an exemption (FR14, C16).
export const LangLockExceptionRevokedEvent = Schema.Struct({
  type: Schema.Literal("langlock.exception_revoked"),
  envelope: Envelope.LangLockEnvelope,
  detail: ExceptionDetail,
}).annotate({ identifier: "LangLockEvent.LangLockExceptionRevokedEvent" })
export type LangLockExceptionRevokedEvent = Schema.Schema.Type<typeof LangLockExceptionRevokedEvent>

// --- events-advisory.cue: live enforcement/advisory members (nine; C8) ---

// policy_injected — the effective language was injected into a V1/V2 system prompt (FR17, C4, AC7).
export const LangLockPolicyInjectedEvent = Schema.Struct({
  type: Schema.Literal("langlock.policy_injected"),
  envelope: Envelope.LangLockEnvelope,
  detail: InjectionDetail,
}).annotate({ identifier: "LangLockEvent.LangLockPolicyInjectedEvent" })
export type LangLockPolicyInjectedEvent = Schema.Schema.Type<typeof LangLockPolicyInjectedEvent>

// policy_reapplied — the lock was reapplied after experimental.chat.system.transform (FR25, C4, AC7).
export const LangLockPolicyReappliedEvent = Schema.Struct({
  type: Schema.Literal("langlock.policy_reapplied"),
  envelope: Envelope.LangLockEnvelope,
  detail: InjectionDetail,
}).annotate({ identifier: "LangLockEvent.LangLockPolicyReappliedEvent" })
export type LangLockPolicyReappliedEvent = Schema.Schema.Type<typeof LangLockPolicyReappliedEvent>

// envelope_stamped — tag/version/source/mode were stamped onto an execution envelope (FR18, C4, AC4).
export const LangLockEnvelopeStampedEvent = Schema.Struct({
  type: Schema.Literal("langlock.envelope_stamped"),
  envelope: Envelope.LangLockEnvelope,
  detail: InjectionDetail,
}).annotate({ identifier: "LangLockEvent.LangLockEnvelopeStampedEvent" })
export type LangLockEnvelopeStampedEvent = Schema.Schema.Type<typeof LangLockEnvelopeStampedEvent>

// advisory_flagged — advisory detection flagged a language mismatch on classified prose (FR21, C5, C6, AC8).
export const LangLockAdvisoryFlaggedEvent = Schema.Struct({
  type: Schema.Literal("langlock.advisory_flagged"),
  envelope: Envelope.LangLockEnvelope,
  detail: AdvisoryDetail,
}).annotate({ identifier: "LangLockEvent.LangLockAdvisoryFlaggedEvent" })
export type LangLockAdvisoryFlaggedEvent = Schema.Schema.Type<typeof LangLockAdvisoryFlaggedEvent>

// advisory_acknowledged — an operator acknowledged a flagged advisory (FR21, C6, AC8).
export const LangLockAdvisoryAcknowledgedEvent = Schema.Struct({
  type: Schema.Literal("langlock.advisory_acknowledged"),
  envelope: Envelope.LangLockEnvelope,
  detail: AdvisoryDetail,
}).annotate({ identifier: "LangLockEvent.LangLockAdvisoryAcknowledgedEvent" })
export type LangLockAdvisoryAcknowledgedEvent = Schema.Schema.Type<typeof LangLockAdvisoryAcknowledgedEvent>

// advisory_suppressed — an operator suppressed a repeat advisory warning (FR21, C6, AC8).
export const LangLockAdvisorySuppressedEvent = Schema.Struct({
  type: Schema.Literal("langlock.advisory_suppressed"),
  envelope: Envelope.LangLockEnvelope,
  detail: AdvisoryDetail,
}).annotate({ identifier: "LangLockEvent.LangLockAdvisorySuppressedEvent" })
export type LangLockAdvisorySuppressedEvent = Schema.Schema.Type<typeof LangLockAdvisorySuppressedEvent>

// detector_unknown — the advisory detector returned unknown/failure; never blocks a hot path (FR21, C5).
export const LangLockDetectorUnknownEvent = Schema.Struct({
  type: Schema.Literal("langlock.detector_unknown"),
  envelope: Envelope.LangLockEnvelope,
  detail: AdvisoryDetail,
}).annotate({ identifier: "LangLockEvent.LangLockDetectorUnknownEvent" })
export type LangLockDetectorUnknownEvent = Schema.Schema.Type<typeof LangLockDetectorUnknownEvent>

// resolution_retained — a project override was not applied and the global value retained (FR5, C2, AC5).
export const LangLockResolutionRetainedEvent = Schema.Struct({
  type: Schema.Literal("langlock.resolution_retained"),
  envelope: Envelope.LangLockEnvelope,
  detail: ResolutionDetail,
}).annotate({ identifier: "LangLockEvent.LangLockResolutionRetainedEvent" })
export type LangLockResolutionRetainedEvent = Schema.Schema.Type<typeof LangLockResolutionRetainedEvent>

// unknown — an out-of-band or unrecognized langlock.* signal; envelope-only, never gates work (C8).
export const LangLockUnknownEvent = Schema.Struct({
  type: Schema.Literal("langlock.unknown"),
  envelope: Envelope.LangLockEnvelope,
}).annotate({ identifier: "LangLockEvent.LangLockUnknownEvent" })
export type LangLockUnknownEvent = Schema.Schema.Type<typeof LangLockUnknownEvent>

// --- events.cue: the closed tagged union of every vocabulary member ---

// LangLockEvent is the closed 15-member tagged union discriminated on `type` (C8).
export const LangLockEvent = Schema.Union([
  LangLockPolicySetEvent,
  LangLockPolicyResetEvent,
  LangLockOverrideAuthorizedEvent,
  LangLockOverrideDeniedEvent,
  LangLockExceptionRegisteredEvent,
  LangLockExceptionRevokedEvent,
  LangLockPolicyInjectedEvent,
  LangLockPolicyReappliedEvent,
  LangLockEnvelopeStampedEvent,
  LangLockAdvisoryFlaggedEvent,
  LangLockAdvisoryAcknowledgedEvent,
  LangLockAdvisorySuppressedEvent,
  LangLockDetectorUnknownEvent,
  LangLockResolutionRetainedEvent,
  LangLockUnknownEvent,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "LangLockEvent.LangLockEvent" })
export type LangLockEvent = Schema.Schema.Type<typeof LangLockEvent>
