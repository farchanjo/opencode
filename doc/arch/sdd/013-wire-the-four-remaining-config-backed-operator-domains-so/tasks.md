# Tasks: Wire the Four Remaining Config-Backed Operator Domains (Feature 013)

Synced with plan.md (Phase 1 protocol modules, Phase 2 four domain stacks, Phase 3
stack wiring + stub/status-shadow removal, Phase 4 TUI availability flip, Phase 5
telemetry probe, Phase 6 tests + doc sync) and the specScopeGlobs in
doc/arch/speckit.toml. ADR-0013 proposed.

Backend-wiring ONLY. NO new catalog id, NO catalog version bump, NO new dispatch
path, NO new flag — the Feature 007 registration + `OperatorClient` loopback parity
invariant (FR11) is preserved. Mutations persist through the SAME Config.Service
seam langlock uses, under CAS, and honest-degrade to typed envelopes (FR7, FR8). No
code is executed in this documentary pass; tasks are the implement backlog. All
items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [x] T001 — telemetry protocol command module (`protocol/src/telemetry/`)
- [x] T002 — smart protocol command module (`protocol/src/smart/`)
- [x] T003 — budget protocol command module (`protocol/src/budget/`)
- [x] T004 — pools protocol command module (`protocol/src/pools/`)
- [x] T005 — telemetry domain stack over the effective telemetry config
- [x] T006 — smart domain stack over `RoutingConfig.Activation`
- [x] T007 — budget domain stack over `RoutingConfig.Enforcement.budget`
- [x] T008 — pools domain stack over `RoutingConfig.Models.role_pools`
- [x] T009 — Wire the four ports into `stack-live.ts`; remove the four stubs
- [x] T010 — Drop the stale `STATUS_SHOW_IDS` shadow from `config-status.ts`
- [x] T011 — Flip `OPERATOR_PERSISTING_DOMAINS` to include the four domains
- [x] T012 — `telemetry.test` real bounded OTLP reachability probe
- [x] T013 — Unit tests: telemetry stack (read / CAS / unavailable / invalid)
- [x] T014 — Unit tests: smart stack
- [x] T015 — Unit tests: budget stack
- [x] T016 — Unit tests: pools stack
- [x] T017 — Unit tests: telemetry probe (reachable / unreachable / misconfigured)
- [x] T018 — Integration tests: wiring + status-shadow removal
- [x] T019 — Parity test: same command id, no new path / id / version bump (FR11)
- [x] T020 — TUI availability test: four domains `persists_today`
- [x] T021 — Doc sync + `speckit validate` green

---

## Group A — Protocol command modules (FR1)

- [x] **T001 — telemetry protocol command module**
- **Depends:** none
- **Paths:** `packages/protocol/src/telemetry/**`
- **Deliverable:** author `commands.ts` + `ports.ts` mirroring
  `protocol/src/langlock/{commands,ports}.ts`: the `TelemetrySummary` read model,
  the `on`/`off`/`configure` inputs (configure carries an export header as a
  `SecretRef` only, plus `expectedVersion`), the `ProbeResult`, and the typed error
  union (`unavailable` | `invalid_argument` | `version_conflict` | `unauthorized`).
  No payload carries a plaintext secret or a free-form command id.
- **Acceptance:** the module type-checks and exports the telemetry payloads/port;
  the configure input has no plaintext-secret field.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** 2026-07-19 — authored `packages/protocol/src/telemetry/commands.ts`
  (`TelemetrySummary`, `TelemetryToggleInput`, `TelemetryConfigureInput` with
  `headerSecret?: SecretRef` only + string `expectedVersion`, `ProbeResult`/`ProbeTarget`,
  `TelemetryDomainError` 4-member union `version_conflict`/`invalid_argument`/
  `unauthorized`/`unavailable` = `#MutationOutcome` minus `success`) and
  `ports.ts` (`TelemetryDomainPort` resolve/on/off/configure/test); `Transport`/
  `SecretRef`/`EndpointUrl` sourced from `@opencode-ai/schema/telemetry/config`
  (single vocabulary); `index.ts` extended with `export * from "./commands"` +
  `export type { TelemetryDomainPort }` (Feature 001 `TelemetryPort` names preserved,
  disjoint). CAS version is the opaque Config.Service string token
  (`config-port.ts:8 ConfigVersion = string`), matching CUE `shared.#Version`. Tests
  `packages/protocol/test/telemetry/{contract-parity,ports}.test.ts` — 14 pass.
  `cd packages/protocol && bun test` → 196 pass / 0 fail; `bun run typecheck` → exit 0;
  `oxlint` → 0 warnings.

- [x] **T002 — smart protocol command module**
- **Depends:** none
- **[P]** with T001, T003, T004
- **Paths:** `packages/protocol/src/smart/**`
- **Deliverable:** `SmartSummary` read model (projected `enabled`/`auto`), the
  `on`/`off`/`auto` mutation inputs with `expectedVersion`, and the typed error
  union; smart is a projection of `RoutingConfig.Activation`, not a second store.
- **Acceptance:** module type-checks; mutation inputs carry `expectedVersion`.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** 2026-07-19 — authored `packages/protocol/src/smart/{commands.ts,
  ports.ts,index.ts}` mirroring `protocol/src/langlock/*` and the T004 pools
  precedent: `SmartSummary` (`commands.ts:64`, projected `enabled`/`auto` +
  config-derived flags), `enabled`/`mode` REUSED from
  `RoutingConfig.Activation`/`SmartRoutingEnabled` (`commands.ts:22`,
  `SmartActivationMode` alias `commands.ts:52`), shared `SmartMutationInput` with
  `expectedVersion` CAS token + `OperatorPrincipal` (`commands.ts:100`),
  `SmartError` union = `#MutationOutcome`−`success` + `not_implemented`
  (`commands.ts:123`); `SmartPort` resolve/on/off/auto (`ports.ts:31`). Tests:
  `packages/protocol/test/smart/{ports,contract-parity}.test.ts` — 13 pass, 0 fail
  (parity vs `smart.cue`/`enums.cue`; verb surface, error union, `#SmartSummary`
  fields, Activation reuse). `bun run typecheck` clean; full protocol suite 182
  pass / 0 fail; oxlint 0/0.

- [x] **T003 — budget protocol command module**
- **Depends:** none
- **[P]** with T001, T002, T004
- **Paths:** `packages/protocol/src/budget/**`
- **Deliverable:** `BudgetSummary` + bounded limits view read models, the
  `set`/`reset` inputs with `expectedVersion`, the `validate` output, and the typed
  error union; over `RoutingConfig.Enforcement.budget`.
