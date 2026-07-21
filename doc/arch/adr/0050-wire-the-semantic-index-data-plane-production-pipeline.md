---
status: proposed
date: 2026-07-21
deciders: [your-org]
consulted: []
informed: []
---

# Wire The Semantic Index Data Plane Production Pipeline

## Context and Problem Statement

ADR-0008 (Feature 006) decided and built a Milvus-backed multilingual semantic
retrieval and reranking stack: a nine-stage `Pipeline.run`
(`packages/core/src/semantic/pipeline.ts:131`), an embedding client
(`embedding-client.ts:102`), a Milvus adapter with blue/green generations and
alias-swap cutover (`milvus-adapter.ts:164`), a rerank client, hybrid fusion, and
document shapes for `agents`/`skills`/`skill_chunks` (`documents.ts`). ADR-0007
extended the same stack with a `tools` collection. Both ADRs are, on paper,
accepted architecture — but an audit of the live code (folded into the plan that
authorizes Features 050–053) found the stack shipped **dormant**:

- The only assembly of pipeline + Milvus + embedding + rerank is
  `retrieval-facade.ts`'s test double; there is no production
  `PipelineRunnerPort`. Nothing in the running binary ever calls
  `Pipeline.run` or `ToolPass.run` outside tests.
- There are no `Info→Doc` builders that turn a live `Agent`/`Skill` into an
  `AgentDoc`/`SkillDoc`, and no skill chunker — `chunkBody`
  (`core/src/semantic/projection.ts:133`) is wired for tools only and is unused
  for skills.
- `LiveDocSource` and the reconcile `context` are never constructed — Feature 002's
  scheduled reconcile and the `embedding-reindex` CLI hit the `milvus_unavailable`
  gap for agents/skills/skill_chunks today, and `collect` receives no prior
  content-hash map, so an unchanged corpus cannot skip the embedding cost even
  when it could skip the upsert.
- `generationVectorSpace` (`registry-backend.ts:696-702`) ignores the bound model
  and always returns `defaultDimension ?? 1024` on cosine — wrong even for the
  fixed default embedding model, Qwen3-Embedding-4B, which is 2560-dimensional. A
  provider switch would silently reuse the wrong vector space instead of failing.
- No retry exists anywhere in the semantic path: embedding calls, rerank calls,
  probes, and every Milvus write (upsert/tombstone/enumerate/buildGeneration) are
  single-attempt. The budget knob `resilience.retry_depth`
  (`schema/routing/budget.ts:56`) is checked by `checkResilience` but never fed —
  `retry_count` is carried unchanged through `budget-consume.ts:107` ("Phase 3"
  comment) — so the resilience policy is configured but inert.
- Nothing populates the index and nothing runs the pipeline in production: the
  data plane that ADR-0008 designed has never executed against real data.

Feature 050 activates ADR-0008's **data plane only** — the runner, the document
builders, the chunker, live indexing/reconcile, model-driven dimension discovery,
and data-plane retries. It makes zero live-turn behavior change: no seam in the
session/turn path is touched, and today's full agent/skill/tool catalogs remain
byte-identical for every live prompt. Wiring the QUERY plane (narrowing what a
turn actually sees) is out of scope here and lands in Feature 051.

## Decision Drivers

- Activate ADR-0008's designed data plane instead of re-designing it: no second
  pipeline, no second Milvus adapter, no second document schema.
- No hardcoded embedding dimension, ever — the bound model's real capabilities
  must be discovered, not assumed, and an unknown capability must never resolve
  to a silent default.
- Zero live-turn behavior change — Feature 050 only makes the index
  populatable and correct; it must not alter what any live turn sees.
- Reuse over duplication: one credential resolver, one Milvus-port composition
  helper, one narrowing primitive, one token estimator, one retry helper —
  audited call sites, not parallel implementations.
- The index/data plane and the live/query plane have different risk profiles and
  therefore different failure postures: a bad write corrupts every future read,
  so the data plane must fail CLOSED; a slow or down dependency must never block
  a turn, so the (separately-scoped) query plane fails OPEN.
- Body content belongs in the Feature 005 OutputSpool content plane, never as an
  inline field or a filesystem path — `SkillChunkDoc.body_ref` is a content
  handle, and the index-time chunker is the first production writer of that
  content.

## Considered Options

- **Build the production `PipelineRunnerPort`, doc builders, chunker,
  `LiveDocSource`, model-driven dimension discovery, a single-writer reconcile
  lock, and data-plane retries directly on top of ADR-0008's existing pipeline,
  adapter, and document shapes (chosen).** Every new component is an
  implementation of a port ADR-0008 already declared, or a fix to a value
  ADR-0008 already specified as provisional (the hardcoded 1024 dimension). No
  new architectural surface is introduced.
