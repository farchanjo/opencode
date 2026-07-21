# Tasks: Auto Skill Semantic Chunk Auto Priming Fourth Retrieval Pass

## Task Breakdown

### Phase 1 — Config gate and provenance

- [ ] T001 Add `#AutoSkillConfig` (`enabled: boolean` default `false`,
  `score_floor` default `0.75`) to `packages/schema/src/semantic/
  narrowing-config.ts`, mirroring the existing `NarrowingSurfaceGate`
  convention, per `#AutoSkillConfig`/`#ScoreFloor` in the feature's CUE
  schema. Does NOT touch `SemanticNarrowingConfig.agents`/`.skills`.
- [ ] T002 Add `resolveAutoSkillConfig` to `packages/core/src/config/
  experimental.ts`: the effective gate is `skill_autoprime.enabled &&
  semantic_narrowing.skills.enabled` (FR1) — a missing `skill_autoprime`
  block, or `skills.enabled === false`, both resolve to fully off.
- [ ] T003 Add a `provenance: { source: "local" | "remote-pack"; pack_ref?:
  string; autoprime_opt_in: boolean }` field to `Skill.Info`
  (`packages/opencode/src/skill/index.ts:33-38`) and to `SkillDoc`
  (`packages/schema/src/semantic/documents.ts:132-141`), per
  `#SkillProvenance` in the CUE schema. `IndexJobs.skillLiveDoc` (Feature
  050, `packages/opencode/src/semantic/index-jobs.ts`) threads the field
  onto `SkillDoc` unchanged.
- [ ] T004 Stamp provenance at discovery time in `discoverSkills`
  (`skill/index.ts:184-231`): every local-directory scan (global external
  dirs, project up-scans, `config.directories()`, `cfg.skills?.paths`,
  `:184-221`) stamps `{ source: "local" }`; the existing `cfg.skills.urls`
  loop (`:222-227`) stamps `{ source: "remote-pack", pack_ref: url,
  autoprime_opt_in }`, reading `autoprime_opt_in` from a NEW, separate
  per-pack config allowlist — the existing `urls: string[]` shape is
  unchanged (FR5).
- [ ] T005 Unit tests (`packages/core/test/config/experimental.test.ts`,
  `packages/opencode/test/skill/index.test.ts`): `skill_autoprime` default
  off; the composed gate is false when either flag is false and only true
  when both are true; local scans always stamp `"local"`; the URL loop
  always stamps `"remote-pack"` with the correct `pack_ref`;
  `autoprime_opt_in` defaults false when the pack is absent from the
  allowlist. CUE schema validates (`speckit validate`).

### Phase 2 — Fourth retrieval pass (skill_chunks)

- [ ] T006 Add `retrieveSkillChunks` to `RetrievalPort`
  (`packages/protocol/src/semantic/ports.ts:194-198`), sibling to
  `retrieveSkills`; add `SkillChunkRetrievalRequest extends
  RetrievalRequest` to `packages/protocol/src/semantic/commands.ts`
  (reusing `RetrievalResult` — candidates carry `kind: "skill_chunk"` and
  `chunkRef`, both already present at `commands.ts:393,396`).
- [ ] T007 Add `runSkillChunks` to `PipelineRunnerPort`'s production
  implementation (`packages/opencode/src/semantic/pipeline-runner.ts:
  297-299`), bound against the `skill_chunks` collection via `Pipeline.run`
  under the SAME `withDeadline`/`latencyBudgetMs` wrapper the other three
  bindings already use.
- [ ] T008 Add the chunk pass's OWN post-pipeline revalidation in
  `runSkillChunks` (mirroring the precedent Feature 051 established for
  agent revalidation, since `Pipeline.run` revalidates skills only,
  `pipeline.ts:157`): a candidate is `revalidated: true` only if its
  `parent_skill_id` still resolves against the live `Skill.Service` AND
  remains provenance-eligible; otherwise dropped before it ever reaches
  `live-narrowing.ts`.
- [ ] T009 Add `chunks?: readonly AutoSkillChunkRef[]` (`AutoSkillChunkRef
  = {chunkId, skillName, score}`) to `NarrowedSets`
  (`packages/opencode/src/session/routing-state.ts:44-48`), following the
  identical absent-means-passthrough / present-non-empty-means-narrowed
  convention as `agents`/`skills`/`tools`.
- [ ] T010 Extend `live-narrowing.ts`'s `NarrowForTurnDeps`/
  `NarrowingGates`/`buildRequests`/fan-out with the fourth surface: when
  the T002 composed gate is true, `retrieveSkillChunks` runs concurrently
  with the existing three calls in the SAME `Effect.all`/`Promise.all`
  group, sharing the SAME `TaskProfile` (single embed) and the SAME
  `latencyBudgetMs` timeout (FR1, FR7). When the gate is false, the fourth
  call is never attempted.
