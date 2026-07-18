/**
 * Feature 005 / T034 (S22) — BackgroundJob/ToolOutputStore migration bridge.
 * Asserts a producer writes an OutputRef and a consumer still reads the legacy
 * string under the dual-read flag, and no per-content-proportional string is
 * retained after cutover (FR31, C16, AC1, AC12).
 */
import { describe, expect, test } from "bun:test"
import { MigrationBridge } from "@/outputspool/migration-bridge"

const handle: MigrationBridge.OutputHandle = { output_ref: "ref-1", preview: "head..." }
const legacy = { output: "the full legacy output string", error: undefined }

describe("migration-bridge", () => {
  test("disabled gate keeps the legacy strings intact (rollback)", () => {
    const view = MigrationBridge.resolveJobOutput({ enabled: false, dual_read: false }, legacy, handle)
    expect(view.kind).toBe("legacy")
    if (view.kind === "legacy") expect(view.output).toBe(legacy.output)
  })

  test("dual-read window exposes both the OutputRef and the legacy string", () => {
    const view = MigrationBridge.resolveJobOutput({ enabled: true, dual_read: true }, legacy, handle)
    expect(view.kind).toBe("dual")
    if (view.kind === "dual") {
      expect(view.output_ref).toBe("ref-1")
      expect(view.output).toBe(legacy.output)
    }
  })

  test("after cutover the OutputRef survives but the per-content string is dropped", () => {
    const record = MigrationBridge.migrateJobRecord({ enabled: true, dual_read: false }, legacy, handle)
    expect(record.output_ref).toBe("ref-1")
    expect(record.preview).toBe("head...")
    expect(MigrationBridge.retainsNoLegacyContent(record)).toBe(true)
  })

  test("dual-read still retains the legacy string during the bounded window", () => {
    const record = MigrationBridge.migrateJobRecord({ enabled: true, dual_read: true }, legacy, handle)
    expect(MigrationBridge.retainsNoLegacyContent(record)).toBe(false)
  })

  test("gateOf projects the schema MigrationState onto the plain gate", () => {
    expect(MigrationBridge.gateOf(null)).toEqual({ enabled: false, dual_read: false })
  })
})