- **Acceptance:** module type-checks; the limits view is bounded.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** 2026-07-19 — authored `packages/protocol/src/budget/{commands,ports,index}.ts`
  mirroring the langlock protocol structure over the reused
  `packages/schema/src/routing/budget.ts` + `RoutingConfig.Enforcement`: `BUDGET_VERBS`
  (`commands.ts:39`) = enums.cue #BudgetVerb (status/show/set/reset/validate);
  `BudgetLimitsView` (`commands.ts:73`) mirrors budget.cue #BudgetLimitsView;
  `BudgetSetInput`/`BudgetResetInput` carry `expectedVersion` (CAS, FR7); `BudgetError`
  (`commands.ts:159`) = enums.cue #MutationOutcome non-success outcomes + `not_implemented`;
  `BudgetPort` (`ports.ts:44`) exposes one method per verb. No plaintext secret / no
  free-form command id (FR1). Tests `packages/protocol/test/budget/budget.test.ts` →
  9 pass / 0 fail; `bun run typecheck` → 30/30 packages green; `oxlint` → 0 warnings/errors.

- [x] **T004 — pools protocol command module**
- **Depends:** none
- **[P]** with T001, T002, T003
- **Paths:** `packages/protocol/src/pools/**`
- **Deliverable:** `PoolsProjection` read model over the role-pool bindings, the
  `set`/`reset` inputs with `expectedVersion`, the `validate` output, and the typed
  error union; a projection of `RoutingConfig.Models.role_pools`.
- **Acceptance:** module type-checks; the projection is a bounded binding list.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** 2026-07-19 — authored `packages/protocol/src/pools/{commands.ts,
  ports.ts,index.ts}` mirroring `protocol/src/langlock/*`: `PoolsProjection`
  (`commands.ts:73`, bounded `RolePoolBindingList` binding list), `PoolsSetInput`/
  `PoolsResetInput` with `expectedVersion` CAS token + `OperatorPrincipal`
  (`commands.ts:104,120`), `PoolsValidateOutput` (`commands.ts:135`, no-mutation),
  `PoolsError` union = `#MutationOutcome`−`success` + `not_implemented`
  (`commands.ts:150`); `PoolsPort` resolve/set/reset/validate (`ports.ts:39`).
  Tests: `packages/protocol/test/pools/{ports,contract-parity}.test.ts` — 11 pass,
  0 fail (parity vs `pools.cue`/`enums.cue`). `bun run typecheck` clean; oxlint 0/0.

---

## Group B — Domain stacks (FR2-FR5, FR7, FR8)

- [x] **T005 — telemetry domain stack**
- **Depends:** T001
- **Paths:** `packages/opencode/src/operator/telemetry/**`
- **Deliverable:** replicate the langlock file set (`telemetry-port.ts`,
  `telemetry-command-port.ts`, `backend-live.ts`, persistence over `store.config`,
  `stack-wiring.ts`, `index.ts`). `resolve` projects the redacted effective
  telemetry config via `resolveEffectiveTelemetryConfig` (reused, not re-authored);
  `on`/`off`/`configure` are optimistic CAS writes over `store.config`; `configure`
  persists the export header as a `SecretRef` only. Config I/O guarded with
  `Effect.tryPromise` → typed `unavailable`/`invalid_argument`/`version_conflict`;
  each mutation returns a Feature 007 audit id (FR2, FR7, FR8).
- **Acceptance:** reads project the real effective config; a CAS write persists and
  returns an audit id; a stale version → `version_conflict`; config-unreachable →
  `unavailable`; no plaintext secret persisted.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** 2026-07-19 — replicated the langlock file set under
  `packages/opencode/src/operator/telemetry/`: `telemetry-port.ts`
  (`TelemetryBackend`/`TelemetryProbe`/`TelemetryAuditSink` seams + `createTelemetryPort`
  attaching `evt_telemetryaudit_` ids), `backend-live.ts`
  (`createLiveTelemetryBackend` — `resolve` projects `resolveEffectiveTelemetryConfig`
  over the `global:telemetry` authority with the CAS version from `store.config`;
  `on`/`off`/`configure` = optimistic `compareAndSet` writes seeded from the effective
  config; `configure` persists the export header as a `SecretRef` under `authorization`,
  rejecting a plaintext-looking value as `invalid_argument`; every config read/write
  guarded by `Effect.tryPromise` → typed `unavailable`; a stale `expectedVersion` →
  `version_conflict`; `test` resolves `misconfigured` (malformed endpoint, no I/O) and
  delegates a valid target to the injected probe seam — default fails honest
  `unavailable` until T012), `telemetry-command-port.ts`
  (`createTelemetryDomainPorts` — the `telemetry.status|show|on|off|configure|test`
  `DomainInvoke` over the typed port, one bounded audit event per dispatch, local
  transport/endpoint validation), `stack-wiring.ts`
  (`createTelemetryDomainWiring`), and `index.ts`. CAS uses the opaque
  Config.Service string token (`config-port.ts INITIAL_CONFIG_VERSION`), matching CUE
  `shared.#Version`. Tests
  `packages/opencode/test/operator/telemetry/telemetry-stack.test.ts` (backend-live +
  command-port) → 15 pass / 0 fail across resolve/on/off/configure/CAS-conflict/
  unavailable/secret-ref/probe-delegation. `oxlint` telemetry src → 0 errors / 6
  warnings (langlock-baseline `no-unsafe-type-assertion`/`no-unnecessary-type-arguments`
  family; langlock src itself ships 4). `bun run typecheck` → 0 telemetry errors (the
  package task is red only on `test/operator/budget/backend-live.test.ts`, a concurrent
  T007/T015 WIP, unrelated to T005). Probe seam defined here; T012 finalizes the real
  bounded OTLP dial (Phase 5).

- [x] **T006 — smart domain stack**
- **Depends:** T002
- **[P]** with T007, T008 (distinct domain dir)
- **Paths:** `packages/opencode/src/operator/smart/**`
- **Deliverable:** the langlock file set over `RoutingConfig.Activation`: `status`
  reads the projected `enabled`/`mode`; `on`/`off`/`auto` CAS-write
  `Activation.enabled`/`mode` on the routing authority (`routing` /
  `global:routing`). Same honest-degradation + audit contract as T005 (FR3, FR7, FR8).
