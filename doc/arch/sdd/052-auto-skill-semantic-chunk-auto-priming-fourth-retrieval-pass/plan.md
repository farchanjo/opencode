# Implementation Plan: Auto Skill Semantic Chunk Auto Priming Fourth Retrieval Pass

Feature: 052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass
Spec: [spec.md](spec.md) (FR1–FR8, 6 acceptance scenarios)
CUE: [`auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass.cue`](../../schemas/auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass.cue)
ADR: [ADR-0052](../../adr/0052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass.md)
Dependencies:
[Feature 050 Wire The Semantic Index Data Plane Production Pipeline](../050-wire-the-semantic-index-data-plane-production-pipeline/spec.md) (skill chunker, `SkillChunkDoc.body_ref`, `OutputSpoolStore`),
[Feature 051 Wire Live Per Turn Semantic Narrowing Of Agents Skills And](../051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and/spec.md) (`narrowForTurn`, `NarrowedSets`, `RoutingState` memo, `SystemPrompt.skills`, the gate convention),
[ADR-0050](../../adr/0050-wire-the-semantic-index-data-plane-production-pipeline.md), [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md).

---

## Overview

Feature 050 shipped the skill chunker and `OutputSpoolStore`; Feature 051
wired three live-turn narrowing surfaces (agents, skills, tools) and
deliberately reserved `max_skill_chunks`/`max_skill_tokens`
(`Budget.Retrieval`, `schema/routing/budget.ts:44-45`) unspent. The wire
contract itself (`RetrievalCandidate.kind: "skill_chunk"`, `chunkRef`,
`packages/protocol/src/semantic/commands.ts:393,396`) already anticipated a
fourth, content-level pass — nothing has ever issued a request against the
`skill_chunks` collection.

This feature (SR-C) adds that fourth pass to `narrowForTurn`, a strict
confidence floor before any candidate is considered, a provenance trust
boundary restricting auto-injection to local skills by default, a new
`SystemPrompt` sibling method rendering an `<auto_skills>` block resolved
through `OutputSpoolStore` under the two reserved budgets, and
session-scoped dedup — composing with Feature 051's existing per-turn
machinery (one embed, one deadline, one memo) without modifying it.

## Why this is a fourth surface, not a second orchestration path

`narrowForTurn`'s `Effect.all` fan-out (`live-narrowing.ts:277-281`) already
runs three surfaces concurrently under one shared `latencyBudgetMs`
deadline, keyed by the SAME `lastUser.id` memo. Adding a fourth branch to
that SAME fan-out — rather than a second timer, a second embed call, or a
second memo store — means every guarantee Feature 051 already proved
(tool-call continuity across runLoop steps, fail-open on Milvus/embedding
failure, zero retries, byte-identical when gated off) extends to the chunk
surface without re-proving it. The only genuinely new machinery this
feature adds is: the confidence floor (FR2), the provenance filter (FR5),
the render/resolve/budget pass (FR3/FR4), and session dedup (FR6) — all of
which are downstream of the memoized `NarrowedSets.chunks` field, never
upstream of it.

---

## Component breakdown

