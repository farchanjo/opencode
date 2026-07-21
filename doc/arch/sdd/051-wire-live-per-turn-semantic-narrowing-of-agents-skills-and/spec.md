---
id: 019f8666-649e-7993-b033-83a078636491
number: 051
slug: wire-live-per-turn-semantic-narrowing-of-agents-skills-and
status: analyzed
created_at: 2026-07-21T20:38:05.214598Z
---
# Feature Specification: Wire Live Per Turn Semantic Narrowing Of Agents Skills And

Feature: 051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and
Created: 2026-07-21

## Problem

Feature 050 (SR-A) shipped a real, populatable semantic index and a production
`PipelineRunnerPort` (`packages/opencode/src/semantic/pipeline-runner.ts`)
behind the `SemanticRetrieval.Service` singleton
(`packages/opencode/src/semantic/retrieval-service.ts`), but that service is
**deliberately not mounted**: it degrades to `UNAVAILABLE_RUNNER` and is not
in the `AppLayer` node list, and no session/turn code path calls it. Today,
every live turn still sees the full catalog on all three narrowable surfaces:

- **Agents.** `ToolRegistry.describeTask` (`packages/opencode/src/tool/
  registry.ts:266-279`, spliced into the `task` tool's description at `:338`)
  lists every non-primary agent the caller may spawn, with no ranking input.
- **Skills.** `SystemPrompt.skills` (`packages/opencode/src/session/
  system.ts:98-110`) renders `Skill.fmt` over the agent's full available-skill
  list, with no `ranked?` parameter.
- **Tools.** `session/tools.ts` hardcodes `ToolRetrieval.PASSTHROUGH`
  (`:114` native surface, `:411` MCP surface) — the Feature 009 gate primitive
  (`ToolRetrieval.narrow`/`narrowRecord`, `semantic/tool-retrieval.ts:43-62`)
  is fully built and generic over an `idOf` extractor, but nothing ever
  supplies it a real `RankedGate`.

`SessionTools.resolve` (`session/prompt.ts:1498`) and `sys.skills`
(`session/prompt.ts:1531`) both sit **inside** the `while (true)` runLoop
(`session/prompt.ts:1337`) and re-run on every tool-call round trip within one
user turn. A naive per-step retrieval call would re-embed and re-rank on every
round trip, and — because Milvus/embedding calls are not deterministic byte
identical across calls — could mutate the visible tool/skill/agent set
mid-turn, breaking tool-call continuity (a tool the model just called
disappearing from its next-step catalog). `RoutingState`
(`session/routing-state.ts:36,92,121`, already lifecycle-cleared at `:168`) is
the existing session-scoped, in-memory, dependency-free store built for
exactly this kind of per-session correlation; no new cache exists today.

`config/experimental.ts:84` (`resolveToolSurfaceConfig`) already establishes
the per-surface gate convention (`enabled=false` default, full-set
passthrough floor) for the tools surface; agents and skills have no
equivalent gate. `latencyBudgetMs:62` (`TOOL_SEARCH_DEFAULTS.latencyBudgetMs`,
300ms) exists but Feature 050 already consumes it inside the runner's
per-surface `Effect.timeout` — Feature 051 reuses the same knob for the
live-turn deadline, never a second constant.

`orchestrationChildToolRules` (`tool/task.ts:74-83`) already builds a
fail-closed deny-`*`-plus-allowlist permission ruleset for a non-Worker
orchestration child. Ranked narrowing intersected against that tiny allowlist
would frequently empty it out — a real capability loss for a session that
never asked to be narrowed in the first place.

`resolveTools` (`session/llm/request.ts:208-213`) re-filters the tool record
against permission and the user's per-request tool overrides, strictly after
`SessionTools.resolve` builds it — narrowing must land as a pure shrink
between `registry.tools` (already permission-filtered) and this
`resolveTools` step, never after it and never as a widening.

This feature (SR-B, per the approved semantic-selection plan) wires the
Feature 050 data plane into the **live per-turn route**: it mounts
`SemanticRetrieval.Service` into the app layer with real bindings, computes
one memoized narrowing decision per user turn, and replaces the two
`PASSTHROUGH` constants and the two un-ranked call sites with the live gate —
while guaranteeing the turn is never blocked, never handed an empty catalog,
and never mutates its tool set mid-turn.

## User Stories

- As a user sending a prompt squarely about, say, Kubernetes networking, I
  want the model's available specialist agents, skills, and tools narrowed to
  what is relevant to my prompt, so that the system prompt and tool
  descriptions carry less irrelevant surface and the model's routing/tool
  selection improves.
- As a user in the middle of a multi-step tool-calling turn, I want the
  narrowed tool set to stay fixed across every round trip of that turn, so
  that a tool the model just used never silently disappears from its next
  step.
- As a user whose Milvus backend is unreachable or slow, I want my turn to
  complete exactly as it does today — full catalogs, one warning, no hang —
  so that semantic narrowing is never a reliability regression.
- As an operator, I want agents/skills/tools narrowing each independently
  gated off by default, so that enabling this feature is an explicit,
  reversible opt-in with a byte-identical disabled state.

## Functional Requirements

1. **FR1 — One memoized narrowing computation per user turn.** A new
   `narrowForTurn` orchestration (new, `packages/opencode/src/semantic/
   live-narrowing.ts`) computes the turn's `NarrowedSets` (agents/skills/tools
   ranked-id lists) exactly once per user turn and memoizes the result in the
   existing session-scoped `RoutingState` store
   (`session/routing-state.ts:36,92,121`), keyed by `lastUser.id`
   (`session/prompt.ts:1345`) — never a new cache store. `SessionTools.resolve`
   (`prompt.ts:1498`) and `sys.skills` (`prompt.ts:1531`) both run inside the
   `while (true)` runLoop (`prompt.ts:1337`) and re-run on every tool-call
   round trip within the same turn; both consult the SAME memoized
   `NarrowedSets` for that `lastUser.id` so the narrowed tool/skill/agent set
   never mutates across runLoop steps (tool-call continuity). The prompt is
   embedded exactly once per turn and that single embedding feeds all surface
   retrieval passes, which run concurrently (`Effect.all` with bounded
   concurrency) under the shared `latencyBudgetMs` deadline
   (`config/experimental.ts:62`) — never a per-surface embed.
