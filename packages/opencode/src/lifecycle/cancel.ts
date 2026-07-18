/**
 * Feature 002 / T029 (S11) — native root-tree cancellation.
 *
 * The one cancel path (C17, FR59–FR62). Root-cancellation propagation and
 * acknowledgement are owned by the canonical native lifecycle API — the
 * `SessionRunCoordinator` root scope over the Event Bus and Process Table —
 * never an LLM, tool, prompt, or MCP call (FR61). This module drives that owner:
 *
 *   - FIRST Ctrl+C requests cancellation of the current active root tree,
 *     INCLUDING descendants not visible in the direct-child UI: it fences new
 *     descendant admission of that root (quarantine, AC30), then publishes one
 *     `lifecycle.cancel_requested` per target so every visible AND invisible
 *     descendant transitions through `cancelling` (the state machine drives
 *     `{queued,waiting,running} -> cancelling`, T017). Outcome `requested`.
 *   - A SECOND Ctrl+C WITHIN the escalation window forces a LOCAL abort of the
 *     root scope via `SessionRunCoordinator.interrupt` — never a blind terminal
 *     Esc, never a remote kill. Outcome `unconfirmed`: the local abort is issued
 *     but no remote kill, reversal, or mutation rollback is ever promised
 *     (FR62, AC10, AC32).
 *   - Ctrl+C on an idle root (no active targets) is a no-op: outcome `rejected`.
 *     Esc never cancels a root tree — that is the TUI's dismiss semantics (T036,
 *     FR60); this service exposes only the native cancel path.
 *
 * The service is pure and injectable: the caller (the Feature 007 operator
 * command, T031) resolves the root's target set from the Process Table and
 * supplies the coordinator interrupt key, so this module holds only the
 * per-root escalation clock and makes zero model calls.
 */
export * as Cancel from "./cancel"

import { Effect } from "effect"
import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import type { Values } from "@opencode-ai/schema/lifecycle/values"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type {
  EmitEnvelope,
  LifecycleEmitInput,
  LifecycleEmitOutput,
  LifecycleError,
  OperatorPrincipal,
} from "@opencode-ai/protocol/lifecycle/commands"

/** The narrow slice of `LifecyclePort` cancel publishes intents through (T025). */
export interface LifecycleEmitter {
  readonly emit: (input: LifecycleEmitInput) => Effect.Effect<LifecycleEmitOutput, LifecycleError>
}

/** The narrow slice of `SessionRunCoordinator` used for the forced local abort (C17). */
export interface RootInterruptor {
  readonly interrupt: (key: string) => Effect.Effect<void>
}

/** One descendant of the cancelled root, resolved from the Process Table by the caller. */
export interface CancelTarget {
  /** The target's emit envelope; its `process.root_process_id` selects the durable aggregate. */
  readonly envelope: EmitEnvelope
  /** Whether the target is a direct-child-UI-visible node; invisible descendants cancel too (AC29). */
  readonly visible: boolean
}

export interface RootCancelInput {
  readonly rootProcessId: Ids.RootProcessId
  /** The `SessionRunCoordinator` key for the active root run (forced-abort target). */
  readonly rootKey: string
  readonly principal: OperatorPrincipal
  readonly reason: Values.Reason | null
  /** Every active descendant of the root, visible and invisible (caller-resolved). */
  readonly targets: ReadonlyArray<CancelTarget>
}

/** Cancel outcomes (C17): local abort is distinct from effective remote cancellation. */
export type CancelOutcome = EnumsObservation.CancelOutcome

export interface RootCancelOutput {
  readonly outcome: CancelOutcome
  /** True when this was the second Ctrl+C within the window and a local abort was forced. */
  readonly escalated: boolean
  /** How many targets received a `cancel_requested` intent (0 on escalation/idle). */
  readonly requestedCount: number
  /** A bounded, redacted reason string for the audit trail (never a prompt/secret). */
  readonly auditReason: string
}

export interface CancelServiceDeps {
  readonly emitter: LifecycleEmitter
  readonly coordinator: RootInterruptor
  /** Fence new descendant admission of a root after a cancel request (AdmissionController.fence, AC30). */
  readonly fence: (rootProcessId: Ids.RootProcessId) => void
  /** Monotonic millisecond clock for the escalation window (default Date.now). */
  readonly clock?: () => number
  /** The provisional escalation window; a second Ctrl+C within it forces a local abort (C17). */
  readonly escalationWindowMs?: number
}

export interface CancelService {
  readonly requestRootCancel: (input: RootCancelInput) => Effect.Effect<RootCancelOutput, LifecycleError>
}

/** The provisional escalation window (data-model constant, fixed by the future ADR). */
export const DEFAULT_ESCALATION_WINDOW_MS = 3_000

const DEFAULT_REASON = "root_cancel" as Values.Reason

export function createCancelService(deps: CancelServiceDeps): CancelService {
  const clock = deps.clock ?? Date.now
  const escalationWindowMs = deps.escalationWindowMs ?? DEFAULT_ESCALATION_WINDOW_MS
  // Per-root timestamp of the last first-stage cancel request; drives the
  // first-versus-second Ctrl+C distinction within the escalation window (C17).
  const lastRequestAt = new Map<string, number>()

  const emitCancelRequested = (target: CancelTarget, reason: Values.Reason) =>
    deps.emitter.emit({
      envelope: target.envelope,
      eventType: "lifecycle.cancel_requested",
      data: { outcome: "requested", reason },
    })

  const requestRootCancel = (input: RootCancelInput): Effect.Effect<RootCancelOutput, LifecycleError> =>
    Effect.gen(function* () {
      const now = clock()
      const reason = input.reason ?? DEFAULT_REASON
      const prior = lastRequestAt.get(input.rootProcessId)
      const escalating = prior !== undefined && now - prior <= escalationWindowMs

      if (escalating) {
        // Second Ctrl+C within the window: force a LOCAL abort of the root scope.
        // No remote kill, reversal, or mutation rollback is promised (FR62).
        lastRequestAt.delete(input.rootProcessId)
        yield* deps.coordinator.interrupt(input.rootKey)
        return {
          outcome: "unconfirmed",
          escalated: true,
          requestedCount: 0,
          auditReason: "forced_local_abort",
        }
      }

      if (input.targets.length === 0) {
        // Idle root: Ctrl+C acts only when execution is active (C17) — a no-op.
        return {
          outcome: "rejected",
          escalated: false,
          requestedCount: 0,
          auditReason: "no_active_execution_in_root",
        }
      }

      // First Ctrl+C: fence new descendant admission, then request cancellation
      // of every active descendant (visible and invisible) via one intent each.
      deps.fence(input.rootProcessId)
      let requestedCount = 0
      for (const target of input.targets) {
        yield* emitCancelRequested(target, reason)
        requestedCount++
      }
      lastRequestAt.set(input.rootProcessId, now)

      return {
        outcome: "requested",
        escalated: false,
        requestedCount,
        auditReason: "root_cancel_requested",
      }
    })

  return { requestRootCancel }
}
