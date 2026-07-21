# Tasks: Wire Live Per Turn Semantic Narrowing Of Agents Skills And

## Task Breakdown

### Phase 1 — Config gates, `NarrowedSets` type, `RoutingState` memo field

- [x] T001 Add the `semantic_narrowing` config block to `packages/core/src/
  config/experimental.ts`: `agents`/`skills` per-surface gates mirroring
  `resolveToolSurfaceConfig` (`:84`) field-for-field (`enabled: boolean`,
  default `false`), plus `min_prompt_length` (default 8) and `debug_log`
  (default off), per `#SemanticNarrowingConfig` in the feature's CUE schema.
  The tools surface gate is NOT duplicated — it reuses the existing
  `resolveToolSurfaceConfig("native"|"mcp")` unchanged.
- [x] T002 Add `NarrowedSets` (agents/skills/tools optional non-empty ranked
  id lists, mirroring the CUE `#NarrowedSets` shape) to `packages/opencode/
  src/session/routing-state.ts`: a `narrowedSets: NarrowedSets | null` field
  on `RoutingSessionState` (`:36`), a `recordNarrowedSets(sessionId, sets)`
  store method beside `recordDecision` (`:121`), read via the existing `get`;
  cleared with the rest of the state at the existing `clear` (`:168`) — no new
  store, no new lifecycle hook.
- [x] T003 Unit tests (`packages/core/test/config/experimental.test.ts`,
  `packages/opencode/test/session/routing-state.test.ts`): both `agents`/
  `skills` gates default `false` and resolve independently of the tools
  surface and each other; `min_prompt_length`/`debug_log` default correctly
  when `semantic_narrowing` is absent; `recordNarrowedSets`/`get`/`clear`
  round-trip; `clear` also drops `narrowedSets` alongside the existing fields.

### Phase 2 — `live-narrowing.ts` orchestrator

- [x] T004 Create `packages/opencode/src/semantic/live-narrowing.ts`:
  `narrowForTurn(input)` — the gates-off short-circuit (FR6, no I/O, no memo
  write when agents/skills/tools are all disabled), reading the memo via the
  injected `RoutingSessionStateStore`.
- [x] T005 Add the degenerate-input guard to `narrowForTurn`: below
  `min_prompt_length`, reuse the prior `NarrowedSets` memo verbatim (FR2); no
  prior memo (a short first turn) returns full passthrough (every surface
  `undefined`) without embedding.
- [x] T006 Add the concurrent fan-out: one `TaskProfile` built once per turn,
  `Effect.all` with bounded concurrency over `SemanticRetrieval.Service
  .retrieveAgents`/`.retrieveSkills`/`.retrieveTools` (tools omitted entirely
  for an orchestration-child session, FR5), each wrapped in
  `Effect.timeout(latencyBudgetMs)` from the shared `TOOL_SEARCH_DEFAULTS`
  knob (FR1, FR7).
- [x] T007 Add the degenerate-to-`undefined` mapping (FR3): zero retrieval
  hits, a result set emptied by revalidation, or a result set emptied by
  dedup all normalize to `undefined` for that surface BEFORE `NarrowedSets`
  is assembled — never a present-but-empty ranked list.
- [x] T008 Add the fail-open wrap (FR7): any surface's rejection, timeout, or
  unexpected error resolves that surface to `undefined`; exactly ONE
  content-free warning is logged for the whole turn regardless of how many
  surfaces failed; zero retries anywhere on this path.
- [x] T009 Add the orchestration-child detector (FR5): a pure structural
  comparison of the session's permission ruleset against the shape
  `orchestrationChildToolRules()` (`tool/task.ts:74-83`) produces; when
  matched, `narrowForTurn` never attempts tool retrieval and returns
  `undefined` for the tools surface unconditionally (agents/skills
  unaffected).
- [x] T010 Add the opt-in debug log (FR8): gated by its own `debug_log` flag
  (T001), emits kept/dropped canonical ids per surface per turn — ids only,
  never prompt text or vectors.
- [x] T011 Write the memo (FR1): on a completed (non-degenerate,
  non-short-circuited) pass, `narrowForTurn` calls `recordNarrowedSets`
  (T002) keyed by `lastUser.id` before returning.
