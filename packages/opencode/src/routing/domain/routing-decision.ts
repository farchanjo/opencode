/**
 * Feature 001 / T020 — Immutable RoutingDecision record + atomic commit.
 *
 * Two concerns, both pure:
 *   1. Construction of the immutable `Decision.RoutingDecision` aggregate
 *      (decision.cue) — assembled from the seven top-level sections the
 *      pipeline produces and DEEP-FROZEN so a persisted decision can never be
 *      mutated in place after the fact (immutable record, ADR-0002).
 *   2. The atomic commit protocol (hierarchy-flow.md "Persist Decision":
 *      atomic commit) — temp page -> journal flag -> atomic rename — keyed by
 *      the `(session_id, turn_id, task_fingerprint)` idempotency tuple so a
 *      replay of the same turn re-uses the already-committed decision instead
 *      of overwriting it or racing a partial write.
 *
 * The persistence side is modelled as a pure protocol over an injected minimal
 * fs-like port (`DecisionStorePort`); the real filesystem / durable-store
 * adapters arrive in T026+. Keeping the protocol free of any concrete storage
 * dependency makes the temp/journal/rename ordering and the crash-recovery
 * path unit-testable against an in-memory fake, with no framework runtime.
 *
 * Crash recovery: a commit that dies between "journal flag" and "atomic
 * rename" leaves a journal marker plus a temp page. The next `commitDecision`
 * for that key (or an explicit `recoverPending`) replays the pending rename
 * from the journal before doing anything else, so the store is always brought
 * to a consistent committed state before an idempotency check runs.
 */
export * as RoutingDecision from "./routing-decision"

import type { Decision } from "@opencode-ai/schema/routing/decision"

// =============================================================================
// Immutable record construction
// =============================================================================

/** Recursively freeze a value so a persisted decision cannot be mutated in place. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/**
 * Assemble the immutable `Decision.RoutingDecision` from its already-computed
 * sections and deep-freeze the whole aggregate. This is the sole sanctioned
 * construction site: the routing service composes the classifier, evaluator
 * and accounting outputs into these sections and hands them here, guaranteeing
 * every persisted decision is frozen before it leaves the domain.
 */
export function buildRoutingDecision(input: {
  readonly id: Decision.RoutingDecision["id"]
  readonly context: Decision.DecisionContext
  readonly classification: Decision.DecisionClassification
  readonly selection: Decision.DecisionSelection
  readonly evaluation: Decision.DecisionEvaluation
  readonly accounting: Decision.DecisionAccounting
  readonly lifecycle: Decision.DecisionLifecycle
}): Decision.RoutingDecision {
  const decision: Decision.RoutingDecision = {
    id: input.id,
    context: input.context,
    classification: input.classification,
    selection: input.selection,
    evaluation: input.evaluation,
    accounting: input.accounting,
    lifecycle: input.lifecycle,
  }
  return deepFreeze(decision)
}

// =============================================================================
// Idempotency key — (session_id, turn_id, task_fingerprint)
// =============================================================================

export interface IdempotencyKey {
  readonly sessionId: string
  readonly turnId: string
  readonly taskFingerprint: string
}

export function idempotencyKey(context: Decision.DecisionContext): IdempotencyKey {
  return {
    sessionId: context.session_id,
    turnId: context.turn_id,
    taskFingerprint: context.task_fingerprint,
  }
}

/** Stable tuple string for equality/logging: components are `::`-joined, order fixed. */
export function keyString(key: IdempotencyKey): string {
  return `${key.sessionId}::${key.turnId}::${key.taskFingerprint}`
}

/** Filesystem-safe derivation of the key: any non `[A-Za-z0-9._-]` byte becomes `_`. */
export function safeKey(key: IdempotencyKey): string {
  return keyString(key).replace(/[^A-Za-z0-9._-]/g, "_")
}

// =============================================================================
// Injected fs-like port
// =============================================================================

/**
 * Minimal storage surface the commit protocol needs. Deliberately tiny so a
 * concrete adapter (real fs, durable store) is trivial and an in-memory fake
 * makes the protocol fully unit-testable. `rename` MUST be atomic on the
 * backing store — that is the property the whole protocol relies on.
 */
export interface DecisionStorePort {
  readonly exists: (path: string) => Promise<boolean>
  readonly readText: (path: string) => Promise<string | null>
  readonly writeText: (path: string, contents: string) => Promise<void>
  /** Atomic rename of `from` onto `to` (overwriting `to` if present). */
  readonly rename: (from: string, to: string) => Promise<void>
  readonly remove: (path: string) => Promise<void>
}

