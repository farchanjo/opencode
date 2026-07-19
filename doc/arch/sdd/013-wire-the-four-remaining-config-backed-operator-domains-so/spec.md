---
id: 019f7a3b-c0e5-7093-944a-c234532f7016
number: 013
slug: wire-the-four-remaining-config-backed-operator-domains-so
status: implemented
created_at: 2026-07-19T11:56:04.197513Z
---
# Feature Specification: Wire the Four Remaining Config-Backed Operator Domains

Feature: 013-wire-the-four-remaining-config-backed-operator-domains-so
Created: 2026-07-19
Scope: Replace the generic `not_implemented` stubs for the four remaining
config-backed operator domains — `telemetry`, `smart`, `budget`, `pools` — with
real typed domain ports over the already-live effective config, following the
Feature 004 langlock domain-stack template. Feature 007 remains the sole
command-registration authority (no catalog id is added and no catalog version is
bumped); the four ports read and mutate the SAME Config.Service authority the
routing/telemetry runtime already binds, honest-degrading to typed envelopes and
preserving the parity invariant. This feature adds a real `telemetry.test` OTLP
reachability probe and flips the four domains' TUI availability from
`honest_unavailable` to `persists_today`.

## Problem

The operator control plane is the single native authority for setup and
management, and Features 002–006/008 replaced the generic domain stubs for
`process`, `task`, `jobs`, `langlock`, `output`, `semantic`, and `mcp` with real
typed domain ports. **Four reserved catalog domains remain stubbed:**

- `createDomainStubs()`
  (`packages/opencode/src/operator/adapters/outbound/domain-stubs.ts:101-116`)
  maps `telemetry`, `smart`, `budget`, and `pools` to the generic `stubInvoke`,
  so every verb resolves `not_implemented`.
- `stack-live.ts` (`~412-423`, the `wireDomainPorts` spread) overrides
  `lifecycle`/`jobs`/`langlock`/`output`/`semantic`/`mcp`/`routing` but never the
  four config-backed domains.
- As a stopgap, `config-status.ts` maps `telemetry.status`/`show`,
  `smart.status`, `budget.status`/`show`, and `pools.status`/`show` to a generic
  Config-backed status handler (`STATUS_SHOW_IDS`,
  `packages/opencode/src/operator/adapters/outbound/config-status.ts:41-56`) that
  reports only `configured`/`available` — not the domain's real effective state —
  while every mutating verb stays stubbed.

The effective state these four domains manage **already exists and is already
Config-backed** (do not re-author it):

- **telemetry** — `resolveEffectiveTelemetryConfig`
  (`packages/opencode/src/routing/application/telemetry-service.ts`, already
  called at `stack-live.ts:326`) over
  `packages/schema/src/telemetry/config.ts`; `telemetry.configure` carries export
  headers as `SecretRef` only (Feature 007 SecretPort seam), never plaintext.
- **smart** — `RoutingConfig.Activation.enabled`
  (`packages/schema/src/routing/config.ts:48-65`) over the routing config
  authority (`routing` / `global:routing`, `config-adapter.ts:29-30`).
- **budget** — `RoutingConfig.Enforcement.budget`
  (`packages/schema/src/routing/budget.ts`) seeded from `DEFAULT_ROUTING_BUDGET`
  (`config-adapter.ts:35-45`), a hard ceiling never silently relaxed.
- **pools** — the `RoutingConfig.Models.role_pools` map
  (`schema/src/routing/config.ts:69-73`); `pools` is a **projection** of routing
  config, not a standalone store, so it needs only a small projection contract.

The corpus mandates exactly this exposure: Feature 001 FR46–48
(`doc/arch/sdd/001-*/spec.md:376-414`) requires telemetry/smart/budget/pools
management ONLY through the operator control plane, and Feature 007 FR28
(budget/pools mutation only via the control plane) and FR11 (domains own backends;
007 owns registration) constrain how. Leaving the four stubbed means the
palette/slash/CLI/TUI advertise verbs that always fail, and the Feature 011
grouped TUI shows the four Configure sections as permanently honest-unavailable
even though their config is live.

