---
id: 019f6f5e-884e-7e33-ac5a-df5c0f03b450
number: 007
slug: add-a-unified-native-operator-control-plane-for-all-opencode
status: specified
created_at: 2026-07-17T09:18:14.095054Z
---

# Feature Specification: Unified Native Operator Control Plane

Feature: 007-add-a-unified-native-operator-control-plane-for-all-opencode
Created: 2026-07-17
Scope: management foundation for OpenCode setup, configuration, and operator
management surfaces. Domain features own business logic; this feature owns the
unified command/query plane, auth, audit, and thin adapters.

**Delivery phases.** Feature 007 is the **Phase 1 management foundation and authority**
for all setup/config/management. Domain features (including Feature 001 Phase 2
Smart/routing/telemetry **domain surfaces**) register operations against this plane;
their delivery phases describe domain surface rollout only and do **not** transfer or
redefine management authority.

## Scope and intent

Feature 007 specifies a **unified native Operator Control Plane** for all OpenCode
setup, configuration, and management surfaces **without LLM involvement**.

**Confirmed product decision (native-only authority).** All setup, configuration, and
management MUST use this control plane. Prompt templates, custom commands,
`session.command`, ToolRegistry, MCP tools/prompts, plugins, skills, shell commands
issued by an LLM, and free-form model instructions MUST NEVER be management
authority. Native slash is intercepted **before** prompt admission and transcript;
operations make zero provider/model calls, tokens, and cost by default; output is not
added to Message/Part/context by default.

**Relationship to domain features.** Features 001–006 and Feature 008 own domain
behavior (routing, lifecycle, jobs, Lang Lock, OutputSpool, semantic index, MCP
runtime). Feature 007 owns:

- typed command/query dispatcher (CQRS-light),
- operator command registry separate from PromptTemplate / CommandV2 /
  `session.command`,
- principals/roles, scopes, CAS, idempotency, audit,
- thin parity adapters (TUI Settings/menu/Ctrl+P/native slash, App/Desktop, CLI,
  internal API/SDK),
- secure secret references and redacted outputs.

Domain features register **canonical operation IDs** and domain services; they MUST
NOT invent parallel admin registries or LLM admin paths.

**Reuse, not parallel stores.** The control plane MUST reuse Config.Service, Policy,
Permission, EventV2, and internal SDK/server. It MUST NOT create a parallel config or
event store.

**ADR.** Architectural authority for native command authority is recorded in
[ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)
(proposed; not accepted). This specification does not substitute for that ADR.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — One control plane, many surfaces

- As an operator, I want palette, slash, CLI, Settings, and App/Desktop to invoke the
  same typed command ID and domain service so that every surface returns the same
  effective state, version, and audit record.
- As an operator, I want native administrative slash commands to create no
  Message/Part/transcript entry and to make zero LLM calls, tokens, or cost so that
  management never pollutes session context.
- As an operator, I want reserved admin names rejected when registered via
  `session.command`, custom templates, MCP, or plugins so that no alternate authority
  path exists.

### P1 — LLM cannot administer

- As a security reviewer, I want prompts that ask to enable telemetry, set Lang Lock,
  create jobs, or reindex to leave configuration unchanged and receive only native UI
  guidance so that the model cannot mutate setup.
- As a security reviewer, I want subagent shell/curl against the internal operator API
  denied without an operator principal so that LLM-issued tooling cannot obtain admin
  credentials.
- As an Architect/Manager, I want to recommend route/workers/skills/effort inside the
  execution envelope while being unable to mutate config, pools, budgets, endpoints,
  credentials, index, job definitions, Lang Lock, retention, or quota.

### P1 — Safe mutations and secrets

- As an operator, I want mutations to require operator principal, explicit scope,
  version/CAS, idempotency key, and audit so that concurrent edits conflict safely and
  retries are safe.
- As an operator, I want secret references only (keychain/vault), never secrets in
  args, history, output, config JSON, or plain audit.
- As an operator, I want CAS conflict, idempotent retry, and rollback to be explicit
  outcomes so that persistence is explainable.

### P1 — Domain operation catalog

- As an operator, I want stable conceptual IDs for telemetry, smart, routing, budget,
  pools, process/task, jobs, langlock, output, and semantic domains so that the Feature
  007 registry generates aliases/syntax and clients do not hardcode divergent names.