2. **FR2 — Degenerate-input guard.** When the current user turn's text is
   below a configurable minimum length (short follow-ups such as "yes,
   continue" embed to noise), `narrowForTurn` reuses the session's previous
   `NarrowedSets` memo instead of issuing a new retrieval. When the current
   turn is short AND no prior memo exists for the session (a short FIRST
   turn), `narrowForTurn` returns passthrough (`undefined` for every surface)
   and never embeds — a first turn is never blocked or delayed waiting on a
   degenerate query.
3. **FR3 — Empty and degenerate results are passthrough for every surface.**
   `ToolRetrieval.narrow`/`narrowRecord` (`semantic/tool-retrieval.ts:43-62`)
   already treat an `undefined` ranked list as identity passthrough and a
   present-but-empty ranked list (`[]`) as "keep nothing." `live-narrowing.ts`
   maps every degenerate outcome — zero retrieval hits, a result set emptied
   entirely by revalidation, or a result set emptied by dedup — to
   `undefined` for that surface BEFORE the gate is ever applied, for agents,
   skills, and tools alike. A narrowing pass never produces an empty catalog;
   the only outcomes are "narrowed to a non-empty ranked subset" or
   "passthrough."
4. **FR4 — Three seams, one shared primitive, no bespoke filtering.** All
   three surfaces delegate the actual filtering to the existing generic
   `ToolRetrieval.narrow`/`narrowRecord` (generic over an `idOf` extractor;
   already encodes the empty-vs-undefined passthrough rule). `live-narrowing.ts`
   owns only IO orchestration (embed, concurrency, timeout, fail-open, memo);
   `tool-retrieval.ts` remains the sole owner of the pure gate. No bespoke
   intersection/filter code is added at any seam:
   - **Agents.** `ToolRegistry.describeTask` (`tool/registry.ts:266-279`,
     spliced into the `task` tool description at `:338`) gains an optional
     `rankedAgentIds` input. Every agent with `Agent.Info.hidden === true`
     (e.g. `manager-router`, `manager-composer`) is partitioned out as
     `pinned` BEFORE narrowing is applied to the remaining `narrowable` list;
     the rendered description is `[...pinned, ...narrowed]` in that order —
     a hidden agent is never ranked away. Narrowing here edits the `task`
     tool's description PROSE only; it does not revoke `task` spawn
     permission — a model that names a narrowed-away agent can still spawn it
     if it insists. Closing that gap at the permission layer is out of scope
     (Feature 053 territory for the orchestration path specifically).
   - **Skills.** `SystemPrompt.skills` (`session/system.ts:98-110`) gains an
     optional `ranked?: readonly string[]` parameter; the skill list is
     filtered/reordered via `ToolRetrieval.narrow` before `Skill.fmt` renders
     it. This is Tier-1 listing only — narrowing the `<available_skills>`
     names/descriptions the model sees before it calls the `skill` tool — and
     spends NEITHER `max_skill_chunks` NOR `max_skill_tokens`; those budgets
     are reserved exclusively for a future Tier-2 content-injection pass
     (Feature 052) and are never spent here.
   - **Tools.** The `ToolRetrieval.PASSTHROUGH` constant at
     `session/tools.ts:114` (native surface) and `:411` (MCP surface) is
     replaced with the live `RankedGate` produced by `narrowForTurn`. Before
     `ToolRetrieval.narrow`/`narrowRecord` is applied, the ESSENTIAL-TOOL
     FLOOR — the always-keep union of `task`, `skill`, `todowrite`,
     `question`, `read`, `edit`, `write`, `bash`, `grep`, `glob`, and any
     tool added to the tool record after `resolve()` returns (for example
     `StructuredOutput`, appended post-narrowing at `prompt.ts:1517` and
     therefore already exempt by construction) — is unioned into the ranked
     id list. The reranker may reorder the floor's tools relative to the rest
     of the ranked set; it may never cause one to be removed.
5. **FR5 — Orchestration-child sessions skip tool narrowing.** A session
   whose permission ruleset carries `orchestrationChildToolRules`
   (`tool/task.ts:74-83,334` — deny-`*` plus a small allowlist) skips tool
   narrowing entirely: `narrowForTurn` returns `undefined` for the tools
   surface for that session without attempting retrieval, because
   intersecting a ranked set against that tiny allowlist would frequently
   empty it and strip capability from a child that never opted into
   narrowing.
6. **FR6 — Independent per-surface config gates, default off.** Agents and
   skills each get a config gate mirroring `resolveToolSurfaceConfig`
   (`config/experimental.ts:84`) — `enabled: boolean` default `false` — added
   beside the existing tools surface gate convention. When all three gates
   (agents, skills, tools) are `false`, `narrowForTurn` short-circuits before
   any embedding/Milvus I/O — no network call, no memo write — and every
   surface renders byte-identical to today's full-catalog behavior (the
   golden disabled-path test, AC7).
