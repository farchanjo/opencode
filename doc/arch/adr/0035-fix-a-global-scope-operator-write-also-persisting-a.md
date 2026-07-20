---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0035 — Fix A Global-Scope Operator Write Also Persisting A Global Authority Into The Per-Project Profile

## Context and Problem Statement

A coherent Smart Routing config lives on ONE routing document persisted under a per-scope
Config authority: `routing` for project scope, `global:routing` for global scope. Feature
024/025/033 made the four writers follow the request scope, and Feature 034 made the global
scope reachable from the real CLI/TUI/HTTP frontends (`--scope global`). The AUTHORITY write
is correctly single-file: `config-service.ts` `mergeOperator` branches on
`isGlobalAuthority(authority)` — a `global:*` authority routes to `Config.updateGlobal`
(the global config document `<configRoot>/opencode.jsonc`), a project authority to
`Config.update` (the per-project profile `<configRoot>/profiles/<encoded-abspath>/config.json`).

But a GLOBAL-scope operator mutation (e.g. `op pools set --scope global`) was observed on the
live binary writing `operator.authorities["global:routing"]` into TWO files: the global
config document (CORRECT) AND the per-project profile (WRONG). Worse, the profile copy went
STALE — a second global save bumped the global document to `cas_v2`, but the shadowing
project copy stayed frozen at `cas_v1`:

```
export OPENCODE_CONFIG_DIR=/tmp/f035-repro OPENCODE_OPERATOR_CONTROL_PLANE=1
op pools set --scope global ...      # writes global:routing to BOTH files (v1)
op pools set --scope global ...      # global doc -> v2; project-profile copy stuck at v1
```

The `--scope project` and ambient (project-preferred) paths were already correct — only the
global path double-wrote. Root cause: the operator store's project-scoped BOOKKEEPING stores
(idempotency, rollback, audit-outbox) are hardwired to the project authority
(`metaAuth() === "project"`). Each of them read the FULL effective config via `readRoot` →
`Config.get()` and then REPLACE-write the profile (Feature 032, `{ replace: true }`).
Post-Feature-030 `Config.get()` is a LAYERED read: `loadInstanceState` merges the global
document's `operator` namespace UNDER the per-project profile. So after the global authority
CAS committed `global:routing` to the global document, the very next project-scoped
bookkeeping write (`ports.idempotency.put` in the mutation `finalize`, `ports.rollback.set`
on cutover) read a layered `state.authorities` that now CONTAINED `global:routing` and
snapshotted it wholesale into the profile. This is the exact class Feature 032 fixed for
base-inherited secrets ("a write persists more than the namespace it owns"), now surfacing on
the global authority via the Feature 030 layering. The staleness follows from the same
layering: on a second global save the profile's leaked `global:routing` (a project-source
authority, merged LAST) SHADOWS the fresher `cas_v2` from the global document, so the
re-persisted copy freezes at `cas_v1`.

The in-process mock store (`createFakeConfigService`, used by the Feature 033/034 suites) did
NOT reproduce this: its `get()` returns the project map WITHOUT layering the global map, so
`global:routing` never leaks into `state`. The defect only appears over the REAL, layered
`Config.Service`.

The question: how to make a global-scope operator mutation persist its authority AND its
bookkeeping coherently with the global document — so the per-project profile can never carry
a `global:*` authority key (and never freeze a stale copy) — WITHOUT changing the effective
READ semantics (Feature 033 document-shadowing project > global stays), WITHOUT weakening the
global CAS round-trip (Feature 034), and WITHOUT breaking idempotency dedup or rollback.

## Decision Drivers

- **The per-project profile owns ONLY project authorities.** No `global:*` authority key may
  ever appear in `<configRoot>/profiles/<key>/config.json`; that authority belongs solely on
  the global config document — the security/correctness guarantee this feature enforces.
- **No stale shadow copy.** A second global save must advance the global document without
  leaving a frozen `cas_v1` copy in the profile that shadows the fresher version on the next
  layered read.
