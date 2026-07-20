---
id: 019f818f-cdf4-7b72-8353-b0f5952db428
number: 035
slug: fix-a-global-scope-operator-write-also-persisting-a
status: analyzed
created_at: 2026-07-20T22:05:13.076373Z
---
# Feature Specification: Fix A Global-Scope Operator Write Also Persisting A Global Authority Into The Per-Project Profile

Feature: 035-fix-a-global-scope-operator-write-also-persisting-a
Created: 2026-07-20
Scope: the durable operator store write seam `mergeOperator`
(`packages/opencode/src/operator/adapters/outbound/config-service.ts`) that persists the
operator namespace to either the GLOBAL config document (`Config.updateGlobal`) or the
per-project profile (`Config.update(..., { replace: true })`). Feature 034 made a
GLOBAL-scope operator mutation (`op pools set --scope global`) reachable, and Feature 033
maps that scope to the authority key `global:routing` (project scope → `routing`). The
authority state write is correctly single-file — `mergeOperator` branches on
`isGlobalAuthority(authority)` so a `global:*` authority routes to the global document only.
BUT a global-scope mutation was observed on the live binary ALSO persisting a copy of
`operator.authorities["global:routing"]` into the per-project profile
`<configRoot>/profiles/<encoded-abspath>/config.json` — a second file the global authority
must never touch — and that copy went STALE (a second global save advanced the global
document to `cas_v2` while the shadowing profile copy stayed frozen at `cas_v1`). This
feature stops the double-write so the per-project profile can only ever contain that
project's OWN authorities (`routing` and other project-owned namespaces), never a `global:*`
key, without changing the effective READ semantics, the global CAS round-trip, idempotency
dedup, or rollback.

## Audit result (grounding — every anchor verified 2026-07-20)

- **The authority write is already single-file.** `mergeOperator`
  (`config-service.ts`) reads `readRoot(authority)` and, on `isGlobalAuthority(authority)`,
  writes `Config.updateGlobal(patch)` (the global config document); otherwise it writes
  `Config.update(patch, { replace: true })` (the per-project profile). So the CAS for
  `global:routing` lands ONLY on the global document — the double-write is NOT the authority
  CAS.
- **The bookkeeping stores are hardwired to the PROJECT authority.** The idempotency,
  rollback, and audit-outbox ports in `config-service.ts` all persist through
  `mergeOperator(metaAuth(), ...)` where `metaAuth() === "project"`. So a global-scope
  mutation's project-scoped bookkeeping writes the per-project profile — regardless of the
  request scope.
- **`readRoot("project")` returns the LAYERED effective config.** `readRoot` for a
  non-global authority calls `options.config.get()`, which is the effective read.
  Post-Feature-030 (`config.ts` `loadInstanceState`, the block around lines 522–548) that
  read MERGES the global config document's `operator` namespace UNDER the per-project
  profile's. So after the global authority CAS committed `global:routing` to the global
  document, `Config.get().operator.authorities` CONTAINS `global:routing`.
- **The project write REPLACES the profile with the whole (layered) namespace.** Feature 032
  made the project write `{ replace: true }` — it writes `{ $schema, operator: state }`
  wholesale, where `state = asState(root.operator)` from the layered read. So the very next
  project-scoped bookkeeping write after a global CAS — `ports.idempotency.put` in the
  mutation `finalize` (`application/mutation.ts` line 416), or `ports.rollback.set` on
  cutover (line 310) — snapshots the layered-in `global:routing` verbatim into the profile.
  This is the SECOND file write, and it is the exact class Feature 032 fixed for
  base-inherited secrets ("a write persists more than the namespace it owns"), now surfacing
  on the global authority via Feature 030 layering.
- **The staleness follows from the layering too.** On a second global save the global
  document advances to `cas_v2`, but the profile still holds the leaked `global:routing`
  (`cas_v1`) as a PROJECT-source authority, which is merged LAST in `loadInstanceState` and
  therefore SHADOWS the fresher `cas_v2` on the next layered read. The re-persisted copy
  freezes at `cas_v1`.
- **The in-process mock did NOT reproduce this.** `createFakeConfigService` keeps `project`
  and `global` as two independent maps and its `get()` returns the project map WITHOUT
  layering the global map, so `global:routing` never enters `state` — the Feature 033/034
  suites (built on the fake) could not surface the leak. The defect only appears over the
  REAL, layered `Config.Service`.
- **Reads are already correct.** `resolveEffective` (Feature 033) is document-shadowing
  (project doc > global doc > default) and the layered `Config.get()` (Feature 030) is
  deliberate; neither is the defect. Only the profile WRITE duplicates the global authority.

## Problem

