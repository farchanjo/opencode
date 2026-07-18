/**
 * Feature 001 — Routing protocol payloads.
 *
 * Mirrors RoutingPort from
 * doc/arch/sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/contracts/ports.ts
 * (evaluate/explain/test/capabilityInspect/status). One request/response pair
 * per operation, composed from the domain schemas under
 * @opencode-ai/schema/routing/* wherever the port contract reuses a domain
 * shape, plus locally-scoped protocol-only fields (e.g. explain's
 * string-typed candidateValue) where the port contract diverges from the
 * persisted domain record.
 */

import { Schema } from "effect"
import { Budget } from "@opencode-ai/schema/routing/budget"
import { Capability } from "@opencode-ai/schema/routing/capability"
import { Decision } from "@opencode-ai/schema/routing/decision"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import { Enums } from "@opencode-ai/schema/routing/enums"
import { Ids } from "@opencode-ai/schema/routing/ids"
import { PositiveInt } from "@opencode-ai/schema/schema"

// RoutingScope — evaluate/test operate at global, project or session scope.
export const RoutingScope = Budget.Scope.annotate({ identifier: "RoutingProtocol.RoutingScope" })
export type RoutingScope = typeof RoutingScope.Type

const NonNegativeFloat = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const UnitInterval = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))

// =============================================================================
// evaluate
// =============================================================================

export interface EvaluateRequest extends Schema.Schema.Type<typeof EvaluateRequest> {}
export const EvaluateRequest = Schema.Struct({
  sessionId: Ids.SessionId,
  turnId: Ids.TurnId,
  taskDescription: Schema.String,
  taskFingerprint: Ids.Fingerprint,
  scope: RoutingScope,
}).annotate({ identifier: "RoutingProtocol.EvaluateRequest" })

// The persisted RoutingDecision record, returned verbatim.
export const EvaluateResponse = Decision.RoutingDecision.annotate({
  identifier: "RoutingProtocol.EvaluateResponse",
})
export type EvaluateResponse = typeof EvaluateResponse.Type

// =============================================================================
// explain
// =============================================================================

export interface ExplainRequest extends Schema.Schema.Type<typeof ExplainRequest> {}
export const ExplainRequest = Schema.Struct({
  decisionId: Ids.DecisionId,
}).annotate({ identifier: "RoutingProtocol.ExplainRequest" })

export interface GateExplain extends Schema.Schema.Type<typeof GateExplain> {}
export const GateExplain = Schema.Struct({
  dimension: Ids.CapabilityDimension,
  passed: Decision.GatePassed,
  reason: Ids.Reason,
  requirement: Ids.Requirement,
  candidateValue: Schema.String,
}).annotate({ identifier: "RoutingProtocol.GateExplain" })

export interface CandidateExplain extends Schema.Schema.Type<typeof CandidateExplain> {}
export const CandidateExplain = Schema.Struct({
  agentId: Ids.AgentId,
  modelId: Ids.ModelId,
  passed: Decision.GatePassed,
  score: NonNegativeFloat,
  rank: PositiveInt,
  rejectionReasons: Schema.Array(Ids.Reason),
}).annotate({ identifier: "RoutingProtocol.CandidateExplain" })

export interface ExplainResponse extends Schema.Schema.Type<typeof ExplainResponse> {}
export const ExplainResponse = Schema.Struct({
  decisionId: Ids.DecisionId,
  taskClass: Enums.TaskClass,
  routingProfile: Enums.RoutingProfile,
  gates: Schema.Array(GateExplain),
  candidates: Schema.Array(CandidateExplain),
  scoreBreakdown: Schema.Record(Schema.String, NonNegativeFloat),
  decisionModelCalled: Schema.Boolean,
  selectedAgent: Ids.AgentId,
  selectedModel: Ids.ModelId,
  fallbackAttempted: Decision.FallbackAttempted,
  fallbackReason: Schema.NullOr(Ids.Reason),
  confidence: UnitInterval,
  redacted: Schema.Literal(true),
}).annotate({ identifier: "RoutingProtocol.ExplainResponse" })

// =============================================================================
// test
// =============================================================================

export interface TestRequest extends Schema.Schema.Type<typeof TestRequest> {}
export const TestRequest = Schema.Struct({
  taskDescription: Schema.String,
  scope: RoutingScope,
}).annotate({ identifier: "RoutingProtocol.TestRequest" })

export interface TestResponse extends Schema.Schema.Type<typeof TestResponse> {}
export const TestResponse = Schema.Struct({
  taskClass: Enums.TaskClass,
  routingProfile: Enums.RoutingProfile,
  authorizedCandidates: Schema.Array(CandidateExplain),
  hardGateSummary: Schema.Array(GateExplain),
  budgetPolicy: Budget.Policy,
  noExternalModelCall: Schema.Literal(true),
  redacted: Schema.Literal(true),
}).annotate({ identifier: "RoutingProtocol.TestResponse" })

// =============================================================================
// capabilityInspect
// =============================================================================

export interface CapabilityInspectRequest extends Schema.Schema.Type<typeof CapabilityInspectRequest> {}
export const CapabilityInspectRequest = Schema.Struct({
  modelId: Schema.optional(Ids.ModelId),
}).annotate({ identifier: "RoutingProtocol.CapabilityInspectRequest" })

export interface CapabilityInspectResponse extends Schema.Schema.Type<typeof CapabilityInspectResponse> {}
export const CapabilityInspectResponse = Schema.Struct({
  records: Schema.Array(Capability.Record),
  redacted: Schema.Literal(true),
}).annotate({ identifier: "RoutingProtocol.CapabilityInspectResponse" })

// =============================================================================
// status
// =============================================================================

export interface StatusRequest extends Schema.Schema.Type<typeof StatusRequest> {}
export const StatusRequest = Schema.Struct({}).annotate({ identifier: "RoutingProtocol.StatusRequest" })

export const RoutingHealth = Schema.Literals(["ok", "degraded", "unavailable"] as const).annotate({
  identifier: "RoutingProtocol.RoutingHealth",
})
export type RoutingHealth = typeof RoutingHealth.Type

export interface StatusResponse extends Schema.Schema.Type<typeof StatusResponse> {}
export const StatusResponse = Schema.Struct({
  enabled: Schema.Boolean,
  mode: RoutingConfig.RoutingMode,
  strictGates: Schema.Boolean,
  decisionModelPool: Schema.Array(Ids.ModelId),
  rolePools: Schema.Record(Schema.String, Schema.Array(Ids.ModelId)),
  catalogVersion: Ids.CatalogVersion,
  policyVersion: Ids.PolicyVersion,
  health: RoutingHealth,
  reason: Schema.NullOr(Ids.Reason),
  recommendedAction: Schema.NullOr(Schema.String),
  offline: Decision.Offline,
}).annotate({ identifier: "RoutingProtocol.StatusResponse" })

// =============================================================================
// RoutingError — tagged union mirroring RoutingPort's RoutingError.
// =============================================================================

export const RoutingError = Schema.Union([
  Schema.Struct({ type: Schema.Literal("no_authorized_candidate"), reason: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("catalog_mismatch"),
    decisionId: Ids.DecisionId,
    catalogVersion: Ids.CatalogVersion,
  }),
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("invalid_argument"), field: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("not_implemented") }),
]).annotate({ identifier: "RoutingProtocol.RoutingError" })
export type RoutingError = typeof RoutingError.Type
