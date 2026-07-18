---
status: accepted
date: 2026-07-17
deciders: [project maintainers]
---

# 0003 — Operator Control Plane and native command authority

## Context and Problem Statement

Features 001–006 and Feature 008 each require operator management (telemetry,
smart/routing, process control, jobs, Lang Lock, OutputSpool, semantic index, MCP
servers) and already state that administration is native-only. Without a single control
plane, each feature risks a parallel command registry, divergent Settings/CLI/slash
behavior, LLM/prompt/MCP admin paths, or secret leakage. The product needs one
authority model: setup and management only through a unified native core control plane;
prompt, custom, MCP, plugin, and ToolRegistry paths never hold management authority.

## Decision Drivers

- One management foundation for all setup/config/management surfaces.
- Zero LLM involvement for admin by default (no tokens, no transcript injection).
- Reuse Config.Service, Policy, Permission, EventV2, and internal SDK/server.
- Safe mutations: operator principal, explicit scope, CAS, idempotency, audit.
- Domain features keep business logic; control plane owns dispatch/auth/audit/adapters.
- Align Features 001–008 without inventing parallel config or event stores.
- Local single-user V1 with explicit deferral of multi-user RBAC and vault backends.
- Loopback-only internal operator API in V1; App/Desktop parity deferred to Phase 2.

## Considered Options

- **Unified native Operator Control Plane (Feature 007)** — selected: sole management
  authority; typed commands/queries; separate operator registry; thin parity adapters.
- **Per-feature command registries with shared conventions only** — rejected: drift,
  duplicate auth/audit, inconsistent slash/transcript isolation.
- **LLM / prompt / MCP / plugin admin** — rejected: not operator-authenticated, pollutes
  transcript, cannot guarantee zero-cost offline admin, insecure secret handling.
- **Parallel config/event store for admin** — rejected: splits authority from
  Config.Service / EventV2.
- **ToolRegistry-exposed admin tools** — rejected: models become config-mutating actors.

## Decision Outcome

Chosen option: **unified native Operator Control Plane (Feature 007) as sole
management authority**.

We choose **management and setup only via the unified native core control plane**.

- Prompt templates, custom commands, `session.command`, ToolRegistry, MCP
  tools/prompts, plugins, skills, shell commands issued by an LLM, and free-form model
  instructions are **never** management authority.
- Native slash is intercepted before prompt admission/transcript; admin operations make
  zero provider/model calls/tokens/cost by default; output is not added to
  Message/Part/context by default.
- Thin adapters (TUI Settings/menu/Ctrl+P/native slash, App/Desktop, CLI human+JSON,
  internal API/SDK) all invoke the same typed command/query IDs and domain services.
- Operator command registry is separate from PromptTemplate / CommandV2 /
  `session.command`. Reserved operator IDs cannot be registered by plugin/MCP/custom
  registries.
- Mutations require operator principal, explicit scope, version/CAS, idempotency, and
  audit; secret references only.
- Architect/Manager may recommend route/workers/skills/effort inside the execution
  envelope; they cannot mutate config/pools/budgets/endpoints/credentials/index/job
  definitions/Lang Lock/retention/quota.
- LLM receives effective read-only policy/config in the trusted execution envelope; it
  cannot call admin commands to query or set configuration.
- Feature 007 is the management foundation, not runtime execution authority. Domain
  features own business logic; Feature 007 owns command/query/auth/audit adapters.
- **Semantic embedding/reranker bindings** (Feature 006 owns schema SSOT;
  Feature 007 owns the complete `semantic.*` command catalog including
  `rotate-secret`, `cutover`, and `semantic.index.*`) are operator-pinned and
  immutable at runtime: LLM, router, agent, plugin, and MCP MUST NOT set, update,
  delete, or silently substitute embedding or reranker models. V1 default when
  binding/index is unavailable is catalog+lexical fallback with degraded reason
  (unless operator fail-closed) — never automatic model swap. Secret rotation uses
  `semantic.provider.rotate-secret` and updates secret references only, without
  changing endpoint/model identity. Embedding activation requires explicit native
  `cutover` under CAS/confirmation after reindex; select/reindex alone do not activate
  the live alias. Reranker changes do not re-embed by default. Profile C
  (embedding-similarity) is never labeled or selected as a cross-encoder/reranker.
