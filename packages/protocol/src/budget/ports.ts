/**
 * Feature 013 — Budget application port (T003).
 *
 * TypeScript mirror of the budget-domain inbound port for the reserved
 * `budget.status|show|set|reset|validate` operator command surface (enums.cue
 * #BudgetVerb). The interface is implemented by the Feature 013 budget domain
 * stack (`packages/opencode/src/operator/budget/**`) over
 * `RoutingConfig.Enforcement.budget`, and is consumed by Feature 007 operator
 * control-plane adapters (Settings/CLI/TUI/palette/native-slash) per ADR-0003
 * and ADR-0013. Feature 013 registers no parallel command registry, no second
 * config store, and no new dispatch path — Feature 007 remains the sole
 * registration authority (FR9, FR11).
 *
 * Request/response payloads and the typed `BudgetError` union live in ./commands
 * — this file defines only the port method signatures.
 */

import type { Effect } from "effect"
import type {
  BudgetError,
  BudgetResetInput,
  BudgetResetOutput,
  BudgetSetInput,
  BudgetSetOutput,
  BudgetShowInput,
  BudgetShowOutput,
  BudgetStatusInput,
  BudgetStatusOutput,
  BudgetValidateInput,
  BudgetValidateOutput,
} from "./commands"

/**
 * Backs the reserved `budget.*` operator command surface over
 * `RoutingConfig.Enforcement.budget` seeded from `DEFAULT_ROUTING_BUDGET`
 * (registered via Feature 007; Feature 013 supplies only this typed domain
 * implementation, ADR-0003). Reads project the bounded, redacted limits view;
 * `set`/`reset` are optimistic CAS writes over the SAME routing Config.Service
 * seam langlock uses, and the hard ceiling is never silently relaxed (FR4, FR7).
 * Every failure path degrades to the typed `BudgetError` envelope, never a
 * fabricated success (FR8) — this port has no unauthenticated or LLM-reachable
 * entry point.
 */
export interface BudgetPort {
  /** Backs `budget.status`; redacted effective limits summary and Config.Service version (FR4). */
  readonly status: (input: BudgetStatusInput) => Effect.Effect<BudgetStatusOutput, BudgetError>

  /** Backs `budget.show`; the bounded effective limits view over the routing budget (FR4). */
  readonly show: (input: BudgetShowInput) => Effect.Effect<BudgetShowOutput, BudgetError>

  /** Backs `budget.set`; CAS write of the bounded limits; audit correlation; never relaxes the ceiling (FR4, FR7). */
  readonly set: (input: BudgetSetInput) => Effect.Effect<BudgetSetOutput, BudgetError>

  /** Backs `budget.reset`; CAS write reverting to `DEFAULT_ROUTING_BUDGET`; audit correlation (FR4, FR7). */
  readonly reset: (input: BudgetResetInput) => Effect.Effect<BudgetResetOutput, BudgetError>

  /** Backs `budget.validate`; reports validity over the effective config without mutating (FR4). */
  readonly validate: (input: BudgetValidateInput) => Effect.Effect<BudgetValidateOutput, BudgetError>
}
