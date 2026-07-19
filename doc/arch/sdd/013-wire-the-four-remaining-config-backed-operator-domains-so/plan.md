# Implementation Plan: Wire the Four Remaining Config-Backed Operator Domains

Feature: 013-wire-the-four-remaining-config-backed-operator-domains-so
Status target: planned (after this plan is complete)
ADR: [ADR-0013](../../adr/0013-wire-the-four-remaining-config-backed-operator-domains-so.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR12; domain model; honest-degradation + parity invariants)

## Overview

Feature 007 established the operator control plane as the sole native management
authority, and Features 002–006/008 replaced the generic domain stubs for
`process`/`task`/`jobs`/`langlock`/`output`/`semantic`/`mcp` with real typed domain
ports. Four reserved catalog domains — `telemetry`, `smart`, `budget`, `pools` —
remain wired to the generic `stubInvoke` (`domain-stubs.ts:101-116`) and are never
overridden in the `stack-live.ts` `wireDomainPorts` spread (`~412-423`), so every
verb resolves `not_implemented`; a `config-status.ts` stopgap (`STATUS_SHOW_IDS`)
reports only `configured`/`available` for the read verbs.

The effective state these four domains manage already exists and is already
Config-backed: telemetry over `resolveEffectiveTelemetryConfig` +
`schema/src/telemetry/config.ts`; smart over `RoutingConfig.Activation.enabled`;
budget over `RoutingConfig.Enforcement.budget` + `DEFAULT_ROUTING_BUDGET`; pools as
a projection of `RoutingConfig.Models.role_pools`. This plan is a **backend-wiring**
change: replicate the Feature 004 langlock domain-stack template per domain over the
reused effective config, wire the four ports into the composition root, retire the
generic stub/status shadow, add a real `telemetry.test` OTLP reachability probe, and
flip the four domains' TUI availability to `persists_today`. Mutations persist
through the SAME Config.Service seam (`createLiveConfigServiceLike` / `store.config`)
langlock uses, under CAS, and honest-degrade to typed envelopes.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR11).** No catalog id is added and no
  catalog version is bumped — the reserved telemetry/smart/budget/pools ids already
  live in the catalog; this feature supplies only domain ports and their wiring.
- **No new dispatch path (parity, FR11).** Each verb rides the SAME `OperatorClient`
  loopback as slash/CLI; no parallel registry, divergent name, or new route.
- **Reuse the effective config.** The telemetry/routing/budget schemas are reused
  unchanged; the ports project and mutate them, never re-author them.
- **No control-plane flag change.** The surface stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`.
- **No fabricated success (FR8).** A config-unreachable read or a stale/invalid
  mutation degrades to a typed envelope; nothing is synthesized.
- **Probe is test-signal only (FR6).** `telemetry.test` sends no signal content
  beyond a bounded reachability probe and never blocks the loop (Feature 007 FR30).

## Technical Approach

### Architecture layers affected

```
Protocol command modules (packages/protocol/src/{telemetry,smart,budget,pools}/)
  commands + ports  ── typed payloads + typed error unions ──▶ (FR1)
        │  (mirrors protocol/src/langlock/{commands,ports}.ts)
        ▼
Domain stacks (packages/opencode/src/operator/{telemetry,smart,budget,pools}/)
  *-port.ts / *-command-port.ts / backend-live.ts / persistence / stack-wiring.ts / index.ts
        │  reads project reused effective config; mutations = CAS writes over store.config (FR2-FR5, FR7)
        │  telemetry.test → real bounded OTLP probe → ProbeResult (FR6, FR10)
        ▼
Composition root (packages/opencode/src/operator/stack-live.ts)
  wireDomainPorts spread ── gains 4 wirings, replaces 4 stubs ──▶ (FR9)
Stub/shadow removal
  domain-stubs.ts (4 stubs) + config-status.ts STATUS_SHOW_IDS (8 ids dropped) ──▶ (FR9)
        ▼
