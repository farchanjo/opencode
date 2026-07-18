/**
 * Feature 006 / T014 — protocol/semantic shape parity against the normative design
 * contract `contracts/ports.ts`, reconciled to the CUE authority mirrored by
 * `packages/schema/src/semantic/*` (FR3, FR7, FR9, FR12, FR19, FR29, FR30, FR38, C1,
 * C15, C16, C20).
 *
 * `doc/arch/sdd/006-.../contracts/ports.ts` is the plan-phase interface DRAFT and is
 * DIVERGENT: it presents a 20-member dotted event vocabulary, a 6-member
 * `DegradationGapCode`, a 5-member `CapabilityKind`, and an underscore-spelled
 * `RerankProfile`. The CUE corpus is the authority. `packages/protocol/src/semantic/**`
 * SOURCES its reconciled enums from `@opencode-ai/schema/semantic/*` and this suite
 * pins:
 *
 *   1. The reconciled closed 12-member `semantic.*` vocabulary (9 durable / 3 live,
 *      underscore-named) is IDENTICAL, member-for-member, between the protocol mirror
 *      and `@opencode-ai/schema/semantic/event-definitions` — and DIVERGES from the
 *      draft's 20-member dotted vocabulary (the reconciliation is intentional).
 *   2. The reconciled `RerankProfile` (3), `CapabilityKind` (4), `DegradationGap` (8),
 *      `BindingState` (5) and `GenerationState` (5) enums match the schema authority
 *      and are sourced from `@opencode-ai/schema/semantic/*` in the protocol mirror.
 *   3. The port interfaces expose the same method names, and the typed error unions
 *      keep the same closed discriminant set, as the draft (these did not diverge).
 *   4. The 30 reserved `semantic.*` command IDs match the draft mirror exactly.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { EventDefinitions } from "@opencode-ai/schema/semantic/event-definitions"
import { Enums } from "@opencode-ai/schema/semantic/enums"
import { EnumsState } from "@opencode-ai/schema/semantic/enums-state"
import {
  DURABLE_SEMANTIC_EVENT_TYPES,
  LIVE_SEMANTIC_EVENT_TYPES,
  RESERVED_SEMANTIC_COMMAND_IDS,
} from "../../src/semantic/commands"

const draftSrc = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/contracts/ports.ts",
      import.meta.url,
    ),
  ),
  "utf8",
)
const commandsSrc = readFileSync(fileURLToPath(new URL("../../src/semantic/commands.ts", import.meta.url)), "utf8")
const portsSrc = readFileSync(fileURLToPath(new URL("../../src/semantic/ports.ts", import.meta.url)), "utf8")

/** Extract the quoted members of a `const NAME = [ ... ] as const` array. */
function parseConstArray(src: string, name: string): string[] {
  const match = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`))
  if (!match) throw new Error(`const array ${name} not found`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Extract every `type: "..."` discriminant from a closed error union. */
function parseErrorDiscriminants(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)(?:\\n\\n|$)`))
  if (!match) throw new Error(`error union ${name} not found`)
  return [...match[1].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
}

/** Extract the `readonly <name>:` method keys of an `export interface NAME { ... }` block. */
function parseInterfaceMembers(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`interface ${name} not found`)
  return [...match[1].matchAll(/readonly\s+(\w+):/g)].map((m) => m[1])
}

const literalMembers = (schema: { readonly ast: unknown }): string[] => {
  const ast = schema.ast as { readonly types?: ReadonlyArray<{ readonly literal?: unknown }> }
  return (ast.types ?? []).map((t) => String(t.literal))
}

const asSet = (values: Iterable<string>) => new Set(values)

describe("T014 parity — reconciled closed 12-member semantic.* vocabulary (C22)", () => {
  const protocolDurable = parseConstArray(commandsSrc, "DURABLE_SEMANTIC_EVENT_TYPES")
  const protocolLive = parseConstArray(commandsSrc, "LIVE_SEMANTIC_EVENT_TYPES")
  const schemaTypes = EventDefinitions.Definitions.map((d) => d.type)

  test("the protocol vocabulary equals the schema authority's 12-member set (9 durable / 3 live)", () => {
    const protocolUnion = asSet([...protocolDurable, ...protocolLive])
    expect(protocolUnion.size).toBe(12)
    expect(asSet(schemaTypes)).toEqual(protocolUnion)
    expect(protocolDurable.length).toBe(9)
    expect(protocolLive.length).toBe(3)
  })

  test("the durable/live split matches the schema authority exactly", () => {
    expect([...protocolDurable].sort()).toEqual([...EventDefinitions.DurableDefinitions.map((d) => d.type)].sort())
    expect([...protocolLive].sort()).toEqual([...EventDefinitions.LiveDefinitions.map((d) => d.type)].sort())
  })

  test("durable and live members are disjoint and every member is underscore-named", () => {
    expect(protocolDurable.filter((t) => protocolLive.includes(t))).toEqual([])
    for (const member of [...protocolDurable, ...protocolLive]) {
      expect(member.startsWith("semantic.")).toBe(true)
      expect(member.slice("semantic.".length)).not.toContain(".")
    }
  })

  test("the runtime exports equal the parsed protocol source", () => {
    expect(([...DURABLE_SEMANTIC_EVENT_TYPES] as string[]).sort()).toEqual([...protocolDurable].sort())
    expect(([...LIVE_SEMANTIC_EVENT_TYPES] as string[]).sort()).toEqual([...protocolLive].sort())
  })

  test("the reconciliation DIVERGES from the draft's 20-member dotted vocabulary (intentional)", () => {
    const draftUnion = asSet([
      ...parseConstArray(draftSrc, "DURABLE_SEMANTIC_EVENT_TYPES"),
      ...parseConstArray(draftSrc, "LIVE_SEMANTIC_EVENT_TYPES"),
    ])
    expect(draftUnion.size).toBe(20)
    expect(draftUnion).not.toEqual(asSet([...protocolDurable, ...protocolLive]))
  })
})

