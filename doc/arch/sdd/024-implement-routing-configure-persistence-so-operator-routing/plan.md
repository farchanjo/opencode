# Implementation Plan: Implement Routing Configure Persistence So Operator Routing

Feature: 024-implement-routing-configure-persistence-so-operator-routing
Status target: implemented (this plan tracks the completed implement pass)
ADR: [ADR-0024](../../adr/0024-implement-routing-configure-persistence-so-operator-routing.md) **proposed**
Spec: [spec.md](spec.md) (FR-A..FR-E; audit result; domain model; mirror-smart/pools + partial-merge-under-CAS + single-committed-write invariants)

## Overview

`routing.configure` is the ONE config-backed operator command that never persists:
its inbound adapter hardcoded `fail("not_implemented", …)`
(`packages/opencode/src/routing/adapters/inbound/routing-command-port.ts:133-136`,
pre-024), so the TUI "Routing configure" **Save** surfaced a RED warning and the
operator **could not activate routing**. The persisting writer already exists but was
orphaned — `RoutingConfigPort.set()`
(`packages/opencode/src/routing/adapters/outbound/config-adapter.ts:130-145`) CAS-writes
the routing document, yet `createRoutingDomainPort` was handed only a READ source
(`toRoutingConfigSource`) at `stack-live.ts:813`. This plan wires a write-capable
**configure backend** that mirrors the `smart`/`pools` backends EXACTLY (read effective
via `createConfigAdapter`; return an `OperatorMutationPlan` the dispatcher commits via
`mutateAuthority`), replaces the `not_implemented` stub with a validated mutation-plan
path, and **partial-merges** the configure fields into the shared `routing` document
under CAS so `role_pools` (`pools.set`) and sibling `activation` (`smart.*`) are never
clobbered.

**Audit conclusion driving this plan (every anchor verified 2026-07-20):**

- **The write path is `mutateAuthority`, not `.set()`.** `smart`/`pools` use
  `createConfigAdapter` for READS and return an `OperatorMutationPlan`; the dispatcher's
  single `mutateAuthority` CAS write commits it (`mutation.ts:277-296`). The configure
  backend follows the SAME contract — the single-committed-CAS-write invariant holds.
- **`apply(current)` sees the FRESH payload.** `mutateAuthority` threads the
  commit-time on-disk payload to `apply` (`mutation.ts:224,277`), so merging into
  `current` preserves siblings even under a concurrent write, stronger than a plan-time
  snapshot.
- **Three writers share `routing`.** `pools.set` (`PROJECT_AUTHORITY="routing"`),
  `smart.*`, and `routing.configure` all target the same per-scope document; the merge
  must preserve the other two's fields.

**Explicitly out of this plan (invariants preserved):**

- **No self-commit, no parallel store.** The backend reads via `createConfigAdapter`
  and returns a plan; it never calls `.set()` in the dispatch path and opens no second
  store.
- **No contract change.** No operator payload, command id, catalog version, dispatch
  path, server/port surface, or feature flag is added or altered — `routing.configure`
  was already `mutates: true` (`packages/core/src/operator/catalog.ts:83`).
- **`RoutingConfigPort.set()` unchanged.** It stays a full-document CAS writer; the
  operator-dispatch merge lives in the plan's `apply` (FR-C).

## Technical Approach

### Architecture layers affected

```
Phase A — export the routing-module authority SSOT  (FR-A, NFR)
  config-adapter.ts: export AUTHORITY { global:"global:routing", project:"routing" }
    - one source of truth shared by the configure backend (smart re-exports its own)
        |
        v
Phase B — the write-capable configure backend  (FR-A, FR-B, FR-C, Security)
  configure-backend.ts: createRoutingConfigureBackend({ config })
    - reads effective (project>global>default) via createConfigAdapter (no parallel store)
    - planConfigure(input): validate patched RoutingConfig.Info at plan time
        invalid mode / malformed budget / schema violation -> invalid_argument
    - return { authority: AUTHORITY[scopeForOrigin], apply }
    - apply(current) = merge enabled/mode/budget INTO fresh persisted doc (preserve siblings)
        |
        v
Phase C — the inbound mutation-plan path  (FR-B, FR-D)
  routing-command-port.ts: createRoutingDomainPort(routing, configure?)
    - parse { enabled, mode, ...advanced }; validate mode; reject empty payload
    - backend absent -> not_implemented (read-only port)
    - runPlan(configure.planConfigure(input)) -> { kind:"mutation_plan", ...plan }
        |
        v
Phase D — compose into the live stack  (FR-A)
  stack-live.ts:818: routing: createRoutingDomainPort(routingService,
    createRoutingConfigureBackend({ config: store.config }))
        |
        v
Phase E — regression proof + validate  (FR-E, FR-all)
  feature024-configure-persist.test.ts over the REAL wired dispatcher:
    (a) Save persists activation/mode/policy + version bump; 2nd configure persists
    (b) coexistence: pools + smart + routing, on-disk config.json + fresh re-read
    (c) invalid policy -> typed invalid_argument, nothing committed
    (d) stale expectedVersion -> conflict, nothing committed
  bun test test/routing/ test/operator/ green; tsc 0 new; speckit validate --json ok
```

