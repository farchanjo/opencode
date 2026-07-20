---
id: 019f8004-2c2b-7e62-ba7c-5364a20a7ad8
number: 024
slug: implement-routing-configure-persistence-so-operator-routing
status: analyzed
created_at: 2026-07-20T14:53:04.939885Z
---
# Feature Specification: Implement Routing Configure Persistence So Operator Routing

Feature: 024-implement-routing-configure-persistence-so-operator-routing
Created: 2026-07-20
Scope: `routing.configure` is the ONE config-backed operator command that never
persists. Its inbound adapter hardcoded
`fail("not_implemented", "routing.configure persists via Config.Service …")`
(`packages/opencode/src/routing/adapters/inbound/routing-command-port.ts:133-136`,
pre-024) — so the TUI "Routing configure" **Save** surfaced a RED warning and the
operator **could not activate routing**. Every sibling routing verb already
persists: `smart.*` flips `activation` and `pools.set` writes `role_pools`, both
through the Feature 007 `mutateAuthority` CAS pipeline over the shared `routing`
Config authority. The persisting **writer** for routing config already existed but
was **orphaned**: `RoutingConfigPort.set()`
(`packages/opencode/src/routing/adapters/outbound/config-adapter.ts:130-145`) does a
CAS write to `AUTHORITY[scope]` (`routing` project / `global:routing` global), yet
`createRoutingDomainPort` was given only a READ source
(`toRoutingConfigSource`, `config-adapter.ts:155`) at the composition root
(`stack-live.ts:813`, pre-024). This feature closes the gap by wiring a
write-capable **configure backend** into `createRoutingDomainPort` that mirrors the
`smart`/`pools` backends EXACTLY, replacing the `not_implemented` stub with a real
mutation-plan path, and — critically — **partial-merging** the configure fields into
the shared `routing` document under CAS so it never clobbers `role_pools` (owned by
`pools.set`) or the sibling `activation` (owned by `smart.*`). No new command id, no
catalog bump, no parallel config store, no weakening of the single-committed-CAS-write
contract.

## Audit result (grounding — every anchor verified 2026-07-20)

- **The gap is real and reproduced.** A prior trace confirmed `routing.configure` is
  the only config-backed operator command whose handler answers `not_implemented`;
  the TUI form (`packages/tui/src/operator/form/field-list.ts:315-323`,
  `multi-field-modal.tsx`) composes `{ enabled, mode, ...advanced }` and dispatches it
  through the same `executeOperatorCommand` loopback as every other domain, so the
  Save reaches the dispatcher and returns the RED `not_implemented` envelope. Routing
  therefore cannot be enabled from the operator surface.
- **The writer is orphaned, not missing.** `RoutingConfigPort.set()`
  (`config-adapter.ts:130-145`) is a correct CAS writer over `AUTHORITY[scope]`, and
  `smart`/`budget`/`pools` already reach the SAME `routing` authority through
  `createConfigAdapter` reads + `mutateAuthority` writes. Only `routing.configure` was
  never handed a write-capable backend.
- **The write path is `mutateAuthority`, not `RoutingConfigPort.set()` directly.** The
  operator dispatch commits EXCLUSIVELY through the Feature 007 `mutateAuthority`
  pipeline (`packages/opencode/src/operator/application/mutation.ts:277-296` — the
  single CAS write). The `smart`/`pools` backends use `createConfigAdapter` for READS
  and return an `OperatorMutationPlan` the dispatcher commits; they never self-commit
  via `.set()`. The configure backend follows the SAME contract, so the
  single-committed-CAS-write invariant is preserved.
- **The `routing` document is shared by three writers.** `pools.set`
  (`PROJECT_AUTHORITY = "routing"`, `pools/backend-live.ts:44`), `smart.*`
  (`AUTHORITY`, `smart/backend-live.ts:40-43`), and now `routing.configure` ALL write
  the same per-scope routing document. Coexistence today rests on each backend
  read-modify-writing the effective config and preserving sibling keys; `routing.configure`
  must do the same or it would silently zero `role_pools`/`activation`.
- **`mutateAuthority.apply` receives the FRESH persisted payload.** `apply(current, …)`
  is called with `current?.payload` read at commit time
  (`mutation.ts:224,277`), so merging the configure fields into `current` (not a
  plan-time snapshot) preserves whatever siblings the committed document holds — the
  strongest merge-under-CAS guarantee available.

## Problem

