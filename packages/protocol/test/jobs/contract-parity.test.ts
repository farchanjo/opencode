/**
 * Feature 003 / T032 — protocol/jobs shape parity against the normative
 * design contract `contracts/ports.ts` (FR11, FR12, FR22, FR32, C8, C15,
 * AC29).
 *
 * `doc/arch/sdd/003-.../contracts/ports.ts` is the plan-phase interface
 * draft. `packages/protocol/src/jobs/**` is the implemented TypeScript
 * mirror — plain `interface`/`type` declarations (unlike
 * `packages/protocol/src/lifecycle/**`, which is itself Effect `Schema`).
 * This suite pins the parity that MUST hold:
 *
 *   1. The closed 30-member `job.*` event vocabulary and its durable/live
 *      split (`DURABLE_JOB_EVENT_TYPES` / `LIVE_JOB_EVENT_TYPES`) are
 *      IDENTICAL, member-for-member, across the draft, the protocol mirror,
 *      and `@opencode-ai/schema/jobs/event-definitions` — no wire
 *      normalization is applied on either side (both already carry the
 *      `job.` prefix), unlike the Feature 002 lifecycle precedent.
 *   2. `SchedulerError` / `NotificationError` / `JobsError` keep the same
 *      set of `type` discriminants across the draft and the protocol mirror.
 *
 * It also PINS the deliberate divergence documented in
 * `packages/protocol/src/jobs/commands.ts`'s own header comment: the
 * protocol enums (`NotificationType`, `ActionType`, `DeliveryState`,
 * `AckState`) are a distinct camelCase operator-surface projection, NOT the
 * persisted snake_case domain enums in `packages/schema/src/jobs/enums*.ts`
 * — an unflagged convergence would mean one side drifted without updating
 * the other.
 *
 * Both source files are parsed from text (never imported as a module for the
 * type-only unions — they carry no runtime representation), mirroring the
 * source-scan style of `packages/protocol/test/lifecycle/contract-parity.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EventDefinitions } from "@opencode-ai/schema/jobs/event-definitions"
import { DURABLE_JOB_EVENT_TYPES, LIVE_JOB_EVENT_TYPES } from "../../src/jobs/commands"

const draftSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../doc/arch/sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/contracts/ports.ts",
      import.meta.url,
    ),
  ),
  "utf8",
)
const protocolSrc = readFileSync(fileURLToPath(new URL("../../src/jobs/commands.ts", import.meta.url)), "utf8")

/** Extract the quoted members of a `const NAME = [ ... ] as const` array. */
function parseConstArray(src: string, name: string): string[] {
  const match = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`))
  if (!match) throw new Error(`const array ${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the quoted members of an `export type NAME = "a" | "b" | ...` union. */
function parseUnionType(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|\\nexport |\\n/\\*)`))
  if (!match) throw new Error(`union type ${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract every `{ readonly type: "..." ... }` discriminant from a closed error union. */
function parseErrorDiscriminants(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|$)`))
  if (!match) throw new Error(`error union ${name} not found`)
  return [...match[1].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
}

const asSet = (values: Iterable<string>) => new Set(values)

describe("T032 contract parity — closed 30-member job.* vocabulary (FR11)", () => {
  const draftDurable = parseConstArray(draftSrc, "DURABLE_JOB_EVENT_TYPES")
  const draftLive = parseConstArray(draftSrc, "LIVE_JOB_EVENT_TYPES")
  const protocolDurable = parseConstArray(protocolSrc, "DURABLE_JOB_EVENT_TYPES")
  const protocolLive = parseConstArray(protocolSrc, "LIVE_JOB_EVENT_TYPES")
  const schemaTypes = EventDefinitions.Definitions.map((d) => d.type)

  test("the draft's DURABLE ∪ LIVE is exactly the protocol's and the schema's 30-member vocabulary", () => {
    const draftUnion = asSet([...draftDurable, ...draftLive])
    const protocolUnion = asSet([...protocolDurable, ...protocolLive])
    const schemaUnion = asSet(schemaTypes)
    expect(draftUnion.size).toBe(30)
    expect(protocolUnion).toEqual(draftUnion)
    expect(schemaUnion).toEqual(draftUnion)
  })

  test("durable and live members are disjoint in the draft and the protocol mirror", () => {
    expect(draftDurable.filter((t) => draftLive.includes(t))).toEqual([])
    expect(protocolDurable.filter((t) => protocolLive.includes(t))).toEqual([])
  })

  test("the runtime DURABLE_JOB_EVENT_TYPES / LIVE_JOB_EVENT_TYPES exports equal the parsed protocol source", () => {
    const runtimeDurable: string[] = [...DURABLE_JOB_EVENT_TYPES]
    const runtimeLive: string[] = [...LIVE_JOB_EVENT_TYPES]
    expect(runtimeDurable.sort()).toEqual([...protocolDurable].sort())
    expect(runtimeLive.sort()).toEqual([...protocolLive].sort())
  })
})

describe("T032 contract parity — durable-versus-live split (C8)", () => {
  const draftDurable = asSet(parseConstArray(draftSrc, "DURABLE_JOB_EVENT_TYPES"))
  const draftLive = asSet(parseConstArray(draftSrc, "LIVE_JOB_EVENT_TYPES"))
  const schemaDurable = asSet(EventDefinitions.DurableDefinitions.map((d) => d.type))
  const schemaLive = asSet(EventDefinitions.LiveDefinitions.map((d) => d.type))

  test("the twenty-three durable members match the draft exactly — no prefix normalization needed", () => {
    expect(schemaDurable.size).toBe(23)
    expect([...schemaDurable].sort()).toEqual([...draftDurable].sort())
  })

  test("the seven live members match the draft exactly", () => {
    expect(schemaLive.size).toBe(7)
    expect([...schemaLive].sort()).toEqual([...draftLive].sort())
  })

  test("no schema member is classified as both durable and live", () => {
    for (const t of schemaDurable) expect(schemaLive.has(t)).toBe(false)
  })
})

describe("T032 contract parity — typed error unions (FR30, C9, C12)", () => {
  const unions: ReadonlyArray<{ name: string; expectedSize: number }> = [
    { name: "SchedulerError", expectedSize: 6 },
    { name: "NotificationError", expectedSize: 6 },
    { name: "JobsError", expectedSize: 8 },
  ]

  for (const { name, expectedSize } of unions) {
    test(`${name} carries the same closed set of type discriminants in the draft and the protocol mirror`, () => {
      const draft = asSet(parseErrorDiscriminants(draftSrc, name))
      const protocol = asSet(parseErrorDiscriminants(protocolSrc, name))
      expect(draft.size).toBe(expectedSize)
      expect(protocol).toEqual(draft)
    })
  }

  test("JobsError carries reserved_name — guards C13 job.*/jobs.* collisions", () => {
    expect(asSet(parseErrorDiscriminants(protocolSrc, "JobsError")).has("reserved_name")).toBe(true)
  })

  test("SchedulerError carries second_authority_rejected — guards FR3/FR6 (no second scheduler authority)", () => {
    expect(asSet(parseErrorDiscriminants(protocolSrc, "SchedulerError")).has("second_authority_rejected")).toBe(true)
  })

  test("NotificationError carries cross_scope_leak_rejected — guards FR21/AC9", () => {
    expect(asSet(parseErrorDiscriminants(protocolSrc, "NotificationError")).has("cross_scope_leak_rejected")).toBe(
      true,
    )
  })
})

describe("T032 contract parity — protocol operator-surface enums are pinned as an intentional projection", () => {
  // The protocol layer is a distinct camelCase operator-surface projection,
  // never the persisted snake_case domain enum (see the header comment in
  // packages/protocol/src/jobs/commands.ts). An unflagged convergence with
  // the domain enum below would mean the projection collapsed back into the
  // internal representation, contradicting that documented boundary.
  test("protocol ActionType diverges from the schema domain enum (wake_or_structured_input vs main_context_wake)", () => {
    const protocolActionType = asSet(parseUnionType(protocolSrc, "ActionType"))
    const schemaActionType = new Set([
      "native_maintenance",
      "operator_notification",
      "main_context_wake",
      "smart_routing_dispatch",
      "approved_workflow",
    ])
    expect(protocolActionType).not.toEqual(schemaActionType)
    expect(protocolActionType.has("wake_or_structured_input")).toBe(true)
    expect(schemaActionType.has("main_context_wake")).toBe(true)
  })

  test("protocol NotificationType diverges from the schema domain enum (occurrence_-prefixed outcomes vs bare terms)", () => {
    const protocolNotificationType = asSet(parseUnionType(protocolSrc, "NotificationType"))
    const schemaNotificationType = new Set([
      "occurrence_settled",
      "occurrence_failed",
      "occurrence_cancelled",
      "occurrence_timed_out",
      "misfire",
      "reconciled",
      "operator_advisory",
    ])
    expect(protocolNotificationType).not.toEqual(schemaNotificationType)
    expect(protocolNotificationType.has("occurrence_completed")).toBe(true)
    expect(schemaNotificationType.has("occurrence_settled")).toBe(true)
  })

  test("protocol DeliveryState diverges from the schema domain enum (pending vs enqueued)", () => {
    const protocolDeliveryState = asSet(parseUnionType(protocolSrc, "DeliveryState"))
    const schemaDeliveryState = new Set(["enqueued", "queued", "coalesced", "delivered", "expired"])
    expect(protocolDeliveryState).not.toEqual(schemaDeliveryState)
    expect(protocolDeliveryState.has("pending")).toBe(true)
    expect(schemaDeliveryState.has("enqueued")).toBe(true)
  })

  test("protocol AckState diverges from the schema domain enum (not_applicable vs expired)", () => {
    const protocolAckState = asSet(parseUnionType(protocolSrc, "AckState"))
    const schemaAckState = new Set(["unacknowledged", "acknowledged", "expired"])
    expect(protocolAckState).not.toEqual(schemaAckState)
    expect(protocolAckState.has("not_applicable")).toBe(true)
    expect(schemaAckState.has("expired")).toBe(true)
  })
})