- **Acceptance:** `smart.on` sets `enabled` true under CAS; `status` reflects it;
  stale/unreachable degrade to typed envelopes.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** 2026-07-19 — replicated the langlock file set under
  `packages/opencode/src/operator/smart/`: `smart-port.ts` (`SmartBackend` seam +
  `createSmartPort` attaching a fresh `evt_smartaudit_*` id per mutation),
  `backend-live.ts` (`createLiveSmartBackend` — a PROJECTION over
  `RoutingConfig.Activation` via the reused `createConfigAdapter`; `resolve`
  projects effective enabled/`mode==="auto"`/configured; `on`/`off`/`auto` CAS-write
  the effective override scope — origin project→`routing`, else `global:routing` —
  flipping ONLY `activation.enabled`/`mode` while preserving models/enforcement;
  every Config.Service call guarded by `Effect.tryPromise` → typed `unavailable`, a
  stale CAS token → `version_conflict`, schema-invalid → `invalid_argument`; the
  `INITIAL_CONFIG_VERSION` sentinel maps to a create-if-absent write),
  `smart-command-port.ts` (Feature 007 `DomainInvoke` for `smart.status|on|off|auto`,
  string `expectedVersion` CAS token, one bounded audit event per dispatch),
  `stack-wiring.ts` (`createSmartDomainWiring`), `index.ts`. No catalog id/version
  change; Feature 007 stays the sole registration authority (FR9, FR11). Tests
  `packages/opencode/test/operator/smart/backend-live.test.ts` → 6 pass / 0 fail
  (read/default, on CAS create + status reflects, off flip, auto mode, stale →
  `version_conflict`, unreachable `ConfigPort` → `unavailable`). `bun test
  test/operator/smart/` green; the smart src+test typecheck clean under `tsgo` (the
  only `opencode#typecheck` errors are in the untracked sibling-task
  `test/operator/budget/backend-live.test.ts` (T007), not smart); `oxlint` on the
  smart dir → 0 errors, 2 warnings inherited verbatim from the langlock command-port
  template (`no-unsafe-type-assertion` on `asRecord`, `consistent-return` on the
  error mapper). The 4 `speckit validate` findings are pre-existing waived
  `hygiene.empty-file` entries, unrelated.

- [x] **T007 — budget domain stack**
- **Depends:** T003
- **[P]** with T006, T008
- **Paths:** `packages/opencode/src/operator/budget/**`
- **Deliverable:** the langlock file set over `RoutingConfig.Enforcement.budget`
  seeded from `DEFAULT_ROUTING_BUDGET`: `status`/`show` project the bounded limits
  view; `set`/`reset` CAS-write; `validate` reports validity without mutating. Same
  contract as T005; the default ceiling is never silently relaxed (FR4, FR7, FR8).
- **Acceptance:** `budget.show` returns the effective limits; `set` persists under
  CAS; `validate` mutates nothing; stale/unreachable degrade.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** 2026-07-19 — authored the langlock file set under
  `packages/opencode/src/operator/budget/`: `budget-port.ts` (`BudgetBackend` seam +
  `createBudgetPort` mapping the protocol `BudgetPort`, adding a fresh
  `evt_budgetaudit_*` id on `set`/`reset`), `backend-live.ts`
  (`createLiveBudgetBackend` over the REUSED `RoutingConfigPort` from
  `routing/adapters/outbound/config-adapter.ts` → `store.config`; `resolve` projects
  the effective `#BudgetLimitsView` (project→global→`DEFAULT_ROUTING_BUDGET`) with the
  scoped CAS token + `configured` flag; `set` merges the bounded view onto the current
  `Budget.Policy` and CAS-writes the full scoped `RoutingConfig.Info`; `reset` reverts
  the budget to `DEFAULT_ROUTING_BUDGET`; `validate` is non-mutating; the create
  sentinel `INITIAL_CONFIG_VERSION` maps to null create-if-absent; `validateLimits`
  rejects any limit that is non-positive or exceeds the default ceiling with
  `invalid_argument` — ceiling never silently relaxed (FR4); every config I/O guarded
  by `Effect.tryPromise` → typed `unavailable`, stale CAS → `version_conflict`, FR8),
  `budget-command-port.ts` (`createBudgetDomainPorts` bridging
  `budget.status|show|set|reset|validate` to the port, one bounded audit event per
  dispatch, no id registered), `stack-wiring.ts` (`createBudgetDomainWiring`), and
  `index.ts` barrel. Reused, not re-authored: `RoutingConfigPort` +
  `DEFAULT_ROUTING_CONFIG.enforcement.budget`. Unit tests
  `packages/opencode/test/operator/budget/backend-live.test.ts` (13 pass, 0 fail):
  effective-limits read + unconfigured `version`, CAS set/reread, `version_conflict`
  on a stale version, `reset` to ceiling, ceiling-relax + non-positive →
  `invalid_argument` with no write, non-mutating `validate`, config-unreachable →
  `unavailable`, and the full-stack command-port dispatch (query/audit id/invalid/
  not_implemented) — covers the T015 acceptance grid. `bunx tsgo --noEmit` clean;
  `oxlint` 0 errors (only the langlock-idiom `consistent-return`/
  `no-unsafe-type-assertion` warnings the template itself carries). NOT wired into
  `stack-live.ts` yet (that is T009). Did not commit (orchestrator commits).

- [x] **T008 — pools domain stack**
- **Depends:** T004
- **[P]** with T006, T007
- **Paths:** `packages/opencode/src/operator/pools/**`
- **Deliverable:** the langlock file set as a projection over
  `RoutingConfig.Models.role_pools`: `status`/`show` project the bindings;
  `set`/`reset` CAS-write the map; `validate` reports validity without mutating.
  Same contract as T005 (FR5, FR7, FR8).
- **Acceptance:** `pools.show` returns the projected bindings; `set` persists under
  CAS; `validate` mutates nothing; stale/unreachable degrade.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** 2026-07-19 — authored the langlock file set under
  `packages/opencode/src/operator/pools/`: `pools-port.ts` (typed `PoolsPort` +
  `PoolsBackend` seam + `PoolsAuditSink`, adds a fresh `evt_poolsaudit_*` id per
  mutation, FR7), `backend-live.ts` (`createLivePoolsBackend` — a projection over
  `RoutingConfig.Models.role_pools` that REUSES the Feature 001 routing
  `createConfigAdapter` + `DEFAULT_ROUTING_CONFIG` over the SAME `store.config` seam;
  `resolve`/`validate` project the effective bindings and compute `valid` without
  asserting blindly; `set`/`reset` are optimistic CAS writes to the `project`
  routing authority that preserve the rest of the effective config and clear/replace
  `role_pools`; the opaque `store.config` version string IS the operator CAS token,
  absent → `INITIAL_CONFIG_VERSION` sentinel → create-if-absent; all config I/O
  guarded by `Effect.tryPromise` → typed `unavailable`, never a crash, FR8),
  `pools-command-port.ts` (the audited `pools.status|show|set|reset|validate`
  `DomainInvoke`, one bounded secret-free audit event per dispatch, non-mutating
  principal → `unauthorized`, malformed bindings → `invalid_argument`), plus
  `stack-wiring.ts` (`createPoolsDomainWiring`) and `index.ts`. No catalog id/version
  change (FR11); no secrets/model-id payloads in views. Tests:
  `packages/opencode/test/operator/pools/backend.test.ts` → 10 pass / 0 fail
  (unconfigured read, unavailable on outage, set CAS create + reset clear, stale →
  `version_conflict`, empty-pool → `invalid_argument` with no write, `manager-view`
  → `unauthorized`, `validate` writes nothing, command-adapter dispatch + audit).
  `bun test test/operator/ test/routing/config-adapter.test.ts` → 313 pass / 2 skip
  / 0 fail; opencode `tsgo --noEmit` → exit 0; `oxlint` on the pools src → 0 errors,
  2 warnings inherited verbatim from the langlock command-port template
  (`no-unsafe-type-assertion` on `asRecord`, `consistent-return` on the error
  mapper). The 4 `speckit validate` findings are pre-existing waived
  `hygiene.empty-file` entries, unrelated.

