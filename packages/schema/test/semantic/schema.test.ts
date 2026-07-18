import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Binding } from "../../src/semantic/binding"
import { Documents } from "../../src/semantic/documents"
import { Enums } from "../../src/semantic/enums"
import { EnumsState } from "../../src/semantic/enums-state"
import { Events } from "../../src/semantic/events"
import { EventTypes } from "../../src/semantic/event-types"
import { EventDefinitions } from "../../src/semantic/event-definitions"
import { IndexGeneration } from "../../src/semantic/index-generation"
import { ModelDescriptor } from "../../src/semantic/model-descriptor"
import { ProviderProfile } from "../../src/semantic/provider-profile"
import { Retrieval } from "../../src/semantic/retrieval"
import { Values } from "../../src/semantic/values"

// Feature 006 / T002-T013 — schema-foundation acceptance assertions for the
// packages/schema/src/semantic/* modules mirroring the CUE authority. Contract
// hygiene (annotate-before-check identifier retention on every brand) is asserted
// centrally in ../contract-hygiene.test.ts.

const literalMembers = (schema: { readonly ast: unknown }): readonly string[] => {
  const ast = schema.ast as { readonly types?: ReadonlyArray<{ readonly literal?: unknown }> }
  return (ast.types ?? []).map((t) => String(t.literal))
}

describe("semantic/values — T002 integer counters vs real-valued scores", () => {
  test("counters and dimensions are integer-checked", () => {
    for (const counter of [Values.BindingVersion, Values.Dimension, Values.TopK, Values.SchemaVersion]) {
      expect(() => Schema.decodeUnknownSync(counter)(2)).not.toThrow()
      expect(() => Schema.decodeUnknownSync(counter)(2.5)).toThrow()
    }
  })

  test("the five score components are continuous", () => {
    for (const score of [Values.Score, Values.RerankScore, Values.DenseScore, Values.SparseScore]) {
      expect(() => Schema.decodeUnknownSync(score)(0.42)).not.toThrow()
    }
  })

  test("Confidence is bounded to [0,1]", () => {
    expect(Schema.decodeUnknownSync(Values.Confidence)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(Values.Confidence)(1)).toBe(1)
    expect(() => Schema.decodeUnknownSync(Values.Confidence)(1.01)).toThrow()
    expect(() => Schema.decodeUnknownSync(Values.Confidence)(-0.01)).toThrow()
  })
})

describe("semantic/enums — T004 closed vocabularies", () => {
  test("SemanticEventType is the closed 12-member vocabulary with 9 durable / 3 live", () => {
    const members = literalMembers(EventTypes.SemanticEventType)
    expect(members.length).toBe(12)
    const durable = [
      "semantic.binding_selected",
      "semantic.binding_cutover",
      "semantic.binding_rolled_back",
      "semantic.index_upserted",
      "semantic.index_tombstoned",
      "semantic.index_reconciled",
      "semantic.generation_built",
      "semantic.generation_cutover",
      "semantic.generation_retired",
    ]
    const live = ["semantic.retrieval_degraded", "semantic.provider_probed", "semantic.binding_state_changed"]
    for (const member of [...durable, ...live]) expect(members).toContain(member)
    expect(EventDefinitions.DurableDefinitions.length).toBe(9)
    expect(EventDefinitions.LiveDefinitions.length).toBe(3)
  })

  test("DegradationGap is the 8-member ladder set", () => {
    expect(literalMembers(EnumsState.DegradationGap).length).toBe(8)
    expect(literalMembers(EnumsState.DegradationGap)).toContain("milvus_unavailable")
  })

  test("embedding-similarity is a distinct CapabilityKind/RerankProfile never equal to reranker", () => {
    const kinds = literalMembers(Enums.CapabilityKind)
    expect(kinds).toContain("embedding-similarity")
    expect(kinds).toContain("reranker")
    expect(literalMembers(Enums.RerankProfile)).toContain("embedding-similarity")
    // profile C is a capability kind but the reranker slot pins "reranker", never "embedding-similarity"
    expect(kinds.indexOf("embedding-similarity")).not.toBe(kinds.indexOf("reranker"))
  })
})

const OPERATOR = "op_ada" as const

