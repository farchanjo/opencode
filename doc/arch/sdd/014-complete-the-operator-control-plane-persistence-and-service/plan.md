# Implementation Plan: Complete the Operator Control Plane Persistence and Service

Feature: 014-complete-the-operator-control-plane-persistence-and-service
Status target: planned (after this plan is complete)
ADR: [ADR-0014](../../adr/0014-complete-the-operator-control-plane-persistence-and-service.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR14; domain model; honest-degradation + parity invariants)

## Overview

Feature 007 established the operator control plane as the sole native management
authority; Features 002-006/008/013 replaced the generic domain stubs with real
typed ports. Feature 013's adversarial fix rounds documented two residuals that
keep the plane short of "management works end to end":

1. **Config mutations do not round-trip persist** — the durable store writes an
   `operator` namespace `ConfigV1.Info` rejects (`ConfigParse.schema`,
   `config/parse.ts:40`), and `Config.update`'s write path (`<dir>/config.json`)
   is not the path the instance loader reads (`opencode.json(c)` + *global*
   `config.json`), so a committed `cas_vN` is a false success.
2. **Two command ports still self-commit** — `langlock-command-port.ts:164` and
   the `jobs` command port return `kind:"query"` for a mutating verb, which the
   Feature 007 dispatcher rejects **after** the write persisted; the 013 four
   domains were converted to `mutation_plan`, these two were not.

A third body of work replaces the deliberate honest-gap service backends where a
clean dependency edge exists — `createLiveOutputSpoolBackend({})`
(`stack-live.ts:405`), `createLiveMcpBackend({})` (`:427`), and the config-backed
half of `createLiveSemanticBackend({})` (`:416`) — while the Milvus-gated,
executor-gated, and lifecycle-cancel ops stay **typed** capability gaps by design.

This plan is a **persistence-and-wiring** change: accept the `operator` namespace,
align the config write/read paths and invalidate the cache, convert the last two
self-committing ports to `mutation_plan`, wire the three reachable service
backends, refine the TUI availability to a per-verb `Partial` where a domain is
mixed, and keep every deferred op a typed gap.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR13).** No catalog id is added and no
  catalog version is bumped; this feature supplies only backend wiring and the
  config-schema/round-trip fix.
- **No new dispatch path (parity, FR13).** Each verb rides the SAME
  `OperatorClient` loopback; no parallel registry, divergent name, or new route.
- **Reuse the effective runtime.** The OutputSpool control store, `MCP.Service`
  host, semantic resolver/registry, jobs persistence seam, and routing/telemetry
  config are reused unchanged; the ports and composition root wire onto them.
- **No control-plane flag change.** All work stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`.
- **No fabricated success (FR14).** A config-unreachable read, a stale mutation,
  or an unreachable dependency degrades to a typed envelope; nothing is synthesized.
- **Smallest honest round-trip change.** The write/read alignment chooses the
  minimal change recorded in ADR-0014; the config loader is not re-architected.

## Technical Approach

### Architecture layers affected

```
Config schema (packages/core/src/v1/config/config.ts)
  ConfigV1.Info gains a typed `operator` sub-schema ── SecretRef-only ──▶ (FR1)
        │
        ▼
