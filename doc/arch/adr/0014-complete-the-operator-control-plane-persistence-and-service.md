---
status: proposed
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0014 — Complete the Operator Control Plane Persistence and Service

## Context and Problem Statement

Feature 007 established the operator control plane as the single native authority
for setup and management, and Features 002-006/008/013 replaced the generic domain
stubs with real typed ports over the Config.Service authority. Feature 013's
adversarial fix rounds
(`../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/tasks.md`)
documented two residuals that keep the plane short of "management works end to end",
plus a class of domains still exposing honest capability gaps:

- **Config mutations do not round-trip persist.** The durable operator store writes
  an `operator` namespace into the config document, but `ConfigV1.Info` does not
  declare `operator`, so `ConfigParse.schema`
  (`packages/opencode/src/config/parse.ts:40`) rejects it as an unknown key
  (`ConfigInvalidError`). Worse, `Config.update` writes `<dir>/config.json` while
  the instance loader reads `opencode.json(c)` plus the *global* `config.json`,
  never the project `config.json` — so even past the schema the write lands in an
  orphaned file and is not read back. Legitimising the `operator` key **alone**
  would produce a *false success* (`cas_vN` that never persists), worse than the
  honest `unavailable` Feature 013 returns.

- **Two command ports still self-commit and return a query.**
  `langlock-command-port.ts:164` and the `jobs` command port self-commit a CAS
  write and return `kind:"query"` for a mutating verb, which the Feature 007
  dispatcher's `mutates`-descriptor gate rejects **after** the write persisted — a
  fabricated failure with a real side effect. The Feature 013 four domains were
  converted to the `mutation_plan` contract; `langlock` and `jobs` were not.

- **Several service domains are still honest capability gaps.** The composition
  root wires OutputSpool, semantic, and MCP with empty deps
  (`createLiveOutputSpoolBackend({})` `stack-live.ts:405`,
  `createLiveSemanticBackend({})` `:416`, `createLiveMcpBackend({})` `:427`), so
  they return typed gaps even though the real backends exist and are reachable: the
  OutputSpool control store (`outputspool/control-store.ts:119`) over the AppLayer
  `Database`, `MCP.Service` (`mcp/index.ts:200`) + `McpAuth` via `AppRuntime`, and
  the config-backed semantic registry over `semantic/credential-resolver.ts`.

The corpus mandates the end state: Feature 007 is the sole registration authority
(FR11) and requires real typed ports over the Config.Service authority; Features
001/005/006/008 own the effective runtime the ports project.

## Decision Drivers

- **Make persistence real, not fabricated.** A committed operator mutation must
  round-trip: accept the `operator` namespace, land the write where the loader
  reads, invalidate the cache, and survive a restart — never a false `cas_vN`.
- **One commit path.** Every mutating verb commits through `mutateAuthority` /
  `OperatorMutationPlan`; no backend self-commits a write the dispatcher rejects.
- **One command authority (Feature 007 FR11).** No catalog id is added and no
  catalog version is bumped; only backend wiring and the config-schema/round-trip
  fix are supplied.
- **Reuse the effective runtime.** Wire onto the existing OutputSpool control store,
  `MCP.Service` host, semantic resolver/registry, and jobs persistence seam; do not
  re-author them.
- **Typed gaps over fabricated data.** Where a live dependency (Milvus, the
  Feature 002 executor, the lifecycle cancel edge) is unreachable, the verb returns
  a typed capability gap — never synthesized state.
- **Smallest honest round-trip change.** Choose the minimal write/read alignment;
  do not re-architect the config loader.
- **Truthful availability.** A mixed domain (semantic: registry persists, index
  Milvus-gated) surfaces a per-verb `Partial` badge, never a blanket claim.

## Considered Options

- **Accept the `operator` namespace, align the config write/read paths and
  invalidate the cache, convert `langlock`/`jobs` to `mutation_plan`, and wire the
  three reachable service backends — keeping Milvus/executor/cancel typed gaps.**
  The honest end-to-end completion; preserves the parity/registration invariants.