The fix is a **backend-wiring change**: replicate the langlock file set per domain
over the existing effective config, wire the four ports into the composition root,
retire the generic stub/status shadow, add the telemetry probe, and flip the TUI
availability — with no new catalog id, no catalog version bump, and no new dispatch
path.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Live config-backed reads

- As an operator, I want `telemetry.status`/`show`, `smart.status`,
  `budget.status`/`show`, and `pools.status`/`show` to return the real effective
  config (enabled flag, endpoint, limits, role-pool bindings) instead of the
  generic `configured`/`available` stopgap, so that I see what is actually
  configured.
- As an operator, I want a read whose Config.Service authority is unreachable to
  degrade to a typed `unavailable` envelope, so that the surface never fabricates
  effective state.

### P1 — Config-backed mutations under CAS

- As an operator, I want `telemetry.on`/`off`/`configure`, `smart.on`/`off`/`auto`,
  `budget.set`/`reset`/`validate`, and `pools.set`/`reset`/`validate` to persist
  through the same Config.Service seam langlock uses, under an optimistic CAS
  expectation, so that concurrent edits are safe.
- As an operator, I want a stale mutation to degrade to a typed `version_conflict`
  envelope rather than silently overwrite or fake success, so that I never lose a
  write.
- As an operator, I want `telemetry.configure` to carry export header secrets as a
  `SecretRef` only, so that no plaintext credential is persisted or echoed.

### P1 — Telemetry reachability probe

- As an operator, I want `telemetry.test` to run a real, bounded OTLP reachability
  probe against the configured export endpoint and return a typed
  `reachable`/`unreachable`/`misconfigured` outcome, so that I can confirm
  connectivity without emitting telemetry content or blocking the loop.

### P1 — Honest TUI availability

- As an operator, I want the four domains' Configure sections in the Feature 011
  grouped menu to become editable (`persists_today`) once their ports are live, so
  that the availability affordance is truthful.

### P2 — Parity across surfaces

- As an operator, I want each wired verb to ride the same command id and the same
  `OperatorClient` loopback across palette, slash, CLI, and TUI, so that no surface
  diverges and no new dispatch path is introduced.

## Functional Requirements

1. **Per-domain protocol command modules (FR1).** A typed protocol module per
   domain — `packages/protocol/src/{telemetry,smart,budget,pools}/` (commands +
   ports) — MUST define the request/response payload schemas and the typed error
   union each domain port consumes, mirroring
   `packages/protocol/src/langlock/{commands,ports}.ts`. If the schema/protocol
   registry convention in `packages/schema/test/contract-hygiene.test.ts` applies
   to these modules, they MUST be registered there. No payload carries a plaintext
   secret or a free-form command id.
2. **Telemetry domain stack (FR2).** A `packages/opencode/src/operator/telemetry/`
   stack (`telemetry-port.ts`, `telemetry-command-port.ts`, `backend-live.ts`,
   persistence over `store.config`, `stack-wiring.ts`, `index.ts`) mirroring the
   langlock file set MUST back the `telemetry.*` verbs. Reads project the redacted
   effective telemetry config resolved via `resolveEffectiveTelemetryConfig`
   (reused, not re-authored); `telemetry.on`/`off`/`configure` are optimistic CAS
   writes over `store.config`. `telemetry.configure` MUST persist export headers as
   a `SecretRef` only (Feature 007 SecretPort), never plaintext.
3. **Smart domain stack (FR3).** A `packages/opencode/src/operator/smart/` stack
   MUST back the `smart.*` verbs as a projection over `RoutingConfig.Activation`.
   `smart.status` reads the projected `enabled`/`auto` state; `smart.on`/`off`/`auto`
   are CAS writes to `Activation.enabled`/`mode` over the routing config authority
   (`routing` / `global:routing`). Smart is a projection of routing config, not a
   second store.