Config round-trip (packages/opencode/src/config/**)
  Config.update write target ⇄ instance loader read target aligned;
  cache invalidated on commit ── write → invalidate → reload → read ──▶ (FR2, FR3, FR4)
        │  (statechart: doc/arch/statecharts/config-roundtrip.md)
        ▼
Mutation-commit contract (packages/opencode/src/operator/{langlock,jobs}/)
  self-commit + kind:"query" → OperatorMutationPlan → mutateAuthority ──▶ (FR5)
        │  (template: telemetry-command-port.ts runPlan; handler.ts)
        ▼
Service backends (composition root packages/opencode/src/operator/stack-live.ts)
  createLiveOutputSpoolBackend(db)         real control store            ──▶ (FR6)
  createLiveMcpBackend(MCP.Service+McpAuth) real admin host              ──▶ (FR7)
  createLiveSemanticBackend(registry)       config-backed | Milvus-gated ──▶ (FR8, FR11)
  jobs persistence | run-now executor gap ; lifecycle cancel gap         ──▶ (FR9, FR10)
        ▼
TUI availability (packages/core/src/operator/palette.ts)
  persistenceFor/domainBadge refined to per-verb Partial ── mixed domains ──▶ (FR12)
Honest degradation everywhere ── typed envelopes, no fabricated success ──▶ (FR14)
```

The reused runtime — OutputSpool control store
(`packages/opencode/src/outputspool/`), `MCP.Service`
(`packages/opencode/src/mcp/index.ts`), the semantic resolver/registry
(`packages/opencode/src/semantic/`), and the jobs persistence seam
(`packages/opencode/src/jobs/persistence.ts`) — is the single source the ports
wire onto; the persistence ValueObjects are specified in
`doc/arch/schemas/operator-persistence/` and the round-trip lifecycle in
`doc/arch/statecharts/config-roundtrip.md`.

### Phase 1 — Config persistence round-trip (FR1, FR2, FR3, FR4)

- **Accept the `operator` namespace (FR1).** Add a typed `operator` key to
  `ConfigV1.Info` (`packages/core/src/v1/config/config.ts`) whose sub-schema holds
  each config-backed domain's persisted document — typed, not free-form `unknown`,
  and carrying only `SecretRef` references for secret values (FR11). Confirm
  `ConfigParse.schema` (`config/parse.ts:40`) then accepts a persisted operator
  document instead of raising `ConfigInvalidError`.
- **Align write path with read path (FR2).** Decide and record in ADR-0014 the
  smaller honest change: either teach the instance loader to read the file
  `Config.update` writes (project `config.json`), or redirect the operator write to
  a file/authority the loader already consumes. Whichever is smaller and honest —
  the round-trip MUST land on a loader-consumed path. **Adding the schema key
  without this alignment is a false success and is explicitly not shipped.**
  - **Implement note (2026-07-19, T002).** Chosen: teach the loader to read the
    written file, scoped to the `operator` key only. `loadInstanceState` now reads
    `<dir>/config.json` via a `loadOperatorNamespace` helper that plucks and
    validates just the `operator` namespace (never the whole file — a project
    `config.json` is a common unrelated filename whose unknown keys would
    otherwise be rejected). This recovers the orphaned **project-scoped**
    authorities (`routing`); global-scoped authorities (`global:*`) already
    round-trip through the global config file via `updateGlobal`/`getGlobal`.
    Proven end-to-end (T004) by the `pools`/`budget` project-authority CLI
    round-trip surviving fresh processes. Full rationale in ADR-0014 "Decision
    Outcome".
- **Invalidate the config cache (FR3).** On a committed CAS mutation, invalidate the
  loader's cached document for the mutated authority so an immediate re-read
  reflects the new state; keep the invalidation authority-scoped (do not drop
  unrelated cached config).
- **Round-trip acceptance (FR4).** Prove, per config-backed domain (langlock,
  telemetry, smart, budget, pools, jobs), the CLI mutation → success + version bump
  → immediate re-read → process-restart re-read chain, with no `cas_vN` the loader
  fails to read back.

### Phase 2 — `langlock` + `jobs` `mutation_plan` conversion (FR5)

- **Convert `langlock-command-port.ts`** (`:164`) and the `jobs` command port from
  self-commit + `kind:"query"` to returning a validated `OperatorMutationPlan`
  (`application/handler.ts`), exactly as the Feature 013 four domains do — the
  `telemetry-command-port.ts` `runPlan` helper is the template. `mutateAuthority`
  owns the single committed CAS write + the FR7 audit correlation; the backend
  never self-commits. Reads (`resolve`/`status`/`show`/`history`) are unchanged.
- Retire any per-port local `auditId` layer in favour of the id `mutateAuthority`
  attaches (the 013 conversion precedent).

### Phase 3 — OutputSpool backend (FR6)

- **Resolve the AppLayer `Database`** (`packages/opencode/src/effect/app-runtime.ts`)
  and inject it into `createLiveOutputSpoolBackend` (`stack-live.ts:405`), replacing
  the empty-deps honest-gap backend. Back `stat`/`read`/`follow`/`release`/`delete`/
  `purge`/`retention.set`/`quota.set` over `createControlStore(db)`
  (`outputspool/control-store.ts:119`), `page-reader.ts` `readPage`, and
  `retention-sweeper.ts`. Preserve the cross-project export/share deny-by-default
  policy; guard all store I/O with `Effect.tryPromise` → typed `unavailable`.

### Phase 4 — MCP admin backend (FR7)

- **Resolve `MCP.Service` + `McpAuth` via `AppRuntime`** (the routing/provider
  resolution precedent, `stack-live.ts:270-311`) and inject them into
  `createLiveMcpBackend` (`stack-live.ts:427`), replacing the empty-deps backend.
  Back the server/auth/resource/logging/experimental/extension sub-ports over the
  live client host; degrade to typed `mcp_unavailable` only when the service is
  genuinely unbound.

### Phase 5 — Semantic registry backend, mixed domain (FR8, FR11)

- **Wire the config-backed registry ops** — `provider.list`/`add`/`update`/
  `disable`/`delete`/`rotate-secret`, `model.list`/`register`/`disable`,
  `binding.status`/`history`, `embedding`/`reranker` `show`/`select` — into
  `createLiveSemanticBackend` (`stack-live.ts:416`) over
  `semantic/credential-resolver.ts` + config, persisting under CAS through the
  round-trip (Phase 1). `rotate-secret` and every secret value go through the
  Feature 007 `SecretPort` as a `SecretRef` (FR11), never plaintext.
- **Keep the Milvus-gated ops typed gaps.** `index`/`reindex`/`cutover`/`validate`
  (`semantic/milvus-adapter.ts`) stay typed `milvus_unavailable` when no live
  Milvus is reachable; semantic becomes a mixed domain.

### Phase 6 — Jobs persistence + typed executor/cancel gaps (FR9, FR10)

- **Persist the jobs mutations** (`create`/`update`/`enable`/`disable`/`delete`/
  `reschedule`/`show`/`history`) over the `JobPersistence` seam
  (`jobs/persistence.ts`, over config; depends on Phase 1 round-trip).
- **Keep `jobs.run-now` a typed gap** — it needs the Feature 002 executor seam; if
  that seam is unreachable from the operator `AppRuntime`, `run-now` stays typed
  `unavailable` with the boundary recorded in ADR-0014.
- **Keep lifecycle process/task `cancel` a typed gap** —
  `SessionRunCoordinator.interrupt` (`lifecycle/stack-wiring.ts`) is a real
  architectural boundary from the operator `AppRuntime`; it stays typed
  `unavailable` UNLESS a clean dependency edge is found during implement (never
  forced).

### Phase 7 — TUI `Partial` availability refinement (FR12)

- **Refine the palette persistence classification**
  (`packages/core/src/operator/palette.ts`,
  `OPERATOR_PERSISTING_DOMAINS`/`persistenceFor`/`domainBadge`) to per-verb
  granularity so a mixed domain (semantic: registry persists, index Milvus-gated;
  optionally jobs: persistence vs `run-now`) renders the `Partial` badge honestly —
  no verb advertises persistence it lacks, and no persisting verb reads as
  `unavailable`. Update the palette metadata/label unit tests.

### Phase 8 — Tests + doc sync

- **Round-trip (Phase 1).** Per config-backed domain: CLI mutation → success +
  version bump → immediate re-read → process-restart re-read; plus a negative test
  proving FR1 without FR2 is a false success (re-read `configured:false`) so the
  alignment is load-bearing.
- **Commit contract (Phase 2).** `langlock`/`jobs` mutations dispatch through the
  FULL pipeline (`dispatchRequest` → confirm → contract → plan → `mutateAuthority`)
  asserting `outcome:"success"` + a re-read reflecting the commit, and a stale-CAS
  no-phantom-write case (the 013 conversion test pattern).
- **Service backends (Phases 3-6).** OutputSpool reads/mutations against a real
  control store over an in-memory `Database`; MCP admin ops against a live host
  double; semantic registry persist/read under CAS plus the `milvus_unavailable`
  gate; jobs persistence round-trip plus the typed `run-now`/`cancel` gaps.
- **Availability (Phase 7).** The grouped menu renders `Partial` for the mixed
  domain; every persisting verb is editable and no gap verb reads as persisting.
- **Parity (FR13).** Reuse the Feature 007 parity harness to assert each verb rides
  the same command id / same loopback with no new dispatch path, no new catalog id,
  and no catalog version bump.
- **Doc sync.** Keep the spec, ADR-0014, the `operator-persistence/*.cue` corpus,
  and the config-roundtrip statechart in sync with the shipped shapes; refresh
  `AGENTS.md`/`README.md` only if a user-facing surface description drifts.

## Data model and migration strategy

No new store or table: the config-backed domains read and mutate the EXISTING
Config.Service authority, now with a recognized `operator` namespace (FR1) that the
loader reads back after the write/read alignment (FR2) and cache invalidation
(FR3). The service backends read and mutate the EXISTING OutputSpool `Database`,
`MCP.Service` host, and semantic registry. Mutations are optimistic CAS writes
under a `CasExpectation(authority, expectedVersion)`; a stale version degrades to
`version_conflict`. **Migration note:** an operator document persisted before FR1
lands (into an orphaned project `config.json`) is not read by the loader; after the
alignment the loader reads the aligned path — no data migration is required because
the pre-fix write never round-tripped. The operator-surface projections and
readiness classes are typed by the ValueObjects in
`doc/arch/schemas/operator-persistence/` (`#ConfigRoundTrip`, `#RoundTripOutcome`,
`#MutationCommit`, `#MutationEnvelope`, `#ServiceBackend`, and the bounded enums
`#ConfigBackedDomain`, `#ServiceBackedDomain`, `#RoundTripPhase`,
`#BackendReadiness`, `#ServiceGap`, `#MutationCommitPath`, `#PersistenceClass`).

## Config round-trip state machine

Per `doc/arch/statecharts/config-roundtrip.md`:

```
requested → schema_gate → { rejected (unknown key, pre-FR1) | validated }
validated → write (Config.update)
write → invalidate (authority-scoped cache drop)
invalidate → reload (loader reads the aligned path)
reload → read → { persisted (state reflected) | orphaned (false success, pre-FR2) }
persisted → recorded (typed MutationEnvelope + audit)
```

The round-trip persists through the SAME Config.Service seam langlock/jobs use,
under CAS; the `orphaned` and `rejected` nodes are the pre-fix false-success and
unknown-key failures FR1/FR2 close (they remain in the chart as the honest
negative outcomes the acceptance test pins).

## Security and threat boundaries

| Concern                      | Mitigation                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| No new authenticated surface | Every verb rides the Feature 007 `OperatorClient` loopback + operator principal/scope/CAS (FR13).      |
| Secret handling              | telemetry export header + semantic provider credential persisted as `SecretRef` only; SecretPort-resolved (FR11). |
| Input validation             | Mutation payloads + the persisted `operator` document schema-validated → typed `invalid_argument`/`unavailable`. |
| External reach               | MCP/semantic reach external systems only under the existing offline/SSRF policy and secret refs.        |
| Typed capability gaps        | Milvus/executor/cancel edges return typed gaps, never fabricated success (FR8, FR9, FR10, FR14).        |
| No false success             | FR1 is shipped only WITH the FR2 write/read alignment + FR3 cache invalidation (round-trip proven).     |
| No secret/payload leakage    | Errors/toasts/logs carry only bounded, secret-free reasons; no spool body, credential, or config fragment. |
| Audit                        | Mutations emit the Feature 007 EventV2 audit correlation via `mutateAuthority` with bounded labels.     |

## Observability

No new telemetry of its own. Operator dispatches continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels (command id, domain, surface, scope, outcome). The service backends
and the config round-trip record only bounded, typed outcomes; no spool page body,
MCP server secret, provider credential, config payload, or role-pool model id is
exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths; most of the surface is already in scope under the Feature 007 / 005 /
006 / 008 / 013 blocks. Only the config round-trip loader paths are genuinely new;
reused seams are listed for traceability:

```toml
# Genuinely new to Feature 014 (config round-trip write/read alignment):
"packages/opencode/src/config/**",           # operator-key acceptance + write/read alignment + cache invalidation (FR1-FR3)
"packages/opencode/test/config/**",          # round-trip persistence tests (FR4)
# Already in scope — NOT re-added, listed for traceability:
#   packages/core/src/v1/config/config.ts     → ConfigV1.Info operator sub-schema (FR1)   [Feature 007 block]
#   packages/opencode/src/operator/**         → langlock/jobs mutation_plan + stack-live service wiring (FR5-FR10) [Feature 007]
#   packages/opencode/src/outputspool/**      → OutputSpool control store reused (FR6)    [Feature 005]
#   packages/opencode/src/mcp/**              → MCP.Service host reused (FR7)              [Feature 008]
#   packages/opencode/src/semantic/**         → semantic resolver/registry reused (FR8)   [Feature 006]
#   packages/opencode/src/jobs/**             → jobs persistence seam reused (FR9)         [Feature 002]
#   packages/core/src/operator/**             → palette.ts Partial refinement (FR12)       [Feature 007]
#   packages/{opencode/test/operator,core/test/operator}/** → commit/backend/availability/parity tests
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Config round-trip (`config.ts` operator key, `config/**` write/read align +
   cache invalidation, round-trip acceptance).
2. `langlock` + `jobs` `mutation_plan` conversion.
3. OutputSpool backend wiring.
4. MCP admin backend wiring.
5. Semantic registry backend (config-backed) + typed Milvus gap.
6. Jobs persistence + typed executor/cancel gaps.
7. TUI `Partial` availability refinement.
8. Tests (round-trip, commit contract, backends, availability, parity) + doc sync.

## Companion artifacts

None required beyond this plan. The persistence ValueObjects
(`doc/arch/schemas/operator-persistence/`) and the statechart
(`doc/arch/statecharts/config-roundtrip.md`) carry the data model; no `research.md`,
`data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR14 mapped to ordered phases
- [x] No new catalog id / no catalog version bump / no new dispatch path / no flag (FR13)
- [x] Config round-trip: operator key accepted, write/read aligned, cache invalidated, restart-proven (FR1-FR4)
- [x] `langlock` + `jobs` converted to `mutation_plan`; `mutateAuthority` owns the commit (FR5)
- [x] Three reachable service backends wired; Milvus/executor/cancel stay typed gaps (FR6-FR10)
- [x] Secrets `SecretRef`-only through the SecretPort (FR11)
- [x] TUI `Partial` refined per-verb; availability map truthful (FR12, FR14)
- [x] specScopeGlobs narrow; only `packages/opencode/src/config/**` + its tests genuinely new
- [x] Security: SecretRef-only, input validation, no false success, no fabricated capability, parity
- [x] `tasks.md` generated and filled
- [x] `speckit analyze` clean of new Critical/High/Medium blockers
- [x] `speckit validate --json` green (0 new findings on Feature 014 artifacts)

## Implementation notes (recorded during implement)

- 2026-07-19 — T001-T020 landed per plan: `ConfigV1.Info` gained the typed
  `operator` sub-schema (FR1); `loadInstanceState` gained a scoped
  `loadOperatorNamespace` read of the project `config.json` (FR2), with
  `Config.update` invalidating the authority-scoped instance cache on commit
  (FR3) — proven restart-proof end-to-end across all six config-backed
  domains via fresh-process CLI round-trips (FR4). `langlock` and `jobs`
  command ports converted to the `OperatorMutationPlan` contract so
  `mutateAuthority` owns the single committed CAS write (FR5, the Feature
  013 `runPlan` template). OutputSpool wired to a real `bun:sqlite` control
  store (FR6); MCP wired to a live-host reader over `MCP.Service` for the
  auth/resource reads while every mutating verb and the SSOT-metadata-only
  server-profile reads stay typed gaps (FR7); the semantic domain split into
  a config-backed registry (persists) plus the Milvus-gated index ops
  (typed `milvus_unavailable`) (FR8); jobs mutations persist over a new
  bounded operator-job seam (`operator/jobs/persistence.ts`) (FR9); the
  `jobs.run-now` executor edge and the lifecycle `cancel` edge stay
  documented typed `unavailable` gaps — no clean dependency edge found, none
  forced (FR10). Secrets stayed `SecretRef`-only throughout (FR11). The
  palette classification refined to per-verb `Partial` for the newly-mixed
  semantic/output domains (FR12). No catalog id added, no catalog version
  bump, no new dispatch path or flag — Feature 007 stayed the sole
  registration authority throughout (FR13); every honest-degrade path
  returns a typed envelope, never a fabricated success (FR14).
- 2026-07-19 — **Fix round (post-implement adversarial + spot-check):**
  three confirmed defects closed, all honest-degradation / false-success
  corrections, no catalog/dispatch-path change. (1) **Root-cause false
  success** — `Config.updateGlobal`'s `patchJsonc` silently dropped a
  required-but-empty nested object (`models.role_pools:{}`,
  `export.headers:{}`) on write, so `smart.on`/every `telemetry.*` global
  round-trip decoded to defaults on re-read (`cas_vN` success that never
  persisted); fixed by writing the absent empty object explicitly. This
  also closed the separate "telemetry endpoint didn't stick" finding (same
  drop broke the whole telemetry decode). (2) **`telemetry.test` hard
  failure** — the catalog declared `mutates:true` for a handler that is a
  read-only probe (`kind:"query"`), so the dispatcher's mutate-guard
  rejected every dispatch; fixed by correcting the descriptor to
  `mutates:false` (no catalog version bump — `catalogVersion()` is a static
  constant). (3) **TUI Configure form payload mismatch** — the reusable
  form dispatched `{ [field.key]: rawText }`, which didn't match the
  Feature 014 verbs' port-level keys (scalar keys, JSON-object fields);
  fixed with per-field canonical keys plus a `toPayload` JSON-spread
  builder and a malformed-JSON validator. Full detail and evidence in
  `tasks.md` "Fix round (2026-07-19)".
- 2026-07-19 — **Close-out:** removed a stray untracked
  `packages/opencode/config.json` left by an un-isolated live-CLI spot
  check (leaked the operator's real global config plus a plaintext MCP API
  key) — not a deliverable, never committed. Confirmed the Feature 014
  `speckit.toml` guard block already covers every genuinely-new implement
  path (`packages/opencode/src/config/**`,
  `packages/opencode/test/config/**`, plus the pre-covered
  `operator/**`/`outputspool/**`/`mcp/**`/`semantic/**`/`jobs/**` trees) —
  no guard-scope change needed.
</content>