- **Legitimise the `operator` config key only, without the write/read alignment.**
  Produces a false success (`cas_vN` the loader never reads back); rejected as
  dishonest — explicitly the trap Feature 013 warned against.
- **Author a fresh operator config store separate from Config.Service.** Duplicates
  the config the runtime already persists and drifts from the loader; rejected.
- **Force the Milvus/executor/cancel edges through a synthetic path.** Fabricates a
  capability the operator `AppRuntime` cannot reach; rejected — typed gaps are the
  honest surface.
- **Bump the catalog to mark the newly-persisting verbs.** Breaks the Feature 007
  registration invariant (no id added, no version bump); rejected — availability is
  derived from backend readiness, not from the catalog.

## Decision Outcome

Chosen option: **Accept the `operator` namespace, align the config write/read paths
and invalidate the cache, convert `langlock`/`jobs` to `mutation_plan`, wire the
OutputSpool / MCP / config-backed-semantic backends, refine the TUI availability to
a per-verb `Partial`, and keep the Milvus/executor/cancel edges typed capability
gaps — preserving the Feature 007 parity and registration invariants.**

- **Config namespace (FR1).** `ConfigV1.Info`
  (`packages/core/src/v1/config/config.ts`) gains a typed `operator` sub-schema
  holding each config-backed domain's persisted document; secret values are
  `SecretRef` only. `ConfigParse.schema` then accepts a persisted operator
  document.
