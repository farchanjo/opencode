---
id: 019f7abe-6b2f-7522-beb7-5468adabe14f
number: 014
slug: complete-the-operator-control-plane-persistence-and-service
status: analyzed
created_at: 2026-07-19T14:18:47.471269Z
---
# Feature Specification: Complete the Operator Control Plane Persistence and Service

Feature: 014-complete-the-operator-control-plane-persistence-and-service
Created: 2026-07-19
Scope: Close the two honest residuals Feature 013 recorded — operator config
mutations do not yet **round-trip persist**, and several domains still expose
**honest capability gaps** rather than real service backends — without adding a
catalog id, bumping the catalog version, introducing a new dispatch path, or
adding a flag. Three bodies of work: (1) make the config-backed domains
(`langlock`, `telemetry`, `smart`, `budget`, `pools`, and `jobs`) durably
persist a CLI/HTTP/TUI mutation and read it back across a process restart by
accepting the `operator` config namespace, aligning the write path with a
read path the instance loader actually consumes, and invalidating the config
cache; (2) convert the last two self-committing command ports (`langlock`,
`jobs`) to the Feature 007 `mutation_plan` contract so `mutateAuthority` owns
the single committed CAS write; (3) replace the deliberate honest-gap service
backends with real ones where a clean dependency edge exists — the OutputSpool
control store, the MCP admin host, and the config-backed half of the semantic
registry — while the Milvus-gated, executor-gated, and lifecycle-cancel ops
stay **typed capability gaps** by design. Feature 007 remains the sole
command-registration authority; the parity invariant and honest-degradation
contract are preserved throughout.

## Problem

Feature 013 wired the four remaining config-backed operator domains and, during
its adversarial fix rounds, documented two residuals that keep the control plane
short of "management actually works end to end"
(`doc/arch/sdd/013-*/tasks.md`, "Fix round — CLI mutation crash (InstanceRef)"
and "Fix round — end-to-end mutation commit path"):

- **Config mutations do not round-trip persist.** Two defects compound:
  1. The durable operator store writes an `operator` namespace into the config
     document, but `ConfigV1.Info` does not declare `operator`, so
     `ConfigParse.schema` (`packages/opencode/src/config/parse.ts:40`) rejects it
     as an unrecognized key (`ConfigInvalidError`) — `updateGlobal` throws for the
     global authorities and `Config.update`'s re-validation throws once a project
     document already holds the key.
  2. Write-path ≠ read-path: `Config.update` writes `<dir>/config.json`, but the
     instance loader reads `opencode.json(c)` plus the *global* `config.json`,
     never the project `config.json`. Even past the schema the write lands in an
     orphaned file and is not read back (a re-read shows `configured:false`).
  Legitimising the `operator` key in `ConfigV1.Info` **alone** would produce a
  *false success* — a `cas_vN` the loader never reads back — which is worse than
  the honest `unavailable` Feature 013 currently returns.

- **Two command ports still self-commit and return a query.**
  `langlock-command-port.ts:164` and the `jobs` command port self-commit a CAS
  write inside the backend and return `kind:"query"` for a mutating verb. The
  Feature 007 dispatcher's `mutates`-descriptor gate rejects that plan with
  `invalid_argument "mutation command cannot return query result"` **after** the
  write persisted — a fabricated failure with a real side effect (empirically
  shown for the langlock pattern in the 013 review). The 013 four domains were
  converted to the `mutation_plan` contract; `langlock` and `jobs` were not.

- **Several service domains are still honest capability gaps.** The composition
  root wires the OutputSpool, semantic, and MCP backends with empty deps —
  `createLiveOutputSpoolBackend({})` (`stack-live.ts:405`),
  `createLiveSemanticBackend({})` (`:416`), `createLiveMcpBackend({})` (`:427`) —
  so they return typed `unavailable`/`milvus_unavailable`/`mcp_unavailable` gaps
  rather than real data, even though the real backends exist:
  - **output** — `createControlStore(db)`
    (`packages/opencode/src/outputspool/control-store.ts:119`), `page-reader.ts`
    `readPage`, and `retention-sweeper.ts`; the `Database` is already in the
    AppLayer (`packages/opencode/src/effect/app-runtime.ts`).
  - **mcp** — `MCP.Service` (`packages/opencode/src/mcp/index.ts:200`) plus
    `McpAuth`, both in the AppLayer, resolvable via `AppRuntime` exactly as the
    routing/provider wiring already does (`stack-live.ts:270-311`).
  - **semantic** — the config-backed registry (provider/model/binding/embedding/
    reranker) is wireable now over `semantic/credential-resolver.ts` + config;
    only the Milvus-gated index/reindex/cutover/validate ops
    (`semantic/milvus-adapter.ts`) genuinely need a live Milvus.

