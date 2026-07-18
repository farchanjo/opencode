---
status: accepted
date: 2026-07-18
deciders: [project maintainers]
---

# 0002 — Core Smart Agent Routing with hierarchical adaptive roles

## Context and Problem Statement

Feature 001 requires Smart Agent Routing to cover the native Task lifecycle,
deterministic authorization, tool capability gates, safe fallback, operator-only
management commands, and an adaptive orchestration hierarchy. Plugin research
records that public hooks do not guarantee dynamic model selection, complete
Task lifecycle coverage, or transactional fallback. Routing also needs the local
telemetry foundation defined by ADR-0001 and the lifecycle observation plane
defined by Feature 002 (Process Table, Event Bus, live panel).

A flat “one specialist per Task” model is insufficient for complex work: the
system must choose between a direct Worker path and a Manager-mediated fanout
path, keep orchestration roles free of project mutation, bound depth and
context, and expose hierarchy state for validation and observation—without
hardcoding model IDs.

## Decision Drivers

- Cover the complete native Task lifecycle and preserve canonical permissions.
- Keep hard-gate authority independent from consultative model recommendations.
- Avoid duplicate catalogs, runtimes, registries, lifecycle loops, and retry owners.
- Make manager mode, tool capabilities, fallback, and operator controls auditable.
- Support adaptive hierarchy: Architect, optional Manager, and Worker, with
  bounded depth, dynamic fanout under admission, and a clear validation chain.
- Keep role pools user-configurable; treat model identities as tier examples only.
- Align Process Table and live panel (Feature 002) with hierarchy role and
  validation status without mixing sessions.
- Make Todo a session-owned work authority for every goal-bearing Architect,
  Manager, and Worker path, with durable snapshot/version, completion gate, and
  rehydration independent of message prose.
- Keep Session UI hierarchical: direct children only in each Session view, while
  Process Table may retain the full authorized tree for control-plane scope.

## Decision Outcome

Chosen option: **Core Smart Agent Routing with hierarchical adaptive roles and
telemetry dependency**.

We choose **Smart Agent Routing in the OpenCode core, dependent on the telemetry
foundation in ADR-0001**, and not a plugin implementation. Routing uses a
confirmed hierarchical adaptive model:

### Hierarchy and roles

- The main context role is **Architect**, resolved from a user-configured role
  pool at the frontier/highest tier. Product policy MUST NOT hardcode model or
  provider names; users configure candidates for roles/pools such as
  `architect`, `manager`, `worker-fast-large`, `worker-fast-small`, or equivalent
  abstractions.
- **Architect** evaluates task size/complexity and selects a route:
  - **Small/bounded:** Architect calls a **Worker** directly; Worker executes;
    Architect validates.
  - **Complex/decomposable:** Architect calls a **Manager**; Manager decomposes
    into Workers; Manager validates each Worker result and the synthesis;
    Architect validates the Manager outcome.
- **Architect** and **Manager** are orchestration-only (manager-only): they plan,
  decompose, dispatch, validate, and report. They MUST NOT modify the project.
  **Workers** execute tools, mutations, and tests.
- Maximum initial depth is **Architect → Manager → Worker**. Manager MUST NOT
  create Manager. Worker MUST NOT create Worker. Architect MAY skip Manager and
  call Worker directly.

### Classification, route record, and router authority

- Architect classification combines **deterministic hard gates** with structured
  evaluation (domain count, independent work units, mutation/risk, ambiguity,
  context, expected tools, parallelism, security/migration/external effects).
- Router core validates the selected route and MAY reject an incompatible route.
  Hard gates remain authoritative; model recommenders are consultative among
  authorized candidates only.
- Every route decision records task class/complexity, confidence, reasons,
  selected path, role pool, budgets, and policy version.

### Fanout, escalation, and validation

- Manager requests fanout dynamically; the **admission controller** grants total
  or partial concurrency under global/root/provider/agent/cost/token limits.
  Dynamic request is never unbounded concurrency.
- Escalation: a direct Worker that discovers complexity returns
  escalation/evidence; Architect reclassifies and MAY create a Manager;
  evidence, OutputRefs, and process lineage are reused—no blind restart.