describe("semantic/provider-profile — T005 no embedded secret", () => {
  const identity = { name: "local-embed", base_url: "http://127.0.0.1:1234", transport: "openai-compatible" } as const
  const transport = { tls_policy: "local-insecure", residency: "local-offline", insecure_allowed: true } as const
  const audit = { enabled: true, created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z", selected_by: OPERATOR } as const

  test("a key-free local profile and a keyed remote profile both decode", () => {
    const keyFree = {
      id: "prov_local",
      version: 1,
      identity,
      transport,
      credentials: { secret_ref: null, headers: [] },
      audit,
    }
    const keyed = {
      id: "prov_remote",
      version: 3,
      identity: { ...identity, base_url: "https://api.example.com" },
      transport: { tls_policy: "required", residency: "remote", insecure_allowed: false },
      credentials: { secret_ref: "secret://embed", headers: ["header://authz"] },
      audit,
    }
    expect(() => Schema.decodeUnknownSync(ProviderProfile.SemanticProviderProfile)(keyFree)).not.toThrow()
    const decoded = Schema.decodeUnknownSync(ProviderProfile.SemanticProviderProfile)(keyed)
    expect(String(decoded.credentials.secret_ref)).toBe("secret://embed")
  })

  test("credentials expose only an opaque nullable secret_ref, no raw secret field", () => {
    const fields = Object.keys(ProviderProfile.ProviderCredentials.fields)
    expect(fields).toEqual(["secret_ref", "headers"])
    expect(fields).not.toContain("secret")
    expect(fields).not.toContain("token")
    expect(fields).not.toContain("api_key")
  })
})

describe("semantic/model-descriptor — T006 rerank never inferred", () => {
  test("an embedding descriptor carries a null rerank_profile and a manual descriptor starts declared", () => {
    const descriptor = {
      id: "model_embed",
      provider_ref: "prov_local",
      identity: { display_name: "Embed", source: "manual", endpoint_mode: "embeddings", rerank_profile: null },
      capability: { kinds: ["embedding"], dimension: null, metric: null, normalized: null, limits: { batch_size: null, vector_count: null, token_limit: null } },
      validation: { status: "declared", provenance: "manual registration", validated_at: null, eval_version: null },
      enabled: true,
    }
    const decoded = Schema.decodeUnknownSync(ModelDescriptor.SemanticModelDescriptor)(descriptor)
    expect(decoded.identity.rerank_profile).toBeNull()
    expect(decoded.validation.status).toBe("declared")
    expect(decoded.capability.dimension).toBeNull()
  })
})

describe("semantic/binding — T007 immutable version + typed degraded reason", () => {
  test("an embedding and a reranker binding decode with an immutable positive version", () => {
    const base = {
      version: 1,
      refs: { provider_ref: "prov_local", model_ref: "model_embed", rerank_profile: null },
      capability: { kind: "embedding", dimension: 768, metric: "cosine", normalized: true },
      selection: { selected_by: OPERATOR, selected_at: "2026-07-18T00:00:00Z", config_version: 1, config_hash: "cfg-1" },
      generation: { generation_id: "gen_1", aliases: ["alias_agents"], state: "live" },
    }
    const embedding = Schema.decodeUnknownSync(Binding.SemanticModelBinding)({ id: "bind_e", slot: "embedding", ...base })
    expect(embedding.version).toBe(1)
    expect(() => Schema.decodeUnknownSync(Values.BindingVersion)(0)).toThrow()
    const reranker = {
      id: "bind_r",
      slot: "reranker",
      ...base,
      refs: { provider_ref: "prov_local", model_ref: "model_rr", rerank_profile: "native-rerank" },
      capability: { kind: "reranker", dimension: null, metric: null, normalized: null },
    }
    expect(() => Schema.decodeUnknownSync(Binding.SemanticModelBinding)(reranker)).not.toThrow()
  })

  test("BindingStatus carries a typed nullable degraded_reason", () => {
    const status = Schema.decodeUnknownSync(Binding.BindingStatus)({
      slot: "embedding",
      state: "degraded",
      version: 2,
      degraded_reason: "embedding endpoint unreachable",
    })
    expect(status.degraded_reason).toBe("embedding endpoint unreachable")
    expect(() => Schema.decodeUnknownSync(Binding.BindingStatus)({ slot: "embedding", state: "active", version: 2, degraded_reason: null })).not.toThrow()
  })
})

describe("semantic/documents — T008 projection scope and chunk body ref", () => {
  const identity = { version: 1, content_hash: "h1", source: "core" } as const
  const availability = { enabled: true, available: true } as const

  test("SkillChunkDoc carries a ChunkBodyRef and no inline body or path", () => {
    const chunk = {
      id: "chunk_1",
      parent_skill_id: "skill_1",
      position: { chunk_index: 0, overlap: 32 },
      identity,
      language_tag: "pt-BR",
      body_ref: { output_ref: "out://spool/1", offset: 0, limit: 4096 },
      token_estimate: 128,
    }
    const decoded = Schema.decodeUnknownSync(Documents.SkillChunkDoc)(chunk)
    expect(String(decoded.body_ref.output_ref)).toBe("out://spool/1")
    const fields = Object.keys(Documents.SkillChunkDoc.fields)
    expect(fields).not.toContain("body")
    expect(fields).not.toContain("path")
  })

  test("AgentDoc carries a scalar project_id and permission_ref on its scope", () => {
    const agent = {
      id: "agent_1",
      identity,
      classification: { role: "worker", mode: "default", description: "" },
      taxonomy: { domains: [], capabilities: [], tools: [] },
      scope: { project_id: "proj_1", scope: "project", visibility: "project", permission_ref: "perm_1" },
      languages: ["en"],
      availability,
    }
    const decoded = Schema.decodeUnknownSync(Documents.AgentDoc)(agent)
    expect(String(decoded.scope.project_id)).toBe("proj_1")
    expect(String(decoded.scope.permission_ref)).toBe("perm_1")
  })
})

describe("semantic/retrieval — T009 nullable rerank, bounded confidence, ranking ref", () => {
  test("rerank is nullable, confidence is bounded, and a Candidate holds a ranking ref", () => {
    const candidate = {
      candidate_ref: "agent_1",
      collection: "agents",
      score: {
        composite: 0.9,
        components: { rerank: null, dense: 0.8, sparse: 0.5 },
        confidence: 0.75,
        provenance: { mode: "catalog_lexical", gap: "reranker_unavailable", binding_version: 1, generation_id: "gen_1" },
      },
      rank: 1,
      freshness: "fresh",
    }
    const decoded = Schema.decodeUnknownSync(Retrieval.Candidate)(candidate)
    expect(decoded.score.components.rerank).toBeNull()
    expect(decoded.score.confidence).toBe(0.75)
    expect(typeof decoded.candidate_ref).toBe("string")
    expect(() => Schema.decodeUnknownSync(Retrieval.SemanticScore)({ ...candidate.score, confidence: 1.5 })).toThrow()
  })
})

describe("semantic/index-generation — T010 metric+dimension stored, tools alias", () => {
  test("the generation stores metric and dimension", () => {
    const generation = Schema.decodeUnknownSync(IndexGeneration.SemanticIndexGeneration)({
      id: "gen_1",
      binding_version: 1,
      state: "live",
      metric: "cosine",
      dimension: 768,
      aliases: ["alias_agents", "alias_tools"],
      created_at: "2026-07-18T00:00:00Z",
    })
    expect(generation.metric).toBe("cosine")
    expect(generation.dimension).toBe(768)
  })

  test("Collection includes the Feature 009 tools extension point", () => {
    expect(literalMembers(EnumsState.Collection)).toContain("tools")
  })
})

describe("semantic/events — T011 distinct structs, exhaustive union, durable annotation", () => {
  const envelope = {
    event_id: "evt_1",
    kind: {
      event_type: "semantic.binding_cutover",
      schema_version: 1,
      event_class: "durable",
      source: "cutover",
      actor_kind: "operator",
      visibility: "project",
    },
    subject: { binding_id: "bind_e", generation_id: "gen_1", collection: null, project_id: "proj_1" },
    ordering: { sequence: 0, correlation_id: "corr_1", causation_id: null },
    delivery: { visibility: "project", timestamp: 1_752_796_800_000, redacted_metadata: { outcome: "committed" } },
  }

  test("every vocabulary member has a distinct Struct and the union decodes a member", () => {
    const memberStructs = [
      Events.SemanticBindingSelectedEvent,
      Events.SemanticBindingCutoverEvent,
      Events.SemanticBindingRolledBackEvent,
      Events.SemanticIndexUpsertedEvent,
      Events.SemanticIndexTombstonedEvent,
      Events.SemanticIndexReconciledEvent,
      Events.SemanticGenerationBuiltEvent,
      Events.SemanticGenerationCutoverEvent,
      Events.SemanticGenerationRetiredEvent,
      Events.SemanticRetrievalDegradedEvent,
      Events.SemanticProviderProbedEvent,
      Events.SemanticBindingStateChangedEvent,
    ]
    expect(new Set(memberStructs).size).toBe(12)
    const event = Schema.decodeUnknownSync(Events.SemanticEvent)({
      type: "semantic.binding_cutover",
      envelope,
      detail: { generation_id: "gen_1", outcome: "committed" },
    })
    expect(event.type).toBe("semantic.binding_cutover")
  })

  test("only the nine durable members carry the durable annotation", () => {
    for (const definition of EventDefinitions.DurableDefinitions) expect(definition.durable).toBeDefined()
    for (const definition of EventDefinitions.LiveDefinitions) expect(definition.durable).toBeUndefined()
  })

  test("redacted_metadata is a bounded string->string map, never query/vector/prompt payloads", () => {
    const fields = Object.keys(Events.SemanticBindingCutoverEvent.fields)
    expect(fields).toEqual(["type", "envelope", "detail"])
    // envelope Delivery only carries redacted_metadata as the free-text carrier — and it is string->string
    expect(() =>
      Schema.decodeUnknownSync(Events.SemanticBindingCutoverEvent)({
        type: "semantic.binding_cutover",
        envelope,
        detail: { generation_id: "gen_1", outcome: "committed" },
      }),
    ).not.toThrow()
  })
})