7. **FR7 — Fail-open query plane, zero live-turn retries.** `narrowForTurn`
   NEVER throws: a Milvus/embedding/rerank failure, a timeout against the
   shared `latencyBudgetMs` deadline, or any other unexpected error resolves
   that surface to `undefined` (passthrough to the full catalog) and emits
   exactly ONE content-free warning log for the turn — never one warning per
   surface, never a retry. There are ZERO retries on this live path: a retry
   with the house 200ms+ jittered backoff cannot fit inside a 300ms budget,
   fail-open passthrough already is the resilience mechanism, and the
   per-turn memo means the very next turn attempts retrieval fresh. This is
   the deliberate opposite of Feature 050's data-plane posture: the INDEX
   plane fails CLOSED (an unknown dimension refuses generation build) because
   a bad write corrupts every future read; the LIVE QUERY plane wired here
   fails OPEN because a turn must never be blocked or handed an empty
   catalog. A blue/green cutover landing mid-session simply makes that
   in-flight turn's old-vector-space query fail — passthrough for that turn,
   benign, and the next turn queries the new generation normally.
8. **FR8 — Opt-in, content-free observability.** A per-surface debug log,
   gated by its own config flag (default off), emits the kept and dropped
   canonical ids for each narrowed surface per turn — ids only, never prompt
   text, document content, or vectors — so a bad ranking is debuggable
   without becoming a new logging-sensitivity surface.
