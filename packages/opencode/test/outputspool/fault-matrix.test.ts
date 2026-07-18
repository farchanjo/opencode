/**
 * Feature 005 / T043 (S27) — the crash + admission fault matrix.
 *
 * Drives the C12 crash matrix and the C4 quota/ENOSPC matrix through the
 * framework-free domain policies (`@opencode-ai/core/outputspool/{reconcile,
 * admission,writer-queue}`) and the application reconciler + real control store,
 * over injected filesystem/fault ports:
 *
 *   - crash BEFORE seal → committed bytes recovered as open, or corrupt/unknown
 *     when the extent is short or the scan did not complete;
 *   - crash AFTER seal BEFORE event → settling re-emits a sealed ref (no silent
 *     empty-success);
 *   - reconciliation into every one of sealed/open/aborted/corrupt/unknown;
 *   - ENOSPC / fd exhaustion / per-scope quota / sustained latency each classify
 *     as a first-class fault, degrade-then-fence past the window, and seal never
 *     reports lost bytes as success (FR10, FR25, C4, C12, AC6-AC10).
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Admission } from "@opencode-ai/core/outputspool/admission"
import { Reconcile } from "@opencode-ai/core/outputspool/reconcile"
import { WriterQueue } from "@opencode-ai/core/outputspool/writer-queue"
import { ControlStore } from "@/outputspool/control-store"
import { Reconciler } from "@/outputspool/reconciler"

const enc = (s: string) => new TextEncoder().encode(s)

describe("T043 crash matrix — reconciliation into every C12 outcome", () => {
  const base = {
    committed_bytes: 10,
    fs_extent: 10,
    seal_record_present: false,
    abort_record_present: false,
    seal_requested: false,
    scan_complete: true,
  }

  test("crash before seal, extent ≥ committed, no terminal record → open (bytes recovered)", () => {
    expect(Reconcile.decide(base)).toBe("open")
  })

  test("crash after seal, seal record present → sealed", () => {
    expect(Reconcile.decide({ ...base, seal_record_present: true })).toBe("sealed")
  })

  test("abort record present → aborted (committed bytes preserved)", () => {
    expect(Reconcile.decide({ ...base, abort_record_present: true })).toBe("aborted")
  })

  test("crash before seal, extent < committed → corrupt (data shorter than authority)", () => {
    expect(Reconcile.decide({ ...base, fs_extent: 4 })).toBe("corrupt")
  })

  test("seal requested but no seal record survived → unknown", () => {
    expect(Reconcile.decide({ ...base, seal_requested: true })).toBe("unknown")
  })

  test("bounded recovery scan did not complete → unknown, never a false success", () => {
    expect(Reconcile.decide({ ...base, scan_complete: false })).toBe("unknown")
    expect(Reconcile.withinScanLimit(1000, 512)).toBe(false)
  })
})

describe("T043 crash-after-seal-before-event — settling re-emits a sealed ref (AC9)", () => {
  test("a seal record that survived the crash re-emits output.reconciled sealed, never empty-success", async () => {
    const store = ControlStore.createControlStore(new Database(":memory:"))
    store.openGeneration({
      output_ref: "or_seal",
      group_id: "g",
      generation: 0,
      channel: "assistant-text",
      durability_tier: "durable",
      correlation_id: "c",
      now: 1,
    })
    store.recordCommitted("or_seal", 10, 1)
    store.recordSeal("or_seal", "tag", 2)
    // Simulate a pre-event snapshot where the state had not yet advanced to sealed.
    store.setState("or_seal", "open", 3)
    const emitted: string[] = []
    const reconciler = Reconciler.createReconciler({
      store,
      extentOf: () => 10,
      emit: (s) => void emitted.push(`${s.output_ref}:${s.outcome}`),
    })
    const settlements = await reconciler.run()
    expect(settlements.length).toBeGreaterThan(0)
    expect(emitted).toContain("or_seal:sealed")
    expect(store.get("or_seal")!.state).toBe("sealed")
  })
})

describe("T043 admission matrix — each fault is first-class (FR10, C4)", () => {
  const cases: ReadonlyArray<{ raw: Admission.RawFault; expected: Admission.AdmissionFault }> = [
    { raw: { kind: "syscall", code: "ENOSPC" }, expected: "enospc" },
    { raw: { kind: "syscall", code: "EMFILE" }, expected: "fd_exhaustion" },
    { raw: { kind: "syscall", code: "ENFILE" }, expected: "fd_exhaustion" },
    { raw: { kind: "syscall", code: "EACCES" }, expected: "permission" },
    { raw: { kind: "quota" }, expected: "quota" },
    { raw: { kind: "latency", latency_ms: 5000, threshold_ms: 1000 }, expected: "latency" },
  ]

  for (const { raw, expected } of cases) {
    test(`${JSON.stringify(raw)} classifies as ${expected}`, () => {
      expect(Admission.classify(raw)).toBe(expected)
    })
  }

  test("a sub-threshold latency and an unknown syscall are not swallowed errors — just no fault", () => {
    expect(Admission.classify({ kind: "latency", latency_ms: 100, threshold_ms: 1000 })).toBe("none")
    expect(Admission.classify({ kind: "syscall", code: "EWHATEVER" })).toBe("none")
    expect(Admission.classify({ kind: "ok" })).toBe("none")
  })
})

describe("T043 degrade-then-fence policy (AC5, AC6, AC7)", () => {
  const WINDOW = 1000

  test("a persistent fault degrades, then fences past the bounded window", () => {
    let state = Admission.observe(Admission.CLEAR, "enospc", 0)
    // Within the window: degrade (backpressure), do not fence yet.
    expect(Admission.shouldFence(state, 500, WINDOW)).toBe(false)
    // A continuation preserves the original since_ms so the window measures real elapsed time.
    state = Admission.observe(state, "enospc", 500)
    expect(Admission.shouldFence(state, 1000, WINDOW)).toBe(true)
  })

  test("a cleared fault resets the window — no early fence after recovery", () => {
    let state = Admission.observe(Admission.CLEAR, "quota", 0)
    state = Admission.observe(state, "none", 200)
    expect(state).toBe(Admission.CLEAR)
    expect(Admission.shouldFence(state, 5000, WINDOW)).toBe(false)
  })

  test("fence outcome: committed intact → aborted; committed lost → corrupt", () => {
    expect(Admission.fenceOutcome(false)).toBe("aborted")
    expect(Admission.fenceOutcome(true)).toBe("corrupt")
  })
})

describe("T043 seal-never-lies (FR24, C4, C12, AC8)", () => {
  test("a sealed extent shorter than the committed authority settles corrupt, never sealed", () => {
    expect(Admission.sealOutcome(100, 100)).toBe("sealed")
    expect(Admission.sealOutcome(100, 101)).toBe("sealed")
    expect(Admission.sealOutcome(100, 40)).toBe("corrupt")
  })
})

describe("T043 ENOSPC on append — backpressure preserves committed bytes (AC5, AC6)", () => {
  test("a stuck writer (0-byte writes, ENOSPC) raises backpressure without losing committed bytes", () => {
    // The injected sink models ENOSPC: it accepts no bytes (write → 0).
    const enospcSink: WriterQueue.WriterSinkPort = { write: () => 0 }
    const caps: WriterQueue.WriterCaps = { queue_depth_cap: 4 }
    let state = WriterQueue.create(0)
    // First append fits under the cap and is queued.
    const first = WriterQueue.enqueue(state, 0, enc("ab"), caps)
    expect(first.kind).toBe("accepted")
    state = first.state
    // The drain writes nothing (ENOSPC) — committed bytes stay put, queue retained.
    const drained = WriterQueue.drain(state, enospcSink)
    expect(drained.written).toBe(0)
    expect(drained.state.committed_bytes).toBe(0)
    state = drained.state
    // A further append past the depth cap raises backpressure, never unbounded growth.
    const over = WriterQueue.enqueue(state, 2, enc("cdef"), caps)
    expect(over.kind).toBe("backpressure")
  })
})
