# Smart Agent Routing Hierarchical Adaptive Research

Feature: [001 Smart Agent Routing and Telemetry Foundation](spec.md)

This note records confirmed decision evidence and current-core boundaries for the
hierarchical adaptive Smart Agent Routing design. It is not an ADR and does not
authorize implementation. Requirements live in `spec.md`; the architectural
decision is recorded in [ADR-0002](../../adr/0002-core-smart-agent-routing.md).

## Confirmed hierarchical adaptive decision (user-confirmed)

The following points are confirmed product decisions. They must not be reopened
as clarification questions.

1. **Main context role is Architect.** The primary context operates as the
   `Architect` role, selected from a user-configured role pool at the
   frontier/highest tier. Model names and provider IDs are never hardcoded in
   product policy; only role/pool abstractions are fixed by the feature.
2. **Adaptive route selection.** The Architect evaluates task size/complexity and
   chooses one of two initial paths:
   - **Direct Worker path (small/bounded):** Architect calls a Worker directly;
     the Worker executes; the Architect validates the Worker result.
   - **Manager path (complex/decomposable):** Architect calls a Manager; the
     Manager decomposes work into one or more Workers; the Manager validates each
     Worker result and the synthesis; the Architect validates the Manager outcome.
3. **Role pools are user-configurable.** Previously cited model identities are
   tier examples only. Users configure candidate sets for roles/pools such as
   `architect`, `manager`, `worker-fast-large`, `worker-fast-small`, or equivalent
   abstractions. The router resolves candidates from canonical catalogs against
   those pools.
4. **Orchestration-only roles.** Architect and Manager are orchestration-only
   (manager-only): they plan, decompose, dispatch, validate, and report. They
   MUST NOT modify the project. Workers execute tools, mutations, and tests.
5. **Maximum depth.** Initial depth is Architect → Manager → Worker. A Manager
   MUST NOT create another Manager. A Worker MUST NOT create another Worker.
   Architect MAY call a Worker directly, skipping Manager.
6. **Classification inputs.** Architect classification combines deterministic hard
   gates with structured evaluation signals: domain count, independent work units,
   mutation/risk, ambiguity, context size, expected tools, parallelism,
   security/migration/external effects. Router core validates the selected route
   and MAY reject an incompatible route.
7. **Route decision record.** Every route decision records task class/complexity,
   confidence, reasons, selected path, role pool, budgets, and policy version.
8. **Dynamic fanout under admission.** A Manager MAY request fanout dynamically,
   but the admission controller grants total or partial concurrency according to
   global, root, provider, agent, cost, and token limits. “As many as wanted” is
   a dynamic request, never unbounded concurrency.
9. **Escalation without blind restart.** A direct Worker that discovers complexity
   returns escalation evidence; the Architect reclassifies and MAY create a
   Manager. Evidence, OutputRefs, and process lineage are reused; the system MUST
   NOT discard usable work and restart blindly.
10. **Validation chain.**
    - Direct path: Worker result → Architect validation.
    - Complex path: Worker result(s) → Manager validation/aggregation → Architect
      validation.
    - Worker failure or low confidence escalates to Manager (when present) or
      Architect; Manager failure escalates to Architect.
11. **Role fallback floors.** Architect MUST NOT fall below its configured minimum
    tier without explicit authorization. Manager and Worker fallback MAY occur only
    within eligible, mutation-safe pools.
12. **Communication envelopes.** Dispatch envelopes include goal, constraints,
    acceptance criteria, permissions, Lang Lock, budget/deadline, and
    context/output refs. Returns include status, evidence, tests, changes,
    confidence, unresolved items, and usage.
