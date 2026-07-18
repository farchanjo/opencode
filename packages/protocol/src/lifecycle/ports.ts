/**
 * Feature 002 — Application ports (T013).
 *
 * TypeScript mirror of the `LifecyclePort`, `ProcessPort` and
 * `ObservationPort` inbound-port interfaces from
 * doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/contracts/ports.ts.
 * These interfaces are implemented by the lifecycle domain engine
 * (`packages/core/src/lifecycle/**`) and application adapters
 * (`packages/opencode/src/lifecycle/**`), and are consumed by Feature 007
 * operator control-plane adapters (CLI/TUI/App) per ADR-0003. Feature 002
 * never registers a parallel command registry (C19).
 *
 * Request/response payloads and typed error unions live in ./commands —
 * this file defines only the port method signatures.
 */

import type { Effect, Scope, Stream } from "effect"
import type {
  LifecycleEmitInput,
  LifecycleEmitOutput,
  LifecycleError,
  LifecycleObservation,
  LifecycleProjectInput,
  LifecycleProjectOutput,
  LifecycleReplayInput,
  LifecycleReplayOutput,
  ObservationError,
  ObserveGlobalInput,
  ObserveProcessInput,
  ObserveSessionInput,
  ObserveTreeInput,
  ProcessCancelInput,
  ProcessCancelOutput,
  ProcessError,
  ProcessListInput,
  ProcessListOutput,
  ProcessObserveInput,
  ProcessReconcileInput,
  ProcessReconcileOutput,
  ProcessShowInput,
  ProcessShowOutput,
  ProcessTreeInput,
  ProcessTreeOutput,
} from "./commands"

// =============================================================================
// LifecyclePort — emit / project / replay
// =============================================================================

/**
 * Domain-internal port used by canonical executors, the projector, and the
 * restart/reconciliation seam. Never called by an Observable or the Process
 * Table itself (FR17, FR18, C11). EventV2 remains the single event authority;
 * this port is the bounded adaptation layer over it (C2, C3).
 */
export interface LifecyclePort {
  /**
   * Publish one lifecycle event through the canonical EventV2 bridge
   * (`publishLifecycleEvent` on `packages/opencode/src/event-v2-bridge.ts`,
   * mirroring `publishRoutingEvent`). Only canonical executors call this.
   * Durable events commit atomically via `EventV2.PublishOptions.commit(seq)`;
   * live events publish without a sequence (C4). Wire shape: events.cue.
   */
  readonly emit: (input: LifecycleEmitInput) => Effect.Effect<LifecycleEmitOutput, LifecycleError>

  /**
   * Apply one durable or live lifecycle event to the in-memory Process Table
   * projection. Idempotent, keyed on event id plus `(aggregateID, seq)` (C9,
   * FR23). Duplicate/out-of-order/unknown events are observable anomalies,
   * never a thrown error and never an invented terminal state (FR29).
   */
  readonly project: (input: LifecycleProjectInput) => Effect.Effect<LifecycleProjectOutput, LifecycleError>

  /**
   * Rebuild a Process Table scope (root or session) by replaying the EventV2
   * durable aggregate via `EventV2.readAggregate` and reconciling against
   * durable Sessions (C6, C13). Used on restart and on explicit
   * `ProcessPort.reconcile`. Rows without a live owner project as
   * `unknown`/`unreconciled`; no automatic effect retry (FR39, FR40, AC13).
   */
  readonly replay: (input: LifecycleReplayInput) => Effect.Effect<LifecycleReplayOutput, LifecycleError>
}

// =============================================================================
// ProcessPort — list / show / tree / observe / cancel / reconcile
// =============================================================================

/**
 * Operator-facing port backing the Feature 007 `process.*`/`task.*` command
 * IDs (C19). Feature 002 supplies only these typed domain implementations;
 * Feature 007 owns registration, authorization, CAS, idempotency, and audit.
 */
export interface ProcessPort {
  /** List processes within an authorized scope with bounded filters. Zero LLM calls. */
  readonly list: (input: ProcessListInput) => Effect.Effect<ProcessListOutput, ProcessError>

  /** Redacted single-process status: attempt, owner, model, timing, cost (`process.status`/`task.status`). */
  readonly show: (input: ProcessShowInput) => Effect.Effect<ProcessShowOutput, ProcessError>

  /**
   * Authorized root/session process tree, direct-child-only per Session view
   * (`process.tree`/`task.tree`, C22, FR58a). `ProcessTreeNode.childProcessIds`
   * lists direct children only at each projection level.
   */
  readonly tree: (input: ProcessTreeInput) => Effect.Effect<ProcessTreeOutput, ProcessError>

  /**
   * Live lifecycle stream for one process/task (`process.watch`/`task.watch`).
   * Delegates to `ObservationPort.observeProcess`; exposed here as the
   * Feature 007 command signature. Scoped, leak-free (C14, FR15).
   */
  readonly observe: (
    input: ProcessObserveInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ProcessError, Scope.Scope>

  /**
   * Native cancel request through canonical services (`process.cancel`/
   * `task.cancel`). Publishes audit + lifecycle events; never mutates the
   * Process Table directly (C17, FR51).
   */
  readonly cancel: (input: ProcessCancelInput) => Effect.Effect<ProcessCancelOutput, ProcessError>

  /**
   * Trigger explicit versioned reconciliation against durable Sessions for a
   * root or session scope (C13). Operator-only; no automatic retry of
   * effects is implied.
   */
  readonly reconcile: (input: ProcessReconcileInput) => Effect.Effect<ProcessReconcileOutput, ProcessError>
}

// =============================================================================
// ObservationPort — observeSession / observeProcess / observeTree / observeGlobal (C14)
// =============================================================================

/**
 * Read-only typed observation API over Effect Stream/PubSub with scoped
 * finalizers (FR14, FR15). The canonical Permission/Policy authority applies
 * authorization, filtering, and redaction before delivery; sibling and
 * cross-project leakage is a failure (FR11, FR12, AC3, AC4).
 */
export interface ObservationPort {
  /** Stream of a single Session's lifecycle events. */
  readonly observeSession: (
    input: ObserveSessionInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>

  /** Stream of one process's attempt events. */
  readonly observeProcess: (
    input: ObserveProcessInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>

  /** Stream of an authorized root tree; visibility filtered before delivery. */
  readonly observeTree: (
    input: ObserveTreeInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>

  /** Privileged operational stream with redaction; requires an operator principal (FR11, Security 1). */
  readonly observeGlobal: (
    input: ObserveGlobalInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>
}