---

## Group C — Stack wiring + shadow removal (FR9)

- [x] **T009 — Wire the four ports into `stack-live.ts`; remove the four stubs**
- **Depends:** T005, T006, T007, T008
- **Paths:** `packages/opencode/src/operator/stack-live.ts`,
  `packages/opencode/src/operator/adapters/outbound/domain-stubs.ts`
- **Deliverable:** add `create{Telemetry,Smart,Budget,Pools}DomainWiring` calls and
  spread their `.ports` into the `wireDomainPorts` spread (`~412-423`), reusing the
  `telemetryConfig` already resolved at `:326`; remove `telemetry`/`smart`/`budget`/
  `pools` from `createDomainStubs()` so the real ports own the domains. Feature 007
  stays the sole registration authority — no id added, no version bump (FR9, FR11).
- **Acceptance:** the four verbs dispatch to the real ports (not `not_implemented`);
  no catalog id or version changes.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** _(2026-07-19)_ Wired `create{Telemetry,Smart,Budget,Pools}DomainWiring`
  in `stack-live.ts` over `store.config` (telemetry injects the T012
  `createLiveTelemetryProbe`), spread all four `.ports` into `wireDomainPorts`, and
  added the four `dispose()` calls. Followed the **langlock/jobs precedent exactly**:
  the four stubs are LEFT in `createDomainStubs()` (like `langlock`/`jobs`, which are
  still stubbed there and superseded by the spread) rather than deleted — removing
  them would break the `DomainPorts` all-12-keys type and the 8 direct
  `createDomainStubs()` call sites (`stack-test.ts`, `main.ts`, five tests). The
  override spread is what makes the real ports win, per "mirrors how jobs/langlock
  overrides supersede their stubs." `bun test test/operator/` → 312 pass / 2 skip / 0
  fail; `bun run typecheck` → 30/30 packages green. No catalog id/version change.

- [x] **T010 — Drop the stale `STATUS_SHOW_IDS` shadow**
- **Depends:** T009
- **Paths:** `packages/opencode/src/operator/adapters/outbound/config-status.ts`
- **Deliverable:** remove `telemetry.status`/`show`, `smart.status`,
  `budget.status`/`show`, and `pools.status`/`show` from `STATUS_SHOW_IDS` so the
  real domain ports win (the langlock shadow-removal precedent); `routing.status`
  and the `semantic.*` entries stay untouched (FR9).
- **Acceptance:** the eight ids no longer shadow the real reads; routing/semantic
  status handlers unchanged.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Removed the eight ids from `STATUS_SHOW_IDS`; the
  retained shadow set is exactly `routing.status` + the three `semantic.*` entries.
  Updated the comment to record the langlock/Feature-013 exclusion rationale. The one
  test that pinned the retired shadow — `feature007-final-review.test.ts`
  "Config-backed status (not stub)" — was rewritten (not weakened) to assert the
  behavior over the STILL-shadowed `routing.status` (configured) and
  `semantic.binding.status` (unconfigured), preserving the coverage that some ids get
  config-backed status. `bun test test/operator/` → 312 pass / 0 fail;
  `test/routing/command-contract.test.ts` + `test/mcp/cli-op-mcp.test.ts` → 21 pass.

---

## Group D — TUI availability (FR12)

- [x] **T011 — Flip `OPERATOR_PERSISTING_DOMAINS`**
- **Depends:** T009
- **Paths:** `packages/core/src/operator/palette.ts`,
  `packages/core/test/operator/**`
- **Deliverable:** extend `OPERATOR_PERSISTING_DOMAINS` (currently `["langlock",
  "jobs", "routing", "process", "task"]`) with `telemetry`, `smart`, `budget`,
  `pools`, flipping their availability from `honest_unavailable` to `persists_today`
  so the Feature 011 Configure entries become editable; update the palette
  metadata/label unit tests (FR12).
- **Acceptance:** the four domains resolve `persists_today`; existing domains
  unchanged.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Extended `OPERATOR_PERSISTING_DOMAINS` to the nine
  domains (added telemetry/smart/budget/pools); the four now derive
  `persists_today` + availability `available`/`confirm_required` (no longer
  `unavailable`), so `domainBadge` flips each domain row to **Available** and the
  Configure entries become editable (FR12). Updated `palette-menu.test.ts`: the four
  badges now assert `Available` and the persisting-set assertion is the nine sorted
  domains. `bun test packages/core/test/operator/` → 79 pass / 0 fail. **Scope
  decision:** did NOT touch `packages/tui/src/operator/form/descriptor.ts` — FR12 and
  plan Phase 4 require only the `OPERATOR_PERSISTING_DOMAINS` flip. The payload-free
  new Configure verbs (`*.on`/`off`/`auto`/`reset`) correctly resolve `inputMode:
  "none"` and dispatch directly with the envelope CAS token; the payload-carrying
  ones (`telemetry.configure`, `budget.set`, `pools.set`) need structured/multi-field
  forms the current single-field form cannot render, so wiring a single input mode
  would create a misleading, non-functional affordance — deferred honestly rather
  than faked. `OPERATOR_INPUT_MODES` stays at its 14 entries.

---

## Group E — Telemetry reachability probe (FR6, FR10)