An operator config-backed command must EITHER persist end-to-end OR fail with a
surfaced, typed reason. `routing.configure` did neither: it always returned
`not_implemented`, so the operator could never enable Smart Routing, change its mode,
or set an advanced budget policy from the TUI. The persisting writer existed but was
never wired into the routing domain port. This feature wires a write-capable configure
backend that mirrors the `smart`/`pools` mutation-plan pattern and partial-merges its
fields into the shared `routing` document under CAS.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — An operator can activate and configure routing

- As an operator on the TUI "Routing configure" screen, I want **Save** to persist
  the Enabled toggle, the Auto/Always/Never mode, and my advanced policy override so
  that Smart Routing is actually activated — never a RED `not_implemented` warning.

### P1 — routing.configure never clobbers pools or smart

- As an operator, I want saving a routing configuration to preserve the role→model
  pools I bound (`pools.set`) and the activation `smart.*` set, so that configuring
  one facet of routing never silently zeroes another that shares the same document.

### P1 — An invalid policy is a typed error, not a silent no-op

- As an operator, I want an invalid advanced policy JSON (a malformed budget shape) to
  be rejected with a typed validation error that keeps my form open, so a bad Save
  never commits a corrupt document and never appears to succeed.

### P1 — Optimistic concurrency is preserved

- As a maintainer, I want `routing.configure` to commit through the SAME single
  `mutateAuthority` CAS write as every other operator mutation, so a stale
  expected-version is rejected as a conflict and lost-update protection is intact.

### P2 — The backend mirrors the smart/pools pattern

- As a maintainer, I want the configure backend to reuse `createConfigAdapter` reads +
  an `OperatorMutationPlan` (never a parallel store or a self-commit), so the routing
  config family stays one coherent, auditable pattern.

## Functional Requirements

### Group A — Wire a write-capable configure backend (FR-A)

1. **FR-A — `createRoutingDomainPort` is given a write-capable configure backend.**
   The routing domain port MUST accept a `RoutingConfigureBackend`
   (`routing/adapters/outbound/configure-backend.ts`) — not just the read source
   `toRoutingConfigSource`. The composition root MUST wire it at `stack-live.ts:818`
   as `createRoutingDomainPort(routingService, createRoutingConfigureBackend({ config: store.config }))`,
   over the SAME committed `store.config` seam `smart`/`budget`/`pools` project — no
   parallel store, following the SAME wiring `smart-command-port` (`backend.planOn`)
   and `pools-command-port` (`backend.planSet`) use. A backend-less construction (a
   read-only port, e.g. in a unit test) MUST keep answering `not_implemented` for
   `routing.configure`, since it genuinely cannot persist.

### Group B — routing.configure mutation-plan path (FR-B)

2. **FR-B — `routing.configure` returns a real mutation plan, never `not_implemented`.**
   The inbound adapter (`routing-command-port.ts:190`) MUST replace the
   `not_implemented` stub with a mutation-plan path: parse the payload
   (`activation.enabled` — the Enabled toggle; `mode` — Auto/Always/Never; the
   advanced policy override, e.g. `{"budgetPolicy":{…}}`), VALIDATE it against the
   `RoutingConfig.Info` schema (`packages/schema/src/routing/config.ts`), and return
   `{ kind: "mutation_plan", authority, apply }` that the dispatcher commits via
   `mutateAuthority` CAS to `AUTHORITY[scope]` with the request's expected version. An
   invalid `mode`, a malformed advanced policy, or a schema violation MUST be rejected
   with a **typed `invalid_argument`** (NOT `not_implemented`); an all-empty payload
   (no field changed) MUST be rejected as `invalid_argument`.

### Group C — Shared-authority partial merge under CAS (FR-C)

3. **FR-C — `routing.configure` partial-merges into the shared `routing` document,
   preserving siblings.** `routing.configure`, `pools.set` (`PROJECT_AUTHORITY =
   "routing"`), and `smart.*` ALL write the same `routing` authority document. The
   configure plan's `apply` MUST read-modify-write: it merges ONLY the configure-owned
   fields (`activation.enabled`/`mode` and `enforcement.budget`) into the FRESH
   persisted payload `mutateAuthority` threads in (`current`), PRESERVING
   `models.role_pools` (owned by `pools.set`) and any sibling `activation`/enforcement
   field (owned by `smart.*`). It MUST NOT overwrite sibling keys with a plan-time
   snapshot. `RoutingConfigPort.set()` remains a full-document CAS writer (its callers
   pass an already-merged document); the merge for the operator dispatch path lives in
   the plan's `apply`, so the merge semantics match how `pools`/`smart` coexist today.

