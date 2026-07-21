export * as NarrowingConfig from "./narrowing-config"

import { Schema } from "effect"
import { Enabled } from "./text-values"
import { LatencyBudgetMs } from "./values"

// Mirrors doc/arch/schemas/wire-live-per-turn-semantic-narrowing-of-agents-skills-and.cue
// (package semantic.livequery) for the Feature 051 live per-turn narrowing config
// over the agents and skills surfaces. The tools surface is NOT duplicated here — it
// reuses the Feature 009 `tool_search` per-surface gate unchanged (spec FR6, T001).
// Every gate defaults to the full-set passthrough floor: absent, or every gate `false`,
// resolves byte-identically to pre-Feature-051 behavior (FR6, AC7).

// NarrowingSurfaceGate is the per-surface enable flag for one live-narrowing seam
// (agents or skills). Mirrors the Feature 009 `ToolSurfaceConfig` `enabled` convention:
// default false = a disabled surface short-circuits before any embedding/Milvus I/O (FR6).
export const NarrowingSurfaceGate = Schema.Struct({
  enabled: Enabled, // default false (FR6)
}).annotate({ identifier: "SemanticConfig.NarrowingSurfaceGate" })
export type NarrowingSurfaceGate = Schema.Schema.Type<typeof NarrowingSurfaceGate>

// SemanticNarrowingConfig is the top-level Feature 051 live-narrowing config. `agents`
// and `skills` each gate their surface independently (default off, resolved via
// `resolveNarrowingConfig`); `min_prompt_length` is the degenerate-input threshold below
// which a turn reuses the prior memo instead of embedding (FR2); `debug_log` opts into a
// content-free per-surface kept/dropped id log (FR8, default off). The shared per-turn
// deadline reuses the Feature 009 `latency_budget_ms` knob — never a second constant (FR1).
export const SemanticNarrowingConfig = Schema.Struct({
  agents: Schema.optional(NarrowingSurfaceGate),
  skills: Schema.optional(NarrowingSurfaceGate),
  min_prompt_length: Schema.optional(Schema.Number),
  latency_budget_ms: Schema.optional(LatencyBudgetMs),
  debug_log: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SemanticConfig.SemanticNarrowingConfig" })
export type SemanticNarrowingConfig = Schema.Schema.Type<typeof SemanticNarrowingConfig>
