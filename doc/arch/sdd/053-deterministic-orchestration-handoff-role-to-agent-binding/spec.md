---
id: 019f86df-31e0-7530-b1fd-120271e4dcac
number: 053
slug: deterministic-orchestration-handoff-role-to-agent-binding
status: draft
created_at: 2026-07-21T22:50:02.080742Z
---
# Feature Specification: Deterministic Orchestration Handoff Role To Agent Binding

Feature: 053-deterministic-orchestration-handoff-role-to-agent-binding
Created: 2026-07-21

## Problem

Feature 048 shipped the opt-in `force_manager` orchestration mode: under it,
the Architect edge always classifies its spawned child as `"manager"`
(`packages/opencode/src/session/routing-hierarchy.ts:341`,
`classifyChildRole`), and `tool/task.ts` prepends a fixed
`MANAGER_PERSONA_PRELUDE` (`:126-137`) to that spawn's prompt via
`applyManagerPersona` (`:142-145`, invoked at `:420-424`, immediately before
`ops.resolvePromptParts`/`ops.prompt`, `TaskPromptOps` `:26-27`) instructing
whichever agent the LLM happened to name in `subagent_type` to decompose the
Architect's task, dispatch Workers via `task`, and aggregate their results.

Two gaps remain. First, `force_manager` classifies the ROLE but never binds
the AGENT: `RoutingConfig.Enforcement.hierarchy`
(`packages/schema/src/routing/config.ts:108-114`) carries `max_depth`,
`orchestration_only`, and `orchestration_mode` only — an operator has no way
to guarantee a manager-role spawn actually runs a specific, purpose-built
agent definition rather than whatever name the model happened to write for
`subagent_type`. Second, the Manager persona prelude is a fixed instruction
string; the actual decomposition, specialist selection, and reconnaissance
are left entirely to the spawned LLM's own first-turn judgment, with no
reconnaissance pass and no validation that the specialist names it
eventually calls `task` with are real agents — a hallucinated
`subagent_type` fails only at that later Worker spawn, never at
brief-composition time.