9. **FR9 — Mount the retrieval service and compose live runner deps.**
   `SemanticRetrieval.Service` (`semantic/retrieval-service.ts`) — shipped by
   Feature 050 with its `node` deliberately excluded from the `AppLayer` node
   list and its default layer degraded to `UNAVAILABLE_RUNNER` — is mounted
   into the live app layer. `narrowForTurn`'s composition root replaces the
   degraded runner with `createSemanticRetrievalPort` fed real
   `PipelineRunner.PipelineRunnerDeps`: the shared `composeMilvusPort` helper
   (`operator/stack-live.ts:588-610`, extracted by Feature 050), the active
   embedding/reranker bindings resolved the same way `stack-live.ts` resolves
   them, and the production `EmbeddingsHttpPort`/rerank HTTP clients Feature
   050 shipped. This is the only live-turn code path allowed to construct
   these deps; no second construction site is introduced.

## Non-Goals

- Auto-skill semantic content injection (`<auto_skills>` chunk-level
  priming) — Feature 052.
- Deterministic orchestration handoff (Architect → Manager → Worker via
  synchronous Data/Composer sub-sessions, `manager_agent` role binding) —
  Feature 053.
- Revoking `task` spawn permission for a narrowed-away agent — narrowing here
  is prose-only over the `task` description; permission enforcement is
  unchanged.
- Any change to the index/data plane, the reindex/reconcile pipeline, or the
  dimension/capability discovery ladder — all owned by Feature 050 and
  unmodified here.
- A live retry policy for the query plane — FR7 makes zero retries a
  permanent property of this seam, not a temporary gap.

## Security Requirements

- **Data sensitivity/classification.** The only new runtime data this
  feature handles is the current turn's prompt text (embedded once, per
  FR1) and the ranked canonical ids returned by the Feature 050 pipeline —
  both already covered by Feature 006's classification (private project
  configuration surface; no secrets, filesystem paths, or raw model
  reasoning ever cross this seam). The `RoutingState` memo holds ranked id
  lists only, never prompt text or document bodies, and is cleared with the
  session (`routing-state.ts:168`).
- **Authentication/authorization.** No new authenticated end-user surface is
  introduced. FR9's runner-deps composition reuses the exact auth path
  Feature 050 already built (`semantic/credential-resolver.ts`,
  `secretRef: null` → no header); this feature adds no second auth
  resolution site. Narrowing never widens what a tool call, agent spawn, or
  skill load may do — `resolveTools` (`session/llm/request.ts:208-213`) and
  `Permission.evaluate` continue to gate execution exactly as today; FR4's
  narrowing is a pure shrink applied strictly between permission-visibility
  and that re-filter, never after it.
- **Input validation.** The only untrusted input this feature processes is
  the current turn's own prompt text, which is already trusted at the level
  the LLM call itself trusts it (no new parsing of hostile external content);
  the embedding call reuses Feature 050's production `EmbeddingsHttpPort`
  transport contract unchanged.
- **Cryptography in transit/at rest.** No new network surface: FR9 reuses
  Feature 050's Milvus/embedding/rerank transport composition verbatim. No
  new persisted state — the `RoutingState` memo is in-memory, per-process,
  and never durably written.