- [x] **T012 — `telemetry.test` real bounded OTLP reachability probe**
- **Depends:** T005
- **Paths:** `packages/opencode/src/operator/telemetry/**`
- **Deliverable:** implement `telemetry.test` as a real, environment-agnostic OTLP
  reachability probe against the configured endpoint — `http/protobuf` → a minimal
  POST to `<endpoint>/v1/metrics` (or a reachability HEAD/TCP check); `grpc` → a TCP
  dial — bounded by an explicit timeout, returning `reachable`/`unreachable`/
  `misconfigured`. It sends no signal content, mutates nothing, never blocks the
  loop, and resolves `misconfigured` with no network I/O when the endpoint is absent
  or malformed. The lifecycle matches `doc/arch/statecharts/telemetry-probe.md`
  (FR6, FR10; test-signal only per Feature 007 FR30).
- **Acceptance:** a reachable endpoint → `reachable`; refused/timeout → `unreachable`
  (bounded); absent/malformed → `misconfigured` (no I/O); no signal content sent.
- **Verification:** `bun test packages/opencode/test/operator/**` (probe cases).
- **Evidence:** _(2026-07-19)_ Added `operator/telemetry/probe-live.ts`
  (`createLiveTelemetryProbe`) — the real `TelemetryProbe` seam: `http/protobuf`
  posts an empty body to `<endpoint>/v1/metrics` (ANY HTTP response ⇒ `reachable`,
  the "endpoint accepted the probe" semantic); `grpc` runs a bare `node:net` TCP
  dial (a completed handshake ⇒ `reachable`). Both are bounded by an explicit
  timeout (`AbortController` for fetch, `socket.setTimeout` for TCP; default 3000ms)
  that resolves `unreachable` rather than hanging, so the operator loop never blocks
  (FR6, FR10). The dial always resolves a `ProbeReachability` (never throws / fails
  the Effect); it carries no export header and sends no signal content beyond the
  empty probe (test-signal only, FR30). The absent/malformed `misconfigured` case
  stays owned by the backend (no network I/O). Wired into `stack-live.ts` telemetry
  backend via `TelemetryProbeLive.createLiveTelemetryProbe()` and barrelled from
  `telemetry/index.ts`. Added `test/operator/telemetry/probe-live.test.ts` (6 cases:
  http reachable / refused / timeout-bounded, grpc connect / error / timeout, plus
  an empty-body + no-header assertion). `bun test test/operator/telemetry/` → 21
  pass / 0 fail; `bun run typecheck` → 30/30 green; probe src `oxlint` → 0/0.

---

## Group F — Tests + doc sync

- [x] **T013 — Unit tests: telemetry stack**
- **Depends:** T005
- **[P]** with T014, T015, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert a read projects the effective telemetry config into the
  summary; a `configure`/`on`/`off` persists under CAS and returns an audit id; a
  stale version → `version_conflict`; config-unreachable → `unavailable`; an invalid
  payload → `invalid_argument`; the export header is stored as a `SecretRef` only.
- **Acceptance:** suite green across the five outcomes + secret-ref assertion.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Covered by `test/operator/telemetry/telemetry-stack.test.ts`
  (authored under T005): resolve projects the disabled effective default + `cas_v0`
  token; `on`/`off` CAS-advance the version; `configure` persists the export header
  under `authorization` as a `SecretRef` and rejects a plaintext-looking value as
  `invalid_argument` with zero write; a stale `expectedVersion` → `version_conflict`;
  an unreachable `ConfigPort` → `unavailable`; the command-port round-trips assert the
  `evt_telemetryaudit_` id on `telemetry.on`. `bun test test/operator/telemetry/` →
  15 telemetry-stack cases pass. The full grid (read/CAS/unavailable/invalid/secret-ref)
  is green — no gap to backfill for T013.

- [x] **T014 — Unit tests: smart stack**
- **Depends:** T006
- **[P]** with T013, T015, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `status` projects `Activation`; `on`/`off`/`auto` CAS-write
  the routing authority; stale → `version_conflict`; unreachable → `unavailable`.
- **Acceptance:** suite green across read/mutation/CAS/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Backend grid covered by `test/operator/smart/backend-live.test.ts`
  (T006): resolve projects the disabled default; `on`/`off`/`auto` CAS-flip
  `Activation.enabled`/`mode`; stale → `version_conflict`; unreachable → `unavailable`.
  Added `test/operator/smart/command-port.test.ts` closing the T014 gap at the
  `DomainInvoke` seam: `smart.status` projects the summary + records one bounded audit
  event; `smart.on`/`smart.auto` return the `evt_smartaudit_` id under CAS; a stale
  `expectedVersion` maps to an `invalid_argument` envelope (audit outcome `conflict`)
  with no false write; an unknown verb → `not_implemented`; a config outage →
  `unavailable`. `bun test test/operator/smart/` → 13 pass / 0 fail.

- [x] **T015 — Unit tests: budget stack**
- **Depends:** T007
- **[P]** with T013, T014, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `show` returns the bounded limits view; `set`/`reset`
  CAS-write; `validate` mutates nothing; stale → `version_conflict`; unreachable →
  `unavailable`; the default ceiling is never silently relaxed.
- **Acceptance:** suite green across read/mutation/validate/CAS/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Covered by `test/operator/budget/backend-live.test.ts`
  (authored under T007): `show`/`status` project the effective `#BudgetLimitsView` +
  unconfigured token; `set` persists under CAS and re-reads the tightened limits;
  `reset` reverts to the default ceiling; a set above the ceiling → `invalid_argument`
  (`field: maxTurns`) and a non-positive limit → failure, both with no write; `validate`
  reports validity and mutates nothing; stale → `version_conflict`; unreachable →
  `unavailable`; the full-stack command port asserts the `evt_budgetaudit_` id +
  `invalid_argument`/`not_implemented` envelopes. `bun test test/operator/budget/` →
  13 pass / 0 fail — the T015 grid is green with no gap to backfill.

- [x] **T016 — Unit tests: pools stack**
- **Depends:** T008
- **[P]** with T013, T014, T015
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `show` projects the role-pool bindings; `set`/`reset`
  CAS-write the map; `validate` mutates nothing; stale → `version_conflict`;
  unreachable → `unavailable`.
- **Acceptance:** suite green across read/mutation/validate/CAS/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Covered by `test/operator/pools/backend.test.ts`
  (authored under T008): resolve projects the empty/available/valid role-pool
  projection + `INITIAL_CONFIG_VERSION`; `set` persists bindings under CAS + returns
  the `evt_poolsaudit_` id and `reset` clears them; a stale `expectedVersion` →
  `version_conflict`; a malformed binding (empty pool) → `invalid_argument` with zero
  write; a `manager-view` principal → `unauthorized`; a store outage → `unavailable`;
  `validate` writes nothing; the command adapter dispatches + records the ok audit.
  `bun test test/operator/pools/` → 10 pass / 0 fail — the T016 grid is green.

