/**
 * Feature 004 / T039 (S20) — execution-envelope stamping with start-time version
 * capture (FR18, FR19, FR26, C4, C10, C11, AC4, AC12, AC18, AC21, AC22). The
 * `ExecutionStamp` captures the start-time tag/policy-version/config-version, is
 * deep-frozen (immutable for the running execution), carries the Feature 002 Todo
 * text under the lock via `todo_ref`, and is preserved unchanged across a
 * resume/replay that re-stamps from the same captured start-time inputs.
 */
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LangLockEnvelopeStamper } from "@/langlock/envelope-stamper"
import { Effective } from "@opencode-ai/schema/langlock/effective"

const effective = Schema.decodeUnknownSync(Effective.EffectiveConfig)({
  language: { enabled: true, tag: "pt-BR", display_name: "Portuguese (Brazil)", enforcement_mode: "advisory" },
  authority: { scope: "project", origin: "project", policy_version: 7, override_authorized: true },
})

const stampInput = (
  overrides: Partial<LangLockEnvelopeStamper.StampInput> = {},
): LangLockEnvelopeStamper.StampInput => ({
  effective,
  context: "task_prompt",
  configVersion: 42,
  correlationId: "corr_exec_1",
  tree: { rootSessionId: "ses_root", sessionId: "ses_child", todoRef: "todo_1", outputRef: null },
  capturedAtMs: 1_721_260_800_000,
  ...overrides,
})

describe("T039 stamper — start-time version capture (FR18, C11, AC12)", () => {
  test("captures the effective tag, policy version, and config version at start", () => {
    const { stamp } = LangLockEnvelopeStamper.stampExecution(stampInput())
    expect(String(stamp.language.tag)).toBe("pt-BR")
    expect(Number(stamp.language.policy_version)).toBe(7)
    expect(Number(stamp.language.config_version)).toBe(42)
    expect(stamp.provenance.source).toBe("stamper")
  })

  test("the Todo ref travels under the lock while it is a bounded reference, not chrome (AC21)", () => {
    const { stamp } = LangLockEnvelopeStamper.stampExecution(stampInput())
    expect(String(stamp.tree.todo_ref)).toBe("todo_1")
    expect(String(stamp.tree.root_session_id)).toBe("ses_root")
  })
})

describe("T039 stamper — immutable for the running execution (FR19)", () => {
  test("the stamp is deep-frozen and cannot be mutated by a later tool call", () => {
    const { stamp } = LangLockEnvelopeStamper.stampExecution(stampInput())
    expect(Object.isFrozen(stamp)).toBe(true)
    expect(Object.isFrozen(stamp.language)).toBe(true)
    expect(Object.isFrozen(stamp.tree)).toBe(true)
    expect(() => {
      ;(stamp.language as { tag: string }).tag = "en-US"
    }).toThrow()
    expect(String(stamp.language.tag)).toBe("pt-BR")
  })
})

describe("T039 stamper — preserved across resume/replay/scheduled (FR26, AC4, AC12)", () => {
  test("a replay re-stamp from the same captured start-time inputs is byte-identical", () => {
    const first = LangLockEnvelopeStamper.stampExecution(stampInput())
    const replay = LangLockEnvelopeStamper.stampExecution(stampInput())
    expect(replay.stamp).toEqual(first.stamp)
  })

  test("a resumed child execution inherits the captured tag/version, never a re-resolved one", () => {
    const resumed = LangLockEnvelopeStamper.stampExecution(
      stampInput({ context: "subagent_internal_return", tree: { rootSessionId: "ses_root", sessionId: "ses_grand", todoRef: "todo_1", outputRef: null } }),
    )
    expect(String(resumed.stamp.language.tag)).toBe("pt-BR")
    expect(Number(resumed.stamp.language.policy_version)).toBe(7)
  })
})

describe("T039 stamper — capability boundaries (FR23, AC18)", () => {
  test("native contexts carry the stamp as enforced native metadata", () => {
    expect(LangLockEnvelopeStamper.stampExecution(stampInput({ context: "write_tool" })).capability).toBe("native")
  })

  test("a shell-commit context crosses an unobservable boundary", () => {
    expect(LangLockEnvelopeStamper.stampExecution(stampInput({ context: "shell_commit" })).capability).toBe("boundary")
  })
})