| # | Component | Path | Kind | FR |
| - | --------- | ---- | ---- | -- |
| 1 | `skill_autoprime` config gate | `packages/schema/src/semantic/narrowing-config.ts` (EDIT — new `AutoSkillConfig` struct: `enabled`, `score_floor`), `packages/core/src/config/experimental.ts` (EDIT — `resolveAutoSkillConfig` composing `skill_autoprime.enabled && semantic_narrowing.skills.enabled`) | Domain (config) | FR1, FR2 |
| 2 | Skill provenance | `packages/opencode/src/skill/index.ts` (EDIT — `Info` schema gains `provenance`; `discoverSkills`'s local scans stamp `source: "local"`, the `cfg.skills.urls` loop stamps `source: "remote-pack"` + `pack_ref` + `autoprime_opt_in` from a new per-pack allowlist), `packages/schema/src/semantic/documents.ts` (EDIT — `SkillDoc` gains the same `provenance` shape; `IndexJobs.skillLiveDoc`, Feature 050, threads it) | Domain + Application | FR5 |
| 3 | `RetrievalPort` skill_chunks method | `packages/protocol/src/semantic/ports.ts` (EDIT — `RetrievalPort` gains `retrieveSkillChunks`, sibling to `retrieveSkills`), `packages/protocol/src/semantic/commands.ts` (EDIT — `SkillChunkRetrievalRequest extends RetrievalRequest`, reuses `RetrievalResult`) | Domain (protocol) | FR1 |
| 4 | `runSkillChunks` pipeline binding | `packages/opencode/src/semantic/pipeline-runner.ts` (EDIT — new `runSkillChunks` bound against the `skill_chunks` collection via `Pipeline.run`, PLUS its own post-pipeline revalidation: a chunk's parent skill must still resolve live AND remain provenance-eligible, mirroring the own-agent-revalidation precedent Feature 051 added for agents) | Application | FR1, FR5 |
| 5 | `NarrowedSets.chunks` + fourth fan-out branch | `packages/opencode/src/session/routing-state.ts` (EDIT — `NarrowedSets` gains `chunks?: readonly AutoSkillChunkRef[]`), `packages/opencode/src/semantic/live-narrowing.ts` (EDIT — fourth concurrent branch in the `Effect.all` group, confidence-floor + provenance filtering before the degenerate-to-`undefined` mapping) | Application | FR1, FR2, FR7 |
| 6 | Session dedup set | `packages/opencode/src/session/routing-state.ts` (EDIT — `RoutingSessionState` gains `autoSkillInjected: ReadonlySet<string> \| null`; `recordAutoSkillInjected` beside `recordNarrowedSets`; cleared with the rest of the state at the existing `clear`) | Application | FR6 |
| 7 | `SystemPrompt.autoSkills` render | `packages/opencode/src/session/system.ts` (EDIT — new sibling method on `Interface`/`Service`, resolves bodies via `OutputSpoolStore.resolve`, enforces `Budget.Retrieval.max_skill_chunks`/`max_skill_tokens` via `Token.estimate`, filters against the dedup set, calls `recordAutoSkillInjected` after a successful render) | Application | FR3, FR4, FR6 |
| 8 | Call site | `packages/opencode/src/session/prompt.ts` (EDIT — thread the extended `NarrowedSets.chunks` from the existing `narrowForTurn` call into a new `sys.autoSkills(agent, narrowedSets?.chunks)` invocation beside the existing `sys.skills` call, splicing the rendered block into the system prompt) | Application | FR3, FR7 |

No new package boundary, no new filtering primitive, no new cache, no new
budget constant — every "NEW" surface is additive to an already-in-scope
Feature 050/051 module; the only wholly new file-level construct is the
`retrieveSkillChunks` port method + its `pipeline-runner.ts` binding
(component #3/#4), which is the specific slot the Feature 006 wire contract
already reserved (`RetrievalCandidate.kind: "skill_chunk"`).

### Reuse contract (binding — no duplication)

1. **Per-turn orchestration**: `narrowForTurn`'s existing `Effect.all` fan-
   out, shared `latencyBudgetMs` deadline, and `RoutingState` memo
   (`live-narrowing.ts`, `routing-state.ts`) are the ONLY orchestration this
   feature's fourth surface runs through — no second timer, no second embed
   call, no second memo store.
2. **Gate convention**: `skill_autoprime` mirrors the Feature 051
   `NarrowingSurfaceGate` shape (`enabled: boolean`, default `false`) and
   composes with (never duplicates) the existing `semantic_narrowing.skills`
   gate.
3. **Reserved budgets**: `Budget.Retrieval.max_skill_chunks`/
   `max_skill_tokens` (`schema/routing/budget.ts:44-45`) are the ONLY budget
   knobs this feature enforces at render — no new constant, no new schema
   field for chunk/token limits.
4. **Content plane**: `OutputSpoolStore.resolve` (`output-spool-store.ts`,
   Feature 050) is the ONLY path to a chunk body — no second reader, no raw
   `SKILL.md` read at render time.
5. **Token counting**: `Token.estimate` (`core/src/util/token.ts`) is reused
   unchanged for the render-time budget check — no new estimator.
6. **Rendering convention**: `SystemPrompt.autoSkills` follows the SAME
   `Skill.fmt`-style convention `SystemPrompt.skills` already uses
   (`session/system.ts:106-120`) — no bespoke prompt-formatting logic.

---

## Fourth-surface flow (FR1–FR8)

```
narrowForTurn(input) [existing Feature 051 entry point, extended]:
  ...steps 1-3 unchanged (gates-off short-circuit, memo check, degenerate-input guard)...
  4. chunksEnabled = skill_autoprime.enabled && skills.enabled              [FR1]
  5. run agents/skills/tools passes AS TODAY, plus (if chunksEnabled):
     Service.retrieveSkillChunks(profile) concurrently in the SAME Effect.all,
     wrapped in the SAME Effect.timeout(latencyBudgetMs)                    [FR1, FR7]
  6. chunk candidates: keep only provenance-eligible
     (source=="local" || (source=="remote-pack" && autoprime_opt_in))       [FR5]
  7. of those, keep only score.confidence >= score_floor                    [FR2]
  8. zero-hit / revalidation-emptied / below-floor / provenance-excluded
     -> undefined for the chunks surface (never an empty-but-present list)  [FR2, FR3]
  9. a non-empty qualifying set -> NarrowedSets.chunks = ranked
     {chunkId, skillName, score}[]                                          [FR1]
  10. write NarrowedSets (now incl. chunks) to the SAME RoutingState memo    [FR1, FR7]

SystemPrompt.autoSkills(agent, chunks?) [NEW, session/system.ts]:
  1. chunks undefined or [] -> return undefined (no block)                  [FR2]
  2. filter out any {skillName} already in RoutingSessionState
     .autoSkillInjected for this session                                    [FR6]
  3. for each remaining chunk, in rank order:
       OutputSpoolStore.resolve(body_ref.output_ref)
         -> not_found/spool_unavailable: skip this ONE chunk silently       [FR3, FR8]
         -> ok: accumulate body, running Token.estimate total
       stop accumulating once max_skill_chunks OR max_skill_tokens
       would be exceeded (drop lowest-ranked remaining first)               [FR4]
  4. zero chunks survived step 2/3 -> return undefined (no block)
  5. render "<auto_skills>" block (Skill.fmt-style) over the survivors
  6. record every rendered chunk's skillName into
     RoutingSessionState.autoSkillInjected                                  [FR6]
```

Any exception anywhere in either flow resolves to "no injection" for the
affected chunk or surface and is absorbed into Feature 051's existing
one-warning-per-turn discipline (FR8) — this feature adds no second warning
path and no retry.

### Provenance stamping (FR5)

Stamped once, at DISCOVERY time, never re-derived at render time:

- `discoverSkills`'s local-directory scans (`skill/index.ts:184-221` —
  global `.claude`/`.agents`, project-relative up-scans,
  `config.directories()`, `cfg.skills?.paths`) stamp every resulting
  `Skill.Info` with `provenance: { source: "local" }`.
- The existing `cfg.skills.urls` remote-pack loop (`:222-227`) stamps
  `provenance: { source: "remote-pack", pack_ref: url, autoprime_opt_in }`,
  where `autoprime_opt_in` is read from a NEW, separate per-pack config
  allowlist — the existing `urls: string[]` shape is unchanged; opt-in is
  additive config, never a change to how packs are pulled.
- `IndexJobs.skillLiveDoc` (Feature 050, `index-jobs.ts`) threads the same
  `provenance` shape onto `SkillDoc` so the index-time projection and the
  live `Skill.Info` never disagree about a skill's trust class.

---

## Sequencing

1. **Config + provenance first** — `skill_autoprime` gate (schema + config
   resolver), `Skill.Info`/`SkillDoc` provenance field, discovery-time
   stamping. Independently unit-testable with plain objects, no Effect
   runtime, no retrieval fake — this is pure domain/config work exactly
   like Feature 051's Phase 1.
2. **Retrieval pass** — `RetrievalPort.retrieveSkillChunks`,
   `pipeline-runner.ts`'s `runSkillChunks` binding + its own chunk
   revalidation, `NarrowedSets.chunks`, and `live-narrowing.ts`'s fourth
   fan-out branch (confidence floor + provenance filter + degenerate
   mapping), unit-tested against a fake `RetrievalPort` extended with
   `retrieveSkillChunks` — independent of the render pass.
3. **Render block** — `SystemPrompt.autoSkills`, the `OutputSpoolStore`
   resolve loop, budget enforcement, session dedup, unit-tested with a
   fixed `chunks` input and a fake `OutputSpoolStore` — no retrieval fake
   needed, mirroring how Feature 051 unit-tested its seams independently of
   its orchestrator.
4. **Call site** — thread `narrowedSets?.chunks` from the existing
   `narrowForTurn` call in `prompt.ts` into the new `sys.autoSkills` call
   beside `sys.skills`; the memoization-across-runLoop-steps guarantee is
   inherited from Feature 051's existing call-site test, extended to assert
   the `chunks` field is read (never recomputed) on a second round trip.
5. **Verification** — the golden gates-off byte-identical snapshot (both
   `skill_autoprime` off AND the composed-gate-off case where skills is on
   but `skill_autoprime` is off), on-domain/off-domain live smoke, a
   dangling-ref smoke, a remote-pack-without-opt-in smoke, and a
   session-dedup smoke.

Each step is independently revertable: a regression in step 3 never
requires re-touching step 1/2, and step 5 requires no further code changes.

---

## Test strategy

| Layer | Scope | How |
| ----- | ----- | --- |
| Unit — config/provenance | `skill_autoprime` gate resolution (default off, composes with the skills gate — both must be true); provenance stamped correctly per discovery source; a remote pack's `autoprime_opt_in` defaults false | Plain objects, no fakes |
| Unit — retrieval pass | Confidence-floor filtering (above/at/below `score_floor`, each a separate case); provenance filtering (local kept, remote-pack-no-opt-in dropped, remote-pack-with-opt-in kept); zero-hit/revalidation-emptied/below-floor/provenance-excluded all map to `undefined`, never an empty-but-present list; the fourth branch runs under the SAME `Effect.timeout`/deadline as the other three, proven by a call-count/timing assertion; `skill_autoprime` off -> the fake `retrieveSkillChunks` is never called | Fake `RetrievalPort` extended with `retrieveSkillChunks`, deterministic clock |
| Unit — render pass | Dangling/superseded ref skips only that one chunk, never fails the block; budget truncation (chunk-count cap, token cap, lowest-ranked-dropped-first); session dedup excludes an already-injected skill name and is unaffected by ranking; zero survivors -> no block emitted (not an empty `<auto_skills></auto_skills>`) | Fixed `chunks` input, fake `OutputSpoolStore`, fake `RoutingSessionStateStore` |
| Golden — disabled path | Byte-identical snapshot of the rendered system prompt with `skill_autoprime` off (both sub-cases: skills gate off, and skills gate on but `skill_autoprime` off) | Reuses Feature 051's snapshot-harness pattern |
| Integration — call site | The extended `narrowForTurn` call plus the new `sys.autoSkills` call, asserting the `chunks` field is read unchanged across two runLoop round trips of the same turn | Fake facade + fake `RoutingSessionStateStore`, mirrors Feature 051's own integration test |
| Live smoke | On-domain prompt against a seeded local skill -> `<auto_skills>` present, within budget (AC1); off-domain prompt -> no block (AC2); a deleted-but-still-indexed skill's chunk is skipped, turn completes (AC3); a remote pack without opt-in never appears even when ranked highly, still Tier-1 listable + tool-loadable (AC4); a skill injected earlier in the session is not re-injected on a later turn (AC5) | `OPENCODE_CONFIG_DIR=~/.opencodedev` against the real solaris endpoints, per the approved plan's operating profile |

---

## Risks and mitigations

| Risk | Evidence | Mitigation |
| ---- | -------- | ---------- |
| **`Pipeline.run` revalidates skills only, not chunks** — Feature 050's runner performs its OWN agent revalidation on top of `Pipeline.run` because the pipeline's stage-9 revalidation only covers skills; a `skill_chunk` candidate whose PARENT skill was deleted needs the same treatment | `pipeline.ts:157` (skills-only revalidation, per the approved semantic-selection plan's `[GAP C1]` finding); mirrored precedent at `pipeline-runner.ts`'s existing agent-revalidation step | `runSkillChunks` performs its OWN post-pipeline revalidation: a chunk is only `revalidated:true` if its `parent_skill_id` still resolves live AND remains provenance-eligible — the exact pattern Feature 051 already established for agents, applied here to chunks |
| **Confidence floor miscalibrated in practice** — a floor set too loose injects marginal content every turn; too strict never injects anything, defeating the feature | ADR-0052 "Considered Options" (rejected: unconditional injection, rejected: fixed top-K) | Default is deliberately STRICT (`0.75`); the floor is operator-configurable per the CUE `#ScoreFloor` bound, and FR8's debug log surfaces scores so a miscalibrated floor is diagnosable without exposing chunk content |
| **Provenance stamping drifts from actual pack trust** — an operator could rename/relocate a pack such that `pack_ref` no longer matches the live URL | `skill/index.ts:222-227` (discovery re-runs on every boot/reconcile) | Provenance is re-stamped on every discovery pass, never persisted independently of the live `cfg.skills.urls`/`paths` config — a config change takes effect on the next discovery, there is no separate provenance store to go stale |
| **Session dedup set grows unbounded across a very long session** — every distinct injected skill name accumulates for the session's lifetime | `RoutingSessionState` is in-memory, per-process, cleared only at session end (`routing-state.ts:211-213`) | Bounded in practice by the number of DISTINCT local skills a project defines (typically small, tens not thousands); explicitly out of scope to cap further — the existing `RoutingSessionState` lifecycle (cleared with the session) is the only bound this feature relies on, matching Feature 051's own aggregate/consumption fields |
| **Latency** — a fourth concurrent surface added to the same `latencyBudgetMs` deadline three surfaces already share | `experimental.ts` `TOOL_SEARCH_DEFAULTS.latencyBudgetMs` (300ms, shared) | The fourth branch runs under the SAME `Effect.timeout` wrapping the whole fan-out (never a per-surface budget); a chunk surface still mid-flight at the deadline resolves to passthrough for that surface only, exactly as the other three already do |

---

## Validation checklist (plan complete when)

- [ ] A fourth `skill_chunks` retrieval branch runs in the SAME `Effect.all`
      fan-out, under the SAME deadline, keyed by the SAME per-turn memo (FR1)
- [ ] `skill_autoprime` composes with (never replaces) the Feature 051
      skills gate; either off skips the pass entirely (FR1)
- [ ] Only candidates at or above `score_floor` are ever considered; zero
      qualifying candidates is passthrough, never an empty-but-present list
      (FR2)
- [ ] `<auto_skills>` renders only via `OutputSpoolStore.resolve`; a
      dangling/superseded ref skips that one chunk silently (FR3)
- [ ] `max_skill_chunks`/`max_skill_tokens` are enforced at render and
      spent EXCLUSIVELY by this pass, never by Tier-1 listing (FR4)
- [ ] `Skill.Info`/`SkillDoc` carry provenance; Tier-2 injects local skills
      only, remote packs only with explicit per-pack opt-in; a remote pack
      without opt-in stays Tier-1 listable and tool-loadable (FR5)
- [ ] A skill fully injected once this session is not re-injected; the
      `skill` tool remains available regardless of dedup state (FR6)
- [ ] Per-turn memo semantics are IDENTICAL to Feature 051: computed once,
      read by every runLoop step, short follow-ups reuse the memo (FR7)
- [ ] Any failure on this path fails open with content-free observability,
      reusing Feature 051's one-warning-per-turn discipline (FR8)
- [ ] No change to Feature 050's index/data plane or Feature 051's three
      existing surfaces; every reused interface cited by exact file:line
      above

---

## Companion artifacts

| File | Purpose |
| ---- | ------- |
| [spec.md](spec.md) | FR1–FR8, acceptance scenarios, security requirements, observability |
| [tasks.md](tasks.md) | Dependency-ordered task breakdown |
| `doc/arch/schemas/auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass.cue` | `#AutoSkillConfig`, `#SkillProvenance`, `#AutoSkillChunkRef`, `#AutoSkillsBlock`, `#AutoSkillBudget` — the config/data shapes this plan implements |
| [ADR-0052](../../adr/0052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass.md) | The architecture decision (fourth-surface composition, confidence floor, provenance trust boundary, dedup) this plan executes |