The corpus already mandates the end state: Feature 007 is the sole registration
authority (FR11) and requires real typed domain ports over the Config.Service
authority; Feature 001/005/006/008 own the effective runtime the ports project.
Leaving the residuals means the palette/slash/CLI/TUI advertise verbs that
persist to an orphaned file or degrade to a permanent gap even where a live
backend exists.

The fix is a **persistence-and-wiring** change: accept the `operator` namespace,
align the config write/read paths and invalidate the cache, convert the last two
self-committing ports to `mutation_plan`, wire the three reachable service
backends, refine the TUI availability to a per-verb `Partial` where a domain is
mixed, and keep every deferred op a **typed** capability gap — with no new
catalog id, no catalog version bump, and no new dispatch path.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Config mutations round-trip persist

- As an operator, I want a `langlock`/`telemetry`/`smart`/`budget`/`pools`/`jobs`
  mutation issued from the CLI to return `success` with a version bump, an
  immediate re-read to show the mutated state, and the state to survive a process
  restart, so that management actually persists rather than reporting a
  version that never lands.
- As an operator, I want the `operator` config namespace to be a recognized,
  typed key in the config schema so that a persisted operator document is never
  rejected as an unknown key, and never lands in a file the loader ignores.
- As an operator, I want a committed mutation to invalidate the config cache so
  that a re-read reflects the new state immediately, not a stale cached document.

### P1 — Every mutation commits through the shared authority

- As an operator, I want `langlock` and `jobs` mutating verbs to ride the
  Feature 007 `mutation_plan` contract so that `mutateAuthority` owns the single
  committed CAS write and the FR7 audit correlation, and no backend self-commits
  a write that the dispatcher then rejects with a fabricated failure.

### P1 — Real service backends where a dependency edge exists

- As an operator, I want `output.*` reads and admin ops to run against the real
  OutputSpool control store so that `stat`/`read`/`follow`/`release`/`delete`/
  `purge`/`retention.set`/`quota.set` return and mutate real spool state.
- As an operator, I want `mcp.*` admin ops to run against the real `MCP.Service`
  host so that server/auth/resource/logging/experimental/extension reads and
  mutations reflect the live client.
- As an operator, I want the config-backed half of the semantic registry
  (provider/model/binding/embedding/reranker) to persist and read real state,
  while the Milvus-gated index ops honestly report `milvus_unavailable` when no
  live Milvus is reachable.

### P1 — Honest capability gaps stay typed

- As an operator, I want the Milvus-gated semantic index ops, the jobs
  `run-now` executor edge, and the lifecycle process/task `cancel` edge to remain
  **typed** capability gaps rather than fabricated success, so that the surface
  never claims a capability it cannot reach.

### P1 — Truthful TUI availability

- As an operator, I want the grouped operator menu to show a `Partial` badge for a
  mixed domain (semantic: registry persists, index is Milvus-gated) so that the
  availability affordance is truthful at per-verb granularity, never advertising
  persistence a verb lacks nor hiding a verb that persists.

### P2 — Parity across surfaces

- As an operator, I want every wired verb to ride the same command id and the same
  `OperatorClient` loopback across palette, slash, CLI, and TUI, so that no surface
  diverges and no new dispatch path, catalog id, or catalog version is introduced.

## Functional Requirements

### Group 1 — Config persistence round-trip (keystone)