- [x] T012 Unit tests (`packages/opencode/test/semantic/
  live-narrowing.test.ts`) against a fake `SemanticRetrieval.Interface` and a
  fake `RoutingSessionStateStore`: gates-off short-circuit (fake never
  called); degenerate-input reuse and first-turn passthrough; per-surface
  degenerate-to-`undefined` mapping (zero hits / revalidation-emptied /
  dedup-emptied, each as a separate case); fail-open on a rejecting fake and
  on a slow fake tripping the timeout, asserting exactly one warning log
  regardless of how many surfaces failed; orchestration-child session skips
  the tools call entirely (call-count assertion); memoization proves a second
  `narrowForTurn` call with the same `lastUser.id` returns the memoized
  result without a second fake invocation.

### Phase 3 — Seams: agents, skills, tools

- [x] T013 Edit `packages/opencode/src/tool/registry.ts`'s `describeTask`
  (`:266-279`): accept an optional `rankedAgentIds?: readonly string[]`;
  partition `Agent.Info.hidden === true` entries out as `pinned` BEFORE
  `ToolRetrieval.narrow(narrowable, (a) => a.name, gate)` runs on the
  remaining `narrowable` list; render `[...pinned, ...narrowed]` in that
  order. The splice site at `:338` is unchanged (still calls `describeTask`
  the same way, now optionally passing `rankedAgentIds`).
- [x] T014 Unit tests (`packages/opencode/test/tool/registry.test.ts`):
  hidden agents always render regardless of ranking or absence from
  `rankedAgentIds`; a ranked, narrowed subset filters/reorders only the
  non-hidden list; an absent `rankedAgentIds` renders the full non-primary
  list unchanged (byte-identical to today).
- [x] T015 Edit `packages/opencode/src/session/system.ts`'s `sys.skills`
  (`:98-110`): accept an optional `ranked?: readonly string[]`; apply
  `ToolRetrieval.narrow(list, (s) => s.name, gate)` before `Skill.fmt`
  renders it; an absent `ranked` renders the full list unchanged. Spends
  neither `max_skill_chunks` nor `max_skill_tokens` (Tier-1 listing only).
- [x] T016 Unit tests (`packages/opencode/test/session/system.test.ts`):
  ranked subset changes membership/order only, never `Skill.fmt`'s rendering
  logic; absent `ranked` is byte-identical to pre-feature output.
- [x] T017 Edit `packages/opencode/src/session/tools.ts`: replace
  `ToolRetrieval.PASSTHROUGH` at the native surface (`:114`) and the MCP
  surface (`:411`) with the live `RankedGate` read from the turn's
  `NarrowedSets` (via the new `narrowedSets` input to `resolve`, mirroring
  the existing `hierarchyResolve` optional-input pattern at `:54`); before
  either `ToolRetrieval.narrow`/`narrowRecord` call, union the essential-tool
  floor (`task`, `skill`, `todowrite`, `question`, `read`, `edit`, `write`,
  `bash`, `grep`, `glob`) into `gate.ranked` so it can be reordered but never
  dropped; `StructuredOutput` (appended after `resolve()` returns at
  `prompt.ts:1517`) needs no special-casing — it never enters the gate.
  Implemented as plain `rankedTools?: readonly string[]` +
  `skipToolNarrowing?: boolean` inputs (not a `NarrowedSets` input) per the
  Phase 3/Phase 4 split — `live-narrowing.ts` and its `NarrowedSets` type are
  Phase 2 territory built concurrently; T020 (Phase 4) threads
  `narrowForTurn`'s output into these two seam inputs.
- [x] T018 Unit tests (`packages/opencode/test/session/tools.test.ts`):
  essential-tool floor present even when a fake ranking excludes it; a
  narrowed non-floor tool is correctly dropped/reordered; an `undefined`
  tools surface (gates off or orchestration child) renders the full
  permission-visible set unchanged (byte-identical passthrough).

### Phase 4 — Mount and call site

- [ ] T019 Edit `packages/opencode/src/effect/app-runtime.ts`: add
  `SemanticRetrieval.node` to the `LayerNode.group([...])` list (`:59-107`);
  compose the live-binding override (Milvus port via `MilvusComposition
  .composeMilvusPort`, active embedding/reranker binding via `BindingRuntime
  .resolveActiveBinding` reading the persisted registry document through
  `Config.Service`, production `EmbeddingsHttpPort` via `EmbeddingsHttpClient
  .createFetchEmbeddingsHttpClient`) into `PipelineRunner.PipelineRunnerDeps`
  and call `SemanticRetrieval.createSemanticRetrievalPort(deps)`; merge the
  resulting layer over the default degraded one (mirrors the existing
  `AppNodeBuilderV1.build(Ripgrep.node)` override-merge at `:109`). Any
  resolution failure (no endpoint, no active binding) leaves the shipped
  degraded default in place — no new boot failure mode.
