# Implementation Plan: Unified Native Operator Control Plane (Feature 007)

Feature: 007-add-a-unified-native-operator-control-plane-for-all-opencode  
Status target: planned (after this plan is complete)  
ADR: [ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md) **accepted**  
Spec: [spec.md](spec.md) (all Q1–Q18 closed; feature status advanced via Speckit phases)

## Overview

Build the **Phase 1 management foundation**: a unified native Operator Control Plane
that is the sole authority for setup, configuration, and operator management across
OpenCode. Domain features (001–006, 008) own business logic and register operations;
Feature 007 owns typed command/query dispatch, principals, scopes, CAS, idempotency,
audit, reserved-name enforcement, secret references, and thin adapters (TUI, CLI,
internal loopback API/SDK).

**Not in this plan:** application code implementation (implement phase later), App/
Desktop parity (Phase 2), multi-user RBAC, vault backends, public remote API.

## Goals

1. One command ID → one domain service → identical effective state/version/audit on
   every Phase 1 surface.
2. Zero LLM tokens/transcript for admin by default; native slash pre-prompt intercept.
3. Reuse Config.Service and EventV2; no parallel stores.
4. Isolation harness first: sandbox prefix, port 14096, `.dev/` ignore, wrapper; prove
   production paths unchanged before any other slice.
5. Domain services consumed via **ports/stubs** until domain features implement logic;
   Feature 007 does not pretend unimplemented domain behavior.

## Non-goals

- Implementing Smart Routing, Jobs, LangLock, OutputSpool, Semantic, or MCP domain logic.
- Accepting ADR-0001 / ADR-0002.
- Editing `~/.config/opencode` or production processes.
- Real OS service registration, real OAuth, or non-loopback listeners in V1.

## Technical Approach

### Architecture layers

```
Adapters (inbound)
  TUI Settings / palette / native slash
  CLI human + JSON
  Internal loopback HTTP API + SDK
        |
        v
Application (Feature 007)
  OperatorCommandRegistry
  CommandQueryDispatcher (CQRS-light)
  Principal / Scope / Auth
  Confirmation gate
  Idempotency + CAS coordinator
  Audit projector (EventV2)
  SecretPort (interface)
        |
        v
Domain ports (interfaces owned by application)
  TelemetryPort, SmartPort, RoutingPort, BudgetPort, PoolsPort,
  ProcessPort, TaskPort, JobsPort, LangLockPort, OutputPort,
  SemanticPort, McpAdminPort, ConfigPort, EventPort
        |
        v
Outbound adapters
  Config.Service adapter (existing)
  EventV2 adapter (existing)
  OS Keychain adapter (SecretPort)
  Env-ref adapter (CI only)
  Domain service adapters OR stubs (per Feature 001–006/008 readiness)
```

Dependency rule: adapters → application → domain ports. Domain/application MUST NOT
import TUI/CLI/HTTP frameworks. Composition root wires concrete adapters.

### Packages and modules to reuse (no parallel stores)

| Concern             | Existing location (reuse)                                   | Feature 007 addition                                        |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Config authority    | `packages/opencode/src/config/config.ts` (`Config.Service`) | ConfigPort adapter only                                     |
| Events / audit      | core EventV2 + `packages/opencode/src/event-v2-bridge.ts`   | Audit projector fields                                      |
| Permission / Policy | existing Permission/Policy modules                          | Scope checks via ports                                      |
| Workspace control   | `packages/opencode/src/control-plane/` (workspace)          | **Leave as-is**; new operator plane is separate module tree |
| Server HTTP         | `packages/server`, `packages/opencode/src/server`           | Loopback operator routes                                    |
| CLI                 | `packages/cli`, `packages/opencode/src/cli`                 | `opencode op …` surface                                     |
| TUI                 | `packages/tui`                                              | Settings / palette / slash intercept                        |
| Schema / Protocol   | `packages/schema`, `packages/protocol`                      | Operator command schemas                                    |
| SDK                 | `packages/sdk`, `packages/sdk-next`, `packages/client`      | Typed operator client                                       |
| Credentials         | `packages/core/src/credential`, auth modules                | SecretPort keychain adapter                                 |

**New module tree (Phase 1 target layout):**

```
packages/core/src/operator/          # pure schemas, registry types, errors (if shared)
packages/opencode/src/operator/      # dispatcher, registry, auth, confirmation, ports
  domain/                            # zero framework; command IDs, principal VOs
  application/                       # use cases, ports
  adapters/inbound/                  # slash, palette hooks, CLI, HTTP handlers
  adapters/outbound/                 # config, eventv2, keychain, domain stubs
  main.ts                            # composition root slice
packages/opencode/src/dev/sandbox/   # isolation harness, wrapper, port 14096
```

Exact final paths may nest under existing trees if package conventions require; plan
forbids a second Config or Event store under any path.

### Incremental Phase 1 slices