1. **Operator config namespace accepted (FR1).** `ConfigV1.Info`
   (`packages/core/src/v1/config/config.ts`) MUST declare an `operator` key with a
   typed-but-permissive sub-schema that holds each config-backed domain's
   persisted document, so `ConfigParse.schema`
   (`packages/opencode/src/config/parse.ts:40`) no longer rejects a persisted
   operator namespace as `ConfigInvalidError`. The sub-schema MUST be typed (not
   free-form `unknown`) and MUST carry no plaintext secret field — secret-bearing
   values remain `SecretRef` only (FR11).
2. **Write-path/read-path alignment (FR2).** The `Config.update` write target and
   the instance loader read target MUST be aligned so an operator CAS mutation
   persists to a file/authority the loader actually consumes — either by teaching
   the loader to read the file `Config.update` writes, or by redirecting the write
   to a loader-consumed file. The smaller, honest change MUST be chosen and
   recorded in ADR-0014. Accepting the schema key (FR1) alone, without the aligned
   round-trip, is explicitly forbidden — it yields a false `cas_vN` success that
   never persists.
3. **Config cache invalidation (FR3).** A committed CAS mutation MUST invalidate
   whatever config cache the loader holds, so an immediate re-read reflects the new
   effective state rather than a stale cached document. The invalidation MUST be
   scoped to the mutated authority and MUST NOT drop unrelated cached config.
4. **End-to-end round-trip acceptance (FR4).** For EACH config-backed domain —
   `langlock`, `telemetry`, `smart`, `budget`, `pools`, and `jobs` (where
   persistence exists) — a CLI mutation MUST return `success` with a version bump,
   an immediate re-read MUST show the mutated state, and a process restart MUST
   still show it. No path may return a `cas_vN` success that the loader does not
   read back (no false success, FR8-equivalent honesty).

### Group 2 — Mutation-plan commit contract

5. **`langlock` + `jobs` `mutation_plan` conversion (FR5).**
   `langlock-command-port.ts` (self-commit + `kind:"query"` at `:164`) and the
   `jobs` command port MUST convert their mutating verbs to the
   `OperatorMutationPlan` contract (`application/handler.ts`), exactly as the
   Feature 013 four domains do (the `telemetry-command-port.ts` `runPlan` helper is
   the template), so `mutateAuthority` owns the single committed CAS write and the
   Feature 007 audit correlation and no backend self-commits. This eliminates the
   fabricated-failure-with-real-side-effect the dispatcher raises when a mutating
   verb returns a self-committed `query` result. Reads are unchanged.

### Group 3 — Service-backed domain backends

6. **OutputSpool backend (FR6).** `createLiveOutputSpoolBackend`
   (`stack-live.ts:405`, currently empty deps) MUST resolve the AppLayer
   `Database` (`packages/opencode/src/effect/app-runtime.ts`) and inject a real
   `OutputSpoolBackend` over `createControlStore(db)`
   (`packages/opencode/src/outputspool/control-store.ts:119`), `page-reader.ts`
   `readPage`, and `retention-sweeper.ts`, backing `stat`/`read`/`follow`/
   `release`/`delete`/`purge`/`retention.set`/`quota.set` against real spool
   state. The cross-project export/share deny-by-default policy is preserved.
7. **MCP admin backend (FR7).** `createLiveMcpBackend` (`stack-live.ts:427`,
   currently empty deps) MUST resolve `MCP.Service`
   (`packages/opencode/src/mcp/index.ts:200`) and `McpAuth` via `AppRuntime` — the
   routing/provider resolution precedent (`stack-live.ts:270-311`) — into a real
   `McpAdminBackend` over the server/auth/resource/logging/experimental/extension
   sub-ports.
8. **Semantic registry backend, mixed domain (FR8).** `createLiveSemanticBackend`
   (`stack-live.ts:416`, currently empty deps) MUST wire the config-backed registry
   ops — `provider.list`/`add`/`update`/`disable`/`delete`/`rotate-secret`,
   `model.list`/`register`/`disable`, `binding.status`/`history`, and
   `embedding`/`reranker` `show`/`select` — over `semantic/credential-resolver.ts`
   plus config. The Milvus-gated ops — `index`/`reindex`/`cutover`/`validate`
   (`semantic/milvus-adapter.ts`) — MUST stay typed `milvus_unavailable` when no
   live Milvus is reachable. Semantic thereby becomes a **mixed** domain (some
   verbs persist, some remain capability-gated).
