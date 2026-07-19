/**
 * Feature 008 / T014 (S6) — the MCP connection-lifecycle state machine.
 *
 * Encodes exactly the closed `configured → connecting → negotiating → recording →
 * connected` machine with the additive terminal branches `disabled`/`failed`/
 * `needs_auth`/`needs_client_registration` drawn in `plan.md` "State machines" and
 * `data-model.md` (FR7, FR8, C2). The machine is pure: it maps a `(state, trigger)`
 * pair to a typed `TransitionResult` and never performs I/O, mirroring
 * `packages/core/src/semantic/binding-lifecycle.ts` and
 * `packages/core/src/langlock`. An illegal pair surfaces as an observable anomaly
 * rather than throwing. The SDK client, transports, clock, config and event
 * publish all live behind injected `packages/opencode` seams — none of this hot
 * logic touches a socket.
 *
 * Semantics faithful to the statechart:
 *   - `connect` attaches the transport (`configured → connecting`).
 *   - `negotiate` runs initialize/protocol negotiation (`connecting → negotiating`).
 *   - `exchange` captures the advertised capability set (`negotiating → recording`).
 *   - `record` commits the recorded set (`recording → connected`).
 *   - `unauthorized`/`registration_required` reach the auth terminal branches.
 *   - a Streamable HTTP `drop` enters `reconnecting`; `resume` re-runs negotiation
 *     under backoff; `max_attempts` reaches `failed`; a stdio `restart` returns to
 *     `connecting` with no backoff (the reconnect curve lives in `reconnect-planner`).
 *   - `disable`/`fail` reach the operator/unrecoverable terminals.
 *
 * A capability the server never advertised is never exercised (`capabilityAdvertised`),
 * and a reconnect that re-records a differing capability set signals
 * `mcp.server.capabilities_changed` (`shouldEmitCapabilitiesChanged`), never mutating
 * or substituting the recorded set silently (FR7, FR8, C2).
 */
export * as ConnectionLifecycle from "./connection-lifecycle"

import type { ConnectionState, TerminalBranch } from "@opencode-ai/schema/mcp/enums-state"

export type { ConnectionState, TerminalBranch }

/** The full lifecycle state: the six live states plus the four terminal branches (C2). */
export type LifecycleState = ConnectionState | TerminalBranch

/** The non-terminal connection states, in statechart order (C2). */
export const CONNECTION_STATES = [
  "configured",
  "connecting",
  "negotiating",
  "recording",
  "connected",
  "reconnecting",
] as const satisfies ReadonlyArray<ConnectionState>

/** The four additive terminal branches (C2). */
export const TERMINAL_BRANCHES = [
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
] as const satisfies ReadonlyArray<TerminalBranch>

const TERMINAL_SET: ReadonlySet<LifecycleState> = new Set<LifecycleState>(TERMINAL_BRANCHES)

/** True once the lifecycle has reached a closed terminal branch (C2). */
export const isTerminal = (state: LifecycleState): state is TerminalBranch => TERMINAL_SET.has(state)

/** The closed trigger vocabulary driving the lifecycle machine (statechart labels, C2). */
export type Trigger =
  | "connect"
  | "negotiate"
  | "exchange"
  | "record"
  | "unauthorized"
  | "registration_required"
  | "drop"
  | "resume"
  | "max_attempts"
  | "stdio_restart"
  | "disable"
  | "fail"

/**
 * The legal transition table — exactly the labeled edges of the statechart. There
 * is no self-loop; a reconnect returns through `negotiating` so the capability set
 * is always re-recorded (C2). No edge auto-substitutes a server or capability.
 */
