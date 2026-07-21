---
status: proposed
date: 2026-07-21
deciders: [your-org]
consulted: []
informed: []
---

# Wire Live Per Turn Semantic Narrowing Of Agents Skills And

## Context and Problem Statement

Feature 050 activated ADR-0008's semantic-index **data plane**: a production
`PipelineRunnerPort` (`packages/opencode/src/semantic/pipeline-runner.ts`)
now embeds, recalls, reranks, and revalidates real agent/skill/tool
documents, and `SemanticRetrieval.Service`
(`packages/opencode/src/semantic/retrieval-service.ts`) exists as a
per-instance singleton wrapping it — but that service was **deliberately
left unmounted**: its default layer degrades to a runner whose calls always
reject, it is absent from the `AppLayer` node list, and no session/turn code
path calls it. Every live turn today still renders the full catalog on all
three narrowable surfaces:

- `ToolRegistry.describeTask` (`tool/registry.ts:266-279`, spliced into the
  `task` tool's description at `:338`) lists every non-primary agent with no
  ranking input.
- `SystemPrompt.skills` (`session/system.ts:98-110`) renders every available
  skill via `Skill.fmt` with no `ranked?` parameter.
- `session/tools.ts` hardcodes `ToolRetrieval.PASSTHROUGH` at both the native
  surface (`:114`) and the MCP surface (`:411`) — the Feature 009 gate
  primitive (`ToolRetrieval.narrow`/`narrowRecord`, generic over an `idOf`
  extractor, already correct on empty-vs-undefined passthrough) has never
  been supplied a real `RankedGate`.

Two structural constraints make "just call the facade at the seam" wrong on
its own:

- `SessionTools.resolve` (`session/prompt.ts:1498`) and `sys.skills`
  (`session/prompt.ts:1531`) both run **inside** the `while (true)` runLoop
  (`session/prompt.ts:1337`), which re-executes once per tool-call round
  trip within a single user turn. Retrieval is not byte-deterministic across
  calls; computing it fresh on every round trip risks the model's visible
  tool set changing mid-turn — a tool it just called disappearing from its
  own next step.
- A session running as a Feature 042/048 orchestration child carries
  `orchestrationChildToolRules` (`tool/task.ts:74-83,334` — deny-`*` plus a
  small allowlist). Intersecting a semantically ranked set against that tiny
  allowlist would routinely empty it, stripping capability from a child that
  never asked to be narrowed.

This feature (SR-B, per the approved semantic-selection plan) decides how to
wire Feature 050's data plane into the live per-turn route without
reintroducing either failure mode, and without touching Feature 050's
data-plane contracts.

## Decision Drivers

- Tool-call continuity: the narrowed surface a model sees must never mutate
  mid-turn, no matter how many tool-call round trips the turn takes.
- Reuse over duplication: `ToolRetrieval.narrow`/`narrowRecord` is already
  the correct, generic, tested narrowing primitive (Feature 009); no seam
  reimplements filtering logic.
- No new cache: `RoutingState` is already the session-scoped, in-memory,
  dependency-free store built for exactly this per-session correlation
  problem; a second cache would only invite drift.
- Capability floors are non-negotiable: essential tools and hidden
  orchestration agents must render in every narrowed variant, because losing
  them is not a ranking quality regression, it is a broken turn.
- The query plane and the data plane have opposite correct failure postures,
  and this ADR must state the query half explicitly: Feature 050 built the
  index to fail CLOSED (an unknown dimension refuses generation build,
  because a bad write corrupts every future read); a live turn must fail
  OPEN (any retrieval failure passes through to the full catalog, because a
  turn must never be blocked or handed an empty catalog).
- Zero live-turn retries: a retry cannot fit inside a 300ms latency budget,
  and fail-open passthrough is already the resilience mechanism for this
  seam — the very next turn tries retrieval fresh.
- Gates default off, and a fully-disabled configuration must be provably
  byte-identical to today, not merely "close."

## Considered Options

- **A single per-turn narrowing computation, memoized in `RoutingState` and
  keyed by `lastUser.id`, feeding all three seams through
  `ToolRetrieval.narrow`/`narrowRecord` (chosen).** One embed, one
  concurrent fan-out across surfaces, one deadline, one memo read by every
  runLoop step of the same turn.
- **Per-runLoop-step narrowing (recompute on every tool-call round trip).**
  Rejected: retrieval is not guaranteed byte-identical across calls (ranking
  ties, transient Milvus/embedding variance), so the visible tool/skill/agent
  set could mutate mid-turn — a tool the model just called could vanish from
  its own next step. This is a correctness break, not a performance
  concern, and memoizing at the turn boundary removes it structurally rather
  than by convention.
- **Narrow via a plugin hook (`tool.definition`, `experimental.chat.messages
  .transform`) instead of editing the seams directly.** Rejected: none of the
  existing plugin hook points has structural access to the pre-permission
  tool/agent/skill SET the seams operate on — `tool.definition` fires per
  already-selected tool, and the chat-messages-transform hook sees rendered
  messages, not the candidate set `ToolRetrieval.narrow` needs to intersect
  against. Bending a hook to reconstruct that access would duplicate the
  seam's own filtering logic through an indirection that buys nothing.
- **Treat an empty ranked result as an empty catalog (do not special-case
  it).** Rejected: `ToolRetrieval.narrow` already draws this distinction
  correctly (`undefined` = passthrough, `[]` = keep nothing) for the case
  where a surface is deliberately narrowed to zero; the risk this ADR closes
  is a DEGENERATE empty result (zero hits, a set emptied by revalidation, a
  set emptied by dedup) being mistaken for a deliberate zero and handed to
  the model as an empty catalog. Mapping every degenerate case to
  `undefined` before the gate runs preserves the primitive's existing
  contract instead of overriding it.
- **Give the essential-tool floor and hidden-agent pin no special
  handling — let ranking decide everything.** Rejected: a semantic reranker
  is a relevance signal, not a safety mechanism; an off-domain prompt could
  legitimately rank `bash` or `edit` low, and losing them is a broken turn,
  not a quality trade-off. Same reasoning for hidden orchestration agents
  (`manager-router`, `manager-composer`): they exist to be spawned by
  `force_manager`/hierarchy routing regardless of what the prompt's surface
  semantics suggest.

## Decision Outcome

Chosen option: a single per-turn narrowing computation, memoized in
`RoutingState`, feeding all three seams through the existing
`ToolRetrieval.narrow`/`narrowRecord` primitive.

1. **One `narrowForTurn` computation per user turn, memoized by
   `lastUser.id`.** `live-narrowing.ts` (new,
   `packages/opencode/src/semantic/`) computes `NarrowedSets` once and stores
   it in `RoutingState` (`session/routing-state.ts`), keyed by the turn's
   `lastUser.id`. `SessionTools.resolve` and `sys.skills` — both inside the
   `while (true)` runLoop — read the SAME memo on every round trip of the
   same turn; the narrowed set is therefore fixed for the turn's lifetime by
   construction, not by convention. The turn's prompt is embedded exactly
   once and that embedding feeds every surface's retrieval pass, run
   concurrently under one shared `latencyBudgetMs` deadline
   (`config/experimental.ts:62`, the same knob Feature 050's runner already
   consumes).
2. **Degenerate-input guard with an explicit first-turn floor.** Below a
   configurable minimum prompt length, `narrowForTurn` reuses the prior
   `NarrowedSets` memo rather than embedding noise; when no prior memo exists
   (a short first turn), it returns passthrough for every surface rather
   than embedding a near-empty string or blocking the turn.
3. **Degenerate results normalize to passthrough before the gate.** Zero
   hits, a revalidation-emptied set, and a dedup-emptied set all map to
   `undefined` for that surface before `ToolRetrieval.narrow`/`narrowRecord`
   ever runs — the pure gate's own `undefined`-vs-`[]` contract (Feature 009)
   is preserved exactly; `live-narrowing.ts` only ever hands it a
   deliberately-nonempty ranked list or `undefined`.
4. **Three seams, one primitive, capability floors enforced before the
   gate.** Agents (`describeTask`), skills (`SystemPrompt.skills`), and tools
   (`session/tools.ts`, replacing both `PASSTHROUGH` call sites) all delegate
   filtering to `ToolRetrieval.narrow`/`narrowRecord`; no seam reimplements
   intersection logic. Before narrowing is applied: every `hidden === true`
   agent is pinned out and rendered alongside (never through) the narrowed
   list; the essential-tool floor (`task`, `skill`, `todowrite`, `question`,
   `read`, `edit`, `write`, `bash`, `grep`, `glob`) is unioned into the
   ranked tool-id list so the reranker may reorder it but never drop it.
   Skills narrowing here is Tier-1 listing only (names/descriptions) and
   spends neither `max_skill_chunks` nor `max_skill_tokens` — those budgets
   are reserved for a future Tier-2 content-injection feature.
5. **Orchestration children skip tool narrowing.** A session carrying
   `orchestrationChildToolRules` (`tool/task.ts:74-83`) never attempts tool
   retrieval; `narrowForTurn` returns `undefined` for that surface
   unconditionally for such a session, because intersecting a ranked set
   against its tiny allowlist would routinely empty it.
6. **Independent per-surface gates, default off, provably byte-identical
   when off.** Agents and skills gates mirror the existing
   `resolveToolSurfaceConfig` (`config/experimental.ts:84`) convention. All
   three gates false short-circuits `narrowForTurn` before any I/O — no
   embedding call, no memo write — so a disabled deployment renders every
   surface identically to pre-Feature-051 behavior; this is the shipped
   golden test, not an assumption.
7. **Fail-open, zero-retry live query plane.** Any failure on this path
   (Milvus, embedding, rerank, timeout, or an unexpected error) resolves that
   surface to `undefined` and logs exactly one content-free warning for the
   turn. There are no retries: a retry cannot fit inside the shared latency
   budget, and fail-open passthrough already gives the turn full
   availability. This deliberately completes the failure-posture split
   Feature 050 started: the index/data plane fails CLOSED (ADR-0050), the
   live/query plane wired here fails OPEN.
8. **Mount `SemanticRetrieval.Service` with real bindings; no second
   composition site.** Feature 050 shipped the singleton unmounted on
   purpose so Feature 051 would be the one to compose real
   `PipelineRunner.PipelineRunnerDeps` (the shared `composeMilvusPort`
   helper, the resolved active bindings, the production HTTP clients) and
   add the service's `node` to the live `AppLayer`. This is the only call
   site allowed to perform that composition.

### Consequences

- Good: narrowing is observably behavior-preserving when disabled (golden
  byte-identical test) and behavior-safe when enabled — every acceptance
  scenario (essential floor, hidden-agent pin, fail-open, memo reuse,
  revalidation of stale hits) is falsifiable against the live seams, not
  just the pipeline's own tests.
- Good: no new cache, no new filtering primitive, no new auth/transport
  composition — this feature is entirely a wiring and gating decision over
  Feature 050's and Feature 009's existing contracts.
- Bad: the essential-tool floor and hidden-agent pin are a hardcoded,
  closed list maintained by hand; a new built-in tool or a new hidden
  orchestration agent that should join the floor requires an explicit code
  change here, not automatic inclusion.
- Bad: narrowing the `task` description's agent list is prose-only and does
  not revoke spawn permission — a sufficiently insistent model can still
  spawn an agent narrowed out of the description. This is an accepted,
  scoped gap; closing it at the permission layer for the orchestration path
  specifically is Feature 053 territory.

## Related

- Depends on [ADR-0050 — Wire The Semantic Index Data Plane Production
  Pipeline](0050-wire-the-semantic-index-data-plane-production-pipeline.md)
  for the `PipelineRunnerPort`, `SemanticRetrieval.Service`, and the
  fail-closed data-plane posture this ADR's fail-open query plane completes.
- Extends [ADR-0008 — Milvus-Backed Multilingual Semantic Retrieval and
  Reranking Stack](0008-milvus-semantic-retrieval-stack.md) into the live
  turn for the first time.
- Reuses the [Feature 009 Semantic Tool Search](../sdd/009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md)
  `ToolRetrieval.narrow`/`narrowRecord` gate primitive unchanged.
- Feature specification: [051 Wire Live Per Turn Semantic Narrowing Of
  Agents Skills And](../sdd/051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and/spec.md).
- Downstream consumers (out of scope here): Feature 052 (auto-skill content
  injection), Feature 053 (orchestration handoff, `manager_agent` binding).