9. **Jobs mutation backend (FR9).** The `jobs` mutating verbs —
   `create`/`update`/`enable`/`disable`/`delete`/`reschedule`/`show`/`history` —
   MUST persist over the `JobPersistence` seam
   (`packages/opencode/src/jobs/persistence.ts`, over config; depends on Group 1).
   `run-now` requires the Feature 002 executor seam; if that seam is not reachable
   from the operator `AppRuntime`, `run-now` MUST stay typed `unavailable` with the
   boundary documented in ADR-0014 (never fabricated).
10. **Lifecycle cancel boundary (FR10).** The process/task `cancel` op via
    `SessionRunCoordinator.interrupt` (`lifecycle/stack-wiring.ts`) MUST stay a
    typed `unavailable` capability gap — a real architectural boundary from the
    operator `AppRuntime` — UNLESS a clean dependency edge is found during
    implement. It MUST NOT be forced through a fragile or fabricated path.
11. **Secrets stay `SecretRef`-only (FR11).** Semantic `rotate-secret` and every
    secret-bearing verb MUST go through the Feature 007 `SecretPort` seam; no
    plaintext credential is persisted, dereferenced into plaintext, or echoed at
    this layer, and the `operator` config sub-schema (FR1) carries only `SecretRef`
    references for secret values.

### Group 4 — Honest availability + parity

12. **TUI `Partial` availability refinement (FR12).** Because semantic becomes a
    mixed domain, the palette persistence classification
    (`packages/core/src/operator/palette.ts`,
    `OPERATOR_PERSISTING_DOMAINS`/`persistenceFor`/`domainBadge`) MUST refine to
    per-verb granularity so the grouped-menu `Partial` badge shows honestly: a
    domain whose Configure verbs are partly persisting and partly capability-gated
    MUST render `Partial`, no verb may advertise persistence it lacks, and no
    persisting verb may read as `unavailable`.
13. **Parity + registration invariant preserved (FR13).** This feature adds NO
    catalog id, bumps NO catalog version, introduces NO new dispatch path, and adds
    NO new flag: every verb rides the same `OperatorClient` loopback with unchanged
    command ids across palette/slash/CLI/TUI. Feature 007 stays the sole
    command-registration authority (Feature 007 FR11).
14. **Honest degradation, never fabricated success (FR14).** Every read/mutation
    MUST degrade to a typed envelope (`unavailable`, `version_conflict`,
    `invalid_argument`, `milvus_unavailable`, `mcp_unavailable`) via a guarded
    `Effect.tryPromise` — never a fabricated success or synthesized effective
    state. No error path leaks a secret, credential, endpoint, or config payload
    fragment, and the TUI availability map stays truthful.

## Non-Functional Requirements

- **Reuse the effective runtime.** The OutputSpool control store, the
  `MCP.Service` host, the semantic credential resolver/registry, the jobs
  persistence seam, and the routing/telemetry effective config are REUSED, not
  re-authored; the operator ports and the composition root wire onto them.
- **Smallest honest change for the round-trip.** The config write/read alignment
  chooses the minimal change that makes the round-trip real, recorded in ADR-0014;
  it does not re-architect the config loader.
- **No new flag.** All work stays behind the existing operator control-plane flag
  (`OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`).
- **Bounded, content-free surfaces.** Reads project bounded, redacted summaries; no
  raw config payload, spool page content, header value, or endpoint credential is
  surfaced.
- **Typed gaps over fabricated data.** Where a live dependency (Milvus, the
  Feature 002 executor, the lifecycle cancel edge) is unreachable, the verb returns
  a typed capability gap — never synthesized state.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **Round-trip a langlock mutation across restart.**
  Given the operator config namespace is a recognized schema key,
  When the operator runs a `langlock` mutation from the CLI, re-reads, then
  restarts the process and reads again,
  Then the mutation returns `success` with a version bump, the immediate re-read
  shows the mutated state, and the state survives the restart.

- **Reject a schema-key-only change as false success.**
  Given the `operator` key is accepted but the write path is not aligned with a
  loader-consumed read path,
  When a mutation is committed,
  Then the round-trip acceptance test fails (the re-read shows `configured:false`),
  demonstrating that FR1 without FR2 is a false success and is not shipped.

