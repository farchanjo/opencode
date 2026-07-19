/**
 * Feature 012 T014 — the five per-domain structured-result projections (FR4, FR8).
 * Each projection is a TOTAL function mapping a structured result's opaque
 * `effective` payload onto one read domain's panel signal: a valid shape →
 * `projected` + a typed signal; an absent payload → `empty_fallback` + the honest
 * `EMPTY_*_SIGNAL` baseline; a malformed payload → `shape_mismatch` + the same
 * byte-identical baseline. None ever throws and none fabricates a row. This suite
 * pins all three outcomes plus never-throws for every domain, and covers the shared
 * `projection.ts` outcome model (`../../src/operator/projection`).
 */
import { describe, expect, test } from "bun:test"
import {
  emptyFallback,
  isPresent,
  isRecord,
  projected,
  shapeMismatch,
} from "../../src/operator/projection"
import { projectLangLockSignal, EMPTY_LANGLOCK_PANEL_SIGNAL } from "../../src/operator/langlock/state"
import { projectJobsSignal, EMPTY_JOBS_PANEL_SIGNAL } from "../../src/operator/jobs/state"
import { projectOutputSignal, EMPTY_OUTPUT_PANEL_SIGNAL } from "../../src/operator/output/state"
import { projectSemanticSignal, EMPTY_SEMANTIC_PANEL_SIGNAL } from "../../src/operator/semantic/state"
import { projectMcpSignal, EMPTY_MCP_PANEL_SIGNAL } from "../../src/operator/mcp/state"
import type { LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"
import type { JobDefinitionSummary, JobsListOutput } from "@opencode-ai/protocol/jobs/commands"

// P2 drift sentinels: the langlock + jobs valid fixtures are typed against the
// REAL @opencode-ai/protocol backend shapes (`LangLockPolicySummary`, the
// `jobs.list` `JobsListOutput`), so a backend shape change that the projection
// guards would silently start rejecting breaks this test at typecheck. The other
// three domains (output/semantic/mcp) stay content-free minimal fixtures.
const REAL_LANGLOCK_POLICY: LangLockPolicySummary = {
  enabled: true,
  tag: "pt-BR",
  displayName: "Portuguese (Brazil)",
  scope: "project",
  origin: "project",
  policyVersion: 1,
  enforcementMode: "advisory",
  hardPolicyFloorTag: "en-US",
  overrideAuthorized: true,
  updatedAt: "2026-07-19T00:00:00.000Z",
}
const VALID_LANGLOCK: LangLockPolicySummary = REAL_LANGLOCK_POLICY
const REAL_JOB_DEFINITION: JobDefinitionSummary = {
  jobDefinitionId: "jobdef_1",
  name: "nightly",
  description: "nightly maintenance",
  enabled: true,
  schedule: { scheduleId: "sched_1", cronExpression: "0 0 * * *", ianaTimezone: "UTC" },
  actionType: "native_maintenance",
  overlapPolicy: "forbid",
  misfirePolicy: "skip",
  registrationState: "registered",
  nextDueAt: null,
  lastOutcome: null,
  version: 1,
  updatedAt: "2026-07-19T00:00:00.000Z",
}
const VALID_JOBS: JobsListOutput = { definitions: [REAL_JOB_DEFINITION], cursor: null }
const VALID_OUTPUT = {
  currentSessionId: "session_a",
  entries: [{ parentSessionId: "session_a", stat: { outputRef: "outref_1", channel: "stdout", state: "sealed", committedBytes: 10, updatedAt: "2026-07-19T00:00:00.000Z" } }],
}
const VALID_SEMANTIC = {
  descriptors: [{ id: "model_1", displayName: "Model 1", capabilityKinds: ["embedding"], probeState: "validated", enabled: true }],
}
const VALID_MCP = {
  servers: [{ id: "server_1", name: "server_1", transportKind: "streamable-http", connectionState: "connected", enabled: true }],
}

// A battery of hostile / malformed inputs shared across the never-throws checks.
const HOSTILE: unknown[] = [0, 1, -1, NaN, "", "x", true, false, [], [1, 2], {}, { unrelated: 1 }, () => {}, Symbol("x")]

/** One domain's projection under the uniform three-outcome + never-throws contract. */
function describeProjection(
  name: string,
  project: (effective: unknown) => { outcome: string; signal: unknown },
  fixtures: { valid: unknown; malformed: unknown[]; empty: unknown },
) {
  describe(`${name} — total projection (FR4, FR8)`, () => {
    test("a valid effective projects a typed signal (projected)", () => {
      const result = project(fixtures.valid)
      expect(result.outcome).toBe("projected")
      expect(result.signal).not.toBe(fixtures.empty)
    })

    test("an absent effective degrades to the honest empty baseline (empty_fallback)", () => {
      for (const absent of [undefined, null]) {
        const result = project(absent)
        expect(result.outcome).toBe("empty_fallback")
        expect(result.signal).toBe(fixtures.empty)
      }
    })

    test("a malformed effective degrades to the honest empty baseline (shape_mismatch)", () => {
      for (const bad of fixtures.malformed) {
        const result = project(bad)
        expect(result.outcome).toBe("shape_mismatch")
        expect(result.signal).toBe(fixtures.empty)
      }
    })

    test("never throws across a battery of hostile inputs", () => {
      for (const value of [...HOSTILE, fixtures.valid, undefined, null]) {
        expect(() => project(value)).not.toThrow()
      }
    })
  })
}

describeProjection("projectLangLockSignal", projectLangLockSignal, {
  valid: VALID_LANGLOCK,
  malformed: [42, "policy", [], { tag: "pt-BR" }, { policy: { tag: 1 } }],
  empty: EMPTY_LANGLOCK_PANEL_SIGNAL,
})

describeProjection("projectJobsSignal", projectJobsSignal, {
  valid: VALID_JOBS,
  malformed: [7, "jobs", [], {}, { definitions: [{ name: "x" }] }, { definition: { jobDefinitionId: 1 } }],
  empty: EMPTY_JOBS_PANEL_SIGNAL,
})

describeProjection("projectOutputSignal", projectOutputSignal, {
  valid: VALID_OUTPUT,
  malformed: [1, "output", [], {}, { currentSessionId: 1, entries: [] }, { currentSessionId: "s", entries: [{ stat: {} }] }],
  empty: EMPTY_OUTPUT_PANEL_SIGNAL,
})

describeProjection("projectSemanticSignal", projectSemanticSignal, {
  valid: VALID_SEMANTIC,
  malformed: [3, "semantic", [], {}, { descriptors: [{ id: 1 }] }, { descriptors: "x" }],
  empty: EMPTY_SEMANTIC_PANEL_SIGNAL,
})

describeProjection("projectMcpSignal", projectMcpSignal, {
  valid: VALID_MCP,
  malformed: [9, "mcp", [], {}, { servers: [{ id: 1 }] }, { capabilities: { serverId: 1 } }],
  empty: EMPTY_MCP_PANEL_SIGNAL,
})

describe("projected/jobs specifics — the typed signal actually carries the row", () => {
  test("a jobs.list effective surfaces its definition ids", () => {
    const result = projectJobsSignal(VALID_JOBS)
    expect(result.signal.definitions.map((d) => d.jobDefinitionId)).toEqual(["jobdef_1"])
  })

  test("a langlock.status effective surfaces its policy tag", () => {
    const result = projectLangLockSignal(VALID_LANGLOCK)
    expect(result.signal.policy?.tag).toBe("pt-BR")
  })
})

describe("shared projection outcome model (projection.ts)", () => {
  test("the three constructors tag their outcome and carry the signal through", () => {
    const signal = { marker: true }
    expect(projected(signal)).toEqual({ outcome: "projected", signal })
    expect(emptyFallback(signal)).toEqual({ outcome: "empty_fallback", signal })
    expect(shapeMismatch(signal)).toEqual({ outcome: "shape_mismatch", signal })
  })

  test("isRecord accepts a plain object and rejects null, arrays, and primitives", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord("x")).toBe(false)
    expect(isRecord(1)).toBe(false)
  })

  test("isPresent gates only null and undefined out", () => {
    expect(isPresent(undefined)).toBe(false)
    expect(isPresent(null)).toBe(false)
    for (const present of [0, "", false, [], {}, NaN]) expect(isPresent(present)).toBe(true)
  })
})
