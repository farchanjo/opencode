# Tasks: Deterministic Orchestration Handoff Role To Agent Binding

## Task Breakdown

### Phase 1 — Schema + role-to-agent binding

- [x] T001 Add `manager_agent`, `data_agent`, `composer_agent` as optional
  `Schema.optional(AgentName)` fields to `RoutingConfig.Enforcement.hierarchy`
  in `packages/schema/src/routing/config.ts:108-114`, mirroring the
  `orchestration_mode` field the SAME struct already carries. Does NOT touch
  `max_depth`/`orchestration_only`/`orchestration_mode`.
- [x] T002 Add the mirrored optional fields to `#RoutingEnforcement.hierarchy`
  in `doc/arch/schemas/routing/config.cue:95-107`, per
  `#HierarchyHandoffBinding` in this feature's CUE schema (the CUE element
  documents the delta; this task performs the actual owning-struct edit).
- [x] T003 Add `resolveManagerAgentBinding(cfg, childRole, forceManager,
  agentGet): Effect<Agent.Info | undefined>` to
  `packages/opencode/src/tool/task.ts` (near `applyManagerPersona`, `:142`):
  returns the resolved bound agent only when `childRole === "manager" &&
  forceManager && hierarchy.manager_agent` resolves via `Agent.Service.get`
  AND its `Agent.Info.model` is unset; returns `undefined` (degrade) on any
  miss, emitting exactly one `Effect.logWarning` (FR1, FR7).
- [x] T004 Wire `resolveManagerAgentBinding` into the agent-resolution seam
  (`tool/task.ts:236-238` live path, `:304-307` default path): when it
  returns a bound agent, `next` = that agent instead of `agent.get(params.
  subagent_type)`; unchanged when it returns `undefined`.
- [x] T005 Unit tests
  (`packages/opencode/test/tool/task.test.ts`, extended): binding applies
  only under `force_manager` + `childRole === "manager"`; an unknown name,
  a model-pinned agent, and `force_manager` off/`childRole !== "manager"`
  all degrade to `params.subagent_type` unchanged with exactly one warn;
  never a blocked spawn. CUE schema validates (`speckit validate`).

### Phase 2 — Synchronous interception (Data -> Composer)

- [x] T006 Add `synthetic: boolean` (default `false`) to
  `RoutingSessionState` (`packages/opencode/src/session/routing-state.ts`,
  beside `autoSkillInjected`) and a `markSynthetic(sessionId)` store method;
  cleared with the rest of the state at the existing `clear` — no new store,
  no new lifecycle hook (FR5).
- [x] T007 Create `packages/opencode/src/tool/orchestration-handoff.ts`:
  `spawnSyntheticSubSession(deps, { parentSessionId, agentName, promptOps
  }): Effect<{ sessionId: SessionID; resultText: string }>` — creates a
  child session via `Session.Service.create` (permission derived via the
  EXISTING `deriveSubagentSessionPermission`, mirroring
  `tool/task.ts:312-315`), calls `store.markSynthetic(sessionId)`
  IMMEDIATELY after creation and BEFORE `ops.resolvePromptParts`/`ops.prompt`
  run, then awaits the synchronous turn (FR2, FR5).
- [x] T008 Add the re-entrancy guard as a pure predicate
  `interceptionEligible(childRole, forceManager, synthetic): boolean` in
  `orchestration-handoff.ts`, returning true only when `childRole ===
  "manager" && forceManager && !synthetic`; wired into `tool/task.ts`'s
  `runTask` closure (`:416`) BEFORE any interception work begins (FR5).
- [x] T009 Unit tests (`packages/opencode/test/tool/orchestration-handoff.test.ts`,
  NEW): `interceptionEligible` truth table (all four combinations of
  `childRole`/`forceManager`/`synthetic`); `spawnSyntheticSubSession` stamps
  `synthetic:true` BEFORE the fake `ops.prompt` is invoked (assert call
  order); a simulated nested `task` call from within a synthetic session
  never re-reaches `interceptionEligible === true`.
- [x] T010 Add `runInterception(deps, input): Effect<{ promptOverride?:
  string; log: OrchestrationHandoffLog }>` to `orchestration-handoff.ts`:
  sequences Data (bound `data_agent`, default `"explore"`) then, only if
  Data succeeds, Composer (bound `composer_agent`, no default); each stage
  wrapped in its own bounded deadline (`Effect.timeout`); a missing/
  unresolved required binding for the stage about to run yields a
  `"skipped"` stage outcome, never an attempted spawn (FR2, FR7).
- [x] T011 Unit tests (`orchestration-handoff.test.ts`, extended): Data
  always precedes Composer; Composer never runs if Data failed, timed out,
  or `data_agent` did not resolve; `composer_agent` absent yields a
  `"skipped"` Composer stage and the whole interception degrades; each
  stage's own deadline is independent (a fake clock proves Data timing out
  never starves Composer's own budget accounting).

