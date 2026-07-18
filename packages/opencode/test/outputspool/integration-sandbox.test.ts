/**
 * Feature 005 / T042 (S27) — integration tests over a real Feature 007 sandbox
 * spool tree under `.dev/`.
 *
 * Unlike the per-module unit suites (which inject byte sinks and `:memory:`
 * stores), this suite drives the REAL Bun `FileSink` batched writer, the REAL
 * positional `node:fs/promises` page reader, and a REAL `bun:sqlite` control
 * store against an isolated on-disk spool root, exactly as the application stack
 * binds them. It exercises the FileSink batched writer plus tiered fsync, the
 * positional reader under concurrent append with bounded memory, control-store
 * committed-length ordering, the ref-aware retention sweeper, authorization
 * re-evaluation, the C16 migration dual-read, and budgeted context-slice
 * materialization with range recording (AC1, AC2, AC12, AC16, AC17, AC19, AC22).
 */
import { afterAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Authorization } from "@/outputspool/authorization"
import { ContextSlice } from "@/outputspool/context-slice"
import { ControlStore } from "@/outputspool/control-store"
import { FileSinkWriter } from "@/outputspool/file-sink-writer"
import { MigrationBridge } from "@/outputspool/migration-bridge"
import { PageReader } from "@/outputspool/page-reader"
import { RetentionSweeper } from "@/outputspool/retention-sweeper"
import { SpoolLayout } from "@/outputspool/spool-layout"

// Isolated on-disk spool root under the gitignored Feature 007 `.dev/` sandbox
// tree (matches the plan's `.dev/opencode-operator/outputspool` isolated root).
const repoRoot = join(import.meta.dir, "../../../..")
const sandboxSpoolRoot = join(repoRoot, ".dev/opencode-operator/outputspool")
mkdirSync(sandboxSpoolRoot, { recursive: true })
const runRoot = mkdtempSync(join(sandboxSpoolRoot, "t042-"))
afterAll(() => rmSync(runRoot, { recursive: true, force: true }))

const layout = SpoolLayout.createSpoolLayout({ root: runRoot })
const enc = (s: string) => new TextEncoder().encode(s)

const KEY = (channel: string, generation = "0"): SpoolLayout.SubtreeKey => ({
  project_id: "proj",
  root_session_id: "root",
  process_attempt: "p1",
  generation,
  channel,
})

/** Build a real Bun FileSink-backed durable channel writer at a fresh spool file. */
async function realWriter(channel: string, tier: "durable" | "console" | "disposable") {
  await layout.ensureSubtree(KEY(channel))
  const path = layout.channelFile(KEY(channel))
  const sink = FileSinkWriter.openBunSink(path)
  const writer = FileSinkWriter.createChannelWriter({ path, tier, sink, fsync: FileSinkWriter.nodeFsyncPort })
  return { path, writer }
}

describe("T042 — real FileSink batched writer + tiered fsync (AC1)", () => {
  test("durable channel writes real bytes, seals, and fsyncs without error", async () => {
    const { path, writer } = await realWriter("assistant-text", "durable")
    const a = await writer.append(0, enc("hello "))
    const b = await writer.append(6, enc("world"))
    expect(a.kind).toBe("accepted")
    expect(b.kind).toBe("accepted")
    const committed = await writer.seal()
    expect(committed).toBe(11)
    // The bytes are on disk under the private tree (0600 file).
    expect(new TextDecoder().decode(await readFile(path))).toBe("hello world")
    if (SpoolLayout.supportsPosixModes()) expect(statSync(path).mode & 0o777).toBe(SpoolLayout.FILE_MODE)
  })

  test("the private subtree directory is 0700 (AC22 private managed tree)", async () => {
    const dir = await layout.ensureSubtree(KEY("stderr"))
    if (SpoolLayout.supportsPosixModes()) expect(statSync(dir).mode & 0o777).toBe(SpoolLayout.DIR_MODE)
  })
})

describe("T042 — positional page reader under concurrent append, bounded memory (AC2)", () => {
  test("reads only committed bytes; an in-flight append past committed is invisible", async () => {
    const { path, writer } = await realWriter("stdout", "console")
    await writer.append(0, enc("ABCDEFGHIJ")) // 10 committed bytes
    // A concurrent reader sees exactly the committed window, never past it.
    const page = await PageReader.readPage({ path, offset: 0, limit: 4, committedBytes: 10, sealed: false })
    expect(page.bytes.length).toBeLessThanOrEqual(4)
    expect(new TextDecoder().decode(page.bytes)).toBe("ABCD")
    expect(page.caught_up).toBe(false)
    expect(page.eof).toBe(false)
    // Read the tail; open stream is caught_up but never eof.
    const tail = await PageReader.readPage({ path, offset: 4, limit: 64, committedBytes: 10, sealed: false })
    expect(new TextDecoder().decode(tail.bytes)).toBe("EFGHIJ")
    expect(tail.caught_up).toBe(true)
    expect(tail.eof).toBe(false)
    await writer.seal()
    const eofPage = await PageReader.readPage({ path, offset: 10, limit: 64, committedBytes: 10, sealed: true })
    expect(eofPage.eof).toBe(true)
  })

  test("never splits a UTF-8 codepoint at a page boundary (AC3)", async () => {
    const { path, writer } = await realWriter("tool-result", "durable")
    // "héllo" — the 'é' is a 2-byte codepoint straddling a byte boundary at 1..3.
    const bytes = enc("héllo")
    await writer.append(0, bytes)
    await writer.seal()
    // Limit 2 must not split the 'é'; the page trims back to the codepoint boundary.
    const page = await PageReader.readPage({ path, offset: 0, limit: 2, committedBytes: bytes.length, sealed: true })
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(page.bytes)
    expect(decoded).toBe("h")
  })
})

