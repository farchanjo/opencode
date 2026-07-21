# Implementation Plan: Deterministic Orchestration Handoff Role To Agent Binding

Feature: 053-deterministic-orchestration-handoff-role-to-agent-binding
Spec: [spec.md](spec.md) (FR1–FR8, 7 acceptance scenarios)
CUE: [`deterministic-orchestration-handoff-role-to-agent-binding.cue`](../../schemas/deterministic-orchestration-handoff-role-to-agent-binding.cue)
ADR: [ADR-0053](../../adr/0053-deterministic-orchestration-handoff-role-to-agent-binding.md)
Dependencies:
[Feature 048 Add An Always-On Three-Tier Architect Manager Worker](../048-add-an-always-on-three-tier-architect-manager-worker/spec.md) (`force_manager`, `classifyChildRole`, `applyManagerPersona`),
[Feature 049 Wire The Hierarchy Dispatch Resolver Into The Live Task Tool](../049-wire-the-hierarchy-dispatch-resolver-into-the-live-task-tool/spec.md) (the live `hierarchyDispatch`/`TaskPromptOps` seam),
[Feature 051 Wire Live Per Turn Semantic Narrowing Of Agents Skills And](../051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and/spec.md) (`RetrievalFacade.retrieveAgents`, `RoutingSessionState`),
[ADR-0048](../../adr/0048-add-an-always-on-three-tier-architect-manager-worker.md), [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md).

---

## Overview

Feature 048 shipped `force_manager`: the Architect edge always classifies its
child `"manager"` (`routing-hierarchy.ts:341`), and `tool/task.ts` prepends a
fixed persona prelude (`applyManagerPersona`, `:142-145`) to whatever agent
the LLM named in `subagent_type`. Two gaps remain unaddressed by that shipped
behavior: no config exists to BIND the manager role to a specific agent
definition, and no deterministic reconnaissance/decomposition precedes the
Manager's own turn — the Manager currently has to plan from a raw task
string with no validated specialist catalog.

This feature (ORCH) closes both gaps with two independent, individually
gated additions to the SAME seam Feature 049 already wired: (1) three
optional `hierarchy.manager_agent`/`data_agent`/`composer_agent` config
leaves that override the spawned agent when the classified role is
`"manager"`, and (2) an always-on (when eligible) synchronous, in-binary
Data -> Composer interception inserted into `tool/task.ts`'s existing
manager-role branch, BEFORE `applyManagerPersona` runs, so the Manager
receives a validated, specialist-addressed brief instead of the raw
Architect task.

## Why synchronous sub-sessions, not a third delegation tier

`max_delegation_depth` is schema-capped at 2
(`packages/opencode/src/routing/domain/hierarchy-dispatcher.ts:35`,
`protocol/enforcement/leaves.ts:59`) = Architect(0) -> Manager(1) ->
Worker(2) exactly, enforced by the pure engine
(`HierarchyDispatcher.planDispatch`) and never widenable by config
(`routing-hierarchy.ts:557`, `Math.min(MAX_DELEGATION_DEPTH,
hierarchy.max_depth)`). Modeling Data/Composer as additional hierarchy
roles would either violate that invariant or force `classifyChildRole` to
special-case them away from the `max_workers` fan-out budget they would
otherwise contend with. Instead, both stages run through `TaskPromptOps`
(`ops.resolvePromptParts` + `ops.prompt`, `tool/task.ts:26-27`) — the SAME
reusable synchronous, in-binary sub-session primitive Feature 044's
background-Worker internals already use — over sessions created directly
via `Session.Service.create`, exactly mirroring the existing child-session
creation `tool/task.ts` already performs at `:336-352`, but WITHOUT
re-entering `TaskTool.execute` (no depth-ceiling walk, no
`HierarchyDispatcher.planDispatch` call, no fan-out admission check).

---

## Component breakdown

