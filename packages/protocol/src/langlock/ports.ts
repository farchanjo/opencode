/**
 * Feature 004 — Lang Lock application ports (T015).
 *
 * TypeScript mirror of the `LangLockPolicyPort`, `DetectionPort` and
 * `AdvisoryPort` inbound-port interfaces from
 * doc/arch/sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/contracts/ports.ts.
 * These interfaces are implemented by the domain policy/detection engine
 * (`packages/core/src/langlock/**`) and application adapters
 * (`packages/opencode/src/langlock/**`, `packages/opencode/src/operator/
 * langlock/**`), and are consumed by Feature 007 operator control-plane adapters
 * (Settings/CLI/TUI/palette/native-slash) per ADR-0003 and ADR-0005. Feature 004
 * never registers a parallel command registry, event bus, config store, or
 * translation authority (C2, C3, C8).
 *
 * Request/response payloads and typed error unions live in ./commands — this
 * file defines only the port method signatures.
 */

import type { Effect } from "effect"
import type {
  AdvisoryAckInput,
  AdvisoryAckOutput,
  AdvisoryError,
  AdvisoryListInput,
  AdvisoryListOutput,
  AdvisoryRecordInput,
  AdvisoryRecordOutput,
  DetectionClassifyInput,
  DetectionClassifyOutput,
  DetectionError,
  LangLockPolicyError,
  PolicyResetInput,
  PolicyResetOutput,
  PolicyResolveInput,
  PolicyResolveOutput,
  PolicySetInput,
  PolicySetOutput,
} from "./commands"

/**
 * Backs the reserved `langlock.status|show|set|reset` operator command surface
 * (C3, registered via Feature 007; Feature 004 supplies only these typed domain
 * implementations, ADR-0003). Global configuration is the base authority; a
 * project override applies only when `langlock.override` is authorized and never
 * relaxes the global hard-policy floor (FR5, FR34, Security 1, AC5-AC6). Session,
 * user, LLM, agent, plugin, MCP, and custom-command mutation is prohibited (FR6)
 * — this port has no unauthenticated or LLM-reachable entry point.
 */
export interface LangLockPolicyPort {
  /** Backs `langlock.status` and `langlock.show` (show-effective alias, C3); redacted, content-free (FR7, FR35). */
  readonly resolve: (input: PolicyResolveInput) => Effect.Effect<PolicyResolveOutput, LangLockPolicyError>

  /** Backs `langlock.set`; scope/CAS/idempotency/audit; override-gated for `project` scope (FR34, C2, AC5-AC6). */
  readonly set: (input: PolicySetInput) => Effect.Effect<PolicySetOutput, LangLockPolicyError>

  /** Backs `langlock.reset`; reverts to the global/default policy; CAS/idempotency/audit (FR34). */
  readonly reset: (input: PolicyResetInput) => Effect.Effect<PolicyResetOutput, LangLockPolicyError>
}

/**
 * Post-write advisory detection confined to confidently classified prose path
 * kinds (Markdown, docs, instruction files, generated commit text); generic
 * source code is never a detection target in V1 and a detector failure/unknown
 * outcome never blocks the prompt, execution, or tool hot path (FR16, FR20, FR21,
 * C5, C6, NFR Availability). This port never gates, blocks, or autotranslates a
 * write (Out of Scope).
 */
export interface DetectionPort {
  /** Classify one model-authored artifact context for a content-free advisory signal. */
  readonly classify: (input: DetectionClassifyInput) => Effect.Effect<DetectionClassifyOutput, DetectionError>
}

/**
 * Content-free advisory persistence and remediation follow-up, backing the
 * `advisory_flagged -> acknowledged | suppressed` branch of the advisory
 * lifecycle (plan.md "State machines"). Never gates a write; TUI/App/CLI
 * surfacing and repeat-warning suppression are plan-owned with acceptance hook
 * AC8.
 */
export interface AdvisoryPort {
  /** Record a content-free outcome produced by `DetectionPort.classify` (FR21). */
  readonly record: (input: AdvisoryRecordInput) => Effect.Effect<AdvisoryRecordOutput, AdvisoryError>

  /** Bounded, cursor-paginated, redacted advisory history for an authorized scope. */
  readonly list: (input: AdvisoryListInput) => Effect.Effect<AdvisoryListOutput, AdvisoryError>

  /** Operator/authorized-target acknowledge or repeat-warning suppress on a flagged advisory (C5, C6). */
  readonly ack: (input: AdvisoryAckInput) => Effect.Effect<AdvisoryAckOutput, AdvisoryError>
}