- **Logging/audit.** FR8's debug log is content-free by construction (ids
  only) and default off; FR7's fail-open warning is likewise content-free
  and rate-bounded to one per turn. No query text, document body, vector, or
  credential is ever logged by this feature.
- **Error-handling information exposure.** A retrieval failure or timeout
  surfaces only as a typed passthrough decision and a content-free warning —
  never a raw HTTP error body, Milvus error detail, or credential in any log
  line or user-facing surface.

## Acceptance Scenarios

Given two semantically different prompts sent in separate sessions with all
narrowing gates enabled
When each turn runs to completion
Then each turn's narrowed agent/skill/tool sets differ from the other's, and
each narrowed set is a subset of that turn's permission-visible baseline

Given any narrowed turn, regardless of prompt content
When the narrowed agent and tool sets are inspected
Then every essential-floor tool (`task`, `skill`, `todowrite`, `question`,
`read`, `edit`, `write`, `bash`, `grep`, `glob`) is present, and every
hidden-pinned agent (e.g. `manager-router`, `manager-composer`) is present

Given a user turn whose text is below the degenerate-input length threshold
and a prior `NarrowedSets` memo exists for the session
When that short follow-up turn runs
Then the previous memo is reused verbatim and no new embedding call is made

Given Milvus is unreachable for the duration of a turn
When that turn runs with narrowing gates enabled
Then every surface passes through to its full catalog, exactly one
content-free warning is logged, and the turn completes normally — never
blocked, never given an empty catalog

Given a specialist agent's Markdown file was deleted without a reindex having
run yet, but the stale entry still ranks highly in the semantic index
When a turn's agent narrowing runs
Then the stale specialist is revalidated against the live registry and
dropped before rendering, never surfaced to the model

Given Milvus responds flakily (fails once, would succeed on a second
attempt) during a live turn
When that turn's narrowing runs
Then no second attempt is made within the turn — the surface passes through
immediately on the first failure, preserving the latency budget

Given all three narrowing gates (agents, skills, tools) are disabled
When a live turn runs before and after this feature ships
Then the turn's rendered agent catalog, skill listing, and tool set are
byte-identical (the golden disabled-path test)

## Observability

Per FR8, a per-surface debug log (own config flag, default off) emits kept
and dropped canonical ids per turn per surface — content-free, ids only —
alongside the existing content-free `RetrievalDecisionRecord` Feature 050
already produces (effective embedding/reranker binding versions, language
tag). FR7's fail-open path emits exactly one warning per turn on any
narrowing failure, never per surface. No new span names are introduced;
narrowing reuses the Feature 006/050 semantic span conventions
(`retrieval.*`) as the parent context for the per-turn passes. Export
telemetry via OTLP from the application boundary; keep metric label sets
bounded (surface, gate-enabled, outcome, degraded-reason enums — no query
text, vectors, or entity/session content). Conventions live in
`doc/arch/observability/observability.md`.

## Related Features and Decisions

- [Feature 050 Wire The Semantic Index Data Plane Production Pipeline](../050-wire-the-semantic-index-data-plane-production-pipeline/spec.md)
  — ships the production `PipelineRunnerPort`, the `SemanticRetrieval.Service`
  singleton (deliberately unmounted), and the data-plane retry/fail-closed
  posture this feature depends on and never modifies.
- [Feature 009 Semantic Tool Search](../009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md)
  — owns `ToolRetrieval.narrow`/`narrowRecord` and the `PASSTHROUGH` gate
  convention this feature's tools seam replaces.
- [ADR-0050](../../adr/0050-wire-the-semantic-index-data-plane-production-pipeline.md)
  and [ADR-0008](../../adr/0008-milvus-semantic-retrieval-stack.md) — the
  data-plane and original retrieval-stack decisions this feature's live-query
  wiring builds on.
- [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md)
  — this feature's own architecture decision record.
- Feature 052 (auto-skill content injection) and Feature 053 (orchestration
  handoff) — depend on this feature's memo/seam shape; neither is in scope
  here.

## Clarifications
