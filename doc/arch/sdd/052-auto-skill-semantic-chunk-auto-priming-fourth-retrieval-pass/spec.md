---
id: 019f86a2-b8b2-7550-91ab-2ff33868f13b
number: 052
slug: auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass
status: analyzed
created_at: 2026-07-21T21:43:58.898065Z
---
# Feature Specification: Auto Skill Semantic Chunk Auto Priming Fourth Retrieval Pass

Feature: 052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass
Created: 2026-07-21

## Problem

Feature 050 (SR-A) shipped a real skill chunker (`core/src/semantic/skill-chunk.ts`)
and a production `OutputSpoolStore` (`packages/opencode/src/semantic/
output-spool-store.ts`) so that `SkillChunkDoc.body_ref` — a Feature 005
OutputSpool content handle, never a filesystem path — resolves to sanitized
chunk bodies. Feature 051 (SR-B) wired the live per-turn query plane
(`packages/opencode/src/semantic/live-narrowing.ts`'s `narrowForTurn`) over
three surfaces — agents, skills, tools — and deliberately reserved two
budgets, `max_skill_chunks`/`max_skill_tokens` (`Budget.Retrieval`,
`packages/schema/src/routing/budget.ts:44-45`), spending neither of them:
`SystemPrompt.skills` (`session/system.ts:106-120`) renders only names and
descriptions into `<available_skills>` — Tier-1 listing. The model still has
to call the `skill` tool to load a skill's full body.

The underlying protocol was already designed for a content-level pass: the
Feature 006 wire contract's `RetrievalCandidate.kind`
(`packages/protocol/src/semantic/commands.ts:393`) already includes
`"skill_chunk"` as a valid discriminant, and `RetrievalCandidate.chunkRef?:
OutputRef` (`:396`) already exists "populated only for injected skill
chunks" — but nothing ever issues a request against the `skill_chunks`
collection. `PipelineRunnerPort`'s three bound surfaces
(`packages/opencode/src/semantic/pipeline-runner.ts:297-299`) are
`runAgents`/`runSkills`/`runTools` only; `RetrievalPort`
(`packages/protocol/src/semantic/ports.ts:194-198`) exposes
`retrieveAgents`/`retrieveSkills` only. The fourth pass this feature adds is
not a new architecture — it is the pass the shipped wire contract already
anticipated and left unwired.

Separately, skill discovery today draws no distinction between a
user-authored local skill and a skill pulled from a `cfg.skills.urls` remote
pack: `discoverSkills`'s local-directory scans (`packages/opencode/src/
skill/index.ts:184-221` — global `.claude`/`.agents`, project-relative
scans, `config.directories()`, `cfg.skills?.paths`) and its remote-pack loop
(`:222-227`, `discovery.pull(url)` then the same `scan`) both funnel into
the identical `state.skills: Record<string, Info>` map with no provenance
kept. `Skill.Info` (`:33-38`) carries `name`/`description`/`location`/
`content` only. Auto-injecting a skill's body straight into the system
prompt is a materially higher-trust placement than a model-initiated `skill`
tool call — a remote pack is third-party content the operator did not
author, and injecting it unconditionally would open a prompt-injection
surface Tier-1 listing (names/descriptions only) does not have.

This feature (SR-C, per the approved semantic-selection plan) adds a fourth,
gated retrieval pass over `skill_chunks` to `narrowForTurn`, a confidence
floor before any chunk is considered, a provenance marker restricting
auto-injection to local skills by default, a render pass resolving chunk
bodies through `OutputSpoolStore.resolve` under the two reserved budgets,
and session-scoped dedup — all composing with, and never modifying, Feature
051's three existing surfaces or Feature 050's index/data plane.

## User Stories

- As a user sending a prompt squarely in a seeded local skill's domain, I
  want that skill's relevant guidance auto-primed into the system prompt, so
  that the model gets it without first calling the `skill` tool and losing a
  turn to the round trip.
- As a user sending an off-domain prompt, I want no skill content
  auto-injected, so that the system prompt never carries irrelevant guidance
  the model has to read past.
- As an operator who has installed third-party skill packs via
  `cfg.skills.urls`, I want those packs never auto-injected into the system
  prompt unless I explicitly opt each one in, so that untrusted remote
  content never lands in a higher-trust placement without my say-so.
- As a user in a session where a skill's guidance was already injected
  earlier, I want it not injected again on a later turn, so that the system
  prompt does not accumulate duplicate content across a long session.
- As an operator, I want auto-skill injection independently gated off by
  default and composed with, not a replacement for, Feature 051's skills
  gate, so that enabling it is an explicit, reversible, two-key opt-in.

## Functional Requirements

1. **FR1 — A fourth retrieval pass over `skill_chunks`, sharing the turn's
   existing context.** `narrowForTurn` (`packages/opencode/src/semantic/
   live-narrowing.ts`) gains a fourth concurrent surface issuing a
   `skill_chunks`-collection request, reusing the SAME per-turn prompt
   embedding, the SAME `Effect.all` concurrency group, the SAME shared
   `latencyBudgetMs` deadline, and the SAME `RoutingState` memo keyed by
   `lastUser.id` (`session/routing-state.ts`) that the existing three
   surfaces already use — never a second embed, a second deadline, or a
   second memo. `NarrowedSets` (`routing-state.ts:44-48`) gains an optional
   `chunks?: readonly AutoSkillChunkRef[]` field (`AutoSkillChunkRef =
   {chunkId, skillName, score}`) following the identical absent-means-
   passthrough / present-non-empty-means-narrowed convention as `agents`/
   `skills`/`tools` — a present-but-empty list is never a valid state. This
   pass is gated by a NEW `skill_autoprime` config flag (default `false`)
   that COMPOSES with, and never replaces, the existing Feature 051 skills
   surface gate: the effective gate is `skill_autoprime.enabled &&
   semantic_narrowing.skills.enabled`. Either gate off skips the pass
   entirely — no embedding, no memo write for this surface.
2. **FR2 — Confidence threshold before any chunk is considered.** Only
   `skill_chunk` candidates whose `SemanticScore.confidence`
   (`packages/protocol/src/semantic/commands.ts:386`, real-valued `[0,1]`)
   is at or above a configurable `score_floor` (strict default, `0.75`) are
   kept; every candidate below the floor is dropped before the degenerate-
   to-passthrough normalization FR1 inherits from Feature 051's pattern.
   Zero qualifying candidates resolves the `chunks` surface to passthrough
   (`undefined`) — no `<auto_skills>` block is rendered, and Tier-1's
   `<available_skills>` listing (`session/system.ts`'s existing `skills`
   method) is entirely unaffected; the confidence floor is consulted by
   NOTHING else in the system.
3. **FR3 — `<auto_skills>` system-prompt block, resolved via the OutputSpool
   store.** `SystemPrompt.Service` (`session/system.ts:58`,
   `Context.Service<Service, Interface>()("@opencode/SystemPrompt")`) gains
   a new sibling method (alongside the existing `skills`/`mcp`/
   `environment`) that renders the turn's qualifying chunks into an
   `<auto_skills>` block, following the same `Skill.fmt`-style rendering
   convention `skills` already uses. Each chunk's body is resolved via
   `OutputSpoolStore.resolve(chunk.body_ref.output_ref)`
   (`packages/opencode/src/semantic/output-spool-store.ts:74`) — the
   Feature 050 bounded spool read — and NEVER by reading the raw `SKILL.md`
   file directly; this is the same content-plane discipline Feature 050
   established for the chunker's own writes. A `not_found` or
   `spool_unavailable` error resolving one chunk's ref (a deleted skill, an
   edited-but-not-yet-reindexed body, a fenced/stale generation) causes that
   ONE chunk to be skipped silently — never a rendering error, never a
   partial/garbled body, never a block containing stale content.
4. **FR4 — Render-time budgets, exclusive to Tier 2.** The rendered
   `<auto_skills>` block is bounded by the two budgets Feature 051 already
   reserved and never spent: `Budget.Retrieval.max_skill_chunks` and
   `max_skill_tokens` (`packages/schema/src/routing/budget.ts:44-45`) — no
   new budget constant is introduced. Chunk count is capped at
   `max_skill_chunks`; cumulative body size across resolved chunks (via
   `Token.estimate`, `core/src/util/token.ts`) is capped at
   `max_skill_tokens`, truncating (dropping the lowest-ranked remaining
   chunks first) rather than emitting a partial chunk body. These two
   budgets are spent EXCLUSIVELY by this render pass — Tier-1
   `<available_skills>` listing (Feature 051) never consumes them, and no
   other consumer of `Budget.Retrieval` is introduced by this feature.
5. **FR5 — Provenance trust boundary: local skills only, remote packs
   opt-in.** `Skill.Info` (`packages/opencode/src/skill/index.ts:33-38`) and
   `SkillDoc` (`packages/schema/src/semantic/documents.ts:132-141`) both
   gain a provenance marker: `source: "local" | "remote-pack"`, an optional
   `pack_ref` (the pulled URL), and `autoprime_opt_in: boolean` (default
   `false`). `discoverSkills`'s local-directory scans
   (`skill/index.ts:184-221` — global external dirs, project-relative
   up-scans, `config.directories()`, `cfg.skills?.paths`) stamp
   `source: "local"`; the existing `cfg.skills.urls` remote-pack loop
   (`:222-227`) stamps `source: "remote-pack"` with `pack_ref` set to the
   pulled URL and `autoprime_opt_in` read from a new, separate per-pack
   config allowlist (never a change to the existing `urls: string[]`
   shape). FR1's chunk pass filters candidates to
   `source === "local" || (source === "remote-pack" && autoprime_opt_in ===
   true)` before FR2's confidence floor is even consulted. A remote pack
   without explicit opt-in is completely unaffected by this feature: it
   remains Tier-1 listable (`<available_skills>`) and `skill`-tool loadable
   exactly as today — it is simply never a candidate for `<auto_skills>`
   auto-injection.
6. **FR6 — Session-scoped dedup.** A skill whose chunks were already fully
   rendered into `<auto_skills>` earlier in the same session is not
   re-injected on a later turn, even if it ranks highly again: a new
   session-scoped set (extending `RoutingSessionState`,
   `session/routing-state.ts:60-77`, cleared with the rest of the state at
   the existing `clear`, `:211-213`) records every skill name actually
   rendered; FR3's render pass filters the turn's qualifying chunk set
   against it before resolving bodies. The `skill` tool remains fully
   available for the model to pull a skill's complete, current body at any
   time regardless of dedup state — dedup applies only to the auto-injected
   Tier-2 block, never to Tier-1 listing or tool-based loading.
7. **FR7 — Per-turn memo semantics identical to Feature 051.** The
   `chunks` surface follows the EXACT SAME memoization rules Feature 051
   already established for `agents`/`skills`/`tools`: computed once per
   user turn and read (never recomputed) by every `while (true)` runLoop
   round trip of that same turn (`session/prompt.ts:1337`); a short
   follow-up turn below `min_prompt_length` reuses the prior memo verbatim,
   including its `chunks` field, with no new embedding call; a short FIRST
   turn with no prior memo passes through (no chunks surface, no
   `<auto_skills>` block) without embedding. No second memoization
   mechanism is introduced.
8. **FR8 — Fail-open, content-free observability.** Any failure on this
   feature's path — a `skill_chunks` retrieval rejection or timeout under
   the shared deadline, or an `OutputSpoolStore.resolve` failure — resolves
   to "no injection" for the affected chunk(s) or the whole surface, and
   NEVER blocks the turn or surfaces a raw error to the model or the user;
   this reuses Feature 051's exactly-one-warning-per-turn discipline rather
   than adding a second warning path. The existing opt-in `debug_log`
   config flag (`config/experimental.ts`, Feature 051) is extended to emit
   the injected chunk ids and their scores for this surface — ids and
   scores only, never chunk content, prompt text, or a raw file path.

## Non-Goals

- Deterministic orchestration handoff (Architect → Manager → Worker via
  synchronous Data/Composer sub-sessions, `manager_agent` role binding) —
  Feature 053, which depends on this feature's memo/seam shape and is
  otherwise untouched here.
- Any change to Feature 050's index/data plane, chunker, or the reindex/
  reconcile pipeline — the chunker, `OutputSpoolStore.put`/`supersede`, and
  the content-hash-keyed staleness contract are consumed unmodified.
- Any change to Feature 051's three existing narrowing surfaces
  (`describeTask`, `SystemPrompt.skills`, `session/tools.ts`), its
  `narrowForTurn` gates-off short-circuit, its fail-open/zero-retry
  posture, or its essential-tool floor/hidden-agent pin — this feature adds
  a fourth surface alongside them under the identical discipline; it
  changes none of their existing behavior.
- Revoking `skill`-tool availability for any skill, local or remote — Tier-2
  dedup (FR6) and the provenance gate (FR5) govern auto-injection only,
  never tool-based loading.
- A general-purpose remote-content trust/signing scheme — FR5 is a scoped
  per-pack boolean opt-in, not a broader provenance/attestation system.
- A live retry policy for the fourth retrieval pass or the spool resolve
  call — both are zero-retry, fail-open, per Feature 051's established
  query-plane posture.

## Security Requirements

- **Data sensitivity/classification.** This feature's only new runtime data
  is: the confidence-floored, provenance-filtered ranked chunk-id/skill-
  name/score list held in the `RoutingState` memo (ids and a real-valued
  score only, never chunk content — same classification as Feature 051's
  existing `NarrowedSets` fields); and the resolved, already-sanitized chunk
  bodies (Feature 050's `Projection.scrubText` output, never raw file
  content) that this feature is the FIRST to actually place into the live
  system prompt. Because that placement is materially higher-trust than a
  model-initiated `skill` tool call, FR5 restricts it to local,
  user-authored skills by default — this is the central sensitivity control
  this feature adds, not an afterthought: a remote pack's content is
  third-party and untrusted, and reaches `<auto_skills>` only through an
  explicit, per-pack, operator-set `autoprime_opt_in: true`.
- **Authentication/authorization.** No new authenticated end-user surface.
  `OutputSpoolStore.resolve`'s reads authenticate as the existing
  `SYSTEM_PRINCIPAL` (`kind: "system", id: "semantic-index"`,
  `output-spool-store.ts:42`) Feature 050 already established for chunk
  reads — this feature adds no second principal or resolution path. Content
  reaching `<auto_skills>` is content the model could already read via the
  `skill` tool under the SAME `Permission.disabled(["skill"], ...)` check
  `SystemPrompt.skills` already performs (`session/system.ts:107`); this
  feature changes WHERE trusted content is placed (prompt-injected vs.
  tool-pulled), never WHAT the model is authorized to read. It never widens
  any permission, tool-call, or agent-spawn boundary.
- **Input validation.** The only new untrusted-content path this feature
  introduces is auto-injecting a remote pack's chunk body straight into the
  system prompt — a real prompt-injection surface, closed by FR5's
  local-only default rather than by content inspection. Every chunk body
  this feature ever renders was already sanitized at index time by
  Feature 050's `Projection.scrubText` (`core/src/semantic/skill-chunk.ts`);
  this feature performs no new parsing of hostile content and adds no new
  sanitization step of its own — it is a consumer of an already-sanitized
  content plane, gated by provenance.
- **Cryptography in transit/at rest.** No new network surface: the fourth
  retrieval pass reuses Feature 051's existing Milvus/embedding/rerank
  transport composition verbatim, and FR3's body resolution reuses Feature
  050's existing `OutputSpoolBackend.stat`/`.read` path verbatim. No new
  persisted state — the session dedup set (FR6) is in-memory, per-process,
  and never durably written, same as the rest of `RoutingSessionState`.
- **Logging/audit.** FR8's debug log extension is content-free by
  construction (chunk ids and scores only, never chunk body, prompt text,
  or a resolved file path) and default off, mirroring Feature 051's FR8
  exactly. A resolve/retrieval failure logs at most Feature 051's existing
  one-warning-per-turn budget; this feature never adds a second warning
  path or logs a raw HTTP/spool error body.
- **Error-handling information exposure.** A `skill_chunks` retrieval
  failure, a timeout, or an `OutputSpoolStore` `not_found`/
  `spool_unavailable` error surfaces only as "no injection for that chunk
  or surface" — never a raw spool error, a Milvus error detail, a
  filesystem path, or a credential, in any log line or user-facing text.

## Acceptance Scenarios

Given a prompt squarely in a seeded local skill's domain, with `skill_autoprime`
and Feature 051's skills gate both enabled
When the turn runs to completion
Then the rendered system prompt contains an `<auto_skills>` block with that
skill's top qualifying chunks, within `max_skill_chunks`/`max_skill_tokens`

Given an off-domain prompt whose skill_chunk candidates all score below
`score_floor`
When the turn runs to completion
Then no `<auto_skills>` block is rendered, and the `<available_skills>`
Tier-1 listing is unaffected

Given a specialist skill's file was deleted (or edited) without a reindex
having run yet, but a stale chunk reference still ranks highly
When the turn's chunk set is resolved
Then the dangling or superseded `body_ref` is skipped silently, no stale
content is ever injected, and the turn completes normally

Given a qualifying skill_chunk candidate whose parent skill has provenance
`remote-pack` and `autoprime_opt_in: false`
When the turn's chunk set is assembled
Then that candidate is excluded from `<auto_skills>`, and the parent skill
remains listed in `<available_skills>` and loadable via the `skill` tool

Given a skill's chunks were already injected into the system prompt earlier
in the same session
When a later turn again ranks that skill highly
Then that skill's chunks are not injected a second time, and the `skill`
tool remains available to load its full body on demand

Given `skill_autoprime` is disabled (regardless of the Feature 051 skills
gate's state)
When a live turn runs before and after this feature is deployed
Then no `skill_chunks` retrieval pass is attempted and the rendered system
prompt is byte-identical to Feature 051's output

## Observability

Per FR8, the existing Feature 051 opt-in `debug_log` (own config flag,
default off) is extended to emit the injected chunk ids and their
confidence scores for the `chunks` surface — content-free, ids and scores
only, alongside the kept/dropped ids Feature 051 already logs for the other
three surfaces. Fail-open failures on this feature's path are absorbed into
Feature 051's existing one-content-free-warning-per-turn discipline; this
feature introduces no second warning path and no new span names, reusing
the Feature 006/050/051 `retrieval.*` span conventions as the parent
context for the fourth pass. Export telemetry via OTLP from the application
boundary; keep metric label sets bounded (surface, gate-enabled, provenance,
outcome, degraded-reason enums — no query text, vectors, chunk content, or
session content). Conventions live in
`doc/arch/observability/observability.md`.

## Related Features and Decisions

- [Feature 050 Wire The Semantic Index Data Plane Production Pipeline](../050-wire-the-semantic-index-data-plane-production-pipeline/spec.md)
  — ships the skill chunker, `SkillChunkDoc.body_ref`, and the production
  `OutputSpoolStore` this feature's render pass resolves through unmodified.
- [Feature 051 Wire Live Per Turn Semantic Narrowing Of Agents Skills And](../051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and/spec.md)
  — ships `narrowForTurn`, `NarrowedSets`, the `RoutingState` per-turn memo,
  the `SystemPrompt.skills` Tier-1 listing, and the config-gate convention
  this feature's fourth surface composes with and extends.
- [ADR-0050](../../adr/0050-wire-the-semantic-index-data-plane-production-pipeline.md)
  and [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md)
  — the data-plane and live-query architecture decisions this feature's
  fourth pass builds on without modifying.
- [ADR-0052](../../adr/0052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass.md)
  — this feature's own architecture decision record.
- Feature 053 (orchestration handoff) — depends on this feature's shape;
  out of scope here.

## Clarifications
