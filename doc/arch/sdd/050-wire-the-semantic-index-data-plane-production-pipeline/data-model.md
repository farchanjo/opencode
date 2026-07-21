# Data Model: Wire The Semantic Index Data Plane Production Pipeline (Feature 050)

Feature: [050 Wire The Semantic Index Data Plane Production Pipeline](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
CUE: [`wire-the-semantic-index-data-plane-production-pipeline.cue`](../../schemas/wire-the-semantic-index-data-plane-production-pipeline.cue)

Feature 050 defines **no new SSOT aggregate** — `AgentDoc`/`SkillDoc`/
`SkillChunkDoc` (`packages/schema/src/semantic/documents.ts`), `IndexGeneration`
(`packages/schema/src/semantic/index-generation.ts`), and the retrieval/binding
records are all owned and shipped by Feature 006/009. This feature's data
model is: (1) the field-mapping contract from `Agent.Info`/`Skill.Info` into
the existing document shapes, (2) the four new config/data ValueObjects
already authored in the feature's CUE corpus
(`#ProbedVectorSpace`, `#RerankCapabilities`, `#DataPlaneRetryPolicy`,
`#ReconcileLock`, `#SpoolEntry`), and (3) the shapes this feature produces
that Feature 051 (live wiring) will consume unchanged. Nothing here is a
second store of record: AgentV2/SkillV2/Permission/Config remain sources of
truth, and every document below is rebuilt from them on reindex.

---

## AgentDoc field mapping (`Agent.Info` → `AgentDoc`)

Source: `packages/schema/src/agent.ts:20-31` (`Agent.Info`). Target:
`packages/schema/src/semantic/documents.ts:117-125` (`AgentDoc`). The pure
builder lives beside `projection.ts` (`core/src/semantic/agent-doc.ts`, new)
and reuses `Projection.scrubText`/`sanitizeFields` plus a content-hash pattern
mirrored from `ToolProjection.contentHash` (`tool-projection.ts:116-132`).

| `AgentDoc` field | Source | Mapping |
| ---------------- | ------ | ------- |
| `id` | `Agent.Info.id` | Direct (`AgentDocId` brand check) |
| `identity.version` | builder-owned counter | Starts at 1; incremented by the reconcile diff, never by the builder itself |
| `identity.content_hash` | derived | SHA-256 over the STABLE-KEY JSON of `{description(scrubbed), mode, hidden, permissions(serialized), color}` — anything that changes ranking or scope, nothing volatile (never `steps`, which is a runtime budget knob, not identity) |
| `identity.source` | constant | `"agent"` |
| `classification.role` | derived from `Agent.Info.mode` | `mode: "primary"` → `role: "architect"`; `mode: "subagent"` → `role: "worker"`; `mode: "all"` → `role: "worker"` (the conservative default; a primary-capable-but-subagent-invoked agent never claims elevated routing weight from the index alone — live `AgentV2` selection remains authoritative) |
| `classification.mode` | `Agent.Info.mode` | Direct (`ModeTag`) |
| `classification.description` | `Agent.Info.description ?? ""` | `Projection.scrubText(...)` applied (strips path- and secret-shaped substrings, FR17) |
| `taxonomy.domains` | **none on `Agent.Info`** | `[]` (empty `TagSet`) — see `research.md` "`Agent.Info`/`Skill.Info` are thinner"; ranking-signal only, never authority (`Projection.RANKING_SIGNAL_FIELDS`) |
| `taxonomy.capabilities` | **none on `Agent.Info`** | `[]` |
| `taxonomy.tools` | **none on `Agent.Info`** | `[]` (Feature 009's `tools` collection already carries per-tool documents; this field is reserved for a future capability join, not populated in this feature) |
| `scope.project_id` | P0 canonical `project_id` (plan `~/.opencodedev` binding) | Injected by the `LiveDocSource` caller, not read off `Agent.Info` |
| `scope.scope` | constant | `"project"` (V1 has no multi-root/global agent scope) |
| `scope.visibility` | derived from `Agent.Info.hidden` | `hidden: true` → `visibility: "shared"` is WRONG (would loosen visibility) — `hidden` agents map to `visibility: "project"` with `availability.available: false` when hidden, never a widened visibility; a hidden, non-subagent-invocable agent still indexes for revalidation-time correctness (a stale narrowed set must be able to detect "still hidden", not silently vanish) |
| `scope.permission_ref` | derived from `Agent.Info.permissions` | Stable hash over the serialized `Permission.Ruleset` (same content-hash pattern as `identity.content_hash`, kept as a SEPARATE hash so a ruleset-only change is independently detectable) — see `research.md` "`permission_ref` has no existing agent/skill producer" |
| `languages` | **none on `Agent.Info`** | `[]` unless Feature 004 Lang Lock supplies an artifact language tag for the agent's defining file; defaulting to `[]` (not inventing a tag) is the honest floor for V1 |
| `availability.enabled` | `!Agent.Info.hidden` combined with live registry state | Set by the `LiveDocSource`, which reads the CURRENT `AgentV2.Service` registry at collect time — never cached |
| `availability.available` | live `AgentV2`/`PermissionV2` check | Same as `enabled`; both are revalidated again at query time (Feature 051), so a builder-time value only affects ranking-time recall, never authority |

## SkillDoc field mapping (`Skill.Info` → `SkillDoc`)

Source: `packages/schema/src/skill.ts:20-26` (`Skill.Info`). Target:
`packages/schema/src/semantic/documents.ts:129-138` (`SkillDoc`). The pure
builder lives at `core/src/semantic/skill-doc.ts` (new), sibling to
`agent-doc.ts`.

| `SkillDoc` field | Source | Mapping |
| ---------------- | ------ | ------- |
| `id` | `Skill.Info.name` | Direct (`SkillDocId` brand check; `name` is already the canonical skill identity per `core/skill.ts:116` `skills.set(skill.name, skill)`) |
| `identity.content_hash` | derived | SHA-256 over `{description(scrubbed), slash}` — NEVER over `content` (the full body only feeds `skill-chunk.ts`, never the summary doc; the forbidden-field guard, `projection.ts:41`, would reject a raw `content` field outright) |
| `identity.source` | constant | `"skill"` |
| `descriptor.name` | `Skill.Info.name` | Direct |
| `descriptor.description` | `Skill.Info.description ?? ""` | `Projection.scrubText(...)` applied |
| `taxonomy.triggers` | **none on `Skill.Info`** | `[]` |
| `taxonomy.domains` | **none on `Skill.Info`** | `[]` |
| `taxonomy.capabilities` | **none on `Skill.Info`** | `[]` |
| `compat.roles` | **none on `Skill.Info`** | `[]` (unconstrained by role until a future feature adds explicit skill/role compatibility metadata) |
| `compat.agents` | **none on `Skill.Info`** | `[]` |
| `compat.permission_ref` | derived | Skills have no stored ruleset of their own — `PermissionV2.evaluate("skill", skill.name, agent.permissions)` (`core/skill.ts:31`) is evaluated against the REQUESTING agent's ruleset, not a skill-owned one. `compat.permission_ref` is therefore a hash of `skill.name` alone (an identity-scoped placeholder ref); the query-time `available(skills, agent)` gate remains the sole authority (FR34) |
| `cost.token_estimate` | `Token.estimate(Skill.Info.content)` | `core/util/token.ts:5` (`chars/4`); a summary-level estimate over the WHOLE body length, distinct from the per-chunk `token_estimate` on `SkillChunkDoc` |
| `cost.languages` | Feature 004 Lang Lock tag if available, else `[]` | Same honest-floor rule as `AgentDoc.languages` |
| `availability.enabled` | live `SkillV2` discovery state | Set by `LiveDocSource` at collect time |
| `availability.available` | live `available(skills, agent)` check | Ranking-time value only; query-time revalidation is Feature 051 |

## SkillChunkDoc production (`Skill.Info.content` → `SkillChunkDoc[]`)

`core/src/semantic/skill-chunk.ts` (new) turns one `Skill.Info.content` body
into zero or more `SkillChunkDoc` rows via `Projection.chunkBody`
(`core/src/semantic/projection.ts:133-146`), capped by the Feature 001 budget
`max_skill_chunks` (`schema/routing/budget.ts:44`), using `Token.estimate`
(`core/util/token.ts:5`) for the required `totalTokens` input — no new
tokenizer dependency at this stage (per the approved plan's "Token counting"
reuse decision).

| `SkillChunkDoc` field | Source | Mapping |
| ---------------------- | ------ | ------- |
| `id` | `${skill.name}#${chunk_index}` | `SkillChunkId` brand check (pattern `^[A-Za-z0-9_-]{1,192}$` — `#` must be excluded from the id string; use a `-` or `_` separator instead, e.g. `${skill.name}_c${chunk_index}`, to satisfy the existing pattern) |
| `parent_skill_id` | `Skill.Info.name` | `Refs.ParentSkillId` |
| `position.chunk_index` | `ChunkWindow.chunk_index` | Direct from `chunkBody` output |
| `position.overlap` | `ChunkWindow.overlap` | Direct |
| `identity.content_hash` | derived | SHA-256 over the SANITIZED chunk body bytes actually written to the spool (never over the raw window) — so an edit that only shifts chunk boundaries without changing sanitized bytes does not spuriously re-upsert |
| `language_tag` | Feature 004 Lang Lock tag if available, else a fixed fallback (`"und"`, BCP 47 "undetermined") | `LanguageTag` pattern requires a non-empty tag; `"und"` is the honest floor, never a guessed language |
| `body_ref` | `OutputSpoolStore.put(...)` result | `{output_ref, offset, limit}` — `offset`/`limit` bound the bytes for JUST this chunk within the spool entry (see `contracts/ports.ts` `OutputSpoolStore`) |
| `token_estimate` | `ChunkWindow.token_length` | Direct (already computed by `chunkBody`) |

**Sanitization order (load-bearing):** the chunk window is computed over
`Token.estimate`-derived token boundaries, then the substring of
`Skill.Info.content` in that window is passed through
`Projection.scrubText` before it is ever handed to
`OutputSpoolStore.put` — the spool NEVER receives raw, unscrubbed skill body
text. This mirrors the `AUTHORITY_FIELDS`/`RANKING_SIGNAL_FIELDS` split
(`projection.ts:67-79`): a chunk body is a ranking/injection payload, never
an authority field, and the forbidden-field guard (`projection.ts:41-45`)
independently rejects any doc-level field literally named `body`/`content`.

---

## `#ProbedVectorSpace` (CUE `:37-43`) — TypeScript shape

Mirrors the pre-authored CUE 1:1 (no new schema module; this feature composes
the shape in `packages/opencode/src/semantic/dimension-probe.ts`, new):

```ts
interface ProbedVectorSpace {
  readonly dimension: number            // int > 0; the ACTUAL probed vector length — never a default
  readonly metric: "cosine" | "inner-product"  // aligned to the SHIPPED schema/protocol enum (research.md
                                                // "Metric-vocabulary mismatch"), NOT the CUE's "ip" shorthand
  readonly normalized: boolean
  readonly probedAt: string             // RFC3339; non-empty
  readonly source: "live-probe" | "metadata-crosscheck"
}
```

Produced by `EmbeddingClient.probe` (`embedding-client.ts:67-87`, decision
ladder rung 1) or, when offline and a cached value exists, by the
`ModelsDev.Service` cross-check (rung 2, `core/models-dev.ts:137`). Consumed
by `generationVectorSpace` (`registry-backend.ts:696-702`, replacing the
`?? 1024` fallback) and stamped onto `RegistryGeneration.dimension`/`.metric`
(`:745-752`) and the schema `IndexGeneration.dimension`/`.metric`
(`schema/semantic/index-generation.ts`).

## `#RerankCapabilities` (CUE `:49-58`) — TypeScript shape

```ts
interface RerankCapabilities {
  readonly modes: ReadonlyArray<"native-rerank" | "structured-chat">
  readonly maxDocuments?: number
  readonly contextWindow?: number
  readonly scoreRange?: { readonly min: number; readonly max: number }
  readonly probedAt: string
}
```

Produced by extending `RerankProbe.createRerankValidationProbe`
(`rerank-probe.ts:117-146`) to capture the transport's reported capability
envelope alongside the existing pass/fail boolean, rather than discarding it.
A mode absent from `modes` is never eligible for that reranker slot (mirrors
`RerankClient.isRerankerEligible`, already called at `rerank-probe.ts:121`).

## `#DataPlaneRetryPolicy` (CUE `:68-74`) — TypeScript shape

```ts
interface DataPlaneRetryPolicy {
  readonly maxAttempts: 1 | 2 | 3        // default 3
  readonly baseDelayMs: number           // default 500
  readonly maxDelayMs: number            // default 5000
  readonly jitter: boolean               // default true
  readonly classification: "typed-transient-only"
}
```

One instance parameterizes the new `Effect`-based retry wrapper (see
`plan.md` "Retry & backoff policy"); it is a plain data constant, never
hand-tuned per call site, so the ≤3/500ms/5s envelope from the approved plan
is enforced identically for embed batches, Milvus upsert/tombstone/
enumerate/buildGeneration, and reconcile steps (FR12).

## `#ReconcileLock` (CUE `:81-85`) — TypeScript shape

```ts
interface ReconcileLock {
  readonly scope: "profile"
  readonly holder?: string     // non-empty when held
  readonly acquiredAt?: string // RFC3339
}
```

One lock per profile (`~/.opencodedev`), CAS-guarded the same way
`registry-backend.ts` already guards the binding document (`readDoc`/
`guardedPlan`); an incremental reconcile and a full rebuild are mutually
exclusive holders (FR10). See `contracts/ports.ts` `ReconcileLock` for the
acquire/release surface.

## `#SpoolEntry` (CUE `:93-99`) — TypeScript shape

```ts
interface SpoolEntry {
  readonly ref: string             // the OutputRef this entry was minted under
  readonly contentHash: string     // MUST equal the owning SkillChunkDoc.identity.content_hash
  readonly parentSkillId: string
  readonly chunkIndex: number      // >= 0
  readonly byteLength: number      // >= 0
}
```

One `SpoolEntry` per `SkillChunkDoc`, content-hash-keyed so reconcile
supersedes/deletes an entry together with its owning chunk doc (never
orphaning a spool write when a skill is edited or removed). See
`contracts/ports.ts` `OutputSpoolStore.put`/`.supersede`.

---

## Deferred to Feature 051 (note only — not produced by this feature)

The following consume this feature's outputs but are **out of scope here**
(FR13: zero live-turn behavior change):

- `NarrowedSets` (the per-turn memo over agents/skills/tools narrowing
  decisions) — lives entirely in `session/routing-state.ts` and is Feature
  051's deliverable; this feature produces the INDEX that memo will query
  against, nothing more.
- Any consumption of `RetrievalPort.retrieveAgents`/`retrieveSkills` or
  `ToolRetrievalPort.retrieveTools` from a live session/turn code path — the
  `FEATURE_001_SELECTION_SEAM`/`FEATURE_009_TOOL_SELECTION_SEAM` markers in
  `retrieval-facade.ts:239-258` remain unreached by any live route after this
  feature ships; only `embedding-reindex`/reconcile/CLI verification call the
  new `pipeline-runner.ts`.
- The `skill_chunks` FOURTH retrieval pass and `<auto_skills>` injection
  (Feature 052) — this feature only makes `SkillChunkDoc`/`SpoolEntry`
  resolvable; nothing reads them at query time yet.

## Cross-artifact traceability

| Shape | Owner (existing) | This feature's role |
| ----- | ----------------- | -------------------- |
| `AgentDoc`/`SkillDoc`/`SkillChunkDoc` | `packages/schema/src/semantic/documents.ts` (Feature 006) | Pure Info→Doc field-mapping builders only (FR7, FR8) |
| `IndexGeneration` | `packages/schema/src/semantic/index-generation.ts` (Feature 006) | Consumer: dimension/metric now real (FR6) |
| `MilvusPort`/`DocumentRow` | `packages/opencode/src/semantic/milvus-adapter.ts` (Feature 006) | Consumer via the shared composition helper (FR4) |
| `ProbedVectorSpace`, `RerankCapabilities`, `DataPlaneRetryPolicy`, `ReconcileLock`, `SpoolEntry` | `doc/arch/schemas/wire-the-semantic-index-data-plane-production-pipeline.cue` (this feature) | Owned here; TS mirrors listed above |