- [ ] T020 Edit `packages/opencode/src/session/prompt.ts`: call
  `LiveNarrowing.narrowForTurn(...)` once per turn immediately before
  `SessionTools.resolve` (`:1498`), threading the `RoutingSessionStateStore`,
  `session.permission`, and `lastUser`; pass the resulting `NarrowedSets`
  into `SessionTools.resolve`'s new `narrowedSets` input (T017) and into
  `sys.skills(agent, narrowedSets?.skills)` (`:1531`).
- [ ] T021 Integration test — memoization across runLoop steps
  (`packages/opencode/test/session/prompt.test.ts` or a seam-level
  equivalent): a simulated two-round-trip turn (same `lastUser.id`) asserts
  `SessionTools.resolve` and `sys.skills` both read the identical
  `NarrowedSets` on both round trips and the fake retrieval facade is invoked
  exactly once for the turn.
- [ ] T022 Live smoke — differing prompts
  (`OPENCODE_CONFIG_DIR=~/.opencodedev`): two semantically different prompts
  in separate sessions with all three gates enabled produce different
  narrowed agent/skill/tool sets, each a subset of that turn's
  permission-visible baseline (AC1); every essential-floor tool and every
  hidden agent is present in both (AC2).

### Phase 5 — Verification

- [ ] T023 Golden — disabled path: byte-identical snapshot of the rendered
  `task` description, skill listing, and native+MCP tool set before and after
  this feature's changes, with all three `semantic_narrowing` gates off
  (AC7/FR6); reuses Feature 050's snapshot-harness pattern.
- [ ] T024 Live/fault smoke — Milvus down: stop (or point at an unreachable)
  Milvus mid-session; a turn with gates enabled completes with full
  catalogs on every surface, exactly one content-free warning logged, and no
  hang (AC4, FR7).
- [ ] T025 Live/fault smoke — stale specialist revalidation: seed the index
  with an agent whose Markdown file is then deleted without a reindex; a
  turn's agent narrowing revalidates against the live registry and drops the
  stale entry before rendering (AC5, mirrors Feature 050's own-agent
  revalidation contract).
- [ ] T026 Live/fault smoke — no retry on flaky Milvus: a Milvus that fails
  once and would succeed on a second attempt produces exactly one failed
  call and an immediate passthrough for that surface — no second attempt
  within the turn (AC6, FR7).
- [ ] T027 Gates: `bun test test/semantic/ test/session/ test/tool/` green;
  `bunx tsgo --noEmit -p packages/opencode/tsconfig.json` clean; `speckit
  validate --json` → `ok:true`.

## Dependencies

- Composes with the shipped Feature 050 (`PipelineRunnerPort`,
  `SemanticRetrieval.Service`, `composeMilvusPort`, `BindingRuntime`,
  `EmbeddingsHttpClient`) and Feature 009 (`ToolRetrieval.narrow`/
  `narrowRecord`, the `PASSTHROUGH` convention, `resolveToolSurfaceConfig`).
- Touches the three narrowable seams (`tool/registry.ts`, `session/
  system.ts`, `session/tools.ts`), the per-turn call site (`session/
  prompt.ts`), the session-scoped memo (`session/routing-state.ts`), the
  config gates (`config/experimental.ts`), and the `AppLayer` mount
  (`effect/app-runtime.ts`); adds no new package, no new cache, no new
  filtering primitive.
- Feature 052 (auto-skill content injection) and Feature 053 (orchestration
  handoff) depend on this feature's memo/seam shape; neither is touched here.

## Invariants Preserved

- Gates-off is byte-identical to today on every surface — no embedding call,
  no memo write, no rendering difference (FR6, AC7).
- The narrowed tool/skill/agent set never mutates within a single turn — the
  memo is read, never recomputed, by every runLoop round trip (FR1).
- A narrowing pass never produces an empty catalog — every degenerate outcome
  normalizes to passthrough before the gate runs (FR3).
- The essential-tool floor and every hidden agent are present in every
  narrowed variant, regardless of ranking (FR4).
- An orchestration child's tool set is never narrowed (FR5).
- The query plane never blocks a turn and never retries — a failure is
  always a passthrough plus one warning, never a hang or a second attempt
  (FR7).
- Narrowing is a pure shrink applied strictly between permission-visibility
  and `resolveTools`'s per-request re-filter — it never widens what a tool
  call, agent spawn, or skill load may do.
