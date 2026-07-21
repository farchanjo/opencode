---
status: proposed
date: 2026-07-21
deciders: [your-org]
consulted: []
informed: []
---

# Deterministic Orchestration Handoff Role To Agent Binding

## Context and Problem Statement

Feature 048 (ADR "add-an-always-on-three-tier-architect-manager-worker")
shipped the opt-in `force_manager` orchestration mode: under it, the
Architect edge always classifies its child as `"manager"`
(`packages/opencode/src/session/routing-hierarchy.ts:341`,
`classifyChildRole`), and `tool/task.ts` prepends a fixed
`MANAGER_PERSONA_PRELUDE` (`:126-137`) to that spawn's prompt via
`applyManagerPersona` (`:142-145`, invoked at `:420-424`) instructing
whichever agent the LLM happened to name in `subagent_type` to decompose the
Architect's task, dispatch Workers, and aggregate. Two gaps remain from that
shipped behavior:

1. **No role-to-agent binding.** `force_manager` classifies the ROLE
   (`"manager"`) but never chooses the AGENT — the LLM still picks
   `subagent_type` freely, so an operator has no way to guarantee that a
   manager-role spawn actually runs a specific, purpose-built agent
   definition (e.g. a hidden `manager-router` persona) rather than whatever
   name the model happened to write. `RoutingConfig.Enforcement.hierarchy`
   (`packages/schema/src/routing/config.ts:108-114`) carries `max_depth`,
   `orchestration_only`, and `orchestration_mode` only — no
   `manager_agent`/`data_agent`/`composer_agent` leaf exists today.
2. **No deterministic decomposition.** The Manager persona prelude is a
   fixed instruction string; the ACTUAL task decomposition, specialist
   selection, and reconnaissance are left entirely to the spawned LLM's own
   judgment on its first turn, with no reconnaissance pass and no validation
   that the specialist names it eventually calls `task` with are even real
   agents. A hallucinated `subagent_type` on a Worker dispatch fails only at
   that later spawn, not at brief-composition time.

Separately, `max_delegation_depth` is schema-capped at 2
(`packages/opencode/src/routing/domain/hierarchy-dispatcher.ts:35`,
`protocol/enforcement/leaves.ts:59` `{min:0,max:2}`) —
Architect(0) -> Manager(1) -> Worker(2) exactly. Any design that inserts
Data/Composer as additional DELEGATION tiers would either violate that
invariant or silently contend with the Manager's own `max_workers` fan-out
budget. This feature (ORCH, Feature 053, depends on Feature 051's live
per-turn narrowing) must add deterministic role-to-agent binding and a
Data -> Composer handoff pipeline WITHOUT touching the depth/budget engine
at all.

## Decision Drivers

- `max_delegation_depth` is a schema invariant
  (`hierarchy-dispatcher.ts:35`), not a per-feature tunable — Data and
  Composer must never consume a delegation edge, and must never contend with
  the Manager's own `max_workers` fan-out.
- The concrete seam is narrow and already identified:
  `tool/task.ts`'s `runTask` closure (`:416-438`) computes `promptText` via
  `applyManagerPersona` immediately before calling `ops.resolvePromptParts`
  + `ops.prompt` (`TaskPromptOps`, `:26-27`) — the SAME reusable
  synchronous sub-session primitive Data/Composer must use, so no second
  prompt-execution API is introduced.
- Every failure mode on this path — an unbound/invalid agent, a Data/
  Composer timeout, a hallucinated specialist name — must degrade to
  TODAY'S shipped `force_manager` behavior (raw prompt, LLM-chosen
  `subagent_type`) plus a content-free warn, never a blocked spawn and never
  a silently dropped subtask.
- Re-entrancy must be structurally impossible, not merely unlikely: a
  Composer-authored brief is itself LLM output and could, in principle,
  cause its own sub-session to call `task` again.
