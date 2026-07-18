---
id: 019f6938-d2b8-78d2-afbd-377f2d525585
number: 001
slug: define-one-cohesive-smart-agent-routing-and-opentelemetry
status: implemented
created_at: 2026-07-16T04:39:19.48035Z
---

# Feature Specification: Smart Agent Routing and Telemetry Foundation

Feature: 001-define-one-cohesive-smart-agent-routing-and-opentelemetry
Created: 2026-07-16
Scope: one feature, delivered in dependent phases; telemetry foundation precedes routing.

## Scope and intent

This feature specifies a core OpenCode capability, not a plugin. Phase 1 provides
local-first OpenTelemetry instrumentation and persistent OTLP configuration. Phase
2 adds Smart Agent Routing on top of that telemetry foundation. The phases are
specified together because routing decisions require durable, privacy-safe,
reproducible evidence, while telemetry must observe routing and execution without
blocking either path.

The plugin research note is evidence only and remains non-authoritative:
[`doc/arch/research/plugin-systems.md`](../../research/plugin-systems.md). Its
confirmed limitation is that plugin hooks do not guarantee complete Task lifecycle,
dynamic model selection, or transactional fallback coverage. This feature therefore
places routing in core and does not authorize plugin replacement or `smart_task`.

**Approved scope decision.** Smart Agent Routing MUST be implemented in OpenCode
core, not as a plugin. This is a confirmed user decision, not a clarification
question. The rationale, consequences, ownership, and exact V1/V2 core seams MUST be
recorded in an ADR during the appropriate design phase before `plan` or
implementation begins; this specification does not substitute for that ADR.

**Approved hierarchical adaptive routing decision.** Smart Agent Routing MUST use a
confirmed hierarchical adaptive model recorded in ADR-0002 and
[`research.md`](research.md). The main context role is **Architect** (user-configured
role pool at frontier/highest tier; no hardcoded model IDs). Architect classifies
task size/complexity and selects either a direct **Worker** path (small/bounded) or a
**Manager** path (complex/decomposable). Architect and Manager are
orchestration-only; only Workers mutate the project. Maximum initial depth is
Architect → Manager → Worker. Role pools are user-configurable. Classifier
thresholds, pool schema details, direct-route defaults, tool visibility for
orchestration roles, validation criteria, fanout/budgets, escalation thresholds, and
fallback floors remain open clarification parameters that refine this decision; they
do not reopen it.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Telemetry foundation

- As a user, I want to enable or disable telemetry from Settings via Ctrl+P so that
  observability is controlled without editing files manually.
- As a user, I want global and project-scoped OTLP settings to persist with validated
  precedence so that the same project behaves consistently across sessions.
- As a user, I want export to remain asynchronous, bounded, and offline-tolerant so
  that telemetry cannot block or break prompts, routing, or execution.
- As an operator, I want correlated traces, structured logs, and bounded metrics so
  that a routing outcome can be investigated from session through tools and fallback.
- As a privacy-conscious user, I want redaction and secure secret references so that
  prompts, secrets, personal paths, and tool payloads are not exported by default.

### P1 — Routing correctness

- As a user, I want Smart Agent Routing in core so that every native Task lifecycle
  path receives the same routing and fallback guarantees.
- As a user, I want hard gates to be authoritative and the model decisor to recommend
  only among authorized candidates so that policy and permissions cannot be bypassed.
- As a user, I want routing to choose a specialist agent and then an executor model,
  including skills and effort dimensions, so that the selected route matches the task.
- As a user, I want an explicit error when no authorized candidate exists so that an
  unsafe or impossible execution is never silently attempted.
- As a user, I want fallback to avoid blindly repeating mutating effects so that a
  failed route cannot duplicate external changes.

### P1 — Smart brain, Architect hierarchy, and manager mode

- As a user, I want the primary context to operate as **Architect** from a
  user-configured frontier/highest-tier role pool so that orchestration uses
  configurable candidates, never hardcoded model IDs.
- As a user, I want Architect to classify task size/complexity and choose a direct
  Worker path for small/bounded work, or a Manager path for complex/decomposable
  work, so that routing depth matches the task.
- As a user, I want Architect and Manager to remain orchestration-only so that only
  Workers execute tools, mutations, and tests against the project.
- As a user, I want a validation chain (Worker → Architect on the direct path;
  Worker → Manager → Architect on the complex path) so that results are checked at
  each hierarchy level before acceptance, including each role's session-owned Todo
  completion gate.
- As a user, I want every goal-bearing Architect, Manager, and Worker Session —
  including simple tasks — to keep its own mandatory Todo snapshot so that work
  cannot start empty, complete prematurely, or lose authority after compaction.
- As a user, I want escalation from a direct Worker that discovers complexity to
  reclassify into a Manager path while reusing evidence, OutputRefs, process
  lineage, and TodoRef/version so that work is not discarded by a blind restart.
- As a user, I want the contextual state to show `Smart` in the TUI when brain mode
  and Smart Routing are effectively active so that the active policy is clear in
  text as well as color.
- As a user, I want a degraded state to be visible when brain or routing is inactive
  so that the interface never claims that Smart mode is active incorrectly.

### P1 — Core and tool capability reuse

- As an operator, I want routing to reuse canonical catalogs, models, providers,
  agents, skills, permissions, policies, configuration, schemas, events, sessions,
  and runners so that one lifecycle remains authoritative.
- As a user, I want routing to know model/provider tool-call capabilities before
  execution so that incompatible Tasks are rejected or safely serialized before a
  mid-Task failure.
- As an operator, I want declared and observed tool capabilities to be versioned,
  scoped, expiring, and auditable so that learning does not turn one transient error
  into a permanent unsupported-model flag.

### P1 — Canonical command interface

- As a user, I want to manage Smart, routing, and telemetry through the native
  command palette, slash commands, CLI, and Settings so that every entry point has
  the same effective behavior.
- As an operator, I want status, explanation, dry-run, capability inspection, and
  telemetry test commands to be redacted, auditable, and safe so that management does
  not expose secrets or execute project effects accidentally.
- As a user, I want keyboard-only discoverability, autocomplete, help, and readable
  confirmations so that command management works without relying on color.

### P2 — Evidence and recovery

- As a user, I want routing decisions persisted and reproducible for resume, replay,
  background, and parent-child execution so that recovery does not silently change
  the selected route or permissions.
- As an operator, I want local metrics to improve routing progressively while external
  metrics provide only explicitly attributed priors or cold-start evidence so that
  offline operation remains useful and auditable.

## Functional Requirements

### Telemetry foundation (Phase 1)

1. The system MUST instrument application boundaries with OpenTelemetry and transport
   telemetry with OTLP.
2. Settings accessible through Ctrl+P MUST expose persistent global and project
   configuration for enablement, endpoint, OTLP HTTP/protobuf or gRPC transport,
   individual signal enablement, headers/auth references, TLS/certificates, timeout,
   batch, queue, sampling, privacy/redaction, and resource attributes.
3. Settings MUST validate configuration before activation and MUST expose status and a
   connection-test result without sending user content outside configured policy.
4. Secrets MUST be stored outside JSON/plaintext configuration and represented by a
   secure-storage reference or equivalent platform secret handle.
5. Export MUST be asynchronous and bounded by explicitly configured queue capacity,
   batch size, enqueue timeout, export timeout, and retry budget; no numeric defaults
   are approved by this specification. A full queue MUST apply the configured
   drop/backpressure policy, and MUST emit queue depth/capacity, enqueue outcome,
   drop reason, batch, retry, timeout, and exporter-error signals. Enqueue and
   export MUST NOT block or fail a prompt, routing decision, model request, tool
   call, or fallback, and measured overhead MUST be exposed and checked against the
   configured overhead budget.
6. The system MUST support metrics, structured logs, and traces/spans through the
   selected OpenTelemetry SDK/exporter capabilities. Profiling MUST be an optional
   capability: when the runtime and configured backend support it, profiles MUST be
   collected/exported with explicit status; when unsupported, profiling MUST be
   disabled with an observable reason and MUST NOT prevent other signals. OTLP MUST
   be used for signals for which the selected exporter supports OTLP; the design
   MUST NOT claim that every profiling backend uses OTLP. The design MUST be
   backend-agnostic, compatible with Alloy and an OpenTelemetry Collector where
   applicable, and MUST NOT depend on a Grafana UI or claim that Grafana stores
   signals.
7. Telemetry MUST correlate session -> turn -> routing -> decision model -> executor
   -> tools -> fallback, and MUST support session-level, global, and multi-session
   views.
8. The system MUST define conceptual spans named `routing.evaluate`,
   `decision_model`, `hard_gates`, `rank`, `task.execute`, `llm.request`,
   `tool.execute`, and `fallback`.
9. Telemetry MUST record, subject to redaction and bounded cardinality: input,
   output, reasoning, cache, and total tokens; cost; TTFT; stream duration; visible
   tokens/s; total duration; context and compaction; retries; fallback; rate limits;
   provider/model/variant; agent and skills; task class/profile/efforts; tools;
   concurrency/background; and result signals. Metric labels for status, task class,
   routing profile, effort, capability, and reason MUST use finite enums or bounded
   buckets. Provider, model, variant, and agent labels MUST be limited to active
   allowlisted IDs from the canonical catalog/registry under a configurable
   cardinality budget; values beyond that budget MUST map to `other` and increment a
   mapping counter. API family MUST be normalized. Detailed skills and dynamic IDs
   MUST be retained in traces/logs, while metrics use counts, buckets, or categories.
   Model-name analysis MAY use the model name in traces/logs or an approved bounded
   analysis path, but MUST NOT create open-ended metric cardinality.
10. Session and message identifiers MUST NOT be metric labels. They MUST be carried
    only as trace data, links, or opaque attributes with configured retention. Metric
    labels MUST use normalized API-family values, finite status/task/profile/effort/
    capability/reason enums or buckets, and allowlisted active catalog/registry IDs
    for provider/model/variant/agent under a configurable budget; over-budget values
    MUST map to `other` with a counter. Skills and dynamic IDs belong in traces/logs,
    not metric labels.
11. The router MUST use a local cache or local metrics store on the hot path and MUST
    not query a remote telemetry backend per Task. All configured telemetry MUST still
    be exported asynchronously for analysis.