### P1 — Offline and unavailable

- As an operator, I want status/set and other offline-capable operations to work
  without a provider when the domain permits, and unavailable to be an explicit state
  in human and JSON output.

### P2 — Todo and output plane nuance

- As a user, I want the model to update Todo work-item semantic state under permission
  and CAS as restricted runtime data plane, while policy/exemptions/retention/override,
  clearing the required list, bypassing the completion gate, and editing child Todo
  remain operator-denied setup.
- As a consumer, I want `stat`/`read`/`follow` as authorized consume operations and
  export/share/release/delete/purge/retention/quota as operator admin operations.

### P2 — Jobs and semantic lifecycle

- As an operator, I want semantic reindex/reconcile and job create/run-now to create
  native lifecycle jobs (Features 002/003), not LLM turns.
- As an operator, I want Settings → Semantic Search/Models to register local
  OpenAI-compatible endpoints (optional secret ref), discover/validate models, and pin
  one embedding and one reranker binding so that only the control plane can change them
  and runtime never silently substitutes models.

### P3 — Migration and flags

- As a maintainer, I want feature flags and migration so that legacy custom admin-like
  command names are rejected or reserved without breaking non-admin custom commands.

## Functional Requirements

### Authority and native-only boundary

1. All setup, configuration, and management MUST use Feature 007's unified Operator
   Control Plane and native Settings, menu, palette, native-slash, CLI, App, and
   Desktop adapters that call typed core domain commands/queries directly.
2. The system MUST NOT use Config.command / custom templates, `session.command` prompt
   path, ToolRegistry, MCP tools/prompts, plugins, skills, shell commands issued by an
   LLM, or free-form model instructions as management authority.
3. Native slash MUST be intercepted before prompt admission and transcript. Admin
   operations MUST make zero provider/model calls, consume zero tokens, and incur zero
   cost by default. Output MUST NOT be added to Message/Part/context/transcript by
   default.
4. Mutations MUST require an operator principal, explicit scope, version/CAS,
   idempotency key, and audit. Secret material MUST use secure references only.
5. Architect/Manager MAY recommend runtime route, workers, skills, and effort inside
   the trusted execution envelope. They MUST NOT mutate config, pools, budgets,
   endpoints, credentials, index, job definitions, Lang Lock, retention, or quota.
6. The LLM MUST receive effective read-only policy/config in the trusted execution
   envelope / system boundary. It MUST NOT call admin commands to query or set
   configuration.
7. Plugin, MCP, custom command, and PromptTemplate registries MUST NOT register
   reserved operator command IDs or aliases. Collisions MUST be rejected at registration
   or migration time.

### Architecture and reuse

8. The control plane MUST reuse Config.Service, Policy, Permission, EventV2, and
   internal SDK/server. It MUST NOT introduce a parallel config store or event store.
9. The control plane MUST provide a unified typed command/query dispatcher
   (CQRS-light) with schemas, versioning, domain services, and thin adapters.
10. The **operator command registry** MUST be separate from PromptTemplate, CommandV2,
    and `session.command` registries.
11. Domain features (001–006 and future) own business logic and domain services.
    Feature 007 owns command/query dispatch, auth, audit, adapters, and reserved-name
    enforcement. Feature 007 is the **management foundation**, not runtime execution
    authority.
12. Feature flags and migration paths MUST support progressive enablement. Legacy
    custom admin-like command names MUST be rejected or reserved.

### Principals, roles, and scopes

13. Principals/roles MUST include at least: `operator`, `system`, and optionally
    read-only `manager-view`. LLM, tool, MCP, and plugin actors MUST NOT be
    config-mutating actors.
14. Scopes MUST include global, project, session, and root-tree, with explicit
    supported scopes per operation. Precedence and hard policy MUST NOT be relaxed by a
    narrower scope.
15. Cross-project authorization MUST fail closed: an operator bound to project A MUST
    NOT mutate or read privileged state of project B without explicit authority.

### Persistence, CAS, audit

16. Persistence MUST be atomic per authority, with optimistic CAS, idempotency key,
    conflict response, versioned snapshots/rollback, and audit/outbox/reconciliation for
    external systems when applicable.