| Slice | Name                                               | Delivers                                                                                                                        | Depends     |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| S0    | Isolation harness                                  | `.dev/` layout, sandbox env prefix, port **14096**, local wrapper, tests proving prod paths unchanged, `.gitignore` for `.dev/` | —           |
| S1    | Schemas / principals / registry                    | Dotted command IDs, principal enum, scope enum, reserved ID catalog version, registry API                                       | S0          |
| S2    | Command/query dispatcher                           | CQRS-light dispatch, schema validation, error taxonomy, zero-LLM guarantee                                                      | S1          |
| S3    | Config persistence / CAS / idempotency / snapshots | ConfigPort → Config.Service; CAS; idempotency store; 10/30d snapshots; rollback slot                                            | S2          |
| S4    | Secure secret port                                 | SecretPort; OS keychain adapter; env-ref CI; plaintext reject                                                                   | S2          |
| S5    | EventV2 audit / outbox                             | Audit fields (source, actor, scope, id, versions, outcome); external-only outbox                                                | S2, S3      |
| S6    | Internal loopback API / SDK                        | Loopback bind, operator auth, typed SDK, reserved catalog export                                                                | S2–S5       |
| S7    | Native slash interception                          | Pre-prompt intercept; no transcript; confirmation gate; never auto-yes                                                          | S2, S5      |
| S8    | CLI human + JSON                                   | `opencode op …`; offline/`unavailable` mapping; `--yes` rules                                                                   | S2, S5      |
| S9    | TUI Settings / palette                             | Same command IDs; Settings panels for representative domains                                                                    | S2, S5, S7  |
| S10   | Reserved names / migrations / flags                | Feature flag sequence; collision reject; migration of legacy admin-like names                                                   | S1, S7–S9   |
| S11   | Tests + OTEL                                       | Unit / integration / contract / e2e / security; content-free OTEL labels                                                        | all Phase 1 |

**Phase 2 (explicit deferred):** App + Desktop Settings/commands parity only.

### Domain dependency via ports/stubs

Feature 007 implements control-plane foundation and **representative** domain
registrations (e.g. `telemetry.status`, `langlock.status`, `semantic.binding.status`,
`mcp.server.list`) with:

- Real dispatch/auth/audit/adapters.
- Domain ports that call real services **when present**.
- Deterministic **stubs** returning structured `unavailable` or fixture state when the
  domain feature is not yet implemented.

Stubs MUST NOT invent domain business outcomes beyond “not implemented / unavailable”.

## Data model and migration strategy

See [data-model.md](data-model.md).

- Persist operator config mutations through **Config.Service** authorities only.
- Persist audit via **EventV2** records (no second event table for admin).
- Idempotency keys: durable map keyed by `(principal, commandId, idempotencyKey)` with
  outcome payload; TTL aligned with snapshot window.
- Snapshots: versioned config snapshots (count ≤ 10 or age ≤ 30 days).
- Migrations: additive schema for reserved catalog version, feature flags, idempotency
  table if not expressible in existing Config/Event stores; prefer existing storage
  primitives before new tables.
- Drizzle/SQL migrations live in `packages/core` when a new table is unavoidable.

## API and command contracts

See [contracts/](contracts/).

- Canonical command envelope: `{ id, principal, scope, version?, idempotencyKey?, confirm?, payload }`.
- Result envelope: `{ ok, id, version, effective, outcome, auditId?, error? }`.
- Error taxonomy (closed): `unauthorized`, `forbidden_scope`, `conflict`, `idempotent_replay`,
  `invalid_argument`, `reserved_name`, `confirmation_required`, `unavailable`,
  `secret_backend`, `transport_error`, `not_implemented`.
- Internal HTTP: loopback only, port **14096** in sandbox; production loopback uses
  existing server bind rules without public exposure.
- SDK: generated from protocol/schema; exports reserved operator ID catalog.

## State machines

### Mutation lifecycle

```
received → authenticated → authorized(scope) → validated
  → confirmation_gate → cas_begin → domain_execute
  → persist_atomic → audit → response
```

Failures short-circuit with structured error; no partial silent write.

### Semantic binding cutover (command plane only)

```
validate → select(staged) → reindex(embedding only) → cutover(CAS+confirm) → live
                                                              ↘ rollback_slot
```

Select/reindex alone never activate live alias.

### Feature flag rollout

```
off → registry_read → reserved_reject → mutations → adapters → api_sdk → on
```

## Security and threat boundaries

| Threat                         | Mitigation                                                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| LLM as admin                   | No admin tools in ToolRegistry; slash pre-prompt; prompt cannot mutate |
| Subagent curl to API           | Operator principal required; no credential mint to LLM                 |
| Secret leakage                 | SecretPort keychain; redacted outputs; audit secret-free               |
| SSRF via semantic provider URL | Parse + DNS revalidation; deny metadata/private unless local allowance |
| CSRF on future non-loopback    | Mandatory when non-loopback introduced (out of V1)                     |
| Cross-project privilege        | Fail closed on project-bound principal                                 |
| Parallel admin path            | Reserved name reject at plugin/MCP/custom registration                 |
| Prod pollution from dev        | Isolation harness; sandbox prefix; tests assert prod paths untouched   |

## Rollback strategy

