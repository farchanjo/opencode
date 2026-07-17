# Operator Control Plane Research

Feature: [007 Unified Native Operator Control Plane](spec.md)

This note records confirmed decision evidence for the unified native Operator Control
Plane. It is not an ADR and does not authorize implementation. Requirements live in
`spec.md`; the architectural decision is recorded in
[ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)
(proposed).

## Confirmed native-only decision (user-confirmed)

The following points are confirmed product decisions. They must not be reopened as
clarification questions that reverse the authority model.

1. **Management is native-only.** All setup, configuration, and management uses the
   Feature 007 Operator Control Plane and native Settings / menu / palette /
   native-slash / CLI / App / Desktop adapters calling typed core domain
   commands/queries directly.
2. **Never authority.** Config.command / custom templates, `session.command` prompt
   path, ToolRegistry, MCP tools/prompts, plugins, skills, shell commands issued by an
   LLM, and free-form model instructions are never management authority.
3. **Slash pre-prompt.** Native slash is intercepted before prompt admission and
   transcript. Admin operations make zero provider/model calls, tokens, and cost by
   default. Output is not added to Message/Part/context by default.
4. **Mutation contract.** Mutations require operator principal, explicit scope,
   version/CAS, idempotency, and audit. Secret refs only.
5. **Orchestration vs setup.** Architect/Manager may recommend route/workers/skills/
   effort inside the execution envelope. They cannot mutate config, pools, budgets,
   endpoints, credentials, index, job definitions, Lang Lock, retention, or quota.
6. **LLM read-only envelope.** The LLM receives effective read-only policy/config in
   the trusted execution envelope / system boundary. It cannot call admin commands to
   query or set configuration.
7. **No parallel stores.** Reuse Config.Service, Policy, Permission, EventV2, and
   internal SDK/server. No parallel config or event store.
8. **Separate registries.** Operator command registry is separate from PromptTemplate,
   CommandV2, and `session.command`. Reserved operator IDs cannot be registered by
   plugin/MCP/custom registries.
9. **Feature 007 is management foundation.** Domain features own business logic;
   Feature 007 owns command/query/auth/audit adapters. Feature 007 is not runtime
   execution authority.

## Todo: data plane vs setup plane

- Core auto-initializes, rehydrates, and version-gates Todo and configures mandatory
  policy natively (Features 001/002).
- Model may propose/update semantic work-item state via restricted runtime operation
  under permission/CAS — **data plane**, not setup.
- Model cannot set Todo policy/exemptions/retention/override, clear required list,
  bypass completion gate, or edit child Todo.

## Output: consume vs admin

- **Consume (authorized):** stat, read, follow.
- **Operator admin:** export, share, release, delete, purge, retention, quota.

## Routing test and telemetry test

- Feature 001 `routing test` baseline is always local deterministic with zero model
  calls (FR52 / AC55). Feature 007 enforces this as `routing.test`. Future provider
  diagnostic is a separate explicit operator op.
- `telemetry.test` emits only a clearly marked OTLP test signal (or connectivity mode);
  never an LLM call.

## Canonical domain catalog (conceptual IDs)

Stable conceptual domains use dotted IDs: `telemetry.*`, `smart.*`, `routing.*`,
`budget.*`, `pools.*`, `process.*` / `task.*`, `jobs.*`, `langlock.*`, `output.*`,
`semantic.*`, `mcp.*`. The Feature 007 operator registry generates surface
aliases/syntax; clients must not hardcode divergent admin names.

Complete MCP management IDs (exhaustive; schemas SSOT in Feature 008; Feature 007
registry/auth/audit only):
`mcp.server.list|add|update|test|connect|disconnect|reconnect|disable|delete|status|capabilities`,
`mcp.auth.start|finish|remove|status`,
`mcp.resource.admin.list|templates|read|subscribe|unsubscribe|policy.show|policy.set`,
`mcp.logging.level.show|set`,
`mcp.experimental.status|enable|disable`,
`mcp.extension.status|enable|disable`.
Runtime LLM tools/resources use Feature 008 canonical adapter under Permission —
never Feature 007 command IDs or ToolRegistry admin.

Complete semantic management IDs (exhaustive; no open set):
`semantic.provider.list|add|update|test|disable|delete|rotate-secret`,
`semantic.model.list|discover|register|validate|disable`,
`semantic.embedding.show|select|validate|reindex|cutover|rollback`,
`semantic.reranker.show|select|validate|cutover|rollback`,
`semantic.binding.status|history`,
`semantic.index.status|test|reindex|reconcile|show-collections`.
Schemas SSOT in Feature 006; Feature 007 references only. Runtime retrieve/rerank is
data plane and only reads pinned `SemanticModelBinding`.

## Fixed embedding/reranker bindings (user-confirmed)

Operator pins one embedding and one reranker via native panel/control plane.
Architect/Manager/LLM/router/plugin/MCP cannot change bindings or silently substitute
models. Rerank requires explicit compatibility profile; profile C is embedding-similarity
only (never cross-encoder/reranker badge). Explicit `cutover` (CAS/confirmation) activates
bindings; select/reindex alone do not. Embedding change → blue-green reindex then cutover;
reranker change → no re-embed by default. `rotate-secret` updates secret ref only. V1
default unavailable → catalog+lexical fallback with degraded reason (unless fail-closed);
never auto model swap.

## Delivery phases (factual)

Feature 007 is Phase 1 management foundation and authority. Feature 001 “Phase 2”
labels domain surface delivery only; it does not redefine management authority.

## Alignment patches expected in sibling features

- **001:** AC44 aligned with FR52/AC55; budget/pool mutation only via `budget.*` /
  `pools.*`; route record may capture semantic binding versions; Architect/Manager do
  not select embedding/reranker; sampling (Feature 008) cannot bypass Smart/budget.
- **002/003/004/006:** Feature 007 canonical IDs; 006 owns domain binding contracts;
  003 reconcile uses pinned binding only; 002 maps MCP call/task children.
- **005:** classify consume vs admin authorization for output operations; MCP large
  results use OutputRef (Feature 008).
- **008:** owns MCP runtime and `mcp.*` domain schemas; Feature 007 owns
  registry/auth/audit/adapters only; `mcp.resource.admin.*` vs runtime Permission
  adapter (no dual authority).
- **ADR-0001 / ADR-0002 / ADR-0003:** operator authority; no silent semantic
  substitution; MCP never admin path.

## Out of research scope

Implementation code, provider/model hardcoding, accepting ADR-0003, clarify/plan/tasks
phases, and parallel admin systems.