17. EventV2 audit fields MUST include source
    (`palette` | `slash` | `cli` | `settings` | `app` | `desktop`), operator
    actor/ref, scope, command/query ID, before/after version hashes, and outcome. Audit
    MUST NOT contain secrets.
18. Native outputs MUST be redacted. There MUST be no automatic transcript injection.

### Adapters and parity

19. Thin parity adapters MUST exist for: TUI Settings/menu/Ctrl+P/native slash,
    App/Desktop Settings/commands, CLI human+JSON, and internal API/SDK. All adapters
    MUST invoke the same command ID and domain service and return the same effective
    state.
20. Internal server API MUST consider operator auth, RBAC, project binding, and
    CSRF/origin. Local single-user principal is the default. LLM shell/curl MUST NOT
    obtain operator credentials.
21. Commands MUST work offline / without a provider when the domain permits.
    Unavailable MUST be an explicit state distinguishable from auth, argument, or
    transport failure, in both human and JSON formats.

### Todo nuance (control plane vs data plane)

22. Core MUST auto-initialize, rehydrate, and version-gate Todo and configure mandatory
    policy natively (aligned with Features 001/002).
23. The model MAY propose/update semantic work-item state via a restricted runtime
    operation under permission and CAS. That path is **data plane**, not setup.
24. The model MUST NOT set Todo policy, exemptions, retention, or override; MUST NOT
    clear a required list; MUST NOT bypass the completion gate; MUST NOT edit a child
    Session Todo.

### Output consume vs admin

25. Output operations MUST classify:
    - **Consume plane (authorized):** `output.stat`, `output.read`, `output.follow`.
    - **Operator admin plane:** `output.export`, `output.share`, `output.release`,
      `output.delete`, `output.purge`, retention, and quota configuration.
26. Consume operations re-evaluate authorization per action. Admin operations require
    operator principal and explicit scope; they MUST NOT default to cross-project share.

### Canonical domain operation catalog

27. The registry MUST define stable conceptual IDs using dotted domain form
    (`domain.operation`). The Feature 007 operator command registry generates surface
    aliases and syntax (palette/slash/CLI/Settings); clients MUST NOT hardcode
    divergent names:

| Domain IDs             | Conceptual operations                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `telemetry.*`          | status, on, off, test, show, configure                                                                                    |
| `smart.*`              | status, on, off, auto                                                                                                     |
| `routing.*`            | status, explain, test, capability.inspect; gated advanced: pins, reset, probe, flush, breaker                             |
| `budget.*`             | status, show, set, reset, validate                                                                                        |
| `pools.*`              | status, show, set, reset, validate                                                                                        |
| `process.*` / `task.*` | status, tree, watch, cancel, steer, handoff (native control; Todo work-item updates remain restricted runtime data plane) |
| `jobs.*`               | list, status, show, create, update, enable, disable, delete, reschedule, run-now, history, watch                          |
| `langlock.*`           | status, set, reset, show-effective                                                                                        |
| `output.*`             | stat, read, follow (consume); export, share, release, delete, purge, retention, quota (admin)                             |
| `semantic.*`           | complete catalog in FR34 (provider/model/embedding/reranker/binding/index)                                                |
| `mcp.*`                | complete catalog in FR41 (server/auth/resource.admin/logging/experimental/extension); schemas SSOT Feature 008            |

28. Feature 001 budget and pool mutation MUST occur only via the control plane
    (`budget.*` and `pools.*` operations). Models MUST NOT mutate hard budgets or
    role-pool configuration through prompt, tool, or MCP paths.
29. `routing.test` baseline MUST always be local deterministic with zero model/provider
    calls (aligns Feature 001 FR52 / AC55). A future provider diagnostic MUST be a
    separate explicit operator operation.
30. `telemetry.test` MUST only emit a clearly marked OTLP test signal (or connectivity
    validation mode) and MUST never invoke an LLM.
31. Semantic and job management operations MUST create native lifecycle jobs (Features
    002/003), not LLM turns. Runtime retrieve/rerank is **data plane** and only reads
    the pinned `SemanticModelBinding`; it MUST NOT mutate profiles or bindings.
32. Process/task control (cancel, steer, handoff) MUST use native services under
    operator authorization; observers MUST NOT mutate the Process Table directly.

### Semantic provider profiles, models, and fixed bindings