4. **Budget domain stack (FR4).** A `packages/opencode/src/operator/budget/` stack
   MUST back the `budget.*` verbs over `RoutingConfig.Enforcement.budget`.
   `budget.status`/`show` project the bounded effective limits view (seeded from
   `DEFAULT_ROUTING_BUDGET`, never silently relaxed); `budget.set`/`reset` are CAS
   writes; `budget.validate` reports validity over the effective config without
   mutating.
5. **Pools domain stack (FR5).** A `packages/opencode/src/operator/pools/` stack
   MUST back the `pools.*` verbs as a projection over the `RoutingConfig.Models.role_pools`
   map. `pools.status`/`show` project the role-pool bindings; `pools.set`/`reset`
   are CAS writes to `role_pools`; `pools.validate` reports validity without
   mutating. The projection contract is defined in the CUE corpus.
6. **Telemetry reachability probe (FR6).** `telemetry.test` MUST perform a real,
   environment-agnostic OTLP reachability probe against the configured export
   endpoint — `http/protobuf` → a minimal POST to `<endpoint>/v1/metrics` (or a
   reachability HEAD/TCP check); `grpc` → a TCP dial — bounded by an explicit
   timeout, returning a typed `reachable`/`unreachable`/`misconfigured` outcome. It
   MUST send no telemetry signal content beyond the probe, MUST NOT mutate config,
   MUST NOT block the operator loop, and MUST remain test-signal only (Feature 007
   FR30). An unconfigured or malformed endpoint resolves `misconfigured` without
   dialing the network.
7. **CAS-versioned, audited mutations through the shared seam (FR7).** Every
   mutation across the four domains MUST persist through the SAME Config.Service
   seam (`createLiveConfigServiceLike` / `store.config`) langlock uses, under an
   optimistic CAS expectation, and MUST return a Feature 007 audit correlation. A
   stale expected version MUST degrade to the typed `version_conflict` envelope.
8. **Honest degradation, never fabricated success (FR8).** A config-unreachable
   read or a failed mutation MUST degrade to a typed envelope (`unavailable`,
   `invalid_argument`, `version_conflict`) via a guarded `Effect.tryPromise`
   (the jobs/langlock honest-degradation pattern) — never a fabricated success or
   synthesized effective state. No error path leaks a secret, endpoint credential,
   or config payload fragment.
9. **Stack wiring replaces the stubs and retires the status shadow (FR9).**
   `stack-live.ts` MUST wire the four domain ports into the `wireDomainPorts`
   spread, replacing the four generic stubs; and `config-status.ts` MUST drop
   `telemetry.status`/`show`, `smart.status`, `budget.status`/`show`, and
   `pools.status`/`show` from `STATUS_SHOW_IDS` so the real domain ports win (the
   langlock shadow-removal precedent). `routing.status` and the `semantic.*`
   entries stay untouched.
10. **Telemetry probe lifecycle (FR10).** The `telemetry.test` probe lifecycle
    (requested → { misconfigured | probing → { reachable | unreachable } } →
    recorded) MUST match the statechart in
    `doc/arch/statecharts/telemetry-probe.md` and the `#ProbeResult` ValueObject.
11. **Feature 007 registration + parity invariant preserved (FR11).** Feature 007
    remains the sole command-registration authority: this feature adds NO catalog
    id and bumps NO catalog version — the reserved telemetry/smart/budget/pools ids
    already live in the catalog. Each verb rides the SAME `OperatorClient` loopback
    as slash/CLI with unchanged command ids; no new dispatch path, parallel
    registry, or divergent command name is introduced (Feature 007 FR11).
12. **TUI availability flip (FR12).** `OPERATOR_PERSISTING_DOMAINS`
    (`packages/core/src/operator/palette.ts`) MUST be extended to include
    `telemetry`, `smart`, `budget`, and `pools`, flipping their palette availability
    from `honest_unavailable` to `persists_today` so the Feature 011 Configure
    entries become editable in the TUI menu.

## Non-Functional Requirements

- **Reuse the effective config.** The telemetry/routing effective-config shapes
  (`schema/src/telemetry/config.ts`, `schema/src/routing/config.ts`,
  `schema/src/routing/budget.ts`) are REUSED, not re-authored; the domain ports
  project and mutate them.
