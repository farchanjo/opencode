# Implementation Plan: Fix A Global-Scope Operator Write Also Persisting A Global Authority Into The Per-Project Profile

## Overview

Stop a GLOBAL-scope operator mutation from persisting a copy of its authority
(`global:routing`) into the per-project profile. The authority CAS is already single-file
(`mergeOperator` routes a `global:*` authority to `Config.updateGlobal` only); the SECOND
file write comes from the project-scoped bookkeeping stores (idempotency/rollback/
audit-outbox), which read the LAYERED effective config (Feature 030 merges the global doc's
operator namespace under the profile) and REPLACE-write the whole namespace into the profile
(Feature 032). This plan filters non-project-owned (`global:*`) authorities out of the
project-profile write, so the profile can only ever hold that project's own authorities —
closing both the double-write and the stale-shadow regression — while leaving the layered
read, the document-shadowing routing read, the global CAS lockstep, idempotency dedup, and
rollback untouched.

## Technical Approach

Layer affected (a single write seam):

- **Durable operator store (`packages/opencode/src/operator/adapters/outbound/config-service.ts`).**
  Add a pure `projectOwnedAuthorities(authorities)` helper that partitions the authority map,
  keeping only keys for which `isGlobalAuthority(key)` is false (the SAME SSOT that routes the
  write). In `mergeOperator`, compute `global = isGlobalAuthority(authority)` once; the global
  branch persists `state` unchanged to the global document (`Config.updateGlobal` deep-merge,
  which legitimately holds `global:*` authorities), and the project branch persists
  `{ ...state, authorities: projectOwnedAuthorities(state.authorities) }` before the
  `Config.update(..., { replace: true })` write. The project-owned `idempotency`, `rollback`,
  and `auditOutbox` collections are untouched, so dedup and rollback are unchanged. (FR-A, FR-B)
- **No read change.** `Config.get()` layering (Feature 030) and `resolveEffective`
  document-shadowing (Feature 033) are not touched; a global `role_pool` still governs a
  project with no project document, and a project document still shadows the global one. Only
  the profile WRITE stops duplicating the global authority. (FR-C)
- **No protocol/schema/port change.** The operator authority schema and the CAS/mutation/
  idempotency/rollback/audit-outbox protocol are unchanged; the global preflight/read/write
  authority stays `global:routing` and the second-save CAS lockstep (Feature 034) is
  preserved. (FR-C)

Testing: a new regression in `packages/opencode/test/config/config.test.ts` — the sibling
home of the Feature 032 leak test, which already wires a durable operator store over the REAL
`Config.Service` with `OPENCODE_CONFIG_DIR` set — drives a global-scope authority CAS plus its
project-scoped bookkeeping and inspects the two on-disk files, proving the profile carries no
`global:*` authority (with its idempotency record present), the global document reaches
`cas_v2` on a second save with the profile still clean (stale-copy regression), a `--scope
project` write still writes only the project `routing` authority, and idempotency still
replays a re-issued global command. The in-process fake could not reproduce the layered leak,
so the test MUST use the real config service. (FR-D)

## Companion Artifacts

No companion files are required for this feature: it introduces no new entity, interface
contract, or external integration — it narrows one existing write seam (`mergeOperator`) and
reuses the existing durable operator store, the operator namespace, and the `Config.Service`
boundary. The optional `research.md` / `data-model.md` / `contracts/` / `quickstart.md` are
intentionally omitted (the Domain Model section in `spec.md` carries the flow diagram).
</content>