- Validation chain:
  - Direct: Worker result → Architect validation.
  - Complex: Worker result(s) → Manager validation/aggregation → Architect
    validation.
  - Worker failure/low confidence escalates to Manager/Architect; Manager failure
    escalates to Architect.

### Fallback floors, envelopes, and context bounds

- Role fallback floors: Architect MUST NOT fall below its minimum tier without
  authorization; Manager/Worker fallback only within eligible mutation-safe pools.
- Communication envelopes include goal, constraints, acceptance, permissions,
  Lang Lock, budget/deadline, and context/output refs. Returns include status,
  evidence, tests, changes, confidence, unresolved items, and usage.
- Context is bounded: Workers write to OutputSpool ([Feature 005](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)); Managers read with
  offset/limit; Architect receives syntheses/slices/refs, not complete outputs.
- **Context, Turn and Delegation Budget** is a named transversal policy (Feature
  001): hard maximums for turns, context/output size, workers/fanout, delegation
  depth, retrieval/rerank top_k, skill chunks, time/cost/token, retry/validation
  depth, and escalation thresholds. Hard maximums cannot be relaxed by models.
  Optimized paths: small Architect→Worker→Architect; complex Architect→Manager→
  parallel Workers→Manager synthesis→Architect validation. No free hierarchy chat;
  structured envelopes only; event wakes for blocked/escalation/terminal/
  validation_failed only; Todo without extra provider turn; lazy skills; spool
  refs; explicit budget exceeded. Numeric defaults remain clarification.
- Skills, agents, models, and effort remain separate dimensions. Manager MAY
  recommend Workers/skills/effort; Router validates.
- **Semantic retrieval** ([Feature 006](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md))
  is a Milvus-backed projection for agent/skill candidate discovery. AgentV2/
  Catalog/SkillV2/Permission remain authorities. Reranker improves relevance only;
  hard gates and Feature 001 ranking remain final. Embedding and reranker slots are
  operator-pinned Feature 007 bindings (ADR-0003); Architect/Manager/LLM MUST NOT
  select or silently substitute them. Fallback is catalog+lexical/rules when the
  index or pinned binding is unavailable — never automatic semantic model swap.

### Core reuse, telemetry, and Feature 002 dependency

- Candidate discovery and resolution reuse Catalog/ModelsDev, SessionRunnerModel,
  AgentV2, SkillV2, Permission/Policy, configuration, EventV2, Session,
  SessionRunner, and Task lifecycle authorities.
- Tool capabilities remain independently dimensioned (presence, calls-per-turn,
  same-turn emission, serial runner execution, parallel calls, continuation,
  multi-turn cycles). Serialization does not invent a missing model capability.
- Fallback is authorized by hard gates and classified by mutation boundary.
- Smart and routing management commands remain native operator-only through the
  Feature 007 Operator Control Plane (palette, slash, CLI, Settings adapters);
  not ToolRegistry, model tools, MCP, prompts, custom templates,
  `session.command`, plugins, skills, or transcripts. Native slash is intercepted
  before prompt admission; zero provider/model calls/tokens/cost by default.
  Mutations require operator principal, explicit scope, version/CAS, idempotency,
  and audit. Architect/Manager may recommend route/workers/skills/effort inside
  the execution envelope; they cannot mutate config/pools/budgets/endpoints/
  credentials. Budget mutation is Feature 007 control-plane only.
- Routing uses ADR-0001 local metrics/events and correlated telemetry. OTLP
  export remains asynchronous and never blocks the routing hot path.
- Hierarchy role, parent/root, delegation depth/path, fanout requested/granted,
  validation states, tokens/TTFT/tokens-s/cost/fallback/confidence are recorded
  for Event Bus/Process Table without high-cardinality IDs as metric labels.
- Feature 002 live panel MUST represent the Architect/Manager/Worker hierarchy
  with **direct-child Session UI** and full authorized tree only as internal
  Process Table projection, without mixing sessions.

### Session-owned Todo guard (confirmed)

