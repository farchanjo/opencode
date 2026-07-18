/**
 * Feature 001 / T037 — Decision-store persistence integration.
 *
 * Drives the domain atomic-commit protocol (domain/routing-decision.ts) through
 * the concrete filesystem adapter (adapters/outbound/decision-store-fs.ts)
 * against REAL files under the Feature 007 sandbox root
 * (`.dev/opencode-operator/`), covering the atomic-commit and crash-recovery
 * paths end to end. The domain unit test (routing-decision.test.ts) exercises
 * the same protocol against an in-memory fake; this one proves the fs adapter's
 * mkdir-on-write + fs.rename linearization actually holds on disk.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises"
import path from "path"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import {
  commitDecision,
  deserialize,
  idempotencyKey,
  keyString,
  loadDecision,
  pathsFor,
  recoverPending,
  serialize,
} from "@/routing/domain/routing-decision"
import { createFsDecisionStorePort } from "@/routing/adapters/outbound/decision-store-fs"

const NOW = "2026-07-18T00:00:00.000Z"

// Sandbox data root: .dev/opencode-operator/data/routing-decisions (T037 "real files under .dev/").
const repoRoot = path.resolve(import.meta.dir, "../../../../../")
const sandboxDecisions = path.join(repoRoot, ".dev/opencode-operator/data/routing-decisions")

const created: string[] = []

async function freshBaseDir(): Promise<string> {
  const dir = await mkdtemp(path.join(sandboxDecisions, "it-"))
  created.push(dir)
  return dir
}

beforeAll(async () => {
  await mkdir(sandboxDecisions, { recursive: true })
})

afterAll(async () => {
  for (const dir of created) await rm(dir, { recursive: true, force: true })
})

function makeDecision(overrides?: {
  id?: string
  sessionId?: string
  turnId?: string
  fingerprint?: string
  agent?: string
}): Decision.RoutingDecision {
  const context: Decision.DecisionContext = {
    version: 1,
    session_id: overrides?.sessionId ?? "sess-1",
    turn_id: overrides?.turnId ?? "turn-1",
    task_fingerprint: overrides?.fingerprint ?? "fp-abc",
  }
  const classification: Decision.DecisionClassification = {
    task_class: "small",
    routing_profile: "direct_worker",
    task_effort: "low",
    reasoning_effort: "low",
  }
  const selection: Decision.DecisionSelection = {
    specialist_agent: overrides?.agent ?? "worker",
    executor_model: "claude-sonnet-5",
    selected_skills: [],
    provider_variant: "default",
  }
  const evaluation: Decision.DecisionEvaluation = {
    gates: [],
    candidates: [],
    ranking: [],
    tie_break: null,
    decision_model_id: null,
    decision_inputs: null,
    decision_output: null,
  }
  const accounting: Decision.DecisionAccounting = {
    budget: {
      policy: {
        limits: {
          max_turns: 10,
          max_context_tokens: 100_000,
          max_context_bytes: 400_000,
          max_output_tokens: 8_000,
          max_output_bytes: 32_000,
        },
        concurrency: { max_workers: 4, max_delegation_depth: 2 },
        retrieval: { retrieval_top_k: 10, rerank_top_k: 5, max_skill_chunks: 8, max_skill_tokens: 4_000 },
        cost: { time_budget_ms: 60_000, cost_budget_usd: 1, token_budget: 200_000 },
        resilience: { retry_depth: 2, validation_depth: 2, escalation_threshold: "confidence_floor" },
      },
      applied_at: NOW,
      scope: "session",
      routing_profile: "direct_worker",
      task_class: "small",
      role: "worker",
    },
    budget_consumed: {
      throughput: { turns_used: 0, context_tokens_used: 0, output_tokens_used: 0 },
      concurrency: { workers_requested: 0, workers_granted: 0, delegation_depth_used: 0 },
      retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
      cost: { time_ms_used: 0, cost_usd_used: 0 },
      resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
    },
    catalog_version: "cat-v1",
    policy_version: "pol-v1",
    auth_context: { permission_mode: "default", policy_version: "pol-v1", hard_gates_authoritative: true },
  }
  const lifecycle: Decision.DecisionLifecycle = {
    execution_boundary: "safe",
    fallback_attempted: false,
    fallback_reason: null,
    fallback_candidates: null,
    created_at: NOW,
    decision_latency_ms: 3,
    offline: false,
  }
  return {
    id: overrides?.id ?? "01J000000000000000000DEC01",
    context,
    classification,
    selection,
    evaluation,
    accounting,
    lifecycle,
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe("T037 decision-store-fs — atomic commit on real .dev/ files", () => {
  test("first commit writes the committed page to disk and clears temp + journal", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const decision = makeDecision()
    const paths = pathsFor(base, idempotencyKey(decision.context))

    const result = await commitDecision(port, base, decision)

    expect(result.outcome).toBe("committed")
    expect(result.recovered).toBe(false)
    expect(await fileExists(paths.committed)).toBe(true)
    expect(await fileExists(paths.temp)).toBe(false)
    expect(await fileExists(paths.journal)).toBe(false)

    // The bytes on disk deserialize back to the exact decision.
    const onDisk = deserialize(await readFile(paths.committed, "utf8"))
    expect(onDisk).toEqual(decision)
  })

  test("commit auto-creates the by-id nested directory layout without pre-seeding", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    // A key whose safe form embeds separators still lands under a created parent.
    const decision = makeDecision({ sessionId: "sess/a", turnId: "turn b", fingerprint: "fp-nested" })
    const result = await commitDecision(port, base, decision)
    expect(result.outcome).toBe("committed")
    const paths = pathsFor(base, idempotencyKey(decision.context))
    expect(await fileExists(paths.committed)).toBe(true)
  })

  test("re-commit of the same key is an idempotent hit and never rewrites the page", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const first = makeDecision({ id: "01J000000000000000000DEC01" })
    await commitDecision(port, base, first)
    const paths = pathsFor(base, idempotencyKey(first.context))
    const bytesBefore = await readFile(paths.committed, "utf8")

    const replay = makeDecision({ id: "01J000000000000000000DEC02", agent: "other" })
    const result = await commitDecision(port, base, replay)

    expect(result.outcome).toBe("idempotent_hit")
    expect(result.decision.id).toBe("01J000000000000000000DEC01")
    // The immutable record on disk is byte-identical to the original commit.
    expect(await readFile(paths.committed, "utf8")).toBe(bytesBefore)
  })

  test("distinct idempotency keys commit to independent files", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const a = makeDecision({ turnId: "turn-1", fingerprint: "fp-a" })
    const b = makeDecision({ turnId: "turn-2", fingerprint: "fp-b" })
    expect((await commitDecision(port, base, a)).outcome).toBe("committed")
    expect((await commitDecision(port, base, b)).outcome).toBe("committed")
    expect(await fileExists(pathsFor(base, idempotencyKey(a.context)).committed)).toBe(true)
    expect(await fileExists(pathsFor(base, idempotencyKey(b.context)).committed)).toBe(true)
  })
})

describe("T037 decision-store-fs — crash recovery on real .dev/ files", () => {
  test("recovers a rename that crashed after the journal flag (temp present)", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const decision = makeDecision()
    const key = idempotencyKey(decision.context)
    const paths = pathsFor(base, key)

    // Simulate a crash between journal-flag and atomic-rename: temp + journal on
    // disk, committed page absent.
    await writeFile(paths.temp, serialize(decision), "utf8")
    await writeFile(paths.journal, JSON.stringify({ from: paths.temp, to: paths.committed, key: keyString(key) }), "utf8")

    const recovery = await recoverPending(port, paths)

    expect(recovery).toBe("recovered")
    expect(await fileExists(paths.committed)).toBe(true)
    expect(await fileExists(paths.temp)).toBe(false)
    expect(await fileExists(paths.journal)).toBe(false)
    expect(await loadDecision(port, base, key)).toEqual(decision)
  })

  test("clears a stale journal when the rename already completed (temp absent)", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const decision = makeDecision()
    const key = idempotencyKey(decision.context)
    const paths = pathsFor(base, key)

    // Crash after the rename, before the journal was cleared.
    await writeFile(paths.committed, serialize(decision), "utf8")
    await writeFile(paths.journal, JSON.stringify({ from: paths.temp, to: paths.committed, key: keyString(key) }), "utf8")

    expect(await recoverPending(port, paths)).toBe("recovered")
    expect(await fileExists(paths.journal)).toBe(false)
    expect(await fileExists(paths.committed)).toBe(true)
  })

  test("commit replays a crashed prior attempt before its idempotency check", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const decision = makeDecision()
    const key = idempotencyKey(decision.context)
    const paths = pathsFor(base, key)

    await writeFile(paths.temp, serialize(decision), "utf8")
    await writeFile(paths.journal, JSON.stringify({ from: paths.temp, to: paths.committed, key: keyString(key) }), "utf8")

    const result = await commitDecision(port, base, makeDecision({ id: "01J000000000000000000DEC99" }))

    expect(result.recovered).toBe(true)
    expect(result.outcome).toBe("idempotent_hit")
    expect(result.decision.id).toBe(decision.id)
  })

  test("a crash BEFORE the journal flag leaves no usable committed record", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const decision = makeDecision()
    const key = idempotencyKey(decision.context)
    const paths = pathsFor(base, key)

    // Only the temp page exists (write crashed before the journal marker): the
    // key must read back as absent — a partial write is never surfaced.
    await writeFile(paths.temp, serialize(decision), "utf8")

    expect(await loadDecision(port, base, key)).toBeNull()
    expect(await fileExists(paths.committed)).toBe(false)
  })

  test("recoverPending on a clean key touches nothing", async () => {
    const port = createFsDecisionStorePort()
    const base = await freshBaseDir()
    const paths = pathsFor(base, { sessionId: "s", turnId: "t", taskFingerprint: "f" })
    expect(await recoverPending(port, paths)).toBe("clean")
    expect(await fileExists(paths.committed)).toBe(false)
  })
})