33. **Schema SSOT.** Field definitions for `SemanticProviderProfile`,
    `SemanticModelDescriptor`, and `SemanticModelBinding` are owned by Feature 006
    (see Feature 006 FR28). Feature 007 references those schemas for command
    payloads/responses and MUST NOT redefine or diverge field sets. Secrets MUST NOT
    appear on descriptors or bindings.

34. **Complete semantic operator catalog** (registry generates aliases/syntax; clients MUST
    NOT hardcode divergent names). This list is exhaustive and closed:
    - `semantic.provider.list` | `add` | `update` | `test` | `disable` | `delete` |
      `rotate-secret`
    - `semantic.model.list` | `discover` | `register` | `validate` | `disable`
    - `semantic.embedding.show` | `select` | `validate` | `reindex` | `cutover` |
      `rollback`
    - `semantic.reranker.show` | `select` | `validate` | `cutover` | `rollback`
    - `semantic.binding.status` | `history`
    - `semantic.index.status` | `test` | `reindex` | `reconcile` | `show-collections`

35. Settings → **Semantic Search / Models** (and palette/slash/CLI/internal API parity)
    MUST support the complete catalog in FR34: provider list/add/update/test/disable/
    delete/rotate-secret; model list/discover/register/validate/disable; embedding and
    reranker show/select/validate/reindex (embedding only)/cutover/rollback; binding
    status/history; index status/test/reindex/reconcile/show-collections. Secret input
    only via secure store/reference (local endpoint MAY omit key). Discover via
    `/v1/models` when supported and manual registration. Eligible core catalog models
    only with credential and validated semantic capability. Capability badges and
    selectors show only eligible enabled validated candidates; current pinned binding
    shown with effective state/origin/version/degraded status.

36. Compatibility profiles MUST follow Feature 006 FR30. Embedding OpenAI-compatible
    uses `/v1/embeddings` with native deterministic probe. Rerank profiles A/B/C:
    profile **C** (embedding-similarity) MUST be labeled distinctly and MUST NEVER be
    badged as cross-encoder or reranker; it MUST NOT be eligible for the reranker slot.
    Rerank capability MUST NOT be inferred from model name alone. Manual declarations
    are untrusted until probe/eval passes. Wrong dimension or failed embedding probe
    MUST exclude the model from embedding select and reject select with a structured
    error.

37. Binding immutability: LLM, router, agent, plugin, MCP, and ToolRegistry MUST NOT
    set/update/delete profiles or bindings. Bindings persist across sessions/restarts/
    resume/jobs until the operator changes them. V1 default when binding/index
    unavailable: deterministic catalog+lexical fallback with degraded reason unless
    operator configured fail-closed — **never** silent model substitution. No automatic
    fallback pool for these two slots in V1. Runtime MUST NOT mutate bindings from
    telemetry. `semantic.provider.rotate-secret` updates secret_ref/version only, with
    audit/redaction, without changing endpoint/model/binding identity.
    Endpoint/model/compatibility/dimension changes create new profile/binding versions.
    Delete/disable of a bound model requires confirmation and explicit
    replacement/disable policy.

38. Change semantics (domain execution Feature 006 FR32; commands here):
    - Embedding: `validate` → `select` (stages) → `reindex` (blue-green generation) →
      explicit `cutover` (CAS + confirmation activates live alias) → optional `rollback`.
      Select or reindex alone MUST NOT activate the live alias.
    - Reranker: `validate` → `select` → explicit `cutover` (CAS + confirmation) →
      optional `rollback`; no re-embed by default; cache/eval invalidation.
    - In-flight Tasks retain binding versions captured at Task start across cutover;
      new Tasks use post-cutover versions.

39. Network/SSRF and DNS rebinding (MUST, aligned with Feature 006 FR33): SSRF-safe URL
    parsing; scheme/host/port policy; localhost/LAN only with explicit operator
    allowance; resolve and re-validate each connection/redirect against policy; block
    metadata/link-local/private unless explicit local profile allowance; revalidate
    post-resolution. Remote TLS by default; insecure HTTP only for explicit local
    profile with visible warning.

