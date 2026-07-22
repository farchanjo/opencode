# Tasks: Operator Config Backed Saves Must Persist Reliably And Never Silently Zero (Feature 021)

Synced with plan.md (Phase A one-SSOT static resolution, Phase B harden the
degraded fallback, Phase C wiring + surfaced-failure guards, Phase D reproduced-
scenario regression proof + validate) and the specScopeGlobs in
doc/arch/speckit.toml. ADR-0021 proposed.

Behavior-correctness change ONLY. NO operator payload change, NO command id, NO
catalog version bump, NO new dispatch path, NO new flag — and NO weakening of the
optimistic-concurrency (CAS) guard (FR-C). The fix is a correct-by-construction
preflight authority fallback sourced from ONE domain SSOT (FR-A), plus regression
proof of the production wiring (FR-B), the surfaced-failure contract (FR-D), and
the exact reproduced `pools.set` scenarios over the REAL wired stack (FR-E). No
code is executed in this documentary pass; tasks are the implement backlog. All
items start unchecked.

## Task Breakdown

Checkbox backlog (details under each group below). Phase A (the one-SSOT static
resolution) is FIRST — the hardened fallback and every guard depend on it.

- [x] T001 — Extract `staticAuthorityForCommandId` from the domain SSOT in `command-authority.ts`
- [x] T002 — Reuse `staticAuthorityForCommandId` in `createOperatorAuthorityResolver` (no dup)
- [x] T003 — Harden `authorityKeyForCommandId` to consult the static SSOT (pools→routing)
- [x] T004 — Route the inline `split(".")[0]` preflight fallbacks through the hardened resolution
- [x] T005 — FR-B wiring regression guard: every production preflight port threads `resolveAuthority`
- [x] T006 — FR-C guard: the CAS `mutations require version` / conflict guard is unchanged
- [x] T007 — FR-D guard: a rejected save surfaces in-modal / toast, never a silent success
- [x] T008 — FR-E reproduced-scenario regression proof over the REAL wired stack
- [x] T009 — `speckit analyze` + `validate --json` green + doc sync

---

## Phase A — One-SSOT static authority resolution (FR-A) — FIRST

