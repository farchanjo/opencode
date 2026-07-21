---
id: 019f83db-cc66-7bc1-a691-16f3081dc08f
number: 046
slug: expose-the-hierarchy-capability-and-budget-operator-config
status: implemented
created_at: 2026-07-21T08:47:27.8465Z
---
# Feature Specification: Expose The Hierarchy Capability And Budget Operator Config

Feature: 046-expose-the-hierarchy-capability-and-budget-operator-config
Created: 2026-07-21

## Summary

The routing enforcement config (`RoutingConfig.Enforcement`) carries three
operator-tunable policy blocks — `budget`, `hierarchy`, and `capability` — but
the operator surface only exposes five of the budget block's leaves
(`max_turns`, `max_context_tokens`, `max_output_tokens`, `max_workers`,
`token_budget`) through `budget.show`/`budget.set`. The remaining budget leaves
and the entire `hierarchy` and `capability` blocks are unreachable from both the
`op` CLI and the operator TUI: an operator cannot view or change them without
hand-editing config JSON.

This feature closes that gap. It exposes EVERY `budget`/`hierarchy`/`capability`
enforcement leaf for read AND write through both surfaces, driven by a single
leaf registry so the `op` CLI and the TUI stay in exact parity (same leaves,
same validation, same effective-config read). Writes are scope-aware
(global/project via the Feature 034 `--scope` flag), CAS-versioned over the same
routing Config.Service authority the existing budget/smart/pools writes bind,
and persist only the leaves the operator actually set.

## User Stories

- As an operator I want to view every hierarchy, capability, and budget
  enforcement leaf through `op` so that I can audit the effective routing policy
  without reading raw config files.
- As an operator I want to set any hierarchy, capability, or budget leaf through
  `op` with an explicit scope so that I can tighten or adjust routing
  enforcement per project or globally.
- As an operator I want the TUI operator screens to show and edit the same
  leaves with the same validation as `op` so that both surfaces behave
  identically ("a interface tem que ter a mesma experiência do comando").
- As an operator I want an invalid value (out of bounds, wrong enum member) to
  be rejected with a clear typed error so that I never silently persist a broken
  policy.

## Functional Requirements

1. The operator surface MUST expose every leaf of
   `RoutingConfig.Enforcement.budget` (`max_turns`, `max_context_tokens`,
   `max_context_bytes`, `max_output_tokens`, `max_output_bytes`, `max_workers`,
   `max_delegation_depth`, `retrieval_top_k`, `rerank_top_k`, `max_skill_chunks`,
   `max_skill_tokens`, `time_budget_ms`, `cost_budget_usd`, `token_budget`,
   `retry_depth`, `validation_depth`, `escalation_threshold`) for read and write.
2. The operator surface MUST expose every leaf of
   `RoutingConfig.Enforcement.hierarchy` (`max_depth`, `orchestration_only`) for
   read and write.
3. The operator surface MUST expose every leaf of
   `RoutingConfig.Enforcement.capability` (`metadata_source`, `unknown_policy`,
   `probing_enabled`) for read and write.
4. A single leaf registry (leaf path, display label, value kind, bounds, enum
   members) MUST drive BOTH the `op` CLI parse/validation and the TUI field
   declarations, so the two surfaces cannot drift out of parity.
5. Reads MUST project the effective (layered) config — project shadows global
   shadows the built-in default — never a partial or fabricated view. Existing
   `budget.show`/`budget.status`, `pools.show`, and `smart.status` output shapes
   MUST be extended, never replaced (backward compatible).
6. Writes MUST be scope-aware: a project write persists to the `routing`
   authority; a global write requires the explicit `--scope global` flag and
   persists to `global:routing`. A project write MUST NOT persist a `global:*`
   authority (Feature 032/035 authority rules).
7. Writes MUST persist ONLY the leaves the operator actually set, merged onto the
   fresh on-disk config at commit time (no wholesale snapshot that could go
   stale — the Feature 035 lesson). Sibling routing fields (`activation`,
   `models.role_pools`, untouched enforcement leaves) MUST be preserved.
8. Writes MUST be CAS-versioned through the same routing Config.Service authority
   and `mutateAuthority` commit pipeline the existing budget/smart/pools writes
   use; the backend MUST NOT self-commit. A stale version MUST degrade to a typed
   `version_conflict`; a config-unreachable failure to a typed `unavailable`.
