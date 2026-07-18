/**
 * Feature 004 / T038 — protocol/langlock single-vocabulary discipline (T015, C8).
 *
 * The protocol layer NEVER redeclares the closed langlock enums or the 15-member
 * event vocabulary: it sources them from `@opencode-ai/schema/langlock/*` via
 * `import type`, so the transport contract cannot drift from the wire shape. This
 * suite verifies the sourcing statically (source scan) and pins the runtime
 * vocabulary exports and their type assignability to the schema literals.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EventDefinitions } from "@opencode-ai/schema/langlock/event-definitions"
import type { LangLockEventType } from "@opencode-ai/schema/langlock/event-types"
import {
  DURABLE_LANGLOCK_EVENT_TYPES,
  LIVE_LANGLOCK_EVENT_TYPES,
  type DurableLangLockEventType,
  type LiveLangLockEventType,
} from "../../src/langlock/commands"

const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/langlock/commands.ts", import.meta.url)), "utf8")

describe("protocol/langlock — enums sourced from schema, never redeclared (T015, C8)", () => {
  test("commands.ts imports the closed enums from @opencode-ai/schema/langlock/enums", () => {
    expect(commandsSrc).toContain('from "@opencode-ai/schema/langlock/enums"')
  })

  test("commands.ts sources the 15-member vocabulary type from the schema event-types", () => {
    expect(commandsSrc).toContain('from "@opencode-ai/schema/langlock/event-types"')
    expect(commandsSrc).toContain("export type LangLockEventType = SchemaLangLockEventType")
  })

  test("the sourced enum types are declared as aliases, not re-literalled unions", () => {
    for (const alias of ["Scope", "Origin", "PathKind", "ConfidenceBucket", "DetectorProvenance"]) {
      expect(commandsSrc).toMatch(new RegExp(`export type ${alias} = Schema${alias}`))
    }
  })
})

describe("protocol/langlock — runtime vocabulary parity with the schema Definitions (C8)", () => {
  test("the durable/live constant exports match the schema durable/live split", () => {
    const schemaDurable = new Set(EventDefinitions.DurableDefinitions.map((d) => d.type))
    const schemaLive = new Set(EventDefinitions.LiveDefinitions.map((d) => d.type))
    expect(new Set<string>(DURABLE_LANGLOCK_EVENT_TYPES)).toEqual(schemaDurable)
    expect(new Set<string>(LIVE_LANGLOCK_EVENT_TYPES)).toEqual(schemaLive)
  })

  test("every runtime member is assignable to the schema LangLockEventType", () => {
    const members: LangLockEventType[] = [...DURABLE_LANGLOCK_EVENT_TYPES, ...LIVE_LANGLOCK_EVENT_TYPES]
    expect(members.length).toBe(15)
  })

  test("the durable/live element types narrow to the schema vocabulary", () => {
    const durable: LangLockEventType = DURABLE_LANGLOCK_EVENT_TYPES[0]
    const live: LangLockEventType = LIVE_LANGLOCK_EVENT_TYPES[0]
    const _durableNarrow: DurableLangLockEventType = "langlock.policy_set"
    const _liveNarrow: LiveLangLockEventType = "langlock.advisory_flagged"
    expect(durable).toStartWith("langlock.")
    expect(live).toStartWith("langlock.")
    expect(_durableNarrow).toBe("langlock.policy_set")
    expect(_liveNarrow).toBe("langlock.advisory_flagged")
  })
})