export const TRANSITIONS: Readonly<Record<ConnectionState, Readonly<Partial<Record<Trigger, LifecycleState>>>>> =
  Object.freeze({
    configured: Object.freeze({ connect: "connecting", disable: "disabled" }),
    connecting: Object.freeze({ negotiate: "negotiating", unauthorized: "needs_auth", fail: "failed" }),
    negotiating: Object.freeze({
      exchange: "recording",
      registration_required: "needs_client_registration",
      unauthorized: "needs_auth",
      fail: "failed",
    }),
    recording: Object.freeze({ record: "connected", fail: "failed" }),
    connected: Object.freeze({ drop: "reconnecting", stdio_restart: "connecting", disable: "disabled", fail: "failed" }),
    reconnecting: Object.freeze({ resume: "negotiating", max_attempts: "failed", disable: "disabled" }),
  })

/** The outcome of applying a trigger to a lifecycle state (never thrown). */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: LifecycleState; readonly to: LifecycleState; readonly trigger: Trigger }
  | { readonly kind: "illegal"; readonly from: LifecycleState; readonly trigger: Trigger }

const transition = (from: LifecycleState, to: LifecycleState, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, trigger })
const illegal = (from: LifecycleState, trigger: Trigger): TransitionResult => Object.freeze({ kind: "illegal", from, trigger })

/** The initial pseudo-state trigger: `[*] --config load--> configured`. */
export const INITIAL: ConnectionState = "configured"

/**
 * Apply a trigger to a lifecycle state and return the typed outcome. Pure and
 * total: every `(state, trigger)` pair resolves to `transition` or `illegal` and
 * the machine never throws (FR7, C2). A terminal branch accepts no further trigger.
 */
export const apply = (state: LifecycleState, trigger: Trigger): TransitionResult => {
  if (isTerminal(state)) return illegal(state, trigger)
  const next = TRANSITIONS[state][trigger]
  return next !== undefined ? transition(state, next, trigger) : illegal(state, trigger)
}

/**
 * The per-server capability set recorded at `recording`. `protocol_version` is the
 * negotiated version and `flags` records exactly what the server advertised — a
 * false/absent flag is a capability that is never exercised (FR7, FR8, C2).
 */
export interface RecordedCapabilities {
  readonly protocol_version: string
  readonly flags: Readonly<Record<string, boolean>>
}

/**
 * Whether the server advertised `capability` in its recorded set. The domain gates
 * every capability call through this so an unadvertised capability is never
 * exercised (FR7, C2). An absent flag is treated as not advertised.
 */
export const capabilityAdvertised = (caps: RecordedCapabilities, capability: string): boolean =>
  caps.flags[capability] === true

/** The bounded, content-free capability diff between two recorded sets (C2). */
export interface CapabilityDiff {
  readonly protocol_changed: boolean
  /** Flags newly advertised in `next` (false/absent in `prev`, true in `next`). */
  readonly added: ReadonlyArray<string>
  /** Flags withdrawn in `next` (true in `prev`, false/absent in `next`). */
  readonly removed: ReadonlyArray<string>
}

/**
 * Diff two recorded capability sets. Because a recorded flag is boolean, a flip is
 * exactly `added` (newly advertised) or `removed` (withdrawn); a differing protocol
 * version sets `protocol_changed`. Pure and deterministic (C2).
 */
export const diffCapabilities = (prev: RecordedCapabilities, next: RecordedCapabilities): CapabilityDiff => {
  const names = new Set<string>([...Object.keys(prev.flags), ...Object.keys(next.flags)])
  const added: string[] = []
  const removed: string[] = []
  for (const name of Array.from(names).sort()) {
    const before = prev.flags[name] === true
    const after = next.flags[name] === true
    if (before === after) continue
    if (after) added.push(name)
    else removed.push(name)
  }
  return Object.freeze({
    protocol_changed: prev.protocol_version !== next.protocol_version,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
  })
}

/**
 * Whether a reconnect that re-recorded `next` over `prev` must emit
 * `mcp.server.capabilities_changed` — true iff the recorded set or protocol version
 * differs. The recorded set is never mutated silently (FR8, C2).
 */
export const shouldEmitCapabilitiesChanged = (prev: RecordedCapabilities, next: RecordedCapabilities): boolean => {
  const diff = diffCapabilities(prev, next)
  return diff.protocol_changed || diff.added.length > 0 || diff.removed.length > 0
}
