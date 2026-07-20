# Implementation Plan: Operator Config Backed Saves Must Persist Reliably And Never Silently Zero

Feature: 021-operator-config-backed-saves-must-persist-reliably-and-never
Status target: planned (after this plan is complete)
ADR: [ADR-0021](../../adr/0021-operator-config-backed-saves-must-persist-reliably-and-never.md) **proposed**
Spec: [spec.md](spec.md) (FR-A..FR-E; audit result; domain model; preserve-CAS + surfaced-failure + one-SSOT invariants)

## Overview

An operator config-backed save (`pools.set`) can fail to persist and re-open
**empty** whenever the mutation preflight resolves the wrong Config authority.
`pools.set` commits to the shared `"routing"` authority
(`packages/opencode/src/operator/pools/backend-live.ts:44`), but the **degraded
fallback** `authorityKeyForCommandId`
(`packages/opencode/src/operator/adapters/outbound/config-status.ts:10-13`)
returns the id **prefix** `"pools"` — a virgin authority with no CAS token — so
the second `pools.set` (and any first `pools.set` on a config already holding a
routing document) fails the correct-by-design guard
`mutations require version (CAS token) when authority already exists`
(`packages/opencode/src/operator/application/mutation.ts:224-233`) and commits
nothing. This plan makes the degraded fallback **correct-by-construction** by
sourcing its static command→authority resolution from the SAME domain constants
the wired `createOperatorAuthorityResolver`
(`packages/opencode/src/operator/application/command-authority.ts:76-116`) already
uses; it **preserves** the CAS guard (the fix is correct preflight, never a
weakened guard or an auto-resolved token); and it locks the production-wiring and
surfaced-failure invariants with regression proof for the exact reproduced
scenarios.

**Audit conclusion driving this plan (every anchor verified 2026-07-20):**

- **Prong B — no wiring gap at HEAD.** Every production preflight entrypoint
  threads `LiveOperatorStack.resolveAuthority` (`stack-live.ts:864`): the trusted
  worker fetch (`worker-adapter.ts:49`), the worker-local slash port
  (`worker-adapter.ts:72-74`), and the HTTP mount production+test branches
  (`http/mount.ts:88,149`). The user's "fica zerado" is a stale binary predating
  `stack-live.ts:836` or a mis-wired port — not a HEAD gap. FR-B is a regression
  guard.
- **Prong A — the degraded fallback IS wrong (the substantive fix).** The naive
  prefix fallback is incorrect for every command whose commit authority ≠ its
  prefix (pools, telemetry, smart, budget, routing-global, mcp, output, langlock);
  it is reached exactly on the stale/mis-wired path. Hardening it closes the
  hazard at the root.
- **Prong D — a rejected save is already surfaced (non-regression).** The form
  save handlers render `failureReason(result)` in-modal and keep the modal open on
  a non-success outcome (`packages/tui/src/operator/form/edit-modal.tsx:113-119`,
  `multi-field-modal.tsx:289-295`); slash/CLI toasts it (`execute.ts:205,218`).
  FR-D locks this.

**Explicitly out of this plan (invariants preserved):**

- **Preserve optimistic concurrency (FR-C).** No weakening of the
  `mutations require version` / `CAS version conflict` guard
  (`mutation.ts:224-242`); no auto-resolve of a missing/absent token.
- **No contract change.** No operator payload, command id, catalog version,
  dispatch path, server/port surface, or feature flag is added or altered.
- **One source of truth (NFR).** The static command→authority resolution derives
  from the domain constants once, shared by the wired resolver and the hardened
  fallback — no parallel string table.

## Technical Approach

### Architecture layers affected

```
Phase A — one-SSOT static authority resolution  (FR-A)
  command-authority.ts: extract staticAuthorityForCommandId(commandId): string|null
    - scope-free subset sourced from the domain constants already imported:
      pools->POOLS_AUTHORITY("routing"), telemetry->TELEMETRY_AUTHORITY,
      jobs->JOBS_AUTHORITY, semantic->SEMANTIC_AUTHORITY, mcp config/conn/auth verbs
    - createOperatorAuthorityResolver reuses it for its static cases (no dup logic)
        |
        v
Phase B — harden the degraded fallback  (FR-A)
  config-status.ts authorityKeyForCommandId: delegate to staticAuthorityForCommandId,
    fall to commandId prefix ONLY when it returns null (scope-dependent / unknown)
  route the inline split(".")[0] fallbacks through the same resolution:
    http/handler.ts:229, http-slash-port.ts:216, rpc-slash-port.ts:196, tui-port.ts:114
        |
        v
Phase C — wiring + surfaced-failure regression guards  (FR-B, FR-C, FR-D)
  assert every production preflight port threads stack.resolveAuthority
  assert the CAS guard is unchanged (no auto-resolve path)
  assert a rejected save surfaces in-modal / toast and never closes on non-success
        |
        v
Phase D — reproduced-scenario regression proof + validate  (FR-E, FR-all)
  2nd pools.set persists; 1st pools.set over an existing routing doc persists;
  degraded-fallback-without-resolver resolves "routing"; rejected save surfaced
  speckit analyze + validate --json green; doc sync
```

### Guard-scope note