- **Read semantics unchanged.** Feature 033 document-shadowing (project doc > global doc >
  default) is already correct; only the WRITE is defective. `resolveEffective` and the layered
  `Config.get()` must not change.
- **Global CAS round-trip preserved.** The global preflight/read/write authority must stay
  `global:routing`, and a second global Save must still lockstep the CAS version (Feature 034)
  — the fix must not regress that.
- **Idempotency and rollback intact.** A re-issued global command must still dedup (its
  idempotency record must not be dropped), and rollback slots must still round-trip.
- **Keep `isGlobalAuthority` semantics.** The single SSOT that classifies a `global:*`
  authority stays the authority of record for the write routing.

## Considered Options

- **Option A — Filter non-project-owned authorities out of the project-profile write
  (chosen).** `mergeOperator`'s project (non-global) branch strips every `global:*` key from
  `state.authorities` before the `{ replace: true }` write, via a `projectOwnedAuthorities`
  helper keyed on the existing `isGlobalAuthority` SSOT. The global branch is untouched (it
  still deep-merges into the global document). The project-owned bookkeeping
  (idempotency/rollback/auditOutbox) is untouched, so dedup and rollback are unchanged. This
  is the minimal fix at the exact write seam that produced the leak, and it is inherently
  correct because the project profile has no legitimate `global:*` sibling to preserve.
- **Option B — Route the project-scoped bookkeeping stores to the global document for a
  global mutation.** Rejected as heavier and riskier: the idempotency/rollback/outbox ports
  do not carry the request authority (they use a fixed `metaAuth()`), so threading the scope
  through every bookkeeping call would widen the port surface, and it would MOVE the
  idempotency record off the project document — changing where a re-issued command looks for
  its dedup record, a behavioral change with its own migration risk. The authorities are
  ALREADY routed correctly (each authority's CAS goes to the right document); only the
  project write's re-snapshot of layered-in authorities is wrong, so the fix belongs there.
- **Option C — Stop layering the global operator namespace into `Config.get()`.** Rejected
  and out of scope: the layered read is Feature 030's deliberate, correct behavior (the global
  document must keep resolving for effective config), and Feature 033's document-shadowing
  read depends on it. The defect is duplication on WRITE, not inheritance on READ.
- **Option D — Diff the effective root against the global document and persist only the
  delta.** Rejected: it re-derives what the store already knows precisely (the profile owns
  exactly the non-`global:*` authorities plus the project bookkeeping), and adds a
  deep-equality diff with subtle edge cases — strictly more complex than the one-key-class
  filter.

## Decision Outcome

Chosen option: **Option A**, because filtering `global:*` authorities out of the
project-profile write persists exactly what the per-project profile owns, provably excludes
every global authority key, self-heals a profile already leaked by the pre-fix code on its
next mutation, leaves the Feature 030 layered read / Feature 033 document-shadowing / Feature
034 global CAS untouched, and keeps idempotency dedup and rollback intact — with a single
narrowing at the write seam that produced the double-write.

Key decisions recorded:

1. **Filter non-project-owned authorities on the project write (FR-A).** `mergeOperator`
   (`packages/opencode/src/operator/adapters/outbound/config-service.ts`) computes
   `global = isGlobalAuthority(authority)`; the global branch persists `state` unchanged to
   the global document, the project branch persists
   `{ ...state, authorities: projectOwnedAuthorities(state.authorities) }` — dropping every
   key for which `isGlobalAuthority(key)` holds — before the `{ replace: true }` write. This
   is the only behavioral change.
2. **Bookkeeping untouched, dedup preserved (FR-B).** The `projectOwnedAuthorities` filter
   narrows ONLY `state.authorities`; the project-owned `idempotency`, `rollback`, and
   `auditOutbox` collections are persisted as before. A re-issued global command still finds
   its idempotency record on the project document (`claim` returns `replay`), and rollback
   slots still round-trip. Idempotency is not moved and not dropped.