40. **Management call semantics.** Ordinary `status` / `show` / `select` / config
    commands MUST NOT invoke a model or provider generation path. Explicit
    `semantic.provider.test`, `semantic.model.validate`, `semantic.embedding.validate`,
    and `semantic.reranker.validate` MAY call the candidate endpoint only via a fixed
    native probe (no conversation, no transcript, no tools), with cost/data disclosure.
    Structured-chat rerank **runtime** (data plane) uses the fixed native schema and
    pinned binding only; it MUST NOT control setup, profiles, or bindings.

### MCP operator catalog (Feature 008 schemas; Feature 007 registry)

41. **Schema SSOT.** Field definitions and wire/domain semantics for MCP operator
    operations are owned by
    [Feature 008](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md).
    Feature 007 references those schemas for command payloads/responses and MUST NOT
    redefine MCP runtime behavior. Feature 007 owns registry registration, operator
    principal/auth, CAS, idempotency, audit, and thin adapters only.

42. **Complete MCP operator catalog** (registry generates aliases/syntax; clients MUST
    NOT hardcode divergent names). This list is exhaustive and closed for management:
    - `mcp.server.list` | `add` | `update` | `test` | `connect` | `disconnect` |
      `reconnect` | `disable` | `delete` | `status` | `capabilities`
    - `mcp.auth.start` | `finish` | `remove` | `status`
    - `mcp.resource.admin.list` | `templates` | `read` | `subscribe` | `unsubscribe` |
      `policy.show` | `policy.set`
    - `mcp.logging.level.show` | `set`
    - `mcp.experimental.status` | `enable` | `disable` (per capability: tasks,
      sampling, elicitation, nonstandard content-stream extension)
    - `mcp.extension.status` | `enable` | `disable` (per server)

43. **No dual authority.** Runtime LLM tool calls and resource list/read use Feature
    008's canonical adapter under Permission only. They MUST NOT be Feature 007
    command IDs, MUST NOT appear in ToolRegistry as admin tools, and MUST NOT mutate
    MCP setup. Operator human resource control uses `mcp.resource.admin.*` only.

44. Settings → **MCP** (and palette/slash/CLI/internal API parity) MUST support the
    complete catalog in FR42 with zero tokens/transcript by default. Secret material
    uses secure references only. Experimental enable remains disabled by default until
    operator opt-in with audit.

## Non-Functional Requirements

- **Parity:** palette, slash, CLI, Settings, App/Desktop, and internal API/SDK MUST
  share command ID, validation, effective state, version, and audit semantics.
- **Isolation:** admin path has zero LLM involvement by default; no auto transcript
  injection.
- **Availability:** offline-capable operations remain usable without provider;
  unavailable is explicit.
- **Integrity:** CAS, idempotency, atomic persistence per authority, conflict and
  rollback are testable.
- **Privacy:** secrets never in args, history, output, config JSON, or plain audit;
  redacted human/JSON.
- **Security:** operator principal required for mutations; LLM/tool/MCP/plugin cannot
  be config-mutating actors; internal API denies unauthenticated operator actions.
- **Compatibility:** domain features keep business logic; migration reserves/rejects
  legacy admin-like custom names without inventing parallel stores.
- **Observability:** EventV2 + OTEL content-free labels under Feature 001 cardinality
  rules; command source/actor/scope/outcome only.

## Acceptance Criteria

1. **Surface parity.** Given the same valid operator command, when invoked from
   palette, slash, CLI, or Settings, then the same command ID, domain service result,
   version, and audit record are produced.
2. **Admin slash isolation.** Given an administrative native slash command, when it
   executes, then no Message/Part/transcript entry is created and zero LLM calls,
   tokens, and cost occur.
3. **Reserved name rejection.** Given `session.command`, custom template, MCP, or
   plugin registration of a reserved admin name, when registration or dispatch occurs,
   then it is rejected and configuration is unchanged.
4. **Prompt cannot administer.** Given a user prompt that asks to enable telemetry, set
   Lang Lock, create a job, or reindex, when the model turn completes, then config is
   unchanged and only native UI guidance is offered (no admin mutation).
5. **Offline where supported.** Given no provider/network, when an offline-supported
   status or set operation runs, then it uses local domain services and reports
   success or explicit unavailable without LLM calls.
6. **Routing test zero model.** Given `routing.test`, when executed, then it performs
   deterministic local simulation only with zero model/provider calls, tokens, and cost.