Every write lands inside the Feature 007 implement scope
(`doc/arch/speckit.toml` `[guard] specScopeGlobs`): the fix files
`packages/opencode/src/operator/application/command-authority.ts`,
`packages/opencode/src/operator/adapters/outbound/config-status.ts`, and the
inline-fallback sites (`operator/http/handler.ts`,
`operator/adapters/inbound/{http-slash-port,rpc-slash-port,tui-port}.ts`) are all
under `packages/opencode/src/operator/**`; the regression tests land under
`packages/opencode/test/operator/**`; any TUI FR-D assertion lands under
`packages/tui/**/operator/**` / `packages/tui/test/operator/**`. No file outside
scope is written — the domain backends are **read** (their exported authority
constants are imported), not modified.

### Phase A — One-SSOT static authority resolution (FR-A)

- **Extract `staticAuthorityForCommandId`.** In `command-authority.ts`, factor a
  pure `staticAuthorityForCommandId(commandId): string | null` covering the
  scope-**independent** authorities, sourced from the domain constants already
  imported at the top of the module (`POOLS_AUTHORITY`, `TELEMETRY_AUTHORITY`,
  `JOBS_AUTHORITY`, `SEMANTIC_AUTHORITY`, and the `MCP_CONFIG_VERBS` /
  `MCP_CONNECTION_VERBS` / `mcp.auth.remove` sets → `MCP_*_AUTHORITY`,
  `OUTPUT_ADMIN_VERBS` → `OUTPUT_ADMIN_AUTHORITY`). Return `null` for the
  scope-**dependent** domains (`smart`/`budget`/`routing`/`langlock` and the
  `output.retention.set`/`output.quota.set` scope lambdas) and for unknown ids.
- **Reuse it in the wired resolver.** `createOperatorAuthorityResolver` delegates
  its static cases to `staticAuthorityForCommandId` and keeps the scope-dependent
  branches (`SMART_AUTHORITY[s]`, `BUDGET_AUTHORITY[s]`, the injected
  `langlock`/`output` lambdas) — so both the wired resolver and the fallback read
  ONE source of truth and cannot drift.

### Phase B — Harden the degraded fallback (FR-A)

- **`authorityKeyForCommandId`.** Replace `commandId.split(".")[0]` with
  `staticAuthorityForCommandId(commandId) ?? commandId.split(".")[0]` so a
  static-authority command (`pools.set → "routing"`) resolves correctly even with
  no resolver threaded; scope-dependent/unknown ids keep the prefix (no
  regression). Keep the payload/secret-free contract of
  `createConfigStatusHandler` (`config-status.ts:19-39`) intact.
- **Inline fallbacks.** Route `http/handler.ts:229`,
  `http-slash-port.ts:216`, `rpc-slash-port.ts:196`, and `tui-port.ts:114` through
  the hardened resolution (prefer the threaded `resolveAuthority`, then
  `staticAuthorityForCommandId`, then the prefix) so no preflight path keeps raw
  prefix behavior for a static-authority command. The remote/RPC ports that read
  `json.authority` from the server response are already covered because the server
  handler resolves correctly; the local default falls through the hardened
  helper.

### Phase C — Wiring + surfaced-failure regression guards (FR-B, FR-C, FR-D)

- **FR-B wiring guard.** A test asserts every production preflight port threads
  `stack.resolveAuthority` (trusted worker fetch, worker-local slash, HTTP mount
  production+test) — a future port that drops it fails the assertion.
- **FR-C guard.** A test pins that `mutateAuthority` still rejects a mutation with
  a missing version when the authority exists and still returns `CAS version
  conflict` on a stale token — proving the fix added no auto-resolve path.
- **FR-D guard.** A TUI test pins that a rejected `pools.set` sets the in-modal
  error via `failureReason` and does NOT close the modal / fire `onSaved`
  (`multi-field-modal.tsx:289-295`), and that the slash/CLI path toasts a
  non-success outcome.

### Phase D — Reproduced-scenario regression proof + validate (FR-E)

- **Regression proof over the REAL wired stack** (the authority-split /
  mutation-parity / surface-parity suites,
  `packages/opencode/test/operator/{authority-split,mutation-parity,surface-parity}.test.ts`):
  (a) a second `pools.set` persists the `[reviewer, worker]` binding; (b) a first
  `pools.set` on a config already holding a routing document persists; (c) with
  the hardened fallback but the full resolver absent, `pools.set` preflight
  resolves `"routing"` and threads the right token; (d) a genuinely rejected
  mutation returns a typed failure the form surfaces in-modal.
- **Validate + doc sync.** `speckit analyze` then `speckit validate --json` green;
  keep `AGENTS.md`/`README`/`doc/arch` in sync (no doc surface changes expected —
  behavior-correctness only).

## Companion Artifacts

The following optional companion files may be created alongside this plan during
implement to capture additional context:

- `research.md` — the production-entrypoint audit table and the mismatched-command
  enumeration (inline in the spec and ADR; deferred as a separate file).
- `data-model.md` — the preflight-authority resolution guarantees, specified
  instead in
  `doc/arch/schemas/operator-config-backed-saves-must-persist-reliably-and-never.cue`.
- `contracts/` — no new interface contract; the operator payloads, command ids,
  and dispatch path are unchanged.
- `quickstart.md` — reproducing the second-`pools.set` persistence over the
  operator sandbox (deferred to implement).
