# Data Model: Semantic Agent and Skill Retrieval (Feature 006)

Feature: [006 Semantic Agent and Skill Retrieval (Milvus)](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
ADR: [ADR-0008 Milvus-Backed Multilingual Semantic Retrieval and Reranking Stack](../../adr/0008-milvus-semantic-retrieval-stack.md) (proposed)
Status: draft (finalized in the tasks phase; topology constants, index parameters,
`top_k`/latency budgets, chunk/cache constants, cutover alias grammar, SSRF denylist
CIDRs, and eval thresholds are provisional plan constants resolved in ADR-0008 and its
successors — C1–C12, C16–C20, C22)

Three record families here are the single source of truth and nothing else is: the
**`SemanticProviderProfile`**, **`SemanticModelDescriptor`**, and
**`SemanticModelBinding`** aggregates own the operator-pinned provider/model/binding
field definitions (FR28); Feature 007 references these schemas and exposes operator
commands without redefining or diverging field sets (FR28, C15). Every other shape
below is a **derived, rebuildable projection or a transient value object** — never a
second registry, availability authority, permission authority, or route decider beside
AgentV2/SkillV2/Catalog/Permission and Feature 001 (FR1, FR2, C21). Milvus documents
(`AgentDoc`, `SkillDoc`, `SkillChunkDoc`) are a projection of core state; every
retrieved candidate is revalidated against live AgentV2/SkillV2/Permission before
injection (FR20, FR27, C11). No record embeds a secret, a full prompt, reasoning, a
private payload, or a filesystem path; credentials are Feature 007 SecretPort refs only
and skill bodies are reached through Feature 005 OutputSpool refs (FR17, FR35, FR40, C4,
C9, C19).

Durable `semantic.*` index/binding/cutover events register through `EventV2.define` into
`packages/schema/src/durable-event-manifest.ts` and publish through a new
`publishSemanticEvent` boundary on the existing `EventV2Bridge`, mirroring the Feature
002 lifecycle, Feature 003 jobs, Feature 004 langlock, and Feature 005 output patterns
(C22). Live degradation/probe/state signals use the bounded live channel and may be
dropped under `allBounded` load without affecting durable replay (C22). Telemetry is
content-free per ADR-0001: labels never carry query text, vectors, entity IDs, session
IDs, or paths (FR42, C22).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface, matching
`packages/schema/src/schema.ts` and the existing `packages/schema/src/lifecycle/**`,
`jobs/**`, `langlock/**`, and `outputspool/**` modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- **Annotate-first on a plain base for every checked scalar.** Each identifier,
  counter, dimension, and bounded-text ValueObject is built on the plain `Schema.String`
  / `Schema.Number` base, `.annotate({ identifier })` is applied BEFORE any `.check(...)`,
  and `Schema.brand(...)` (where the CUE definition is identifier-shaped) is applied
  last. Annotating an already-checked schema drops the root identifier from
  `.ast.annotations` in favor of the last check, so base-then-check-then-brand is
  load-bearing for contract hygiene (see `packages/schema/src/lifecycle/ids.ts`,
  `values.ts`, and `test/contract-hygiene.test.ts`).
- Version counters, dimensions, and byte windows fold `Schema.isInt()` into the check
  chain alongside the bound check. Unlike the Feature 005 offset domain, this feature is
  **deliberately real-valued for score components**: `Score`, `RerankScore`,
  `DenseScore`, `SparseScore`, and `Confidence` are `Schema.Number` (no `isInt`), because
  cosine/inner-product similarity and cross-encoder relevance are continuous (FR19, FR22,
  C7). `Confidence` is bounded to `[0, 1]`.
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- Epoch-millis observational timestamps decode through `DateTimeUtcFromMillis`; the CUE
  mirror carries the ISO-8601 `#Timestamp` string form.
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / `Schema.Number`
  (bare) forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/semantic/**` and mirrors a
CUE definition under `doc/arch/schemas/semantic/*.cue` one-to-one. The CUE packages are
`semantic.shared`, `semantic.enums`, `semantic.provider`, `semantic.model`,
`semantic.binding`, `semantic.documents`, `semantic.profile`, `semantic.retrieval`,
`semantic.index`, and `semantic.events`.

---

## Shared identifiers

Name parity with `routing.shared`, `lifecycle.shared`, and `outputspool.shared` is
intentional; this feature does not cross-import those modules, so the identifier
concepts are re-declared locally (FR1, FR2, C21). Mirrors `doc/arch/schemas/semantic/ids.cue`.

```typescript
// packages/schema/src/semantic/ids.ts (new)

import { Schema } from "effect"

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const modelPattern = /^[A-Za-z0-9_-]{1,160}$/
const chunkPattern = /^[A-Za-z0-9_-]{1,192}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// ProviderProfileId identifies one SemanticProviderProfile aggregate (FR28, C19).
export const ProviderProfileId = Schema.String.annotate({ identifier: "SemanticIds.ProviderProfileId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.ProviderProfileId"))
export type ProviderProfileId = typeof ProviderProfileId.Type

// ModelDescriptorId is the canonical model ref identifying one SemanticModelDescriptor (FR28, C3).
export const ModelDescriptorId = Schema.String.annotate({ identifier: "SemanticIds.ModelDescriptorId" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.ModelDescriptorId"))

// BindingId identifies one SemanticModelBinding aggregate for a slot (FR28, C12).
export const BindingId = Schema.String.annotate({ identifier: "SemanticIds.BindingId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.BindingId"))

// AgentDocId / SkillDocId / SkillChunkId key the projection documents (FR10, FR11, C6, C9).
export const AgentDocId = Schema.String.annotate({ identifier: "SemanticIds.AgentDocId" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.AgentDocId"))
export const SkillDocId = Schema.String.annotate({ identifier: "SemanticIds.SkillDocId" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.SkillDocId"))
export const SkillChunkId = Schema.String.annotate({ identifier: "SemanticIds.SkillChunkId" })
  .check(Schema.isPattern(chunkPattern)).pipe(Schema.brand("Semantic.SkillChunkId"))

// GenerationId / CollectionAliasId key the blue/green index generation lifecycle (FR12, C12).
export const GenerationId = Schema.String.annotate({ identifier: "SemanticIds.GenerationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.GenerationId"))
export const CollectionAliasId = Schema.String.annotate({ identifier: "SemanticIds.CollectionAliasId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.CollectionAliasId"))

// ProjectId is the scalar project partition key filtered on every search (FR9, FR34, C6).
export const ProjectId = Schema.String.annotate({ identifier: "SemanticIds.ProjectId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.ProjectId"))

// EventId is the EventV2 evt_ id assigned per published semantic.* event (C22).
export const EventId = Schema.String.annotate({ identifier: "SemanticIds.EventId" })
  .check(Schema.isPattern(eventIdPattern)).pipe(Schema.brand("Semantic.EventId"))
```

Cross-reference, secret, principal, and correlation ValueObjects keep opaque handles
only; a candidate ref is a ranking pointer into live core state, never an embedded
Entity (FR20, FR34, C11), and a skill body is reached only through a Feature 005
OutputRef (FR40, C9). Mirrors `refs.cue` and `correlation.cue`.

```typescript
// packages/schema/src/semantic/refs.ts (new)

// ProviderRef / ModelRef / ParentSkillId / AgentRef / SkillRef — ranking and lineage pointers.
export const ProviderRef = Schema.String.annotate({ identifier: "SemanticRefs.ProviderRef" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.ProviderRef"))
export const ModelRef = Schema.String.annotate({ identifier: "SemanticRefs.ModelRef" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.ModelRef"))
export const ParentSkillId = Schema.String.annotate({ identifier: "SemanticRefs.ParentSkillId" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.ParentSkillId"))
export const AgentRef = Schema.String.annotate({ identifier: "SemanticRefs.AgentRef" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.AgentRef"))
export const SkillRef = Schema.String.annotate({ identifier: "SemanticRefs.SkillRef" })
  .check(Schema.isPattern(modelPattern)).pipe(Schema.brand("Semantic.SkillRef"))

// PermissionRef gates the PermissionV2 profile evaluated before and after search (FR34, C11).
export const PermissionRef = Schema.String.annotate({ identifier: "SemanticRefs.PermissionRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Semantic.PermissionRef"))

// SecretRef / HeaderRef are Feature 007 SecretPort secure references — never raw material (FR35, C19).
export const SecretRef = Schema.String.annotate({ identifier: "SemanticRefs.SecretRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Semantic.SecretRef"))
export const HeaderRef = Schema.String.annotate({ identifier: "SemanticRefs.HeaderRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Semantic.HeaderRef"))

// OperatorRef is the operator principal re-evaluated per action (FR35, C15).
export const OperatorRef = Schema.String.annotate({ identifier: "SemanticRefs.OperatorRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Semantic.OperatorRef"))

// OutputRef is a Feature 005 OutputSpool content handle for a sanitized chunk body (FR40, C9).
export const OutputRef = Schema.String.annotate({ identifier: "SemanticRefs.OutputRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Semantic.OutputRef"))

// Correlation and telemetry-span refs; trace/span live in traces/logs only (FR42, C22).
export const CorrelationId = Schema.String.annotate({ identifier: "SemanticRefs.CorrelationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.CorrelationId"))
export const CausationId = Schema.String.annotate({ identifier: "SemanticRefs.CausationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.CausationId"))
export const DecisionId = Schema.String.annotate({ identifier: "SemanticRefs.DecisionId" })
  .check(Schema.isPattern(/^[0-9A-HJKMNP-TV-Z]{26}$/)).pipe(Schema.brand("Semantic.DecisionId"))
```

---

## Version, dimension, budget, and score values

Version, dimension, and window counters keep primitive obsession out of the aggregates;
the embedding dimension/normalization/metric are stored with the collection generation
and never inferred (FR12, C12). Budget windows are consumed from the Feature 001
Context, Turn and Delegation Budget and never free-form (FR38, C8). Mirrors `values.cue`,
`budget-values.cue`, and `score-values.cue`.

```typescript
// packages/schema/src/semantic/values.ts (new)

export const BindingVersion = Schema.Number.annotate({ identifier: "SemanticValues.BindingVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // immutable version counter (FR31, C12)
export const SchemaVersion = Schema.Number.annotate({ identifier: "SemanticValues.SchemaVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // EventV2 durable.version mirror (C22)
export const ConfigVersion = Schema.Number.annotate({ identifier: "SemanticValues.ConfigVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // cache/config generation (FR25, C10)
export const Dimension = Schema.Number.annotate({ identifier: "SemanticValues.Dimension" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // stored embedding dimensionality (FR12, C7)
export const Sequence = Schema.Number.annotate({ identifier: "SemanticValues.Sequence" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // per-aggregate durable order (C22)
export const ByteOffset = Schema.Number.annotate({ identifier: "SemanticValues.ByteOffset" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // into a Feature 005 chunk ref (FR40, C9)
export const ByteLimit = Schema.Number.annotate({ identifier: "SemanticValues.ByteLimit" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
export const ChunkIndex = Schema.Number.annotate({ identifier: "SemanticValues.ChunkIndex" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const ChunkOverlap = Schema.Number.annotate({ identifier: "SemanticValues.ChunkOverlap" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // fixed overlap; plan constant (FR11, AC12)

// Budget windows consumed from the Feature 001 budget; provisional defaults (FR38, C8, AC12, AC17).
export const TopK = Schema.Number.annotate({ identifier: "SemanticBudget.TopK" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // retrieval_top_k 64 / rerank_top_k 16
export const ChunkBudget = Schema.Number.annotate({ identifier: "SemanticBudget.ChunkBudget" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // max_skill_chunks 8 provisional
export const TokenBudget = Schema.Number.annotate({ identifier: "SemanticBudget.TokenBudget" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const BatchSize = Schema.Number.annotate({ identifier: "SemanticBudget.BatchSize" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // server-capped probe batch (FR30, AC23)
export const VectorCount = Schema.Number.annotate({ identifier: "SemanticBudget.VectorCount" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
export const LatencyBudgetMs = Schema.Number.annotate({ identifier: "SemanticBudget.LatencyBudgetMs" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // timeout triggers C20 fallback (NFR1, C8)

// Real-valued score components (deliberately not isInt); confidence bounded [0,1] (FR19, FR22, C7).
export const Score = Schema.Number.annotate({ identifier: "SemanticScore.Score" })
  .check(Schema.isGreaterThanOrEqualTo(0))
export const RerankScore = Schema.Number.annotate({ identifier: "SemanticScore.RerankScore" })     // tie-break key 1 (C2)
export const DenseScore = Schema.Number.annotate({ identifier: "SemanticScore.DenseScore" })       // tie-break key 2 (C2)
export const SparseScore = Schema.Number.annotate({ identifier: "SemanticScore.SparseScore" })     // tie-break key 3 (C2)
export const Confidence = Schema.Number.annotate({ identifier: "SemanticScore.Confidence" })
  .check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))
export const FreshnessAgeMs = Schema.Number.annotate({ identifier: "SemanticScore.FreshnessAgeMs" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // feeds the freshness bucket (FR27, C11, AC5)
```

Bounded content-classified text, hash, and flag ValueObjects exclude secrets, full
prompts, reasoning, private payloads, and paths (FR17, C4); a language tag preserves the
original query language for embedding without a mandatory translation LLM call (FR14,
FR15). Mirrors `text-values.cue` and `hash-values.cue`.

```typescript
// packages/schema/src/semantic/text-values.ts (new)

const languageTagPattern = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/

export const Name = Schema.String.annotate({ identifier: "SemanticText.Name" }).check(Schema.isNonEmpty())
export const DisplayName = Schema.String.annotate({ identifier: "SemanticText.DisplayName" }).check(Schema.isNonEmpty())
export const Description = Schema.String.annotate({ identifier: "SemanticText.Description" }) // ranking signal only (FR36)
export const BaseUrl = Schema.String.annotate({ identifier: "SemanticText.BaseUrl" }).check(Schema.isNonEmpty()) // SSRF-parsed (FR33, C17)
export const LanguageTag = Schema.String.annotate({ identifier: "SemanticText.LanguageTag" })
  .check(Schema.isPattern(languageTagPattern))            // BCP 47 provenance (FR14, FR16)
export const Tag = Schema.String.annotate({ identifier: "SemanticText.Tag" }).check(Schema.isNonEmpty()) // domain/capability/trigger/tool/role
export const ModeTag = Schema.String.annotate({ identifier: "SemanticText.ModeTag" }).check(Schema.isNonEmpty())
export const DegradedReason = Schema.String.annotate({ identifier: "SemanticText.DegradedReason" }).check(Schema.isNonEmpty())
export const Reason = Schema.String.annotate({ identifier: "SemanticText.Reason" })

export const ContentHash = Schema.String.annotate({ identifier: "SemanticHash.ContentHash" }).check(Schema.isNonEmpty()) // incremental upsert (FR13, AC10)
export const ConfigHash = Schema.String.annotate({ identifier: "SemanticHash.ConfigHash" }).check(Schema.isNonEmpty())   // cache invalidation (FR25, C10)
export const Fingerprint = Schema.String.annotate({ identifier: "SemanticHash.Fingerprint" }).check(Schema.isNonEmpty()) // query-cache key (FR18, C10)
export const Enabled = Schema.Boolean.annotate({ identifier: "SemanticFlags.Enabled" })
export const Available = Schema.Boolean.annotate({ identifier: "SemanticFlags.Available" })   // mirrors live core; revalidated (FR20, C11)
export const Normalized = Schema.Boolean.annotate({ identifier: "SemanticFlags.Normalized" }) // stored per generation (FR12, C7)
export const InsecureAllowed = Schema.Boolean.annotate({ identifier: "SemanticFlags.InsecureAllowed" }) // local profile only (FR33, C17)
```

First-class collections replace bare arrays across documents, bindings, and profiles;
each wraps a shared ValueObject element. A ref set holds ranking pointers, never embedded
Entities (FR20, C11). Mirrors `collections.cue`.

```typescript
// packages/schema/src/semantic/collections.ts (new)

export const TagSet = Schema.Array(Tag)               // domains/capabilities/triggers/tools/roles (FR10, FR11)
export const LanguageSet = Schema.Array(LanguageTag)  // BCP 47 provenance set (FR14, FR16)
export const AgentRefSet = Schema.Array(AgentRef)     // ranking pointers (FR20, C11)
export const SkillRefSet = Schema.Array(SkillRef)
export const HeaderRefSet = Schema.Array(HeaderRef)   // secure outbound header refs (FR35, C19)
export const AliasRefSet = Schema.Array(CollectionAliasId) // swapped together at cutover (FR12, C12)
```

---

## Enumerations

Core, lifecycle, event, and event-type enums mirror `enums.cue`, `enums-state.cue`,
`enums-event.cue`, and `event-types.cue`. Every enum is a ValueObject, never an Entity
(calisthenics). Rerank profile C (`embedding-similarity`) is a DISTINCT capability and
is never reranker-eligible (FR30, C16).

```typescript
// packages/schema/src/semantic/enums.ts (new)

export const Slot = Schema.Literals(["embedding", "reranker"]).annotate({ identifier: "SemanticEnums.Slot" })
export const TransportProfile = Schema.Literals(["openai-compatible", "custom"]).annotate({ identifier: "SemanticEnums.TransportProfile" })
export const RerankProfile = Schema.Literals(["native-rerank", "structured-chat", "embedding-similarity"])
  .annotate({ identifier: "SemanticEnums.RerankProfile" })   // C is never reranker-eligible (FR30, C16)
export const EndpointMode = Schema.Literals(["embeddings", "rerank", "chat-completions"]).annotate({ identifier: "SemanticEnums.EndpointMode" })
export const Consistency = Schema.Literals(["bounded", "strong"]).annotate({ identifier: "SemanticEnums.Consistency" }) // bounded default (FR20, C6)
export const CapabilityKind = Schema.Literals(["embedding", "reranker", "embedding-similarity", "multilingual"])
  .annotate({ identifier: "SemanticEnums.CapabilityKind" })
export const Metric = Schema.Literals(["cosine", "inner-product"]).annotate({ identifier: "SemanticEnums.Metric" })     // on normalized vectors (FR12, C7)
export const IndexType = Schema.Literals(["hnsw", "ivf"]).annotate({ identifier: "SemanticEnums.IndexType" })            // HNSW default (FR12, C7)
export const ModelSource = Schema.Literals(["discovered", "manual", "core-catalog"]).annotate({ identifier: "SemanticEnums.ModelSource" })
export const ValidationStatus = Schema.Literals(["validated", "declared", "failed", "stale"])
  .annotate({ identifier: "SemanticEnums.ValidationStatus" }) // untrusted until validated (FR30, C16, AC22)

// packages/schema/src/semantic/enums-state.ts (new)

export const BindingState = Schema.Literals(["draft", "staged", "active", "degraded", "unavailable"])
  .annotate({ identifier: "SemanticEnums.BindingState" })     // degraded/unavailable never auto-substitute (FR31, C20)
export const GenerationState = Schema.Literals(["building", "validated", "live", "superseded", "retired"])
  .annotate({ identifier: "SemanticEnums.GenerationState" })
export const DegradationGap = Schema.Literals([
  "none", "milvus_unavailable", "embedding_unavailable", "reranker_unavailable",
  "index_stale", "retrieval_timeout", "no_binding", "cold_index",
]).annotate({ identifier: "SemanticEnums.DegradationGap" })   // typed gap code (FR24, C20, AC29)
export const RetrievalMode = Schema.Literals(["full_semantic", "catalog_lexical", "fail_closed"])
  .annotate({ identifier: "SemanticEnums.RetrievalMode" })    // catalog_lexical is the floor (FR24, C14)
export const ResidencyProfile = Schema.Literals(["local-offline", "local", "remote"]).annotate({ identifier: "SemanticEnums.ResidencyProfile" })
export const TlsPolicy = Schema.Literals(["required", "local-insecure"]).annotate({ identifier: "SemanticEnums.TlsPolicy" })
export const Collection = Schema.Literals(["agents", "skills", "skill_chunks", "tools"]).annotate({ identifier: "SemanticEnums.Collection" }) // tools = Feature 009 (C21)
export const ScopeKind = Schema.Literals(["project", "global", "session"]).annotate({ identifier: "SemanticEnums.ScopeKind" })
export const Visibility = Schema.Literals(["project", "global", "shared"]).annotate({ identifier: "SemanticEnums.Visibility" })
export const RoleKind = Schema.Literals(["architect", "manager", "worker"]).annotate({ identifier: "SemanticEnums.RoleKind" })

// packages/schema/src/semantic/enums-event.ts (new)

export const EventClass = Schema.Literals(["durable", "live"]).annotate({ identifier: "SemanticEnums.EventClass" })
export const EventSource = Schema.Literals(["operator", "indexer", "reconciler", "retriever", "cutover"]).annotate({ identifier: "SemanticEnums.EventSource" })
export const ActorKind = Schema.Literals(["runtime", "operator"]).annotate({ identifier: "SemanticEnums.ActorKind" }) // no LLM administers (FR31, C15)
export const CutoverOutcome = Schema.Literals(["committed", "contended", "rolled-back"]).annotate({ identifier: "SemanticEnums.CutoverOutcome" })
export const FreshnessBucket = Schema.Literals(["fresh", "bounded", "stale"]).annotate({ identifier: "SemanticEnums.FreshnessBucket" })
```

The closed `semantic.*` event vocabulary mirrors `event-types.cue`. The `semantic.*`
event prefix is the Feature 006 retrieval-plane event namespace on EventV2; it is
DISTINCT from the Feature 007 `semantic.*` operator command domain
(`semantic.provider|model|embedding|reranker|binding|index.*`); both are reserved (C15,
C22).

```typescript
// packages/schema/src/semantic/event-types.ts (new)

// The closed 12-member semantic.* vocabulary — 9 durable, 3 live (C22).
export const SemanticEventType = Schema.Literals([
  "semantic.binding_selected", "semantic.binding_cutover", "semantic.binding_rolled_back",
  "semantic.index_upserted", "semantic.index_tombstoned", "semantic.index_reconciled",
  "semantic.generation_built", "semantic.generation_cutover", "semantic.generation_retired",
  "semantic.retrieval_degraded", "semantic.provider_probed", "semantic.binding_state_changed",
]).annotate({ identifier: "SemanticEnums.SemanticEventType" })
export type SemanticEventType = typeof SemanticEventType.Type
```

---

## SemanticProviderProfile aggregate (FR28, C5, C17, C19)

The SSOT aggregate root of one OpenAI-compatible provider endpoint. Its identity is `id`
(the `ProviderProfileId`); it embeds no secret — credentials are Feature 007 SecretPort
refs only, and a local endpoint may be key-free (FR29, FR35, C19, AC19). Its base URL is
parsed under the SSRF-safe policy (FR33, C17). Sub-objects each stay within the
calisthenics field bound. Mirrors `provider-profile.cue` and `provider-parts.cue`.

```typescript
// packages/schema/src/semantic/provider-profile.ts (new)

export const ProviderIdentity = Schema.Struct({
  name: Name,
  base_url: BaseUrl,
  transport: TransportProfile,
})

// TLS/residency/insecure posture — local-offline blocks remote egress (FR33, FR37, C4, C17).
export const ProviderTransport = Schema.Struct({
  tls_policy: TlsPolicy,
  residency: ResidencyProfile,
  insecure_allowed: InsecureAllowed,
})

// Optional secret ref and secure header refs — never raw material (FR35, C19).
export const ProviderCredentials = Schema.Struct({
  secret_ref: Schema.NullOr(SecretRef),
  headers: HeaderRefSet,
})

export const ProviderAudit = Schema.Struct({
  enabled: Enabled,
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  selected_by: OperatorRef,
})

export const SemanticProviderProfile = Schema.Struct({
  id: ProviderProfileId,                  // aggregate-root identity (FR28)
  version: BindingVersion,                // immutable; changes on endpoint/compat change, not rotation (FR31)
  identity: ProviderIdentity,
  transport: ProviderTransport,
  credentials: ProviderCredentials,
  audit: ProviderAudit,
})
export type SemanticProviderProfile = Schema.Schema.Type<typeof SemanticProviderProfile>
```

---

## SemanticModelDescriptor aggregate (FR28, C3, C16)

The SSOT aggregate root of one embedding or rerank model at a provider. Its identity is
`id` (the canonical model ref). Rerank capability is never inferred from a model name; a
manual descriptor is untrusted until native probe/eval passes (FR30, C16, AC22). The
embedding dimension/normalization/metric are captured from the deterministic
`/v1/embeddings` probe and stored, never inferred (FR12, FR30, C5, C7). Mirrors
`model-descriptor.cue` and `model-parts.cue`.

```typescript
// packages/schema/src/semantic/model-descriptor.ts (new)

export const ModelIdentity = Schema.Struct({
  display_name: DisplayName,
  source: ModelSource,
  endpoint_mode: EndpointMode,
  rerank_profile: Schema.NullOr(RerankProfile), // null for embedding models (FR30, C16)
})

export const CapabilityKindSet = Schema.Array(CapabilityKind)

// Server-capped probe limits; null when unknown (FR30, C5, AC23).
export const ModelLimits = Schema.Struct({
  batch_size: Schema.NullOr(BatchSize),
  vector_count: Schema.NullOr(VectorCount),
  token_limit: Schema.NullOr(TokenBudget),
})

export const ModelCapability = Schema.Struct({
  kinds: CapabilityKindSet,
  dimension: Schema.NullOr(Dimension),
  metric: Schema.NullOr(Metric),
  normalized: Schema.NullOr(Normalized),
  limits: ModelLimits,
})

export const ModelValidation = Schema.Struct({
  status: ValidationStatus,               // untrusted until validated (FR30, C16, AC22)
  provenance: Reason,
  validated_at: Schema.NullOr(DateTimeUtcFromMillis),
  eval_version: Schema.NullOr(ConfigVersion),
})

export const SemanticModelDescriptor = Schema.Struct({
  id: ModelDescriptorId,                  // canonical model ref (FR28)
  provider_ref: ProviderRef,
  identity: ModelIdentity,
  capability: ModelCapability,
  validation: ModelValidation,
  enabled: Enabled,
})
export type SemanticModelDescriptor = Schema.Schema.Type<typeof SemanticModelDescriptor>
```

---

## SemanticModelBinding aggregate + BindingStatus (FR28, FR31, C12, C20)

The SSOT aggregate root pinning one model to one slot. Its identity is `id`; the version
is immutable and bindings persist across sessions, restarts, resume, and jobs until an
operator changes them via Feature 007 (FR31). No LLM/router/agent/plugin/MCP sets,
updates, or deletes a binding (FR31, C3, C15). `BindingStatus` is the runtime read model
carrying the `degraded`/`unavailable` state and a typed reason; retrieval never
auto-substitutes another model (FR24, C20, AC29). Mirrors `binding.cue` and
`binding-parts.cue`.

```typescript
// packages/schema/src/semantic/binding.ts (new)

export const BindingRefs = Schema.Struct({
  provider_ref: ProviderRef,
  model_ref: ModelRef,
  rerank_profile: Schema.NullOr(RerankProfile),
})

// Effective capability stored so incompatible vectors are never mixed (FR12, C12).
export const CapabilityContract = Schema.Struct({
  kind: CapabilityKind,
  dimension: Schema.NullOr(Dimension),
  metric: Schema.NullOr(Metric),
  normalized: Schema.NullOr(Normalized),
})

export const BindingSelection = Schema.Struct({
  selected_by: OperatorRef,
  selected_at: DateTimeUtcFromMillis,
  config_version: ConfigVersion,
  config_hash: ConfigHash,                // caches invalidate by binding version + config hash (FR25, C10)
})

export const BindingGeneration = Schema.Struct({
  generation_id: GenerationId,
  aliases: AliasRefSet,                   // swapped together at cutover (FR12, C12)
  state: GenerationState,
})

export const SemanticModelBinding = Schema.Struct({
  id: BindingId,                          // aggregate-root identity (FR28)
  slot: Slot,
  version: BindingVersion,                // immutable (FR31, C12)
  refs: BindingRefs,
  capability: CapabilityContract,
  selection: BindingSelection,
  generation: BindingGeneration,
})
export type SemanticModelBinding = Schema.Schema.Type<typeof SemanticModelBinding>

// Runtime status read model; degraded/unavailable never auto-substitutes (FR24, FR31, C20).
export const BindingStatus = Schema.Struct({
  slot: Slot,
  state: BindingState,
  version: BindingVersion,
  degraded_reason: Schema.NullOr(DegradedReason),
})
export type BindingStatus = Schema.Schema.Type<typeof BindingStatus>
```

---

## Collection documents (FR10, FR11, FR17, C4, C6, C9)

`AgentDoc`, `SkillDoc`, and `SkillChunkDoc` are the derived projections in the `agents`,
`skills`, and `skill_chunks` collections. Each is an **Entity** (stable canonical
identity across content-hash upserts). Descriptions, domains, capabilities, and triggers
are ranking signals only; a malicious description never alters router policy or hard
gates (FR36, AC11). Volatile health/cost are never authority fields (FR10, FR23). Skills
are lazy: the summary is indexed first and full bodies are chunked into `skill_chunks`,
sanitized (secrets/prompts/reasoning/paths stripped), and reached through a Feature 005
OutputSpool ref — never stored inline or duplicated into context (FR17, FR39, FR40, C4,
C9). Mirrors `document-shared.cue`, `document-parts.cue`, `agent-doc.cue`, `skill-doc.cue`,
and `chunk-doc.cue`.

```typescript
// packages/schema/src/semantic/documents.ts (new)

export const DocIdentity = Schema.Struct({
  version: ConfigVersion,
  content_hash: ContentHash,              // drives incremental upsert/tombstone (FR13, AC10)
  source: Tag,
})

// Scalar project key + scope/visibility/permission filtered on every search (FR9, FR34, C6).
export const DocScope = Schema.Struct({
  project_id: ProjectId,
  scope: ScopeKind,
  visibility: Visibility,
  permission_ref: PermissionRef,
})

export const DocAvailability = Schema.Struct({
  enabled: Enabled,
  available: Available,                   // mirrors live core; revalidated before injection (FR20, C11)
})

export const AgentClassification = Schema.Struct({ role: RoleKind, mode: ModeTag, description: Description })
export const AgentTaxonomy = Schema.Struct({ domains: TagSet, capabilities: TagSet, tools: TagSet })

export const AgentDoc = Schema.Struct({
  id: AgentDocId,                         // entity identity — canonical agent id (FR10)
  identity: DocIdentity,
  classification: AgentClassification,
  taxonomy: AgentTaxonomy,
  scope: DocScope,
  languages: LanguageSet,
  availability: DocAvailability,
})
export type AgentDoc = Schema.Schema.Type<typeof AgentDoc>

export const SkillDescriptor = Schema.Struct({ name: Name, description: Description })
export const SkillTaxonomy = Schema.Struct({ triggers: TagSet, domains: TagSet, capabilities: TagSet })
export const SkillCompat = Schema.Struct({ roles: TagSet, agents: AgentRefSet, permission_ref: PermissionRef })
export const SkillCost = Schema.Struct({ token_estimate: TokenBudget, languages: LanguageSet })

export const SkillDoc = Schema.Struct({
  id: SkillDocId,                         // entity identity — canonical skill id (FR11)
  identity: DocIdentity,
  descriptor: SkillDescriptor,
  taxonomy: SkillTaxonomy,
  compat: SkillCompat,
  cost: SkillCost,
  availability: DocAvailability,
})
export type SkillDoc = Schema.Schema.Type<typeof SkillDoc>

export const ChunkPosition = Schema.Struct({ chunk_index: ChunkIndex, overlap: ChunkOverlap })

// Feature 005 OutputSpool ref + bounded window; the body is never stored inline (FR40, C9).
export const ChunkBodyRef = Schema.Struct({ output_ref: OutputRef, offset: ByteOffset, limit: ByteLimit })

export const SkillChunkDoc = Schema.Struct({
  id: SkillChunkId,                       // entity identity — canonical chunk id (FR11)
  parent_skill_id: ParentSkillId,
  position: ChunkPosition,
  identity: DocIdentity,
  language_tag: LanguageTag,
  body_ref: ChunkBodyRef,
  token_estimate: TokenBudget,
})
export type SkillChunkDoc = Schema.Schema.Type<typeof SkillChunkDoc>
```

---

## TaskProfile + QueryFingerprint (FR15, FR18, C4, C10)

The structured, content-free task representation driving retrieval. The original query
text is preserved for embedding without a mandatory translation LLM call (FR15); the
profile carries only bounded hints and a fingerprint, never the raw prompt (FR17, C4).
The fingerprint keys the query embedding derived once per logical Task and reused across
the agent and skill passes while valid (FR18, C10, AC16). Mirrors `profile.cue`.

```typescript
// packages/schema/src/semantic/profile.ts (new)

export const QueryFingerprint = Schema.Struct({
  fingerprint: Fingerprint,
  binding_version: BindingVersion,        // invalidate by binding version + config hash (FR25, C10)
  config_hash: ConfigHash,
})
export type QueryFingerprint = Schema.Schema.Type<typeof QueryFingerprint>

export const TaskProfile = Schema.Struct({
  fingerprint: QueryFingerprint,
  role_hint: RoleKind,
  domains: TagSet,
  languages: LanguageSet,
  project_id: ProjectId,
})
export type TaskProfile = Schema.Schema.Type<typeof TaskProfile>
```

---

## Retrieval request, candidate, and score (FR3, FR19, FR20, FR22, C2, C11)

The request and result value objects of the immutable nine-stage pipeline. Hybrid recall
uses `retrieval_top_k`; rerank runs only on the reduced `rerank_top_k` set (FR19). Ties
break by the stable total order **rerank → dense → sparse → canonical id** (FR19, C2). A
candidate carries a ranking pointer into live core state, never an embedded Entity, and
is revalidated after retrieval (FR20, C11). The semantic score stays separate from Feature
001 quality inputs (FR22). Mirrors `retrieval.cue` and `retrieval-result.cue`.

```typescript
// packages/schema/src/semantic/retrieval.ts (new)

export const RetrievalRequest = Schema.Struct({
  profile: TaskProfile,
  collection: Collection,
  retrieval_top_k: TopK,                  // server-capped from the Feature 001 budget (FR38, C8)
  rerank_top_k: TopK,
  consistency: Consistency,
  mode: RetrievalMode,
})
export type RetrievalRequest = Schema.Schema.Type<typeof RetrievalRequest>

// rerank is null on reranker outage; ranking proceeds without it (FR24, AC8).
export const ScoreComponents = Schema.Struct({
  rerank: Schema.NullOr(RerankScore),
  dense: DenseScore,
  sparse: SparseScore,
})

export const ScoreProvenance = Schema.Struct({
  mode: RetrievalMode,
  gap: DegradationGap,
  binding_version: BindingVersion,
  generation_id: GenerationId,
})

export const SemanticScore = Schema.Struct({
  composite: Score,
  components: ScoreComponents,
  confidence: Confidence,
  provenance: ScoreProvenance,
})
export type SemanticScore = Schema.Schema.Type<typeof SemanticScore>

export const Candidate = Schema.Struct({
  candidate_ref: Schema.Union(AgentRef, SkillRef),
  collection: Collection,
  score: SemanticScore,
  rank: TopK,
  freshness: FreshnessBucket,
})
export type Candidate = Schema.Schema.Type<typeof Candidate>

export const CandidateList = Schema.Array(Candidate) // bounded by top_k (FR19, NFR3, C8)

// Typed degradation ladder rung; never a silent model substitution (FR24, C20, AC29).
export const DegradationOutcome = Schema.Struct({
  mode: RetrievalMode,
  gap: DegradationGap,
  degraded_reason: Schema.NullOr(DegradedReason),
})

export const RetrievalResult = Schema.Struct({
  candidates: CandidateList,
  mode: RetrievalMode,
  outcome: DegradationOutcome,
  fingerprint: Fingerprint,
})
export type RetrievalResult = Schema.Schema.Type<typeof RetrievalResult>
```

---

## IndexGeneration + CollectionAlias (FR12, C12, C21)

`IndexGeneration` is the aggregate root of one blue/green collection generation; its
identity is `id`. The embedding dimension/normalization/metric are stored WITH the
generation so incompatible vectors are never mixed in one search space (FR12).
`CollectionAlias` is an Entity mapping a conceptual collection (`agents`, `skills`,
`skill_chunks`, or the Feature 009 `tools` extension) to a physical generation; all
aliases in a binding generation cut over together under one CAS so `tools` never splits
from the others (FR12, C12, C21). `select`/`reindex` never activate the live alias; only
the atomic `semantic.embedding.cutover` swaps them (FR12, FR32). Mirrors
`index-generation.cue` and `collection-alias.cue`.

```typescript
// packages/schema/src/semantic/index-generation.ts (new)

export const IndexGeneration = Schema.Struct({
  id: GenerationId,                       // aggregate-root identity (FR12, C12)
  binding_version: BindingVersion,
  state: GenerationState,
  metric: Metric,
  dimension: Dimension,                   // stored; never inferred (FR12, C7)
  aliases: AliasRefSet,
  created_at: DateTimeUtcFromMillis,
})
export type IndexGeneration = Schema.Schema.Type<typeof IndexGeneration>

export const CollectionAlias = Schema.Struct({
  id: CollectionAliasId,                  // entity identity (FR12, C12)
  collection: Collection,
  generation_id: GenerationId,
  active: Available,
})
export type CollectionAlias = Schema.Schema.Type<typeof CollectionAlias>
```

---

## Event envelope and vocabulary (C22)

The common carrier on every `semantic.*` event is the content-free `SemanticEnvelope`
(bounded enums, opaque ids, redacted key/value metadata only — never query text, vectors,
prompts, reasoning, or paths per ADR-0001) (FR42, C22). Mirrors `envelope.cue`,
`envelope-parts.cue`, `events.cue`, `events-index.cue`, and `events-live.cue`.

```typescript
// packages/schema/src/semantic/events.ts (new)

export const EventKind = Schema.Struct({
  event_type: SemanticEventType,
  schema_version: SchemaVersion,
  event_class: EventClass,
  source: EventSource,
  actor_kind: ActorKind,                  // runtime | operator; no LLM (FR31, C15)
  visibility: Visibility,
})

export const EventSubject = Schema.Struct({
  binding_id: Schema.NullOr(BindingId),
  generation_id: Schema.NullOr(GenerationId),
  collection: Schema.NullOr(Collection),  // no path is ever present (FR17, C22)
  project_id: ProjectId,
})

export const Ordering = Schema.Struct({
  sequence: Sequence,                     // per aggregate only; no global order (C22)
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
})

export const Delivery = Schema.Struct({
  visibility: Visibility,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String), // no content/vectors/secrets (FR42, C22)
})

export const SemanticEnvelope = Schema.Struct({
  event_id: EventId,
  kind: EventKind,
  subject: EventSubject,
  ordering: Ordering,
  delivery: Delivery,
})
export type SemanticEnvelope = Schema.Schema.Type<typeof SemanticEnvelope>
```

The 12 members form a closed tagged union; each member carries the `envelope`, and a
member with a distinct payload adds one `detail` sub-object so binding selection, cutover,
rollback, upsert, tombstone, reconcile, generation build/cutover/retire, degradation,
probe, and state-change stay distinct semantic events. Mirroring Feature 002/003/004/005,
each member is registered as its own `EventV2.define` `Definition` on the `EventV2Bridge`
(`dataFields(Member.fields)`) and published through `publishSemanticEvent`; no raw tagged
union is wired to the bus (C22).

```typescript
export const BindingSelectionDetail = Schema.Struct({ slot: Slot, version: BindingVersion })
export const CutoverDetail = Schema.Struct({ generation_id: GenerationId, outcome: CutoverOutcome })
export const IndexMutationDetail = Schema.Struct({ collection: Collection, content_hash: ContentHash })
export const ReconcileDetail = Schema.Struct({ collection: Collection, outcome: CutoverOutcome })
export const GenerationDetail = Schema.Struct({ generation_id: GenerationId, state: GenerationState })
export const DegradationDetail = Schema.Struct({ gap: DegradationGap, mode: RetrievalMode })
export const ProbeDetail = Schema.Struct({ slot: Slot, status: ValidationStatus })
export const StateChangeDetail = Schema.Struct({ slot: Slot, state: BindingState })

// Durable settlement (C22): 9 members registered with durable {version, aggregate}.
export const SemanticBindingCutoverEvent = Schema.Struct({
  type: Schema.Literal("semantic.binding_cutover"),
  envelope: SemanticEnvelope,
  detail: CutoverDetail,
})

// Live (C22): 3 envelope+detail members that omit the durable annotation and may drop.
export const SemanticRetrievalDegradedEvent = Schema.Struct({
  type: Schema.Literal("semantic.retrieval_degraded"),
  envelope: SemanticEnvelope,
  detail: DegradationDetail,
})
// ...one Struct per event-types.ts vocabulary entry, across events-index.ts and events-live.ts.

export const SemanticEvent = Schema.TaggedUnion("type", [
  SemanticBindingCutoverEvent, SemanticRetrievalDegradedEvent,
  // ...the remaining 10 members.
])
export type SemanticEvent = Schema.Schema.Type<typeof SemanticEvent>
```

Durable members join the canonical inventory in
`packages/schema/src/durable-event-manifest.ts` through `Event.durable([...])` (C22), so
binding selection/cutover/rollback, index upsert/tombstone/reconcile, and generation
build/cutover/retire are preserved across bounded-queue overflow and restart by the
durable aggregate, never by a projection. Live `retrieval_degraded`, `provider_probed`,
and `binding_state_changed` are not durable and carry no sequence (C22). The durable
members carry `durable {version: 1, aggregate: "correlation_id"}`: the per-aggregate
`Ordering.sequence` groups by `Ordering.correlation_id` — the same key EventV2 reads from
a top-level `correlation_id` data field projected from `envelope.ordering.correlation_id`
at publish time (no duplicated authority).

**Durable / live split.**

| Split | Members | EventV2 posture |
| ----- | ------- | --------------- |
| Durable (9) | `binding_selected`, `binding_cutover`, `binding_rolled_back`, `index_upserted`, `index_tombstoned`, `index_reconciled`, `generation_built`, `generation_cutover`, `generation_retired` | `durable {version, aggregate}`; replay through `readAggregate` (FR12, FR13, C12, C22) |
| Live (3) | `retrieval_degraded`, `provider_probed`, `binding_state_changed` | bounded live channel; droppable under `allBounded` load; no sequence (FR24, FR30, FR31, C20, C22) |

---

## Parameters

Every provisional contract is declared here as a plan constant with a named acceptance
hook; ADR-0008 and the tasks phase fix final values (plan Non-goals; C1–C12, C16–C20,
C22). No value is a hidden default: each is an explicit, overridable data constant on the
domain module, never inlined into an algorithm. IDs never appear as metric labels;
over-budget dynamic values map to `other`, reusing the Feature 001 cardinality allowlist
(FR42, C22, AC15). `retrieval_top_k`/`rerank_top_k`/`max_skill_chunks`/token budgets are
Feature 001 Context, Turn and Delegation Budget values, never a parallel store (FR38, C8).

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `retrieval_top_k` | 64 | per recall | FR19, FR38, C8, AC17 |
| `rerank_top_k` | 16 | per rerank | FR19, FR38, C8, AC17 |
| `max_skill_chunks` | 8 | per skill pass | FR38, FR39, C8, AC12 |
| `retrieval_latency_budget_ms` | low hundreds of ms; timeout → C20 fallback | per retrieval | NFR1, C8, AC17 |
| `hnsw_params` | `M` / `efConstruction` / `ef` for the HNSW dense index | per collection generation | FR12, C7, AC1 |
| `fusion_weights` | deterministic dense+sparse fusion (weighted / RRF) before tie-break | per recall | FR19, C7, AC1, AC17 |
| `distance_metric` | cosine / inner-product on normalized vectors, stored per generation | per generation | FR12, C7, AC1 |
| `consistency_default` | Bounded staleness; Strong for admin verification reads | per search | FR20, C6, AC5 |
| `partition_grammar` | scalar project partition key; mandatory filter every search | per collection | FR9, FR34, C6, AC6 |
| `chunk_size` / `chunk_overlap` | bounded sanitized token window with fixed overlap | per chunk | FR11, C9, AC12 |
| `sanitization_allowlist` | strips secrets, prompts, reasoning, and paths | per document/chunk | FR17, C4, AC15 |
| `query_cache_ttl` | invalidate by binding version + config hash | per fingerprint | FR18, FR25, C10, AC16 |
| `metadata_cache_ttl` | last-known index metadata cache | per binding | FR25, C10, AC16 |
| `freshness_bucket_edges` | fresh / bounded / stale thresholds | per candidate | FR27, C11, AC5 |
| `stale_confidence_threshold` | gate whether semantic scores contribute | per candidate | FR27, C11, AC4 |
| `cutover_alias_grammar` | blue/green alias naming; all collections together | per cutover | FR12, C12, AC31 |
| `dual_write_window` | bounded generation dual-write horizon | per cutover | FR12, C12, AC32 |
| `in_flight_retention_horizon` | in-flight Tasks keep start-time versions | per cutover | FR32, C12, AC33 |
| `probe_batch_size` / `probe_vector_count` | server-capped `/v1/embeddings` probe bounds | per probe | FR30, C5, AC23 |
| `rerank_profile_contracts` | A `/v1/rerank` schema, B chat schema/temperature, C excluded | per reranker | FR30, C16, AC24, AC25, AC26 |
| `ssrf_denylist_cidrs` | metadata/link-local/private ranges blocked | per connection | FR33, C17, AC36, AC38 |
| `breaker_thresholds` | bounded breaker/retries on the same pinned binding | per binding | FR26, NFR3, C22, AC13 |
| `eval_thresholds` | recall@k / nDCG / MRR pass bars; leakage tolerance zero | offline eval | FR43, C18, AC40 |
| `cardinality_budget` | distinct dynamic ids → `other` | metric labels | FR42, AC15, reuses Feature 001 |

Feature 001 telemetry queue/cardinality-allowlist/budget-policy constants and the Feature
007 Config.Service CAS/idempotency parameters are reused unchanged and are not
re-declared here (C8, C15, C22).

---

## Cross-artifact traceability

| Entity | CUE mirror | TS module | Requirements |
| ------ | ---------- | --------- | ------------ |
| identifiers | `ids.cue`, `refs.cue`, `correlation.cue` | `ids.ts`, `refs.ts` | FR28, FR34, FR35, FR40, C11, C19 |
| numeric / budget / score values | `values.cue`, `budget-values.cue`, `score-values.cue` | `values.ts` | FR12, FR19, FR22, FR38, C7, C8 |
| bounded text / hash / flags | `text-values.cue`, `hash-values.cue` | `text-values.ts` | FR14, FR17, FR25, C4, C10 |
| first-class collections | `collections.cue` | `collections.ts` | FR10, FR11, FR14, C11 |
| core / state / event enums | `enums.cue`, `enums-state.cue`, `enums-event.cue`, `event-types.cue` | `enums.ts`, `enums-state.ts`, `enums-event.ts`, `event-types.ts` | FR9, FR24, FR30, FR31, C6, C16, C20, C22 |
| SemanticProviderProfile | `provider-profile.cue`, `provider-parts.cue` | `provider-profile.ts` | FR28, FR29, FR33, FR35, FR37, C5, C17, C19 |
| SemanticModelDescriptor | `model-descriptor.cue`, `model-parts.cue` | `model-descriptor.ts` | FR28, FR30, C3, C5, C16 |
| SemanticModelBinding / BindingStatus | `binding.cue`, `binding-parts.cue` | `binding.ts` | FR28, FR31, FR32, C12, C20 |
| AgentDoc / SkillDoc / SkillChunkDoc | `document-shared.cue`, `document-parts.cue`, `agent-doc.cue`, `skill-doc.cue`, `chunk-doc.cue` | `documents.ts` | FR10, FR11, FR17, FR36, FR39, FR40, C4, C6, C9, C11 |
| TaskProfile / QueryFingerprint | `profile.cue` | `profile.ts` | FR15, FR18, C4, C10 |
| RetrievalRequest / Candidate / SemanticScore / RetrievalResult / DegradationOutcome | `retrieval.cue`, `retrieval-result.cue` | `retrieval.ts` | FR3, FR19, FR20, FR22, FR24, C2, C11, C20 |
| IndexGeneration / CollectionAlias | `index-generation.cue`, `collection-alias.cue` | `index-generation.ts` | FR12, C12, C21 |
| SemanticEnvelope | `envelope.cue`, `envelope-parts.cue` | `events.ts` | FR42, C22 |
| SemanticEvent vocabulary | `events.cue`, `events-index.cue`, `events-live.cue` | `events.ts` + member files | FR12, FR13, FR24, FR30, FR31, C12, C20, C22 |

---

## Notes on authority and reuse

- No shape here is a second store of record: AgentV2/SkillV2/Catalog/Permission/Config
  remain the sources of truth; Milvus documents are a rebuildable projection revalidated
  against live core before injection (FR1, FR2, FR20, C11, C21).
- The three SSOT aggregates (`SemanticProviderProfile`, `SemanticModelDescriptor`,
  `SemanticModelBinding`) own the operator-pinned field definitions; Feature 007
  references them and exposes the 30 reserved `semantic.*` operator commands
  (`RESERVED_CATALOG_VERSION = 1.3.0`) without redefining or bumping the catalog (FR28,
  C15).
- Budgets (`retrieval_top_k`, `rerank_top_k`, `max_skill_chunks`, token budgets) come
  from the Feature 001 Context, Turn and Delegation Budget; telemetry reuses the Feature
  001 bounded-cardinality helpers and the single OTLP exporter — no new exporter, SDK, or
  pipeline is added (FR38, FR41, FR42, C8, C22).
