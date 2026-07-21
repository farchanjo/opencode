---
id: 019f861c-3ad5-7aa0-a05a-7a1ee9169d3f
number: 050
slug: wire-the-semantic-index-data-plane-production-pipeline
status: analyzed
created_at: 2026-07-21T19:17:04.85353Z
---
# Feature Specification: Wire The Semantic Index Data Plane Production Pipeline

Feature: 050-wire-the-semantic-index-data-plane-production-pipeline
Created: 2026-07-21

## Problem

Feature 006 (`doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md`)
and Feature 009 shipped a semantic reranker stack that is largely built but
**dormant**. The 9-stage `Pipeline.run` (`core/src/semantic/pipeline.ts:131`),
the Milvus adapter (`milvus-adapter.ts:164`), the embedding client
(`embedding-client.ts:102`), the rerank client, and the retrieval facade
(`retrieval-facade.ts:186`) all exist, but no production caller wires them
together:

- **No production `PipelineRunnerPort` exists** — `createRetrievalFacade`
  (`retrieval-facade.ts:87`) is exercised only by tests today; nothing binds
  `Pipeline.run`, `ToolPass.run`, the Milvus port, the embedding client, and the
  rerank client into a live implementation.
- **Agent revalidation is missing on the live path.** `Pipeline.run` revalidates
  SKILLS only (`pipeline.ts:157`); the agents surface is raw reranked output and
  the facade stamps `revalidated:true` unconditionally
  (`retrieval-facade.ts:123`). Tools never go through `Pipeline.run` at all —
  they use `ToolPass.run` (`core/src/semantic/tool-pass.ts:120`, which already
  revalidates at `:141`).
- **No timeout exists.** `retrieval-facade.ts:190-206` relabels any rejection as
  `timeout` after the fact; the `latencyBudgetMs:300` knob
  (`config/experimental.ts:62`) has zero consumers, so a hung Milvus socket
  would block the calling turn indefinitely.
- **Embedding dimension is hardcoded.** `generationVectorSpace` ignores the
  bound model and always returns `defaultDimension ?? 1024` / cosine
  (`registry-backend.ts:696-702`); `stack-live.ts:610` passes no dimension. This
  is wrong even for the default Qwen3-Embedding-4B binding (2560-d) and would
  silently reuse the wrong vector space on any provider switch.
- **`LiveDocSource`/`context` are unwired** (`stack-live.ts:588-609` sets
  neither), so reindex hits the `milvus_unavailable` gap; `collect` receives no
  prior content hashes, so the hash-diff at `index-jobs.ts:187` skips only the
  upsert, never the embedding cost.
- **No `Info→Doc` builders and no skill chunker exist.** There is no
  `Agent.Info→AgentDoc` / `Skill.Info→SkillDoc` field mapping, and
  `Projection.chunkBody` (`projection.ts:133`) is unused for skills — the
  `skill_chunks` collection has no producer.
- **Every semantic call site is fail-fast.** Embedding/rerank/probes/index-jobs
  have no retry policy; `resilience.retry_depth: 2`
  (`schema/routing/budget.ts:56`) is inert because `retry_count` is never
  incremented (`budget-consume.ts:107`).

This feature (SR-A, per the approved semantic-selection plan) builds the
**data plane only**: the production runner, the doc builders, the chunker, the
`OutputSpool`-backed chunk store, `LiveDocSource` wiring, model-driven
dimension/capability discovery, reindex triggers, and the retry policy. It
makes `embedding-reindex` produce a real, queryable, correctly-dimensioned
index on `~/.opencodedev`. It changes **zero live-turn behavior** — no session
code path calls the facade yet (that wiring is Feature 051).

## User Stories

- As an operator running `embedding-reindex` on the profile, I want a real
  production pipeline runner (not a test-only facade) so that agents, skills,
  skill chunks, and tools are actually embedded and upserted into Milvus.
- As a developer relying on the semantic index, I want the embedding
  generation to carry the model's real probed dimension (2560 for
  Qwen3-Embedding-4B, not a hardcoded 1024) so that vectors are never silently
  built in the wrong space.
- As a future feature (Feature 051 live wiring, Feature 052 auto-skill,
  Feature 053 orchestration) consuming this data plane, I want a stable,
  revalidating, deadline-bound facade with a real `EmbeddingsHttpPort` and a
  resolvable `OutputSpool`-backed `body_ref` so that I can build live retrieval
  on top of it without re-deriving these seams.

## Functional Requirements