7. **Telemetry test marked signal.** Given `telemetry.test` in test-signal mode, when
   executed, then any OTLP signal is clearly marked and no LLM is invoked.
8. **Subagent API denial.** Given a subagent shell/curl against the internal operator
   API without operator principal, when the request is processed, then it is denied and
   no credentials are issued.
9. **CAS / idempotency / rollback.** Given concurrent mutation or retry with the same
   idempotency key, when the control plane processes them, then CAS conflict,
   idempotent success, or explicit rollback is returned without partial silent write.
10. **Secret redaction.** Given secret refs in configuration, when any command runs,
    then secrets are absent from args, history, output, config JSON dump, and audit.
11. **Cross-project auth.** Given an operator bound to project A, when they attempt
    privileged operations on project B without authority, then the action is denied.
12. **Todo data plane vs policy.** Given a model Todo work-item update under permission
    and CAS, when applied, then semantic item state may change; Todo policy, exemptions,
    retention, override, required-list clear, completion-gate bypass, and child Todo
    edit are denied.
13. **Output consume vs admin.** Given an authorized consumer, when they call
    stat/read/follow, then pages are returned under re-evaluated auth; export/share/
    delete/purge/retention/quota require operator admin authorization.
14. **Native jobs not LLM turns.** Given semantic reindex/reconcile or job create/
    run-now, when executed, then Feature 002/003 native lifecycle jobs are created and
    no LLM turn is started solely for administration.
15. **Unavailable human+JSON.** Given a configured but unavailable backend, when status
    succeeds at reading local state, then human and JSON formats report explicit
    unavailable distinct from auth/argument/transport failure.
16. **Legacy migration / reserved collision.** Given a legacy custom command whose name
    collides with a reserved operator ID, when migration or registration runs, then the
    name is rejected or reserved and cannot become management authority.
17. **Local no-key embedding pin.** Given a local OpenAI-compatible embedding URL without
    key, when `semantic.provider.add`, discover/validate, and `semantic.embedding.select`
    succeed, then the embedding binding is pinned with no secret stored.
18. **Local key secure ref.** Given a local endpoint with API key, when saved, then only
    secret_ref is persisted; key never appears in history/output/config JSON.
19. **Core catalog eligible model.** Given a core model with credential and validated
    semantic capability, when `semantic.model.list` runs, then it appears as eligible.
20. **Manual registration untrusted until validate.** Given
    `semantic.model.register` without successful validate, when selection is attempted,
    then it is rejected.
21. **Rerank name alone rejected.** Given a `/v1/models` name that implies rerank but no
    explicit profile/probe, when eligibility is computed, then the model is not selectable
    as reranker.
22. **Rerank profile A/B.** Given profile A (`/v1/rerank`) or B (structured chat) with
    successful validate, when `semantic.reranker.select` and `cutover` complete, then
    the binding records profile, version, and cost disclosure for profile B test/runtime.
23. **Restart preserves bindings.** Given pinned embedding and reranker bindings, when
    process restarts, then `semantic.binding.status` reports the same versions.
24. **LLM cannot change bindings.** Given a prompt/plugin/MCP attempt to change
    embedding or reranker, when the turn completes, then bindings and profiles are
    unchanged.
25. **Outage no silent failover.** Given pinned model unavailable under V1 default, when
    retrieval runs, then binding is `degraded`|`unavailable`, catalog+lexical fallback
    applies with degraded reason, and no alternate semantic model is auto-selected.
26. **Rotate-secret same identity.** Given `semantic.provider.rotate-secret` for the
    same model endpoint, when completed, then secret_ref/version changes, binding
    endpoint/model identity is unchanged, and audit is redacted.
27. **Embedding cutover explicit.** Given `semantic.embedding.select` and `reindex` for
    a dimension change, when `semantic.embedding.cutover` runs under CAS/confirmation,
    then the live alias switches atomically and `rollback` remains available; select or
    reindex alone MUST NOT activate the live alias.
28. **Reranker cutover no re-embed.** Given `semantic.reranker.select` after validate,
    when `semantic.reranker.cutover` is confirmed under CAS, then no full re-embedding
    is required by default and rerank cache/eval version invalidates.
29. **In-flight Task retains binding versions.** Given an in-flight Task that captured
    binding versions at start, when cutover activates new versions, then the in-flight
    Task retains the captured versions and new Tasks use the post-cutover versions.