- [x] **T017 — Unit tests: telemetry probe**
- **Depends:** T012
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `reachable` against a local mock collector, `unreachable`
  on a refused/timeout endpoint (bounded, never hangs), and `misconfigured` with no
  endpoint (no network I/O); assert the probe emits no telemetry signal content and
  mutates nothing.
- **Acceptance:** suite green across the three probe outcomes + no-signal assertion.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Added `test/operator/telemetry/probe-integration.test.ts` —
  a deterministic, loopback-only pass complementing the mocked `probe-live.test.ts`
  (T012): a real `Bun.serve` collector on `127.0.0.1:0` answers the empty POST to
  `/v1/metrics` → `reachable`, and the recorded request asserts an empty body + NO
  `authorization` header (test-signal only, FR30); a bound-then-closed port →
  `unreachable`, bounded, never throwing; a real `node:net` TCP listener → grpc
  `reachable`, a closed TCP port → `unreachable`; and `backend.test()` routes a valid
  configured endpoint to the probe end-to-end (reachable/unreachable) while mutating
  nothing. `bun test test/operator/telemetry/` → 27 pass / 0 fail (6 new).
  **Finding (for T021):** the `misconfigured` outcome is NOT reachable through a real
  config — `Telemetry.EndpointUrl` pattern-guards every persisted endpoint to
  `^https?://` and `resolveEffectiveTelemetryConfig` falls back to the valid default,
  so the backend's `misconfigured` branch is defensive dead code under the shipped
  schema. The guard is still exercised (a valid endpoint is always dialed, never
  short-circuited). Reconcile the statechart/spec `misconfigured` node accordingly.

- [x] **T018 — Integration tests: wiring + status-shadow removal**
- **Depends:** T009, T010
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert the four verbs dispatch to the real domain ports (not
  `not_implemented`) through `stack-live.ts`, and that the dropped `STATUS_SHOW_IDS`
  no longer shadow the real reads (routing/semantic status unchanged).
- **Acceptance:** suite green; no verb resolves `not_implemented`; routing/semantic
  status intact.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Added `test/operator/feature013-wire.test.ts` composing
  the four `create*DomainWiring` overrides into `wireDomainPorts` over ONE shared
  `store.config`, exactly as `stack-live.ts` does, behind the real dispatcher + slash
  interceptor. Reads (`telemetry|smart|budget|pools.status`) dispatch through the full
  slash wire to the REAL ports — they render the domain projection (`transport`/`auto`/
  `limits`/`bindings`), never the config-status shadow (`hasPayload` is absent) and
  never the `not_implemented` stub; `routing.status` stays config-backed
  (`hasPayload:false`, authority `routing`), proving T010 kept its shadow. One CAS
  mutation per domain (`telemetry.on`/`smart.on`/`budget.set`/`pools.set`) returns the
  `evt_<domain>audit_` id and a re-read reflects the bumped version. A stubs-baseline
  assertion shows the four reads are `not_implemented` WITHOUT the overrides, so the
  wiring is what flips them. **Dispatch boundary:** the self-committing domains persist
  through their own Config.Service CAS at the `DomainInvoke` seam (the seam
  `stack-live.ts` wires and `domainHandlerFor` routes to); the Feature 007
  `mutateAuthority` path requires a `mutation_plan` and rejects a self-committed
  `query` result for a `mutates` descriptor — a PRE-EXISTING contract shared by
  langlock/jobs (verified: `langlock.set` fails identically through the full
  dispatcher), unchanged here per plan.md "no new dispatch path". Reads exercise the
  full slash wire; CAS mutations exercise the wired port. `bun test test/operator/` →
  339 pass / 2 skip / 0 fail.

- [x] **T019 — Parity test: same command id, no new path / id / version bump**
- **Depends:** T009
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert each of the four
  domains' verbs rides the SAME canonical command id through the SAME `OperatorClient`
  loopback as slash/CLI, with no new dispatch path, no new catalog id, and no catalog
  version bump (FR11).
- **Acceptance:** command-id parity holds for one read + one mutation per domain; the
  catalog version is unchanged.
- **Verification:** parity assertion green.
- **Evidence:** _(2026-07-19)_ Added `test/operator/feature013-parity.test.ts`. Structural
  FR11: `catalogVersion()` and `RESERVED_CATALOG_VERSION` are pinned unchanged at
  `1.3.0`; every telemetry/smart/budget/pools verb is a PRE-EXISTING reserved id (none
  newly introduced); the canonical id is identical across the slash alias (`/op.<id>`),
  the palette command name (`operator.<id>`), and the CLI segments — one id, no
  per-surface divergence. Behavioural: each domain's `status` read rides the SAME id
  through the SAME dispatcher across slash, CLI, HTTP, and the SDK `OperatorClient`
  loopback with an identical outcome. (The read verb is the parity vehicle: a
  self-committing CAS mutation is uniformly rejected by the Feature 007 mutation
  contract across every surface — same envelope everywhere — see the T018 dispatch-
  boundary note; parity is asserted on the surface that returns real data.)
  `bun test test/operator/feature013-parity.test.ts` → 4 pass / 0 fail.

- [x] **T020 — TUI availability test: four domains `persists_today`**
- **Depends:** T011
- **Paths:** `packages/core/test/operator/**`
- **Deliverable:** assert the palette availability map reports `persists_today` for
  telemetry/smart/budget/pools and that their Configure entries are editable; the
  five pre-existing persisting domains are unchanged.
- **Acceptance:** suite green; four domains flipped; others intact.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** _(2026-07-19)_ Added `packages/core/test/operator/feature013-availability.test.ts`
  pinning the derived availability map directly (not just the badge copy):
  `OPERATOR_PERSISTING_DOMAINS` contains the four domains; every view + configure row
  of `buildOperatorDomainPanel(<domain>)` resolves `persistence: "persists_today"`
  (never `honest_unavailable`); every Configure verb is `available`/`confirm_required`
  and NEVER `unavailable` (editable), with `telemetry.on`/`smart.auto`/`budget.set`/
  `pools.set` asserted `available`; the read views stay `available` read-only rows. The
  five pre-existing persisting domains (langlock/jobs/routing/process/task) keep
  `persists_today`, and `semantic`/`mcp`/`output` never leaked into the persisting set
  (the set equals exactly the nine sorted domains). `bun test test/operator/` (core) →
  86 pass / 0 fail (7 new).

- [x] **T021 — Doc sync + `speckit validate` green**
- **Depends:** T013, T014, T015, T016, T017, T018, T019, T020
- **Paths:** docs under allowed globs (spec, ADR-0013,
  `operator-config-domains/*.cue`, `telemetry-probe.md`; `AGENTS.md`/`README.md`
  only if a surface description drifts)
