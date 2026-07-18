import { describe, expect, test } from "bun:test"
import { authorizationHeader, scopeFromFlag } from "./dispatch"

describe("operator dispatch helpers", () => {
  test("scopeFromFlag binds the cwd for project scope and null for global", () => {
    expect(scopeFromFlag("global")).toEqual({ kind: "global", ref: null })
    expect(scopeFromFlag("project", "/repo")).toEqual({ kind: "project", ref: "/repo" })
  })

  test("authorizationHeader reads a plain record header", () => {
    expect(authorizationHeader({ Authorization: "Basic abc" })).toBe("Basic abc")
    expect(authorizationHeader({ authorization: "Basic xyz" })).toBe("Basic xyz")
  })

  test("authorizationHeader reads a Headers instance case-insensitively", () => {
    expect(authorizationHeader(new Headers({ Authorization: "Basic h" }))).toBe("Basic h")
  })

  test("authorizationHeader reads a tuple array header", () => {
    expect(authorizationHeader([["authorization", "Basic t"]])).toBe("Basic t")
  })

  test("authorizationHeader returns undefined when absent", () => {
    expect(authorizationHeader(undefined)).toBeUndefined()
    expect(authorizationHeader({})).toBeUndefined()
  })
})