### Guard-scope note

Every write lands inside the active-feature implement scope
(`doc/arch/speckit.toml` `[guard] specScopeGlobs`): the routing adapter files
`packages/opencode/src/routing/adapters/outbound/{config-adapter,configure-backend}.ts`
and `packages/opencode/src/routing/adapters/inbound/routing-command-port.ts` are under
`packages/opencode/src/routing/**`; the composition change is
`packages/opencode/src/operator/stack-live.ts` (under `operator/**`); the regression
test lands under `packages/opencode/test/routing/**`. No file outside scope is written —
the `smart`/`pools` backends are READ (their pattern is mirrored), not modified.

### Phase A — Export the routing-module authority SSOT (FR-A, NFR)

- Make `AUTHORITY` (`{ global: "global:routing", project: "routing" }`) an **export** of
  `config-adapter.ts` (was private). The configure backend consumes it so the routing
  module has ONE authority map, matching how `pools`/`smart`/`budget`/`command-authority`
  already resolve the same `routing` document — no re-typed table.

### Phase B — The write-capable configure backend (FR-A, FR-B, FR-C)

- `createRoutingConfigureBackend({ config })` reuses `createConfigAdapter` for reads.
  `planConfigure(input)` resolves the effective config (project>global>default) for the
  merge base + write scope (`scopeForOrigin`), VALIDATES the patched
  `RoutingConfig.Info` at plan time (a malformed advanced policy / invalid mode fails as
  `invalid_argument` BEFORE any plan), and returns `{ authority, apply }`.
- `apply(current)` decodes the FRESH persisted payload and merges ONLY
  `activation.enabled`/`mode` + `enforcement.budget` into it (preserving
  `models.role_pools` + sibling activation); on create-if-absent it falls back to the
  plan-validated document.

### Phase C — The inbound mutation-plan path (FR-B, FR-D)

- `createRoutingDomainPort(routing, configure?)` gains the optional backend. The
  `routing.configure` case parses `{ enabled, mode, ...advanced }`, validates `mode`
  against `always|auto|never`, rejects an all-empty payload, and — when a backend is
  present — returns the plan via a `runPlan` helper (mirroring `smart`/`pools`
  `runPlan`). With NO backend it keeps answering `not_implemented`. RoutingErrors map to
  the existing operator failure envelope.

### Phase D — Compose into the live stack (FR-A)

- Wire `createRoutingDomainPort(routingService, createRoutingConfigureBackend({ config: store.config }))`
  at `stack-live.ts:818`, over the SAME committed `store.config` seam smart/budget/pools
  use — no parallel store, no new command id.

### Phase E — Regression proof + validate (FR-E)

- `feature024-configure-persist.test.ts` drives the REAL wired dispatcher (smart + pools
  + routing over one `store.config`, production authority resolver threaded) and proves
  (a)-(d) above, including a physical on-disk `config.json` coexistence round-trip and a
  fresh-store re-read. `bun test test/routing/ test/operator/` green; `bunx tsc --noEmit`
  0 new errors (beyond the pre-existing `dialog-move-session.tsx`); `speckit validate
  --json` `ok:true`.

## Companion Artifacts

The following optional companion files may be created alongside this plan:

- `research.md` — the smart/pools mirror analysis and the `mutateAuthority.apply(current)`
  merge finding (captured inline in the spec and ADR; deferred as a separate file).
- `data-model.md` — the routing.configure persistence + merge guarantees, specified
  instead in
  `doc/arch/schemas/implement-routing-configure-persistence-so-operator-routing.cue`.
- `contracts/` — no new interface contract; the operator payload, command id, and
  dispatch path are unchanged.
- `quickstart.md` — reproducing the Save-persists + coexistence flow over the operator
  sandbox (covered by `feature024-configure-persist.test.ts`).
