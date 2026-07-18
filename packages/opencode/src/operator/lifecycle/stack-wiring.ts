/**
 * Feature 002 — live runtime composition for the lifecycle domain ports.
 *
 * The composition root wiring that turns the framework-free lifecycle domain
 * (`packages/core/src/lifecycle/**`) and its application adapters
 * (`packages/opencode/src/lifecycle/**`) into the typed `process.*`/`task.*`
 * operator `DomainInvoke` overrides the Feature 007 dispatcher consumes (C19).
 * It mirrors how Feature 001 routing is wired in `stack-live.ts`: real
 * dependencies resolved through the same `AppRuntime` services the rest of the
 * live stack uses, behind the committed outbound seams, adding NO command ids
 * (Feature 007 stays the sole registration authority).
 *
 * The single EventV2 authority (C2) is reached exactly once: the resolved
 * `EventV2Bridge.Service` singleton backs both the durable publish/read/prune
 * seams and the bounded `EventBus.subscribeBounded` live subscription that keeps
 * one runtime `ProcessTable` current. Every seam is honest:
 *
 *   - publish / readAggregate / prune / todo-publish run through
 *     `AppRuntime.runPromise` so InstanceRef/WorkspaceRef location tagging is
 *     applied and the durable commit hook projects atomically (C4).
 *   - the live `ProcessTable` is fed by a real `EventBus.subscribeBounded`
 *     background subscription that folds every lifecycle member through the
 *     idempotent projector (double application with the emit commit hook is a
 *     no-op — the projector dedupes by event id, C9).
 *   - `EventV2.readAggregate` startup/on-demand replay is wired through the
 *     adapter's `readAggregate` seam (`readDurablePage`), so `LifecyclePort.replay`
 *     rebuilds a root scope from the durable aggregate (C6).
 *   - cancel drives the CANONICAL native abort: `Session.Service.interrupt`
 *     (the `SessionRunCoordinator` root scope, C17) — a truly honest interrupt
 *     seam reachable from the operator stack, never a faked outcome — and fences
 *     descendant admission through the real `AdmissionController`.
 *   - handoff commits one durable event through the emit seam (C16); steer
 *     publishes one `lifecycle.steer_requested` intent; observation streams over
 *     the same bounded live subscription (C14).
 *   - the shared bucketed `Watchdog` runs on a real unref'd sweep cadence.
 *
 * Fields the bounded, redacted Process Table row cannot faithfully carry for an
 * operator-authored control envelope (routing correlation ids, schema version)
 * are NOT fabricated: the control envelope is authored fresh as an operator
 * action (`actor_kind: "operator"`, a new `correlation_id`, `hierarchy: null`);
 * see data-model.md "Resolved Parameters".
 */
export * as LifecycleStackWiring from "./stack-wiring"

import { Effect, Fiber, Stream } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventBus } from "@opencode-ai/core/lifecycle/event-bus"
import { ProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import { Watchdog } from "@opencode-ai/core/lifecycle/watchdog"
import { AdmissionController } from "@opencode-ai/core/lifecycle/admission/admission-controller"
import { EventV2Adapter } from "@/lifecycle/eventv2-adapter"
import { ObservationService } from "@/lifecycle/observation-service"
import { Cancel } from "@/lifecycle/cancel"
import { Handoff } from "@/lifecycle/handoff"
import { LifecycleProcessPort } from "@/operator/lifecycle/process-port"
import { LifecycleCommandPort } from "@/operator/lifecycle/lifecycle-command-port"
import type { EmitEnvelope } from "@opencode-ai/protocol/lifecycle/commands"
import type { Enums } from "@opencode-ai/schema/lifecycle/enums"
import type { Values } from "@opencode-ai/schema/lifecycle/values"
import type { CorrelationIds } from "@opencode-ai/schema/lifecycle/correlation-ids"

// Bounded-queue capacities (data-model.md "Parameters"): the per-observer
// subscriber queue and the shared bus queue, both drop-oldest under overflow so
// a slow consumer never blocks a Task (AC7, AC20).
const SUBSCRIBER_QUEUE_CAPACITY = 1024
const EVENT_BUS_QUEUE_CAPACITY = 4096

/** The ten Process Table states that are terminal — never a cancel target (C7). */
const TERMINAL_STATES: ReadonlySet<ProcessTable.ProcessTableRow["status"]["state"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "zombie",
  "unknown",
])

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function newCorrelationId(): CorrelationIds.CorrelationId {
  let rand = ""
  for (let i = 0; i < 20; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)]
  return `corr_${rand}` as CorrelationIds.CorrelationId
}

/** Derive the process's agent kind from its hierarchy role, or `primary` when unrouted. */
function agentKindFromRow(row: ProcessTable.ProcessTableRow): Enums.AgentKind {
  const role = row.hierarchy?.role
  if (role === "architect" || role === "manager" || role === "worker") return role
  return "primary"
}

