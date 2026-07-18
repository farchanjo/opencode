/**
 * Feature 002 / T028 (S11) — single-owner handoff coordination.
 *
 * The canonical run/session coordinator is the SOLE owner that records and
 * publishes a handoff (C16, FR22): this module is the one seam that emits a
 * single durable `lifecycle.handoff` event carrying both endpoints
 * (source/target session and process), the reason, the generation, and the
 * correlation/causation ids from the envelope. Because the event is durable and
 * single, BOTH permitted projections — the source Session and the target
 * Session, plus their permitted root tree — read that one event and render
 * identical fields (AC6); no second event and no per-projection divergence is
 * ever produced.
 *
 * The coordinator publishes through the injected `LifecyclePort.emit` seam
 * (T025), so the handoff commits atomically on the durable aggregate exactly
 * like every other durable member (C4). It holds no state, makes zero model
 * calls, and never mutates the Process Table directly (FR18).
 */
export * as Handoff from "./handoff"

import { Effect } from "effect"
import type { Values } from "@opencode-ai/schema/lifecycle/values"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type {
  EmitEnvelope,
  LifecycleEmitInput,
  LifecycleEmitOutput,
  LifecycleError,
} from "@opencode-ai/protocol/lifecycle/commands"

/** The narrow slice of `LifecyclePort` the coordinator emits through (T025). */
export interface LifecycleEmitter {
  readonly emit: (input: LifecycleEmitInput) => Effect.Effect<LifecycleEmitOutput, LifecycleError>
}

/** One side of a handoff, located by session and process (mirrors `HandoffEndpoint`). */
export interface HandoffEndpoint {
  readonly sessionId: Ids.SessionId
  readonly processId: Ids.ProcessId
}

/**
 * A handoff request. `envelope` is the source process's caller-supplied emit
 * envelope (its `process.root_process_id` selects the durable aggregate the
 * single event commits to). `source`/`target` populate the durable
 * `HandoffDetail` both projections read.
 */
export interface HandoffCommand {
  readonly envelope: EmitEnvelope
  readonly source: HandoffEndpoint
  readonly target: HandoffEndpoint
  readonly reason: Values.Reason
  readonly generation: Values.Generation
}

export interface HandoffCoordinator {
  /** Publish the one durable handoff event; returns its EventV2 id + durable position. */
  readonly handoff: (command: HandoffCommand) => Effect.Effect<LifecycleEmitOutput, LifecycleError>
}

export interface HandoffCoordinatorDeps {
  readonly emitter: LifecycleEmitter
}

function toDetail(command: HandoffCommand): Record<string, unknown> {
  return {
    source: { session_id: command.source.sessionId, process_id: command.source.processId },
    target: { session_id: command.target.sessionId, process_id: command.target.processId },
    reason: command.reason,
    generation: command.generation,
  }
}

export function createHandoffCoordinator(deps: HandoffCoordinatorDeps): HandoffCoordinator {
  const handoff = (command: HandoffCommand): Effect.Effect<LifecycleEmitOutput, LifecycleError> =>
    deps.emitter.emit({
      envelope: command.envelope,
      eventType: "lifecycle.handoff",
      data: toDetail(command),
    })

  return { handoff }
}