- The Composer's specialist catalog must never hard-exclude a genuinely
  valid specialist because it missed the top-K of a semantic rerank — the
  narrowed catalog (Feature 051/053's own fresh retrieval) is ranking input
  only; final legality is always the FULL live registry.
- Disabled/unbound configuration must remain BYTE-IDENTICAL to Feature 048's
  shipped `force_manager` behavior — this feature is additive, opt-in on top
  of an already-opt-in mode.

## Considered Options

- **Deterministic role-to-agent binding (`hierarchy.manager_agent` +
  optional `data_agent`/`composer_agent`) plus a synchronous, in-binary
  Data -> Composer interception inserted into `tool/task.ts`'s existing
  manager-role branch, gated on `force_manager` and guarded against
  re-entrancy via a `RoutingState` synthetic flag (chosen).** Zero change to
  the depth/budget engine; the composed brief becomes the Manager's
  `promptText` in place of the raw Architect prompt.
- **Model Data and Composer as additional hierarchy roles/delegation tiers
  inside the existing `HierarchyDispatcher` engine (extend
  `Enums.HierarchyRole` and `max_delegation_depth`).** Rejected: the depth
  cap is a deliberate, schema-enforced invariant
  (`hierarchy-dispatcher.ts:35`, ADR-0002) protecting the
  Architect -> Manager -> Worker legality graph and the fan-out admission
  math (`headroomFor`/`perWorkerReserve`, `budget-consume.ts`); widening it
  for two internal pipeline stages that are never independently spawnable,
  never fan out, and never appear in the Architect/Manager/Worker legality
  graph would be a much larger, invasive change for no behavioral gain over
  a synchronous sub-session call.
- **Run Data/Composer as ordinary `task`-tool delegations (real child
  sessions dispatched exactly like a Worker) rather than synchronous
  sub-sessions.** Rejected: this DOES consume a delegation edge and
  contends with `max_workers` (Feature 043's fan-out admission), and forces
  the Manager's classification (`classifyChildRole`) to somehow special-case
  "this child is secretly Data/Composer, not a real Worker" — the exact
  re-entrancy hazard this ADR closes structurally instead. `TaskPromptOps`
  (`ops.resolvePromptParts` + `ops.prompt`) already exists specifically as
  the reusable synchronous, in-binary sub-session primitive Feature 044's
  background-Worker path uses internally; reusing it introduces no new
  execution primitive.
- **Validate the Composer's brief only against the FR3 narrowed retrieval
  catalog, not the full registry.** Rejected: `retrieveAgents`'s ranking is
  a semantic approximation over a fresh, single-shot request — a genuinely
  valid specialist can miss the top-K for a given subtask's phrasing.
  Rejecting on catalog-membership alone would convert a harmless recall miss
  into a hard specialist-unavailable error; `resolveSpecialist`
  (`agent/agent.ts:77`) against the FULL live registry is the correct
  legality check, with the narrowed catalog feeding only ranking/repair
  preference.
- **Gate re-entrancy on hierarchy role alone (`childRole === "manager"`),
  with no synthetic marker.** Rejected: `classifyChildRole` (`:341`) forces
  every non-Architect parent's child to `"worker"` by construction
  (`:338`), so in practice a Data/Composer sub-session's own child would
  already be forced `worker`, not `manager` — but that guarantee depends on
  the sub-session being correctly SEEDED as a non-Architect parent, and a
  session created via direct `sessions.create()` (never through
  `handleSubtask`/the live spawn seam) has no recorded hierarchy role at
  all, defaulting via `parentRoleForSpawn` (`routing-hierarchy.ts:300-303`)
  to `"architect"` on a genuinely root-looking session — re-opening the
  whole delegation tree. An explicit `synthetic:true` stamp on every
  Data/Composer sub-session, checked BEFORE role classification even runs,
  removes this dependency on session-seeding correctness entirely.

## Decision Outcome

Chosen option: deterministic role-to-agent binding plus a synchronous,
in-binary Data -> Composer interception inserted into `tool/task.ts`'s
existing manager-role branch, both gated on `force_manager` and both
degrading to today's shipped behavior on any failure.

1. **Role-to-agent binding is config, not a new engine concept.**
   `RoutingConfig.Enforcement.hierarchy` gains three OPTIONAL leaves —
   `manager_agent`, `data_agent`, `composer_agent` — mirroring the
   `orchestration_mode` precedent Feature 048 already set in the same
   struct. `tool/task.ts` resolves and validates `manager_agent` with
   `agent.get` (the SAME lookup already used for every spawn) — deliberately
   NOT `resolveSpecialist` (`agent/agent.ts:77`), which unconditionally
   excludes hidden agents and would reject the realistic binding targets
   (`manager-router`, `manager-composer` are hidden by design). A binding
   that fails to resolve, or whose `Agent.Info.model` is set (a pinned model
   would silently override the hierarchy-routed Manager-tier model),
   degrades to today's LLM-chosen `subagent_type` plus one content-free
   warn — never a blocked spawn.
2. **The interception is a synchronous, in-binary pipeline, never a
   delegation tier.** Inserted into `tool/task.ts`'s `runTask` closure
   (`:416-438`) BEFORE `applyManagerPersona` computes `promptText`: Data
   (the bound `data_agent`, default the builtin `explore`) runs first via
   `sessions.create` + `TaskPromptOps.resolvePromptParts`/`.prompt`
   (`:26-27`), producing recon text; Composer (the bound `composer_agent`,
   no default) runs second over the same primitive, receiving the Architect
   intent, Data's recon, and a fresh specialist catalog. Neither stage
   touches `HierarchyDispatcher.planDispatch`, `max_delegation_depth`, or
   `max_workers` — they are ordinary synchronous LLM turns the SAME way a
   background Worker's internal turn already is.
3. **The Composer's catalog is a fresh, out-of-memo retrieval, fail-open to
   the full registry.** `RetrievalFacade.retrieveAgents` is called with the
   SUBTASK prompt (never the parent's per-turn `RoutingState` memo, which is
   keyed by the Architect's `lastUser.id` and would rank the wrong text);
   any retrieval failure or empty result falls open to
   `Agent.Service.listSpecialists()` — the full non-hidden registry — never
   an empty or missing catalog handed to the Composer.
4. **The composed brief replaces the raw prompt fed to `applyManagerPersona`;
   any stage failure degrades to the raw prompt.** Data or Composer failing,
   timing out under a per-stage deadline, or the required agent binding not
   resolving collapses the WHOLE interception to `params.prompt` unchanged
   (today's shipped `force_manager` input) plus one content-free warn — no
   new retry layer; each stage's own LLM turn already carries the existing
   `session/retry.ts` policy internally.
5. **Re-entrancy is closed structurally with a `RoutingState` flag, checked
   before role classification.** Every Data/Composer sub-session is stamped
   `synthetic:true` in the SAME `RoutingSessionState` store
   (`session/routing-state.ts`) that already carries `narrowedSets` and
   `autoSkillInjected`, BEFORE its `ops.prompt` call runs. The interception
   fires only when `childRole === "manager" && forceManager &&
   !store.get(ctx.sessionID).synthetic` — the synthetic check runs first and
   is independent of how the session's hierarchy role would otherwise be
   seeded, so it holds even if a Data/Composer sub-session's own child
   session were ever mis-seeded as `"architect"` by `parentRoleForSpawn`.
6. **Brief validation is against the FULL live registry; repair, not
   silent drop.** Every specialist name the Composer's brief cites is
   checked with `Agent.Service.resolveSpecialist` (never the FR3 narrowed
   catalog, which is ranking/suggestion input only). An invalid name is
   replaced by the unambiguous highest-ranked valid specialist for that
   subtask when one exists; otherwise the subtask is flagged in the brief
   for the Manager to route explicitly — a hallucinated or stale name is
   NEVER silently dropped from the plan.
7. **Everything is inert unless `force_manager` is selected AND the
   required bindings resolve.** With `hierarchy.manager_agent`/
   `data_agent`/`composer_agent` all absent, or `orchestration_mode` at its
   `heuristic` default, this feature's code paths never execute — the
   rendered spawn is BYTE-IDENTICAL to Feature 048's shipped behavior.
8. **Observability is content-free and reuses the existing emitter
   convention.** Interception stage outcomes (ran/degraded/skipped,
   durations) and a bounded brief-validation tally (valid/repaired/flagged
   counts) are logged the same way `emitOrchestrationWorker`/
   `emitFanoutAdmission` already do (`routing/application/
   telemetry-emitters.ts`, gated by `isTelemetryArmed()`) — never subtask
   text, agent output, or brief content.

### Consequences

- Good: zero change to `HierarchyDispatcher`, `max_delegation_depth`, or
  `max_workers` — the depth/budget invariants Feature 001/043/048 already
  proved correct are untouched, so this feature carries none of their
  correctness risk forward.
- Good: the interception reuses `TaskPromptOps`, the exact synchronous
  sub-session primitive Feature 044's background-Worker internals already
  exercise — no new prompt-execution code path to independently verify.
- Good: the re-entrancy guard is checked BEFORE role classification and
  does not depend on `parentRoleForSpawn`'s session-seeding heuristic being
  correct for a directly-created session — it is structurally closed, not
  merely statistically unlikely.
- Good: brief validation against the full registry (never the narrowed
  catalog) means a semantic-recall miss can never hard-fail a genuinely
  valid specialist — the reranker stays advisory, exactly as ADR-0051
  established for the live query plane generally.
- Bad: `composer_agent` has no safe default (unlike `data_agent`, which
  falls back to the builtin `explore`) — an operator who enables
  `force_manager` and binds `manager_agent` without also binding
  `composer_agent` gets the degrade path (raw prompt) silently, which could
  read as "the feature isn't working" rather than "composer_agent is
  unset." Mitigated by FR8's stage-outcome log surfacing `skipped` for the
  composer stage specifically.
- Bad: the Data stage's recon and the Composer's decomposition both add
  real wall-clock latency to a manager-role spawn's FIRST turn (two extra
  synchronous LLM turns before the Manager persona even starts) — accepted
  as the cost of deterministic decomposition, bounded by each stage's own
  per-stage deadline so a slow stage degrades rather than hangs the turn.
- Bad: `manager_agent`/`data_agent`/`composer_agent` validation with
  `agent.get` (not `resolveSpecialist`) means a MISTYPED but structurally
  present agent name that happens to collide with an unrelated hidden
  internal agent (compaction/title/summary) would resolve as "found" and
  only fail later on model-pin validation or at runtime — an accepted,
  narrow edge case given the alternative (`resolveSpecialist`) would reject
  every legitimate hidden binding target outright.

## Related

- Depends on [ADR-0048 — Add An Always-On Three-Tier Architect Manager
  Worker](0048-add-an-always-on-three-tier-architect-manager-worker.md) for
  `force_manager`, `classifyChildRole`, and `applyManagerPersona`, all
  extended here, none modified.
- Depends on [ADR-0051 — Wire Live Per Turn Semantic Narrowing Of Agents
  Skills And](0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md)
  for `RetrievalFacade.retrieveAgents` and the `RoutingSessionState` store
  this feature's synthetic flag and fresh Composer-catalog retrieval both
  reuse.
- Extends [ADR-0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md),
  the origin of the Architect -> Manager -> Worker depth-2 legality graph,
  insofar as it deliberately keeps Data/Composer OUTSIDE that graph rather
  than widening it.
- Feature specification: [053 Deterministic Orchestration Handoff Role To
  Agent Binding](../sdd/053-deterministic-orchestration-handoff-role-to-agent-binding/spec.md).
- Companion CUE schema: `doc/arch/schemas/
  deterministic-orchestration-handoff-role-to-agent-binding.cue`
  (`#HierarchyHandoffBinding`, `#InterceptionOutcome`,
  `#ReentrancyGuardState`, `#OrchestrationHandoffLog`).