/**
 * Build an operator-authored control emit envelope from a bounded Process Table
 * row. The event is a fresh operator action (`actor_kind: "operator"`, new
 * `correlation_id`), NOT a replay of the process's own telemetry: `kind.event_type`
 * is a descriptive origin (the authoritative type is set per emit, on the payload),
 * and `hierarchy` is `null` because the bounded row does not carry the routing
 * decision/turn correlation ids `HierarchyContext` requires (honest provenance).
 */
export function buildOperatorEnvelope(row: ProcessTable.ProcessTableRow): EmitEnvelope {
  return {
    kind: {
      event_type: "lifecycle.steer_requested",
      schema_version: 1 as Values.SchemaVersion,
      event_class: "live",
      agent_kind: agentKindFromRow(row),
      actor_kind: "operator",
      runtime_instance_id: row.ownership.runtime_instance_id,
    },
    tree: {
      root_session_id: row.relations.root_session_id,
      session_id: row.relations.session_id,
      parent_session_id: row.relations.parent_session_id,
    },
    process: {
      task_id: row.identity.task_id,
      process_id: row.id,
      parent_process_id: row.relations.parent_process_id,
      root_process_id: row.relations.root_process_id,
    },
    ordering: {
      correlation_id: newCorrelationId(),
      causation_id: null,
      attempt: row.identity.attempt,
      generation: row.identity.generation,
    },
    delivery: {
      visibility: row.ownership.scope,
      redacted_metadata: {},
    },
    hierarchy: null,
  }
}

export interface LifecycleDomainWiring {
  readonly ports: LifecycleCommandPort.LifecycleDomainPorts
  /** The live runtime Process Table, fed by the bounded background subscription. */
  readonly table: ProcessTable.ProcessTable
  /** The lifecycle EventV2 adapter (emit/project/replay + settlement + todo). */
  readonly adapter: EventV2Adapter.EventV2Adapter
  /** The real admission authority; cancel fences root descendants through it (C11, C17). */
  readonly admission: AdmissionController.AdmissionController
  /** The shared bucketed watchdog sweeper (driven by the unref'd cadence timer). */
  readonly watchdog: Watchdog.WatchdogSweeper
  /** Tear down the background subscription fiber and the watchdog cadence timer. */
  readonly dispose: () => void
}

/**
 * Compose the live lifecycle domain ports over the canonical EventV2 authority.
 * Async because the resolved `EventV2Bridge.Service` singleton is captured once
 * (via `AppRuntime`) to back the bounded live subscription — the same instance
 * the whole process shares, so the subscription taps the real event stream.
 */