9. Each leaf's value MUST be validated at the write boundary against its schema
   constraint — numeric bounds (positive/non-negative, the `max_depth` 1..2 and
   `max_delegation_depth` 0..2 ranges) and enum membership
   (`metadata_source` ∈ {catalog, override, observed}, `unknown_policy` ∈
   {deny, allow}). An invalid value MUST be rejected with a typed
   `invalid_argument` naming the offending leaf, before any plan is produced —
   never a silent accept.
10. The TUI MUST prefill each field from the effective (layered) config read and
    re-read on a scope switch (mirror Feature 040 `prefillFromRead`), and persist
    edits through the same CAS authority as the CLI.
11. The surface MUST NOT expose or persist any secret/credential; only the
    bounded numeric/enum/boolean policy leaves are read or written.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes only the
  routing enforcement policy leaves (numeric limits, two small enums, three
  booleans). These are operational-configuration values, not secrets or personal
  data. No credential, token, header value, or free-form user content crosses the
  surface.
- **Authentication/authorization.** No new authenticated surface is introduced.
  The new reads and writes flow through the SAME Feature 007 operator principal,
  dispatcher, authorization, and confirmation policy the existing
  `budget.*`/`smart.*`/`pools.*` commands use. Global-scope writes require the
  explicit `--scope global` flag; a project principal MUST NOT persist a global
  authority (Feature 032/034/035 authority composition, unchanged).
- **Input validation.** The untrusted input is the operator-supplied leaf value
  (a CLI flag string or a TUI field entry). Each value is parsed to its typed
  kind and validated against its schema constraint (numeric bounds, enum
  membership) at the write boundary; out-of-range, non-numeric, or unknown-enum
  input is rejected with a typed `invalid_argument` before any mutation plan is
  produced. Unknown leaf names are rejected, not silently ignored.
- **Cryptography in transit/at rest.** This feature persists no data that
  requires encryption; it writes bounded policy leaves to the existing routing
  Config.Service document through the unchanged CAS seam. No new transport is
  opened.
- **Logging/audit.** Every mutation emits exactly one bounded, secret-free
  operator audit event (command id, principal id, target, outcome) through the
  existing Feature 007 audit sink — the same event the current budget/smart/pools
  writes emit. No config payload fragment or leaf value is logged.
- **Error-handling information exposure.** Error paths return typed, bounded
  envelopes (`invalid_argument` naming the leaf, `version_conflict` with the
  expected/actual version tokens, `unavailable` with a bounded reason). No error
  message carries a secret, a raw config fragment, or a stack trace.

## Acceptance Scenarios

Given an operator on a project with no explicit routing config
When  the operator runs `op capability show`
Then  the effective capability leaves (metadata_source, unknown_policy,
      probing_enabled) are shown, projected from the layered config.

Given an operator sets `op hierarchy set --max-depth 1 --scope project`
When  the write commits
Then  only `enforcement.hierarchy.max_depth` is changed to 1 on the project
      `routing` document, the sibling `orchestration_only`, `activation`, and
      `role_pools` are preserved, and the CAS version is bumped.

Given an operator sets `op budget set --cost-budget-usd -5`
When  the value is validated at the write boundary
Then  the command is rejected with a typed `invalid_argument` naming
      `cost_budget_usd`, and nothing is persisted.

Given an operator sets `op capability set --unknown-policy maybe`
When  the enum value is validated
Then  the command is rejected with a typed `invalid_argument` naming
      `unknown_policy`, listing the allowed members.

Given the operator TUI capability screen is opened on a project
When  the screen prefills its fields
Then  each field shows the effective (layered) value, and switching the scope
      selector to global re-reads and re-prefills from the global config.

Given every leaf the `op` CLI can edit
When  the operator opens the corresponding TUI screen
Then  the SAME leaves are editable with the SAME validation and effective-config
      read (op ↔ TUI parity).

## Observability

Each read and write reuses the existing operator command telemetry: the
dispatcher span carries the command id, scope kind, and outcome, and every
mutation bumps the content-free operator-mutation counter already emitted by the
Feature 007 commit pipeline. No new metric label set or trace span is added;
label cardinality stays bounded to the closed command-id/scope/outcome sets.
Telemetry is exported via OTLP from the operator application boundary per
`doc/arch/observability/observability.md`.

## Clarifications