### Group D — Single-committed-CAS-write + typed surfacing (FR-D)

4. **FR-D — The single-committed-CAS-write and operator mutation-plan contracts are
   intact, and a rejected Save is surfaced.** The backend MUST NEVER self-commit: the
   Feature 007 `mutateAuthority` pipeline owns the ONE committed CAS write + audit
   (`mutation.ts:277-296`). A rejected Save (invalid policy, stale expected-version)
   MUST surface a **typed** error envelope to the TUI (in-modal, not silent) and MUST
   commit NOTHING — no phantom write, no version bump. A stale expected-version MUST
   still return the standard `CAS version conflict` (lost-update protection preserved).

### Group E — Regression proof over the REAL wired dispatcher (FR-E)

5. **FR-E — The reproduced scenarios persist / surface through the REAL wired stack.**
   Regression coverage MUST drive the SAME live dispatcher construction the TUI uses
   (smart + pools + routing over ONE shared `store.config`, with the production
   authority resolver threaded) and prove:
   - (a) a `routing.configure` Save on a **fresh** (unseeded) project → outcome
     `success`, persisting `activation.enabled`/`mode`/policy to the PROJECT `routing`
     authority (never `global:routing`) with a bumped CAS version, and a **second**
     configure threading the bumped version persists again;
   - (b) THE COEXISTENCE PROOF — `pools.set` (role_pools) + `smart.on` (activation) +
     `routing.configure` (mode + budget) in sequence, and NONE clobbers the others in
     the final **on-disk** `config.json` (physical round-trip via
     `createFileConfigService` + a fresh-store re-read);
   - (c) an invalid advanced policy JSON → typed validation error, NOTHING committed;
   - (d) a stale expected-version → conflict, NOTHING committed (CAS preserved);
   - (e) a global-config-resolved base + a project-scope configure still creates the
     PROJECT override and a second save succeeds (no `mutations require version`).

### Group F — Write authority follows the REQUEST scope (FR-F, fix-round)