- [x] **T001 — Extract `staticAuthorityForCommandId` from the domain SSOT**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/application/command-authority.ts`
- **Deliverable:** a pure `staticAuthorityForCommandId(commandId: string): string | null`
  covering the scope-**independent** authorities, sourced from the domain
  constants already imported at the top of the module: `pools.* → POOLS_AUTHORITY`
  (`"routing"`), `telemetry.* → TELEMETRY_AUTHORITY` (`"global:telemetry"`),
  `jobs.* → JOBS_AUTHORITY`, `semantic.* → SEMANTIC_AUTHORITY`, the
  `MCP_CONFIG_VERBS → MCP_CONFIG_AUTHORITY`,
  `MCP_CONNECTION_VERBS → MCP_CONNECTIONS_AUTHORITY`,
  `mcp.auth.remove → MCP_AUTH_AUTHORITY`, and
  `OUTPUT_ADMIN_VERBS → OUTPUT_ADMIN_AUTHORITY`. It MUST return `null` for the
  scope-**dependent** domains (`smart`/`budget`/`routing`, the injected
  `langlock`/`output.retention.set`/`output.quota.set` scope lambdas) and for
  unknown/non-mutating ids. No re-typed string table — only the exported
  constants (the ADR-0017 "sourced from the domains" invariant, extended).
- **Acceptance:** `staticAuthorityForCommandId("pools.set") === "routing"`,
  `"telemetry.configure" → "global:telemetry"`, `"jobs.*"/"semantic.*"` unchanged,
  and every scope-dependent/unknown id returns `null`.
- **Verification:** `bun test packages/opencode/test/operator/authority-split.test.ts`.
- **Evidence:** 2026-07-20 — `command-authority.ts:64-101` exports `staticAuthorityForCommandId` (pools→"routing", telemetry→"global:telemetry", jobs/semantic unchanged, mcp verb sets, output-admin; null for scope-dependent/unknown), sourced from the domain constants (no re-typed table). `feature021-persist.test.ts` FR-A block green.

- [x] **T002 — Reuse `staticAuthorityForCommandId` in the wired resolver (no dup)**
- **Depends:** T001
- **Paths:** `packages/opencode/src/operator/application/command-authority.ts`
- **Deliverable:** `createOperatorAuthorityResolver` (`:76-116`) delegates its
  static cases (`pools`/`telemetry`/`jobs`/`semantic`/the `mcp` config/connection/
  auth-remove verbs/the `output` admin verbs) to `staticAuthorityForCommandId`,
  keeping ONLY the scope-dependent branches inline (`SMART_AUTHORITY[s]`,
  `BUDGET_AUTHORITY[s]`, `routing → SMART_AUTHORITY[s]`, the injected
  `langlockAuthorityFor`/`retentionAuthorityFor`/`quotaAuthorityFor` lambdas). The
  wired resolver's behavior is byte-for-byte unchanged; the static logic now lives
  in ONE place shared with the fallback.
- **Acceptance:** the existing authority-split parity assertions still pass; the
  resolver and the fallback cannot drift because they read the same helper.
- **Verification:** `bun test packages/opencode/test/operator/authority-split.test.ts`.
- **Evidence:** 2026-07-20 — `command-authority.ts:110-145` `createOperatorAuthorityResolver` now delegates static cases to `staticAuthorityForCommandId` and keeps only scope-dependent branches (smart/budget/routing/langlock/output lambdas). `authority-split.test.ts` + `feature017-fixround.test.ts` ROOT-MECHANISM parity green; no drift (feature021 SSOT-agreement test asserts resolver==fallback==static).

## Phase B — Harden the degraded fallback (FR-A)

- [x] **T003 — Harden `authorityKeyForCommandId` to consult the static SSOT**
- **Depends:** T002
- **Paths:** `packages/opencode/src/operator/adapters/outbound/config-status.ts`
- **Deliverable:** replace `commandId.split(".")[0]` in `authorityKeyForCommandId`
  (`:10-13`) with `staticAuthorityForCommandId(commandId) ?? commandId.split(".")[0]`
  so a static-authority command resolves correctly with NO resolver threaded
  (`pools.set → "routing"`, closing the reproduced bug at the root); scope-
  dependent/unknown ids keep the prefix (no regression). Preserve the
  payload/secret-free contract of `createConfigStatusHandler` (`:19-39`) — this
  changes only the authority key derivation, not what the status query returns.
- **Acceptance:** `authorityKeyForCommandId("pools.set") === "routing"`; the
  STATUS_SHOW_IDS query handlers (`routing.status`, `semantic.*`) still resolve
  their existing authorities; no secret/payload is exposed.
- **Verification:** `bun test packages/opencode/test/operator/{authority-split,surface-parity}.test.ts`.
- **Evidence:** 2026-07-20 — `config-status.ts:10-24` `authorityKeyForCommandId` = `staticAuthorityForCommandId(commandId) ?? commandId.split(".")[0] ?? commandId`; `authorityKeyForCommandId("pools.set")==="routing"`. Secret-free status contract (`:33-53`) untouched. `authority-split`+`surface-parity`+`feature021-persist` green.

- [x] **T004 — Route the inline preflight fallbacks through the hardened resolution**
- **Depends:** T003
- **Paths:** `packages/opencode/src/operator/http/handler.ts`,
  `packages/opencode/src/operator/adapters/inbound/http-slash-port.ts`,
  `packages/opencode/src/operator/adapters/inbound/rpc-slash-port.ts`,
  `packages/opencode/src/operator/adapters/inbound/tui-port.ts`
- **Deliverable:** every preflight site that currently falls to
  `commandId.split(".")[0]` (`http/handler.ts:229`, `http-slash-port.ts:216`,
  `rpc-slash-port.ts:196`, `tui-port.ts:114`) MUST prefer the threaded
  `resolveAuthority`, then `staticAuthorityForCommandId`, then the prefix — so no
  preflight path keeps raw-prefix behavior for a static-authority command. The
  remote/RPC ports that read `json.authority` from the server response stay
  correct because the server handler already resolves; only their absent-authority
  default is hardened.
- **Acceptance:** with `resolveAuthority` absent, each site resolves
  `pools.set → "routing"`; with it present, behavior is unchanged.
- **Verification:** `bun test packages/opencode/test/operator/{surface-parity,mutation-parity}.test.ts`.
- **Evidence:** 2026-07-20 — `http/handler.ts:230` `resolved ?? authorityKeyForCommandId(commandId)`; `http-slash-port.ts:216` + `rpc-slash-port.ts:196` `json.authority ?? authorityKeyForCommandId(input.commandId)`; `tui-port.ts:114` already delegated to `authorityKeyForCommandId` (verified, hardened via T003). `surface-parity`+`mutation-parity` green.

## Phase C — Wiring + surfaced-failure regression guards (FR-B, FR-C, FR-D)

- [x] **T005 — FR-B wiring regression guard: every production preflight port threads `resolveAuthority`**
- **Depends:** T004
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** a test asserting every production preflight entrypoint threads
  `LiveOperatorStack.resolveAuthority` (`stack-live.ts:864`): the trusted worker
  fetch (`worker-adapter.ts:49`), the worker-local slash port
  (`worker-adapter.ts:72-74`), and the HTTP mount production+test branches
  (`http/mount.ts:88,149`). A future port that drops the resolver MUST fail this
  assertion. (Prong B found NO gap at HEAD — this guard keeps it that way.)
- **Acceptance:** the guard passes at HEAD and fails if `resolveAuthority` is
  removed from any listed production port.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-20 — `feature021-persist.test.ts` FR-B block: source-invariant guard asserts `resolveAuthority: stack.resolveAuthority` appears 2× in `worker-adapter.ts` and 2× in `http/mount.ts` (drops fail the count), plus a behavioral guard proving a threaded spy resolver is actually invoked in a real `pools.set` preflight (→"routing"). Green.

- [x] **T006 — FR-C guard: the CAS guard is unchanged (no auto-resolve)**
- **Depends:** T004
- **Paths:** `packages/opencode/test/operator/mutation-parity.test.ts`
- **Deliverable:** pin that `mutateAuthority` (`mutation.ts:224-242`) still rejects
  a mutation with `mutations require version (CAS token) when authority already
  exists` when the authority exists and `version === undefined`, and still returns
  `CAS version conflict` on a stale token — proving the FR-A fix added NO
  auto-resolve / token-defaulting path and preserves lost-update protection (FR-C
  non-goal).
- **Acceptance:** both rejections still fire; no code path defaults an absent
  version to the current version at mutate time.
- **Verification:** `bun test packages/opencode/test/operator/mutation-parity.test.ts`.
- **Evidence:** 2026-07-20 — `mutation-parity.test.ts` FR-C block drives `mutateAuthority` directly: version=undefined on an existing authority → `invalid_argument` + "mutations require version (CAS token) when authority already exists"; stale token → `conflict` + "CAS version conflict"; committed version unchanged (no auto-resolve/defaulting). Green.

- [x] **T007 — FR-D guard: a rejected save is surfaced, never a silent success**
- **Depends:** T004
- **Paths:** `packages/tui/test/operator/**`, `packages/tui/src/operator/form/**`
- **Deliverable:** pin that a rejected `pools.set` (conflict / invalid argument)
  from an operator form sets the in-modal error via
  `setError(failureReason(result))` and does NOT close the modal or fire `onSaved`
  (`multi-field-modal.tsx:289-295`, `edit-modal.tsx:113-119`); and that a
  non-success outcome on the slash/CLI path toasts the typed reason
  (`execute.ts:205,218`). The `silent:true` path suppresses only the toast, never
  the in-modal error. (This is HEAD behavior — the guard locks it.)
- **Acceptance:** a rejected save keeps the modal open with a typed, secret-free
  reason; only a success outcome closes the form; no silent zeroing.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-20 — `packages/tui/test/operator/rejected-save-surfaced.test.tsx`: full-render pools.set modal + real `executeOperatorCommand` with a REJECTING port (conflict) → in-modal "CAS version conflict", modal stays open, `onSaved` NOT fired, dispatch DID fire; and the slash/CLI (non-silent) path toasts a non-success variant. 2 pass.

## Phase D — Reproduced-scenario regression proof + validate (FR-E, FR-all)

- [x] **T008 — FR-E reproduced-scenario regression proof over the REAL wired stack**
- **Depends:** T005, T006, T007
- **Paths:** `packages/opencode/test/operator/authority-split.test.ts`,
  `packages/opencode/test/operator/mutation-parity.test.ts`,
  `packages/opencode/test/operator/surface-parity.test.ts`
- **Deliverable:** regression coverage over the real wired stack proving:
  (a) a **second** `pools.set` persists end-to-end (the `[reviewer, worker]`
  binding survives the 2nd write); (b) a **first** `pools.set` on a config that
  already holds a `"routing"` document persists (no false `mutations require
  version`); (c) with the hardened fallback but the full resolver **absent**, a
  `pools.set` preflight resolves `"routing"` and threads the right token; (d) a
  genuinely **rejected** mutation still returns a typed failure the form surfaces
  in-modal. These are the exact reproduced scenarios ("fica zerado").
- **Acceptance:** all four scenarios green; (a)/(b) assert the persisted binding on
  re-read; (c) asserts the resolved authority is `"routing"`; (d) asserts a typed
  failure envelope, not a silent success.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-20 — `feature021-persist.test.ts` FR-E over the REAL wired stack (`createTuiOperatorSlashPort`, NO resolver): (a) 2nd pools.set persists [reviewer,worker]; (b) 1st pools.set over a pre-seeded routing doc persists (no false require-version); (c) preflight resolves "routing" with resolver absent; read-back shows both; routing engine sees role_pools (`resolveDecisionModelPool`). PLUS on-disk proof: real `createFileConfigService` config.json physically holds role_pools under operator.authorities.routing.payload, and a FRESH store re-reads both bindings. 12 pass.

- [x] **T009 — `speckit analyze` + `validate --json` green + doc sync**
- **Depends:** T008
- **Paths:** `doc/arch/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm every write stayed inside the operator implement scope
  (`packages/opencode/src/operator/**`, `packages/opencode/test/operator/**`,
  `packages/tui/**/operator/**`); keep `AGENTS.md`/`README`/`doc/arch` in sync (no
  doc surface change expected — behavior-correctness only); run `speckit analyze`
  then `speckit validate --json` and resolve any finding this feature introduced.
- **Acceptance:** guard clean; `speckit validate --json` green; docs in sync.
- **Verification:** `speckit validate --json`.
- **Evidence:** 2026-07-20 — `speckit validate --json` → `ok:true` (4 pre-existing waived hygiene findings, none from this feature); `speckit status` analyzed. opencode operator 491 pass/2 skip, routing 235 pass, tui operator 201 pass; tsc clean except pre-existing `dialog-move-session.tsx`. All writes inside operator implement scope; no doc surface change needed.

## Dependencies

- **Phase A before all.** T001→T002 build the single static SSOT the hardened
  fallback (T003/T004) and every guard consume; T003 depends on T002; T004 depends
  on T003; the guards (T005/T006/T007) depend on T004; the reproduced-scenario
  proof (T008) depends on the guards; T009 gates the commit.
- **No external dependency.** The domain authority constants are already exported
  and imported by `command-authority.ts`; no new SDK call, server change, or
  provider connection is required. Tests use the existing operator test stacks.
- **Invariant:** no task weakens the CAS guard, auto-resolves a token, or adds an
  operator payload change, command id, catalog version bump, dispatch path, or
  feature flag (FR-C, NFR).
