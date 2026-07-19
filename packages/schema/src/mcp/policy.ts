export * as Policy from "./policy"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/flags.cue one-to-one — the boolean posture
// ValueObjects, wrapped to keep bare booleans out of the aggregates (calisthenics)
// and to carry the C5/C6/C9 policy stances. A capability flag records only what the
// server advertised and is never exercised unless set (FR7, C2); an annotation hint
// is untrusted unless the trust profile elevates it (FR13a, C6); a policy opt-in
// gates re-read/reindex/wake off by default (FR23, C9); an operator-surfaced flag
// guarantees elicitation reaches the operator (FR47, C20). No flag carries content.
//
// The `TrustProfile` / `OutputSchemaMode` / `ResourceUpdatePolicy` policy enums this
// module governs live in ./enums and ./enums-state (one vocabulary, no duplication);
// this module composes only the boolean posture ValueObjects mirroring flags.cue.

// Enabled is the operator enable posture of a server, flag, or subscription (FR8, FR41).
export const Enabled = Schema.Boolean.annotate({ identifier: "McpFlags.Enabled" })
export type Enabled = typeof Enabled.Type

// Capable records a single negotiated server capability; never exercised unless true (FR7, C2).
export const Capable = Schema.Boolean.annotate({ identifier: "McpFlags.Capable" })
export type Capable = typeof Capable.Type

// Hint is an untrusted tool annotation hint; ignored for gating unless elevated (FR13a, C6).
export const Hint = Schema.Boolean.annotate({ identifier: "McpFlags.Hint" })
export type Hint = typeof Hint.Type

// Supported records task/resume support advertised by the server or SDK (FR29, FR42, C14, C18).
export const Supported = Schema.Boolean.annotate({ identifier: "McpFlags.Supported" })
export type Supported = typeof Supported.Type

// OperatorSurfaced guarantees an elicitation/input_required reached the operator UI (FR47, C20).
export const OperatorSurfaced = Schema.Boolean.annotate({ identifier: "McpFlags.OperatorSurfaced" })
export type OperatorSurfaced = typeof OperatorSurfaced.Type

// SensitiveBlocked records that sensitive-mode blocked a model-mediated answer (FR47, C20).
export const SensitiveBlocked = Schema.Boolean.annotate({ identifier: "McpFlags.SensitiveBlocked" })
export type SensitiveBlocked = typeof SensitiveBlocked.Type

// PolicyOptin gates a re-read/reindex/wake opt-in that is off by default (FR23, FR24, C9, C21, C22).
export const PolicyOptin = Schema.Boolean.annotate({ identifier: "McpFlags.PolicyOptin" })
export type PolicyOptin = typeof PolicyOptin.Type

// RateLimited records that a logging notification was dropped by the rate limit (FR28, C23).
export const RateLimited = Schema.Boolean.annotate({ identifier: "McpFlags.RateLimited" })
export type RateLimited = typeof RateLimited.Type

// Active records that a subscription or alias is the live one (FR21, C10).
export const Active = Schema.Boolean.annotate({ identifier: "McpFlags.Active" })
export type Active = typeof Active.Type

// Coalesced records that an update was merged into a bounded-queue frame (FR23, C9).
export const Coalesced = Schema.Boolean.annotate({ identifier: "McpFlags.Coalesced" })
export type Coalesced = typeof Coalesced.Type