- **Invalidate the config cache on commit.**
  Given a domain document is cached by the loader,
  When an operator CAS mutation commits,
  Then the cache for that authority is invalidated and an immediate re-read
  reflects the new state, not the stale cached document.

- **Commit a langlock mutation through the shared authority.**
  Given `langlock` mutating verbs ride the `mutation_plan` contract,
  When a `langlock` mutation is dispatched through the full pipeline,
  Then `mutateAuthority` owns the single committed CAS write and the audit
  correlation, and no self-committed `query` result is rejected after a write.

- **Read real spool state.**
  Given the OutputSpool backend resolves the AppLayer `Database`,
  When the operator runs `output.stat`/`output.read`,
  Then the result reflects the real control store, and `retention.set`/`quota.set`
  mutate real spool policy under the deny-by-default export/share guard.

- **Administer the live MCP host.**
  Given the MCP backend resolves `MCP.Service` and `McpAuth` via `AppRuntime`,
  When the operator runs an `mcp.*` admin verb,
  Then it reflects the live client host, degrading to typed `mcp_unavailable` only
  when the service is genuinely unbound.

- **Persist a semantic registry mutation but gate the index.**
  Given the semantic registry is config-backed and no live Milvus is reachable,
  When the operator runs `semantic.provider.add` then `semantic.index`,
  Then `provider.add` persists and re-reads under CAS, while `index` returns the
  typed `milvus_unavailable` gap.

- **Keep the executor and cancel edges typed gaps.**
  Given the Feature 002 executor and the lifecycle cancel edge are unreachable from
  the operator `AppRuntime`,
  When the operator runs `jobs.run-now` or process/task `cancel`,
  Then each returns a typed `unavailable` capability gap with the boundary
  documented, never a fabricated success.

- **Show a truthful Partial badge.**
  Given semantic's registry verbs persist while its index verbs are Milvus-gated,
  When the grouped operator menu derives semantic's availability,
  Then the domain renders `Partial`, its registry Configure entries are editable,
  and its index entries surface the typed gap.

- **Preserve command parity.**
  Given the same command id is dispatched from palette, slash, CLI, and TUI,
  When any wired verb is invoked,
  Then it rides the same `OperatorClient` loopback with no new dispatch path, and
  no catalog id is added and no catalog version is bumped.

## Security Requirements

- **Data sensitivity/classification.** This feature persists and reads operator
  configuration (langlock policy, telemetry export settings including a `SecretRef`
  export header, smart-routing flag, budget policy, role-pool map, semantic
  provider credentials as `SecretRef`, and scheduled-job definitions) plus
  OutputSpool control state and MCP admin state. Reads project bounded, redacted
  summaries; the raw config payload, spool page content, resolved secret value, and
  endpoint credential are never surfaced. The new `operator` config sub-schema
  (FR1) is typed and carries only `SecretRef` references for secret values.
- **Authentication/authorization.** No new authenticated surface. Every verb rides
  the Feature 007 `OperatorClient` loopback and operator principal, scope,
  version/CAS, and confirmation gates (Feature 007 FR11/FR28); the wired backends
  register no command ids and cannot relax those gates. The MCP and semantic
  backends reach external systems only under the existing offline/SSRF policy and
  secret refs.
- **Input validation.** The untrusted inputs are the mutation payloads and the
  persisted `operator` config document parsed at load. Payloads are schema-validated
  against the reused effective-config schemas and the new typed `operator`
  sub-schema, and are rejected with a typed `invalid_argument` envelope on mismatch;
  a malformed persisted operator document degrades to a typed `unavailable`/
  `invalid_argument` read, never a crash. The `SecretRef` is validated against its
  canonical `backend:name[@vN]` pattern and never dereferenced into plaintext here.
- **Cryptography in transit/at rest.** Secret-bearing values (telemetry export
  header, semantic provider credential) are persisted only as `SecretRef`; their
  values are resolved by the Feature 007 `SecretPort` at use time, not by this
  feature, and are never persisted or logged in plaintext. No new at-rest secret
  store is introduced; the round-trip persists to the existing config file the
  loader consumes.