- [ ] T011 Add the provenance filter (FR5): before any confidence check, a
  chunk candidate is dropped unless `source === "local" || (source ===
  "remote-pack" && autoprime_opt_in === true)`.
- [ ] T012 Add the confidence-threshold filter (FR2): of the
  provenance-eligible candidates, keep only `score.confidence >=
  score_floor`; zero survivors (from zero hits, revalidation, provenance
  exclusion, or the floor) normalizes the `chunks` surface to `undefined`
  — never a present-but-empty list, identical to the existing degenerate-
  to-passthrough rule for the other three surfaces.
- [ ] T013 Unit tests (`packages/opencode/test/semantic/
  live-narrowing.test.ts`, extended): a fake `RetrievalPort` with
  `retrieveSkillChunks` — gate composition (off when either flag is off,
  fake never called); provenance filtering (local kept, remote-pack
  no-opt-in dropped, remote-pack with opt-in kept); confidence filtering
  (above/at/below `score_floor`, each a separate case); zero-hit/
  revalidation-emptied/provenance-excluded/below-floor all map to
  `undefined`; the fourth branch runs under the SAME timeout as a slow
  fake proves for the other three surfaces; memoization — a second call
  with the same `lastUser.id` returns the memoized `chunks` field without
  a second fake invocation.

### Phase 3 — Render the `<auto_skills>` block

- [ ] T014 Add an `autoSkillInjected: ReadonlySet<string> | null` field to
  `RoutingSessionState` (`routing-state.ts:60-77`) and a
  `recordAutoSkillInjected(sessionId, skillNames)` store method beside
  `recordNarrowedSets` (merges into the existing set, lazily creates it);
  cleared with the rest of the state at the existing `clear`
  (`:211-213`) — no new store, no new lifecycle hook (FR6).
- [ ] T015 Add `autoSkills(agent: Agent.Info, chunks?: readonly
  AutoSkillChunkRef[])` to `SystemPrompt.Interface`/`Service`
  (`session/system.ts:45-58`), a sibling to the existing `skills`/`mcp`/
  `environment` methods. `chunks` absent or already-degenerate ->
  `undefined` (no block) without any I/O (FR2, FR3).
- [ ] T016 In `autoSkills`, filter out any chunk whose `skillName` is
  already present in `RoutingSessionState.get(sessionId)
  .autoSkillInjected` for this session, BEFORE resolving any body (FR6).
- [ ] T017 In `autoSkills`, resolve each remaining chunk's
  `body_ref.output_ref` via `OutputSpoolStore.resolve`
  (`packages/opencode/src/semantic/output-spool-store.ts:74`), in rank
  order; a `not_found`/`spool_unavailable` result skips that ONE chunk
  silently (FR3) — never a raw error, never a partial body, never a block
  fails-whole over one stale ref.
- [ ] T018 Enforce the render-time budget (FR4): accumulate resolved
  bodies while `Token.estimate` (`core/src/util/token.ts`) of the running
  total stays within `Budget.Retrieval.max_skill_tokens`
  (`schema/routing/budget.ts:45`) AND the chunk count stays within
  `max_skill_chunks` (`:44`); stop appending (drop the lowest-ranked
  remaining chunks first) once either cap would be exceeded. Neither knob
  is read or spent by `SystemPrompt.skills` (Tier-1, unchanged).
- [ ] T019 Render the `<auto_skills>` block over the survivors (mirrors the
  `Skill.fmt`-style convention `skills` already uses, `system.ts:113-119`);
  zero survivors after T016/T017/T018 -> return `undefined` (no block, not
  an empty `<auto_skills></auto_skills>` tag pair).
- [ ] T020 After a successful (non-empty) render, call
  `recordAutoSkillInjected` with every rendered chunk's `skillName` (FR6).
  Add the opt-in debug-log extension (FR8): when Feature 051's
  `debug_log` flag is on, emit the injected `chunkId`/`score` pairs — ids
  and scores only, never chunk body or prompt text.
- [ ] T021 Unit tests (`packages/opencode/test/session/system.test.ts`,
  extended; a fake `OutputSpoolStore` and a fake `RoutingSessionStateStore`):
  dangling/superseded ref skips only that chunk, block still renders from
  the remaining survivors; budget truncation (chunk-count cap, token cap,
  lowest-ranked-dropped-first, each a separate case); session dedup
  excludes an already-injected skill name regardless of its current rank;
  zero survivors at every stage (empty input, all-deduped, all-dangling,
  all-over-budget) all return `undefined`, never an empty tag pair; a
  successful render calls `recordAutoSkillInjected` with exactly the
  rendered skill names.

### Phase 4 — Call site and verification