A global-scope operator mutation writes its authority (`global:routing`) to the global
config document — correct — but ALSO leaks a copy of that authority into the per-project
profile `config.json`, because the project-scoped bookkeeping stores (idempotency/rollback/
audit-outbox) read the LAYERED effective config (which now merges in `global:routing` via
Feature 030) and REPLACE-write the whole operator namespace into the profile (Feature 032).
The leaked copy then goes STALE — a second global save bumps the global document to `cas_v2`
while the profile copy stays at `cas_v1` and shadows the fresher version on the next layered
read. The per-project profile must NEVER contain a `global:*` authority key; that authority
belongs solely on the global document. This feature filters non-project-owned authorities
out of the project-profile write so the double-write and the stale shadow are both closed.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A global-scope mutation persists its authority only to the global document

- As an operator, I want a global-scope `pools.set` (or any global-scope operator mutation)
  to persist `global:routing` ONLY to the global config document, so that inspecting a
  per-project profile never reveals a copy of a global authority I never bound to that
  project.

### P1 — The per-project profile never carries a stale global authority

- As an operator, I want a second global-scope save to advance the global document without
  leaving a frozen `cas_v1` copy in the per-project profile, so that no stale shadow of the
  global authority can outlive the real one or shadow it on the next read.

### P1 — Idempotency and rollback keep working for a global mutation

- As a maintainer, I want a global mutation's idempotency record and rollback slot to keep
  working (a re-issued global command still dedups; a rollback still round-trips), so that
  closing the authority leak never silently breaks the mutation pipeline's bookkeeping.

### P2 — Project-scope writes are unchanged (back-compat)

- As a maintainer, I want a `--scope project` (or ambient) write to persist only the project
  `routing` authority to the profile exactly as before, so that every existing caller and
  test behaves identically and the change is strictly additive on the project path.

### P2 — The effective read and the global CAS are unchanged

- As a maintainer, I want the layered effective read (Feature 030) and the document-shadowing
  routing read (Feature 033) and the global CAS lockstep (Feature 034) to be byte-for-byte
  unchanged, so that only the on-disk duplication stops and no read or CAS behavior shifts.

## Functional Requirements

### Group A — the project-profile write persists only project-owned authorities (FR-A)

1. **FR-A — `mergeOperator` filters `global:*` authorities out of the project write.** The
   project (non-global) branch of `mergeOperator`
   (`config-service.ts`) MUST persist `{ ...state, authorities: <project-owned only> }`,
   dropping every authority key for which `isGlobalAuthority(key)` holds, before the
   `Config.update(..., { replace: true })` write. The GLOBAL branch MUST stay unchanged
   (`Config.updateGlobal` deep-merges the whole `state` into the global document, which
   legitimately holds `global:*` authorities). The filter MUST key on the SAME
   `isGlobalAuthority` SSOT that routes the write.

### Group B — the project-owned bookkeeping is preserved (FR-B)

2. **FR-B — idempotency, rollback, and audit-outbox are untouched by the filter.** The
   `projectOwnedAuthorities` filter MUST narrow ONLY `state.authorities`; the project-owned
   `idempotency`, `rollback`, and `auditOutbox` collections MUST persist to the profile
   exactly as before. A re-issued global command MUST still find its idempotency record on
   the project document and REPLAY (no double-apply), and a rollback slot MUST still
   round-trip. No bookkeeping record is dropped or moved.

### Group C — the effective read and global CAS are unchanged (FR-C)

3. **FR-C — no change to the layered read, the document-shadowing read, or the global CAS.**
   This feature MUST NOT change `Config.get()` layering (Feature 030), `resolveEffective`
   document-shadowing (Feature 033), the operator authority schema, or the CAS/mutation/
   idempotency/rollback/audit-outbox protocol. The global preflight/read/write authority MUST
   stay `global:routing`, and a second global-scope Save MUST still lockstep the CAS version
   (Feature 034). Only the profile WRITE stops duplicating the global authority.

### Group D — regression proof over the REAL layered Config.Service (FR-D)

4. **FR-D — the double-write and staleness are proven closed over the real config service.**
   Regression coverage MUST drive a durable operator store over the REAL `Config.Service`
   (NOT the in-process fake, which cannot reproduce the leak) with `OPENCODE_CONFIG_DIR` set
   to a temp profile, and prove:
   - (a) after a global-scope mutation (`global:routing`) plus its project-scoped bookkeeping,
     the RAW per-project profile file has NO `global:*` authority key, while its idempotency
     record IS present;
   - (b) the global document carries `global:routing` at the latest CAS version;
   - (c) after a SECOND global save, the profile still has NO `global:*` authority and the
     global document is at `cas_v2` (the stale-copy regression);
   - (d) a `--scope project` write still persists only the project `routing` authority with
     `global:routing` absent (back-compat);
   - (e) idempotency dedup still works — re-issuing the same global command key REPLAYS.