`max_delegation_depth` is schema-capped at 2
(`packages/opencode/src/routing/domain/hierarchy-dispatcher.ts:35`,
`protocol/enforcement/leaves.ts:59` `{min:0,max:2}`) — Architect(0) ->
Manager(1) -> Worker(2) exactly, verified by the pure engine
(`HierarchyDispatcher.planDispatch`) and never overridable by config
(`routing-hierarchy.ts:557`, `Math.min(MAX_DELEGATION_DEPTH,
hierarchy.max_depth)`). This feature (ORCH, per the approved
semantic-selection + deterministic-orchestration plan, depends on Feature
051's live per-turn narrowing for its fresh specialist-catalog retrieval)
adds deterministic role-to-agent binding and a Data -> Composer handoff
pipeline entirely OUTSIDE that depth-2 legality graph: Data and Composer run
as synchronous, in-binary sub-sessions via the existing `TaskPromptOps`
primitive (`ops.resolvePromptParts` + `ops.prompt`), never as delegations,
so `max_delegation_depth` and `max_workers` are never consulted for either
stage.

## User Stories

- As an operator running `force_manager`, I want to bind the manager role to
  a specific agent definition (`hierarchy.manager_agent`), so that a
  manager-role spawn deterministically runs the persona I built for it
  instead of whatever `subagent_type` the LLM happened to choose.
- As an operator, I want the Architect's task automatically reconnoitered
  and decomposed into a validated, specialist-addressed brief BEFORE the
  Manager's own turn starts, so that the Manager spends its turn routing and
  aggregating, not re-deriving a plan from scratch.
- As an operator, I want the Composer's decomposition to draw on a live,
  semantically-ranked specialist catalog for the ACTUAL subtask (not a stale
  per-turn memo keyed to the Architect's own prompt), so that its routing
  suggestions are grounded in what is really available.
- As an operator, I want a Data or Composer failure to degrade to today's
  shipped `force_manager` behavior — never a blocked spawn, never a silent
  hang — so that enabling this feature never regresses reliability.
- As an operator, I want a hallucinated specialist name in the Composer's
  brief repaired or explicitly flagged, never silently dropped, so that a
  subtask is never lost to a naming mismatch.
- As an operator, I want this entire pipeline provably unable to re-trigger
  itself on its own internal Data/Composer turns, so that enabling it can
  never produce runaway nested orchestration.
- As an operator who has not configured any of the three new bindings, I
  want the rendered spawn to be byte-identical to Feature 048's shipped
  `force_manager` behavior, so that adopting this feature is a strictly
  additive, reversible step.

## Functional Requirements

1. **FR1 — `hierarchy.manager_agent` role-to-agent binding, with symmetric
   `data_agent`/`composer_agent`.** `RoutingConfig.Enforcement.hierarchy`
   (`packages/schema/src/routing/config.ts:108-114`;
   `doc/arch/schemas/routing/config.cue`'s `#RoutingEnforcement.hierarchy`)
   gains three OPTIONAL leaves — `manager_agent`, `data_agent`,
   `composer_agent` — mirroring the `orchestration_mode` precedent Feature
   048 already set in the same struct. When `force_manager` classifies a
   spawned child as `"manager"` (`classifyChildRole`,
   `routing-hierarchy.ts:341`), `tool/task.ts` resolves `manager_agent` with
   `Agent.Service.get` (`agent/agent.ts:65` — the SAME lookup already
   performed for every spawn's `subagent_type`) and, if it resolves AND
   carries no `Agent.Info.model` pin, OVERRIDES the spawn's agent to the
   bound name instead of the LLM-chosen `subagent_type`. This deliberately
   uses `agent.get`, NOT `resolveSpecialist` (`agent/agent.ts:77`), which
   unconditionally excludes hidden agents (`if (!found || found.hidden)
   return undefined`) and would reject the realistic binding targets
   (`manager-router`, `manager-composer` are hidden internal agents by
   design). An unknown, invalid, or model-pinned binding degrades to
   today's behavior (the LLM-chosen `subagent_type` spawns unchanged) plus
   exactly one content-free warn — NEVER a blocked spawn. `data_agent`
   defaults to the builtin `explore` read-only agent when absent;
   `composer_agent` has no default.
2. **FR2 — Always-on synchronous interception in the manager branch, BEFORE
   `applyManagerPersona`.** Inside `tool/task.ts`'s `runTask` closure
   (`:416-438`), when the interception is eligible (FR5, FR7), a NEW step
   runs immediately before `promptText = applyManagerPersona(...)`
   (`:420-424`): first Data (the bound `data_agent`), then Composer (the
   bound `composer_agent`), each as a SYNCHRONOUS, in-binary sub-session
   created via `sessions.create` and driven through the EXISTING
   `TaskPromptOps` (`ops.resolvePromptParts` + `ops.prompt`, `:26-27`) — the
   SAME reusable primitive Feature 044's background-Worker internals already
   use. Neither stage is a delegation: `HierarchyDispatcher.planDispatch`,
   `max_delegation_depth` (schema-capped at 2,
   `hierarchy-dispatcher.ts:35`), and `max_workers` are never consulted for
   either sub-session — they consume no depth edge and no fan-out budget.
3. **FR3 — Composer input: Architect intent + Data recon + a FRESH
   specialist catalog, fail-open.** The Composer's sub-session prompt
   combines the Architect's original task text (`params.prompt`), the
   Data sub-session's result text, and a specialist catalog obtained by
   calling `RetrievalFacade.retrieveAgents` with THIS subtask's own text —
   explicitly OUTSIDE the per-turn `RoutingState` memo (Feature 051's memo
   is keyed by the Architect's own `lastUser.id` and would rank the wrong
   text for a delegated subtask). Any retrieval failure, timeout, or empty
   result falls open to `Agent.Service.listSpecialists()` — the full
   non-hidden live registry — so the Composer is never handed an empty or
   missing catalog.
4. **FR4 — Composed brief becomes the Manager's `promptText`; failure
   degrades to the raw prompt; no new retry layer.** On success, the
   Composer's output REPLACES `params.prompt` as the input to
   `applyManagerPersona` — the Manager's persona prelude is still prepended
   exactly as today, but to the composed brief instead of the raw Architect
   task. A Data or Composer failure, a per-stage deadline expiry, or an
   unresolved required agent binding (FR1) collapses the WHOLE interception
   to `params.prompt` UNCHANGED (today's shipped `force_manager` input) plus
   one content-free warn. No new retry layer is introduced: each stage's own
   `ops.prompt` turn already carries the existing LLM-turn retry policy
   (`session/retry.ts`) internally; a slow/failed stage is a degrade, never
   a retried attempt.
5. **FR5 — Re-entrancy guard: `childRole === "manager"` AND not synthetic.**
   The interception fires ONLY when the spawn under evaluation classifies as
   `childRole === "manager"` (`routing-hierarchy.ts:341`) under
   `force_manager`, AND the CURRENT spawning session
   (`ctx.sessionID` in `tool/task.ts`) is not itself flagged synthetic. Every
   Data/Composer sub-session is stamped `synthetic:true` on the EXISTING
   `RoutingSessionState` store (`session/routing-state.ts` — the same store
   already carrying `narrowedSets`/`autoSkillInjected`) at creation, BEFORE
   its `ops.prompt` call runs, so a Data/Composer sub-session can never
   itself re-trigger the interception even if its own turn calls `task`
   again. The check is independent of `parentRoleForSpawn`'s session-seeding
   heuristic (`routing-hierarchy.ts:300-303`), so it holds even if a
   directly-created sub-session's own child were ever mis-seeded as
   `"architect"`. Invariant: zero nested interceptions, ever, across a run.
6. **FR6 — Brief validation against the FULL live registry; repair, not
   silent drop.** Every specialist name the Composer's brief names for a
   decomposed subtask is validated with `Agent.Service.resolveSpecialist`
   (`agent/agent.ts:77`) against the FULL live, non-hidden registry — NEVER
   the FR3 narrowed retrieval catalog, which is ranking/suggestion input
   only, so a semantic-recall miss can never hard-reject a genuinely valid
   specialist. An invalid (hallucinated or stale) name is REPAIRED by
   substituting the unambiguous highest-ranked valid specialist for that
   subtask when one exists; when no unambiguous repair exists, the subtask
   is FLAGGED in the brief for the Manager to route explicitly — a subtask
   is never silently dropped from the plan.
7. **FR7 — Gates: `force_manager` plus resolved bindings; byte-identical
   when unbound.** The interception is active ONLY when `orchestration_mode`
   resolves to `force_manager`
   (`orchestrationModeOf`, `schema/routing/config.ts:75-76`) AND the
   required agent bindings resolve for the stage being attempted (`explore`
   default suffices for Data; `composer_agent` must be explicitly bound —
   FR1). With `hierarchy.manager_agent`/`data_agent`/`composer_agent` all
   absent (the config default), OR with `orchestration_mode` at its
   `heuristic` default, this feature's interception code path never
   executes — the rendered spawn is BYTE-IDENTICAL to Feature 048's shipped
   behavior.
8. **FR8 — Content-free observability of interception stages.** Each
   attempted interception emits, per stage (Data, Composer): whether it ran,
   degraded, or was skipped, and its duration — content-free by
   construction (no subtask text, no recon/brief content, no agent output),
   mirroring the existing `emitOrchestrationWorker`/`emitFanoutAdmission`
   convention (`routing/application/telemetry-emitters.ts`, gated by
   `isTelemetryArmed()`). FR6's brief validation additionally emits a
   bounded tally (valid/repaired/flagged counts) — counts only, never
   specialist names or subtask text.

## Non-Goals

- Growing the visible Worker specialist library — this feature routes to
  whatever specialists already exist in the live registry; it adds no new
  agent definitions of its own beyond the profile-level `manager-router`/
  `manager-composer`/Data(`explore`) bindings an operator configures
  OUTSIDE this feature's guard scope (profile `agent/*.md` files are config
  artifacts, not code).
- Any TUI/desktop surface for configuring `manager_agent`/`data_agent`/
  `composer_agent` — this feature ships the config schema and the runtime
  binding/interception behavior only; an operator-facing editing surface
  (mirroring `protocol/enforcement/leaves.ts`'s registry, if ever extended
  to these three leaves) is out of scope here.
- Widening `max_delegation_depth`, `max_workers`, or any other
  `HierarchyDispatcher`/budget-engine invariant — Data and Composer are
  deliberately kept OUTSIDE the depth-2 legality graph (ADR-0053 "depth
  constraint"); this feature makes no change to
  `packages/opencode/src/routing/domain/hierarchy-dispatcher.ts` or
  `packages/schema/src/routing/budget.ts`.
- A new retry layer for Data/Composer sub-sessions — both stages inherit
  the existing LLM-turn retry policy (`session/retry.ts`) internally; FR4
  adds only a per-stage deadline and a degrade-to-raw-prompt fallback.
- Changing `classifyChildRole`'s heuristic-mode behavior, `applyManagerPersona`'s
  persona-prelude text, or any Feature 048 behavior when `orchestration_mode`
  is `heuristic` (the default) — this feature is additive to `force_manager`
  only.
- Any change to Feature 051's live per-turn narrowing (`narrowForTurn`,
  `NarrowedSets`, the `RoutingState` per-turn memo) — FR3's Composer-catalog
  retrieval is a FRESH, one-off `retrieveAgents` call outside that memo,
  never a modification to it.

## Security Requirements

- **Data sensitivity/classification.** This feature's new runtime data is:
  the operator-configured agent-name bindings (`manager_agent`/
  `data_agent`/`composer_agent` — plain agent identifiers, no secrets); the
  Data sub-session's recon text and the Composer's composed brief, both of
  which are ORDINARY task-prompt-derived content flowing through the SAME
  `ops.prompt`/session-message plane every other subagent turn already uses
  (no new content-sensitivity class); and the FR8 observability record,
  which is content-free by construction (ids/enums/durations/counts only,
  never subtask text, agent output, or brief content). No new persisted
  storage — the `synthetic` flag lives in the existing in-memory, per-process
  `RoutingSessionState` (`session/routing-state.ts`), cleared with the rest
  of the session state at the existing `clear`.
- **Authentication/authorization.** No new authenticated end-user surface.
  Data and Composer sub-sessions are created with permission DERIVED via the
  SAME `deriveSubagentSessionPermission` helper `tool/task.ts` already
  applies to every subagent spawn (`agent/subagent-permissions.ts`), scoped
  to the bound agent's OWN `permission` ruleset (e.g. a read-only-light
  Composer persona never gains write/execute capability this feature does
  not already grant it via its own agent definition). This feature widens no
  permission boundary — it only decides WHICH bound agent's already-declared
  permission ruleset a manager-role spawn or its Data/Composer sub-sessions
  run under.
- **Input validation.** The Composer's brief is LLM-authored, untrusted
  output: FR6 is this feature's central validation control — every
  specialist name it cites is checked against the full live agent registry
  (`resolveSpecialist`) before the brief is ever handed to the Manager, with
  a defined repair-or-flag outcome rather than trusting the brief verbatim.
  FR1's binding resolution similarly validates `manager_agent`/
  `data_agent`/`composer_agent` against the live registry (`agent.get`)
  before ever overriding a spawn's agent — an invalid binding never reaches
  the spawn path.
- **Cryptography in transit/at rest.** No new network surface: Data and
  Composer sub-sessions run through the SAME `ops.prompt` LLM-call path
  (and therefore the SAME provider/auth/TLS handling) every subagent turn
  already uses. FR3's `retrieveAgents` call reuses Feature 050/051's
  existing Milvus/embedding/rerank transport composition verbatim — no new
  client, no new credential path.
- **Logging/audit.** FR8's observability is content-free by construction
  (stage result enums, durations, bounded valid/repaired/flagged counts —
  never subtask text, agent output, or specialist names), mirroring the
  existing `emitOrchestrationWorker`/`emitFanoutAdmission` convention
  exactly. A degrade emits at most one content-free warn per interception
  attempt, matching the one-warning-per-turn discipline Feature 051/052
  already established for their own fail-open paths.
- **Error-handling information exposure.** Every failure on this feature's
  path — an unresolved agent binding, a Data/Composer timeout or LLM-turn
  error, a retrieval failure — surfaces only as "degrade to the raw prompt"
  or "no override" plus a content-free warn; never a raw provider error, a
  stack trace, or brief/recon content, in any log line or the text the
  Manager or Architect ultimately sees.

## Acceptance Scenarios

Given `force_manager` is active, `manager_agent`/`data_agent`/
`composer_agent` are all bound to existing, unpinned, resolvable agents, and
an Architect task that genuinely warrants decomposition
When the Architect delegates the task
Then the spawn runs the bound `manager_agent` (not the LLM-chosen
`subagent_type`), a Data recon precedes a Composer brief containing only
valid specialist names, the Manager receives that composed brief (never the
raw Architect prompt) as its `applyManagerPersona`-wrapped input, and the
Workers it dispatches execute and report back to the Architect

Given the same configuration, but the Data sub-session is killed/fails
mid-run
When the Manager spawn proceeds
Then the Manager receives the raw Architect prompt (today's shipped
`force_manager` behavior), the interception logs a `degraded` outcome for
the Data stage, and no error is surfaced to the Architect

Given a Composer sub-session running as part of this feature's own
interception
When that sub-session's own turn attempts to call `task` in a way that would
otherwise classify as a manager-role spawn
Then the interception does NOT fire a second time — the synthetic flag
blocks it — and across the whole run zero nested interceptions are ever
observed (falsifiable via the FR8 stage log)

Given a Composer brief that names a hallucinated (non-existent) specialist
for one subtask, with an unambiguous valid substitute available
When the brief is validated
Then that subtask's specialist name is repaired to the substitute before the
Manager ever sees the brief, and the repair is reflected in the FR8 tally

Given the SAME hallucinated-name scenario, but with NO unambiguous valid
substitute available
When the brief is validated
Then that subtask is flagged in the brief for the Manager to route
explicitly — it is never silently dropped from the plan

Given `max_delegation_depth` is at its schema cap of 2 and a `force_manager`
Architect -> Manager -> Worker chain is in progress
When the Data and Composer sub-sessions run as part of this feature's
interception
Then neither sub-session is rejected for exceeding the delegation depth or
the `max_workers` fan-out budget — they were never evaluated against either

Given `hierarchy.manager_agent`/`data_agent`/`composer_agent` are all absent
(the config default)
When a `force_manager` Architect delegates a task before and after this
feature is deployed
Then the rendered Manager spawn and its prompt are BYTE-IDENTICAL to Feature
048's shipped behavior

## Observability

Per FR8, every attempted interception emits a content-free, per-spawn record
(`#OrchestrationHandoffLog`/`#InterceptionOutcome`, this feature's CUE
schema): the re-entrancy guard state that gated it, and — when eligible —
one stage outcome (ran/degraded/skipped, duration) each for Data and
Composer, plus a bounded valid/repaired/flagged tally from FR6's brief
validation. This reuses the existing `emitOrchestrationWorker`/
`emitFanoutAdmission` emitter convention (`routing/application/
telemetry-emitters.ts`), gated by the same `isTelemetryArmed()` guard so a
telemetry-off session allocates nothing extra. No new span names are
introduced; the interception is a child context of the existing
`hierarchy.dispatch`/`hierarchy.fanout` span family. Export telemetry via
OTLP from the application boundary; keep metric label sets bounded (stage,
result, gate-state enums — no subtask text, brief content, or agent output).
Conventions live in `doc/arch/observability/observability.md`.

## Related Features and Decisions

- [Feature 048 Add An Always-On Three-Tier Architect Manager Worker](../048-add-an-always-on-three-tier-architect-manager-worker/spec.md)
  — ships `force_manager`, `classifyChildRole`, `applyManagerPersona`, and
  `RoutingConfig.Enforcement.hierarchy.orchestration_mode`, all extended
  here, none modified.
- [Feature 049 Wire The Hierarchy Dispatch Resolver Into The Live Task Tool](../049-wire-the-hierarchy-dispatch-resolver-into-the-live-task-tool/spec.md)
  — the live `hierarchyDispatch`/`TaskPromptOps` seam in `tool/task.ts` this
  feature's interception is inserted into.
- [Feature 051 Wire Live Per Turn Semantic Narrowing Of Agents Skills And](../051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and/spec.md)
  — ships `RetrievalFacade.retrieveAgents` and the `RoutingSessionState`
  store this feature's FR3 fresh catalog retrieval and FR5 synthetic flag
  both reuse, unmodified.
- [Feature 052 Auto Skill Semantic Chunk Auto Priming Fourth Retrieval Pass](../052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass/spec.md)
  — the most recent precedent for the `RoutingSessionState` extension
  pattern (a new session-scoped field, cleared with the rest of the state at
  the existing `clear`) this feature's synthetic flag follows.
- [ADR-0048](../../adr/0048-add-an-always-on-three-tier-architect-manager-worker.md),
  [ADR-0051](../../adr/0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md)
  — the orchestration-mode and live-query architecture decisions this
  feature builds on without modifying.
- [ADR-0053](../../adr/0053-deterministic-orchestration-handoff-role-to-agent-binding.md)
  — this feature's own architecture decision record.

## Clarifications