- Every goal-bearing Session (Architect main context, Manager, Worker/agent/
  subagent, including simple tasks) owns **exactly one Todo aggregate**. Parent,
  child, and sibling Sessions never share a list.
- Before goal-bearing execution or dispatch, a non-empty Todo snapshot is
  required. A simple task uses one bounded item. An empty list cannot bypass the
  gate. While executable work remains, exactly one item is `in_progress`.
- Todo snapshot/version is durable outside message prose and compaction and is
  the authority of logical work. Prompt/context builders rehydrate snapshot and
  version after compaction, restart, resume/replay, and before the next turn.
  Textual summary cannot diverge from or replace the snapshot.
- Handoff/dispatch envelopes carry `TodoRef`, version, bounded authorized
  summary, and Lang Lock tag/version. Future schema includes stable item ID,
  objective, typed status/priority, owner Session/role, version/CAS,
  result/evidence/OutputRefs, aggregate outcome, and timestamps (final field
  details remain clarification).
- **Completion gate:** a Session/Task MUST NOT terminate as `completed` while
  required items are pending/in_progress, version mismatches, or a validation
  step is missing. The system records `todo.completion_blocked`. Failure/cancel
  preserves incomplete items and aggregate outcome/reason; it does not falsely
  convert them to completed.
- Parent Architect/Manager keep their own dispatch/validation Todo. They may
  observe child summary/ref/version/counts; when the operator opens a child
  Session, that Session's authorized list is visible. Parent model MUST NOT edit
  a child Todo. Worker completion does not complete Manager; Manager validates
  Workers/synthesizes and completes its Todo; Architect validates Manager or
  direct Worker and completes its own.
- Sibling isolation applies before API/event/projection. No cross-root/project
  leak. Native policy MUST eventually allow Todo tool/operation for all
  goal-bearing primary/agents/subagents; prompt-only is insufficient. Existing
  subagent `todowrite` denial is a migration gap, not the target policy.
- Process Table observes `todo_ref`/version/counts/consistency/outcome but does
  not execute or edit Todo. Todo does not schedule or cancel Tasks. Authority
  separation is absolute.
- UI of each Session displays its Todo, including child Sessions, and MUST NOT
  hide or clear incomplete durable Todo when idle. Completed retention/archive
  remains clarification. Feature 003: each executable scheduled occurrence owns
  its Todo. Feature 004: objective/item/progress/result/failure/handoff text
  follows Lang Lock; UI chrome does not. [Feature 005 OutputSpool](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) carries
  result/evidence/handoff via refs/slices, not full content.
- Todo events include initialized/updated/completed/completion_blocked/failed/
  cancelled/stale/rehydrated/handoff_attached plus compaction correlation. OTEL
  exports only enums/counts/buckets — no content or IDs as labels.

### Direct-child Session UI and full-tree internal control

- Process Table MAY retain the full authorized root tree for observation and
  control-plane scope.
- Each Session view (TUI, direct/mini, App) shows **only direct children** where
  `parent_session_id == current_session_id`. Main/Architect view shows only
  Managers or Workers called directly — never grandchildren or Workers nested
  under a Manager.
- Entering a Manager/Agent Session shows only that Session's direct children.
  Deeper descendants are lazy-loaded by level, never flattened into the main
  view. Mouse/click and keyboard navigation, back/breadcrumb preserve
  state/selection; breadcrumb allows Architect → Manager → Worker (exact
  responsive details remain clarification).
- Root-tree cancellation (Ctrl+C) still reaches all invisible descendants;
  visibility does not limit control scope. Permissions/questions from deeper
  descendants that escalate to root remain a control-plane exception and MUST
  NOT flatten cards into the main view.
- TUI, direct/mini, and App MUST converge semantically. Requirements that
  previously implied a full root tree in one Session render are superseded by
  direct-child-only Session views.

### Consequences

#### Positive

- Core routing covers native Task paths that plugin hooks cannot guarantee.
- Adaptive hierarchy matches small tasks (direct Worker) and complex work
  (Manager fanout) without unbounded depth or concurrency.
- Orchestration-only Architect/Manager roles prevent project mutation by
  planning contexts.