- **No new flag.** The four domains stay behind the existing operator control-plane
  flag (`OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`);
  this feature adds no new flag.
- **Bounded, content-free surfaces.** Reads project bounded, redacted summaries; no
  raw config payload, header value, or endpoint credential is surfaced.
- **Template discipline.** Each domain stack mirrors the langlock file set
  (`port` / `command-port` / `backend-live` / persistence / `stack-wiring` /
  `index`) so the four stacks stay uniform and reviewable.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **Read live telemetry effective state.**
  Given the effective telemetry config has an export endpoint configured,
  When the operator runs `telemetry.status`,
  Then the redacted summary reports the enabled flag, transport, endpoint, and
  Config.Service version, and discloses no export header secret.

- **Configure telemetry with a secret header.**
  Given the operator supplies an export header as a `SecretRef`,
  When the operator runs `telemetry.configure` with the expected version,
  Then the header is persisted as a `SecretRef` only (never plaintext) through the
  same Config.Service seam langlock uses.

- **Probe a reachable endpoint.**
  Given the effective telemetry config points at a reachable OTLP endpoint,
  When the operator runs `telemetry.test`,
  Then the probe returns a typed `reachable` outcome bounded by a timeout, sends no
  telemetry signal content beyond the probe, and never blocks the loop.

- **Probe an unconfigured endpoint.**
  Given no telemetry export endpoint is configured,
  When the operator runs `telemetry.test`,
  Then the probe returns the typed `misconfigured` outcome without dialing the
  network.

- **Toggle smart routing.**
  Given `Activation.enabled` is false in routing config,
  When the operator runs `smart.on` with the expected version,
  Then `Activation.enabled` is set true over the routing Config.Service authority,
  and `smart.status` reports the projected enabled state.

- **Mutate the budget under CAS.**
  Given the effective budget is seeded from `DEFAULT_ROUTING_BUDGET`,
  When the operator runs `budget.set` with the expected version,
  Then the mutation persists under the optimistic CAS expectation and returns an
  audit correlation.

- **Reject a stale mutation.**
  Given the persisted config version has advanced past the operator's expected
  version,
  When the operator runs `budget.set` with the stale expected version,
  Then the mutation degrades to the typed `version_conflict` envelope and no
  fabricated success is returned.

- **Degrade honestly when config is unreachable.**
  Given the Config.Service authority is unreachable,
  When the operator runs `pools.status`,
  Then the read degrades to the typed `unavailable` envelope and no effective state
  is synthesized.

- **Flip TUI availability.**
  Given the Feature 011 grouped operator menu lists the four Configure sections,
  When the availability map is consulted for telemetry/smart/budget/pools,
  Then each domain reports `persists_today` and its Configure entries are editable.

- **Preserve command parity.**
  Given the same command id is dispatched from palette, slash, CLI, and TUI,
  When any telemetry/smart/budget/pools verb is invoked,
  Then it rides the same `OperatorClient` loopback with no new dispatch path, and
  no catalog id is added and no catalog version is bumped.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and mutates operator
  configuration: telemetry export settings (including a `SecretRef` for export
  headers), the smart-routing enabled flag, the budget policy, and the role-pool
  map. Reads project bounded, redacted summaries only; the raw config payload, the
  resolved header value, and any endpoint credential are never surfaced. The
  effective-config shapes are reused unchanged, so no new sensitive field is
  introduced.
- **Authentication/authorization.** No new authenticated surface. Every verb rides
  the Feature 007 `OperatorClient` loopback and operator principal, scope,
  version/CAS, and confirmation gates (Feature 007 FR11/FR28); the domain ports
  register no command ids and cannot relax those gates. The only new outbound
  network action is the `telemetry.test` probe, which authenticates nothing and
  targets only the operator-configured endpoint.
