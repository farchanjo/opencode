import { describe, expect, test } from "bun:test"
import { Identity } from "@opencode-ai/core/outputspool/identity"

// Feature 005 / T015 (S5) — identity minting and generation fencing. Deterministic
// over an injected entropy port; no I/O (C18, AC11).

const entropyOf = (...tokens: string[]): Identity.EntropyPort => {
  let i = 0
  return { token: () => tokens[i++ % tokens.length]! }
}

const gen = (n: number) => n as unknown as Identity.Generation
const attempt = (n: number) => n as unknown as Identity.Attempt

const groupInput = {
  project_id: "proj_1" as unknown as Identity.ProjectId,
  root_session_id: "root_1" as unknown as Identity.RootSessionId,
  process_id: "proc_1" as unknown as Identity.ProcessId,
  attempt: attempt(1),
  generation: gen(0),
} satisfies Identity.MintGroupInput

describe("Identity — minting round-trip", () => {
  test("mints a group id and carries the fencing key with attempt and generation", () => {
    const minted = Identity.mintGroup(groupInput, entropyOf("grp_abc"))
    expect(minted.id).toBe("grp_abc" as unknown as Identity.GroupId)
    expect(minted.key.attempt).toBe(attempt(1))
    expect(minted.key.generation).toBe(gen(0))
    expect(minted.key.process_id).toBe(groupInput.process_id)
  })

  test("mints an opaque OutputRef bound to exactly one subtree", () => {
    const minted = Identity.mintGroup(groupInput, entropyOf("grp_abc"))
    const channel = Identity.mintOutputRef(
      { group_id: minted.id, generation: gen(0), channel: "stdout" as unknown as Identity.Channel },
      entropyOf("ref_xyz"),
    )
    expect(channel.output_ref).toBe("ref_xyz" as unknown as Identity.OutputRef)
    expect(channel.subtree_key).toBe(Identity.subtreeKey(minted.id, gen(0), "stdout" as unknown as Identity.Channel))
  })
})

describe("Identity — one subtree per ref", () => {
  test("distinct generations resolve to distinct subtrees (no overwrite)", () => {
    const g = "grp_1" as unknown as Identity.GroupId
    const c = "stdout" as unknown as Identity.Channel
    expect(Identity.subtreeKey(g, gen(0), c)).not.toBe(Identity.subtreeKey(g, gen(1), c))
  })

  test("subtreeKey is a stable pure function", () => {
    const g = "grp_1" as unknown as Identity.GroupId
    const c = "artifact" as unknown as Identity.Channel
    expect(Identity.subtreeKey(g, gen(2), c)).toBe(Identity.subtreeKey(g, gen(2), c))
  })
})

describe("Identity — generation fencing", () => {
  test("accepts a writer at the active generation", () => {
    expect(Identity.fence(gen(3), gen(3))).toEqual({ accepted: true, active_generation: gen(3) })
  })

  test("accepts and advances a superseding writer", () => {
    expect(Identity.fence(gen(3), gen(4))).toEqual({ accepted: true, active_generation: gen(4) })
  })

  test("rejects a stale superseded writer", () => {
    expect(Identity.fence(gen(3), gen(2))).toEqual({ accepted: false, reason: "stale_generation" })
  })
})