13. **Bounded context.** Workers write to OutputSpool ([Feature 005](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)); Managers read with
    offset/limit; Architect receives syntheses, slices, and refs—not complete
    Worker outputs by default.
    13a. **Context, Turn and Delegation Budget.** Named transversal policy with hard
    maximums (turns, context/output tokens/bytes, workers/fanout, delegation depth,
    retrieval/rerank top_k, skill chunks, time/cost/token, retry/validation depth,
    escalation thresholds). Optimized small/complex paths; no free hierarchy chat;
    Todo without extra provider turn; event wakes only for blocked/escalation/
    terminal/validation_failed; lazy skills; spool refs; explicit budget exceeded.
    Numeric defaults remain clarification. Feature 006 consumes retrieval budgets only.
14. **Separate dimensions.** Skills, agents, models, and effort remain separate
    typed dimensions. A Manager MAY recommend Workers, skills, and effort; the
    Router validates recommendations against hard gates and catalogs.
15. **Telemetry and Process Table.** Hierarchy role, parent/root, delegation
    depth/path, fanout requested/granted, validation states, tokens, TTFT,
    tokens/s, cost, fallback, and confidence are recorded. High-cardinality IDs
    MUST NOT become metric labels (Feature 001/ADR-0001 cardinality rules).
16. **Feature 002 live panel alignment.** The live Process Table panel MUST
    represent the Architect/Manager/Worker hierarchy without mixing sessions.
    Session views show direct children only; Process Table may retain the full
    authorized tree. Mandatory session-owned Todo applies on both direct Worker
    and Manager paths with TodoRef/version in dispatch envelopes and completion
    gates in the validation chain.

## Open parameters (still clarification)

These parameters remain open and are listed in `spec.md` clarification questions.
They refine the confirmed hierarchy; they do not reopen it.

- Classifier thresholds and weights for hard gates versus structured signals.
- Exact role-pool names, schema, and configuration surface.
- Direct-route default policy when signals are borderline.
- Architect and Manager tool visibility (which read-only tools, if any, are
  permitted for orchestration without project mutation).
- Exact validation acceptance criteria and confidence floors.
- Numeric defaults for Context, Turn and Delegation Budget fields per scope/profile/role.
- Escalation thresholds that force reclassification from direct Worker to Manager.
- Role fallback floor values and authorization path for Architect floor breach.

## Current-core evidence boundaries

- Plugin hooks do not guarantee complete Task lifecycle, dynamic model selection,
  or transactional fallback; routing remains core (see
  [plugin systems research](../../research/plugin-systems.md)).
- Canonical authorities that routing must reuse include Catalog/ModelsDev,
  SessionRunnerModel, AgentV2, SkillV2, Permission/Policy, EventV2, Session,
  SessionRunner, and Task lifecycle—not a parallel runtime.
- Feature 002 defines the Task Lifecycle Event Bus and Process Table projection
  that will carry hierarchy role, delegation path, fanout, and validation state.
  Hierarchy observation is additive to that projection; it does not create a
  second lifecycle.
- [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) owns definitive OutputRef and spool contracts
  referenced by bounded-context requirements.
- Feature 004 Lang Lock is referenced by communication envelopes as a constraint
  dimension; exact Lang Lock semantics remain owned by Feature 004.
- [Feature 006](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) owns
  Milvus projection and multilingual agent/skill retrieval with operator-pinned
  embedding/reranker bindings (Feature 007); hard gates and final ranking remain Feature 001. Architect/Manager do not select semantic models.

## Feature 007 native-only control plane (factual cross-ref)

Operator setup/config/management for Smart, routing, telemetry, `budget.*`, and
`pools.*` is native-only via
[Feature 007 Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
and [ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)
(proposed). Feature 001 “Phase 2” labels domain surface delivery only; management
authority remains Feature 007 Phase 1. Vocabulary: **control plane** = operator
command/query/auth/audit adapters; **runtime data plane** = execution and session-owned
Todo work-item updates under permission/CAS (not setup policy mutation). This note does
not restate Feature 007 requirements.

## Related artifacts

- [Feature 001 specification](spec.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- [Plugin systems research](../../research/plugin-systems.md)