30. **Profile C not reranker.** Given an embedding-similarity (profile C) candidate,
    when listed, then it is labeled embedding-similarity (or equivalent), NEVER
    cross-encoder or reranker, and is not selectable for the reranker slot.
31. **Wrong-dimension select rejected.** Given an embedding candidate whose probe
    reports incompatible dimension or failed validate, when `semantic.embedding.select`
    is attempted, then it is rejected with a structured error and the live binding is
    unchanged.
32. **Delete bound model confirmation.** Given a currently bound model, when
    `semantic.model.disable` or provider delete is requested, then confirmation and
    explicit replacement/disable policy are required.
33. **SSRF/TLS/DNS rebinding.** Given a blocked, non-TLS remote, or DNS-rebound
    private/metadata target without local-profile allowance, when
    `semantic.provider.add` or `test` runs, then it is rejected after post-resolution
    validation or requires explicit local insecure allowance with warning.
34. **Semantic surface parity.** Given the same `semantic.embedding.select` (or peer
    catalog command) from Settings, palette, slash, and CLI, when executed, then the
    same binding version and audit record are produced with zero admin transcript
    injection.
35. **Ordinary status never calls model.** Given `semantic.binding.status`,
    `semantic.embedding.show`, or `semantic.index.status`, when executed, then no model
    or provider generation call is made.
36. **Explicit validate may probe.** Given `semantic.model.validate` or
    `semantic.embedding.validate`, when executed, then only the fixed native probe runs
    (no conversation/transcript/tools) with cost/data disclosure.

## Security Requirements

- **Data sensitivity/classification.** Control plane reads/writes configuration,
  policy, scopes, versions, audit metadata, and secret **references**. Secrets
  themselves are high sensitivity and must never appear in command args, history,
  output, config JSON, or plain audit.
- **Authentication/authorization.** Mutations require operator principal and explicit
  scope. LLM, tool, MCP, plugin, and unauthenticated internal API clients cannot be
  config-mutating actors. Cross-project access fails closed.
- **Input validation.** Command IDs, scopes, versions, CAS tokens, and payloads are
  schema-validated and bounded. Reserved names cannot be registered by non-operator
  registries.
- **Cryptography in transit/at rest.** Secret backends (keychain/vault) hold secret
  material. Transport of internal operator API requires operator auth and CSRF/origin
  considerations when exposed beyond local single-user.
- **Logging/audit.** EventV2 records source, actor, scope, command/query ID,
  before/after version hashes, outcome — content-free and secret-free.
- **Error-handling information exposure.** Errors report structured codes
  (unauthorized, conflict, unavailable, invalid_scope, reserved_name) without secret
  or path leakage.

## Privacy Requirements

1. Administrative output is redacted and not auto-injected into transcript/context.
2. Audit and OTEL exclude secrets, prompts, tool payloads, personal paths, and full
   file content.
3. Output admin (export/share) is deny-by-default across projects.

## Observability

- Command spans/logs/metrics: command/query ID, source, scope, outcome, duration,
  conflict/idempotent flags — bounded enums only.
- Correlation with Feature 001 OTEL foundation and Feature 002 EventV2.
- No high-cardinality IDs as metric labels; no secret or content labels.

## Compatibility and Migration

- Existing domain FRs in Features 001–006 and Feature 008 remain authoritative for
  business logic / MCP runtime.
- Command surfaces in 001–006 and 008 MUST converge on Feature 007 canonical IDs
  (`budget.*`, `pools.*`, `mcp.*`, and other dotted domain IDs) and adapters. The
  registry generates aliases/syntax; clients MUST NOT hardcode divergent names.
  Feature 008 owns `mcp.*` domain schemas; Feature 007 owns registry/auth/audit.
- Legacy custom admin-like names: reject or reserve; non-admin custom commands may
  remain if they do not collide and are not management authority.
- Feature flags gate progressive rollout; no phase advance implied by this feature's
  specify status alone.
- Implementation order: Feature 007 Phase 1 management foundation and authority first
  (or before domain operator surface wiring); domain feature phases (for example
  Feature 001 Phase 2) deliver domain surfaces only and do not re-implement
  dispatch/auth/audit or redefine management authority.