- **Input validation.** The untrusted inputs are the mutation payloads
  (`telemetry.configure`, `smart.*`, `budget.set`, `pools.set`) and the configured
  endpoint the probe dials. Payloads are schema-validated against the reused
  effective-config schemas and rejected with a typed `invalid_argument` envelope on
  mismatch; the probe treats a malformed or absent endpoint as `misconfigured` and
  performs no network I/O in that case. The `SecretRef` is validated against its
  canonical `backend:name[@vN]` pattern and never dereferenced into plaintext at
  this layer.
- **Cryptography in transit/at rest.** The telemetry export secret is stored only
  as a `SecretRef`; its value is resolved by the Feature 007 SecretPort at export
  time, not by this feature, and is never persisted or logged in plaintext. The
  `telemetry.test` probe honours the configured transport (the user's Alloy stack
  runs OTLP without TLS; a TLS endpoint is dialled over its configured scheme). No
  new at-rest secret store is introduced.
- **Logging/audit.** Mutations emit the Feature 007 audit correlation through the
  same EventV2 authority langlock uses, with content-free, bounded labels (command
  id, domain, outcome). The probe records only its typed outcome and target
  transport/endpoint host — never a header value, payload fragment, or credential.
  No raw config is logged.
- **Error-handling information exposure.** Every failure path degrades to a typed
  envelope (`unavailable`, `invalid_argument`, `version_conflict`) carrying only a
  bounded, secret-free reason. A config-unreachable read, a stale mutation, or a
  failed probe never leaks a stack trace, endpoint credential, secret value, or raw
  config payload in a result, toast, or log.

## Domain Model

The four domain ports and the telemetry probe are specified as ValueObjects in
`doc/arch/schemas/operator-config-domains/` and the probe lifecycle as a statechart
in `doc/arch/statecharts/telemetry-probe.md`:

```
telemetry.* → TelemetrySummary (read) | ConfigMutation → MutationEnvelope (write)
            → telemetry.test → ProbeResult(outcome ∈ {reachable | unreachable | misconfigured})
smart.*     → SmartSummary (read)     | SmartMutation  → MutationEnvelope (write)  [projection of RoutingConfig.Activation]
budget.*    → BudgetSummary (read)    | ConfigMutation → MutationEnvelope (write)  [over RoutingConfig.Enforcement.budget]
pools.*     → PoolsProjection (read)  | ConfigMutation → MutationEnvelope (write)  [projection of RoutingConfig.Models.role_pools]

Every mutation carries a CasExpectation(authority, expectedVersion); a stale
version → version_conflict; an unreachable config → unavailable; never a fabricated
success (FR7, FR8).
```

## Observability

Operator dispatches for the four domains continue to project through the Feature
007 EventV2 audit and the ADR-0001 OTLP foundation with content-free, bounded
labels (command id, domain, surface, scope, outcome). The `telemetry.test` probe
emits no telemetry signal content of its own and records only its typed outcome and
target transport; no endpoint credential, header value, config payload, or role-pool
model id is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Re-authoring the effective-config shapes (telemetry/routing/budget schemas) —
  they are reused unchanged.
- Adding any catalog id, bumping the catalog version, or introducing a new dispatch
  path, parallel registry, or divergent command name.
- A new feature flag or an i18n/translation layer.
- App/Desktop parity (Feature 007 Phase 2).
- Changing the routing decision engine, the telemetry export transport
  implementation, or any domain runtime beyond exposing its config through the
  control plane.

## Related Features and Decisions

- [ADR-0013 — Wire the four remaining config-backed operator domains](../../adr/0013-wire-the-four-remaining-config-backed-operator-domains-so.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant (FR11), budget/pools control-plane-only mutation (FR28), SecretPort seam, telemetry.test as test-signal only (FR30).
- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — telemetry/smart/budget/pools management only via the control plane (FR46–48); the reused effective-config shapes.
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md) — the domain-stack template (port/command-port/backend-live/persistence/stack-wiring) and honest-degradation pattern replicated here.
- [Feature 011 Restructure the Operator Control Plane TUI](../011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md) — the grouped menu and availability affordance flipped by FR12.
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [Domain schema](../../schemas/operator-config-domains/enums.cue)
- [Telemetry probe statechart](../../statecharts/telemetry-probe.md)

## Clarifications