- Existing permissions, lifecycle, schemas, catalogs, and event identities remain
  the single source of authority.
- Hard gates prevent a model recommendation from bypassing authorization.
- Local telemetry can make decisions offline while exporting asynchronously.
- Process Table and live panel can show hierarchy and validation chain
  consistently, with direct-child UI that matches operator navigation depth.
- Session-owned Todo makes logical work durable, rehydratable, and completion-
  gated across both direct Worker and Manager paths.

#### Trade-offs and open questions

- Core integration requires explicit seams and an ADR-backed implementation plan.
- Classifier thresholds/weights, exact pool schema, direct-route defaults,
  Architect/Manager tool visibility, validation criteria, numeric Context/Turn/
  Delegation Budget defaults, escalation thresholds, and role fallback floor values
  remain open in Feature 001 clarification questions (they refine the hierarchy;
  they do not reopen it).
- ADR-0001 must be accepted or otherwise resolved before routing implementation
  relies on its telemetry contract. **This ADR remains proposed.**
- Feature 002 Process Table/panel, direct-child Session UI, and admission surfaces
  must align with hierarchy role, validation, Todo observation, effective budgets/
  consumption, wake reason, and (when active) retrieval/index job lifecycle before
  plan/implementation of observation UI.
- [Feature 005 OutputSpool/ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) owns definitive OutputRef contracts referenced
  by bounded-context requirements.
- [Feature 006](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
  owns Milvus projection/index and multilingual retrieval/rerank; it does not own
  hard gates or final route selection.
- Todo schema field details (CAS conflict, failure status model, archive/retention/
  reopen, operator completion override, quantitative limits) and exemption of
  pure social/no-goal chat plus hidden lifecycle agents remain clarification.
- Migrating legacy subagent `todowrite` denial to native goal-bearing Todo policy
  is an explicit compatibility gap until policy rollout.

## Considered Options

- **Core Smart Agent Routing with hierarchical adaptive roles** — selected because
  native lifecycle coverage, adaptive depth, orchestration-only roles, and
  Process Table alignment are required.
- **Core Smart Agent Routing without hierarchy (flat specialist only)** — rejected
  for complex/decomposable work: no Manager fanout, validation chain, or
  escalation reuse path.
- **Plugin-only routing** — rejected because public hooks do not guarantee full
  Task lifecycle, dynamic model selection, or transactional fallback.
- **`smart_task` replacement** — rejected because it would not preserve native
  Task semantics and would create a parallel lifecycle seam.
- **Hardcoded model IDs per role** — rejected; roles resolve from user-configured
  pools and canonical catalogs; model names are tier examples only.
- **Unbounded Manager/Worker recursion** — rejected; initial depth is Architect →
  Manager → Worker only.
- **Shared parent/child Todo list** — rejected; each Session owns exactly one
  Todo aggregate; observation of child refs/summaries is not co-ownership.
- **Flattened full-tree Session UI** — rejected for operator Session views;
  Process Table may keep the full authorized tree internally while Session views
  show direct children only.
- **Prompt-only Todo without durable snapshot/version** — rejected; snapshot and
  version are the work authority and must rehydrate after compaction/restart.
- **Process Table as Todo executor/editor** — rejected; observation only.
- **Minimal core seam with plugin policy** — retained as research context only;
  it is not the approved placement for this feature.

## Related

- Feature specification: [001 Smart Agent Routing and Telemetry Foundation](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Feature research: [001 hierarchical adaptive research](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/research.md)
- Depends on: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md) — proposed sole management authority for smart/routing/budget operator surfaces
- Research evidence: [Plugin systems research note](../research/plugin-systems.md)
- Related feature: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Related feature: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Related feature: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Related feature: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Related feature: [006 Semantic Agent and Skill Retrieval (Milvus)](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — fixed embedding/reranker bindings; projection only
- Related feature: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — management foundation including `semantic.*` binding commands; not runtime execution authority
- Related feature: [008 Complete MCP Client Tools and Resources Lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP sampling cannot bypass Smart routing/budgets; experimental flags default off
