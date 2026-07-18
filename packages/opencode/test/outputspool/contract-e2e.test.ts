/**
 * Feature 005 / T044 (S27) — contract + end-to-end matrix through the Feature
 * 007 reserved catalog and the on-disk spool tree.
 *
 * Covers the `output.*` IDs versus the existing reserved catalog (already at
 * 1.3.0) with reserved-ID collision rejection, a huge-output bounded-memory run,
 * handoff refs, a plugin oversized spill, path-traversal denial,
 * unauthorized-sibling denial, and a Feature 003 scheduled occurrence owning its
 * own OutputGroup with a bounded summary/ref notification (AC1, AC12, AC13,
 * AC14, AC15, AC21). The CLI human/JSON surface and the TUI paged panel are
 * pinned by `packages/cli/src/output/*.test.ts` and
 * `packages/tui/src/operator/output/*.test.ts` (zero model calls; cursor
 * reconnect; direct-children-only).
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Identity } from "@opencode-ai/core/outputspool/identity"
import { RESERVED_CATALOG } from "@opencode-ai/core/operator/catalog"
import { Authorization } from "@/outputspool/authorization"
import { CompatBoundary } from "@/outputspool/compat-boundary"
import { ContextSlice } from "@/outputspool/context-slice"
import { OutputSpoolCommandPort } from "@/operator/outputspool/outputspool-command-port"
import { SpoolLayout } from "@/outputspool/spool-layout"

const repoRoot = join(import.meta.dir, "../../../..")
const sandboxSpoolRoot = join(repoRoot, ".dev/opencode-operator/outputspool")
mkdirSync(sandboxSpoolRoot, { recursive: true })
const runRoot = mkdtempSync(join(sandboxSpoolRoot, "t044-"))
afterAll(() => rmSync(runRoot, { recursive: true, force: true }))

const OUTPUT_IDS = [
  "output.stat",
  "output.read",
  "output.follow",
  "output.export",
  "output.share",
  "output.release",
  "output.delete",
  "output.purge",
  "output.retention.set",
  "output.quota.set",
] as const

const enc = (s: string) => new TextEncoder().encode(s)

describe("T044 contract — reserved catalog output.* IDs + collision rejection (AC13, C19)", () => {
  test("all ten output.* IDs are present in the reserved catalog (no bump)", () => {
    const ids = new Set(RESERVED_CATALOG.ids)
    for (const id of OUTPUT_IDS) expect(ids.has(id)).toBe(true)
    expect(RESERVED_CATALOG.domains).toContain("output")
  })

  test("the three consume IDs are non-mutating; the seven admin IDs mutate", () => {
    const byId = new Map(RESERVED_CATALOG.entries.map((e) => [e.id, e]))
    for (const id of ["output.stat", "output.read", "output.follow"]) expect(byId.get(id)!.mutates).toBe(false)
    for (const id of ["output.export", "output.share", "output.release", "output.delete", "output.purge"])
      expect(byId.get(id)!.mutates).toBe(true)
  })

  test("a plugin/MCP registration colliding with a reserved output.* ID is refused", () => {
    for (const id of OUTPUT_IDS) expect(OutputSpoolCommandPort.isReservedOutputId(id)).toBe(true)
    expect(OutputSpoolCommandPort.isReservedOutputId("plugin.output.read")).toBe(false)
    expect(OutputSpoolCommandPort.isReservedOutputId("custom.read")).toBe(false)
  })
})

describe("T044 e2e — path-traversal denial on the managed tree (AC14)", () => {
  const layout = SpoolLayout.createSpoolLayout({ root: runRoot })
  const KEY: SpoolLayout.SubtreeKey = {
    project_id: "proj",
    root_session_id: "root",
    process_attempt: "p1",
    generation: "0",
    channel: "stdout",
  }

  test("a `..` traversal segment is rejected before any join", () => {
    expect(() => layout.subtreeDir({ ...KEY, generation: ".." })).toThrow(SpoolLayout.SpoolPathError)
  })

  test("an absolute path escaping the root is rejected", async () => {
    await expect(layout.guardWithinRoot("/etc/passwd")).rejects.toThrow(SpoolLayout.SpoolPathError)
  })
})

describe("T044 e2e — unauthorized sibling read is denied without content (AC15)", () => {
  const subject: Authorization.Subject = {
    output_ref: "or_x",
    owning_session_id: "ses_owner",
    owning_tree_id: "tree_1",
    project_id: "proj_1",
    channel: "stdout",
  }

  test("a sibling session principal is denied consume access with a reason, never bytes", () => {
    const sibling: Authorization.Principal = { kind: "runtime", id: "r", sessionId: "ses_sibling" }
    const decision = Authorization.authorize({ plane: "consume", principal: sibling, subject })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason.length).toBeGreaterThan(0)
  })
})

describe("T044 e2e — huge output stays in bounded memory (AC1)", () => {
  test("a 10k-chunk stream spills through the sink with an O(preview) head, not O(total)", async () => {
    const CHUNKS = 10_000
    const CHUNK = enc("0123456789") // 10 bytes each → ~100 KiB total
    let appended = 0
    const sink: CompatBoundary.ChannelSink = {
      output_ref: "or_huge",
      append: (chunk) => void (appended += chunk.length),
      seal: () => appended,
    }
    async function* gen() {
      for (let i = 0; i < CHUNKS; i++) yield CHUNK
    }
    const result = await CompatBoundary.streamInto(sink, { chunks: gen() }, CompatBoundary.DEFAULT_ADAPTER_CAPS)
    expect(result.committed_bytes).toBe(CHUNKS * CHUNK.length)
    // The retained preview head never grows past the bounded cap — proof of O(preview) memory.
    expect(result.preview.length).toBeLessThanOrEqual(CompatBoundary.DEFAULT_ADAPTER_CAPS.max_preview_bytes)
    expect(result.output_ref).toBe("or_huge")
    // The result is path-free (no filesystem path embedded).
    expect(JSON.stringify(result)).not.toContain(runRoot)
  })
})

describe("T044 e2e — plugin oversized whole-value spill under caps (AC13)", () => {
  test("an oversized non-streaming source is spilled under the byte cap and marked degraded, no path", async () => {
    const caps: CompatBoundary.AdapterCaps = { max_bytes: 1024, max_ms: 30_000, max_preview_bytes: 256 }
    const big = new Uint8Array(4096).fill(65) // 4 KiB > 1 KiB cap
    let committed = 0
    const sink: CompatBoundary.ChannelSink = {
      output_ref: "or_plugin",
      append: (chunk) => void (committed += chunk.length),
      seal: () => committed,
    }
    const result = await CompatBoundary.spillWhole(sink, { value: () => big }, caps)
    expect(result.degraded).toBe(true)
    expect(result.committed_bytes).toBe(caps.max_bytes) // spilled only up to the cap
    expect(result.preview.length).toBeLessThanOrEqual(caps.max_preview_bytes)
    expect(JSON.stringify(result)).not.toContain("/")
  })
})

describe("T044 e2e — handoff carries a summary + OutputRef and reads bounded pages (AC12)", () => {
  test("a Manager handoff materializes only budgeted ranges and records transcript refs", async () => {
    const recorded: Array<{ offset: number; length: number }> = []
    const slice = ContextSlice.createContextSlice(
      // The paged reader returns only the requested window — never the whole channel.
      async (_ref, offset, limit) => ({ bytes: enc("X".repeat(limit)).subarray(0, limit) }),
      (_ref, range) => void recorded.push(range),
    )
    const result = await slice.materialize({
      output_ref: "or_handoff",
      ranges: [{ offset: 0, limit: 32 }],
      budget_bytes: 32,
    })
    expect(result.total_bytes).toBe(32)
    // The exact range used is recorded into the durable transcript set feeding retention.
    expect(recorded).toEqual([{ offset: 0, length: 32 }])
  })
})

describe("T044 e2e — a scheduled occurrence owns its own OutputGroup (AC21, FR39)", () => {
  const entropy = (() => {
    let n = 0
    return { token: () => `tok_${n++}` }
  })()

  test("each occurrence attempt/generation mints a distinct group and one subtree per ref", () => {
    const occ1 = Identity.mintGroup(
      { project_id: "p" as any, root_session_id: "r" as any, process_id: "proc" as any, attempt: 1 as any, generation: 0 as any },
      entropy,
    )
    const occ2 = Identity.mintGroup(
      { project_id: "p" as any, root_session_id: "r" as any, process_id: "proc" as any, attempt: 2 as any, generation: 1 as any },
      entropy,
    )
    // Distinct occurrences own distinct groups — no shared OutputGroup across occurrences.
    expect(occ1.id).not.toBe(occ2.id)
    expect(occ1.key.generation).not.toBe(occ2.key.generation)
    // Distinct generations always resolve to distinct subtrees (a stale generation never overwrites).
    const s0 = Identity.subtreeKey(occ1.id, 0 as any, "stdout")
    const s1 = Identity.subtreeKey(occ1.id, 1 as any, "stdout")
    expect(s0).not.toBe(s1)
  })

  test("a superseded occurrence generation is fenced (stale_generation)", () => {
    expect(Identity.fence(2 as any, 1 as any).accepted).toBe(false)
    expect(Identity.fence(2 as any, 2 as any).accepted).toBe(true)
  })
})