- **Logging/audit.** Mutations emit the Feature 007 audit correlation through the
  same EventV2 authority, with content-free, bounded labels (command id, domain,
  outcome). The service backends record only bounded, typed outcomes — never a
  spool page body, MCP server secret, provider credential, or config payload
  fragment.
- **Error-handling information exposure.** Every failure path degrades to a typed
  envelope carrying only a bounded, secret-free reason. A config-unreachable read,
  a stale mutation, a Milvus/executor/cancel capability gap, or a malformed
  persisted document never leaks a stack trace, credential, secret value, or raw
  config/spool payload in a result, toast, or log.

## Domain Model

The persistence round-trip, the mutation-commit contract, and the service-backend
readiness classes are specified as ValueObjects in
`doc/arch/schemas/operator-persistence/` and the round-trip lifecycle as a
statechart in `doc/arch/statecharts/config-roundtrip.md`:

```
Config-backed domains (langlock, telemetry, smart, budget, pools, jobs)
  ConfigMutation → mutation_plan → mutateAuthority (single CAS write + audit)
                 → ConfigRoundTrip(write → invalidate → reload → read → persisted)
                 → survives restart (FR1–FR5)

Service-backed domains
  output   → OutputSpoolBackend (real control store)                    readiness: live      (FR6)
  mcp      → McpAdminBackend (real MCP.Service host)                     readiness: live      (FR7)
  semantic → registry ops (config-backed)  | index ops (Milvus-gated)    readiness: mixed     (FR8)
  jobs     → persistence (config-backed)   | run-now (executor-gated)    readiness: mixed     (FR9)
  lifecycle→ cancel (SessionRunCoordinator boundary)                     readiness: gap       (FR10)

Every mutation carries a CasExpectation(authority, expectedVersion); a stale
version → version_conflict; an unreachable dependency → a typed capability gap
(unavailable | milvus_unavailable | mcp_unavailable); never a fabricated success
(FR12–FR14).
```

## Observability

Operator dispatches continue to project through the Feature 007 EventV2 audit and
the ADR-0001 OTLP foundation with content-free, bounded labels (command id,
domain, surface, scope, outcome). The new service backends and the config
round-trip emit no telemetry of their own and record only bounded, typed outcomes;
no spool page body, MCP server secret, provider credential, config payload, or
role-pool model id is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Re-authoring the effective runtime — the OutputSpool control store, the
  `MCP.Service` host, the semantic registry/resolver, the jobs persistence seam,
  and the routing/telemetry/budget schemas are reused unchanged.
- Standing up a live Milvus, the Feature 002 executor edge for `jobs.run-now`, or
  the lifecycle process/task `cancel` edge — these stay typed capability gaps
  unless a clean dependency edge is found during implement.
- Adding any catalog id, bumping the catalog version, or introducing a new dispatch
  path, parallel registry, or divergent command name.
- A new feature flag or an i18n/translation layer.
- App/Desktop parity (Feature 007 Phase 2), multi-user directory, vault backends,
  or a non-loopback operator API.

## Related Features and Decisions

- [ADR-0014 — Complete the operator control plane persistence and service](../../adr/0014-complete-the-operator-control-plane-persistence-and-service.md)
- [Feature 013 Wire the Four Remaining Config-Backed Operator Domains](../013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md) — the domain-stack template, the `mutation_plan` conversion precedent, and the two residuals this feature closes.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant (FR11), `mutateAuthority`/`OperatorMutationPlan`, the SecretPort seam.
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md) — the langlock command port converted here (FR5).
- [Feature 005 OutputSpool](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — the control store wired by FR6.
- [Feature 006 Semantic Retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — the registry/Milvus split wired by FR8.
- [Feature 008 MCP Client](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — the `MCP.Service` host wired by FR7.
- [Feature 011 Restructure the Operator Control Plane TUI](../011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md) — the grouped menu and the `Partial` badge refined by FR12.
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Domain schema](../../schemas/operator-persistence/enums.cue)
- [Config round-trip statechart](../../statecharts/config-roundtrip.md)

## Clarifications
</content>