6. **FR-F — The write authority MUST be derived from the request scope, not the
   effective-config origin.** `routing.configure` MUST commit to the SAME Config
   authority the mutation preflight reports for the request scope
   (`command-authority.ts` — project → `routing`, global → `global:routing`), NOT the
   authority implied by where the effective config happens to resolve
   (`scopeForOrigin(effective.origin)`). On a fresh project whose config resolves via
   global/default, the two MUST NOT diverge: a project-scope Save creates/writes the
   project `routing` override so the preflight CAS token and the committed authority
   always match. This closes the reproduced RED failure (SAVE#1 silently to
   `global:routing`, SAVE#2 `invalid_argument`) and removes the regression suite's
   masking precondition. The effective config is still read for the merge base/defaults.

## Non-Functional Requirements

- **Mirror the existing pattern, no new store.** The configure backend reuses
  `createConfigAdapter` for reads and returns an `OperatorMutationPlan`, exactly like
  `smart`/`pools`; no parallel product config store, no self-commit.
- **One routing-module authority SSOT.** The per-scope authority map
  (`routing`/`global:routing`) is exported once from `config-adapter.ts` and shared by
  the configure backend — no re-typed table.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id,
  catalog version, dispatch path, server/port surface, or feature flag is added or
  altered; `routing.configure` was already `mutates: true` in the catalog
  (`packages/core/src/operator/catalog.ts:83`).
- **Zero provider/model cost.** The backend is model-independent and offline-capable;
  it makes no provider/model calls, consumes no tokens, and incurs no cost.
- **Honest failure.** Every rejected Save surfaces a typed, bounded, secret-free
  reason; no failure is swallowed or rendered as success (FR-D).

## Acceptance Scenarios

Given the operator control plane is enabled and a live wired stack is in use

- **routing.configure Save persists (FR-A, FR-B, FR-E-a).**
  Given the `routing` document is initialized (disabled default),
  When the operator Saves `{ enabled: true, mode: "auto", budgetPolicy: … }` and the
  preflight threads the current version,
  Then the write commits with outcome `success`, the effective config shows
  `activation.enabled = true`, `mode = "auto"`, and the custom budget policy, and the
  CAS version bumps.

- **Coexistence — no clobber (FR-C, FR-E-b).**
  Given `pools.set` has bound `role_pools` and `smart.on` has enabled activation on the
  shared `routing` document,
  When the operator Saves `routing.configure { mode: "auto", budgetPolicy: … }`
  (without touching enabled),
  Then the final on-disk `config.json` under the `routing` authority holds ALL THREE:
  the role pool, `activation.enabled = true`, and the new mode + budget — and a fresh
  store re-reads them from disk.

- **Invalid policy is rejected (FR-B, FR-D, FR-E-c).**
  Given the operator Saves a `routing.configure` with a schema-invalid `budgetPolicy`,
  When the mutation dispatches,
  Then the backend returns a typed `invalid_argument`, the modal stays open with the
  typed reason, and the routing document is unchanged (nothing committed).

- **Stale version is a conflict (FR-D, FR-E-d).**
  Given a `routing.configure` has committed at version `v`,
  When a second `routing.configure` threads a stale token,
  Then it is rejected with `CAS version conflict`, and the committed document is
  preserved (nothing committed).

- **A read-only port cannot persist (FR-A).**
  Given a `createRoutingDomainPort(routing)` constructed WITHOUT a configure backend,
  When `routing.configure` is invoked,
  Then it answers `not_implemented` — the honest outcome for a port that has no
  write-capable backend.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes the
  `RoutingConfig.Info` document (activation flags, routing mode, role→pool bindings,
  and budget/enforcement limits) under the `routing` / `global:routing` Config
  authority — operator configuration metadata, not end-user content or secrets. No
  model ids beyond those the operator explicitly enters are stored; no credential or
  token is read, written, or exposed.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary. `routing.configure` rides the existing Feature 007 operator
  principal, scope, CAS, and confirmation gates unchanged — the dispatcher's
  `mutateAuthority` enforces the same authorization every other mutation uses; this
  feature only supplies the domain plan.
- **Input validation.** The untrusted input is the operator payload
  (`enabled`/`mode`/advanced policy JSON). `mode` is checked against the closed
  `always|auto|never` set at the inbound adapter; the full patched config is decoded
  against the `RoutingConfig.Info` effect-schema at plan time
  (`configure-backend.ts:112-127`), so a malformed budget policy or any schema
  violation is rejected as `invalid_argument` BEFORE any plan is produced — never a
  crash, never a partial write.
- **Cryptography in transit/at rest.** Not applicable — this feature persists routing
  configuration through the existing Config.Service boundary; it introduces no new
  data-in-transit path and no new at-rest encryption requirement beyond what
  Config.Service already provides.
- **Logging/audit.** No new logging. The committed mutation projects through the
  existing Feature 007 EventV2 audit correlation via the single `mutateAuthority`
  `finalize` path (content-free `beforeVersion`/`afterVersion`), unchanged. The
  backend carries no payload/secret into a log line.
- **Error-handling information exposure.** Rejected Saves surface the existing typed,
  bounded reason (`invalid_argument` with a `field` hint, or `CAS version conflict`) —
  never a stack trace, a raw config fragment, or a schema-decoder dump. Config reads
  are guarded (`Effect.tryPromise`) and degrade to a typed `unavailable`, never an
  unhandled throw.

## Observability

This is a domain mutation-plan wiring change with no new backend surface, so it emits
no new metrics, log events, or trace spans. Committed `routing.configure` mutations
project through the existing Feature 007 EventV2 audit (now with a real
`beforeVersion`/`afterVersion` instead of a rejected `not_implemented`) and the
ADR-0001 OTLP foundation with content-free, bounded labels (command id, domain,
surface, outcome) — unchanged, because the payload contract and dispatch path are
unchanged. Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The routing.configure persistence + shared-authority merge is specified in
`doc/arch/schemas/implement-routing-configure-persistence-so-operator-routing.cue`:

```
TUI "Routing configure" Save
  compose { enabled, mode, ...advanced }  (field-list.ts:323)
        |
        v
routing.configure inbound adapter (routing-command-port.ts:190)
  parse + validate mode ∈ {always,auto,never}; reject empty payload   (FR-B)
  backend absent -> not_implemented (read-only port)                  (FR-A)
        |
        v
RoutingConfigureBackend.planConfigure (configure-backend.ts:109)
  read effective (project>global>default) via createConfigAdapter     (no parallel store)
  validate patched RoutingConfig.Info at plan time -> invalid_argument (FR-B, Security)
  return { authority: AUTHORITY[scope], apply }                        (FR-A)
        |
        v
dispatcher -> mutateAuthority (mutation.ts:277-296)  [ONE committed CAS write]
  apply(current) merges enabled/mode/budget INTO fresh persisted doc   (FR-C)
    preserves models.role_pools (pools.set) + sibling activation (smart.*)
  stale expectedVersion -> CAS version conflict, commit nothing        (FR-D)
        |
        v
success -> activation/mode/policy persisted to shared "routing" doc    (FR-E-a)
coexistence: pools + smart + routing all survive on disk               (FR-E-b)

No new command id, catalog bump, parallel store, or self-commit; the
single-committed-CAS-write contract is preserved verbatim (FR-D).
```

## Out of Scope

- **Rewriting `RoutingConfigPort.set()` into a merging writer** — it stays a
  full-document CAS writer; the operator-dispatch merge lives in the plan's `apply`
  (FR-C).
- **Any operator payload, command id, catalog version, dispatch path, or feature flag
  change** — `routing.configure` was already `mutates: true`; only the handler body
  changes.
- **Mapping advanced-policy keys beyond `budgetPolicy`** — the documented advanced
  override is `{"budgetPolicy":{…}}` (`field-list.ts:321`); other enforcement/model
  overrides are out of this feature's scope.
- **Changing the TUI "Routing configure" form** — the form already composes and
  dispatches the payload (Feature 017); this feature only makes the dispatch persist.
- **Aligning `smart.*` / `budget.*` write scope with their preflight (Feature 025
  candidate)** — `smart/backend-live.ts` and `budget/backend-live.ts` still derive their
  write authority from `scopeForOrigin(effective.origin)` while their preflight resolves
  the request scope (`command-authority.ts`). A repro (fresh project, `smart.on` then
  `smart.off`) confirmed the SAME divergence FR-F fixes for `routing.configure` (SAVE#1 →
  `global:routing`, SAVE#2 → `invalid_argument`). Applying the request-scope derivation to
  `smart`/`budget` is deliberately deferred to a dedicated follow-up.

## Related Features and Decisions

- [ADR-0024 — Implement routing configure persistence so operator routing](../../adr/0024-implement-routing-configure-persistence-so-operator-routing.md)
- [Feature 013 — Wire the four remaining config-backed operator domains](../013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md) — the `smart`/`pools` backends this feature mirrors, and `PROJECT_AUTHORITY = "routing"`.
- [Feature 021 — Operator config-backed saves must persist reliably and never silently zero](../021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md) — the shared-`routing`-authority CAS-token / preflight invariants the coexistence proof reuses.
- [Feature 001 — Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the routing config adapter (`config-adapter.ts`) and `RoutingConfig.Info` schema.
- [Feature 017 — Close the implementable operator capability gaps](../017-close-the-implementable-operator-capability-gaps-so-the/spec.md) — the operator mutation-plan handler contract and the `mutateAuthority` pipeline (ADR-0017).
- [Domain schema](../../schemas/implement-routing-configure-persistence-so-operator-routing.cue)

## Clarifications

### Session 2026-07-20

- **The gap is a missing wiring, not a missing writer (FR-A).** `RoutingConfigPort.set()`
  (`config-adapter.ts:130-145`) already CAS-writes the routing document; the defect was
  that `createRoutingDomainPort` received only a read source, so `routing.configure`
  answered `not_implemented`. Recorded in ADR-0024.
- **The write path is `mutateAuthority`, mirroring smart/pools (FR-B, FR-D).** The
  configure backend returns an `OperatorMutationPlan` the dispatcher commits via the
  single `mutateAuthority` CAS write; it never calls `.set()` directly, preserving the
  single-committed-CAS-write contract. Recorded in ADR-0024.
- **The merge lives in `apply(current)`, over the FRESH payload (FR-C).**
  `mutateAuthority` threads the current on-disk payload to `apply`, so merging the
  configure fields into `current` preserves `role_pools`/`activation` even better than
  a plan-time snapshot; `set()` stays a full-document writer. Recorded in ADR-0024.
- **Invalid policy is `invalid_argument`, never `not_implemented` (FR-B).** The patched
  config is decoded against `RoutingConfig.Info` at plan time; a malformed budget policy
  is a typed validation error that commits nothing. Recorded in ADR-0024.
- **Alternatives rejected (ADR-0024).** A parallel routing config store, a self-committing
  backend (`.set()` in the dispatch path), and a plan-time-snapshot merge (that could
  clobber a concurrently-written sibling) were all rejected in favor of the
  mutation-plan + `apply(current)` merge that mirrors smart/pools.