1. **FR1 — Production `PipelineRunnerPort`.** `pipeline-runner.ts` (new,
   `packages/opencode/src/semantic/`) implements the production
   `PipelineRunnerPort` consumed by `createRetrievalFacade`
   (`retrieval-facade.ts:87`): `runAgents`/`runSkills` embed the prompt once
   (`EmbeddingClient.embed`), build `PipelinePorts` (`pipeline.ts:69-85` —
   `recall` → `MilvusPort.search({collection, dense, filters, topK,
   metric:"cosine"})`, `rerank` → `RerankClient`) and call `Pipeline.run`;
   `runTools` calls `ToolPass.run` (`tool-pass.ts:120`) instead, never
   `Pipeline.run`.
2. **FR2 — Runner-level agent revalidation.** After `Pipeline.run` returns,
   the runner re-checks every ranked AGENT id against the live registry
   (`agent.get` + permission) and drops dead hits before stamping
   `revalidated:true` — the facade's flag becomes earned per surface (agents:
   runner-checked; skills: pipeline-checked at `pipeline.ts:157`; tools:
   `ToolPass`-checked at `tool-pass.ts:141`), never unconditional.
3. **FR3 — Real per-surface deadline.** Each surface call is wrapped in
   `Effect.timeout(latencyBudgetMs)`, consuming the existing
   `latencyBudgetMs:300` knob (`config/experimental.ts:62`) instead of the
   post-hoc relabeling at `retrieval-facade.ts:190-206`; a timeout yields that
   surface `undefined`, never a hang.
4. **FR4 — Facade lifecycle, port composition, and auth.** The facade is a
   per-instance singleton declared with the canonical
   `Context.Service<...>()("@opencode/...")` pattern (as `agent.ts:99`,
   `tool/registry.ts:85`). The Milvus-port composition inlined in
   `operator/stack-live.ts:588-610` is extracted into ONE shared helper used
   by both the operator stack and the new runner — never a second
   constructor. Auth resolution goes exclusively through
   `semantic/credential-resolver.ts` (`SecretRef`/`resolvePolicy`); the
   `resolveAuthHeader` closure at `stack-live.ts:560-575` is never copied to a
   third call site, and `secretRef: null` (the solaris default) produces no
   auth header.
5. **FR5 — First production `EmbeddingsHttpPort`.** A production
   `EmbeddingsHttpPort` implementation is added following the
   `createFetchRerankHttpClient` transport shape (`rerank-probe.ts`) plus
   `util/effect-http-client.ts` `withTransientReadRetry` — today
   `postEmbeddings` has zero production callers.
6. **FR6 — Model-driven dimension/capability discovery ladder.** Dimension and
   capability discovery for both embedding and reranker slots follows a fixed
   ladder: (1) **live probe, authoritative** — `EmbeddingClient.probe`
   (`embedding-client.ts:61-95`) is wired into `generationVectorSpace`
   (`registry-backend.ts:696-702`) so the ACTUAL embedded-vector length and
   normalization are stamped on the model descriptor and generation; the
   existing `rerank-probe.ts` validate probe is extended to capture reranker
   capabilities (mode support, score range, max documents/context); (2)
   **`ModelsDev.Service` metadata cross-check, secondary** — the shipped
   catalog client (`core/models-dev.ts:137`) is extended for embedding-model
   metadata and warns on a probe/catalog mismatch, with the probe winning any
   conflict; offline skips this step silently; (3) **fail CLOSED on unknown**
   — if the probe fails and no cached/probed dimension exists, generation
   build refuses with a typed gap. There is no silent `1024` default anywhere
   in this ladder.
7. **FR7 — `AgentDoc`/`SkillDoc` field mappings.** `IndexJobs.agentLiveDoc`/
   `skillLiveDoc` wrappers already exist (`index-jobs.ts:111,135`); this
   feature adds only the pure `Agent.Info→AgentDoc` / `Skill.Info→SkillDoc`
   field mapping, in `core/src/semantic/` beside `projection.ts` (reusing
   `scrubText`/`sanitizeFields` and the `ToolProjection` content-hash
   pattern). `languages`/`language_tag` are populated (required per
   `documents.ts:124,94,151`). These are ranking-only fields — no bodies.
8. **FR8 — Skill chunker and `OutputSpool` chunk store.** `skill-chunk.ts`
   (new, `core/src/semantic/`) turns a `SKILL.md` body into
   `SkillChunkDoc[]` via `Projection.chunkBody`, capped by
   `max_skill_chunks`, using `Token.estimate` (`core/util/token.ts`) for the
   precomputed `totalTokens` input (no new dependency at this stage).
   `body_ref` is an `OutputRef` (`schema/semantic/refs.ts:72-76`) into a REAL
   `OutputSpool` store — the only implementation today is a non-resolvable
   stub (`milvus-binding.ts:116-118`). The chunker writes sanitized chunk
   bodies to the spool and stamps the ref; the raw body is never inlined
   (the forbidden-field guard at `projection.ts:41`). Spool entries are
   content-hash-keyed alongside their chunk docs so reconcile
   supersedes/deletes them together with the chunks.