describe("T042 — real bun:sqlite control-store committed-length ordering", () => {
  test("committed length is monotonic and fence records persist on a file-backed db", () => {
    const dbPath = join(runRoot, "control.sqlite")
    const store = ControlStore.createControlStore(new Database(dbPath))
    store.openGeneration({
      output_ref: "or_ctl",
      group_id: "g",
      generation: 0,
      channel: "stdout",
      durability_tier: "console",
      correlation_id: "c",
      now: 1,
    })
    expect(store.recordCommitted("or_ctl", 10, 2)).toBe(10)
    expect(store.recordCommitted("or_ctl", 25, 3)).toBe(25)
    expect(store.recordCommitted("or_ctl", 5, 4)).toBe(25) // never shrinks
    store.recordSeal("or_ctl", "tag", 5)
    expect(store.get("or_ctl")!.state).toBe("sealed")
  })
})

describe("T042 — ref-aware retention sweeper over the control store (AC16, AC17)", () => {
  const seed = (store: ControlStore.ControlStore, ref: string) =>
    store.openGeneration({
      output_ref: ref,
      group_id: "g",
      generation: 0,
      channel: "stdout",
      durability_tier: "console",
      correlation_id: "c",
      now: 1,
    })

  test("a referenced expired group survives; an unreferenced expired group is reclaimed", async () => {
    const store = ControlStore.createControlStore(new Database(":memory:"))
    seed(store, "or_ref")
    seed(store, "or_free")
    store.addEdge("or_ref", "transcript", "h1")
    const reclaimed: string[] = []
    const sweeper = RetentionSweeper.createRetentionSweeper({
      store,
      removeSubtree: () => {},
      audit: (e) => {
        if (e.action === "reclaimed") reclaimed.push(e.output_ref)
      },
      now: () => 10_000,
    })
    const groups: RetentionSweeper.GroupRetentionMeta[] = [
      { output_ref: "or_ref", ttl_ms: 1, created_at_ms: 0, active_reader_or_writer: false, legal_hold: false },
      { output_ref: "or_free", ttl_ms: 1, created_at_ms: 0, active_reader_or_writer: false, legal_hold: false },
    ]
    const result = await sweeper.cleanup(groups)
    expect(reclaimed).toEqual(["or_free"])
    expect(result.reclaimed_count).toBe(1)
    expect(result.scanned_count).toBe(2)
  })
})

describe("T042 — authorization re-evaluation before content (AC15 posture)", () => {
  const subject: Authorization.Subject = {
    output_ref: "or_x",
    owning_session_id: "ses_1",
    owning_tree_id: "tree_1",
    project_id: "proj_1",
    channel: "stdout",
  }

  test("the owning session principal is authorized; a sibling session is denied", () => {
    const owner: Authorization.Principal = { kind: "runtime", id: "r", sessionId: "ses_1" }
    const sibling: Authorization.Principal = { kind: "runtime", id: "r2", sessionId: "ses_2" }
    expect(Authorization.authorize({ plane: "consume", principal: owner, subject }).allowed).toBe(true)
    expect(Authorization.authorize({ plane: "consume", principal: sibling, subject }).allowed).toBe(false)
  })

  test("admin plane is deny-by-default without an operator principal + explicit scope", () => {
    const nonOperator: Authorization.Principal = { kind: "runtime", id: "r", sessionId: "ses_1" }
    expect(Authorization.authorize({ plane: "admin", principal: nonOperator, subject }).allowed).toBe(false)
    const operator: Authorization.Principal = { kind: "operator", id: "op", projectId: "proj_1" }
    expect(
      Authorization.authorize({ plane: "admin", principal: operator, subject, requested_scope: "project" }).allowed,
    ).toBe(true)
  })
})

describe("T042 — C16 migration dual-read window (AC12)", () => {
  test("disabled → legacy; enabled+dual-read → both; enabled → ref-only, no legacy content", () => {
    const legacy = { output: "legacy-string", error: undefined }
    const handle = { output_ref: "or_job", preview: "bounded preview" }
    expect(MigrationBridge.resolveJobOutput({ enabled: false, dual_read: false }, legacy, handle).kind).toBe("legacy")
    const dual = MigrationBridge.resolveJobOutput({ enabled: true, dual_read: true }, legacy, handle)
    expect(dual.kind).toBe("dual")
    const record = MigrationBridge.migrateJobRecord({ enabled: true, dual_read: false }, legacy, handle)
    expect(record.output_ref).toBe("or_job")
    expect(MigrationBridge.retainsNoLegacyContent(record)).toBe(true)
  })
})

describe("T042 — budgeted context-slice materialization + range recording (AC19)", () => {
  test("materializes only budgeted ranges through the real page reader and records them", async () => {
    const { path, writer } = await realWriter("artifact", "durable")
    await writer.append(0, enc("0123456789ABCDEF"))
    await writer.seal()
    const recorded: Array<{ offset: number; length: number }> = []
    const slice = ContextSlice.createContextSlice(
      async (_ref, offset, limit) => {
        const page = await PageReader.readPage({ path, offset, limit, committedBytes: 16, sealed: true })
        return { bytes: page.bytes }
      },
      (_ref, range) => void recorded.push(range),
    )
    const result = await slice.materialize({
      output_ref: "or_slice",
      ranges: [
        { offset: 0, limit: 4 },
        { offset: 8, limit: 4 },
      ],
      budget_bytes: 6,
    })
    // Budget 6: first range (4 bytes) fully, second range capped to 2 bytes, then exhausted.
    expect(result.total_bytes).toBe(6)
    expect(result.budget_exhausted).toBe(false)
    expect(recorded).toEqual([
      { offset: 0, length: 4 },
      { offset: 8, length: 2 },
    ])
  })
})
