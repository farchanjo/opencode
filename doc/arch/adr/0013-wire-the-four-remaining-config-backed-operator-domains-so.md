---
status: accepted
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0013 — Wire the Four Remaining Config-Backed Operator Domains

## Context and Problem Statement

Feature 007 established the operator control plane as the single native authority
for setup and management, and Features 002–006/008 replaced the generic domain
stubs for `process`, `task`, `jobs`, `langlock`, `output`, `semantic`, and `mcp`
with real typed domain ports over the Config.Service authority. Four reserved
catalog domains remain wired to the generic stub:

- `createDomainStubs()` (`packages/opencode/src/operator/adapters/outbound/domain-stubs.ts:101-116`)
  still maps `telemetry`, `smart`, `budget`, and `pools` to the generic
  `stubInvoke`, so every verb resolves `not_implemented`.
- `stack-live.ts` (`~412-423`, the `wireDomainPorts` spread) overrides
  `lifecycle`/`jobs`/`langlock`/`output`/`semantic`/`mcp`/`routing` but never
  `telemetry`/`smart`/`budget`/`pools`.
- As a stopgap, `config-status.ts` maps `telemetry.status`/`show`,
  `smart.status`, `budget.status`/`show`, and `pools.status`/`show` to a generic
  Config-backed status handler (`STATUS_SHOW_IDS`,
  `packages/opencode/src/operator/adapters/outbound/config-status.ts:41-56`) that
  reports only `configured`/`available` — not the domain's real effective state —
  and the mutating verbs stay stubbed.

The effective state these four domains manage **already exists** and is already
Config-backed:

- **telemetry** — `resolveEffectiveTelemetryConfig` (already called at
  `stack-live.ts:326`) over `packages/schema/src/telemetry/config.ts`;
  `telemetry.configure` carries export headers as `SecretRef` only (Feature 007
  SecretPort seam), never plaintext.
- **smart** — `RoutingConfig.Activation.enabled`
  (`packages/schema/src/routing/config.ts`) over the routing config authority
  (`routing` / `global:routing`, `config-adapter.ts`).
- **budget** — `RoutingConfig.Enforcement.budget` seeded from
  `DEFAULT_ROUTING_BUDGET`, never silently relaxed.
- **pools** — the `RoutingConfig.Models.role_pools` map; `pools` is a **projection**
  of routing config, not a standalone store.

The corpus mandates exposing exactly these four through the control plane: Feature
001 FR46–48 requires telemetry/smart/budget/pools management ONLY via the operator
plane, and Feature 007 FR28 (budget/pools mutation only via the control plane) and
FR11 (domains own backends; 007 owns registration) constrain how. Leaving them
stubbed means the palette/slash/CLI/TUI advertise verbs that always fail, and the
Feature 011 grouped TUI shows the four Configure sections as permanently
honest-unavailable even though their config is live.

## Decision Drivers

- **Reuse the existing effective config.** telemetry/smart/budget/pools state is
  already Config-backed; wire ports onto it rather than author new stores.
- **One command authority (Feature 007 FR11).** Feature 007 stays the sole
  command-registration authority; this feature adds no catalog id and bumps no
  catalog version — it only supplies typed domain ports and their stack wiring.
- **Same seam as langlock/jobs.** Mutations persist through the SAME Config.Service
  seam (`createLiveConfigServiceLike` / `store.config`) langlock uses, under CAS.
- **Honest degradation.** A config-unreachable read or a stale mutation degrades to
  a typed envelope (`unavailable`, `version_conflict`, `invalid_argument`) — never
  a fabricated success (the jobs/langlock honest-degradation pattern).
- **Parity.** Same command ids across palette/slash/CLI/TUI; no new dispatch path.
- **Real probe, test-signal only.** `telemetry.test` performs a real, bounded OTLP
  reachability probe that sends no signal content and never blocks the loop
  (Feature 007 FR30 keeps `telemetry.test` test-signal only).

## Considered Options

- **Replicate the langlock file set per domain (protocol command modules + a
  domain stack of port/command-port/backend-live/persistence/stack-wiring), wire
  the four ports into `stack-live.ts`, and drop the stale generic status entries** —
  onto the already-live effective config, honest-degrading through the same seam.
- **Keep the generic Config-status handler and only add the mutating verbs** —
  leaves reads reporting `configured`/`available` instead of the real effective
  state (enabled flag, endpoint, limits, bindings); rejected as dishonest.
- **Author a fresh config store per domain** — duplicates the routing/telemetry
  config that already exists and drifts from the runtime that consumes it;
  rejected.