describe("T014 parity — reconciled enums match the schema authority (C16, C20)", () => {
  test("RerankProfile is the hyphen-spelled 3-member set with embedding-similarity", () => {
    const members = literalMembers(Enums.RerankProfile)
    expect(members.length).toBe(3)
    expect(asSet(members)).toEqual(asSet(["native-rerank", "structured-chat", "embedding-similarity"]))
  })

  test("CapabilityKind is the 4-member set; embedding-similarity is distinct from reranker", () => {
    const members = literalMembers(Enums.CapabilityKind)
    expect(members.length).toBe(4)
    expect(asSet(members)).toEqual(asSet(["embedding", "reranker", "embedding-similarity", "multilingual"]))
  })

  test("DegradationGap is the 8-member ladder set", () => {
    expect(literalMembers(EnumsState.DegradationGap).length).toBe(8)
  })

  test("BindingState and GenerationState are the 5-member lifecycles", () => {
    expect(literalMembers(EnumsState.BindingState).length).toBe(5)
    expect(literalMembers(EnumsState.GenerationState).length).toBe(5)
  })

  test("the protocol mirror SOURCES these enums from @opencode-ai/schema/semantic/*", () => {
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/enums"')
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/enums-state"')
    expect(commandsSrc).toContain('from "@opencode-ai/schema/semantic/event-types"')
    expect(commandsSrc).toContain("RerankProfile as SchemaRerankProfile")
    expect(commandsSrc).toContain("CapabilityKind as SchemaCapabilityKind")
    expect(commandsSrc).toContain("DegradationGap as SchemaDegradationGap")
  })
})

describe("T014 parity — typed error unions match the draft (C15, C20)", () => {
  const unions: ReadonlyArray<{ name: string; expectedSize: number }> = [
    { name: "ProviderError", expectedSize: 10 },
    { name: "ModelError", expectedSize: 10 },
    { name: "BindingError", expectedSize: 11 },
    { name: "IndexError", expectedSize: 6 },
    { name: "RetrievalError", expectedSize: 5 },
    { name: "EvalError", expectedSize: 5 },
  ]

  for (const { name, expectedSize } of unions) {
    test(`${name} carries the same closed discriminant set in the draft and the protocol mirror`, () => {
      const draft = asSet(parseErrorDiscriminants(draftSrc, name))
      const protocol = asSet(parseErrorDiscriminants(commandsSrc, name))
      expect(draft.size).toBe(expectedSize)
      expect(protocol).toEqual(draft)
    })
  }

  test("the required guard discriminants are present across the unions (T014)", () => {
    const all = asSet([
      ...parseErrorDiscriminants(commandsSrc, "ProviderError"),
      ...parseErrorDiscriminants(commandsSrc, "BindingError"),
      ...parseErrorDiscriminants(commandsSrc, "IndexError"),
      ...parseErrorDiscriminants(commandsSrc, "RetrievalError"),
      ...parseErrorDiscriminants(commandsSrc, "ModelError"),
    ])
    for (const required of [
      "ssrf_blocked",
      "not_validated",
      "reranker_not_eligible",
      "vector_space_mismatch",
      "cas_conflict",
      "confirmation_required",
      "milvus_unavailable",
      "no_candidate_staged",
      "budget_exceeded",
      "fail_closed_denied",
    ]) {
      expect(all.has(required)).toBe(true)
    }
  })
})

describe("T014 parity — port interface method surfaces (FR3, FR29, FR35)", () => {
  const ports: ReadonlyArray<{ name: string; members: string[] }> = [
    { name: "ProviderPort", members: ["list", "add", "update", "test", "disable", "delete", "rotateSecret"] },
    { name: "ModelPort", members: ["list", "discover", "register", "validate", "disable"] },
    {
      name: "BindingPort",
      members: [
        "showEmbedding",
        "selectEmbedding",
        "validateEmbedding",
        "reindexEmbedding",
        "cutoverEmbedding",
        "rollbackEmbedding",
        "showReranker",
        "selectReranker",
        "validateReranker",
        "cutoverReranker",
        "rollbackReranker",
        "status",
        "history",
      ],
    },
    { name: "IndexPort", members: ["status", "test", "reindex", "reconcile", "showCollections"] },
    { name: "RetrievalPort", members: ["retrieveAgents", "retrieveSkills"] },
    { name: "EvalPort", members: ["runGolden"] },
  ]

  for (const { name, members } of ports) {
    test(`${name} exposes the same method names in the draft and the protocol mirror`, () => {
      expect(parseInterfaceMembers(draftSrc, name).sort()).toEqual([...members].sort())
      expect(parseInterfaceMembers(portsSrc, name).sort()).toEqual([...members].sort())
    })
  }
})

describe("T014 parity — 30 reserved semantic.* command IDs (C15)", () => {
  test("the protocol mirror lists the same 30 reserved IDs as the draft", () => {
    const draft = parseConstArray(draftSrc, "RESERVED_SEMANTIC_COMMAND_IDS")
    expect(draft.length).toBe(30)
    expect(([...RESERVED_SEMANTIC_COMMAND_IDS] as string[]).sort()).toEqual([...draft].sort())
    expect(new Set(RESERVED_SEMANTIC_COMMAND_IDS).size).toBe(30)
  })
})