## Non-Functional Requirements

- **Minimal write-seam narrowing, no new store.** The change reuses the existing durable
  operator store; it adds one authority filter on the project write branch and no parallel
  store, port, or schema.
- **One authority-classification SSOT.** The write-routing branch and the new filter both key
  on `isGlobalAuthority`; no parallel definition of a `global:*` authority is introduced.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id,
  catalog version, dispatch path, server/port surface, or feature flag is added or altered.
- **Zero provider/model cost.** The store is model-independent and offline-capable; it makes
  no provider/model calls, consumes no tokens, and incurs no cost.
- **Honest failure.** A config write outage still degrades to a typed `unavailable` through
  the existing `mergeOperator` guard; no failure is swallowed or rendered as success.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes the operator namespace
  (`operator.authorities`, `idempotency`, `rollback`, `auditOutbox`) under the `routing` /
  `global:routing` Config authorities — operator configuration metadata (routing bindings,
  CAS versions, bounded audit intents), not end-user content or credentials. It reduces
  exposure: it stops a global authority record from being duplicated into a second on-disk
  file (the per-project profile). No credential or token is read, written, or exposed.
- **Authentication/authorization.** No new authenticated surface, credential, or permission
  boundary. The write routes exactly as before (global authority → global document, project
  authority → project profile); this feature only removes a leaked `global:*` copy from the
  project write. It does not widen or narrow authorization — `mergeOperator` rides the
  existing Feature 007 operator principal, scope, CAS, and confirmation gates unchanged.
- **Input validation.** The untrusted input is unchanged (the operator payload validated by
  each domain backend before any plan). The new filter operates on already-validated,
  store-internal `state.authorities` keys, classifying them with the closed `isGlobalAuthority`
  predicate before the project write — it introduces no new parse of untrusted input.
- **Cryptography in transit/at rest.** Not applicable — this feature persists through the
  existing Config.Service boundary Features 027/030/032 govern; it introduces no new
  data-in-transit path and no new at-rest requirement. It NARROWS what the project profile
  persists (dropping a global authority), never widening it.
- **Logging/audit.** No new logging. The committed mutation projects through the existing
  Feature 007 EventV2 audit correlation unchanged (the audit-outbox intent is written with the
  authority CAS on the global document for a global mutation, and remains project-owned for a
  project mutation). No authority payload is carried into a log line.
- **Error-handling information exposure.** A config write outage surfaces the existing typed,
  bounded `unavailable` reason through `mergeOperator`'s guard — never a stack trace or a raw
  config fragment. The filter cannot fail (a pure key partition), so it adds no new error path.

## Acceptance Scenarios

Given the operator control plane is enabled and a durable store over the REAL Config.Service
with `OPENCODE_CONFIG_DIR` set is in use

- **A global mutation does not leak a global authority into the profile (FR-A, FR-D-a).**
  Given a global-scope authority CAS committed to the global document,
  When the mutation's project-scoped bookkeeping (idempotency/rollback) writes the profile,
  Then the RAW per-project profile file has NO `global:*` authority key, while its
  idempotency record is present.

- **The global authority is at the latest CAS version on the global document (FR-D-b).**
  Given a global-scope mutation,
  When the global document is read,
  Then it carries `global:routing` at the committed CAS version.

- **A second global save leaves no stale copy (FR-A, FR-D-c).**
  Given a second global-scope save that advances the global document to `cas_v2`,
  When the per-project profile is read,
  Then it still has NO `global:*` authority and the global document is at `cas_v2`.

- **A project-scope write is unchanged (FR-C, FR-D-d).**
  Given a `--scope project` (or ambient) mutation,
  When it commits,
  Then only the project `routing` authority is persisted to the profile and `global:routing`
  is absent.

- **Idempotency still dedups a re-issued global command (FR-B, FR-D-e).**
  Given a global mutation whose idempotency record was stored,
  When the same global command key is re-issued,
  Then the store replays the stored result and does not double-apply.

## Observability

This is a store write-seam narrowing with no new backend surface, so it emits no new metrics,
log events, or trace spans. Committed operator mutations project through the existing Feature
007 EventV2 audit and the ADR-0001 OTLP foundation with content-free, bounded labels (command
id, domain, surface, outcome) — unchanged, because the payload contract and dispatch path are
unchanged. The behavioral change is only WHICH authorities the per-project profile write
persists (now project-owned only). Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The fix reuses the existing durable operator store and operator namespace; no new schema
shape is introduced. The corrected flow:

```
global-scope operator mutation (pools.set --scope global -> authority global:routing)
        |
        v
config.compareAndSet(global:routing) -> mergeOperator("global:routing")
  isGlobalAuthority => Config.updateGlobal  [ONE write, global document]     (FR-C)
        |
        v
mutation pipeline finalize: project-scoped bookkeeping
  idempotency.put / rollback.set -> mergeOperator("project")
    readRoot("project") = Config.get()  (LAYERED: global doc merged under profile, F030)
    state.authorities now CONTAINS global:routing  <-- leak vector
    project branch: persist { ...state, authorities: projectOwned(state.authorities) }  (FR-A)
      drop every isGlobalAuthority(key)  => profile carries ONLY project authorities
      idempotency / rollback / auditOutbox preserved                          (FR-B)
    Config.update(patch, { replace: true })  [project profile]
        |
        v
result: global:routing lives ONLY on the global document (no stale profile copy)
  second global save -> global doc cas_v2, profile still has no global:*      (FR-A)
  read/merge (resolveEffective, Config.get layering): UNCHANGED               (FR-C)
```

## Out of Scope

- **Changing the effective READ (`Config.get()` layering or `resolveEffective`
  document-shadowing)** — reads are already correct (Feature 030/033); only the profile WRITE
  is narrowed.
- **Routing the project-scoped bookkeeping stores to the global document for a global
  mutation** — the idempotency/rollback/outbox ports use a fixed `metaAuth()` and do not carry
  the request scope; moving the idempotency record off the project document would change where
  a re-issued command looks for its dedup record. The authority filter closes the leak without
  that larger, riskier change (see ADR-0035 Option B).
- **Any operator payload, command id, catalog version, dispatch path, or feature flag
  change** — only the `mergeOperator` project-write body changes.
- **Weakening the global CAS round-trip** — the global preflight/read/write authority stays
  `global:routing` and the second-save CAS lockstep (Feature 034) is preserved unchanged.
- **Widening `smart`/`budget`/`routing.configure`** — all already route by authority; the fix
  is at the shared store write seam and applies to every authority uniformly.

## Related Features and Decisions

- [ADR-0035 — Fix a global-scope operator write also persisting a global authority into the per-project profile](../../adr/0035-fix-a-global-scope-operator-write-also-persisting-a.md)
- [Feature 032 — Operator config writes must persist only the project owned](../032-operator-config-writes-must-persist-only-the-project-owned/spec.md) — the sibling class-of-defect (a write persisting more than the namespace it owns) and the `{ replace: true }` project write this fix narrows further.
- [Feature 030 — Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md) — the layered effective read that merges the global operator namespace into the project config, the leak vector.
- [Feature 033 — Add a global authority scope for the pools (role_pools) operator config](../033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md) — the scope→authority mapping (`global:routing`) this feature scopes off the profile.
- [Feature 034 — Add an explicit operator scope selector so global-scoped config is reachable](../034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md) — the explicit `--scope global` selector that makes the global write path reachable and reproducible.
- [Feature 021 — Operator config-backed saves must persist reliably and never silently zero](../021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md) — the shared-authority CAS-token / preflight invariants the fix preserves.
- [Feature 027 — Relocate per-project operator persistence out of the working tree](../027-relocate-per-project-operator-persistence-out-of-the-working/spec.md) — the per-project profile file that owns the leaked write target.

## Clarifications

### Session 2026-07-20

- **The double-write is closed by a project-write filter, not by re-routing bookkeeping
  (FR-A).** `mergeOperator`'s project branch strips every `global:*` authority from `state`
  before the `{ replace: true }` write, keyed on `isGlobalAuthority`. The global branch is
  unchanged. Recorded in ADR-0035.
- **Bookkeeping is preserved and idempotency is not moved (FR-B).** The filter narrows only
  `state.authorities`; the idempotency/rollback/audit-outbox collections persist as before, so
  a re-issued global command still dedups. Recorded in ADR-0035.
- **Reads and the global CAS are untouched (FR-C).** No change to `Config.get()` layering,
  `resolveEffective`, the operator schema, or the global CAS lockstep. Recorded in ADR-0035.
- **The regression must run over the REAL Config.Service (FR-D).** The in-process fake cannot
  reproduce the layered leak; the test drives the durable store over the real config service
  with `OPENCODE_CONFIG_DIR` set and inspects the two on-disk files. Recorded in ADR-0035.
- **Alternatives rejected (ADR-0035).** Routing project-scoped bookkeeping to the global
  document (widens the port surface and moves the dedup record), stopping the layered read
  (Feature 030's deliberate behavior), and a base-vs-effective delta diff (needless
  complexity) were all rejected in favor of the `global:*` authority filter on the project
  write.
</content>