12. Offline operation MUST use cached configuration and local evidence, expose export
    degradation status, and resume export when transport becomes available. On
    shutdown, the exporter MUST stop accepting new records, attempt a bounded flush
    for the configured shutdown window, report flushed and discarded records, and
    terminate without delaying application shutdown beyond that window. Recovery
    after exporter, process, or transport failure MUST restore operation from valid
    local state without unbounded replay. Delivery behavior MUST follow the
    configured semantics supported by the exporter and backend; duplicate export
    attempts MUST be counted when detectable and correlation/deduplication MUST be
    best-effort rather than an end-to-end guarantee.

### Smart Agent Routing (Phase 2, dependent on Phase 1)

13. Smart Agent Routing MUST be implemented in OpenCode core, not as a plugin, and
    MUST cover every native Task lifecycle path, including internal registry lookup
    paths relevant to Task execution. This approved constraint requires an ADR for
    rationale, consequences, ownership, and V1/V2 seams before planning or
    implementation.
14. Routing MUST support strict and hybrid modes. Deterministic hard gates MUST be
    authoritative; a model decisor MAY recommend only among candidates that pass all
    gates. The final ranking and tie-break MUST be deterministic and auditable.
15. Routing MUST execute the two-stage pipeline: task -> specialist agent -> executor
    model. It MUST include skill selection and effort selection in the recorded route.
16. The system MUST keep `task_class`, `routing_profile`, `task_effort`,
    `reasoning_effort`, `provider_variant`, and budgets as separate typed concepts.
    It MUST NOT use an ambiguous field named only `effort` for these decisions.
17. The decision model MUST be selected deterministically, without recursion, from a
    configurable healthy pool. The system MUST support a policy that can avoid the
    decision-model call when a route is inequívoco/fast; the default policy remains
    open pending clarification.
18. Automatic fallback MUST select only candidates authorized by hard gates and MUST
    return an explicit error when the authorized candidate set is empty.
19. Fallback MUST classify the execution boundary as safe, retryable, or mutation-risky
    before retrying. It MUST NOT blindly repeat a mutating effect. Read-only and
    partial-response behavior MUST be governed by the clarification outcomes below.
20. Global and project routing configuration MUST be validated and MUST apply a
    documented precedence order without allowing project settings to elevate
    permissions.
21. Routing decisions MUST be persisted as versioned, immutable records containing
    normalized task and policy references, eligible candidates, hard-gate results,
    decision-model identity (if called), recommendation, deterministic ranking,
    selected agent/model/skills/efforts, budgets, catalog and policy versions,
    evidence references, authorization context, execution boundary, and fallback
    state sufficient for reproducible resume, replay, background, and parent-child
    execution without storing raw prompts by default.
22. The local routing-decision record MUST be persisted atomically and idempotently,
    with observable commit,
    duplicate, recovery, and corruption outcomes. Replaying or resuming MUST preserve
    authorization and MUST NOT elevate permissions or silently re-run a
    mutation-risky operation. A crash before commit MUST leave no usable partial
    decision; a crash after commit MUST permit exactly-once recovery of that local
    decision record. This guarantee applies to the routing record, not to OTLP
    delivery.
23. When an agent, skill, provider, model, variant, or policy catalog changes, the
    system MUST detect the version mismatch, retain the original immutable record,
    and either replay it under its recorded catalog or produce an explicit
    re-resolution outcome under the configured policy. It MUST expose catalog
    mismatch, unavailable candidate, and recovery outcomes for audit.
24. Tokens/s MUST be treated as one signal for fast tasks, alongside visible TTFT,
    time to useful result, total duration, success without retry, p95, cold/warm state,
    cost, and confidence/sample size.
25. External or internet metrics MAY be used only as a prior or cold-start input and
    MUST retain source, observation date, TTL, and confidence. Local telemetry MUST
    progressively take precedence. The system MUST function without network access.
26. The router MUST define “efficiency” as a compound observable signal including
    useful time, success, rework/corrections, cost, tokens, tools, tests, retries,
    and fallback. Weights and the exact formula are intentionally unresolved.

### Smart brain, Architect hierarchy, manager mode, and UI (Phase 2)

27. When brain mode and Smart Agent Routing are effectively active, the primary
    context MUST operate as the **Architect** role: it MUST plan, classify task
    size/complexity, negotiate intent and constraints with the router, select a
    direct Worker or Manager path, dispatch descendants, validate results according
    to the validation chain, and report outcomes. When orchestration-only
    (manager-only) policy is active, Architect and Manager MUST NOT directly execute
    project work; only Workers MAY execute tools, mutations, and tests.
28. The router MUST remain authoritative for hard gates. Architect, Manager, or
    brain MAY propose a route or request re-evaluation, but MUST NOT elevate
    permissions or select a prohibited candidate. Router core MUST validate the
    selected route and MAY reject an incompatible route.
29. Orchestration-only Architect/Manager behavior MUST reuse the existing
    PermissionV2, Policy, Session, Task, and runner lifecycle to enforce permissions
    and execution boundaries. It MUST NOT create a parallel runtime or bypass
    canonical authorization.
30. In the TUI prompt component (`packages/tui/src/component/prompt/index.tsx`,
    lines 1546–1577, inside the `<box>` at lines 1544–1584), the agent name is
    rendered by `Locale.titlecase(agent().name)` at line 1550. When brain mode and
    Smart Routing are effectively active, the contextual label in the location that
    currently displays `Build` (when the active agent is `build`) MUST display the
    exact text `Smart` in red (`theme.error`). The text MUST remain present in
    monochrome terminals and the color MUST NOT be the sole indicator. `Smart` is
    a contextual session policy/state, not a rename of the core `build` agent.
31. The TUI MUST NOT display `Smart` as active unless both brain mode and Smart
    Routing are active. A degraded or unavailable state MUST expose an observable
    reason and an explicit fallback visual; the exact fallback text remains open in
    clarification. The existing `auto` permission-mode meaning MUST NOT be changed
    to represent routing.
32. The Smart state MUST be exposed through accessible text and theme-aware styling,
    remain legible in high-contrast and monochrome terminals, and be reachable via
    the existing keyboard and command-palette interaction model without making color
    the only control or status channel.
33. Telemetry MUST correlate Architect classification, brain negotiation, route
    proposal, accepted or rejected recommendation, re-route, hierarchy role,
    delegation depth/path, fanout requested/granted, dispatched Manager/Worker,
    validation state at each level, and result with the existing
    session/turn/routing/execution hierarchy. High-cardinality IDs MUST NOT become
    metric labels.

### Canonical core reuse (Phase 2)

34. The decision model and executor MUST receive candidates only from the canonical
    `Catalog.Service`/`ModelsDev` and available provider/model resolution; routing
    MUST NOT invent a parallel candidate catalog.
35. Final model resolution MUST use `SessionRunnerModel`; agent resolution MUST use
    `AgentV2`; skill resolution MUST use `SkillV2`; and permission/policy checks MUST
    use the canonical existing authorities.
36. Routing MUST reuse existing global/project configuration and validated precedence,
    and existing Model, Provider, Agent, Skill, Session, and Event schemas without
    creating shadow configuration or schema identities.
37. Routing events MUST use EventV2, and execution MUST use the single existing
    SessionRunner/Task lifecycle. Routing MUST NOT create a parallel execution loop,
    `smart_task`, registry, credential/provider resolver, or event identity.
38. Retry and fallback MUST have one authority shared with the existing lifecycle;
    routing MUST NOT create a parallel retry controller or independently replay a
    mutating effect.
39. Routing decisions MUST reference canonical catalog, provider, model, variant,
    agent, skill, policy, schema, session, and event identities and versions needed
    for replay, without prescribing internal names as a public API beyond the
    constraints stated here.
40. The core-reuse constraints in FR34–FR39 MUST be treated as architectural
    restrictions whose rationale, consequences, ownership, and seams are recorded in
    the ADR required by the approved core-placement decision before planning or
    implementation.

### Tool-call capability and single-tool models (Phase 2)

41. Before execution, the router MUST resolve each candidate's provider/model tool
    capability from canonical core/provider metadata when available, distinguishing at
    least the following independent dimensions: tool calling absent or present; a
    known limit on calls emitted per assistant/provider turn, including a limit of one;
    multiple calls emitted in the same turn; runner execution of those calls
    serially; actual parallel tool-call support; continuation after a tool result;
    multi-turn tool-use cycles; and known per-turn or per-request limits. Hard gates
    MUST compare the Task requirement with every applicable dimension. Serializing
    execution changes runner scheduling only; it MUST NOT create a model/provider
    capability that is absent.
42. Routing MUST use canonical capability metadata first and MUST NOT create a
    parallel capability catalog. Validated global/project overrides and an observed
    capability overlay MAY refine it, but each overlay MUST include source,
    confidence, timestamp, TTL, and provider/model/variant/API scope.
43. A Task requiring a capability dimension that a candidate does not support MUST be
    hard-gated before execution. This includes tool calling presence, the required
    calls-per-turn limit, same-turn multiple-call emission, serial runner execution,
    actual parallel calls, continuation after tool results, and multi-turn tool-use
    cycles. A Task requiring only serial execution MAY use a runner that serializes
    permitted calls, but this MUST NOT be recorded as model/provider parallel support.
44. When capability metadata is absent or uncertain, the router MUST apply a
    conservative configurable policy. Probing MUST be safe and explicit when enabled
    and MUST NOT use a mutating tool as a probe.
45. Provider/model tool-use failures MUST be classified as typed, observable mismatch
    or another applicable error class. Auth, rate limit, network, and invalid-tool-
    schema errors MUST NOT be classified as single-tool capability evidence. One
    failure MUST NOT create a permanent capability flag; learning requires configured
    confidence, sample, expiry, and revalidation policy.
46. Automatic fallback MUST respect effect boundaries: before a mutating effect it MAY
    choose another authorized compatible candidate; after a mutating tool effect it
    MUST NOT blindly repeat the operation.
47. Routing MUST persist and telemeter declared versus observed values for each
    capability dimension, the serialization decision, mismatch classification,
    rejected candidate, fallback, provider/model/variant/API, and result with bounded
    cardinality. Unknown dimensions MUST remain unknown rather than being promoted to
    supported by serialization.

### Canonical command interface (Phase 2 — domain surfaces only)

**Phase note.** “Phase 2” in this section and elsewhere in Feature 001 refers to
**domain surface delivery** for Smart, routing, telemetry, budget, and pools
operator-facing operations. **Management authority** remains Feature 007 Phase 1
Operator Control Plane foundation; Feature 001 Phase 2 does not redefine or replace
that authority.