- [ ] T022 Edit `packages/opencode/src/session/prompt.ts`: thread the
  extended `NarrowedSets.chunks` (already produced by the existing
  `narrowForTurn` call before `SessionTools.resolve`, per Feature 051) into
  a new `sys.autoSkills(agent, narrowedSets?.chunks)` call beside the
  existing `sys.skills(agent, narrowedSets?.skills)` call (`:1531`);
  splice the rendered `<auto_skills>` block into the system prompt beside
  `<available_skills>`. No second `narrowForTurn` call is introduced.
- [ ] T023 Integration test — memoization across runLoop steps (extends
  Feature 051's existing test at `packages/opencode/test/session/
  prompt.test.ts` or its seam-level equivalent): a simulated two-round-trip
  turn (same `lastUser.id`) asserts `sys.autoSkills` reads the identical
  `NarrowedSets.chunks` on both round trips and the fake `retrieveSkillChunks`
  is invoked exactly once for the turn.
- [ ] T024 Golden — disabled path: byte-identical snapshot of the rendered
  system prompt in BOTH sub-cases — `skill_autoprime` off with the skills
  gate off, and `skill_autoprime` off with the skills gate ON — before and
  after this feature's changes (FR1, mirrors Feature 051's AC7 pattern).
- [ ] T025 Live smoke (`OPENCODE_CONFIG_DIR=~/.opencodedev`): an on-domain
  prompt against a seeded local skill produces an `<auto_skills>` block
  within budget (AC1); an off-domain prompt produces none (AC2); deleting
  a seeded skill's file without a reindex produces a silently-skipped
  dangling ref and a normally-completing turn (AC3); a seeded remote pack
  without `autoprime_opt_in` never appears in `<auto_skills>` even when it
  ranks highly, and remains Tier-1 listable and `skill`-tool loadable
  (AC4); a skill injected earlier in a session is not re-injected on a
  later turn in the SAME session (AC5).
- [ ] T026 Gates: `bun test test/semantic/ test/session/ test/skill/`
  green; `bunx tsgo --noEmit -p packages/opencode/tsconfig.json` clean;
  `speckit validate --json` -> `ok:true`.

## Dependencies

- Composes with the shipped Feature 050 (skill chunker,
  `SkillChunkDoc.body_ref`, `OutputSpoolStore.resolve`) and the shipped
  Feature 051 (`narrowForTurn`, `NarrowedSets`, the `RoutingState` memo,
  `SystemPrompt.skills`, the surface-gate convention) — neither is modified
  by this feature's tasks, only extended.
- Touches the retrieval protocol (`protocol/semantic/{ports,commands}.ts`),
  the production runner (`semantic/pipeline-runner.ts`), the orchestrator
  (`semantic/live-narrowing.ts`), the memo/dedup store
  (`session/routing-state.ts`), the render seam (`session/system.ts`), the
  call site (`session/prompt.ts`), skill discovery (`skill/index.ts`), and
  the document schema (`schema/semantic/documents.ts`); adds no new
  package, no new cache, no new content-plane reader, no new budget
  constant.
- Feature 053 (orchestration handoff) depends on this feature's memo/seam
  shape (specifically `NarrowedSets.chunks` and the composed gate
  convention); it is not touched here.

## Invariants Preserved

- The fourth surface runs inside Feature 051's EXISTING per-turn
  orchestration — one embed, one deadline, one memo — never a second
  timer, cache, or embedding call (FR1, FR7).
- `skill_autoprime` composes with, never replaces, the Feature 051 skills
  gate; either off is a complete no-op for this feature (no I/O, no memo
  write for the `chunks` field) (FR1).
- Every degenerate outcome (zero hits, revalidation-emptied, provenance-
  excluded, below the confidence floor) normalizes to `undefined` before
  the memo is written — a narrowing pass never produces an empty-but-
  present `chunks` list (FR2, FR3).
- A chunk body is reached ONLY through `OutputSpoolStore.resolve`; the raw
  `SKILL.md` file is never read at render time (FR3).
- `max_skill_chunks`/`max_skill_tokens` are spent EXCLUSIVELY by this
  feature's render pass; Tier-1 `<available_skills>` listing never spends
  them (FR4).
- A remote pack's chunks are NEVER auto-injected unless that specific
  pack's `autoprime_opt_in` is explicitly true; a remote pack without
  opt-in remains fully Tier-1 listable and `skill`-tool loadable (FR5).
- A skill fully injected once in a session is never re-injected in that
  same session, regardless of later ranking; the `skill` tool's
  availability is completely unaffected by dedup state (FR6).
- The query plane never blocks a turn and never retries on this feature's
  path — any failure is always "no injection" plus, at most, Feature 051's
  existing one-warning-per-turn, never a hang or a second attempt (FR8).
- This feature is a pure ADDITION to the system prompt's content; it never
  widens tool-call, agent-spawn, or skill-tool-load permission — a chunk
  auto-injected here was always already readable via the `skill` tool
  under the same permission check.