- **Build indexing as a plugin outside the compiled binary.** Rejected: the
  dormant infrastructure (pipeline stages, Milvus adapter, blue/green cutover,
  reserved `semantic.*` operator catalog) already lives in-binary per ADR-0008's
  single-authority decision; a plugin would duplicate that infrastructure a
  second time outside it, split the SSOT for embedding/rerank bindings, and
  reopen the "no second Milvus adapter/operator surface" driver ADR-0008 already
  closed.
- **Keep the hardcoded `defaultDimension ?? 1024` and document Qwen3-Embedding-4B
  as an out-of-band exception.** Rejected: this is silently wrong for the fixed
  default model (2560-d, not 1024-d) today, not just for a future provider
  switch; ADR-0008 (C3) already forbids a hardcoded model assumption standing in
  for a probed capability, and a wrong dimension is not a degraded result — it
  corrupts the index (`requiresNewGeneration` would never trigger, so writes
  would land in a vector space the model never produced).
- **Skip model-driven discovery and require an operator to hand-enter the
  dimension per binding.** Rejected: manual entry reintroduces exactly the
  silent-mismatch risk ADR-0008's fail-closed posture (C14, C20) rules out — a
  typo or stale value would pass structural validation and only break at
  Milvus's vector-dimension check, deep in the write path, instead of at
  generation build time where the gap is typed and actionable.

## Decision Outcome

Chosen option: activate ADR-0008's data plane in place, by implementing the
production runner, builders, chunker, live wiring, dimension discovery, and
retry policy as ports and fixes over the existing pipeline/adapter/document
contracts.

1. **Build the production `PipelineRunnerPort`.** `runAgents`/`runSkills` embed
   the prompt once (`EmbeddingClient.embed`), assemble `PipelinePorts`
   (`recall` → `MilvusPort.search`, `rerank` → `RerankClient`) and call
   `Pipeline.run`; `runTools` calls `ToolPass.run` instead (tools never go
   through `Pipeline.run`). The runner performs its OWN agent revalidation after
   `Pipeline.run` — re-checking every ranked agent id against the live registry
   and dropping dead hits — because `Pipeline.run` revalidates skills only
   (`pipeline.ts:157`) and does not revalidate agents; `revalidated:true` becomes
   an earned flag per surface (agents via the runner's own check, skills via the
   pipeline, tools via `ToolPass.run:141`), never an unconditional stamp.
2. **Model-driven dimension and capability discovery, fail-closed on
   unknown.** A live endpoint probe (`EmbeddingClient.probe`, extended
   `rerank-probe.ts` validate probe for the reranker) is the authoritative
   source of vector dimension, normalization, and reranker capabilities;
   `ModelsDev.Service` metadata is a secondary cross-check only, used to warn on
   mismatch, never to override a probed value. If the probe fails and no prior
   probed value exists for the binding, generation build REFUSES with a typed
   gap — there is no silent default, not even for the fixed default model.
3. **`Info→Doc` builders in core, IO in opencode.** The pure `Info→Doc` field
   mapping for `AgentDoc`/`SkillDoc` lives in `core/src/semantic/` beside
   `projection.ts`, reusing `scrubText`/`sanitizeFields` and the existing
   content-hash pattern; the `Agent.list()`/`Skill.all()` IO and the
   `LiveDocSource.collect` implementation live in opencode. `collect` accepts
   the indexed `{id → contentHash}` map so an unchanged document is never
   re-embedded, only its absence from a diff is what may still require an
   upsert or tombstone.
4. **A skill chunker with a real OutputSpool store.** `core/src/semantic/
   skill-chunk.ts` turns a skill body into bounded, sanitized `SkillChunkDoc[]`
   via `chunkBody`; the chunker WRITES each sanitized chunk body to a real
   Feature 005 OutputSpool store (today only a non-resolvable stub exists) and
   stamps `body_ref` as the resulting `OutputRef` — never inline body text and
   never a filesystem path, per the existing forbidden-field guard
   (`projection.ts:41`). Spool entries are content-hash-keyed alongside their
   chunk docs so reconcile supersedes or deletes them together with the chunks
   they belong to.
5. **A per-profile single-writer reconcile lock.** An incremental reconcile and
   a full blue/green rebuild are mutually exclusive for a given profile —
   without this, a reconcile upserting into the live-alias generation while a
   rebuild alias-swaps could orphan those upserts. One opencode instance per
   profile owns index maintenance; this assumption is documented, not merely
   assumed.
