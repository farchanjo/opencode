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

- [ ] T001 — telemetry protocol command module (`protocol/src/telemetry/`)
- [ ] T002 — smart protocol command module (`protocol/src/smart/`)
- [ ] T003 — budget protocol command module (`protocol/src/budget/`)
- [ ] T004 — pools protocol command module (`protocol/src/pools/`)
- [ ] T005 — telemetry domain stack over the effective telemetry config
- [ ] T006 — smart domain stack over `RoutingConfig.Activation`
- [ ] T007 — budget domain stack over `RoutingConfig.Enforcement.budget`
- [ ] T008 — pools domain stack over `RoutingConfig.Models.role_pools`
- [ ] T009 — Wire the four ports into `stack-live.ts`; remove the four stubs
- [ ] T010 — Drop the stale `STATUS_SHOW_IDS` shadow from `config-status.ts`
- [ ] T011 — Flip `OPERATOR_PERSISTING_DOMAINS` to include the four domains
- [ ] T012 — `telemetry.test` real bounded OTLP reachability probe
- [ ] T013 — Unit tests: telemetry stack (read / CAS / unavailable / invalid)
- [ ] T014 — Unit tests: smart stack
- [ ] T015 — Unit tests: budget stack
- [ ] T016 — Unit tests: pools stack
- [ ] T017 — Unit tests: telemetry probe (reachable / unreachable / misconfigured)
- [ ] T018 — Integration tests: wiring + status-shadow removal
- [ ] T019 — Parity test: same command id, no new path / id / version bump (FR11)
- [ ] T020 — TUI availability test: four domains `persists_today`
- [ ] T021 — Doc sync + `speckit validate` green

---

## Group A — Protocol command modules (FR1)

- [ ] **T001 — telemetry protocol command module**
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
- **Evidence:** _(implement)_

- [ ] **T002 — smart protocol command module**
- **Depends:** none
- **[P]** with T001, T003, T004
- **Paths:** `packages/protocol/src/smart/**`
- **Deliverable:** `SmartSummary` read model (projected `enabled`/`auto`), the
  `on`/`off`/`auto` mutation inputs with `expectedVersion`, and the typed error
  union; smart is a projection of `RoutingConfig.Activation`, not a second store.
- **Acceptance:** module type-checks; mutation inputs carry `expectedVersion`.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** _(implement)_

- [ ] **T003 — budget protocol command module**
- **Depends:** none
- **[P]** with T001, T002, T004
- **Paths:** `packages/protocol/src/budget/**`
- **Deliverable:** `BudgetSummary` + bounded limits view read models, the
  `set`/`reset` inputs with `expectedVersion`, the `validate` output, and the typed
  error union; over `RoutingConfig.Enforcement.budget`.
- **Acceptance:** module type-checks; the limits view is bounded.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** _(implement)_

- [ ] **T004 — pools protocol command module**
- **Depends:** none
- **[P]** with T001, T002, T003
- **Paths:** `packages/protocol/src/pools/**`
- **Deliverable:** `PoolsProjection` read model over the role-pool bindings, the
  `set`/`reset` inputs with `expectedVersion`, the `validate` output, and the typed
  error union; a projection of `RoutingConfig.Models.role_pools`.
- **Acceptance:** module type-checks; the projection is a bounded binding list.
- **Verification:** `bun run typecheck` + `packages/protocol/test/**`.
- **Evidence:** _(implement)_

---

## Group B — Domain stacks (FR2-FR5, FR7, FR8)

- [ ] **T005 — telemetry domain stack**
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
- **Evidence:** _(implement)_

- [ ] **T006 — smart domain stack**
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
- **Evidence:** _(implement)_

- [ ] **T007 — budget domain stack**
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
- **Evidence:** _(implement)_

- [ ] **T008 — pools domain stack**
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
- **Evidence:** _(implement)_

---

## Group C — Stack wiring + shadow removal (FR9)

- [ ] **T009 — Wire the four ports into `stack-live.ts`; remove the four stubs**
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
- **Evidence:** _(implement)_

