/**
 * Feature 013 / T007 — the typed `budget.*` domain implementation backing the
 * Feature 007 operator control plane over `RoutingConfig.Enforcement.budget`
 * (FR4, FR7, FR8).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, and the reserved-name
 * guard; Feature 013 supplies ONLY this typed `BudgetPort` domain implementation
 * plus its audit events. This port registers NO command ids and makes ZERO
 * provider/model calls, tokens, or cost: `status`/`show` project the redacted,
 * bounded `BudgetSummary` the injected backend carries; `set`/`reset` are
 * optimistic CAS writes over the SAME routing Config.Service seam langlock uses,
 * each returning a Feature 007 audit-correlation id; `validate` reports validity
 * without mutating. The reserved `budget.status|show|set|reset|validate` ids already
 * live in the catalog at `RESERVED_CATALOG_VERSION` — no catalog bump is performed
 * and no id is added here.
 *
 * The backend seam (`BudgetBackend`) is the un-audited domain surface the live
 * composition injects over the reused `RoutingConfigPort` (`backend-live.ts`); the
 * bounded, secret-free operator access audit is emitted at the command-port seam,
 * which carries the Feature 007 principal for every command (`budget-command-port.ts`).
 */
export * as BudgetOperatorPort from "./budget-port"

import { Effect } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  BudgetError,
  BudgetResetInput,
  BudgetStatusInput,
  BudgetSummary,
  BudgetSetInput,
  BudgetValidateInput,
  BudgetValidateOutput,
} from "@opencode-ai/protocol/budget/commands"

// =============================================================================
// Audit sink — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a config payload/secret). */
export interface BudgetAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "invalid"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface BudgetAuditSink {
  readonly record: (event: BudgetAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Backend seam — the un-audited domain surface (backend-live.ts)
// =============================================================================

/**
 * The narrow domain seam the Feature 013 live composition provides over the reused
 * `RoutingConfigPort`. `resolve` returns the bounded redacted summary
 * (`budget.status`/`budget.show`); `planSet`/`planReset` VALIDATE and return an
 * `OperatorMutationPlan` (scoped routing authority + pure transform) the dispatcher
 * commits via `mutateAuthority` — the backend never self-commits; `validate`
 * reports validity without mutating.
 */
export interface BudgetBackend {
  readonly resolve: (input: BudgetStatusInput) => Effect.Effect<BudgetSummary, BudgetError>
  readonly planSet: (input: BudgetSetInput) => Effect.Effect<OperatorMutationPlan, BudgetError>
  readonly planReset: (input: BudgetResetInput) => Effect.Effect<OperatorMutationPlan, BudgetError>
  readonly validate: (input: BudgetValidateInput) => Effect.Effect<BudgetValidateOutput, BudgetError>
}