3. **Read semantics unchanged (FR-C).** The layered `Config.get()` (Feature 030) and the
   routing document-shadowing read (`resolveEffective`, Feature 033) are not touched; a global
   `role_pool` still governs a project with no project document, and a project document still
   shadows the global one. Only the profile's on-disk WRITE stops duplicating the global
   authority.
4. **Global CAS lockstep preserved (FR-D).** The global authority write still routes to
   `Config.updateGlobal` and deep-merges into the global document; the global
   preflight/read/write authority stays `global:routing`, and a second global Save still bumps
   the CAS version — the Feature 034 lockstep is intact.
5. **`isGlobalAuthority` stays the SSOT (invariant).** The write-routing branch and the new
   authority filter both key on `isGlobalAuthority`, so there is one definition of what a
   `global:*` authority is; no parallel classification is introduced. No operator schema, CAS
   protocol, command id, catalog version, or dispatch path changes.
6. **Regression test over the REAL layered Config.Service (load-bearing).** A test in
   `packages/opencode/test/config/config.test.ts` (the sibling home of the Feature 032 leak
   test) drives a durable operator store over the REAL `Config.Service` with
   `OPENCODE_CONFIG_DIR` set to a temp profile: it commits `global:routing` (v1), confirms the
   layered `Config.get()` DOES carry `global:routing` (the leak vector is real), runs the
   project-scoped bookkeeping (`idempotency.put` + `rollback.set`), and asserts the RAW
   per-project profile file has NO `global:*` authority while its idempotency record persists;
   a second global save advances the global document to `cas_v2` with the profile still free
   of any `global:*` (the stale-copy regression); an idempotency re-claim replays; and a
   `--scope project` write still persists only the project `routing` authority with
   `global:routing` absent. It fails on the pre-fix source and passes after.

### Consequences

- Good: a global-scope operator mutation can no longer double-write a `global:*` authority
  into a per-project profile — the leak is closed and test-locked.
- Good: the stale-shadow regression is closed — the profile never freezes a `cas_v1` copy that
  shadows the fresher global document on the next layered read.
- Good: self-healing. A profile already leaked by the pre-fix code has its `global:*`
  authority scrubbed on its very next operator mutation (the write REPLACES the profile),
  matching the Feature 032 self-heal.
- Good: the Feature 030 layered read, the Feature 033 document-shadowing read, and the Feature
  034 global CAS lockstep are all unaffected — only the on-disk duplication stops.
- Good: idempotency dedup and rollback are unchanged — the filter narrows only the authority
  map, not the project-owned bookkeeping the profile legitimately holds.
- Neutral: the project write now applies a one-pass authority filter; the global write path is
  byte-for-byte unchanged.
- Residual (accepted): the idempotency record for a global mutation remains on the project
  document (where it has always lived), so dedup is scoped to the issuing project directory —
  a re-issue of the same global command from a DIFFERENT directory would not replay. This is
  the pre-existing project-scoped bookkeeping behavior, not a regression; routing global
  bookkeeping to the global document (Option B) is a separate, larger change left out of
  scope.

## Related

- Feature specification: [035 Fix a global-scope operator write also persisting a global authority into the per-project profile](../sdd/035-fix-a-global-scope-operator-write-also-persisting-a/spec.md)
- The sibling class-of-defect (a write persisting more than the namespace it owns) this mirrors: [032 Operator config writes must persist only the project owned](../sdd/032-operator-config-writes-must-persist-only-the-project-owned/spec.md)
- The layered global READ that merges the global operator namespace into the project effective config: [030 Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../sdd/030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md)
- The global authority WRITE target this scopes off the profile: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
- The explicit scope selector that makes the global path reachable (and reproducible): [034 Add an explicit operator scope selector so global-scoped config is reachable](../sdd/034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md)
- The shared-authority CAS-token / preflight invariants preserved: [021 Operator config-backed saves must persist reliably and never silently zero](../sdd/021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md)
- The per-project profile relocation that owns the leaked write target: [027 Relocate per-project operator persistence out of the working tree](../sdd/027-relocate-per-project-operator-persistence-out-of-the-working/spec.md)
</content>