9. **FR9 — `LiveDocSource` and reindex wiring.** `LiveDocSource.collect` is
   implemented for `agents`/`skills`/`skill_chunks` (embedding docs, wrapping
   via `IndexJobs.agentLiveDoc`/`skillLiveDoc`); `collect` is extended to
   receive the indexed `{id → contentHash}` map so unchanged docs are never
   re-embedded. `source` and `context` (the P0 `project_id` plus skill
   `MandatoryFilters`) are wired into `MilvusIndexBindingDeps` in
   `operator/stack-live.ts` (not backend-live).
10. **FR10 — Reindex triggers and reconcile/rebuild lock.** Reindexing is
    driven by the CLI full build plus discovery-time incremental reconcile,
    both built over the generic `IndexJobs.coalesceTriggers`
    (`index-jobs.ts:68`) — never forced through
    `tool-reindex-trigger.ts` (MCP-server-batch-specific; its structure is
    mirrored only). A per-profile single-writer lock serializes an
    incremental reconcile against a blue/green rebuild so an in-flight
    alias-swap can never orphan a concurrent reconcile's upserts.
11. **FR11 — Tool-id equality invariant.** Index-time `ToolDoc.id`
    (`ToolProjection`, `tool-projection.ts:155`) MUST equal the runtime
    key — `registry.tools()` item id (`${namespace}_${id}`,
    `registry.ts:191`) for native/plugin tools, and the `mcp.tools()`
    record key (server-prefixed) for MCP tools. A test asserts equality for
    all three classes; a mismatch would make the enabled tool surface drop
    everything once Feature 051 wires narrowing.
12. **FR12 — Data-plane retry policy.** Embed batches, Milvus
    upsert/tombstone/enumerate/buildGeneration, and reconcile use bounded
    jittered exponential backoff (≤3 attempts, inside the operation's
    deadline), extending the house `withTransientReadRetry`
    (`util/effect-http-client.ts:4-11`) with typed transient-only
    classification — `milvus_unavailable`, transport/timeout, and 429/5xx
    retry; domain errors (`invalid_filters`, `dimension_mismatch`,
    `reranker_not_eligible`, schema rejects) never retry.
    `cas_conflict` is never blind-retried — the current version is re-read
    and re-planned before one retry. Embed batches retry per batch (a failed
    batch never restarts the whole reindex). Probes (dimension probe, rerank
    validate) get 2 bounded retries then fail closed. Cutover/alias-swap
    never blind-retries after an ambiguous outcome — state is verified via
    `enumerateIndexed`/alias read instead of re-issuing the mutation. Every
    retry in this policy increments `ConsumptionResilience.retry_count`
    (`budget-consume.ts:107`), activating the previously-inert
    `resilience.retry_depth` knob.
13. **FR13 — Zero live-turn behavior change.** No live session/turn code path
    calls the facade or the new runner in this feature — reindex, reconcile,
    and the CLI verification commands are the only callers. A live turn's
    tool/skill/agent surfaces are byte-identical before and after this
    feature ships (that wiring is Feature 051).

## Non-Goals

- Live-turn narrowing of agents/skills/tools by the reranker — Feature 051.
- Auto-skill semantic priming (`<auto_skills>` injection) — Feature 052.
- Deterministic orchestration handoff (Architect → Manager → Worker via
  Data/Composer sub-sessions) — Feature 053.

## Security Requirements

- **Data sensitivity/classification.** The index holds sanitized agent/skill/
  tool metadata and sanitized skill-chunk bodies (via the `OutputSpool` ref,
  never inline) — treat as private project configuration surface, consistent
  with Feature 006 FR17. No secrets, full prompts, reasoning, or filesystem
  paths are ever written to a document or spool entry.
- **Authentication/authorization.** All embedding/rerank HTTP calls resolve
  auth exclusively through `semantic/credential-resolver.ts`; `secretRef: null`
  (the solaris default) never sends an auth header, and a `secretRef` value
  is never logged or written to a document. No new authenticated end-user
  surface is introduced — this feature is operator/CLI-invoked only.
- **Input validation.** The only untrusted input processed is `SKILL.md`
  body text and `Agent.Info`/`Skill.Info` fields, which are chunked and
  sanitized via `Projection.chunkBody`/`scrubText`/`sanitizeFields` before
  ever reaching the spool or the index; the forbidden-field guard
  (`projection.ts:41`) rejects an inline body outright. `project_id` and
  `MandatoryFilters` are schema-bounded scalar metadata, never free-form
  query predicates.