- **Write/read alignment + cache invalidation (FR2, FR3).** The `Config.update`
  write target and the instance loader read target are aligned onto a
  loader-consumed path (the smaller honest change — teach the loader to read the
  written file, or redirect the write); a committed mutation invalidates the
  authority-scoped config cache. **The schema key is shipped only WITH this
  alignment** — accepting the key alone is a false success and is not shipped.

  **Implement decision (FR2, 2026-07-19).** Chosen: *teach the loader to consume
  the written file*, but scoped to the persisted `operator` key only, never the
  whole file. `Config.update` writes `<dir>/config.json`; the instance loader
  (`packages/opencode/src/config/config.ts`, `loadInstanceState`) now reads that
  file back through a dedicated `loadOperatorNamespace` helper that JSONC-parses
  it, plucks **only** the `operator` key, validates it against the new
  `ConfigV1.Info` operator sub-schema, and deep-merges it into the effective
  config. Reading only the `operator` key (rather than adopting the whole file as
  opencode config) is deliberate: a project `config.json` is an extremely common
  unrelated filename, and loading it wholesale would reject every such project on
  its unknown top-level keys. A malformed or absent operator document degrades to
  "no namespace" (no crash), preserving honest degradation. Global-scoped
  authorities (`global:*`, e.g. `global:telemetry`, `global:routing`) already
  round-trip through the global config file via `updateGlobal`/`getGlobal`, so
  this recovers the previously-orphaned **project-scoped** authorities
  (`routing`). This is smaller and safer than redirecting `Config.update`'s target
  (which is shared by the HTTP config handler and flag-bootstrap and would clobber
  a user's hand-edited `opencode.json`). The operator store writing the *full*
  merged config into `<dir>/config.json` (a pre-existing Feature 007 behavior) is
  harmless here because only the `operator` key is consumed on read.
- **Round-trip acceptance (FR4).** Per config-backed domain (langlock, telemetry,
  smart, budget, pools, jobs): CLI mutation → success + version bump → immediate
  re-read → process-restart re-read.
- **`mutation_plan` conversion (FR5).** `langlock-command-port.ts` (`:164`) and the
  `jobs` command port return a validated `OperatorMutationPlan`
  (`application/handler.ts`); `mutateAuthority` owns the single committed CAS write
  + audit correlation (the Feature 013 conversion precedent, `telemetry-command-port.ts`
  `runPlan` template). Reads unchanged.
- **OutputSpool backend (FR6).** `createLiveOutputSpoolBackend` resolves the
  AppLayer `Database` and backs `stat`/`read`/`follow`/`release`/`delete`/`purge`/
  `retention.set`/`quota.set` over `createControlStore(db)` + `page-reader.ts` +
  `retention-sweeper.ts`, preserving the deny-by-default export/share policy.
- **MCP admin backend (FR7).** `createLiveMcpBackend` resolves `MCP.Service` +
  `McpAuth` via `AppRuntime` (the routing/provider precedent, `stack-live.ts:270-311`)
  and backs the server/auth/resource/logging/experimental/extension sub-ports.
- **Semantic registry backend, mixed (FR8, FR11).** `createLiveSemanticBackend`
  wires the config-backed registry ops (provider/model/binding/embedding/reranker)
  over `semantic/credential-resolver.ts` + config; the Milvus-gated
  index/reindex/cutover/validate ops (`semantic/milvus-adapter.ts`) stay typed
  `milvus_unavailable`. `rotate-secret` goes through the `SecretPort` as a
  `SecretRef`.
- **Jobs persistence + typed gaps (FR9, FR10).** Jobs mutations persist over the
  `JobPersistence` seam (over config; depends on the round-trip). `jobs.run-now`
  stays typed `unavailable` when the Feature 002 executor seam is unreachable, and
  the lifecycle process/task `cancel` edge (`SessionRunCoordinator.interrupt`) stays
  typed `unavailable` unless a clean dependency edge is found during implement.
- **TUI `Partial` refinement (FR12).** The palette classification
  (`packages/core/src/operator/palette.ts`) refines to per-verb granularity so a
  mixed domain renders `Partial` honestly.
- **Parity preserved (FR13).** No new catalog id, no catalog version bump, no new
  dispatch path or flag; command ids unchanged.

The persistence contracts are specified as ValueObjects in
`doc/arch/schemas/operator-persistence/` and the round-trip lifecycle as a
statechart in `doc/arch/statecharts/config-roundtrip.md`.

### Consequences

#### Positive

- Operator mutations round-trip persist and survive a restart across all six
  config-backed domains — management finally works end to end.
- Every mutating verb commits through the single `mutateAuthority` path; the
  fabricated-failure-with-side-effect class is eliminated.
- OutputSpool, MCP, and the config-backed semantic registry expose real state and
  mutations; the availability map is honest at per-verb granularity.
- Feature 007 stays the sole registration authority: no catalog id or version
  changes; only backend wiring and the config-schema/round-trip fix are added.

#### Trade-offs

- The config write/read alignment touches the loader (`packages/opencode/src/config/**`),
  a shared seam — kept minimal and recorded here to bound the blast radius.
- Semantic and jobs become mixed domains; the palette classification carries
  per-verb granularity to keep the `Partial` badge truthful.
- The Milvus, executor, and lifecycle-cancel edges remain typed gaps; a live Milvus
  and the Feature 002 executor edge are deferred (documented, not fabricated).

#### Follow-ups

- Feature 014 `plan`/`tasks` implement the config round-trip, the `langlock`/`jobs`
  `mutation_plan` conversion, the three service backends, the jobs persistence and
  typed executor/cancel gaps, the TUI `Partial` refinement, and the tests
  (round-trip per domain, commit contract, backends, availability, parity).
- A live Milvus wiring and the `jobs.run-now` executor edge remain open for a future
  feature once those dependencies are reachable from the operator `AppRuntime`.

## Related

- Feature specification: [014 Complete the Operator Control Plane Persistence and Service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- Preceding wiring + residuals: [013 Wire the Four Remaining Config-Backed Operator Domains](../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- OutputSpool control store: [005 Output Spool](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Semantic registry/Milvus: [006 Semantic Retrieval](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- MCP client host: [008 MCP Client](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- Grouped TUI + Partial badge: [011 Restructure Operator TUI](../sdd/011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md)
- Domain schema: [operator-persistence ValueObjects](../schemas/operator-persistence/enums.cue)
- Round-trip statechart: [config-roundtrip](../statecharts/config-roundtrip.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0013 — Wire the Four Remaining Config-Backed Operator Domains](0013-wire-the-four-remaining-config-backed-operator-domains-so.md)
</content>