### Phase 3 — Fresh catalog, brief validation, composed brief

- [x] T012 Add the fresh-catalog call to `runInterception`'s Composer stage:
  build a `RetrievalRequest` from the Composer subtask's OWN text and call
  `RetrievalFacade.retrieveAgents` directly — explicitly bypassing
  `RoutingSessionState.narrowedSets` (never read or written by this call);
  a `RetrievalError` or empty result falls open to
  `Agent.Service.listSpecialists()` (FR3).
- [x] T013 Unit tests (`orchestration-handoff.test.ts`, extended): the
  retrieval request text is the SUBTASK text, not the parent Architect's
  `lastUser.id`-memoized text; a fake `RoutingSessionStateStore` asserts
  `narrowedSets` is never touched by this call; a scripted retrieval
  failure and a scripted empty result both fall open to a fake
  `listSpecialists()`, never an empty/missing catalog reaching the Composer
  prompt.
- [x] T014 Create `packages/opencode/src/session/brief-validator.ts` (path
  deviates from `plan.md`'s `routing/application/brief-validator.ts` —
  `routing/application/` was in a concurrent agent's exclusive scope on this
  branch; the module boundary and pure-function contract are unchanged):
  pure `validateBrief(brief: string, deps: { resolveSpecialist, listSpecialists,
  ranked? }): { brief: string; repairs: readonly {from,to}[]; flagged:
  readonly string[] }` — for each subtask's cited specialist name,
  `resolveSpecialist` against the FULL live registry decides validity
  (never `deps.ranked`, which is ranking/repair input only); an invalid
  name with an unambiguous valid substitute (ranked order first, then
  case/hyphen-normalized fuzzy match against `listSpecialists`) is
  repaired; an invalid name with no unambiguous substitute (including a
  tie) is flagged inline (`[unassigned — route explicitly]`), never
  dropped (FR6).
- [x] T015 Unit tests
  (`packages/opencode/test/session/brief-validator.test.ts`, NEW): valid
  name untouched; invalid name + unambiguous ranked substitute repaired;
  invalid name + unambiguous fuzzy substitute repaired without a ranked
  list; invalid name + no substitute (including a tie) flagged with the
  subtask preserved; a name valid in the registry but ABSENT from `ranked`
  is accepted (registry wins over catalog, per FR6's explicit precedence);
  mixed brief (valid + repaired + flagged); empty/no-name brief unchanged;
  free-text fallback convention tolerated; deterministic across repeated
  calls.
- [x] T016 Wire brief validation into `runInterception`: after a successful
  Composer stage, call `validateBrief` and render `ValidatedBrief` into the
  `promptOverride` string; a Composer failure or timeout skips validation
  entirely (no partial brief is ever rendered) (FR4, FR6).

### Phase 4 — Call-site wiring, observability, verification

- [x] T017 Edit `tool/task.ts`'s `runTask` closure (`:416-438`): call
  `runInterception` (gated by `interceptionEligible`, T008) BEFORE computing
  `promptText`; feed `promptOverride ?? params.prompt` into the EXISTING,
  UNCHANGED `applyManagerPersona(..., childRole, forceManager)` call. No
  second call to `applyManagerPersona` is introduced (FR2, FR4).
- [x] T018 Add `emitOrchestrationHandoff(log: OrchestrationHandoffLog)` to
  `packages/opencode/src/routing/application/telemetry-emitters.ts`, sibling
  to `emitOrchestrationWorker`/`emitFanoutAdmission`, gated by the existing
  `isTelemetryArmed()`; call it from `runInterception` for every attempt
  (including `guard.eligible === false`), content-free per FR8 (stage
  enums, durations, `BriefValidationTally` counts only — never subtask
  text, agent output, or specialist names).
- [x] T019 Unit test — observability content-freeness: assert the emitted
  `OrchestrationHandoffLog` payload for a scripted run contains no string
  field longer than a bounded enum/id length and no brief/recon text,
  mirroring the Feature 047 content-free emitter test convention.
- [x] T020 Golden — disabled path: byte-identical snapshot of a
  `force_manager` manager-role spawn's resolved agent AND rendered prompt,
  with all three `hierarchy.*_agent` bindings absent, before and after this
  feature's changes (FR7, mirrors Feature 048's own byte-identical
  precedent for `heuristic` mode).