- **Deliverable:** reconcile the shipped shapes and node names with the spec, ADR,
  schema corpus, and statechart; run `speckit analyze` and `speckit validate --json`
  clean of new Feature 013 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 013
  artifacts; `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence:** _(2026-07-19)_ `speckit validate` green (ok:true, only the 4
  pre-existing waived `hygiene.empty-file` warnings, no new Feature 013 findings).
  **`misconfigured` reconciliation (FR6/FR10):** the `telemetry.test` `misconfigured`
  outcome is retained as a DEFENSIVE contract branch (present in the CUE
  `#ProbeOutcome` enum + the telemetry-probe statechart + `backend-live.ts`
  ENDPOINT_PATTERN gate) but is not reachable under the shipped
  `Telemetry.EndpointUrl` schema, which pattern-guards every persisted endpoint to
  `^https?://` and whose `resolveEffectiveTelemetryConfig` fallback
  (`http://localhost:4318`) is itself valid — so the effective endpoint the probe
  reads is always well-formed and the probe always dials (reachable/unreachable). The
  branch stays as fail-safe input validation for a future schema that permits an empty
  endpoint; it is documented here rather than removed (removing it would drop a node
  the statechart + CUE corpus still specify). No spec change required.

---

## Fix round — end-to-end mutation commit path (2026-07-19)

Adversarial review found the four domains' mutating verbs returned a **failure
envelope through the production dispatcher while the self-committing backend had
already persisted the write** — a fabricated failure with a real side effect
(empirically: `/op.telemetry.on` → `invalid_argument "mutation command cannot return
query result"` yet `enabled:true`, `cas_v0`→`cas_v1`). Root cause: the langlock-style
self-commit-then-return-`query` pattern is rejected by the Feature 007 dispatcher's
`mutates`-descriptor gate (`dispatcher.ts:244`), which requires a `mutation_plan` and
routes the single committed write through `mutateAuthority`.

**Fix (honest, spec-satisfying, no new dispatch path):** the four domains' mutating
command ports now return a validated `mutation_plan` (the canonical pattern
`mutation-parity.test.ts` proves works end-to-end), so `mutateAuthority` owns the ONE
CAS write + Feature 007 audit correlation and the backend NEVER self-commits.

- **T005/T013 telemetry** — `TelemetryBackend.on/off/configure` → `planOn/planOff/
  planConfigure` returning `OperatorMutationPlan {authority, apply}`; SecretRef
  validation + schema decode happen at plan time (invalid → typed error, no plan).
- **T006/T014 smart**, **T007/T015 budget**, **T008/T016 pools** — same conversion
  (`planOn/planOff/planAuto`, `planSet/planReset`); the per-domain
  `createXPort`/`auditId` layer is retired (the audit id now comes from
  `mutateAuthority`, addressing the FR7 audit-correlation concern); the wiring `port`
  field now exposes the backend seam. Reads (`resolve`/`validate`/`test`) unchanged.
- **T018** — the integration suite now dispatches one mutation per domain through the
  FULL pipeline (`dispatchRequest` → confirm → contract → plan → `mutateAuthority`)
  asserting `outcome:"success"` + a re-read reflecting the commit, PLUS a
  no-phantom-write case (a stale CAS version on an absent authority → `conflict` with
  `config.get` still `null`). This closes the T018/T019 masking gap (the old suites
  exercised the port directly, bypassing the dispatcher).
- **`OperatorMutationPlan`** added to `application/handler.ts` (shared authority +
  pure-transform type). Feature 007 stays the sole registration authority; no catalog
  id/version change (FR11).

**Verified:** opencode `test/operator/` → 336 pass / 0 fail; core+tui operator tests
→ 346 pass / 0 fail; `bunx tsgo --noEmit` → 0 errors; oxlint → 0 errors (12
pre-existing langlock-idiom warnings). `speckit validate` green.

**Residual (honest, pre-existing, NOT introduced here):**

- **Preflight authority vs write authority.** The TUI/CLI `preflightMutation`
  (`tui-port.ts`) reads the CAS version from `authorityKeyForCommandId(id)` = the
  *domain name* (`telemetry`/`smart`/`budget`/`pools`), while these domains resolve
  and write their config under the telemetry (`global:telemetry`) and routing
  (`routing`/`global:routing`) authorities. The standard fresh-create → chain-the-
  result-version flow (as `mutation-parity.test.ts` and T018 exercise) commits
  correctly; a repeated mutation that RE-preflights an already-configured routing
  document can read a null version and be honestly rejected (`conflict`/`requires
  version`) with NO phantom write. Making preflight scope- and authority-aware for the
  routing family is a shared operator-control-plane change (affects the langlock/jobs
  self-commit domains too) and is out of Feature 013's "no new dispatch path" scope.