- **MCP operator domain** (Feature 008 owns MCP runtime and `mcp.*` domain schema
  SSOT; Feature 007 owns the complete `mcp.*` command catalog registration, auth,
  audit, and adapters): operator-only IDs are `mcp.server.*`, `mcp.auth.*`,
  `mcp.resource.admin.*`, `mcp.logging.*`, `mcp.experimental.*`, and
  `mcp.extension.*`. Runtime LLM tools/resources use Feature 008's canonical adapter
  under Permission only — never Feature 007 command IDs and never ToolRegistry admin.
  Experimental Tasks/sampling/elicitation remain disabled by default.

### V1 decisions accepted with this ADR (Feature 007 clarify package)

User-approved V1 package (2026-07-17); full matrices live in Feature 007 `spec.md`
Clarification Outcomes:

1. **Principals.** Local single-user operator. Principals: `operator`, `system`, optional
   read-only `manager-view`. Multi-user RBAC deferred beyond V1.
2. **API exposure.** Internal operator API is loopback-only in V1. No public remote
   control API in V1. CSRF/origin enforcement is mandatory when any future non-loopback
   exposure is introduced.
3. **Scopes.** Project scope is default for project-bound config. Global is for templates
   only (copy-on-write into project). Session scope for process/task ops. Root-tree for
   workspace ops. Hard policy cannot be relaxed by a narrower scope.
4. **Persistence.** Reuse Config.Service and EventV2. Atomic writes, CAS, and
   idempotency are always on. Outbox/reconciliation applies only to external systems.
   Snapshot retention: 10 snapshots or 30 days, whichever first. Audit retention: 90 days.
   Cutover keeps an explicit rollback slot.
5. **Naming.** Canonical IDs are dotted (`domain.operation`). Surface aliases (slash/CLI/
   palette) are registry-generated; clients MUST NOT hardcode divergent names.
6. **Confirmations.** Cutover, rollback, delete, disable, purge, secret rotate,
   experimental enable, export, and share require interactive confirmation. `--yes` is
   allowed only for authenticated non-TTY CLI; native slash never auto-yes.
7. **Secrets.** OS keychain is mandatory for stored secrets. Env-ref is allowed for CI.
   Vault and multi-user secret backends are deferred. Plaintext secret persistence is
   forbidden.
8. **Reserved IDs.** Reserved operator IDs are versioned in SDK and docs. Collisions at
   plugin/MCP/custom registration are rejected.
9. **Offline.** Offline matrix is normative (status/set local ops work offline; network
   ops report explicit `unavailable`).
10. **Delivery.** Phase 1: core + TUI/CLI/internal SDK. App/Desktop parity is Phase 2.
11. **Semantic defaults.** LangLock and semantic profiles/bindings default to project
    scope; global templates use copy-on-write. Unavailable semantic path defaults to
    lexical/catalog fallback; fail-closed is opt-in.
12. **SSRF and probes.** SSRF deny/revalidation and multilingual fixed semantic probes
    follow Feature 006/007 spec MUST rules; no open parameters remain for V1.

**This ADR is accepted** (user-approved V1 package, 2026-07-17). ADR-0001 and ADR-0002
remain proposed.

### Consequences

#### Positive

- Single authority model for operator management across Features 001–008.
- Eliminates LLM/prompt/MCP/plugin admin paths and parallel command registries.
- Enables consistent audit, CAS, offline status, and secret redaction.
- Domain features can register canonical operation IDs without re-implementing adapters.
- Closed V1 principal, scope, confirmation, offline, secret, and retention matrices
  unblock plan/tasks without reopening native-only authority.

#### Trade-offs

- Multi-user RBAC, vault backends, and public/remote operator API are deferred; V1 is
  local single-user loopback.
- App/Desktop parity is Phase 2; Phase 1 ships core + TUI/CLI/internal SDK only.
- Migration must reject or reserve legacy custom admin-like names without breaking
  non-admin custom commands.
- Domain feature specs must normalize wording to Feature 007 IDs (related patches;
  business logic remains domain-owned).
- Isolation harness and sandbox prefix (port 14096, `.dev/`, no prod register/service/
  OAuth) are mandatory before any implement-phase OpenCode process.

#### Follow-ups

- Feature 007 plan/tasks implement Phase 1 slices and isolation harness first.
- ADR-0001 / ADR-0002 acceptance remains separate.
- Multi-user, vault, and non-loopback API require a new ADR before implementation.

## Related

- Feature specification: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Feature research: [007 research](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/research.md)
- Related feature: [001 Smart Agent Routing and Telemetry Foundation](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Related feature: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Related feature: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Related feature: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Related feature: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Related feature: [006 Semantic Agent and Skill Retrieval (Milvus)](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- Related feature: [008 Complete MCP Client Tools and Resources Lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP runtime; `mcp.*` schemas; Feature 007 registry/auth only
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md)