- **Fold the four domains into the routing port** — collapses four reserved
  catalog domains and their distinct verbs into one; breaks the catalog surface
  and the Feature 011 grouped menu; rejected.

## Decision Outcome

Chosen option: **Replicate the langlock domain-stack template for each of the four
domains over the existing effective config, wire them into the composition root,
and retire the generic stub/status shadow — preserving the Feature 007 parity and
registration invariants.**

- **Protocol command modules.** A typed `packages/protocol/src/{telemetry,smart,budget,pools}/`
  module per domain defines the request/response payloads and the typed error
  union each port consumes (mirroring `protocol/src/langlock/{commands,ports}.ts`).
- **Domain stacks.** A `packages/opencode/src/operator/{telemetry,smart,budget,pools}/`
  stack per domain (`*-port.ts`, `*-command-port.ts`, `backend-live.ts`,
  persistence over `store.config`, `stack-wiring.ts`, `index.ts`) mirroring the
  langlock file set. Reads project the redacted effective config; mutations are
  optimistic CAS writes over the same Config.Service seam.
- **Reuse the existing shapes.** telemetry over `resolveEffectiveTelemetryConfig` +
  `packages/schema/src/telemetry/config.ts`; smart over
  `RoutingConfig.Activation.enabled`; budget over `RoutingConfig.Enforcement.budget`
  + `DEFAULT_ROUTING_BUDGET`; pools as a small projection contract over
  `RoutingConfig.Models.role_pools`. No effective-config shape is re-authored.
- **Stack wiring.** `stack-live.ts` gains four wirings in the `wireDomainPorts`
  spread, replacing the four generic stubs; `config-status.ts` drops
  `telemetry.status`/`show`, `smart.status`, `budget.status`/`show`, and
  `pools.status`/`show` from `STATUS_SHOW_IDS` so the real domain ports win (the
  langlock shadow-removal precedent).
- **Telemetry probe.** `telemetry.test` runs a real, environment-agnostic OTLP
  reachability probe (`http/protobuf` → minimal POST to `<endpoint>/v1/metrics`;
  `grpc` → TCP dial), bounded by a timeout, returning a typed
  `reachable`/`unreachable`/`misconfigured` outcome; test-signal only.
- **TUI availability flip.** `OPERATOR_PERSISTING_DOMAINS`
  (`packages/core/src/operator/palette.ts`) is extended with `telemetry`, `smart`,
  `budget`, and `pools`, flipping their palette availability from
  `honest_unavailable` to `persists_today` so the Feature 011 Configure entries
  become editable.
- **Parity preserved.** No new catalog id, no catalog version bump, no new dispatch
  path or flag; command ids are unchanged.

The domain contracts are specified as ValueObjects in
`doc/arch/schemas/operator-config-domains/` and the probe lifecycle as a statechart
in `doc/arch/statecharts/telemetry-probe.md`.

### Consequences

#### Positive

- The four config-backed domains expose real effective state and real mutations
  through the palette/slash/CLI/TUI, satisfying Feature 001 FR46–48 and Feature 007
  FR28.
- The Feature 011 Configure sections for telemetry/smart/budget/pools become
  editable, and the availability map is honest again.
- `telemetry.test` gives operators a real, bounded connectivity check without
  emitting telemetry content or blocking the loop.
- Feature 007 stays the sole registration authority: no catalog id or version
  changes; only domain ports and wiring are added.

#### Trade-offs

- Four new domain stacks follow the langlock template, adding surface area kept
  disciplined by reusing the effective-config shapes and the shared CAS seam.
- `pools` is a projection of routing config, so its mutation contract must keep the
  `role_pools` map and the routing schema in step.
- The telemetry probe reaches the network (only when configured); it is bounded and
  test-signal only, but adds an environment-dependent verb (mockable in tests).

#### Follow-ups

- Feature 013 `plan`/`tasks` implement the protocol modules, the four domain
  stacks, the stack wiring and stub/status removal, the telemetry probe, the TUI
  availability flip, and the tests (unit per domain, CAS conflict, honest
  unavailable, probe outcomes, parity).

## Related

- Feature specification: [013 Wire the Four Remaining Config-Backed Operator Domains](../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Routing + telemetry foundation: [001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Domain-stack template: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Navigation feature: [011 Restructure Operator TUI](../sdd/011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md)
- Domain schema: [operator-config-domains ValueObjects](../schemas/operator-config-domains/enums.cue)
- Probe statechart: [telemetry-probe](../statecharts/telemetry-probe.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core smart agent routing](0002-core-smart-agent-routing.md)

## Links

- Related: ADR-0014, ADR-0011.