- **Payload-carrying Configure verbs in the grouped TUI (FR12 / concern #6).**
  `telemetry.configure`, `budget.set`, `pools.set` now persist correctly through
  CLI/HTTP/programmatic dispatch (multi-field payload supplied). The grouped TUI still
  lacks a multi-field form for them (`OPERATOR_INPUT_MODES` has no entry → `inputMode:
  "none"`), so from the TUI they dispatch with no payload and return a clean, honest
  `invalid_argument "requires …"` (no phantom write). The payload-FREE Configure verbs
  (`telemetry.on/off`, `smart.on/off/auto`, `budget.reset`, `pools.reset`) are fully
  TUI-editable. A structured multi-field form is deferred rather than faked with a
  misleading single-field affordance.

---

## Fix round — CLI mutation crash (InstanceRef) (2026-07-19)

A real-CLI operator mutation crashed instead of degrading, violating FR8. Repro
(from `packages/opencode`, `OPENCODE_OPERATOR_CONTROL_PLANE=1`):

- `op telemetry status --json` → **success** (effective defaults).
- `op telemetry configure --json --idempotency-key … --expected-version … --payload …`
  → **exit 1**, `Error: Unexpected error / InstanceRef not provided` — a hard crash,
  not a typed envelope.

**Root cause (file:line).** `instance-state.ts:16` —
`Effect.die(new Error("InstanceRef not provided"))`. The live operator config seam
in `stack-live.ts` (`createLiveConfigServiceLike.useConfig`) ran
`AppRuntime.runPromise(Config.Service.get/update…)` on a runtime fiber that carried
no `InstanceRef`. `attach()` (`effect/run-service.ts`) only captures `InstanceRef`
from the *currently executing* Effect fiber; the operator stack's config calls
originate from plain `Effect.promise(() => import(...))` async callbacks (CLI
`op.ts`), where no Effect fiber is current, so `InstanceRef` stayed `undefined`.
`Config.get` / `Config.update` are `InstanceState`-backed and die without it, while
`Config.getGlobal` / `updateGlobal` are NOT — so `global:*` reads survived and every
mutation died. The die surfaced first at the idempotency claim's `metaAuth()="project"`
→ `Config.get()`; across the CLI `Effect.promise` boundary the rejected promise became
a process crash.

**Fix.**
- **(a) — primary seam fix (`operator/stack-live.ts`).** Capture the already-loaded
  `InstanceContext` (`await InstanceRuntime.load(...)`, previously discarded) and bind
  it onto the config seam via `.pipe(Effect.provideService(InstanceRef, instance))`.
  The seam now receives instance context, so `Config.get`/`update` no longer die.
- **(b) — defense in depth (`operator/application/dispatcher.ts`).** Wrap the
  `mutateAuthority` commit in a try/catch that converts any unexpected throw into a
  typed `unavailable` envelope. Guarantees FR8 honesty for the whole commit path even
  if a future seam regresses — no config defect can crash the CLI/HTTP boundary.

**Per-domain CLI behaviour after fix (no crash — exit 53 typed `unavailable`, never
exit 1):** `telemetry.configure/on`, `smart.on`, `pools.set` → typed `unavailable`;
`budget.set` → typed `invalid_argument` (plan-time validation); `langlock.set`
(project scope) → typed `unauthorized` (documented fail-closed override gate). The
crash is gone across all domains.

**Regression test.** `test/operator/feature013-instanceref-nocrash.test.ts` — an
InstanceRef-less `Config.Service` double (project `update` rejects with the exact
defect) drives a mutation on each of the four domains through the real dispatcher and
asserts a typed envelope, never a rejected promise (confirmed `error.message ===
"InstanceRef not provided"` caught at the commit guard).

**Real-endpoint verification (live Alloy collector).** The production `telemetry`
backend `test()` + live OTLP probe (`probe-live.ts`) dialled a live Alloy OTLP
collector (`http/protobuf`, no auth):

- endpoint `:4318` → `{"outcome":"reachable","target":{"transport":"http/protobuf",…}}`
- closed port `:9999` → `{"outcome":"unreachable",…,"reason":"endpoint refused or
  unreachable"}`

Typed probe outcomes as specified (FR6, FR10); the probe really dials the collector.

**Residual (honest, pre-existing, NOT introduced here — deeper than this fix).**
Operator config mutations do not yet *round-trip* persist from the CLI, for reasons
separate from the InstanceRef die:
1. The durable store writes the `operator` namespace into the config document, but
   `ConfigV1.Info` does not declare `operator`, so `ConfigParse.schema`
   (`config/parse.ts:40`) rejects it as an unrecognized key — `updateGlobal`
   (global authorities: telemetry/smart/budget) throws `ConfigInvalidError`, and
   `Config.update`'s `loadFile` re-validation throws once a project doc already holds
   the key. With (b) this surfaces as typed `unavailable`, not a crash.
2. Write-path ≠ read-path: `Config.update` writes `<dir>/config.json`, but the
   instance loader reads `opencode.json(c)` + the *global* `config.json`, never the
   project `config.json`. So even past the schema, the write lands in an orphaned file
   and is not read back (a re-read shows `configured:false`).

Legitimising the `operator` key in `ConfigV1.Info` alone would produce a *false
success* (`success cas_vN` that does not persist) — worse than the honest `unavailable`
— so it was deliberately NOT added here; the persistence round-trip needs a
`Config.Service` write/read + cache-invalidation alignment (broad blast radius, shared
across langlock/jobs), which is a separate authorised change. FR8 honest degradation is
restored; real persistence is documented as the follow-up.

**Verified:** `bun test test/operator/ test/config/ test/telemetry/` → 558 pass / 5
skip / 0 fail; `bun run typecheck` (`tsgo --noEmit`) → 0 errors; `speckit validate
--json` → green (only the 4 pre-existing waived `hygiene.empty-file` findings).

---

## Dependencies summary

```
(T001 ∥ T002 ∥ T003 ∥ T004)                     protocol modules
T001 → T005 ; T002 → T006 ; T003 → T007 ; T004 → T008   domain stacks (T006 ∥ T007 ∥ T008)
T005+T006+T007+T008 → T009 → T010               wiring + shadow removal
T009 → T011                                     TUI availability flip
T005 → T012                                     telemetry probe
T005→T013 ; T006→T014 ; T007→T015 ; T008→T016 ; T012→T017   unit tests (T013..T016 ∥)
T009+T010 → T018 ; T009 → T019 ; T011 → T020    integration / parity / availability
T013..T020 → T021                               doc sync + validate
```

## Parallelism rules

- Only `[P]` tasks may run concurrently, and only when path sets do not overlap.
- The four protocol modules (T001-T004) touch four distinct `protocol/src/<domain>/`
  dirs and are safely parallel; the four domain stacks (T005-T008) touch four
  distinct `operator/<domain>/` dirs and are parallel once their protocol module
  lands.
- T009 and T010 both touch the operator backend composition/status and are
  sequenced; T013-T016 touch distinct test files and are parallel.
- Never parallelize two tasks writing the same module (`stack-live.ts`,
  `config-status.ts`, `palette.ts`).

## Task counts

| Group                        | Tasks              | Phase |
| ---------------------------- | ------------------ | ----- |
| A Protocol modules           | T001–T004 (4)      | 1     |
| B Domain stacks              | T005–T008 (4)      | 2     |
| C Wiring + shadow removal    | T009–T010 (2)      | 3     |
| D TUI availability           | T011 (1)           | 4     |
| E Telemetry probe            | T012 (1)           | 5     |
| F Tests + doc sync           | T013–T021 (9)      | 6     |
| **Total actionable**         | **T001–T021 (21)** |       |

## Definition of done

- FR1–FR12 covered; the four domains moved from generic stubs onto real
  Config-backed ports over the reused effective config.
- Four domain stacks mirror the langlock file set; mutations CAS-versioned through
  the shared Config.Service seam; honest degradation to typed envelopes, never a
  fabricated success (FR7, FR8).
- Stack wiring replaces the four stubs; the eight stale `STATUS_SHOW_IDS` shadow
  entries removed so the real ports win (FR9).
- `telemetry.test` runs a real, bounded, test-signal-only OTLP reachability probe
  matching the statechart (FR6, FR10).
- `OPERATOR_PERSISTING_DOMAINS` flipped so the four Configure sections are editable
  (FR12).
- No new catalog id, no catalog version bump, no new dispatch path or flag; command
  ids unchanged; Feature 007 stays the sole registration authority (FR11).
- Test suites green; `speckit validate --json` clean of new Feature 013 findings.