- **Cryptography in transit/at rest.** Milvus and the embedding/rerank HTTP
  endpoints are reached per the existing Feature 006 SSRF/TLS posture; this
  feature adds no new network surface beyond the production
  `EmbeddingsHttpPort` client, which reuses the same transport contract as
  the existing rerank probe client.
- **Logging/audit.** Reconcile logs upserted/deleted counts and the typed
  retry/degradation reason only; `retry_count` increments are visible in the
  resilience consumption record without content. No query text, document
  body, vector, or credential is ever logged.
- **Error-handling information exposure.** A refused generation build
  (unknown dimension) or a failed probe surfaces a typed capability-gap code
  only — never a raw HTTP error body, endpoint detail, or credential.

## Acceptance Criteria

1. **Full reindex, four collections.** Given `embedding-reindex` runs on
   `~/.opencodedev` (`OPENCODE_CONFIG_DIR=~/.opencodedev`), when the job
   completes, then all four collections (`agents`, `skills`, `skill_chunks`,
   `tools`) report non-zero upserts.
2. **Real probed dimension.** Given the solaris Qwen3-Embedding-4B binding is
   active, when a generation is built, then the stamped dimension is **2560**
   (probed), never the hardcoded **1024**.
3. **Staleness — delete.** Given a seeded skill file is deleted, when
   reconcile runs, then drift is 0 and the corresponding doc and spool entry
   are gone.
4. **Staleness — edit.** Given a seeded skill body is edited, when reconcile
   runs, then the doc/chunk is superseded (content-hash change), never
   duplicated.
5. **Staleness — no change.** Given reconcile re-runs with no source changes,
   when it completes, then zero embedding calls are made (hash-skip).
6. **Tool-id equality.** Given the tool-id equality test, when it runs against
   native, plugin, and MCP tool classes, then it passes green for all three.
7. **Retry — bounded resume.** Given Milvus is interrupted mid-reindex, when
   the runner retries, then retries are bounded (≤3, jittered exponential),
   reconcile resumes from the last durable per-batch step (no full restart),
   a domain error (for example `dimension_mismatch`) is never retried, and
   `ConsumptionResilience.retry_count` visibly increments.
8. **Probe failure — fail closed.** Given the bound model's endpoint is
   unreachable, when the dimension probe runs, then it retries twice then
   the generation build refuses with a typed capability gap — never a silent
   default dimension.
9. **Profile isolation.** Given any write performed by this feature (config,
   index job state, spool entries), when inspected, then all writes are
   confined to `~/.opencodedev` under `OPENCODE_CONFIG_DIR`.
10. **Provider pluggability.** Given a second embed provider is registered and
    staged via `semantic model register`/`semantic embedding select`, when
    `reindex`+`validate`+`cutover` run, then the atomic alias-swap activates a
    new generation at the newly-probed dimension, and `rollback` restores the
    solaris generation; a reranker switch to `structured-chat` mode and back
    is config-only (no re-embed).

## Observability

Reconcile and full-rebuild jobs log upserted/deleted counts per collection
and the typed degraded/retry reason (content-free); the dimension-probe and
rerank-validate probes log pass/fail plus the resolved capability, never raw
provider response bodies. `ConsumptionResilience.retry_count` becomes a real,
non-zero-observable signal for the first time via this feature's retry
policy, activating the previously-inert `resilience.retry_depth`/
`escalation_threshold` budget knobs. Reuse the Feature 006 semantic span/
metric conventions (`index.upsert`, `index.reconcile`) — this feature adds no
new span names, only real emitters behind them. Export telemetry via OTLP
from the application boundary; keep metric label sets bounded (collection,
outcome, degraded-reason enums; no query text, vectors, or entity/session
IDs), and carry request-scoped identifiers (reindex job id) on trace spans.
Conventions live in `doc/arch/observability/observability.md`.

## Related Features and Decisions

- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
  — owns the pipeline/document/binding contracts this feature wires into
  production; this feature does not redefine them.
- [Feature 009 Semantic Tool Search](../009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md)
  — owns the `tools` collection and `ToolPass.run` this feature's runner
  calls for the tools surface.
- [ADR-0007](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md)
  and [ADR-0008](../../adr/0008-milvus-semantic-retrieval-stack.md) — the
  semantic retrieval stack this feature activates.
- Feature 051 (live wiring), Feature 052 (auto-skill), Feature 053
  (orchestration handoff) — depend on this feature's data plane; none are in
  scope here.

## Clarifications
