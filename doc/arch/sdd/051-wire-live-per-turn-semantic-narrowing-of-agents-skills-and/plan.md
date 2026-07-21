# Implementation Plan: Wire Live Per Turn Semantic Narrowing Of Agents Skills And

Feature: 051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and
Spec: [spec.md](spec.md) (FR1–FR9, 7 acceptance scenarios)
CUE: [`wire-live-per-turn-semantic-narrowing-of-agents-skills-and.cue`](../../schemas/wire-live-per-turn-semantic-narrowing-of-agents-skills-and.cue)
ADR: [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md)
Dependencies:
[Feature 050 Wire The Semantic Index Data Plane Production Pipeline](../050-wire-the-semantic-index-data-plane-production-pipeline/spec.md) (production `PipelineRunnerPort`, `SemanticRetrieval.Service`, unmounted on purpose),
[Feature 009 Semantic Tool Search](../009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md) (`ToolRetrieval.narrow`/`narrowRecord`, the `PASSTHROUGH` gate),
[ADR-0050](../../adr/0050-wire-the-semantic-index-data-plane-production-pipeline.md), [ADR-0008](../../adr/0008-milvus-semantic-retrieval-stack.md).

---

## Overview

Feature 050 built and shipped a real, populatable semantic index and a
production `PipelineRunnerPort`, but deliberately left `SemanticRetrieval
.Service` (`packages/opencode/src/semantic/retrieval-service.ts`) unmounted:
no `AppLayer` node, default layer degrades to a rejecting `UNAVAILABLE_RUNNER`,
and no session/turn code path calls it. Every live turn today renders the full
agent, skill, and tool catalog on all three narrowable surfaces (`tool/
registry.ts` `describeTask`, `session/system.ts` `sys.skills`, `session/
tools.ts`'s two `ToolRetrieval.PASSTHROUGH` sites).

This feature (SR-B) wires that data plane into the live per-turn route: one
memoized `narrowForTurn` computation per user turn, stored in the existing
`RoutingState` (no new cache), feeding all three seams through the existing
`ToolRetrieval.narrow`/`narrowRecord` primitive (no new filtering logic), with
capability floors (essential tools, hidden agents) enforced before the gate,
independent per-surface gates default off, and a fail-open/zero-retry query
plane that is the deliberate opposite of Feature 050's fail-closed index
plane. `SemanticRetrieval.Service` is mounted into the live `AppLayer` with
real bindings composed the same way `operator/stack-live.ts` composes them.

## Why memoization is structural, not conventional

`SessionTools.resolve` (`session/prompt.ts:1498`) and `sys.skills`
(`session/prompt.ts:1531`) both execute inside the `while (true)` runLoop
(`session/prompt.ts:1337`), once per tool-call round trip within one user
turn. Retrieval is not byte-deterministic across calls (ranking ties,
transient Milvus/embedding variance); recomputing it every round trip could
make a tool the model just called vanish from its own next step. Memoizing
`NarrowedSets` in `RoutingState`, keyed by `lastUser.id` (`session/
prompt.ts:1345`) and read by every runLoop step of the same turn, removes this
failure mode by construction rather than by convention (ADR-0051, option
analysis).

---

## Component breakdown

| # | Component | Path | Kind | FR |
| - | --------- | ---- | ---- | -- |
| 1 | `narrowForTurn` orchestrator | `packages/opencode/src/semantic/live-narrowing.ts` (NEW) | Application | FR1–FR8 |
| 2 | Agents/skills narrowing gates | `packages/core/src/config/experimental.ts` (EDIT — new `semantic_narrowing` block mirroring `resolveToolSurfaceConfig`, `:84`) | Domain (config) | FR6 |
| 3 | `NarrowedSets` memo field | `packages/opencode/src/session/routing-state.ts` (EDIT — add `narrowedSets: NarrowedSets \| null` to `RoutingSessionState`, `:36`; a `recordNarrowedSets`/read accessor beside `recordDecision`, `:121`; cleared with the rest of the state at `:168`) | Application | FR1 |
| 4 | Agents seam | `packages/opencode/src/tool/registry.ts` (EDIT — `describeTask`, `:266-279`, gains optional `rankedAgentIds`; splice site unchanged, `:338`) | Application | FR4 |
| 5 | Skills seam | `packages/opencode/src/session/system.ts` (EDIT — `sys.skills`, `:98-110`, gains optional `ranked?: readonly string[]`) | Application | FR4 |
| 6 | Tools seam | `packages/opencode/src/session/tools.ts` (EDIT — replace `ToolRetrieval.PASSTHROUGH` at the native surface `:114` and the MCP surface `:411` with the live `RankedGate`; apply the essential-tool floor before the gate) | Application | FR4, FR5 |
| 7 | Call site + memo write | `packages/opencode/src/session/prompt.ts` (EDIT — one `narrowForTurn` call before `SessionTools.resolve` at `:1498`, result threaded into `sys.skills` at `:1531` and into `SessionTools.resolve`'s new `narrowedSets` input) | Application | FR1 |
| 8 | Live `AppLayer` mount | `packages/opencode/src/effect/app-runtime.ts` (EDIT — add `SemanticRetrieval.node` to the `LayerNode.group([...])` list, `:59-107`; merge a live-binding override layer replacing the degraded default) | Composition root | FR9 |

No new package boundary, no new filtering primitive, no new cache — every
"NEW" file is `live-narrowing.ts`; everything else is an edit to an
already-in-scope seam.

### Reuse contract (binding — no duplication)

1. **Gate primitive**: `ToolRetrieval.narrow`/`narrowRecord` (`semantic/
   tool-retrieval.ts:43-62`) is the ONLY filtering code path for all three
   surfaces. `live-narrowing.ts` owns IO orchestration only (embed,
   concurrency, timeout, fail-open, memo) — never a bespoke intersection.
2. **Gate convention**: the new `agents`/`skills` config gates in
   `experimental.ts` mirror `resolveToolSurfaceConfig` (`:84`) field-for-field
   (`enabled: boolean`, default `false`); the tools surface reuses the
   existing `resolveToolSurfaceConfig("native"|"mcp")` unchanged.
3. **Shared deadline**: `latencyBudgetMs` (`TOOL_SEARCH_DEFAULTS
   .latencyBudgetMs`, `experimental.ts:62`, 300ms) is the ONE deadline for the
   turn's whole concurrent fan-out — never a second constant.
4. **Milvus/binding composition**: the mount at #8 calls `MilvusComposition
   .composeMilvusPort` (`semantic/milvus-composition.ts`) and `BindingRuntime
   .resolveActiveBinding` (`semantic/binding-runtime.ts`) exactly the way
   `operator/stack-live.ts:598-628` already does, reading the same registry
   document through `Config.Service` (the same store `operator/adapters/
   outbound/config-live.ts`'s `ConfigServiceLike` wraps) — never a second
   registry reader.
5. **Facade construction**: `retrieval-service.ts`'s exported
   `createSemanticRetrievalPort(deps)` (already pure, already the shared
   construction path per Feature 050) is the ONLY way `live-narrowing.ts`'s
   composition root builds the production facade — no second call to
   `RetrievalFacade.createRetrievalFacade` is introduced.

---

## `narrowForTurn` orchestration (FR1–FR8)

```
narrowForTurn(input: { sessionID, agent, permission, lastUser, orchestrationChild }):
  1. if !anyGateEnabled(agents|skills|tools) -> return passthrough {} (no I/O, no memo write)   [FR6]
  2. memo = RoutingState.get(sessionID).narrowedSets
  3. if lastUser.text.length < min_prompt_length:
       return memo ?? passthrough {}                                                            [FR2]
  4. taskId = one per turn; profile = { taskId, queryText: lastUser.text, projectId, ... }
  5. toolsSurface = orchestrationChild ? undefined : tools-gate-enabled
  6. run agents/skills passes through Service.retrieveAgents/retrieveSkills,
     and (if toolsSurface) Service.retrieveTools, concurrently via Effect.all
     with bounded concurrency, each wrapped in Effect.timeout(latencyBudgetMs) [FR1, FR7]
  7. per surface: map zero-hit / revalidation-emptied / dedup-emptied -> undefined;
     a non-empty ranked id list -> RankedGate{enabled:true, ranked}            [FR3]
  8. any surface's promise/timeout/error -> that surface undefined + ONE
     content-free warning log for the whole turn (not per surface)            [FR7]
  9. write NarrowedSets to RoutingState memo keyed by lastUser.id              [FR1]
  10. optional debug_log emits kept/dropped ids per surface (own flag)        [FR8]
```

Essential-tool floor and hidden-agent pin are NOT part of `narrowForTurn`'s
output — they are applied at the seam, after the memo is read, per ADR-0051
decision 4 ("ranking is a relevance signal, not a safety mechanism"):

- **Tools** (`session/tools.ts`): before `ToolRetrieval.narrow`/`narrowRecord`
  runs, the floor (`task`, `skill`, `todowrite`, `question`, `read`, `edit`,
  `write`, `bash`, `grep`, `glob`) is unioned into `gate.ranked` so the
  reranker may reorder but never drop it. `StructuredOutput` (appended after
  `resolve()` returns, `prompt.ts:1517`) is exempt by construction — it never
  passes through the gate at all.
- **Agents** (`tool/registry.ts` `describeTask`): every `Agent.Info.hidden
  === true` entry is partitioned out as `pinned` BEFORE `ToolRetrieval.narrow`
  runs on the remaining `narrowable` list; render order is `[...pinned,
  ...narrowed]`.

### Orchestration-child short-circuit (FR5)

A session whose permission ruleset carries `orchestrationChildToolRules`
(`tool/task.ts:74-83,334` — deny-`*` plus `ORCHESTRATION_ALLOWED_TOOLS`)
never attempts tool retrieval: `narrowForTurn` detects this by structural
comparison of the session's permission ruleset against the shape
`orchestrationChildToolRules()` produces, and returns `undefined` for the
tools surface unconditionally, without spending the latency budget on a
retrieval that would routinely empty the tiny allowlist anyway. Agents/skills
narrowing is unaffected — an orchestration child still narrows its own
available skills/spawnable-agent list normally.

### Mount composition (FR9)

The composition root (added at the `effect/app-runtime.ts` mount, #8) mirrors
`operator/stack-live.ts:595-628` exactly:

1. Resolve the Milvus endpoint from the operator environment
   (`OPENCODE_SEMANTIC_MILVUS_ADDRESS`/`_INSECURE`/`_TOKEN`) through
   `MilvusComposition.composeMilvusPort` — `undefined` when unconfigured.
2. Read the persisted semantic registry document via `Config.Service` (the
   same document `SemanticRegistryBackend.AUTHORITY` keys, reached through
   `operator/adapters/outbound/config-live.ts`'s thin wrapper in the operator
   stack) and join the active embedding/reranker binding through
   `BindingRuntime.resolveActiveBinding`.
3. Build the production `EmbeddingsHttpPort` via `EmbeddingsHttpClient
   .createFetchEmbeddingsHttpClient`, auth resolved through the existing
   `credential-resolver.ts`/`resolveProviderAuthHeader` path — never a second
   resolution site.
4. Assemble `PipelineRunner.PipelineRunnerDeps` and call
   `SemanticRetrieval.createSemanticRetrievalPort(deps)`.
5. Provide a `Layer.effect(SemanticRetrieval.Service, ...)` that replaces the
   shipped degraded default; merge it into the `AppLayer` composition after
   `SemanticRetrieval.node` (mirrors the existing `AppNodeBuilderV1
   .build(Ripgrep.node)` override-merge pattern already present at
   `app-runtime.ts:109`).
6. Any resolution failure (no endpoint configured, no active binding, a
   config read error) leaves the degraded `UNAVAILABLE_RUNNER` in place —
   `narrowForTurn`'s own fail-open handling (step 8 above) already turns that
   into a passthrough, so an unconfigured profile is silent and safe, not a
   boot failure.

---

## Sequencing

1. **Pure/config first** — `experimental.ts` gates, `NarrowedSets` type +
   `RoutingState` memo field, unit-tested in isolation (no Effect runtime,
   no fakes beyond plain objects).
2. **`live-narrowing.ts` orchestrator** — built and unit-tested against a fake
   `SemanticRetrieval.Interface` (agents/skills/tools fakes), independent of
   any live seam: gates-off short-circuit, degenerate-input reuse/passthrough,
   empty/degenerate-to-`undefined` mapping, fail-open on a rejecting/slow
   fake, orchestration-child skip, memo write/read.
3. **Seams** — `describeTask` (hidden-pin + ranked), `sys.skills` (ranked
   param), `session/tools.ts` (gate + essential-tool floor + orchestration-
   child skip), each independently unit-tested with a fixed `NarrowedSets`
   input (no retrieval call — the seam only consumes the gate).
4. **Mount + call site** — the `app-runtime.ts` node merge, the
   `narrowForTurn` call site in `prompt.ts` before `SessionTools.resolve`, and
   the memoization-across-runLoop-steps test (two round trips of the same
   turn read the identical memo, no second retrieval call).
5. **Verification** — the golden gates-off byte-identical snapshot, a live
   smoke test with differing prompts (`OPENCODE_CONFIG_DIR=~/.opencodedev`),
   Milvus-down fail-open, stale-specialist revalidation, and the no-retry-
   on-flaky assertion.

Each step is independently revertable: a regression in step 3/4 never
requires re-touching step 1/2, and step 5 requires no further code changes.

---

## Test strategy

| Layer | Scope | How |
| ----- | ----- | --- |
| Unit — config/memo | `resolveNarrowingSurfaceConfig`-style gate resolution (agents/skills default off, mirrors `resolveToolSurfaceConfig`); `RoutingState` memo read/write/clear | Plain objects, no fakes |
| Unit — orchestrator | Gates-off short-circuit (no fake called); degenerate-input reuse (memo exists) and passthrough (no memo, first turn — no embed call asserted); zero-hit/revalidation-emptied/dedup-emptied -> `undefined` per surface; fail-open on a rejecting or slow (`Effect.timeout`-tripping) fake port, exactly one warning logged for a multi-surface failure; orchestration-child session -> tools `undefined` without a retrieval call; memoization: two calls with the same `lastUser.id` hit the memo, a fake call-counter proves a single retrieval round | Fake `SemanticRetrieval.Interface` (agents/skills/tools), a fake `RoutingSessionStateStore`, deterministic clock |
| Unit — seams | `describeTask`: hidden agents always present + in `[...pinned, ...narrowed]` order regardless of ranking; `sys.skills`: ranked subset via `Skill.fmt` unchanged content, only membership/order differs; `session/tools.ts`: essential-tool floor always present even when ranking excludes it, orchestration-child session bypasses the tools gate | Fixed `NarrowedSets`/`RankedGate` inputs, no retrieval fake needed |
| Golden — disabled path | Byte-identical snapshot of the rendered `task` description, skill listing, and native+MCP tool set, before and after this feature's changes, with all three gates off | Reuses Feature 050's snapshot-harness pattern; proves FR6/AC7 structurally, not by inspection |
| Integration — memoization across steps | A simulated multi-round-trip turn (two `SessionTools.resolve` + `sys.skills` calls sharing `lastUser.id`) asserts the SAME `NarrowedSets` is read both times and the retrieval fake is invoked exactly once | Fake facade + fake `RoutingSessionStateStore`, driving `prompt.ts`'s runLoop shape at the seam level |
| Live smoke | Two semantically different prompts in separate sessions with all gates on -> differing narrowed sets, each a subset of the permission-visible baseline (AC1); essential floor + hidden agents present regardless of prompt (AC2); Milvus stopped mid-turn -> full catalogs, one warning, turn completes (AC4); a deleted-but-still-indexed specialist is revalidated out (AC5); a flaky Milvus (fail-then-would-succeed) -> passthrough on first failure, no second attempt (AC6) | `OPENCODE_CONFIG_DIR=~/.opencodedev` against the real solaris endpoints, per the approved plan's operating profile |

---

## Risks and mitigations

| Risk | Evidence | Mitigation |
| ---- | -------- | ---------- |
| **Per-runLoop-step re-resolution** — `SessionTools.resolve`/`sys.skills` run once per tool-call round trip; a naive per-step call would re-embed/re-rank and could mutate the visible set mid-turn | `session/prompt.ts:1337,1498,1531` (verified) | The `RoutingState` memo keyed by `lastUser.id` is read, never recomputed, by every step of the same turn (FR1); the memoization-across-steps test makes this structural, not conventional |
| **Concurrent-fan-out embed dedup is not guaranteed by the runner** — `pipeline-runner.ts`'s `embedCache` (`:118-131`) is a resolved-value cache keyed by `taskId`, populated only AFTER the embed promise resolves; three concurrent calls (`Effect.all`) sharing one `taskId` can all observe a cache miss before the first resolves, issuing up to three physical embed calls instead of one | `pipeline-runner.ts:118-131` (verified — no in-flight-promise memoization) | Do not rely on the runner's cache for the single-embed guarantee: sequence the first surface's call to completion (warming the shared `taskId` cache) before firing the remaining surfaces concurrently, OR accept and document up to N physical embeds per turn as a latency (not correctness) cost bounded by the shared deadline. Verified by a fake-embed call-count assertion, mirroring Feature 050's AC5 instrumentation pattern; this feature does not modify `pipeline-runner.ts` (out of scope, Feature 050-owned) |
| **Empty-intersection turning into an empty catalog** — a degenerate retrieval result mistaken for a deliberate zero would hand the model nothing to work with | ADR-0051 "Considered Options" (rejected: treat empty as empty) | Every degenerate outcome (zero hits, revalidation-emptied, dedup-emptied) is mapped to `undefined` BEFORE the gate, preserving `ToolRetrieval.narrow`'s existing `undefined`-vs-`[]` contract (FR3); a unit test per degenerate cause proves each maps to passthrough, not to an empty `[]` |
| **Boot-order of the service mount** — the mount reads the persisted registry document via `Config.Service`; if that document is malformed, empty, or the join fails, the facade must not throw at boot | `retrieval-service.ts:36-40` (`UNAVAILABLE_RUNNER` already rejects honestly); `binding-runtime.ts:74-88` (`resolveActiveBinding` returns `undefined` on a broken join, never throws) | Any composition failure at mount time leaves the shipped degraded default in place; `narrowForTurn`'s fail-open handling absorbs the resulting rejection into a passthrough — no new startup failure mode is introduced |
| **Latency** — three concurrent surfaces (agents/skills/tools) each doing dense+sparse recall + rerank, sharing one 300ms deadline | `experimental.ts:58-64` (`TOOL_SEARCH_DEFAULTS.latencyBudgetMs`) | `Effect.timeout(latencyBudgetMs)` wraps the whole per-turn fan-out, not per surface; a surface still mid-flight at the deadline resolves to passthrough for that surface only (never blocks the other two or the turn) |

---

## Validation checklist (plan complete when)

- [x] One memoized `narrowForTurn` computation per user turn, keyed by
      `lastUser.id`, read (never recomputed) by every runLoop step (FR1)
- [x] Degenerate-input guard: short-follow-up reuses the prior memo; a short
      FIRST turn returns passthrough without embedding (FR2)
- [x] Every degenerate/empty outcome normalizes to `undefined` before the
      gate, for all three surfaces (FR3)
- [x] All three seams delegate to `ToolRetrieval.narrow`/`narrowRecord`; no
      bespoke filtering; hidden-agent pin and essential-tool floor enforced
      before the gate (FR4)
- [x] Orchestration-child sessions skip tool narrowing unconditionally (FR5)
- [x] Independent agents/skills/tools gates, default off, byte-identical
      disabled path (FR6)
- [x] Fail-open, zero-retry query plane; exactly one warning per failed turn
      (FR7)
- [x] Opt-in, content-free per-surface debug log (FR8)
- [x] `SemanticRetrieval.Service` mounted with real bindings composed the
      same way `stack-live.ts` composes them; no second construction site
      (FR9)
- [x] No change to Feature 050's index/data plane or Feature 009's gate
      primitive; every reused interface cited by exact file:line above

---

## Companion artifacts

| File | Purpose |
| ---- | ------- |
| [spec.md](spec.md) | FR1–FR9, acceptance scenarios, security requirements, observability |
| [tasks.md](tasks.md) | Dependency-ordered task breakdown |
| `doc/arch/schemas/wire-live-per-turn-semantic-narrowing-of-agents-skills-and.cue` | `#SemanticNarrowingConfig`, `#NarrowedSets`, `#EssentialToolFloor` — the config/data shapes this plan implements |
| [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md) | The architecture decision (memoization, fail-open posture, capability floors) this plan executes |
