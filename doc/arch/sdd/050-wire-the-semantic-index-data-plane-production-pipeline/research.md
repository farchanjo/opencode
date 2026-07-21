# Wire The Semantic Index Data Plane Production Pipeline Research

Feature: [050 Wire The Semantic Index Data Plane Production Pipeline](spec.md)

This note records the verified evidence (file:line) that shaped `plan.md` and
`data-model.md`. It is not an ADR and does not authorize implementation beyond
what `spec.md` FR1–FR13 already scope. Every finding below was re-verified by
reading the cited file directly during this planning pass (2026-07-21), not
carried over unchecked from the spec.

## Dormant stack inventory (Feature 006/009, verified present but unwired)

| Component | Location | State |
| --------- | -------- | ----- |
| Nine-stage pipeline | `packages/core/src/semantic/pipeline.ts:131-160` | Complete, framework-free, zero production caller |
| Tool pass (7 stages, omits select_agent/skill_pass) | `packages/core/src/semantic/tool-pass.ts:120-144` | Complete, zero production caller |
| Milvus port + fake/REST adapter | `packages/opencode/src/semantic/milvus-adapter.ts:163-173` | Complete (`search`/`upsert`/`tombstone`/`health`/`swapAliases`/`enumerateIndexed`/`buildGeneration`); bound in `stack-live.ts:578-587` only when `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is set |
| Embedding client + probe | `packages/opencode/src/semantic/embedding-client.ts:67-112` | `probe`/`embed`/`batches` complete; `EmbeddingsHttpPort` (`:34-36`) has **zero production implementations** |
| Rerank client + validation probe | `packages/opencode/src/operator/semantic/rerank-probe.ts:117-146` | Bound live at `stack-live.ts:560-575` for `semantic.reranker.validate` only — not reachable from retrieval |
| Retrieval facade | `packages/opencode/src/semantic/retrieval-facade.ts:186-236` | `createRetrievalFacade` complete; `PipelineRunnerPort` (`:87-92`) has no production binding — only test doubles construct it |
| Content-hash index jobs | `packages/opencode/src/semantic/index-jobs.ts:52-200` | `planMutations`/`runReconcile` complete; `agentLiveDoc`/`skillLiveDoc` wrappers exist (`:111-126`, `:135-145`) but nothing calls them from live `Agent.list()`/`Skill.all()` |
| Milvus operator binding | `packages/opencode/src/operator/semantic/milvus-binding.ts:125-196` | `createMilvusIndexPort` composes `runReconcile` only when `deps.port`, `deps.source`, and `deps.context` are ALL present; today `stack-live.ts` never supplies `source`/`context`, so every `reindex`/`reconcile` call falls through to `gatedGap` (`:159-161`) even with Milvus configured |
| Blue/green generation lifecycle | `packages/core/src/semantic/index-generation.ts:1-140` | Pure state machine complete; `requiresNewGeneration`/`vectorsCompatible` (`:100-109`) ready to consume a real dimension the moment one is produced |

## Pipeline.run revalidates skills only — agents are raw reranked output

`packages/core/src/semantic/pipeline.ts:149-157`:

```ts
const agents = TieBreak.order(reranked)          // line 150 — NO revalidation
...
const revalidated = await ports.revalidate(skills)  // line 157 — only `skills` is passed
```

`ports.revalidate` is invoked exactly once, over `skills` (the stage-8 output),
never over `agents` (the stage-6 output). `retrieval-facade.ts:110-125`
(`toCandidate`) then stamps every returned candidate `revalidated: true`
unconditionally, regardless of surface or of whether stage 9 actually ran over
that row. This confirms spec FR2's premise: the runner itself must re-check
every ranked AGENT id against the live registry before the facade's
`revalidated: true` is earned for that surface.

## ToolPass.run for tools — never Pipeline.run

`packages/core/src/semantic/tool-pass.ts:120-144` runs stages
1‑profile→2‑filter→3‑recall→4‑reduce→5‑rerank→6‑score→9‑revalidate and
**omits** 7‑select_agent/8‑skill_pass entirely (`TOOL_STAGES`, `:39`). Its
`revalidate` call (`:141`) is unconditional over every tool row — tools are
already correctly revalidated by the pipeline itself. Confirms FR1: the
runner's `runTools` must bind to `ToolPass.run`, not `Pipeline.run`.

## Timeout is a post-hoc relabel, not a real deadline

`retrieval-facade.ts` wraps every `deps.pipeline.run*` call in
`Effect.tryPromise` with `catch: (): RetrievalError => ({ type: "timeout" })`
(verified at `:190-198`, `:201-213`, `:221-233` for `retrieveAgents`/
`retrieveSkills`/`retrieveTools` respectively). This relabels **any**
rejection — not just a real timeout — as `"timeout"`; there is no
`Effect.timeout(latencyBudgetMs)` anywhere in the file, and
`config/experimental.ts:62`'s `latencyBudgetMs: 300` knob has no reader in
this module. Confirms FR3: the runner must wrap each surface call in a real
`Effect.timeout`, consuming the existing knob.

## Milvus port composition is inlined once, ready to extract

`packages/opencode/src/operator/stack-live.ts:576-610` builds the
`MilvusAdapter.createGrpcMilvusAdapter(MilvusAdapter.createHttpMilvusClient(...))`
port and the `MilvusIndexBindingDeps` object (endpoint/port/probe) directly in
the operator composition root, reading `OPENCODE_SEMANTIC_MILVUS_ADDRESS` /
`_INSECURE` / `_TOKEN` from `process.env`. This is the ONE existing
construction site (FR4): a second, independent construction in the new
`pipeline-runner.ts` would silently diverge in TLS/timeout/health-probe
behavior from the operator stack. Extracting this block into one shared
helper (e.g. `packages/opencode/src/semantic/milvus-composition.ts`) that both
`stack-live.ts` and the runner call is the only way to avoid a second Milvus
client construction path.

## Auth resolution: one closure exists today, not yet a shared resolver call

`stack-live.ts:560-575` builds an ad hoc `resolveAuthHeader` closure inline for
the rerank validation probe (parses `keychain:name@vN` / `env-ref:name@vN`,
calls `keychainSecrets.resolveSecretMaterial`, returns `Bearer <material>` or
`null`). `packages/opencode/src/semantic/credential-resolver.ts:36-40`
(`resolvePolicy`) already encodes the identical keychain/env-ref/CI decision
as a pure function but is not consumed by the `stack-live.ts` closure — the
same policy is duplicated ad hoc rather than called. FR4 requires the new
runner (and, ideally, this existing closure) to route through
`credential-resolver.ts` exclusively so a third bespoke copy is never
written for the embeddings HTTP client.

## Embedding dimension is hardcoded — verified exact lines

`packages/opencode/src/operator/semantic/registry-backend.ts:696-702`:

```ts
function generationVectorSpace(model: RegistryModel | undefined): { dimension: number; metric: MetricKind } {
  const dimension = deps.defaultDimension ?? 1024
  const metric = deps.defaultMetric ?? ("cosine" as MetricKind)
  void model   // <- the staged model descriptor is accepted but never read
  return { dimension, metric }
}
```

`model` is an accepted parameter that is explicitly discarded (`void model`).
`planReindexEmbedding` (`:729-768`) calls this function at `:744` and stamps
the result on the `RegistryGeneration` record (`:745-752`) and passes it to
`buildGeneration` (`:758`) — the hardcoded 1024/cosine reaches Milvus itself,
not just a descriptor field. The P0 default binding (Qwen3-Embedding-4B) is
2560‑d, so today's default generation would silently build the WRONG vector
space even with zero provider changes.

## `generationVectorSpace` sits directly upstream of the cardinal-honesty cutover gate

`planCutoverEmbedding` (`registry-backend.ts:777-799`) already refuses to
activate a generation unless `staged.validated === true` and a matching
built generation is found (`:783-788`, "cardinal honesty: no physically built
+ validated generation → refuse"). Wiring the probe into
`generationVectorSpace` therefore only has to change ONE function; the
refusal path for an unbuildable/unprobed generation already exists as a
pattern to extend (fail the `planReindexEmbedding` effect before it reaches
`buildGeneration` when no dimension is available).

## `OutputRef` is a spool handle, not a file path — verified

`packages/schema/src/semantic/refs.ts:72-76`:

```ts
// OutputRef is a Feature 005 OutputSpool content handle for a sanitized chunk body (FR40, C9).
export const OutputRef = Schema.String.annotate({ identifier: "SemanticRefs.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.OutputRef"))
```

and `schema/src/semantic/documents.ts:107-112` (`ChunkBodyRef`): `output_ref`
plus `offset`/`limit` — the offsets index the SANITIZED spool body, never raw
file bytes. The only existing "implementation" today is
`milvus-binding.ts:116-118`'s `boundedSpool` fallback, which returns a literal
string `` `spool:reconcile:${collection}` `` and is never resolvable — it is a
content-free audit stub, not a real store. Feature 005's actual producer API
(`packages/protocol/src/outputspool/ports.ts:70-99`,
`SpoolWriterPort.open/append/seal` + `SpoolReaderPort.stat/read/follow`) is
the real store `skill-chunk.ts` must write through; there is no existing
skill-chunk-specific wrapper over it.

## Deletion tombstones — verified working end-to-end

`index-jobs.ts:63` (`planMutations`): `tombstones = indexed.filter((doc) =>
!liveIds.has(doc.canonicalId))` — an indexed doc absent from the live set
tombstones. `milvus-binding.ts:189` (`runReconcile` call inside
`runMaintenance`) applies the plan via `IndexJobs.runReconcile`, which itself
calls `deps.milvus.tombstone(...)` when `plan.tombstones.length > 0`
(`index-jobs.ts:189-191`). This path is real and does not need new work; FR9's
`LiveDocSource` only has to feed real `live`/`indexed` sets into the existing
machinery.

## `collect` lacks prior hashes — the embedding-cost gap

`milvus-binding.ts:79-84` (`LiveDocSource.collect`):

```ts
readonly collect: (input: {
  readonly collection: CollectionKind
  readonly projectId: string
}) => Promise<readonly IndexJobs.LiveDoc[]>
```

takes only `{collection, projectId}` — no indexed-hash map. `planMutations`
(`index-jobs.ts:52-65`) already does the content-hash diff correctly (an
unchanged hash never upserts), BUT `collect` must have PRODUCED the
`LiveDoc.contentHash` for every live doc BEFORE `planMutations` runs, which
today means embedding every live agent/skill/tool on every reconcile — the
hash-skip only saves the Milvus upsert call, never the embedding call. FR9
requires extending `collect` to accept the indexed `{id → contentHash}` map
so an unchanged doc's embedding call is skipped too, not just its upsert.

## Zero retry anywhere in the semantic path — verified per call site

- `embedding-client.ts:67-87` (`probe`) and `:102-112` (`embed`): a single
  `deps.http.postEmbeddings` call each, no `Schedule`, no retry.
- `rerank-probe.ts:117-146` (`createRerankValidationProbe`): a single
  `RerankClient.rerankNative`/`rerankStructured` call, no retry.
- `milvus-adapter.ts` REST client (`createHttpMilvusClient`, referenced at
  `stack-live.ts:581-586`): per-attempt `AbortController` timeout but no
  retry loop around it (confirmed by the 006 research note this feature's
  research inherits, re-verified: no `Schedule` import in the file).
- `index-jobs.ts:176-200` (`runReconcile`): a single `Effect.gen` pass; a
  `MilvusGap` from `upsert`/`tombstone` propagates directly out.

The only existing retry primitive in the whole tree is
`packages/opencode/src/util/effect-http-client.ts:1-11`
(`withTransientReadRetry`): 2 retries, `Schedule.exponential(200).jittered`,
via `HttpClient.retryTransient`. **Important scoping note**: this helper is
typed over `HttpClient.HttpClient.With<E, R>` — an Effect `HttpClient`
pipeline — not over an arbitrary `Effect.Effect<A, E>`. `MilvusPort` methods
(`milvus-adapter.ts:163-173`) return plain `Effect.Effect<A, MilvusGap>`, not
an `HttpClient` pipeline, so FR12's data-plane retry cannot literally reuse
`withTransientReadRetry` as-is — it must extend the SAME *pattern*
(exponential-jittered `Schedule`, ≤3 attempts, typed-transient
classification) as a sibling helper over plain `Effect`, composed with
`Effect.retry(schedule.pipe(Schedule.whileInput(isTransient)))`, so there is
still exactly one retry-policy owner, not a fork of the concept.

## `retry_depth` is inert — verified the exact non-increment site

`packages/schema/src/routing/budget.ts:129-133`
(`ConsumptionResilience.retry_count`) is a real schema field.
`packages/opencode/src/session/budget-consume.ts:107-123`
(`accumulateConsumption`) explicitly carries it unchanged:

```ts
resilience: prior.resilience,   // line 121 — never incremented anywhere in this module
```

No other call site in `packages/opencode/src/semantic/**` or
`packages/opencode/src/operator/semantic/**` writes to
`Budget.ConsumptionResilience`. `resilience.retry_depth`
(`checkResilience`, referenced from `budget-consume.ts:36`) is therefore
compared against a counter that can only ever read 0 — the knob is
structurally present and functionally dead. FR12 requires every data-plane
retry this feature adds to increment this counter through the existing
`RoutingSessionStateStore` accumulation path, not a parallel counter.

## `Agent.Info`/`Skill.Info` are thinner than `AgentDoc`/`SkillDoc` expect

`packages/schema/src/agent.ts:20-31` (`Agent.Info`): `id`, `model`, `request`,
`system`, `description`, `mode`, `hidden`, `color`, `steps`, `permissions`.
There is **no** `domains`, `capabilities`, or `tools` field.
`packages/schema/src/skill.ts:20-26` (`Skill.Info`): `name`, `description`,
`slash`, `location`, `content`. There is **no** `triggers`, `domains`, or
`capabilities` field either. `AgentDoc.taxonomy`
(`schema/semantic/documents.ts:57-61`, `AgentTaxonomy`) and
`SkillDoc.taxonomy` (`:69-73`, `SkillTaxonomy`) both declare these as
first-class `TagSet` fields per the Feature 006 shape. The FR7 Info→Doc
builders must therefore default `domains`/`capabilities`/`tools`/`triggers`
to empty `TagSet`s rather than inventing signal that does not exist on the
live source — this is a real mapping gap, not a plan oversight, and it is
DELIBERATE: `Projection.RANKING_SIGNAL_FIELDS`
(`core/src/semantic/projection.ts:67`) already documents these as
ranking-only, so an empty set only ever narrows candidate ranking quality,
never authority.

## `permission_ref` has no existing agent/skill producer

`DocScope.permission_ref` (`schema/semantic/documents.ts:33`) is a
`Refs.PermissionRef` — an opaque string. The only existing producer of a
`permission_ref` value today is the CALLER-supplied `ToolProjectionInput.scope`
(`tool-projection.ts:118-131`, consumed as an opaque pass-through, never
computed from a live tool). Neither `Agent.Info` nor `Skill.Info` carries
anything named `permission_ref` — `Agent.Info.permissions` is a full
`Permission.Ruleset` (`schema/agent.ts:30`), and `Skill.Info` carries no
permission field at all (permission evaluation for skills happens
externally via `PermissionV2.evaluate("skill", skill.name, agent.permissions)`,
`core/skill.ts:31`). FR7's builders must therefore DERIVE a stable
`permission_ref` (e.g. a content hash over the serialized ruleset, reusing
the `ToolProjection.contentHash` pattern, `tool-projection.ts:116-132`) rather
than reading a field that does not exist.

## Metric-vocabulary mismatch between the new CUE and the shipped schema

`doc/arch/schemas/wire-the-semantic-index-data-plane-production-pipeline.cue:39`
(`#ProbedVectorSpace.metric`) declares `"cosine" | "ip"`. The shipped
`packages/schema/src/semantic/enums.ts:50` (`Metric`) declares
`Schema.Literals(["cosine", "inner-product"])`, and
`registry-backend.ts:697-699`'s `MetricKind` (imported from
`@opencode-ai/protocol/semantic/commands`) is the same two-member enum. The
dimension-probe wiring (FR6) MUST map the probe's metric finding onto the
EXISTING `"cosine" | "inner-product"` vocabulary at the port boundary — `"ip"`
must never leak into `RegistryGeneration.metric` or `MilvusPort` calls. This
is a naming alignment the tasks phase must apply at the CUE↔TS boundary
(either the CUE literal is a display-only shorthand resolved in the impl, or
it is corrected in a follow-up commit); it does not block this plan.

## Reconcile/rebuild race — verified no existing lock

`milvus-binding.ts:125-196` (`createMilvusIndexPort`) composes `reindex`
(`full: true`, `:192`) and `reconcile` (`full: false`, `:193`) as two
independently callable `runMaintenance` invocations with no mutual-exclusion
primitive between them — nothing in this file, `index-jobs.ts`, or
`stack-live.ts` acquires any lock before either runs. `IndexGeneration`'s
`cutover` (`core/src/semantic/index-generation.ts:47`) atomically swaps
aliases, but nothing prevents a concurrent `reconcile` from upserting into
the outgoing (about-to-be-superseded) generation's alias in the same window.
FR10's per-profile single-writer `#ReconcileLock`
(`wire-the-semantic-index-data-plane-production-pipeline.cue:81-85`) is
genuinely new; there is no existing lock primitive in this tree to reuse
beyond the general pattern (compare-and-swap over a config document, the same
technique `registry-backend.ts` already uses for the binding document
itself).

## Existing coalescing/trigger pattern to mirror, not force

`tool-reindex-trigger.ts:1-60` implements the Feature 009
corpus/mcp/config trigger-coalescing pattern purely over
`IndexJobs.coalesceTriggers` (`index-jobs.ts:68-69`) and the existing
`IndexPort.reindex`/`reconcile({ collection: "tools" })`. It is explicitly
scoped to MCP-server-batch triggers (`ToolReindexTriggerEvent`,
`mcpServerId`-keyed coalescing, `:1-20`) — mirroring its STRUCTURE for
agents/skills triggers (CLI full build + discovery-time incremental
reconcile) is correct per FR10; routing agents/skills through this literal
module would misuse its MCP-specific coalescing key.

## Evidence boundaries

- Path anchors may drift in the tasks phase; they do not authorize
  implementation beyond `spec.md` FR1–FR13.
- This research does not resolve the CUE metric-vocabulary naming question;
  it flags it as a plan risk (see `plan.md` "Risks").
- Numeric retry/backoff/timeout constants are the approved-plan defaults
  (`#DataPlaneRetryPolicy`, CUE `:68-74`); this note does not re-derive them.

## Related evidence

- [Feature 050 specification](spec.md)
- [Feature 006 specification](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) and [research](../006-add-milvus-backed-multilingual-semantic-retrieval-and/research.md)
- [Feature 009 Semantic Tool Search](../009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md)
- [Feature 005 OutputSpool](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [ADR-0007](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md), [ADR-0008](../../adr/0008-milvus-semantic-retrieval-stack.md)
- `doc/arch/schemas/wire-the-semantic-index-data-plane-production-pipeline.cue`