**Normative transversal rule (Feature 007 Operator Control Plane).** All setup,
configuration, and management for Smart, routing, telemetry, budget, and pools MUST use
[Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
unified Operator Control Plane and native Settings/menu/palette/native-slash/CLI/App/
Desktop adapters calling typed core domain commands/queries directly. MUST NOT use
Config.command/custom templates, `session.command` prompt path, ToolRegistry, MCP
tools/prompts, plugins, skills, shell commands issued by an LLM, or free-form model
instructions as management authority. Native slash is intercepted before prompt
admission/transcript; zero provider/model calls/tokens/cost by default; output not
added to Message/Part/context by default. Mutations require operator principal,
explicit scope, version/CAS, idempotency, and audit; secret refs only.
Architect/Manager may recommend runtime route/workers/skills/effort inside the
execution envelope; they MUST NOT mutate config/pools/budgets/endpoints/credentials/
index/job definitions/Lang Lock/retention/quota. LLM receives effective read-only
policy/config in the trusted execution envelope; it MUST NOT call admin commands to
query or set. Budget and pool mutation MUST occur only via Feature 007 `budget.*` and
`pools.*` operations. Plugin/MCP/custom registries MUST NOT register reserved operator
IDs. The Feature 007 registry generates aliases/syntax; clients MUST NOT hardcode
divergent names.

48. Management MUST be exposed through the Feature 007 operator command registry and
    native TUI command palette opened by Ctrl+P, native slash commands, and the
    yargs/effectCmd CLI. App/Desktop MUST use their canonical command context when in
    scope. No parallel command registry is permitted. Every Smart, routing, telemetry,
    budget, and pools command in this feature is a native operator-only interface, never
    an interface for an LLM, brain, specialist, or tool. Canonical IDs follow Feature
    007 domains: `smart.*`, `routing.*`, `telemetry.*`, `budget.*`, `pools.*`.
49. Palette, slash, CLI, and Settings MUST invoke the same domain operations and
    share validation, persistence, global/project/session precedence, and canonical
    events. Entry points MUST NOT contain divergent management logic. Custom prompt or
    template commands MUST NOT administer Smart, routing, or telemetry. Palette, slash,
    and CLI input MUST be parsed and dispatched locally before any prompt admission or
    model interaction.
50. The Smart surface MUST provide `smart status`, `smart on`, `smart off`, and
    `smart auto` in palette and slash forms, plus `opencode smart ...` in the CLI.
    `smart auto` MUST be textually distinguished from the existing permission-mode
    `auto`; final syntax and aliases remain subject to clarification.
51. The routing surface MUST provide `routing status`, `routing explain`,
    `routing test`, and `routing capability inspect` in the native surfaces and
    corresponding CLI command tree. Capability inspection MUST show redacted declared
    and observed single-tool capability metadata.
52. `routing test` MUST be a dry run with respect to tools and mutations. It MUST
    be a deterministic local simulation of the baseline route using persisted state,
    canonical metadata, hard gates, and configured scoring inputs. The baseline MUST
    call neither a decision model nor an executor/provider model, consume zero model
    tokens, and incur zero model cost. It MUST report that no external model call was
    made and MUST never execute a tool or mutation. A future provider/model diagnostic
    MUST use a separate explicitly named command with explicit consent and cost, and
    MUST NOT be confused with this native test.
53. The telemetry surface MUST provide `telemetry status`, `telemetry on`,
    `telemetry off`, `telemetry test`, `telemetry show`, and `telemetry configure`.
    `telemetry configure` MUST open the same persistent Settings flow and MUST NOT
    accept raw secrets in a prompt or slash argument. `telemetry test` MUST either
    emit a clearly marked test signal or validate connectivity according to an
    explicitly selected mode. `telemetry show` MUST always redact sensitive values.
    `telemetry test` MAY send a clearly marked native OTLP test signal, but MUST never
    invoke an LLM or model provider.
54. Palette commands MUST have one canonical dotted ID per operation and one visible
    entry; slash commands MUST provide native aliases, autocomplete, and help; CLI
    commands MUST provide help and stable human/JSON output through `--format
human|json` or the existing equivalent convention.
55. Status output MUST report scope, effective state, configuration origin,
    availability, safe brain/router/current-model information when available, health
    or summary, and a recommended action without secrets. A successfully queried
    unavailable state MUST be distinguishable from argument, configuration,
    authorization, or transport execution failure.
    Status, `show`, `configure`, `on`, `off`, `auto`, deterministic `explain`, and
    capability inspection MUST work without a configured model/provider, offline, and
    when every routing candidate fails. These operations MUST make zero LLM calls,
    consume zero model tokens, and incur zero model cost.
56. Global, project, and session command scopes MUST use the same validated precedence
    as the feature configuration. Every mutating command MUST require an unambiguous
    scope; read commands MAY inspect effective state. Scope syntax and defaults remain
    open in clarification.
57. Mutating management operations MUST be idempotent, atomic, audited, and return
    effective state. A failed operation MUST NOT persist a partial change. Commands
    MUST publish canonical events and correlate source (palette/slash/CLI/Settings),
    actor when available, scope, action, result, and configuration version. Audit actor
    and source MUST identify the operator and interface (palette, slash, CLI, Settings,
    or App/Desktop), never impersonate an LLM. Unauthorized programmatic attempts via
    an LLM, brain, subagent, ToolRegistry, tool, or MCP call MUST be rejected.
58. Advanced management operations, including reset, capability override/clear/probe,
    pin/unpin, refresh, telemetry export/flush, and fallback/circuit-breaker reset,
    MUST remain governed by the clarification and later-phase policy. They MUST
    require explicit confirmation, authorization, non-interactive `--yes` support,
    and protection against effects and secrets when defined; this requirement does
    not remove them from the product scope.
59. `routing explain` MUST show redacted hard gates, candidates and rejections, score
    breakdown, decision/fallback, and confidence by reading the persisted decision and
    deterministic score/hard-gate records. It MUST NOT ask a model for an explanation.
    It MUST never show prompts, secret reasoning, file content, or tool payloads.
    Command telemetry MUST emit correlated spans/logs/metrics with controlled
    cardinality.
60. Headers, tokens, certificate private keys, and credentials MUST never appear in
    command arguments, persisted command records, shell history, command output, or
    slash prompts. Sensitive configuration MUST use secure storage or references and
    the protected Settings flow.
61. Command input and administrative output MUST remain outside LLM Message/Part,
    prompt, context, and transcript history by default. An administrative slash
    command MUST NOT become a Message/Part, custom command template, tool call, MCP
    call, or LLM context text. Explicit user copying of output into a prompt is a
    separate user action.
62. Smart, routing, and telemetry commands MUST NOT be registered or exposed in the
    ToolRegistry or the catalog of tools available to any model. The LLM, brain, and
    subagent MUST NOT invoke them, query status through them, or change configuration
    through them. Native command operations MUST call canonical domain services
    directly; brain/router observation MUST use internal config, state, and event APIs,
    never the command interface.

### Hierarchical adaptive routing (Phase 2, confirmed)

63. The main context role MUST be **Architect**, resolved from a user-configured
    role pool at the frontier/highest tier. Product policy MUST NOT hardcode model
    or provider IDs; previously cited model names are tier examples only. Users
    configure candidates for roles/pools such as `architect`, `manager`,
    `worker-fast-large`, `worker-fast-small`, or equivalent abstractions, resolved
    against canonical catalogs.
64. Architect MUST evaluate task size/complexity and select exactly one initial
    path: (a) **direct Worker** for small/bounded work — Architect calls Worker;
    Worker executes; Architect validates; or (b) **Manager** for
    complex/decomposable work — Architect calls Manager; Manager decomposes into
    Workers; Manager validates each Worker result and the synthesis; Architect
    validates the Manager outcome.
65. Maximum initial delegation depth MUST be Architect → Manager → Worker. Manager
    MUST NOT create Manager. Worker MUST NOT create Worker. Architect MAY call
    Worker directly, skipping Manager.
66. Architect classification MUST combine deterministic hard gates with structured
    evaluation signals including at least: domain count, independent work units,
    mutation/risk, ambiguity, context size, expected tools, parallelism, and
    security/migration/external effects. Exact thresholds and weights remain open
    clarification parameters.
67. Every route decision MUST record task class/complexity, confidence, reasons,
    selected path (`direct_worker` or `manager`), role pool, budgets, and policy
    version, in addition to the immutable decision fields required by FR21–FR22.
68. Manager MAY request fanout dynamically. The admission controller MUST grant
    total or partial concurrency according to global, root, provider, agent, cost,
    and token limits. A dynamic request MUST NOT imply unbounded concurrency.
    Maximum fanout and numeric budgets remain open clarification parameters.
69. When a direct Worker discovers complexity beyond its envelope, it MUST return
    escalation status with evidence. Architect MUST reclassify and MAY create a
    Manager. Evidence, OutputRefs, and process lineage MUST be reused; the system
    MUST NOT discard usable work and restart blindly. Escalation thresholds remain
    open clarification parameters.
70. Validation chain MUST be: (a) direct path — Worker result → Architect
    validation; (b) complex path — Worker result(s) → Manager validation and
    aggregation → Architect validation. Worker failure or low confidence MUST
    escalate to Manager when present, otherwise to Architect. Manager failure MUST
    escalate to Architect. Exact acceptance criteria and confidence floors remain
    open clarification parameters.
71. Role fallback floors MUST apply: Architect MUST NOT fall below its configured
    minimum tier without explicit authorization. Manager and Worker fallback MUST
    select only candidates in eligible, mutation-safe pools authorized by hard
    gates. Exact floor values remain open clarification parameters.
72. Dispatch communication envelopes MUST include goal, constraints, acceptance
    criteria, permissions, Lang Lock (Feature 004), budget/deadline,
    context/output refs, and the owning Session's `TodoRef`/version with a bounded
    authorized Todo summary. Returns MUST include status, evidence, tests, changes,
    confidence, unresolved items, usage, and Todo outcome/version subject to
    redaction.
73. Context MUST be bounded: Workers write OutputSpool content; Managers
    read with offset/limit; Architect receives syntheses, slices, and refs, not
    complete Worker outputs by default. Definitive OutputSpool contracts are owned
    by [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md).
74. Skills, agents, models, and effort MUST remain separate typed dimensions
    (FR16). Manager MAY recommend Workers, skills, and effort; Router MUST validate
    recommendations against hard gates and canonical catalogs before execution.
75. Hierarchy observation MUST record hierarchy role (`architect` | `manager` |
    `worker`), parent/root process identity, delegation depth and path, fanout
    requested versus granted, validation states, Todo ref/version/counts/
    consistency/outcome when known, tokens, TTFT, tokens/s, cost, fallback, and
    confidence for Event Bus, Process Table, and telemetry under Feature 001/002
    cardinality rules. Process Table observes Todo metadata and MUST NOT execute
    or edit Todo.
76. Feature 002 live Process Table panel MUST be able to represent the
    Architect/Manager/Worker hierarchy for the authorized root without mixing
    sessions. Session UI surfaces MUST show direct children only
    (`parent_session_id == current_session_id`); Process Table MAY retain the full
    authorized tree for control-plane scope. Feature 001 owns routing semantics;
    Feature 002 owns projection, direct-child Session views, and panel surfaces.

### Mandatory session-owned Todo (Phase 2, confirmed)

77. Every goal-bearing Session — Architect main context, Manager, Worker/agent/
    subagent, including simple tasks — MUST own exactly one Todo aggregate. Parent,
    child, and sibling Sessions MUST NOT share a list. Hidden lifecycle agents
    (title/summary/compaction) remain clarification/exemption candidates and MUST
    NOT be pretended to already use Todo tools.
78. Before goal-bearing execution or dispatch on either the direct Worker path or
    the Manager path, the Session MUST have a non-empty durable Todo snapshot.
    Simple tasks MUST use at least one bounded item. An empty list MUST NOT bypass
    the gate. While executable work remains, exactly one item MUST be
    `in_progress`. Updates MUST persist on real semantic transitions, not per-token
    loops.
79. Todo snapshot/version MUST be durable outside message prose and compaction and
    is the authority of logical work. Prompt/context builders MUST rehydrate the
    same snapshot/version after compaction, restart, resume/replay, and before the
    next turn. A textual summary MUST NOT diverge from or replace the snapshot.
80. Native completion gate MUST block Session/Task `completed` when required items
    are pending/in_progress, version mismatches, or a validation step is missing,
    recording `todo.completion_blocked`. Failure/cancel MUST preserve incomplete
    items and aggregate outcome/reason. Worker completion MUST NOT complete the
    Manager Todo; Manager validates Workers/synthesizes then completes its Todo;
    Architect validates Manager or direct Worker then completes its own Todo.
81. Role validation on both hierarchy paths MUST include Todo requirements: direct
    path — Worker Todo gate then Architect dispatch/validation Todo; complex path —
    each Worker Todo gate, Manager dispatch/validation Todo, then Architect
    validation Todo. Parent models MAY observe child TodoRef/version/counts/
    summary and MUST NOT edit child Todo content.

### Context, Turn and Delegation Budget (Phase 2, confirmed)

82. The product MUST define a named transversal policy **Context, Turn and Delegation
    Budget** (budget policy). It is configurable per global, project, routing profile,
    task class, and role. Hard maximums MUST NOT be relaxed by a model, plugin, MCP,
    or nested instruction.
83. Budget policy MUST include at least these concepts (exact schema remains plan-
    phase): `max_turns`, `max_context_tokens` / `max_context_bytes`,
    `max_output_tokens` / `max_output_bytes`, `max_workers` / fanout, `max_delegation_depth`,
    `retrieval_top_k`, `rerank_top_k`, `max_skill_chunks` / skill token budget, time /
    cost / token budgets, retry / fallback / validation depth, and escalation thresholds.
84. Role context budgets MUST apply: Architect receives global summaries and refs;
    Manager receives feature-scope and Worker summaries/refs; Worker receives its task
    slice only. Frontier Architect MAY use low reasoning effort for simple tasks under
    the same policy.
85. Optimized hierarchy paths MUST be preferred:
    - **Small:** Architect → Worker → Architect validation (minimal turns).
    - **Complex:** Architect → Manager → parallel Workers (admission-granted) → Manager
      one synthesis → Architect one validation.
86. Free chat loops between hierarchy levels are forbidden. Dispatch and return MUST
    use complete structured envelopes. Worker asks only when blocked; Manager resolves
    before escalating to Architect when possible.
87. Manager fanout MUST be granted partially by admission based on expected parallel
    gain versus overhead. One Worker per independent work unit or domain — not one
    Worker per file by default.
88. Todos remain mandatory (FR77–FR81) but MUST NOT force an extra provider turn solely
    to create Todo text: runtime initializes the singleton from the dispatch envelope;
    updates occur on real semantic transitions only; completion gate is native.
89. Event bus / lifecycle wakes MUST invoke models only for blocked, escalation,
    terminal, or validation_failed conditions. Progress, heartbeat, and token deltas
    MUST be coalesced and MUST NEVER alone trigger an LLM turn.
90. Skills MUST be lazy: summary metadata first; full selected chunks only under
    `max_skill_chunks` / skill token budget. Query embedding for semantic retrieval
    (Feature 006) MUST be computed once per logical Task fingerprint and cached while
    valid.
91. OutputSpool (Feature 005) refs and offset/limit reads MUST prevent context
    duplication. Compaction MUST rehydrate structured Todo, routing decision, budget
    consumption, and OutputRefs; it MUST use incremental/role summaries, not repeated
    full conversation dumps as the sole authority.
92. Native lint, tests, and validators MUST run before model-based validators when
    available. Architect opens raw OutputSpool slices only on failure, low confidence,
    conflict, or high-risk outcomes.
93. Single-tool model candidates MAY be selected only for compatible tasks; multi-tool
    and parallel capability SHOULD reduce turns when the task requires them.
94. Retry MUST apply only to retryable, mutation-safe failures. Blind full replay of
    hierarchy work is forbidden.
95. Budget exceeded MUST yield explicit `blocked`, escalation, or error outcomes. Silent
    truncation, silent downgrade of hard maximums, or silent dropping of required
    validation is forbidden.
96. Budget observability MUST record (content-free): turns per accepted task, tokens
    per accepted result, manager overhead ratio, requested versus useful workers,
    retrieval injected versus saved, escalation count, avoidable retry, compacted/
    discarded tokens, and quality/cost/latency under Feature 001 cardinality rules.
97. Feature 002 Process Table and events MUST be able to project effective budgets,
    consumption, delegation path, wake reason, and (when Feature 006 is active)
    retrieval/index job lifecycle without raw queries or content.
98. Feature 006 semantic retrieval MUST consume `retrieval_top_k`, `rerank_top_k`, and
    skill chunk budgets from this policy. Feature 006 MUST NOT own hard gates or final
    route selection. Route/retrieval decision records MUST capture the effective
    embedding and reranker **binding versions** used. Architect/Manager/Worker MUST NOT
    select or change embedding/reranker bindings; those are operator-pinned via Feature
    007 and Feature 006 fixed-binding contracts.

## Non-Functional Requirements

- **Correctness:** hard-gate outcomes, candidate eligibility, ranking, and fallback
  classification MUST be deterministic for identical inputs and policy versions.
- **Availability:** telemetry exporter degradation MUST be isolated from prompt and
  Task execution; routing MUST operate from configuration and local evidence offline.
- **Performance:** the hot path MUST use local state; remote telemetry export MUST be
  outside prompt/routing critical sections; configured timeouts and queue bounds MUST
  be observable.
- **Privacy:** default export is metadata-only and redacted; prompt text, complete
  file contents, personal paths, secrets, and tool payloads are excluded by default.
- **Security:** configuration, secret references, and persisted decisions MUST respect
  existing authorization and filesystem boundaries; project configuration MUST not
  grant new permissions.
- **Auditability:** every selected route and fallback MUST explain gates, candidates,
  ranking, evidence, policy version, and model decision without requiring raw prompts.
- **Compatibility:** existing Task semantics, provider behavior, permission checks,
  resume/replay contracts, and plugin behavior MUST remain unchanged unless this spec
  explicitly defines the routing seam.
- **Architecture:** manager mode, routing, and capability resolution MUST reuse the
  canonical PermissionV2/Policy/Session/Task/runner, Catalog.Service/ModelsDev,
  SessionRunnerModel, AgentV2, SkillV2, EventV2, configuration, schema, and lifecycle
  authorities; no parallel runtime, catalog, resolver, registry, schema/event
  identity, execution loop, or retry controller is permitted.
- **User interface:** the active Smart state MUST be textually identifiable, theme
  and accessibility compatible, and consistent with the effective session policy;
  visual state MUST never claim activation when brain or routing is unavailable.
- **Capability safety:** tool-call capability decisions MUST be made before execution,
  bounded by explicit metadata/override/observation provenance, and observable as
  hard-gate, serialisation, mismatch, or fallback outcomes.
- **Command consistency:** native palette, slash, CLI, Settings, and in-scope
  App/Desktop contexts MUST be parity-tested against the same domain operation,
  validation, precedence, persistence, and event outcome.
- **Command safety:** read/status operations MUST be redacted and distinguish
  unavailable state from execution failure; mutating operations MUST be atomic,
  idempotent, auditable, scope-explicit, and safe for interactive and non-interactive
  invocation.
- **Operator boundary:** all feature commands MUST parse and dispatch locally, remain
  outside prompt admission, Message/Part, transcript, context, custom-command,
  ToolRegistry, MCP, and model-tool surfaces, and require an operator interface
  source. Baseline read/status/mutation operations MUST be model-independent and
  function offline.
- **Discoverability and accessibility:** every required operation MUST be discoverable
  through help/autocomplete or CLI help, keyboard reachable, textually identifiable,
  and usable without color.
- **Hierarchical adaptive routing:** Architect/Manager/Worker depth, orchestration-only
  mutation boundaries, route path selection, validation chain, escalation reuse,
  admission-bounded fanout, and role-pool resolution without hardcoded model IDs MUST
  be deterministic for identical inputs and policy versions and observable without
  high-cardinality metric labels.
- **Role-pool configurability:** role candidates MUST resolve from user-configured
  pools and canonical catalogs; product policy MUST NOT embed provider/model IDs as
  fixed routing identity.
- **Bounded hierarchy context:** Architect and Manager MUST consume syntheses, slices,
  and OutputRefs rather than unbounded complete Worker outputs by default.
- **Mandatory session-owned Todo:** every goal-bearing Architect/Manager/Worker path
  MUST carry a non-empty durable Todo snapshot/version, exactly one `in_progress`
  item while work remains, completion-gate enforcement, and rehydration after
  compaction/restart without sharing lists across Sessions.
- **Direct-child Session visibility:** Session UI MUST show only direct children;
  full-tree visibility is an internal Process Table/control-plane concern and MUST
  NOT flatten grandchildren into the main Architect view.

## Acceptance Criteria

The following scenarios define observable behavior for the feature; they are
executable acceptance targets for the later implementation phase.

1. **Enable OTLP globally.** Given valid global OTLP settings and telemetry enabled,
   when a user saves Settings, then the configuration persists, status reports active,
   and a test export uses the selected transport without blocking the prompt path.
2. **Project override.** Given valid global and project settings, when a project is
   opened, then validated project values take precedence only within that project and
   the effective configuration is inspectable.
3. **Offline export.** Given an unavailable endpoint and a bounded queue, when a prompt
   and Task execute, then both complete, telemetry is queued or dropped according to
   policy, degradation is visible, and no unbounded memory is allocated.
4. **Privacy default.** Given a prompt containing a secret and a tool returning file
   content, when telemetry is exported, then no complete prompt, secret, personal
   path, file content, or tool payload is exported by default.
5. **Hard gate authority.** Given candidates with different permissions, when routing
   evaluates them, then unauthorized candidates are excluded before any model
   recommendation and cannot be selected by ranking or fallback.
6. **Two-stage route.** Given an eligible task, when routing completes, then the
   persisted decision identifies one specialist agent followed by one executor model,
   selected skills, all separate effort dimensions, and the applied budgets.
7. **Deterministic decisor.** Given a configured healthy decision-model pool and the
   same task and policy, when routing runs twice, then the same decisor and auditable
   recommendation inputs are selected without recursively invoking routing.
8. **No candidate.** Given a task for which every candidate fails a hard gate, when
   routing evaluates it, then execution does not start and the user receives an
   explicit no-authorized-candidate error.
9. **Safe fallback.** Given a failed read-only execution before completion, when the
   fallback policy allows retry, then only an authorized candidate is tried and the
   decision records the reason and boundary classification.
10. **Mutation boundary.** Given a failed operation after a mutating tool effect, when
    fallback is considered, then the system does not blindly repeat the effect and
    requires the configured safe recovery behavior.
11. **Reproducible resume.** Given a persisted routing decision, when a background,
    parent-child, replay, or resume operation continues, then authorization, selected
    route, policy version, and mutation boundary remain intact.
12. **Fast/inequívoco policy.** Given a route eligible for bypass evaluation, when the
    configured decision-model-call policy applies, then the system records whether the
    decisor was skipped and why; it does not assume an unapproved default.
13. **Cardinality control.** Given many sessions, messages, models, agents, and skills,
    when metrics are exported, then session/message IDs and dynamic skill IDs are not
    metric labels, bounded enums/buckets and normalized API families are used, active
    catalog/registry IDs obey the configured budget, over-budget IDs map to `other`
    with a counter, and traces/logs retain detailed correlation.
14. **External prior expiry.** Given an external metric with source, date, TTL, and
    confidence, when its TTL expires or local samples become sufficient, then it is not
    used as an unmarked authoritative local measurement.
15. **Queue bound and drop policy.** Given a configured queue capacity and drop or
    backpressure policy, when producers exceed capacity, then queue depth never
    exceeds capacity, the configured outcome is recorded, and prompt execution is
    unaffected.
16. **Shutdown flush.** Given a configured shutdown window, when shutdown begins, then
    no new telemetry is accepted after close, flushing stops at the window boundary,
    flushed and discarded counts are recorded, and application shutdown is not held
    beyond that boundary.
17. **Exporter recovery.** Given an exporter or transport failure, when recovery is
    attempted, then local state is bounded, the configured delivery semantics are
    observable, drops and retries are counted, duplicates are counted when
    detectable, and correlation/deduplication remains best-effort for the selected
    backend.
18. **Decision atomicity.** Given a crash during decision persistence, when execution
    resumes, then a partial record is unusable; after a committed record, recovery
    finds exactly one immutable decision and emits its commit/recovery outcome.
19. **Catalog change.** Given a persisted decision and a changed catalog, when replay
    starts, then the original record remains unchanged and the system either uses its
    recorded catalog or emits an explicit policy-governed re-resolution outcome.
20. **Profiling capability.** Given a runtime with or without profiling support, when
    telemetry starts, then supported profiling reports its configured status and
    unsupported profiling reports a disabled reason without affecting other signals.
21. **Orchestration-only Architect.** Given brain mode, Smart Routing, and
    orchestration-only policy are active, when the primary Architect context
    receives project work, then it classifies complexity, selects a direct Worker or
    Manager path, dispatches descendants, validates per the validation chain, and
    reports without directly executing project mutations.
22. **Brain proposal cannot bypass gates.** Given a brain-proposed candidate that
    fails a hard gate, when the brain requests routing or re-evaluation, then the
    router rejects the candidate, preserves permissions, and records the proposal and
    rejection.
23. **Smart active label.** Given brain mode and Smart Routing are effectively active,
    when the TUI renders the confirmed prompt location, then it shows the exact
    textual label `Smart` in red, with an equivalent accessible text indicator in
    monochrome and non-color themes, without renaming the `build` agent.
24. **Degraded label.** Given either brain mode or Smart Routing is inactive or
    unavailable, when the TUI renders the contextual state, then it does not show
    `Smart` as active, exposes an observable reason, and renders the configured
    fallback state.
25. **Canonical route resolution.** Given a candidate route, when the decision and
    executor are resolved, then candidates come from Catalog.Service/ModelsDev and
    available provider/model data, final model resolution uses SessionRunnerModel,
    agent uses AgentV2, skills use SkillV2, and canonical policy checks decide access.
26. **Single lifecycle.** Given a routed Task, when it dispatches and completes, then
    SessionRunner/Task and EventV2 provide the lifecycle and events, with no parallel
    registry, resolver, schema identity, execution loop, `smart_task`, or retry
    controller involved.
27. **Capability hard gate.** Given a Task requiring a capability dimension that a
    candidate does not support, when routing evaluates it, then the candidate is
    rejected before execution and the dimension, requirement, reason, scope, and
    source are observable.
28. **Serial adaptation.** Given a Task that requires only serial execution and a
    candidate whose runner can execute permitted calls serially, when routing executes
    it, then the runner serializes calls without claiming model/provider parallel
    support or changing the Task lifecycle.
29. **Conservative unknown capability.** Given missing or uncertain capability
    metadata, when routing evaluates a candidate, then the configured conservative
    policy is applied; probing occurs only when explicitly enabled and safe, and no
    mutating tool is used as a probe.
30. **Typed tool mismatch.** Given a provider/model tool-use failure, when the error is
    classified, then auth, rate-limit, network, and invalid-tool-schema errors are
    distinct from capability mismatch and one transient failure does not create a
    permanent unsupported flag.
31. **Capability learning expiry.** Given an observed capability overlay, when its
    confidence, sample, TTL, or revalidation policy is insufficient or expires, then
    it is not treated as authoritative and the candidate is re-evaluated.
32. **Capability-aware fallback.** Given a candidate fails before a mutating effect
    and another authorized candidate is compatible, when fallback runs, then only the
    compatible candidate is selected; after a mutating effect, the operation is not
    blindly repeated.
33. **Correlation of brain and tools.** Given a manager negotiation and routed Task,
    when a specialist validates a result and uses tools, then telemetry correlates
    negotiation, proposal, acceptance/rejection, re-route, dispatch, tool calls,
    mismatch, fallback, and validation with bounded attributes.
34. **No-tools capability.** Given a Task that requires no tools, when routing evaluates
    a candidate that declares tool calling absent, then the candidate remains eligible
    for that dimension and the absence is recorded without implying tool support.
35. **One-call-per-turn limit.** Given a Task requiring at most one tool call per
    assistant/provider turn, when a candidate declares that known limit, then the
    candidate passes the calls-per-turn gate and the limit is recorded independently
    from same-turn multiple-call or parallel support.
36. **Sequential continuation across turns.** Given a Task requiring sequential tool
    use across multiple turns, when a candidate supports continuation after tool
    results and multi-turn cycles, then the runner continues the same Task lifecycle
    across turns and records both dimensions.
37. **Same-turn calls executed serially.** Given a Task requiring multiple calls emitted
    in one turn but allowing serial execution, when a candidate can emit same-turn
    calls and the runner can execute them serially, then execution is serial, the
    result records both capabilities separately, and no parallel capability is claimed.
38. **Parallel required.** Given a Task requiring actual parallel tool calls, when a
    candidate lacks real parallel support, then the candidate fails the hard gate even
    if its runner can serialize calls.
39. **Continuation unsupported.** Given a Task requiring continuation after a tool
    result or a multi-turn tool-use cycle, when a candidate lacks that dimension, then
    the candidate fails the corresponding hard gate before execution.
40. **Capability dimension provenance.** Given declared metadata, a validated override,
    and an observed overlay for the same candidate, when routing persists the decision,
    then each capability dimension retains its value, source, confidence, timestamp,
    TTL, scope, and mismatch outcome without collapsing independent dimensions.
41. **Canonical command parity.** Given the same valid management operation, when it is
    invoked from palette, slash, CLI, Settings, or an in-scope App/Desktop context,
    then the same domain operation, validation, precedence, persistence, effective
    state, and canonical events are used.
42. **Smart command surface.** Given the native palette or slash command interface,
    when a user searches for Smart management, then `smart status`, `smart on`,
    `smart off`, and `smart auto` are discoverable with help/autocomplete, and
    `smart auto` is distinct from permission-mode `auto` in text.
43. **CLI Smart surface.** Given the CLI, when a user requests `opencode smart ...`
    with help or a valid operation, then the command tree documents the operation and
    returns the redacted effective state in the selected stable format.
44. **Routing dry run.** Given a routing test request, when `routing test` executes,
    then it performs deterministic local simulation only (aligned with FR52 and AC55),
    executes no tool or mutation, makes zero decision/executor/provider model calls,
    consumes zero model tokens, incurs zero model cost, reports that no external model
    call was made, and records the dry-run outcome. A future provider/model diagnostic
    MUST use a separate explicit operator operation and MUST NOT be reported as this
    baseline `routing test`.
45. **Routing explanation and capability inspection.** Given a routed candidate, when
    `routing explain` or `routing capability inspect` runs, then it shows redacted
    gates, candidates/rejections, score/fallback/confidence, and declared/observed
    single-tool capabilities without prompt, reasoning secret, file, or tool payload.
46. **Telemetry command surface.** Given native command surfaces, when a user invokes
    telemetry status/on/off/test/show/configure, then the operations are discoverable,
    use the persistent Settings flow for configure, redact show output, and never
    accept raw secrets in prompt or slash arguments.
47. **Telemetry test mode.** Given an explicit telemetry test mode, when `telemetry
test` runs, then it either emits a clearly marked test signal or validates
    connectivity, reports which behavior occurred, and does not silently export user
    content.
48. **Scoped mutation.** Given global, project, and session scope options, when a
    mutating command omits or ambiguously specifies scope, then it fails before write;
    a valid mutation is atomic, idempotent, audited, and returns effective state.
49. **Unavailable status.** Given a configured but unavailable router, brain, model,
    provider, or telemetry endpoint, when a status command succeeds in reading state,
    then it reports unavailable state, origin, health/reason, and recommended action
    without presenting that state as a command execution failure.
50. **Advanced command protection.** Given an advanced reset, override/clear/probe,
    pin/unpin, refresh, export/flush, or fallback reset operation, when policy has not
    yet authorized its exact semantics, then the operation remains gated by explicit
    confirmation, authorization, and non-interactive `--yes` rules rather than
    silently performing an effect.
51. **Secret protection.** Given credentials or TLS material in secure configuration,
    when any management command is invoked, then secrets are absent from arguments,
    persisted records, shell history, slash prompts, and output.
52. **Command audit correlation.** Given a management operation, when it completes or
    fails, then its source, actor when available, scope, action, result, config version,
    canonical event, and correlated span/log/metric are recorded with bounded labels.
53. **Local administrative parsing.** Given a palette, slash, or CLI administrative
    command, when it is entered, then it is parsed and dispatched locally before
    prompt admission, creates no Message/Part, custom template, tool call, MCP call,
    or LLM context/transcript content.
54. **Unavailable model independence.** Given no configured model/provider, offline
    operation, or total routing-candidate failure, when status, on, off, auto, show,
    configure, capability inspect, or deterministic explain runs, then it succeeds
    or reports state without any provider call, LLM call, model tokens, or model cost.
55. **Routing baseline simulation.** Given persisted decision data and canonical local
    metadata, when `routing test` runs, then it performs deterministic local
    simulation only, records zero decision/executor/provider calls and zero model
    tokens/cost, and does not execute any tool or mutation.
56. **Separate future provider diagnosis.** Given a future provider/model diagnostic,
    when it is introduced, then it has a separate explicit name, consent, cost
    disclosure, and audit record and cannot be reported as the native `routing test`.
57. **Explain without model.** Given a persisted routing decision, when `routing explain`
    runs, then it reads persisted score, hard-gate, candidate, rejection, fallback,
    and confidence data without requesting a model explanation or adding LLM content.
58. **Tool surface exclusion.** Given any LLM, brain, specialist, or model tool catalog,
    when available tools are enumerated, then Smart/routing/telemetry commands are
    absent from ToolRegistry and the model cannot invoke, query, or mutate them.
59. **Native service observation.** Given brain/router state changes caused by a native
    command, when internal consumers observe them, then they use canonical config,
    state, or event APIs rather than invoking or parsing command interfaces.
60. **Marked telemetry test.** Given telemetry is configured, when `telemetry test`
    selects its explicit test-signal mode, then any emitted OTLP signal is clearly
    marked, contains no LLM content, and is produced without an LLM call.
61. **Administrative transcript isolation.** Given command output is displayed, when
    the operation completes, then output is absent from history/context/transcript by
    default; only explicit user copying can place it into a later prompt.
62. **Operator audit identity.** Given a command succeeds or an LLM/tool attempts to
    invoke one programmatically, then the former records operator/interface actor and
    source, while the latter is rejected and cannot impersonate an LLM action.
63. **Direct Worker path.** Given a small/bounded task classified for direct
    execution, when Architect dispatches, then a Worker is called without a Manager,
    the Worker executes, Architect validates the Worker result, and the route record
    stores path `direct_worker` with class/complexity, confidence, reasons, role
    pool, budgets, and policy version.
64. **Manager path required.** Given a complex/decomposable task, when Architect
    classifies it, then a Manager is dispatched, Workers execute under the Manager,
    Manager validates each result and the synthesis, Architect validates the Manager
    outcome, and depth never exceeds Architect → Manager → Worker.
65. **No Manager-of-Manager / Worker-of-Worker.** Given an active Manager or Worker,
    when it attempts to create another Manager or Worker beyond the allowed depth,
    then the router rejects the delegation and records the rejection.
66. **Role pools not hardcoded models.** Given user-configured role pools for
    architect/manager/worker abstractions, when routing resolves candidates, then
    selection uses configured pool candidates and canonical catalogs only; no product
    policy hardcodes a model or provider ID as the role identity.
67. **Router rejects incompatible route.** Given a proposed path that fails hard gates
    or structured classification constraints, when router core validates it, then the
    route is rejected, permissions are preserved, and reasons are recorded.
68. **Admission-bounded fanout.** Given a Manager that requests more Workers than
    global/root/provider/agent/cost/token limits allow, when admission runs, then
    only the granted total or partial set starts, requested versus granted fanout is
    observable, and concurrency remains bounded.
69. **Escalation reuses lineage.** Given a direct Worker that returns escalation with
    evidence, when Architect reclassifies to a Manager path, then evidence,
    OutputRefs, and process lineage are reused and work is not discarded by a blind
    restart.
70. **Validation chain direct.** Given a completed direct Worker result, when
    Architect validation runs, then acceptance or rejection is recorded before the
    outcome is reported as final, and Architect's own Todo cannot complete while
    required validation items remain pending/in_progress.
71. **Validation chain complex.** Given Worker results under a Manager, when Manager
    aggregates and Architect validates the Manager outcome, then each level's
    validation state is observable, Worker completion does not complete Manager or
    Architect Todos, and a Manager failure escalates to Architect.
72. **Architect fallback floor.** Given Architect fallback candidates below the
    configured minimum tier without authorization, when fallback is considered, then
    those candidates are excluded and an explicit error or authorized path is used.
73. **Bounded Architect context.** Given large Worker outputs, when Architect
    receives results, then it consumes syntheses, slices, or OutputRefs rather than
    complete unbounded outputs by default.
74. **Hierarchy telemetry cardinality.** Given hierarchy role, delegation path,
    fanout, and validation metrics, when metrics export, then high-cardinality IDs
    are absent from metric labels and traces/logs retain correlation.
75. **Simple singleton Todo.** Given a simple/bounded goal-bearing task, when
    Architect selects the direct Worker path, then both Architect and Worker
    Sessions have non-empty session-owned Todo snapshots before execution and
    empty-list bypass is rejected.
76. **Premature completion blocked.** Given required Todo items still pending or
    in_progress, when a Session/Task attempts `completed`, then completion is
    blocked, `todo.completion_blocked` is recorded, and validation chain state
    remains incomplete.
77. **Compaction rehydrates Todo.** Given a durable Todo snapshot/version, when
    compaction runs and the next turn assembles context, then the same
    snapshot/version is rehydrated and textual summary cannot replace it.
78. **Handoff read-only child TodoRef.** Given Architect or Manager dispatch, when
    the envelope is built, then it carries child TodoRef/version and bounded
    summary for observation while the parent model cannot edit the child Todo.
79. **Small optimized path.** Given a small task under Context, Turn and Delegation
    Budget, when Architect classifies direct Worker, then the path is Architect →
    Worker → Architect validation without free chat loops or extra Todo provider
    turns solely for list creation.
80. **Complex optimized path.** Given a complex task, when Manager fanout is admitted,
    then parallel Workers run under granted concurrency, Manager produces one
    synthesis, and Architect performs one validation; one Worker per independent
    work unit/domain rather than per file by default.
81. **No free hierarchy chat.** Given Architect and Manager sessions, when work
    proceeds, then only structured dispatch/return envelopes are used and Workers
    ask only when blocked.
82. **Event wake rules.** Given progress/heartbeat/token deltas on the event bus, when
    they arrive, then they are coalesced and do not alone trigger an LLM turn; model
    wakes occur for blocked, escalation, terminal, or validation_failed.
83. **Todo without extra turn.** Given a dispatch envelope, when a goal-bearing Session
    starts, then runtime initializes the session-owned Todo singleton from the
    envelope without requiring an additional provider turn solely to write Todo items.
84. **Budget exceeded explicit.** Given max_turns or token/context budget exhausted,
    when further model work is requested, then the system returns blocked/escalation/
    error and does not silently truncate or relax hard maximums.
85. **Lazy skills and spool refs.** Given selected skills and large Worker outputs, when
    context is built, then only budgeted skill chunks and OutputSpool slices/refs are
    injected; full skill bodies and full spool files are not auto-loaded.
86. **Budget metrics.** Given completed accepted tasks, when telemetry exports, then
    turns-per-accepted-task, tokens-per-accepted-result, manager overhead, requested
    versus useful workers, and related budget metrics use bounded labels only.

## Security Requirements

1. **Data sensitivity and classification.** Prompts, model responses, reasoning, file
   contents, tool payloads, secrets, and personal paths are sensitive. Metadata such as
   timing, counts, opaque IDs, provider/model identifiers, and policy outcomes is
   exportable only under configured redaction and retention.
2. **Authentication and authorization.** OTLP credentials are references to secure storage;
   Settings and project configuration use existing authorization boundaries. Routing
   cannot grant permissions, and hard gates precede model recommendations and fallback.
3. **Input validation.** Endpoints, protocols, headers, TLS material references,
   budgets, sampling, queue sizes, profiles, candidates, and imported metrics are
   schema-validated, bounded, and rejected with actionable non-secret errors.
4. **Cryptography in transit and at rest.** OTLP TLS and certificate validation follow the
   configured secure transport policy. Secret material and persisted sensitive state
   use platform secure storage or existing encrypted storage; plaintext JSON secrets
   are prohibited.
5. **Logging and audit.** Logs and route decisions contain structured metadata, gate
   outcomes, policy versions, and opaque correlation, never raw prompts, secrets,
   complete files, personal paths, or tool payloads by default.
6. **Error information exposure.** Errors identify configuration, authorization,
   candidate, or transport classes without echoing credentials, prompt content, or
   private paths. No-authorized-candidate errors remain explicit and actionable.
7. **Orchestration authorization.** Architect and Manager orchestration-only
   behavior MUST be enforced by canonical PermissionV2 and Policy/Session/Task
   authorities. Architect, Manager, brain proposal, re-evaluation request, UI state,
   or project override MUST NOT elevate permissions, bypass a hard gate, or perform
   project mutations reserved for Workers.
8. **Capability provenance.** Capability metadata, overrides, and observed overlays
   MUST be validated, scoped, time-bounded, and attributable to provider/model/
   variant/API. Capability evidence MUST NOT disclose credentials or raw tool payloads.
9. **Tool effect protection.** Probing MUST be read-only or otherwise explicitly safe;
   capability mismatch and fallback records MUST preserve mutation boundaries and MUST
   not expose sensitive tool arguments by default.
10. **Command credentials.** Command arguments, shell history, persisted command
    records, output, and slash prompts MUST exclude headers, tokens, private keys, and
    credentials. Secure references MUST be resolved only through protected Settings
    or equivalent secure storage.
11. **Command authorization.** Scope-explicit mutations and advanced operations MUST
    use canonical permissions and confirmation. CLI `--yes` MUST not bypass
    authorization, hard gates, mutation boundaries, or secret redaction.
12. **Redacted diagnostics.** Status, explain, capability inspection, and JSON output
    MUST expose only redacted metadata, never prompts, private reasoning, file content,
    or tool payloads.
13. **LLM boundary enforcement.** The command dispatcher MUST reject invocation from
    LLM output, brain instructions, subagent messages, ToolRegistry tools, MCP calls,
    and unauthorized programmatic callers. Native operator interfaces MUST be the only
    command actor sources.
14. **Transcript and tool isolation.** Administrative command input/output MUST not be
    admitted to Message/Part, prompt, context, transcript, custom-command templates,
    tool catalogs, or exported LLM payloads unless the user explicitly copies it.
15. **Hierarchy depth and mutation boundary.** Delegation beyond Architect → Manager →
    Worker MUST be rejected. Architect and Manager MUST NOT receive project-mutating
    tool permissions under orchestration-only policy; Workers remain the only roles
    authorized for tools, mutations, and tests that change the project.
16. **Role-pool integrity.** Role pool configuration MUST be schema-validated and MUST
    not embed secrets. Hardcoded model IDs MUST NOT be treated as authoritative role
    identity; resolution MUST use configured pools and canonical catalogs under hard
    gates.
17. **Escalation and envelope safety.** Escalation evidence, OutputRefs, TodoRef/
    version summaries, and communication envelopes MUST remain redacted by default
    and MUST NOT elevate permissions when reclassifying from direct Worker to Manager
    path.
18. **Todo authority isolation.** Parent Architect/Manager models MUST NOT edit child
    Todo aggregates. Empty-list bypass and premature completion MUST be rejected by
    the native completion gate.

## Observability

OpenTelemetry is the instrumentation standard and OTLP is the transport. Metrics are
aggregated for Prometheus-compatible systems such as Mimir, structured logs can be
consumed by systems such as Loki, traces by systems such as Tempo, and profiles by
systems such as Pyroscope; these are destination examples, not hard-coded services,
and Grafana is not treated as a signal store. The conceptual spans are the names in
FR8, with parent/child links following the correlation hierarchy in FR7. The
correlation MUST additionally cover Architect classification, brain negotiation,
route proposal, accepted or rejected recommendation, re-route, hierarchy role,
delegation depth/path, fanout requested/granted, Manager/Worker dispatch, validation
state at each level, and result.

The minimum metric families are routing decision latency, decision-model latency,
hard-gate rejection count, authorized-candidate count, route success, useful-result
latency, retry and fallback count, visible tokens/s, TTFT, total duration, cost,
export queue depth, export drops, exporter errors, brain proposals, accepted/rejected
recommendations, re-routes, specialist dispatches, validation outcomes, hierarchy
role and selected path, delegation depth, fanout requested/granted, escalation count,
capability mismatches, serialisation decisions, and capability-overlay
confidence/expiry. Metric
labels for status, task class/profile, effort, capability, and reason use bounded
enums/buckets. Provider/model/variant/agent labels use only active allowlisted IDs
under the configured budget; over-budget values map to `other` and increment a
counter. API family is normalized. Detailed skills and dynamic IDs remain in
traces/logs, while metrics use counts, buckets, or categories; session/message IDs
never become labels. Logs emit structured route, gate, brain, fallback, capability,
configuration, and exporter state events. Traces carry opaque session/message
correlation and links across background and parent-child execution.

The local metrics store is authoritative for the router hot path. Export is
asynchronous and bounded. Metrics MUST use bounded dimensions such as provider,
model, variant, agent, task class, routing profile, cold/warm, result class, and
policy version; session/message IDs use traces or opaque attributes instead. Every
exported record is subject to sampling, retention, redaction, and secret policy.
Capability source, confidence, timestamp, TTL, provider/model/variant/API, and
result class MUST be bounded attributes; raw tool arguments and payloads remain
excluded by default.

Command telemetry MUST record canonical operation ID, source (palette, slash, CLI,
Settings, or App/Desktop context), actor when available, scope, action, result,
configuration version, unavailable-versus-execution-failure classification, and
recommended action. Command spans and logs MUST correlate to routing, brain, telemetry
configuration, capability inspection, dry-run, and validation spans. Dynamic command
IDs, skill details, session/message IDs, raw arguments, and secrets MUST remain out of
metric labels and default exported payloads.
Command audit records MUST distinguish operator/interface activity from rejected
LLM/brain/subagent/tool/MCP attempts and MUST never attribute native command activity
to an LLM. Command telemetry may record the absence of model calls, tokens, and cost
for local operations as bounded result categories.

## Compatibility and Migration

- Phase 1 is additive: telemetry is disabled or behavior-preserving until configured,
  and existing prompt, Task, provider, plugin, permission, and settings behavior
  remains available.
- Phase 2 introduces a core routing seam and domain operator **surfaces** without
  treating existing plugin hooks or `smart_task` as equivalent lifecycle coverage, and
  without transferring management authority from Feature 007 Phase 1. Existing plugin
  paths remain compatible and are not silently promoted to routing or admin authority.
- Configuration migration MUST validate global/project precedence, preserve unknown
  settings safely, and provide an inspectable effective configuration. No migration
  may write secrets into JSON/plaintext.
- Persisted decisions MUST carry a schema/policy version and define behavior for
  unavailable models, expired external priors, missing skills, and old decisions.
- Brain mode and Smart state MUST preserve the real underlying agent identity,
  including `build`; `Smart` is contextual state and MUST NOT alter the existing
  permission-mode meaning of `auto`.
- Hierarchical adaptive routing (Architect/Manager/Worker) is additive to the
  existing Task lifecycle. It MUST not introduce a parallel executor, registry, or
  unbounded recursion. Feature 002 Process Table and live panel MUST align hierarchy
  role, validation status, direct-child Session UI, and session-owned Todo projection
  without mixing sessions.
- Role pools are user-configurable; migration MUST NOT require hardcoded model IDs
  and MUST preserve existing catalog/provider resolution.
- Capability rollout MUST consume existing provider/model metadata first, preserve
  existing tool-call behavior when no routing policy is active, and version any
  validated override or observed overlay without creating a parallel catalog.
- Command rollout MUST preserve existing native palette, slash, CLI, and Settings
  behavior, add the required operations through canonical registries/contexts, and
  keep command output/status versionable and redacted across human and JSON formats.
- Custom prompt/template commands remain unable to administer Smart, routing, or
  telemetry; they are not promoted into the management surface.
- Native command state and output remain outside LLM history/context/transcript and
  ToolRegistry catalogs. Brain/router integrations consume canonical internal state
  and events, not command parsing or command output.
- Rollout, V1/V2 boundaries, and exact migration mechanics remain open questions below;
  this specification does not claim implementation has begun.

## Out of Scope

- Implementing code, changing provider behavior, or creating a plan or task list.
- A plugin-only router, replacing native Task with `smart_task`, or treating plugin
  research as an approved architecture.
- A Grafana UI, Grafana-specific storage, or hard-coded vm.services destinations.
- Remote-backend queries in the routing hot path.
- Automatic permission elevation, blind mutation retries, or unbounded telemetry.
- A parallel brain runtime, candidate/catalog/credential resolver, registry, config,
  schema/event identity, execution loop, `smart_task`, or retry controller.
- Hardcoded model or provider IDs as role identity; Manager-of-Manager or
  Worker-of-Worker recursion; unbounded fanout concurrency; Architect/Manager project
  mutation under orchestration-only policy; blind restart that discards escalation
  evidence/OutputRefs/process lineage; shared parent/child Todo lists; completing a
  parent Todo solely because a child Worker completed; prompt-only Todo without
  durable snapshot/version; free chat loops between hierarchy levels; silent budget
  truncation or model-relaxed hard budget maximums; Milvus or semantic index as
  routing/permission authority (Feature 006 is projection only).
- Renaming the core `build` agent, changing `auto` from permission mode, or making
  `Smart` a color-only indicator.
- Claiming universal parallel tool calling, continuation, or profiling support when
  provider/runtime capability is absent.
- Allowing custom prompt/template commands to manage this feature, exposing a second
  command registry, or implementing different domain logic per command surface.
- Raw secrets in command arguments, shell history, slash prompts, persisted records,
  or output.
- Treating operator commands as prompts, Message/Part entries, custom templates, tools,
  MCP calls, or model interfaces; allowing baseline `routing test` to call a model.
- Final score weights, efficiency formula, default decisor mode, retention defaults,
  or a fixed initial class/profile catalog.
- Automatic internet data collection without explicit source, date, TTL, confidence,
  and policy controls.

## Clarification Questions

1. What score weights and formula define the compound efficiency signal, and what
   confidence/sample-size rule gates local learning?
2. What are the defaults and semantics of decision-model mode `always`, `auto`, and
   `never`, including the exact inequívoco/fast bypass policy?
3. What is the behavior of manual model/agent pins: hard constraint, ranking input, or
   override subject to gates; and how are conflicts reported?
4. After a partial response or read-only tool call, when is fallback allowed, and how
   is idempotency established at each safe boundary?
5. What are telemetry retention, sampling, local-store limits, and bootstrap rules
   from an external backend, if bootstrap is enabled later?
6. How are “useful result”, “rework/correction”, and quality operationally measured?
7. Which initial task classes and routing profiles ship, and how are they versioned?
8. What is the exact skill preload policy, including trust, ordering, and budget cost?
9. What are authentication and TLS defaults for OTLP HTTP/protobuf and gRPC?
10. Which capabilities belong to V1 versus V2, and what migration/rollout gate applies?
11. What numeric defaults and maximums apply to queue capacity, batch size, enqueue
    timeout, export timeout, retry budget, shutdown flush window, local-store size,
    and acceptable telemetry overhead? Which values are configurable per signal?
12. What exact drop/backpressure policy is used when a queue is full, and which
    records, if any, are durable across process restart?
13. What crash-recovery protocol and idempotency-key storage are required for local
    telemetry export and decision persistence, including filesystem and database
    choices?
14. What exact telemetry delivery semantics are supported and selected per exporter
    and backend—at-most-once, at-least-once, or deduplicated delivery—and what is the
    configured behavior when the backend cannot provide the selected semantics?
15. What is the Smart indicator duration and lifecycle, and is its activation selected
    manually, automatically, or by policy? What persistence scope applies per session
    and policy?
16. Which model identity is shown for Smart—the current brain model or the routed
    child executor—and what tooltip/detail view explains proposal, acceptance,
    rejection, re-route, and unavailable state?
17. How does Smart state interact with plan/build transitions, including whether a
    manager validation step can return to planning or dispatch another specialist?
18. What exact textual fallback represents unavailable or degraded Smart state, and
    what are the command-palette and keyboard commands for inspecting or changing it?
19. What is the scope of App/Desktop UI work versus TUI-only work, including shared
    state, accessibility behavior, theme tokens, and terminal capability detection?
20. What exact capability schema is exposed for `tool_call_mode`,
    `max_tool_calls_per_turn`, `parallel_tool_calls`, and continuation support?
21. What precedence applies among canonical metadata, validated global/project
    overrides, and observed overlays, and what confidence, sample, TTL, and
    revalidation thresholds define unknown versus supported capability?
22. What conservative policy applies to unknown tool capability, and which probing
    operations are explicitly safe for each provider/model/API?
23. What are the final command syntaxes, dotted palette IDs, slash aliases,
    autocomplete/help wording, and CLI alias conventions for Smart, routing, and
    telemetry?
24. What are the default scopes and scope-selection syntax for global, project, and
    session mutations, and how are effective-precedence conflicts displayed?
25. What is the exact behavior and exit/status mapping for unavailable state versus
    argument, configuration, authorization, and transport failures in human and JSON
    CLI output?
26. What is the future diagnostic command name, explicit consent, budget, cost
    disclosure, and authorization for provider/model testing kept separate from the
    deterministic local `routing test` baseline?
27. Does `telemetry test` validate OTLP connectivity, emit a clearly marked signal,
    or support both explicit modes, and what is the redaction/retention behavior?
28. What are manual/automatic pin and unpin semantics, refresh target and scope, and
    the exact confirmation and non-interactive behavior for advanced operations?
29. What reset, capability override/clear/probe, telemetry export/flush, and
    fallback/circuit-breaker operations are included in each phase and what
    authorization/effect protections apply?
30. What App/Desktop command-context parity is required, and what is the format for
    confirmations, `--yes`, reversibility, and command errors across surfaces?
31. **Hierarchy — classifier thresholds.** What numeric thresholds and weights apply
    to domain count, independent work units, mutation/risk, ambiguity, context,
    expected tools, parallelism, and security/migration/external effects when choosing
    direct Worker versus Manager? (Hierarchy itself is confirmed; thresholds are open.)
32. **Hierarchy — role pool schema.** What are the exact role pool names, schema,
    configuration surface, and validation rules for architect/manager/worker pools and
    equivalent abstractions?
33. **Hierarchy — direct-route defaults.** What default policy applies when
    classification signals are borderline between direct Worker and Manager paths?
34. **Hierarchy — orchestration tool visibility.** Which tools, if any, may Architect
    or Manager use for read-only orchestration without project mutation, and how is
    that boundary enforced?
35. **Hierarchy — validation criteria.** What acceptance criteria and confidence
    floors define pass/fail/low-confidence at Worker, Manager, and Architect
    validation steps?
36. **Hierarchy — fanout and budgets.** What numeric defaults apply for Context, Turn
    and Delegation Budget fields (`max_turns`, context/output tokens/bytes,
    `max_workers`, `max_delegation_depth`, `retrieval_top_k`, `rerank_top_k`,
    skill chunk budgets, time/cost/token, retry/validation depth, escalation
    thresholds) per global/project/profile/task class/role?
37. **Hierarchy — escalation thresholds.** What evidence and thresholds force
    reclassification from a direct Worker path to a Manager path?
38. **Hierarchy — role fallback floors.** What minimum tier floors apply per role, and
    what authorization path permits Architect to fall below its floor?
39. **Todo — pure social / no-goal chat.** When is a Session exempt from the
    non-empty Todo gate for pure social or no-goal conversation?
40. **Todo — hidden lifecycle agents.** Are title/summary/compaction agents fully
    exempt, partially observed, or otherwise handled without pretending they use
    Todo tools today?
41. **Todo — exact execution boundary.** What exact boundary defines goal-bearing
    work that requires a Todo snapshot versus read-only observation?
42. **Todo — operator completion override.** If an operator override of the
    completion gate exists, what authorization, audit, and recovery rules apply?
43. **Todo — parent content visibility.** How much child Todo item content may a
    parent model observe versus ref/version/counts/summary only?
44. **Todo — archive/retention/reopen.** What completed Todo retention, archive,
    and reopen policy applies per Session?
45. **Todo — CAS conflict.** What compare-and-swap/version conflict resolution
    applies when concurrent Todo updates race?
46. **Todo — failure status model.** What typed failure/cancel/stale statuses and
    aggregate outcomes are final?
47. **Todo — quantitative limits.** What maximum item counts, objective lengths,
    and summary bounds apply?

Confirmed hierarchy decisions (Architect main role, adaptive direct/Manager paths,
orchestration-only Architect/Manager, max depth Architect → Manager → Worker,
user-configurable role pools, validation chain, admission-bounded fanout, escalation
reuse, bounded context, separate skill/agent/model/effort dimensions, hierarchy
telemetry, Feature 002 direct-child Session UI with full-tree Process Table,
mandatory session-owned Todo for goal-bearing roles on both paths) MUST NOT be
reopened as clarification questions.

**Plan gate (status remains `clarified`; phase not advanced).** Residual open
parameters for **Context, Turn and Delegation Budget** numeric defaults (clarification
question on fanout/budgets / FR82–FR98) and Feature 006 retrieval budgets
(`retrieval_top_k`, `rerank_top_k`, skill chunks) MUST be resolved or explicitly
accepted as provisional defaults with test hooks **before** `speckit plan` for this
feature. This note does not invent a new status value and does not reopen confirmed
hierarchy decisions.

## Related Decisions

- [ADR-0001 — OpenTelemetry telemetry foundation and bounded OTLP export](../../adr/0001-opentelemetry-telemetry-foundation.md) — proposed foundation for instrumentation, local evidence, and asynchronous export.
- [ADR-0002 — Core Smart Agent Routing with hierarchical adaptive roles](../../adr/0002-core-smart-agent-routing.md) — proposed core placement, hierarchical adaptive roles, and routing constraints; depends on ADR-0001; aligns with Feature 002.
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed sole management authority; Feature 007 owns command/query/auth/audit adapters.
- Hierarchy research evidence: [001 hierarchical adaptive research](research.md). Research notes are not themselves decisions.
- Evidence informing core placement: [plugin systems research note](../../research/plugin-systems.md). The research note is not itself a decision.
- Related lifecycle feature: [002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Related scheduled-jobs feature: [003 Scheduled Jobs and Async Main-Context Notification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Related content-plane feature: [005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Related semantic retrieval feature: [006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — projection/index only; fixed operator-pinned embedding/reranker bindings; consumes retrieval budgets; hard gates remain Feature 001; no silent model substitution
- Related management foundation: [007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — sole setup/config/management authority including `semantic.*` binding commands; not runtime execution authority
- Related MCP runtime: [008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — sampling cannot bypass Smart/budget/LangLock/privacy; OTEL content-free MCP spans/metrics; ownership unchanged

## Initial Traceability Matrix

| Outcome                                         | Requirements                     | Acceptance scenarios          | Phase |
| ----------------------------------------------- | -------------------------------- | ----------------------------- | ----- |
| Configurable, private telemetry                 | FR1–FR4, FR6–FR11, FR53          | 1–4, 13, 20, 46–47            | 1–2   |
| Bounded, recoverable telemetry delivery         | FR5, FR12                        | 3, 15–17                      | 1     |
| Correlated observability                        | FR7–FR11, FR33                   | 1, 3, 13, 15–17, 33           | 1–2   |
| Bounded metric cardinality                      | FR9–FR10, FR47                   | 13, 33, 40                    | 1–2   |
| Core, gate-authoritative routing                | FR13–FR20                        | 5, 8, 12                      | 2     |
| Reproducible two-stage execution                | FR15–FR17, FR21–FR23             | 6, 7, 11, 18–19               | 2     |
| Safe, authorized fallback                       | FR18–FR19                        | 8–10                          | 2     |
| Evidence-based adaptive ranking                 | FR24–FR26                        | 7, 12, 14                     | 2     |
| Architect hierarchy and contextual Smart UI     | FR27–FR33, FR63–FR76             | 21–24, 33, 63–74              | 2     |
| Hierarchical adaptive routes and validation     | FR63–FR74, FR80–FR81             | 63–73, 70–71, 75–78           | 2     |
| Hierarchy telemetry and Process Table alignment | FR33, FR75–FR76                  | 74, 33                        | 2     |
| Mandatory session-owned Todo on both paths      | FR72, FR77–FR81                  | 70–71, 75–78, 83              | 2     |
| Context, Turn and Delegation Budget             | FR82–FR98                        | 79–86, 63–68, 74              | 2     |
| Canonical core reuse                            | FR34–FR40                        | 25–26, 40                     | 2     |
| Tool capability gating and adaptation           | FR41–FR47                        | 27–32, 34–40                  | 2     |
| Canonical command interface and parity          | FR48–FR58                        | 41–44, 46, 48–50              | 2     |
| Redacted command diagnostics and audit          | FR55, FR59–FR62                  | 45–47, 49, 51–62              | 2     |
| Operator-only LLM/tool boundary                 | FR48–FR49, FR52, FR55, FR61–FR62 | 53–59, 61–62                  | 2     |
| Secure compatible delivery                      | NFRs, security, migration        | 2–4, 11, 13, 20, 46–52, 60–78 | 1–2   |