6. **A data-plane retry policy — bounded, typed, and never blind.** Embedding
   batches, Milvus upsert/tombstone/enumerate/buildGeneration, and reconcile
   steps get bounded jittered exponential retry (≤3 attempts,
   `Schedule.exponential(500ms).jittered` capped near 5s, composed
   retry-inside-deadline), extending the existing `withTransientReadRetry`
   shape rather than adding a fourth inline copy. Classification is typed and
   transient-only: `milvus_unavailable`, transport/timeout, and 429/5xx retry;
   domain errors (`invalid_filters`, `dimension_mismatch`,
   `reranker_not_eligible`, schema rejects) never retry. Embed batches retry per
   batch so one failure never restarts a whole reindex. `cas_conflict` is never
   blind-retried — it re-reads the current version, re-plans, and retries once.
   Probes get 2 bounded retries then fail closed, per the existing rule.
   Cutover/alias-swap retries transport errors only before any mutation is
   confirmed; after an ambiguous outcome it verifies state instead of
   re-issuing, with `rollback` as the recovery path. These retries are the first
   call sites to increment `ConsumptionResilience.retry_count`
   (`budget-consume.ts`), making the previously inert
   `resilience.retry_depth`/`escalation_threshold` knobs real.
7. **Reuse contract — no duplication.** Auth resolves exclusively through the
   existing `semantic/credential-resolver.ts` (not a new closure). Milvus-port
   composition is extracted from `operator/stack-live.ts:588-610` into ONE
   shared helper used by both the operator stack and the new runner. Tool
   narrowing (out of scope here, but the primitive is shared) stays on
   `ToolRetrieval.narrow`/`narrowRecord`. Internet metadata reuses
   `ModelsDev.Service` (`core/src/models-dev.ts:137`); token counting starts
   with `Token.estimate` (`core/util/token.ts`) with `gpt-tokenizer` only as a
   later upgrade if budget accuracy demands it.
8. **Zero live-turn behavior change in this feature.** Feature 050 populates
   and correctly maintains the index and exercises the pipeline via CLI/reconcile
   only; no session/turn seam is touched, so every live turn's agent, skill, and
   tool catalogs remain byte-identical. This is also where the stack's two
   failure postures diverge for the first time: the INDEX/data plane built here
   fails CLOSED (unknown dimension refuses generation build; invalid documents
   are rejected) because a wrong index silently corrupts every future query,
   while the LIVE QUERY plane — wired in Feature 051 — fails OPEN (any
   retrieval failure passes through to today's full catalogs) because a turn
   must never be blocked or handed an empty catalog. Feature 050 builds only the
   fail-closed half of that boundary.

### Consequences

#### Positive

- The semantic index becomes populatable, and populated correctly per the
  actually-bound model, closing the single largest gap in ADR-0008's design:
  a stack that was accepted on paper but had never run against real data.
- Features 051 (live query wiring), 052 (auto-skill), and 053 (orchestration
  handoff) can build on a real, reconciled index instead of an empty or
  wrong-dimension one.
- A new operational surface exists: reindex, reconcile, and the reconcile lock
  are real, observable operations an operator can run and audit via the
  existing `semantic.*` catalog, with no new command IDs.
- The previously inert `retry_depth`/`escalation_threshold` budget knobs become
  live, auditable behavior instead of dead configuration.

#### Trade-offs

- A single-writer lock constrains index maintenance to one opencode instance
  per profile; a multi-instance-per-profile deployment is out of scope until a
  future feature revisits the lock design.
- Model-driven discovery makes generation build strictly harder to pass: an
  unreachable or non-conforming embedding endpoint now refuses the build
  instead of silently defaulting, which is a deliberate trade of availability
  for correctness (per ADR-0008 C3/C14's fail-closed-on-unknown posture).
- The chunker's OutputSpool dependency means Feature 005's content plane is now
  a hard prerequisite for skill-chunk indexing, not an optional integration.

## Related

- Activates the data plane of [ADR-0008 — Milvus-Backed Multilingual Semantic
  Retrieval and Reranking Stack](0008-milvus-semantic-retrieval-stack.md).
- Extends the same stack per [ADR-0007 — Semantic Tool Search Over the Shared
  Feature 006 Retrieval Stack](0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md).
- Feature specification: [050 Wire The Semantic Index Data Plane Production
  Pipeline](../sdd/050-wire-the-semantic-index-data-plane-production-pipeline/spec.md).
- Query-plane consumer (out of scope here): Feature 051 — Live query wiring
  (`narrowForTurn`, the three retrieval seams, fail-open boundary).