| Layer            | Rollback                                                             |
| ---------------- | -------------------------------------------------------------------- |
| Config mutation  | Snapshot restore (10/30d window)                                     |
| Semantic cutover | Explicit `rollback` using retained rollback slot                     |
| Feature flag     | Disable `operator_control_plane`; adapters no-op to prior behavior   |
| Migration        | Additive migrations with reverse notes; reserved catalog version pin |
| Deploy           | No OS service install in V1; process-local only                      |

## Isolation harness (first implementation task)

| Item         | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Sandbox root | `.dev/opencode-operator/` (gitignored)                                          |
| Env prefix   | `OPENCODE_DEV_OPERATOR_=1`, `OPENCODE_CONFIG_DIR=.dev/opencode-operator/config` |
| Port         | **14096** (loopback)                                                            |
| Wrapper      | `scripts/dev/opencode-operator-sandbox` (or package-local equivalent)           |
| Forbidden    | `~/.config/opencode`, system service register, real OAuth, non-loopback bind    |
| Proof tests  | Assert default config paths and prod ports unchanged when wrapper not used      |

All OpenCode executions for Feature 007 development and tests MUST go through the
sandbox wrapper.

## Testing matrix

| Layer       | Scope                                                                             | How                                                                 |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unit        | Domain VOs, registry, CAS logic, confirmation rules, error mapping                | Pure tests; no I/O                                                  |
| Integration | ConfigPort, EventV2 audit, keychain adapter, dispatcher + stub ports              | Real local stores under `.dev/`; Testcontainers only if DB required |
| Contract    | OpenAPI/protocol vs SDK; reserved catalog version                                 | Spec-driven                                                         |
| E2E         | CLI human+JSON; slash intercept; Settings path (headless where possible)          | Sandbox wrapper only                                                |
| Security    | Unauthenticated API deny; reserved name reject; secret redaction; SSRF URL reject | Dedicated suite                                                     |

No mocking of Config/Event durability in integration tests; use sandbox files/DB.

## Observability

- Spans/metrics: command ID, source, scope, outcome, duration, conflict/idempotent flags.
- Bounded enums only; no secret, path, or content labels.
- Align with Feature 001 OTEL cardinality rules.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths only (do **not** open whole repo). Applied for implement-phase guard:

```toml
specScopeGlobs = [
  "packages/core/src/operator/**",
  "packages/opencode/src/operator/**",
  "packages/opencode/src/dev/sandbox/**",
  "packages/opencode/test/operator/**",
  "packages/opencode/test/dev/sandbox/**",
  "packages/server/src/**/operator/**",
  "packages/cli/src/**/operator/**",
  "packages/tui/src/**/operator/**",
  "packages/tui/src/**/settings/**",
  "packages/schema/src/**/operator/**",
  "packages/protocol/src/**/operator/**",
  "packages/sdk/**/operator/**",
  "packages/sdk-next/**/operator/**",
  "scripts/dev/opencode-operator-sandbox*",
  ".gitignore",
]
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Companion artifacts

| File                                                               | Purpose                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| [research.md](research.md)                                         | Evidence and closed clarify package                  |
| [data-model.md](data-model.md)                                     | Entities, versions, retention                        |
| [contracts/](contracts/)                                           | Command envelope, error taxonomy, API sketch         |
| [quickstart.md](quickstart.md)                                     | Isolation harness, flag, runbook, troubleshooting    |
| [reserved-catalog-v1.md](reserved-catalog-v1.md)                   | Integrator catalog v1 + surfaces + governance (T048) |
| [migration-legacy-admin-names.md](migration-legacy-admin-names.md) | Dry-run + one-release warn                           |

## Implementation order (task groups preview)

1. Isolation harness + proof tests (prod paths unchanged).
2. Schemas, principals, registry, reserved catalog.
3. Dispatcher + error taxonomy + unit tests.
4. Config CAS/idempotency/snapshots.
5. SecretPort keychain + env-ref.
6. EventV2 audit (+ external outbox hook).
7. Loopback API + SDK.
8. Slash intercept + confirmation.
9. CLI human/JSON.
10. TUI Settings/palette.
11. Migration/flags/reserved enforcement.
12. Full test matrix + OTEL labels.
13. Docs/commit notes (no commit in this documentary pass).

## Validation checklist (plan complete when)

- [x] Clarify Q1–Q18 closed in spec
- [x] ADR-0003 accepted
- [x] Phase 1 slices and Phase 2 deferral explicit
- [x] Reuse Config.Service + EventV2 stated
- [x] Isolation harness (port 14096, `.dev/`, wrapper) specified
- [x] Ports/stubs strategy for domain services
- [x] Testing matrix and security boundaries
- [x] specScopeGlobs narrow paths applied in doc/arch/speckit.toml
- [x] `speckit plan` advanced status to planned
- [x] `tasks.md` generated and filled (53 Phase 1 + 3 deferred)
- [x] `speckit analyze` clean of Critical/High/Medium blockers (info-only H1/slug drifts remain)
- [x] `speckit validate --changed` green (0 findings on Feature 007 artifacts)
- [x] Prettier clean on Feature 007 + ADR-0003 markdown
- [x] Guard allows implement paths under specScopeGlobs (e.g. packages/opencode/src/operator/\*\*)