- [x] T021 Integration test — full Point A + Point B flow
  (`packages/opencode/test/tool/task.test.ts`, extended): against a fake
  `Session.Service`/`TaskPromptOps`/`RetrievalPort`, assert the bound
  `manager_agent` spawns, Data and Composer sub-sessions are correctly
  parented under `nextSession.id`, the composed (not raw) brief reaches
  `applyManagerPersona`, and both synthetic sessions are released via
  `store.clear` on the same terminal path `nextSession` already uses.
- [ ] T022 Live smoke (`OPENCODE_CONFIG_DIR=~/.opencodedev`,
  `opencode-cli run "<delegating task>" --print-logs`): full-chain — bound
  `manager_agent` spawns, Data recon runs, Composer brief cites only valid
  reranked names, the Manager receives the brief (not raw text), Workers
  execute and report (AC1); kill Data mid-run -> Manager receives the raw
  prompt (AC2); assert via the FR8 log that zero nested interceptions occur
  across the run (AC3); a seeded hallucinated specialist name is
  repaired when an unambiguous substitute exists, and flagged when it does
  not (AC4/AC5); no depth/budget rejection is observed at
  `max_delegation_depth: 2` (AC6); unbound config renders byte-identical
  (AC7).
- [x] T023 Gates: `bun test test/tool/ test/routing/ test/session/` green;
  `bunx tsgo --noEmit -p packages/opencode/tsconfig.json` clean; `speckit
  validate --json` -> `ok:true`.

## Dependencies

- Composes with the shipped Feature 048 (`force_manager`,
  `classifyChildRole`, `applyManagerPersona`), Feature 049 (the live
  `hierarchyDispatch`/`TaskPromptOps` seam), and Feature 051
  (`RetrievalFacade.retrieveAgents`, `RoutingSessionState`) — none is
  modified beyond the additive `RoutingConfig.Enforcement.hierarchy` leaves
  (T001/T002) and the `RoutingSessionState.synthetic` field (T006), both
  precedented extension patterns.
- Touches the routing config schema (`schema/src/routing/config.ts` +
  `doc/arch/schemas/routing/config.cue`), the live spawn seam
  (`opencode/src/tool/task.ts`), a new interception module
  (`opencode/src/tool/orchestration-handoff.ts`), a new pure brief-validator
  module (`opencode/src/routing/application/brief-validator.ts`), the
  session state store (`opencode/src/session/routing-state.ts`), and the
  telemetry emitters (`opencode/src/routing/application/
  telemetry-emitters.ts`); adds no new package, no new delegation tier, no
  new prompt-execution primitive, no new budget constant.
- Profile-level agent definitions (`~/.opencodedev/agent/manager-router.md`,
  `manager-composer.md`, Data via the builtin `explore`) are config
  artifacts an operator binds via `hierarchy.manager_agent`/`data_agent`/
  `composer_agent` — outside this feature's guard scope, not touched by any
  task above.

## Invariants Preserved

- `HierarchyDispatcher.planDispatch`, `max_delegation_depth` (schema-capped
  at 2), and `max_workers` are NEVER consulted for a Data or Composer
  sub-session — both run through `Session.Service.create` +
  `TaskPromptOps` directly, never through `TaskTool.execute` (FR2).
- A `manager_agent`/`data_agent`/`composer_agent` binding is validated with
  `Agent.Service.get` (never `resolveSpecialist`, which excludes hidden
  agents by design); an unresolved or model-pinned binding degrades to
  today's shipped spawn, never a blocked spawn (FR1).
- The re-entrancy guard (`interceptionEligible`) is evaluated BEFORE any
  session is created for the interception, and every Data/Composer
  sub-session is stamped `synthetic:true` before its own turn runs — zero
  nested interceptions is a falsifiable, structurally-enforced invariant,
  never merely a statistical unlikelihood (FR5).
- The Composer's specialist catalog is a FRESH retrieval over the subtask
  text, never the parent turn's per-turn `RoutingState` memo; a retrieval
  failure or empty result falls open to the full non-hidden registry,
  never an empty catalog (FR3).
- Brief validation is against the FULL live registry
  (`resolveSpecialist`); the narrowed retrieval catalog is ranking/repair
  input only — a recall miss never hard-rejects a genuinely valid
  specialist, and an unrepairable hallucinated name is flagged, never
  silently dropped (FR6).
- Any Data/Composer failure, timeout, or unresolved binding degrades the
  WHOLE interception to the raw Architect prompt plus exactly one
  content-free warn; no new retry layer is introduced anywhere on this path
  (FR4).
- With all three `hierarchy.*_agent` bindings absent, or
  `orchestration_mode` at its `heuristic` default, every code path this
  feature adds is unreachable — the rendered spawn is byte-identical to
  Feature 048's shipped behavior (FR7).
- All observability is content-free by construction — stage-result enums,
  durations, and bounded valid/repaired/flagged counts only, never subtask
  text, agent output, brief content, or specialist names (FR8).