/** The three page paths derived from a key under a base directory prefix. */
export interface DecisionPaths {
  readonly committed: string
  readonly temp: string
  readonly journal: string
}

/** Deterministic path layout: `<baseDir>/<safeKey>{.json,.tmp,.journal}`. */
export function pathsFor(baseDir: string, key: IdempotencyKey): DecisionPaths {
  const stem = `${baseDir.replace(/\/+$/, "")}/${safeKey(key)}`
  return { committed: `${stem}.json`, temp: `${stem}.tmp`, journal: `${stem}.journal` }
}

// =============================================================================
// Serialization
// =============================================================================

export function serialize(decision: Decision.RoutingDecision): string {
  return JSON.stringify(decision)
}

/** Parse a committed page back into a decision; returns null on absent/corrupt input. */
export function deserialize(contents: string | null): Decision.RoutingDecision | null {
  if (contents === null) return null
  try {
    return JSON.parse(contents) as Decision.RoutingDecision
  } catch {
    return null
  }
}

// The journal marker records the pending rename so recovery can replay it.
interface JournalMarker {
  readonly from: string
  readonly to: string
  readonly key: string
}

// =============================================================================
// Crash recovery — replay a pending rename from the journal marker
// =============================================================================

/**
 * Bring the key back to a consistent committed state before any read/commit:
 * if a journal marker is present, the previous commit died mid-flight. Replay
 * its rename when the temp page still exists, then clear the marker. Idempotent
 * and safe to call unconditionally.
 */
export async function recoverPending(port: DecisionStorePort, paths: DecisionPaths): Promise<"recovered" | "clean"> {
  if (!(await port.exists(paths.journal))) return "clean"
  const marker = deserializeMarker(await port.readText(paths.journal))
  if (marker !== null && (await port.exists(marker.from))) {
    await port.rename(marker.from, marker.to)
  }
  await port.remove(paths.journal)
  return "recovered"
}

function deserializeMarker(contents: string | null): JournalMarker | null {
  if (contents === null) return null
  try {
    return JSON.parse(contents) as JournalMarker
  } catch {
    return null
  }
}

// =============================================================================
// Atomic commit protocol
// =============================================================================

export type CommitOutcome = "committed" | "idempotent_hit"

export interface CommitResult {
  readonly outcome: CommitOutcome
  readonly key: IdempotencyKey
  /** For "committed": the freshly persisted decision. For "idempotent_hit": the existing one. */
  readonly decision: Decision.RoutingDecision
  /** True when a crashed prior attempt was recovered before this commit proceeded. */
  readonly recovered: boolean
}

/**
 * Commit a decision idempotently under its `(session_id, turn_id,
 * task_fingerprint)` key:
 *   0. recover any pending rename from a crashed prior attempt;
 *   1. if a committed page for the key exists, return it unchanged
 *      (idempotent hit — the immutable record is never overwritten);
 *   2. otherwise write the temp page, drop the journal flag (recording the
 *      pending rename), atomically rename temp -> committed, then clear the
 *      journal flag.
 *
 * The rename is the linearization point: a crash before it leaves the key
 * uncommitted (recovery finds the temp + journal and replays), a crash after
 * it leaves the key committed (recovery finds only the journal and clears it).
 */
export async function commitDecision(
  port: DecisionStorePort,
  baseDir: string,
  decision: Decision.RoutingDecision,
): Promise<CommitResult> {
  const key = idempotencyKey(decision.context)
  const paths = pathsFor(baseDir, key)

  const recovery = await recoverPending(port, paths)
  const recovered = recovery === "recovered"

  const existing = deserialize(await port.readText(paths.committed))
  if (existing !== null) {
    return { outcome: "idempotent_hit", key, decision: existing, recovered }
  }

  await port.writeText(paths.temp, serialize(decision))
  const marker: JournalMarker = { from: paths.temp, to: paths.committed, key: keyString(key) }
  await port.writeText(paths.journal, JSON.stringify(marker))
  await port.rename(paths.temp, paths.committed)
  await port.remove(paths.journal)

  return { outcome: "committed", key, decision, recovered }
}

/**
 * Read back a committed decision for a key without committing anything.
 * Recovers a pending rename first so a mid-commit crash never hides an
 * already-durable decision from a reader.
 */
export async function loadDecision(
  port: DecisionStorePort,
  baseDir: string,
  key: IdempotencyKey,
): Promise<Decision.RoutingDecision | null> {
  const paths = pathsFor(baseDir, key)
  await recoverPending(port, paths)
  return deserialize(await port.readText(paths.committed))
}