- [ ] **T010 — Drop the stale `STATUS_SHOW_IDS` shadow**
- **Depends:** T009
- **Paths:** `packages/opencode/src/operator/adapters/outbound/config-status.ts`
- **Deliverable:** remove `telemetry.status`/`show`, `smart.status`,
  `budget.status`/`show`, and `pools.status`/`show` from `STATUS_SHOW_IDS` so the
  real domain ports win (the langlock shadow-removal precedent); `routing.status`
  and the `semantic.*` entries stay untouched (FR9).
- **Acceptance:** the eight ids no longer shadow the real reads; routing/semantic
  status handlers unchanged.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

---

## Group D — TUI availability (FR12)

- [ ] **T011 — Flip `OPERATOR_PERSISTING_DOMAINS`**
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
- **Evidence:** _(implement)_

---

## Group E — Telemetry reachability probe (FR6, FR10)

- [ ] **T012 — `telemetry.test` real bounded OTLP reachability probe**
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
- **Evidence:** _(implement)_

---

## Group F — Tests + doc sync

- [ ] **T013 — Unit tests: telemetry stack**
- **Depends:** T005
- **[P]** with T014, T015, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert a read projects the effective telemetry config into the
  summary; a `configure`/`on`/`off` persists under CAS and returns an audit id; a
  stale version → `version_conflict`; config-unreachable → `unavailable`; an invalid
  payload → `invalid_argument`; the export header is stored as a `SecretRef` only.
- **Acceptance:** suite green across the five outcomes + secret-ref assertion.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T014 — Unit tests: smart stack**
- **Depends:** T006
- **[P]** with T013, T015, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `status` projects `Activation`; `on`/`off`/`auto` CAS-write
  the routing authority; stale → `version_conflict`; unreachable → `unavailable`.
- **Acceptance:** suite green across read/mutation/CAS/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T015 — Unit tests: budget stack**
- **Depends:** T007
- **[P]** with T013, T014, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `show` returns the bounded limits view; `set`/`reset`
  CAS-write; `validate` mutates nothing; stale → `version_conflict`; unreachable →
  `unavailable`; the default ceiling is never silently relaxed.
- **Acceptance:** suite green across read/mutation/validate/CAS/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T016 — Unit tests: pools stack**
- **Depends:** T008
- **[P]** with T013, T014, T015
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `show` projects the role-pool bindings; `set`/`reset`
  CAS-write the map; `validate` mutates nothing; stale → `version_conflict`;
  unreachable → `unavailable`.
- **Acceptance:** suite green across read/mutation/validate/CAS/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T017 — Unit tests: telemetry probe**
- **Depends:** T012
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `reachable` against a local mock collector, `unreachable`
  on a refused/timeout endpoint (bounded, never hangs), and `misconfigured` with no
  endpoint (no network I/O); assert the probe emits no telemetry signal content and
  mutates nothing.
- **Acceptance:** suite green across the three probe outcomes + no-signal assertion.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T018 — Integration tests: wiring + status-shadow removal**
- **Depends:** T009, T010
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert the four verbs dispatch to the real domain ports (not
  `not_implemented`) through `stack-live.ts`, and that the dropped `STATUS_SHOW_IDS`
  no longer shadow the real reads (routing/semantic status unchanged).
- **Acceptance:** suite green; no verb resolves `not_implemented`; routing/semantic
  status intact.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T019 — Parity test: same command id, no new path / id / version bump**
- **Depends:** T009
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert each of the four
  domains' verbs rides the SAME canonical command id through the SAME `OperatorClient`
  loopback as slash/CLI, with no new dispatch path, no new catalog id, and no catalog
  version bump (FR11).
- **Acceptance:** command-id parity holds for one read + one mutation per domain; the
  catalog version is unchanged.
- **Verification:** parity assertion green.
- **Evidence:** _(implement)_

- [ ] **T020 — TUI availability test: four domains `persists_today`**
- **Depends:** T011
- **Paths:** `packages/core/test/operator/**`
- **Deliverable:** assert the palette availability map reports `persists_today` for
  telemetry/smart/budget/pools and that their Configure entries are editable; the
  five pre-existing persisting domains are unchanged.
- **Acceptance:** suite green; four domains flipped; others intact.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T021 — Doc sync + `speckit validate` green**
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
- **Evidence:** _(implement)_

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
