import { describe, expect, test } from "bun:test"
import { Reconcile } from "@opencode-ai/core/outputspool/reconcile"

// Feature 005 / T022 (S12) — crash reconciliation policy. Pure; never a silent
// empty-success (FR25, C12, AC8, AC9).

const base: Reconcile.ReconcileInput = {
  committed_bytes: 1000,
  fs_extent: 1000,
  seal_record_present: false,
  abort_record_present: false,
  seal_requested: false,
  scan_complete: true,
}

describe("Reconcile — committed-length authority", () => {
  test("extent >= committed with a seal record recovers sealed", () => {
    expect(Reconcile.decide({ ...base, seal_record_present: true })).toBe("sealed")
  })
  test("extent >= committed with an abort record recovers aborted", () => {
    expect(Reconcile.decide({ ...base, abort_record_present: true })).toBe("aborted")
  })
  test("extent >= committed, no terminal record, no seal intent recovers open", () => {
    expect(Reconcile.decide(base)).toBe("open")
  })
  test("extent < committed recovers corrupt", () => {
    expect(Reconcile.decide({ ...base, fs_extent: 800 })).toBe("corrupt")
  })
  test("seal requested but no seal record recovers unknown", () => {
    expect(Reconcile.decide({ ...base, seal_requested: true })).toBe("unknown")
  })
  test("an incomplete bounded scan recovers unknown", () => {
    expect(Reconcile.decide({ ...base, scan_complete: false })).toBe("unknown")
  })
})

describe("Reconcile — record and batch", () => {
  test("carries the committed length and observed extent, never re-authored", () => {
    const r = Reconcile.reconcile({ ...base, seal_record_present: true })
    expect(r).toEqual({ outcome: "sealed", committed_bytes: 1000, recovered_extent: 1000 })
  })
  test("a zero-committed group still recovers an explicit state (never empty-success)", () => {
    const r = Reconcile.reconcile({ ...base, committed_bytes: 0, fs_extent: 0 })
    expect(r.outcome).toBe("open")
  })
  test("reconcileBatch maps each input", () => {
    const out = Reconcile.reconcileBatch([base, { ...base, fs_extent: 500 }])
    expect(out.map((r) => r.outcome)).toEqual(["open", "corrupt"])
  })
})

describe("Reconcile — bounded scan limit", () => {
  test("withinScanLimit gates the recovery scan", () => {
    expect(Reconcile.withinScanLimit(10, 100)).toBe(true)
    expect(Reconcile.withinScanLimit(200, 100)).toBe(false)
  })
})