| # | Component | Path | Kind | FR |
| - | --------- | ---- | ---- | -- |
| 1 | `hierarchy.manager_agent`/`data_agent`/`composer_agent` schema leaves | `packages/schema/src/routing/config.ts` (EDIT — `Enforcement.hierarchy` gains three `Schema.optional(AgentName)` fields, mirroring the `orchestration_mode` precedent at `:108-114`), `doc/arch/schemas/routing/config.cue` (EDIT — `#RoutingEnforcement.hierarchy` gains the same three optional fields, mirroring the `orchestration_mode` comment/field pair at `:102-106`) | Domain (schema) | FR1 |
| 2 | Manager-agent binding resolution + degrade | `packages/opencode/src/tool/task.ts` (EDIT — a new `resolveManagerAgentBinding` helper, called where `next`/`resolvedAgent` is picked, `:236-238` and `:304-307`; validates via `Agent.Service.get`, rejects a resolved agent whose `Agent.Info.model` is set, degrades to `params.subagent_type` + one `Effect.logWarning` on any miss) | Application | FR1, FR7 |
| 3 | Interception orchestration module | `packages/opencode/src/tool/orchestration-handoff.ts` (NEW — `runInterception(deps, input): Effect<{promptOverride?: string; log: OrchestrationHandoffLog}>`; owns the Data-then-Composer sequencing, the per-stage deadline, and the degrade-to-`undefined` contract) | Application | FR2, FR4, FR7 |
| 4 | Synchronous sub-session creation | `orchestration-handoff.ts` (NEW — `spawnSyntheticSubSession` helper: `Session.Service.create({parentID: nextSession.id, agent: boundName, permission: deriveSubagentSessionPermission(...)})` then `RoutingState.markSynthetic` BEFORE `ops.resolvePromptParts`/`ops.prompt`, reusing `deriveSubagentSessionPermission` from `agent/subagent-permissions.ts` exactly as `tool/task.ts:312-315` already does) | Application | FR2, FR5 |
| 5 | `RoutingSessionState.synthetic` flag | `packages/opencode/src/session/routing-state.ts` (EDIT — `RoutingSessionState` gains `readonly synthetic: boolean`, default `false`; `RoutingSessionStateStore` gains `markSynthetic(sessionId)`; cleared with the rest of the state at the existing `clear`, mirroring the Feature 052 `autoSkillInjected` precedent) | Application | FR5 |
| 6 | Re-entrancy guard | `tool/task.ts` (EDIT — the interception call in `runTask` is gated on `hierarchyDispatch?.lineageStub.child_role === "manager" && hierarchyDispatch.forceManager && !store.get(ctx.sessionID).synthetic`, checked BEFORE any interception work begins) | Application | FR5 |
| 7 | Fresh Composer-catalog retrieval | `orchestration-handoff.ts` (NEW — calls `RetrievalFacade.retrieveAgents` with a request built from the Composer subtask's own text, explicitly bypassing `RoutingState.narrowedSets`; on `RetrievalError` or an empty result, falls open to `Agent.Service.listSpecialists()`) | Application | FR3 |
| 8 | Brief validation + repair | `packages/opencode/src/routing/application/brief-validator.ts` (NEW — pure function `validateBrief(brief, resolveSpecialist, rankedCatalog): {brief: ValidatedBrief; tally: BriefValidationTally}`; repairs an invalid name to the unambiguous highest-ranked valid specialist from the FR3 catalog when one exists, else flags the subtask) | Domain (pure) | FR6 |
| 9 | `applyManagerPersona` call-site wiring | `tool/task.ts` (EDIT — `runTask`, `:416-438`: when interception is eligible, run it BEFORE computing `promptText`; feed `promptOverride ?? params.prompt` into the EXISTING `applyManagerPersona(..., childRole, forceManager)` call unchanged) | Application | FR2, FR4 |
| 10 | Content-free observability | `packages/opencode/src/routing/application/telemetry-emitters.ts` (EDIT — new `emitOrchestrationHandoff(log: OrchestrationHandoffLog)`, gated by the existing `isTelemetryArmed()`, sibling to `emitOrchestrationWorker`/`emitFanoutAdmission`) | Application | FR8 |

No new package boundary, no new prompt-execution primitive, no new
delegation/budget concept — every "NEW" file is a small, focused module
beside an already-in-scope Feature 048/049/051 seam; the pure brief-repair
logic is isolated in its own file (component #8) precisely so it is
unit-testable without any Effect runtime or session fakes.

### Reuse contract (binding — no duplication)

1. **Sub-session execution**: `TaskPromptOps` (`ops.resolvePromptParts` +
   `ops.prompt`, `tool/task.ts:24-28`) is the ONLY prompt-execution primitive
   Data/Composer use — no second synchronous-turn API, no direct LLM client
   call.
2. **Session creation + permission derivation**: `Session.Service.create`
   and `deriveSubagentSessionPermission`
   (`agent/subagent-permissions.ts`) are reused EXACTLY as `tool/task.ts`'s
   existing child-spawn path (`:336-352`) already uses them — no second
   permission-derivation function.
3. **Agent resolution**: `Agent.Service.get` (binding validation, FR1) and
   `Agent.Service.resolveSpecialist`/`listSpecialists` (brief validation and
   fail-open catalog, FR3/FR6) are the registry's existing, canonical
   lookups — no second agent-identity source.
4. **Retrieval**: `RetrievalFacade.retrieveAgents` (Feature 006/050/051) is
   the ONLY retrieval call FR3 issues — a fresh request, never a second
   retrieval port or a bespoke Milvus client.
5. **Session-scoped state**: `RoutingSessionState`
   (`session/routing-state.ts`) hosts the new `synthetic` flag — no new
   cache/store, mirroring the exact extension pattern Feature 051
   (`narrowedSets`) and Feature 052 (`autoSkillInjected`) already
   established.
6. **Telemetry**: `routing/application/telemetry-emitters.ts` +
   `isTelemetryArmed()` is the ONLY observability path — no second logger,
   no new span-naming convention.
7. **Manager persona**: `applyManagerPersona`
   (`tool/task.ts:142-145`) is called UNCHANGED — this feature only changes
   WHAT is passed as its `prompt` argument, never the function itself.

---

## Interception flow (FR1–FR8)

```
tool/task.ts TaskTool.execute (existing, EDITED at two points):

  [Point A — agent resolution, before nextSession is created, ~:236-307]
  if hierarchyDispatch?.lineageStub.child_role == "manager"
     && hierarchyDispatch.forceManager
     && cfg.enforcement.hierarchy.manager_agent is set:
    bound = agent.get(manager_agent)
    if bound exists && bound.model is unset:
      next = bound                                                   [FR1]
    else:
      warn("manager_agent binding degraded"); next unchanged          [FR1, FR7]
  # else: next = agent.get(params.subagent_type), exactly as today

  [Point B — runTask(), before applyManagerPersona, :416-438]
  eligible = hierarchyDispatch?.lineageStub.child_role == "manager"
          && hierarchyDispatch.forceManager
          && !store.get(ctx.sessionID).synthetic                      [FR5]
  promptOverride = undefined
  if eligible:
    dataAgent = cfg.hierarchy.data_agent ?? "explore"
    composerAgent = cfg.hierarchy.composer_agent            # no default
    if composerAgent resolves (agent.get) && dataAgent resolves:      [FR7]
      dataSession = spawnSyntheticSubSession(dataAgent, parentID=nextSession.id)
      store.markSynthetic(dataSession.id)                             [FR5]
      dataResult = within deadline: ops.prompt(dataSession, recon-prompt(params.prompt))
      if dataResult ok:
        catalog = retrieveAgents(composerSubtaskText)                 [FR3]
                  .catch(-> agent.listSpecialists())                  [FR3]
        composerSession = spawnSyntheticSubSession(composerAgent, parentID=nextSession.id)
        store.markSynthetic(composerSession.id)                       [FR5]
        composerResult = within deadline: ops.prompt(composerSession,
          compose-prompt(params.prompt, dataResult, catalog))
        if composerResult ok:
          validated = validateBrief(composerResult, agent.resolveSpecialist, catalog) [FR6]
          promptOverride = render(validated.brief)                    [FR4]
          emitOrchestrationHandoff(log: stages=[data:ran, composer:ran],
            tally=validated.tally)                                    [FR8]
        else:
          warn(); emitOrchestrationHandoff(log: stages=[data:ran, composer:degraded]) [FR4, FR8]
      else:
        warn(); emitOrchestrationHandoff(log: stages=[data:degraded])  [FR4, FR8]
    else:
      emitOrchestrationHandoff(log: stages=[skipped per missing binding]) [FR7, FR8]
  else:
    emitOrchestrationHandoff(log: guard={eligible: false, synthetic: ...}) [FR8]

  promptText = applyManagerPersona(promptOverride ?? params.prompt,
    childRole, forceManager)                                          [existing, UNCHANGED]
```

Any exception anywhere in Point B resolves to `promptOverride = undefined`
(the raw prompt) and is absorbed into ONE `Effect.logWarning` per
interception attempt — no second warning path, no retry (FR4).

### Re-entrancy closure (FR5)

The `eligible` check at Point B reads `store.get(ctx.sessionID).synthetic`
— the flag on the CURRENT spawning session, checked BEFORE any interception
work begins. Every session `spawnSyntheticSubSession` creates is marked
`synthetic:true` immediately after `Session.Service.create` returns and
BEFORE `ops.prompt` runs, so even a same-tick nested `task` call from
within a Data/Composer sub-session's own turn observes the flag already
set. This is independent of `parentRoleForSpawn`'s session-seeding
heuristic (`routing-hierarchy.ts:300-303`) — the guard holds even if a
directly-created sub-session were somehow later classified `"manager"`
through an unrelated path.

---

## Sequencing

1. **Schema + binding first** — the three `hierarchy.*_agent` leaves
   (schema + CUE), `resolveManagerAgentBinding`'s validate/override/degrade
   logic at the agent-resolution seam (Point A). Independently
   unit-testable with a fake `Agent.Service` and plain config objects — no
   interception machinery needed yet.
2. **Interception scaffold** — `orchestration-handoff.ts`'s
   `runInterception` shape, `spawnSyntheticSubSession`, the
   `RoutingSessionState.synthetic` field + `markSynthetic`, and the
   re-entrancy guard at Point B — unit-tested with a fake `TaskPromptOps`
   and a fake `RoutingSessionStateStore`, asserting the guard blocks a
   simulated nested call before any stage runs.
3. **Data + Composer stages** — the actual Data-then-Composer sequencing,
   the FR3 fresh-retrieval-with-fail-open catalog call, and the per-stage
   deadline — unit-tested against a fake `RetrievalPort` and a fake
   `TaskPromptOps` returning scripted success/failure/timeout per stage.
4. **Brief validation** — `brief-validator.ts`'s pure `validateBrief`,
   unit-tested standalone with a fixed brief, a fake `resolveSpecialist`,
   and a fixed ranked catalog — no Effect runtime, no session fakes,
   mirroring how Feature 052 unit-tested its render pass independently of
   its retrieval pass.
5. **Call-site wiring + observability** — splice `runInterception`'s
   `promptOverride` into the EXISTING `applyManagerPersona` call (Point B),
   wire `emitOrchestrationHandoff`; golden byte-identical snapshot with all
   three bindings absent; live smoke per the Verification checklist below.

Each step is independently revertable: a regression in step 4 never
requires re-touching step 1/2, and step 5 requires no further code changes.

---

## Test strategy

| Layer | Scope | How |
| ----- | ----- | --- |
| Unit — binding resolution | `manager_agent` override applies only when `childRole == "manager" && forceManager`; an unknown/model-pinned binding degrades to `params.subagent_type` + exactly one warn, never a block; `data_agent` defaults to `"explore"`; `composer_agent` has no default and its absence is a `skipped` (not `degraded`) stage | Fake `Agent.Service`, plain `RoutingConfig.Enforcement.hierarchy` objects |
| Unit — re-entrancy guard | `eligible` is false whenever `synthetic == true`, regardless of `childRole`; a synthetic sub-session's own simulated nested spawn attempt never reaches stage execution; the guard is evaluated before ANY session is created for the interception | Fake `RoutingSessionStateStore`, a scripted nested-call harness |
| Unit — interception sequencing | Data always precedes Composer; Composer never runs if Data failed/timed out; each stage respects its own deadline independently; a Composer failure after a successful Data still degrades the WHOLE interception (no partial brief) | Fake `TaskPromptOps` with per-stage scripted outcomes, deterministic clock |
| Unit — fresh catalog retrieval | The catalog request text is the SUBTASK text, never the parent's `lastUser.id`-keyed memo; a retrieval failure or empty result falls open to `listSpecialists()`; the per-turn `RoutingState.narrowedSets` memo is never read or written by this call | Fake `RetrievalPort` + fake `RoutingSessionStateStore` asserting no memo access |
| Unit — brief validation | A valid name is untouched; an invalid name with an unambiguous top-ranked valid substitute is repaired; an invalid name with no unambiguous substitute is flagged, never dropped; a name valid in the registry but absent from the narrowed catalog is accepted (registry wins over catalog); the tally counts match the input exactly | Fixed brief, fake `resolveSpecialist`, fixed ranked catalog — no fakes beyond that |
| Golden — disabled path | Byte-identical snapshot of a `force_manager` manager-role spawn's resolved agent AND prompt, with all three bindings absent, before and after this feature's changes | Reuses Feature 048's existing spawn-seam test harness |
| Integration — call site | The full Point A + Point B flow against a fake `Session.Service`/`TaskPromptOps`/`RetrievalPort`, asserting: the bound agent spawns, the composed brief (not the raw prompt) reaches `applyManagerPersona`, and the synthetic sessions are correctly parented under `nextSession.id` | Fake service layer, mirrors Feature 049's existing live-seam consumption test (`test/tool/task.test.ts`) |
| Live smoke | `opencode-cli run "<delegating task>"` with all three bindings configured on `~/.opencodedev`: Architect -> explore recon -> composer brief with only valid reranked names -> manager-router receives the brief (not raw text) -> Workers execute (AC1); kill Data mid-run -> Manager still receives the raw prompt (AC2); re-entrancy falsifiable via the FR8 log (AC3); a hallucinated specialist name is repaired/flagged (AC4/AC5); no depth/budget rejection at `max_delegation_depth: 2` (AC6); unbound config renders byte-identical (AC7) | `OPENCODE_CONFIG_DIR=~/.opencodedev` against the real solaris/profile agents, per the approved plan's operating profile |

---

## Risks and mitigations

| Risk | Evidence | Mitigation |
| ---- | -------- | ---------- |
| **A future engine change accidentally routes Data/Composer through `HierarchyDispatcher`** — if a later refactor moved the sub-session creation through `TaskTool.execute` instead of a direct `Session.Service.create` call, it would silently start consuming depth/fan-out budget | `hierarchy-dispatcher.ts:35` (`MAX_DELEGATION_DEPTH = 2`, schema-enforced); the plan's own "depth constraint" is design-blocking, not merely a note | The unit test suite (component #4/#7 in Test strategy) asserts, per stage, that `HierarchyDispatcher.planDispatch`/`store.recordDispatch` are NEVER invoked for a Data/Composer sub-session — a regression toward the delegation path is a red test, not a runtime surprise |
| **`composer_agent` has no default, so a partial binding (`manager_agent` set, `composer_agent` unset) silently degrades** | ADR-0053 "Consequences" (accepted trade-off) | FR8's stage log surfaces `skipped` specifically for the Composer stage (distinct from `degraded`), so the gap is diagnosable via the debug log rather than reading as an unexplained no-op |
| **Composer brief hallucinates a specialist name with an AMBIGUOUS best substitute** (two equally-ranked candidates) | FR6 defines repair as "unambiguous... else flag" — an ambiguous case has no defined winner | `validateBrief` treats a tie at the top rank as "no unambiguous substitute" and flags rather than guessing — covered by a dedicated unit test case (component #8 in Test strategy) |
| **Latency** — two extra synchronous LLM turns (Data, Composer) added before the Manager's own turn even starts, on every `force_manager` manager-role spawn with resolvable bindings | ADR-0053 "Consequences" (accepted, bounded by per-stage deadline) | Each stage runs under its OWN bounded deadline (not the turn's shared `latencyBudgetMs`, since this is a spawn-time synchronous call, not a per-turn narrowing pass); a slow stage degrades to the raw prompt rather than blocking indefinitely — no new retry compounds the latency |
| **Session bookkeeping leak** — Data/Composer sub-sessions accumulate `synthetic:true` entries in `RoutingSessionState` for a long-lived `opencode serve` process | Precedent: `hierarchyDispatch.store.clear(nextSession.id)` already runs on every spawn's terminal transition (`tool/task.ts` acquire/release block) | `store.clear` is called for the Data/Composer synthetic sessions on the SAME terminal path the Manager's own `nextSession` already uses — no new lifecycle hook, no separate cleanup timer |

---

## Validation checklist (plan complete when)

- [ ] `hierarchy.manager_agent`/`data_agent`/`composer_agent` are optional,
      default-absent leaves on `RoutingConfig.Enforcement.hierarchy`,
      mirroring the `orchestration_mode` precedent (FR1)
- [ ] A `manager_agent` override applies ONLY under `force_manager` +
      `childRole == "manager"`; an unresolved/model-pinned binding degrades
      to today's `subagent_type` spawn plus exactly one warn, never a block
      (FR1, FR7)
- [ ] Data and Composer run as synchronous, in-binary sub-sessions via the
      EXISTING `TaskPromptOps` primitive — never a delegation; neither
      consumes `max_delegation_depth` or `max_workers` (FR2)
- [ ] The Composer's catalog is a FRESH `retrieveAgents` call over the
      subtask text, never the per-turn memo; failure/empty falls open to
      `listSpecialists()` (FR3)
- [ ] A successful interception's composed brief becomes the input to the
      UNCHANGED `applyManagerPersona`; any stage failure degrades to the raw
      prompt with no new retry layer (FR4)
- [ ] Re-entrancy is closed via the `RoutingSessionState.synthetic` flag,
      checked before role classification is even consulted; zero nested
      interceptions is a falsifiable invariant (FR5)
- [ ] Brief validation runs against the FULL live registry
      (`resolveSpecialist`), never the narrowed catalog; repair is
      unambiguous-substitute-or-flag, never silent drop (FR6)
- [ ] With all three bindings absent, or `orchestration_mode` at
      `heuristic`, the rendered spawn is byte-identical to Feature 048's
      shipped behavior (FR7)
- [ ] Every interception attempt emits a content-free stage/tally record via
      the existing telemetry-emitter convention (FR8)
- [ ] No change to `HierarchyDispatcher`, `max_delegation_depth`,
      `max_workers`, or any Feature 048 `heuristic`-mode behavior; every
      reused interface cited by exact file:line above

---

## Companion artifacts

| File | Purpose |
| ---- | ------- |
| [spec.md](spec.md) | FR1–FR8, acceptance scenarios, security requirements, observability |
| [tasks.md](tasks.md) | Dependency-ordered task breakdown |
| `doc/arch/schemas/deterministic-orchestration-handoff-role-to-agent-binding.cue` | `#HierarchyHandoffBinding`, `#InterceptionOutcome`, `#ReentrancyGuardState`, `#OrchestrationHandoffLog`, `#BriefValidationTally` — the config/observability shapes this plan implements |
| [ADR-0053](../../adr/0053-deterministic-orchestration-handoff-role-to-agent-binding.md) | The architecture decision (synchronous sub-sessions over a third delegation tier, binding validation, re-entrancy closure, full-registry brief validation) this plan executes |