TUI availability (packages/core/src/operator/palette.ts)
  OPERATOR_PERSISTING_DOMAINS += telemetry/smart/budget/pools ── persists_today ──▶ (FR12)
```

The reused effective-config shapes (`schema/src/telemetry/config.ts`,
`schema/src/routing/{config,budget}.ts`) are the single source the ports project;
the domain ValueObjects are specified in
`doc/arch/schemas/operator-config-domains/` and the probe lifecycle in
`doc/arch/statecharts/telemetry-probe.md`.

### Phase 1 — Per-domain protocol command modules (FR1)

- **Author `packages/protocol/src/{telemetry,smart,budget,pools}/{commands,ports}.ts`**
  per domain, mirroring `protocol/src/langlock/{commands,ports}.ts`: the
  request/response payloads (summary read models, mutation inputs with an
  `expectedVersion`, the probe result for telemetry) and the typed error union
  (`unavailable` | `invalid_argument` | `version_conflict` | `unauthorized`). The
  telemetry configure input carries an export header as a `SecretRef` only.
- **Registry check.** `packages/schema/test/contract-hygiene.test.ts` is a
  SCHEMA-identifier annotation allowlist (it registers `effect/Schema` identifiers,
  not protocol TS types); the new protocol modules do not add schema identifiers, so
  no contract-hygiene registration is required. Protocol parity is covered by the
  existing `packages/protocol/test/**` suite instead.

### Phase 2 — Four domain stacks (FR2-FR5, FR7, FR8)

- **Replicate the langlock file set per domain** under
  `packages/opencode/src/operator/{telemetry,smart,budget,pools}/`:
  `*-port.ts` (the typed domain port over an injected backend seam),
  `*-command-port.ts` (the audited command adapter carrying the Feature 007
  principal), `backend-live.ts` (the live backend over the reused effective config),
  persistence over `store.config`, `stack-wiring.ts` (`create*DomainWiring`), and
  `index.ts`.
- **telemetry (FR2).** `resolve` projects the redacted effective telemetry config
  via `resolveEffectiveTelemetryConfig`; `on`/`off`/`configure` are optimistic CAS
  writes over `store.config`; `configure` stores the export header as a `SecretRef`.
- **smart (FR3).** A projection over `RoutingConfig.Activation`: `status` reads
  `enabled`/`mode`; `on`/`off`/`auto` CAS-write `Activation.enabled`/`mode` on the
  routing authority (`routing` / `global:routing`).
- **budget (FR4).** Over `RoutingConfig.Enforcement.budget` seeded from
  `DEFAULT_ROUTING_BUDGET`: `status`/`show` project the bounded limits view;
  `set`/`reset` CAS-write; `validate` reports validity without mutating.
- **pools (FR5).** A projection over `RoutingConfig.Models.role_pools`:
  `status`/`show` project the bindings; `set`/`reset` CAS-write the map; `validate`
  reports validity without mutating.
- **Honest degradation (FR8).** Each backend guards config I/O with
  `Effect.tryPromise` and maps failure to the typed error union — never a fabricated
  success (the jobs/langlock pattern). Every mutation returns a Feature 007 audit id.

### Phase 3 — Stack wiring + stub/shadow removal (FR9)

- **Wire four ports into `stack-live.ts`.** Add `create{Telemetry,Smart,Budget,Pools}DomainWiring`
  calls and spread their `.ports` into `wireDomainPorts`, replacing the four generic
  stubs. `telemetry` reuses the `telemetryConfig` already resolved at `:326`.
- **Remove the four stubs from `domain-stubs.ts`** so the real ports own the domains
  (mirrors how jobs/langlock overrides supersede their stubs).
- **Drop the stale status shadow.** Remove `telemetry.status`/`show`, `smart.status`,
  `budget.status`/`show`, and `pools.status`/`show` from `config-status.ts`
  `STATUS_SHOW_IDS` so the real domain ports win (the langlock shadow-removal
  precedent); `routing.status` and the `semantic.*` entries stay.

### Phase 4 — TUI availability flip (FR12)

- **Extend `OPERATOR_PERSISTING_DOMAINS`** (`packages/core/src/operator/palette.ts`)
  with `telemetry`, `smart`, `budget`, `pools`, flipping their availability from
  `honest_unavailable` to `persists_today` so the Feature 011 Configure entries
  become editable. Update the palette metadata/label unit tests.

### Phase 5 — Telemetry reachability probe (FR6, FR10)

- **Implement `telemetry.test`** in the telemetry backend as a real,
  environment-agnostic OTLP reachability probe: `http/protobuf` → a minimal POST to
  `<endpoint>/v1/metrics` (or a reachability HEAD/TCP check); `grpc` → a TCP dial;
  bounded by an explicit timeout; returning `reachable`/`unreachable`/`misconfigured`.
  It sends no signal content, mutates nothing, and never blocks the loop; an absent
  or malformed endpoint resolves `misconfigured` with no network I/O. The lifecycle
  matches `doc/arch/statecharts/telemetry-probe.md`.

### Phase 6 — Tests + doc sync

- **Unit — per domain.** For each of the four domains assert: a read projects the
  reused effective config into the summary; a mutation persists under CAS and returns
  an audit id; a stale expected version → `version_conflict`; a config-unreachable
  read/mutation → `unavailable`; an invalid payload → `invalid_argument`.
- **Unit — telemetry probe.** Assert `reachable` (against a local mock collector),
  `unreachable` (refused/timeout, bounded), and `misconfigured` (no endpoint), and
  that the probe emits no signal content and does not block.
- **Integration — wiring + shadow removal.** Assert the four verbs dispatch to the
  real ports (not `not_implemented`) through `stack-live.ts`, and that the dropped
  `STATUS_SHOW_IDS` no longer shadow the real reads.
- **Parity (FR11).** Reuse the Feature 007 parity harness to assert each verb rides
  the same command id / same loopback as slash/CLI, with no new dispatch path, no
  new catalog id, and no catalog version bump.
- **TUI availability.** Assert the four domains report `persists_today`.
- **Doc sync.** Keep the spec, ADR-0013, the `operator-config-domains/*.cue`
  corpus, and the telemetry-probe statechart in sync with the shipped shapes;
  refresh `AGENTS.md`/`README.md` only if a user-facing surface description drifts.

## Data model and migration strategy

No new store or table and no migration: the four domains read and mutate the
EXISTING Config.Service authority (telemetry config, routing config) that the
runtime already persists. Mutations are optimistic CAS writes over `store.config`
under a `CasExpectation(authority, expectedVersion)`; a stale version degrades to
`version_conflict`. The operator-surface projections are typed by the ValueObjects
in `doc/arch/schemas/operator-config-domains/` (`#TelemetrySummary`, `#SmartSummary`,
`#BudgetSummary`, `#PoolsProjection`, `#ProbeResult`, `#ConfigMutation`,
`#MutationEnvelope`) and the bounded enums (`#ConfigDomain`, the per-domain verbs,
`#MutationOutcome`, `#ProbeOutcome`, `#Transport`, `#PersistenceClass`).

## Telemetry probe state machine

Per `doc/arch/statecharts/telemetry-probe.md`:

```
requested → misconfigured                 (endpoint_absent_or_invalid; no network I/O)
requested → probing                       (target_resolved)
probing → { reachable | unreachable }     (dial_bounded_by_timeout)
{ reachable | unreachable | misconfigured } → recorded   (typed ProbeResult)
```

The probe consumes the effective telemetry config over the same Config.Service
authority, sends no signal content beyond the probe, and never blocks the loop
(FR6, FR10). It is test-signal only (Feature 007 FR30).

## Security and threat boundaries

| Concern                      | Mitigation                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| No new authenticated surface | Every verb rides the Feature 007 `OperatorClient` loopback + operator principal/scope/CAS (FR11).      |
| Secret handling              | telemetry.configure stores export headers as a `SecretRef` only; resolved by Feature 007 SecretPort.   |
| Input validation             | Mutation payloads schema-validated → typed `invalid_argument`; SecretRef validated against its pattern.|
| Probe boundedness            | telemetry.test is timeout-bounded, sends no signal content, mutates nothing, never blocks (FR6).       |
| No fabricated success (FR8)  | Config-unreachable/stale/invalid degrade to typed envelopes; no synthesized effective state.           |
| No secret leakage            | Errors/toasts/logs carry only bounded, secret-free reasons; no header value or config payload surfaces.|
| Audit                        | Mutations emit the Feature 007 EventV2 audit correlation with content-free, bounded labels.            |

## Observability

No new telemetry of its own. Operator dispatches continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels (command id, domain, surface, scope, outcome). The `telemetry.test`
probe emits no telemetry signal content and records only its typed outcome and
target transport; no endpoint credential, header value, config payload, or role-pool
model id is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths; most of the surface is already in scope under the Feature 007 / 001
blocks. Only the three non-telemetry protocol command modules are genuinely new;
reused seams are listed for traceability:

```toml
# Genuinely new to Feature 013 (protocol command modules):
"packages/protocol/src/smart/**",           # smart.* protocol module (FR1, FR3)
"packages/protocol/src/budget/**",          # budget.* protocol module (FR1, FR4)
"packages/protocol/src/pools/**",           # pools.* protocol module (FR1, FR5)
# Already in scope — NOT re-added, listed for traceability:
#   packages/opencode/src/operator/**        → 4 domain stacks + stack-live wiring + stub/status removal (FR2-FR5, FR9)
#   packages/core/src/operator/**            → palette.ts OPERATOR_PERSISTING_DOMAINS flip (FR12)
#   packages/protocol/src/**/telemetry/**    → telemetry protocol module (FR1)
#   packages/schema/src/{telemetry,routing}/** → reused effective-config shapes (FR2-FR5)
#   packages/{opencode/test/operator,protocol/test,schema/test}/** → unit/CAS/probe/parity tests
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Four protocol command modules (`protocol/src/{telemetry,smart,budget,pools}/`).
2. Four domain stacks (`operator/{telemetry,smart,budget,pools}/`).
3. Stack wiring in `stack-live.ts` + stub removal + status-shadow removal.
4. TUI availability flip (`palette.ts` `OPERATOR_PERSISTING_DOMAINS`).
5. Telemetry reachability probe (`telemetry.test`).
6. Tests (per-domain unit, CAS conflict, honest unavailable, probe, parity, TUI
   availability) + doc sync.

## Companion artifacts

None required beyond this plan. The domain ValueObjects
(`doc/arch/schemas/operator-config-domains/`) and the statechart
(`doc/arch/statecharts/telemetry-probe.md`) already carry the data model; no
`research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR12 mapped to ordered phases
- [x] No new catalog id / no catalog version bump / no new dispatch path / no flag (FR11)
- [x] Four domain stacks mirror the langlock file set; reused effective config, not re-authored
- [x] Mutations CAS-versioned through the shared Config.Service seam; honest degradation (FR7, FR8)
- [x] Stack wiring replaces the 4 stubs; STATUS_SHOW_IDS shadow removed (FR9)
- [x] Telemetry probe real, bounded, test-signal only; matches the statechart (FR6, FR10)
- [x] TUI availability flipped to persists_today (FR12)
- [x] specScopeGlobs narrow; only the 3 non-telemetry protocol modules genuinely new
- [x] Security: SecretRef-only headers, input validation, no fabricated success, parity
- [ ] `tasks.md` generated and filled
- [ ] `speckit analyze` clean of new Critical/High/Medium blockers
- [ ] `speckit validate --json` green (0 new findings on Feature 013 artifacts)

## Implementation notes (recorded during implement)

- _(reserved — filled during the implement phase.)_
