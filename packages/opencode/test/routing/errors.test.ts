import { describe, expect, test } from "bun:test"
import {
  catalogMismatch,
  describe as describeError,
  invalidArgument,
  is,
  isRoutingError,
  match,
  mutationRisky,
  noAuthorizedCandidate,
  notImplemented,
  ROUTING_ERROR_TYPES,
  unavailable,
  type RoutingError,
} from "@/routing/domain/errors"

describe("T025 routing errors — constructors", () => {
  test("each constructor yields the exact port-contract shape", () => {
    expect(noAuthorizedCandidate("empty")).toEqual({ type: "no_authorized_candidate", reason: "empty" })
    expect(catalogMismatch("01J", "v7")).toEqual({ type: "catalog_mismatch", decisionId: "01J", catalogVersion: "v7" })
    expect(mutationRisky("wrote a file", "a1", "m1")).toEqual({
      type: "mutation_risky",
      reason: "wrote a file",
      agentId: "a1",
      modelId: "m1",
    })
    expect(unavailable("offline")).toEqual({ type: "unavailable", reason: "offline" })
    expect(invalidArgument("scope", "unknown")).toEqual({ type: "invalid_argument", field: "scope", reason: "unknown" })
    expect(notImplemented()).toEqual({ type: "not_implemented" })
  })

  test("the six tags match the contracts/ports.ts union", () => {
    expect([...ROUTING_ERROR_TYPES]).toEqual([
      "no_authorized_candidate",
      "catalog_mismatch",
      "mutation_risky",
      "unavailable",
      "invalid_argument",
      "not_implemented",
    ])
  })
})

describe("T025 routing errors — guards", () => {
  test("isRoutingError accepts every variant and rejects non-errors", () => {
    for (const type of ROUTING_ERROR_TYPES) expect(isRoutingError({ type })).toBe(true)
    expect(isRoutingError(null)).toBe(false)
    expect(isRoutingError({})).toBe(false)
    expect(isRoutingError({ type: "wat" })).toBe(false)
    expect(isRoutingError("no_authorized_candidate")).toBe(false)
  })

  test("is narrows to a specific variant", () => {
    const err: unknown = unavailable("down")
    expect(is(err, "unavailable")).toBe(true)
    expect(is(err, "not_implemented")).toBe(false)
  })
})

describe("T025 routing errors — match + describe", () => {
  test("match dispatches exhaustively", () => {
    const tag = (e: RoutingError) =>
      match(e, {
        no_authorized_candidate: () => "nac",
        catalog_mismatch: () => "cm",
        mutation_risky: () => "mr",
        unavailable: () => "u",
        invalid_argument: () => "ia",
        not_implemented: () => "ni",
      })
    expect(tag(noAuthorizedCandidate("x"))).toBe("nac")
    expect(tag(catalogMismatch("a", "b"))).toBe("cm")
    expect(tag(mutationRisky("wrote", "a", "m"))).toBe("mr")
    expect(tag(unavailable("x"))).toBe("u")
    expect(tag(invalidArgument("f", "r"))).toBe("ia")
    expect(tag(notImplemented())).toBe("ni")
  })

  test("describe is redaction-safe and stable", () => {
    expect(describeError(noAuthorizedCandidate("no pool"))).toBe("no_authorized_candidate: no pool")
    expect(describeError(catalogMismatch("01J", "v7"))).toBe("catalog_mismatch: decision=01J catalog=v7")
    expect(describeError(mutationRisky("wrote a file", "a1", "m1"))).toBe(
      "mutation_risky: wrote a file (agent=a1 model=m1)",
    )
    expect(describeError(invalidArgument("scope", "bad"))).toBe("invalid_argument: scope: bad")
    expect(describeError(notImplemented())).toBe("not_implemented")
  })
})