## Out of Scope

- LLM as admin or management authority.
- PromptTemplate / custom command / MCP / plugin as admin authority.
- Arbitrary shell API access for administration.
- Parallel config or event store.
- Exposing secrets in args, history, output, config JSON, or plain audit.
- Automatic transcript injection of admin output.
- Public unauthenticated control API.
- Hardcoding provider/model IDs in product policy.
- Replacing domain business logic of Features 001–006 or Feature 008 MCP runtime.
- Accepting ADR-0003 (remains proposed until explicit acceptance).
- Runtime MCP tools/resources as Feature 007 command IDs or ToolRegistry admin.
- Automatic embedding/reranker fallback pools or silent model substitution.
- Architect/Manager selection of embedding/reranker bindings.
- Inferring rerank capability from model name alone.

## Clarification Questions

1. What is the exact local operator principal / RBAC model for single-user vs future
   multi-user, including manager-view read-only?
2. What is the full scope matrix (global/project/session/root-tree) per operation,
   including which ops forbid narrower scope?
3. What persistence schema, snapshot retention, and outbox/reconciliation design apply
   per authority?
4. What internal API transport and exposure (loopback-only vs remote) and CSRF/origin
   rules apply?
5. What final command naming and alias generation rules apply across palette/slash/CLI?
6. Which mutations require interactive confirmation vs non-interactive `--yes`?
7. What rollback retention window and snapshot count are defaults?
8. Which secret backends are mandatory vs optional (OS keychain, vault, env ref)?
9. How are plugin/MCP reserved-name lists versioned and published to integrators?
10. What is the offline operation matrix (which ops require network/provider)?
11. What is the App/Desktop parity phase order relative to TUI/CLI?
12. Is multi-user operator RBAC in V1 or deferred?
13. What audit retention and export policy apply?
14. What feature-flag and migration sequence deprecates legacy admin-like custom names?
15. Exact OpenAI-compatible adapter reuse and `/v1/rerank` / chat-rerank schemas?
16. Local network allow policy and SSRF denylist defaults?
17. Semantic probe fixtures, validation thresholds, and confirmation matrix?
18. Global vs project scope defaults for semantic profiles/bindings?

## Related Features and Decisions

- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed; semantic binding immutability and no silent substitution.
- [Feature 007 research](research.md) — evidence and confirmed native-only boundary; not a decision.
- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — smart/routing/telemetry/`budget.*`/`pools.*`; route record captures binding versions; Architect/Manager do not select embedding/reranker.
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md) — process/task control; reindex/probe jobs; binding version metadata.
- [Feature 003 Scheduled Jobs](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md) — jobs domain ops; reconcile uses pinned binding; cannot change it.
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md) — langlock domain ops; multilingual eval labels.
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — output consume vs admin; large probe/index outputs.
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — domain contracts for profiles/descriptors/bindings; blue-green index; no silent failover.
- [Feature 008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP runtime completeness; owns `mcp.*` domain schemas; Feature 007 owns registry/auth/audit/adapters only.
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)

## Initial Traceability Matrix

| Outcome                    | Requirements            | Acceptance scenarios | Phase |
| -------------------------- | ----------------------- | -------------------- | ----- |
| Native-only authority      | FR1–FR7                 | 2–4, 8, 16, 24       | 1     |
| Unified dispatcher + reuse | FR8–FR12                | 1, 9                 | 1     |
| Principals and scopes      | FR13–FR15               | 8, 11                | 1     |
| CAS / audit / secrets      | FR16–FR18               | 9–10, 18, 26         | 1     |
| Adapter parity             | FR19–FR21               | 1, 5, 15, 34         | 1–2   |
| Todo data vs setup plane   | FR22–FR24               | 12                   | 1     |
| Output consume vs admin    | FR25–FR26               | 13                   | 1     |
| Domain operation catalog   | FR27–FR32               | 6–7, 14              | 1–2   |
| Semantic fixed bindings    | FR33–FR40               | 17–36                | 1     |
| MCP operator catalog       | FR41–FR44               | 15 (via 008 AC)      | 1–2   |
| Security/privacy/obs       | NFRs, security, privacy | 2, 8, 10–11, 33      | 1–2   |
| Migration / reserved names | FR7, FR12               | 3, 16                | 2     |
