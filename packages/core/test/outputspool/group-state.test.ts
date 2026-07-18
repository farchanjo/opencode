import { describe, expect, test } from "bun:test"
import { GroupState } from "@opencode-ai/core/outputspool/group-state"

// Feature 005 / T017 (S7) — the OutputGroup channel-generation state machine.
// Pure, total, never throws; illegal edges surface as an anomaly and a terminal
// state is never invented or regressed (FR19, C20, AC8, AC10).

type State = GroupState.GroupStateValue

const expectTransition = (state: State, trigger: GroupState.Trigger, to: State) => {
  const r = GroupState.apply(state, trigger)
  expect(r.kind).toBe("transition")
  if (r.kind === "transition") expect(r.to).toBe(to)
}
const expectUnchanged = (state: State, trigger: GroupState.Trigger) => {
  const r = GroupState.apply(state, trigger)
  expect(r.kind).toBe("unchanged")
}
const expectIllegal = (state: State, trigger: GroupState.Trigger) => {
  expect(GroupState.apply(state, trigger).kind).toBe("illegal")
}

describe("GroupState — states", () => {
  test("exposes exactly the seven states and five terminals", () => {
    expect(GroupState.GROUP_STATES).toHaveLength(7)
    expect(GroupState.TERMINAL_STATES).toHaveLength(5)
    expect(GroupState.isTerminal("sealed")).toBe(true)
    expect(GroupState.isTerminal("open")).toBe(false)
  })
})

describe("GroupState — legal transitions", () => {
  test("open lifecycle", () => {
    expectUnchanged("open", "append")
    expectTransition("open", "seal_requested", "sealing")
    expectTransition("open", "abort", "aborted")
    expectTransition("open", "fault_persistent", "corrupt")
    expectTransition("open", "recover_indeterminate", "unknown")
  })
  test("sealing lifecycle", () => {
    expectTransition("sealing", "seal_committed", "sealed")
    expectTransition("sealing", "abort", "aborted")
    expectTransition("sealing", "fault_persistent", "corrupt")
  })
  test("release to expired from sealed/aborted", () => {
    expectTransition("sealed", "release", "expired")
    expectTransition("aborted", "release", "expired")
  })
})

describe("GroupState — illegal transitions", () => {
  test("append after seal is illegal", () => {
    expectIllegal("sealed", "append")
    expectIllegal("sealing", "append")
  })
  test("terminal states are absorbing", () => {
    expectIllegal("corrupt", "release")
    expectIllegal("unknown", "seal_requested")
    expectIllegal("expired", "append")
  })
  test("idempotent redelivery of the terminal trigger is unchanged", () => {
    expectUnchanged("sealed", "seal_committed")
    expectUnchanged("aborted", "abort")
  })
})

describe("GroupState — settle preserves committed bytes", () => {
  test("abort preserves the committed byte count", () => {
    const s = GroupState.settle("open", 2048, "abort")
    expect(s.state).toBe("aborted")
    expect(s.committed_bytes).toBe(2048)
  })
  test("an illegal trigger leaves state and bytes untouched", () => {
    const s = GroupState.settle("sealed", 512, "append")
    expect(s.state).toBe("sealed")
    expect(s.committed_bytes).toBe(512)
    expect(s.result.kind).toBe("illegal")
  })
})
