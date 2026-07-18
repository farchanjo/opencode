/**
 * Feature 001 / T026 — Domain-backed DecisionStore.
 *
 * Adapts the pure atomic-commit protocol in domain/routing-decision.ts to the
 * application `DecisionStore` port (ports.ts): idempotent commit keyed by
 * (session_id, turn_id, task_fingerprint) plus a by-id index so `explain` can
 * resolve a decision from its ULID.
 *
 * The commit path delegates entirely to the domain protocol (temp page ->
 * journal flag -> atomic rename, with crash recovery); this module only adds a
 * `<baseDir>/by-id/<decisionId>.ptr` pointer file (the idempotency tuple in
 * JSON) written after the domain commit so the by-id read stays a two-step
 * lookup with no parallel decision store. Pure over the injected fs-like
 * `DecisionStorePort`, so an in-memory fake exercises the whole path in tests.
 */
export * as RoutingDecisionStore from "./decision-store"

import type { Decision } from "@opencode-ai/schema/routing/decision"
import {
  commitDecision,
  loadDecision,
  idempotencyKey,
  type DecisionStorePort,
  type IdempotencyKey,
} from "../domain/routing-decision"
import type { DecisionStore } from "./ports"

function pointerPath(baseDir: string, decisionId: string): string {
  const stem = baseDir.replace(/\/+$/, "")
  const safeId = decisionId.replace(/[^A-Za-z0-9._-]/g, "_")
  return `${stem}/by-id/${safeId}.ptr`
}

function parsePointer(contents: string | null): IdempotencyKey | null {
  if (contents === null) return null
  try {
    const parsed = JSON.parse(contents) as Partial<IdempotencyKey>
    if (
      typeof parsed.sessionId === "string" &&
      typeof parsed.turnId === "string" &&
      typeof parsed.taskFingerprint === "string"
    ) {
      return { sessionId: parsed.sessionId, turnId: parsed.turnId, taskFingerprint: parsed.taskFingerprint }
    }
  } catch {
    /* corrupt pointer — treated as missing */
  }
  return null
}

/**
 * Build a DecisionStore over the domain commit protocol and an fs-like port.
 * `commit` is idempotent (the domain returns the existing record on a replay of
 * the same key); the by-id pointer is (re)written on every commit so both a
 * fresh commit and an idempotent hit remain resolvable by decision id.
 */
export function createDomainDecisionStore(port: DecisionStorePort, baseDir: string): DecisionStore {
  return {
    commit: async (decision: Decision.RoutingDecision): Promise<Decision.RoutingDecision> => {
      const result = await commitDecision(port, baseDir, decision)
      const key = idempotencyKey(result.decision.context)
      await port.writeText(pointerPath(baseDir, result.decision.id), JSON.stringify(key))
      return result.decision
    },

    findById: async (decisionId: string): Promise<Decision.RoutingDecision | null> => {
      const key = parsePointer(await port.readText(pointerPath(baseDir, decisionId)))
      if (key === null) return null
      return loadDecision(port, baseDir, key)
    },
  }
}