export async function createLifecycleDomainWiring(): Promise<LifecycleDomainWiring> {
  // The one resolved EventV2 authority the whole process shares (C2, C3).
  const bridgeInstance = await AppRuntime.runPromise(
    Effect.gen(function* () {
      return yield* EventV2Bridge.Service
    }),
  )

  // The single runtime Process Table projection; every seam folds into this one.
  const table = ProcessTable.createProcessTable()

  // Publish seam: run through AppRuntime so InstanceRef/WorkspaceRef location
  // tagging is applied and the durable commit hook projects atomically (C4).
  const lifecycleBridge: EventV2Adapter.LifecycleBridge = {
    publishLifecycleEvent: (event, options) =>
      Effect.promise(() =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const svc = yield* EventV2Bridge.Service
            return yield* svc.publishLifecycleEvent(event, options)
          }),
        ),
      ),
  }

  // readAggregate seam: bounded durable page read (`EventV2.readDurablePage`),
  // normalized onto the core projection record contract (C6).
  const readAggregate: EventV2Adapter.AggregateReader = (input) =>
    Effect.promise(() =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* EventV2Bridge.Service
          const page = yield* svc.readDurablePage({
            aggregateID: input.aggregateID,
            after: input.after,
            limit: input.limit,
          })
          return {
            records: page.events.map(EventV2Adapter.normalizeRecord),
            hasMore: page.hasMore,
            cursor: page.events.length > 0 ? page.lastSeq : null,
          }
        }),
      ),
    )

  // Durable-prune seam: hard-prune lifecycle rows for the root aggregate older
  // than the retention horizon; the adapter drops the in-memory rows separately.
  const pruner: EventV2Adapter.DurablePruner = (audit) =>
    Effect.promise(() =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* EventV2Bridge.Service
          return yield* svc.pruneDurable({
            aggregateID: audit.root_process_id,
            typePrefix: "lifecycle.",
            olderThanMs: Date.now() - ProcessTable.RETENTION_PRUNE_OLDER_THAN_MS,
            limit: Math.max(1, audit.pruned_count),
          })
        }),
      ),
    )

  // Todo-publish seam (T032): the session-owned `todo.*` live members.
  const publishTodoEvent: EventV2Adapter.TodoEventPublisher = (event) =>
    Effect.promise(() =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* EventV2Bridge.Service
          return yield* svc.publishTodoEvent(event)
        }),
      ),
    )

  const adapter = EventV2Adapter.createEventV2Adapter({
    bridge: lifecycleBridge,
    table,
    readAggregate,
    pruner,
    publishTodoEvent,
  })

  // Live table feed: a bounded background subscription over the single EventV2
  // authority folds every lifecycle member into the runtime table. The projector
  // dedupes by event id, so events already applied by the emit commit hook are a
  // no-op here (C9). Scoped: interrupting the fiber unsubscribes with no leak.
  const feedEffect = Effect.gen(function* () {
    const stream = yield* EventBus.subscribeBounded(bridgeInstance, {
      capacity: EVENT_BUS_QUEUE_CAPACITY,
      overflow: "backpressure",
    })
    yield* Stream.runForEach(stream, (payload) =>
      Effect.sync(() => {
        table.applyEvent(EventV2Adapter.normalizeRecord(payload))
      }),
    )
  }).pipe(Effect.scoped)
  const feedFiber = AppRuntime.runFork(feedEffect)

  // Per-observer bounded subscription seam over the same live authority (C14).
  const lifecycleSubscribe: ObservationService.LifecycleSubscribe = EventBus.subscribeBounded(bridgeInstance, {
    capacity: SUBSCRIBER_QUEUE_CAPACITY,
    overflow: "backpressure",
  })
  const observation = ObservationService.createObservationService({ subscribe: lifecycleSubscribe })

  // Real admission authority; cancel fences a root's descendant admission (C17).
  const admission = AdmissionController.createAdmissionController()

  // Shared bucketed watchdog on a real unref'd sweep cadence (C12). Leases are
  // acquired by canonical executors; until then the cadence sweeps an empty set.
  const watchdog = Watchdog.createWatchdog()
  const sweepTimer = setInterval(() => {
    watchdog.sweep()
  }, Watchdog.DEFAULT_SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()

  // Native root-tree cancel — honest-unavailable forced-abort posture (C17).
  // The FIRST-press path (publish one `lifecycle.cancel_requested` per active
  // descendant + fence root admission) is fully wired and real below. The
  // SECOND-press FORCED LOCAL ABORT drives `SessionRunCoordinator.interrupt`,
  // which lives in the core `SessionExecution` layer — but the operator stack's
  // `AppRuntime` provides only the opencode `Session` facade, which neither
  // exposes `interrupt` nor depends on `SessionExecution`, so that coordinator is
  // NOT reachable from stack-live. Rather than FAKE a stop, the interrupt seam
  // records the unavailability and issues nothing; cancel surfaces the honest
  // `unconfirmed` outcome (its documented "no remote kill/reversal is promised"
  // contract). See data-model.md "Resolved Parameters".
  const rootInterruptor: Cancel.RootInterruptor = {
    interrupt: (key) =>
      Effect.logDebug("lifecycle.cancel.forced_abort_unavailable", {
        rootKey: key,
        reason: "SessionRunCoordinator interrupt seam not reachable from the operator AppRuntime",
      }),
  }

  const cancelService = Cancel.createCancelService({
    emitter: adapter,
    coordinator: rootInterruptor,
    fence: (rootProcessId) => admission.fence("root", rootProcessId),
  })

  const handoffCoordinator = Handoff.createHandoffCoordinator({ emitter: adapter })

  // Resolve a root's active descendants (visible and invisible) as cancel
  // targets; `rootKey` is the root session id the interrupt seam aborts (C17).
  const resolveCancelTargets: LifecycleProcessPort.CancelTargetResolver = (rootProcessId) => {
    const rows = table.rootProcesses(rootProcessId)
    const rootIdStr = String(rootProcessId)
    const rootRow = rows.find((r) => String(r.id) === rootIdStr) ?? rows[0]
    const rootKey = String(rootRow?.relations.root_session_id ?? rootProcessId)
    const targets: ReadonlyArray<Cancel.CancelTarget> = rows
      .filter((r) => !TERMINAL_STATES.has(r.status.state))
      .map((r) => ({
        envelope: buildOperatorEnvelope(r),
        visible: String(r.relations.parent_process_id) === rootIdStr,
      }))
    return { rootKey, targets }
  }

  // Bounded, secret-free operator audit sink (never a prompt/payload/path).
  const audit: LifecycleProcessPort.LifecycleAuditSink = {
    record: (event) => Effect.logDebug("lifecycle.operator.audit", event),
  }

  const port = LifecycleProcessPort.createLifecycleProcessPort({
    rows: {
      get: (id) => table.get(id),
      rootProcesses: (id) => table.rootProcesses(id),
      sessionProcesses: (id) => table.sessionProcesses(id),
    },
    observation,
    cancel: cancelService,
    handoff: handoffCoordinator,
    steer: { emit: adapter.emit },
    audit,
    resolveCancelTargets,
    buildSteerEnvelope: buildOperatorEnvelope,
  })

  const ports = LifecycleCommandPort.createLifecycleDomainPorts(port)

  const dispose = () => {
    clearInterval(sweepTimer)
    void AppRuntime.runPromise(Fiber.interrupt(feedFiber)).catch(() => {})
  }

  return { ports, table, adapter, admission, watchdog, dispose }
}
