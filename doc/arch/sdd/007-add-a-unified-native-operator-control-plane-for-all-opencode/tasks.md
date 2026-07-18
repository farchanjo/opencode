# Tasks: Unified Native Operator Control Plane (Feature 007)

Synced with plan.md (isolation harness, Phase 1 slices S0–S11, ports/stubs,
specScopeGlobs in doc/arch/speckit.toml, ADR-0003 accepted).

Phase 1 only. App/Desktop = Phase 2 (T090–T092 deferred).  
No code is executed in this documentary pass; tasks are the implement backlog.  
All OpenCode process executions MUST use the sandbox wrapper after T001–T004.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task

## Task Breakdown

Checkbox backlog (details under each group below). All Phase 1 items start unchecked.

- [x] T001 — Create `.dev/` sandbox layout and gitignore
- [x] T002 — Sandbox env prefix and port constants
- [x] T003 — Local wrapper script
- [x] T004 — Proof tests: production paths unchanged
- [x] T005 — Principal and scope value objects
- [x] T006 — Command ID schema (dotted)
- [x] T007 — Reserved operator ID catalog (versioned)
- [x] T008 — OperatorCommandRegistry
- [x] T009 — Error taxonomy module
- [x] T010 — Command/query dispatcher (CQRS-light)
- [x] T011 — Confirmation gate
- [x] T012 — Zero-LLM guarantee hook
- [x] T013 — ConfigPort interface + Config.Service adapter
- [x] T014 — Optimistic CAS
- [x] T015 — Idempotency store
- [x] T016 — Snapshots (10 or 30 days)
- [x] T017 — Cutover rollback slot
- [x] T018 — SecretPort interface
- [x] T019 — OS keychain adapter
- [x] T020 — Env-ref CI adapter
- [x] T021 — Plaintext rejection
- [x] T022 — Audit projector to EventV2
- [x] T023 — External-only outbox hook
- [x] T024 — Audit retention 90 days
- [x] T025 — Loopback HTTP routes
- [x] T026 — Operator principal bind for API
- [x] T027 — Internal SDK client
- [x] T028 — CSRF/origin note for future non-loopback
- [x] T029 — Pre-prompt slash intercept
- [x] T030 — Slash confirmation UX
- [x] T031 — Redacted slash output
- [x] T032 — `opencode op` command surface
- [x] T033 — `--json` output
- [x] T034 — CLI `--yes` policy
- [x] T035 — Palette entries from registry
- [x] T036 — Settings panels (representative domains)
- [x] T037 — Surface parity tests (TUI/CLI/API)
- [x] T038 — Domain port interfaces
- [x] T039 — Deterministic stubs
- [x] T040 — Wire representative real adapters when present
- [x] T041 — Feature flag `operator_control_plane`
- [x] T042 — Reserved-name rejection at plugin/MCP/custom registration
- [x] T043 — Migration notes for legacy admin-like names
- [x] T044 — Offline matrix enforcement
- [x] T045 — SSRF policy helper for provider URLs
- [x] T046 — OTEL content-free labels
- [x] T047 — Security test suite
- [x] T048 — Update AGENTS/operator docs for reserved catalog
- [x] T049 — Commit unit: isolation harness (message only plan)
- [x] T050 — Commit unit: core dispatcher + registry
- [x] T051 — Commit unit: persistence + secrets + audit
- [x] T052 — Commit unit: API SDK CLI TUI
- [x] T053 — Commit unit: flags migration security
- [ ] T090 — App Settings parity
- [ ] T091 — Desktop Settings parity
- [ ] T092 — Multi-user / vault / non-loopback API

---

## Group A — Isolation harness (first; prod paths unchanged)

- [x] **T001 — Create `.dev/` sandbox layout and gitignore**
- **Depends:** none
- **Paths:** `.gitignore`, `.dev/opencode-operator/` (local only)
- **Deliverable:** gitignore entries for `.dev/opencode-operator/`; document layout in quickstart
- **Acceptance:** `git check-ignore -v .dev/opencode-operator/config` matches; no commit of sandbox data
- **Verification:** unit path check; manual `git status` clean of sandbox contents
- **Evidence (2026-07-17):** `.gitignore` → `.dev/`; quickstart layout documented; `git check-ignore -v .dev/opencode-operator/config` → `.gitignore:38:.dev/`; sandbox data not tracked

- [x] **T002 — Sandbox env prefix and port constants**
- **Depends:** T001
- **Paths:** `packages/opencode/src/dev/sandbox/**`
- **Deliverable:** constants `OPENCODE_DEV_OPERATOR_`, config dir under `.dev/`, bind `127.0.0.1`, port **14096**
- **Acceptance:** helpers refuse non-loopback bind; refuse config dir under `~/.config/opencode`
- **Verification:** unit tests for path/bind guards
- **Evidence (2026-07-17):** `packages/opencode/src/dev/sandbox/{constants,env,guards,index}.ts`; port 14096 / bind 127.0.0.1; guards reject 0.0.0.0, 4096, 19876, prod config path; unit tests green
- **Review fix (2026-07-17):** realpath containment + `assertRepoSandboxLayout`; exact port match (`:40960` ≠ 4096); symlink escape tests; absolute global command forbid
- **B5 (2026-07-17):** `buildSandboxEnv` re-validates all XDG/HOME/TMP after overrides; wrapper bash realpath + sandbox containment; T004 excludes only `*.db-wal`/`*.db-shm`/`*.log` (documented); **23 sandbox tests pass**

- [x] **T003 — Local wrapper script**
- **Depends:** T002
- **Paths:** `scripts/dev/opencode-operator-sandbox*`
- **Deliverable:** wrapper sets env, logs to `.dev/.../logs/`, execs opencode subcommand
- **Acceptance:** wrapper exits non-zero if bind/config policy violated
- **Verification:** script smoke test under sandbox only
- **Evidence (2026-07-17):** `scripts/dev/opencode-operator-sandbox` executable; rejects service/register/4096/19876/non-loopback; Bun resolved before HOME isolation; local `packages/opencode/src/index.ts` only; smoke exit codes non-zero on policy violations
- **B5 (2026-07-17):** wrapper realpath `-m` on SANDBOX_ROOT/CONFIG_DIR; rejects external roots; creates `state/locks`

- [x] **T004 — Proof tests: production paths unchanged**
- **Depends:** T002, T003
- **Paths:** `packages/opencode/test/dev/sandbox/**`
- **Deliverable:** tests asserting default config path constants and prod ports unchanged without wrapper; with wrapper only `.dev/` is written
- **Acceptance:** suite green; zero files under `~/.config/opencode` created by suite
- **Verification:** `bun test` from package dir via sandbox
- **Evidence (2026-07-17):** `bun test test/dev/sandbox` from `packages/opencode` → **23 pass / 0 fail**; child import after env proves Global.Path under `.dev/opencode-operator`; prod XDG metadata snapshot (names/size/mtime, no contents) unchanged for `~/.config|share|cache|state/opencode`

---

## Group B — Schemas, principals, registry

- [x] **T005 — Principal and scope value objects**
- **Depends:** T004
- **Paths:** `packages/core/src/operator/**` or `packages/opencode/src/operator/domain/**`
- **Deliverable:** `operator` | `system` | `manager-view`; scopes global/project/session/root-tree
- **Acceptance:** invalid principal/scope rejected by schema
- **Verification:** unit tests
- **Evidence (2026-07-17):** `packages/core/src/operator/{principal,scope,capability}.ts`; closed principal/scope schemas; manager-view mutates=false; fail-closed cross-project binding; `bun test test/operator` (core) green
- **Review fix (2026-07-17):** project-bound principal **cannot** global; session/root-tree require matching `projectContext.projectId`; fail closed if missing

- [x] **T006 — Command ID schema (dotted)**
- **Depends:** T005
- **[P]** with T007 after T005
- **Paths:** operator domain schemas
- **Deliverable:** dotted ID validator `domain.operation` (+ nested)
- **Acceptance:** reject spaces, empty segments, reserved collisions at parse when catalog present
- **Verification:** unit tests
- **Evidence (2026-07-17):** `packages/core/src/operator/command-id.ts`; branded `CommandId`; rejects spaces/empty/ambiguous segments; normalizes case; unit tests green

- [x] **T007 — Reserved operator ID catalog (versioned)**
- **Depends:** T005
- **[P]** with T006
- **Paths:** schema/SDK export path for reserved catalog
- **Deliverable:** versioned catalog document + code export for all Phase 1 domains
- **Acceptance:** catalog version field present; lists telemetry/smart/routing/budget/pools/process/task/jobs/langlock/output/semantic/mcp IDs
- **Verification:** unit snapshot of catalog version
- **Evidence (2026-07-17):** `packages/core/src/operator/catalog.ts`; version `1.0.0`; 12 domains; 114 reserved IDs (no duplicates); semantic/mcp exhaustive; `@opencode-ai/core/operator` export; snapshot unit test green

- [x] **T008 — OperatorCommandRegistry**
- **Depends:** T006, T007
- **Paths:** `packages/opencode/src/operator/application/**`
- **Deliverable:** register/lookup descriptors; generate slash/CLI/palette aliases
- **Acceptance:** same command ID yields stable aliases; dual register of same ID fails
- **Verification:** unit tests
- **Evidence (2026-07-17):** `packages/opencode/src/operator/application/registry.ts`; seed reserved catalog; stable `/op.<id>` + CLI aliases; dual-register conflict; plugin/mcp/custom reserved_name; instance-scoped (no global singleton); unit tests green

- [x] **T009 — Error taxonomy module**
- **Depends:** T005
- **[P]** with T006–T008 after T005
- **Paths:** operator domain errors
- **Deliverable:** closed error codes from contracts/command-envelope.md
- **Acceptance:** no free-string error codes in dispatcher path
- **Verification:** unit tests
- **Evidence (2026-07-17):** `packages/core/src/operator/error.ts`; closed `ERROR_CODES` + HTTP map; redaction helpers; free-string codes rejected; unit tests green

---

## Group C — Dispatcher

- [x] **T010 — Command/query dispatcher (CQRS-light)**
- **Depends:** T008, T009
- **Paths:** `packages/opencode/src/operator/application/**`
- **Deliverable:** validate → auth → scope → confirm → execute port → result envelope
- **Acceptance:** unknown ID → `invalid_argument`; manager-view mutation → unauthorized/forbidden
- **Verification:** unit tests with port fakes
- **Evidence (2026-07-17):** `packages/opencode/src/operator/application/dispatcher.ts` + `handler.ts`; pipeline validate→auth→scope→confirm→handler; manager-view mutation unauthorized; wrong scope forbidden_scope; default not_implemented; unit tests green
- **B2 (2026-07-17):** typed `HandlerResult` = `query` | `mutation_plan` | `failure`; dispatcher executes plans only via `mutateAuthority`; illegal admin success rejected; tests success/replay/conflict

- [x] **T011 — Confirmation gate**
- **Depends:** T010
- **Paths:** application confirmation
- **Deliverable:** enforce confirm for cutover/rollback/delete/disable/purge/rotate-secret/experimental enable/export/share
- **Acceptance:** missing confirm → `confirmation_required`; slash path never auto-yes
- **Verification:** unit tests
- **Evidence (2026-07-17):** `packages/core/src/operator/confirmation.ts` + `packages/opencode/src/operator/application/confirmation.ts`; slash never auto-yes; CLI TTY rejects confirm; non-TTY/API confirm allowed; metadata source/TTY/operator; unit tests green

- [x] **T012 — Zero-LLM guarantee hook**
- **Depends:** T010
- **Paths:** dispatcher + test doubles
- **Deliverable:** admin path records zero provider calls; test asserts no LLM port invoked
- **Acceptance:** AC2-style unit proof for sample admin commands
- **Verification:** unit tests
- **Evidence (2026-07-17):** `packages/opencode/src/operator/application/zero-llm.ts`; static import scan on dispatcher/registry/core operator; runtime probe; admin result kind=`operator.admin_result` never transcript; sample admin commands zero provider; unit tests green

---

## Group D — Config persistence, CAS, idempotency, snapshots

- [x] **T013 — ConfigPort interface + Config.Service adapter**
- **Depends:** T010
- **Paths:** `packages/opencode/src/operator/adapters/outbound/**`
- **Deliverable:** port maps to existing Config.Service only
- **Acceptance:** no second config store module introduced
- **Verification:** integration under sandbox
- **Evidence (2026-07-17):** `application/ports/config-port.ts`; `adapters/outbound/config-service.ts` maps get/update/getGlobal/updateGlobal; durable operator namespace under Config.Service
- **Fourth review (2026-07-17):** **document lock** `${projectKey}:operator` for ALL authorities/idempotency/rollback; two-process **different authorities** + sibling keys no lost updates; `createLiveConfigServiceLike` wraps real Config.Service Effect API; composition `mode: live|sandbox|test`

- [x] **T014 — Optimistic CAS**
- **Depends:** T013
- **Paths:** application + config adapter
- **Deliverable:** version token on mutations; conflict → `conflict`
- **Acceptance:** concurrent write simulation yields one success one conflict
- **Verification:** unit + integration
- **Evidence (2026-07-17):** multi-adapter + two-process same-version + different-authority Flock proofs green

- [x] **T015 — Idempotency store**
- **Depends:** T013
- **Paths:** outbound adapter + schema if needed
- **Deliverable:** `(principal, commandId, key)` → prior result
- **Acceptance:** replay returns `idempotent_replay` / same body
- **Verification:** integration under sandbox
- **Evidence (2026-07-17):** durable claim under **document** Flock; replay/conflict tests green

- [x] **T016 — Snapshots (10 or 30 days)**
- **Depends:** T013
- **Paths:** snapshot adapter
- **Deliverable:** retain max 10 snapshots or 30 days; prune job/hook
- **Acceptance:** 11th snapshot drops oldest; aged entries pruned
- **Verification:** unit + integration
- **Evidence (2026-07-17):** durable snapshots with **full payload** under authority; max 10 / 30d prune on capture; unit tests green

- [x] **T017 — Cutover rollback slot**
- **Depends:** T014, T016
- **Paths:** application + data model
- **Deliverable:** store previous binding version on cutover; `rollback` restores
- **Acceptance:** rollback without slot → structured error; with slot → prior version
- **Verification:** unit + integration with semantic port stub
- **Evidence (2026-07-17):** durable rollback stores **previousPayload** (full); rollback restores full payload not token marker; without slot → unavailable; unit tests green

---

## Group E — Secrets

- [x] **T018 — SecretPort interface**
- **Depends:** T010
- **[P]** with Group D after T010
- **Paths:** application ports
- **Deliverable:** put/get/rotate ref API; never returns plaintext to audit layer
- **Acceptance:** interface forbids string secret in CommandResult
- **Verification:** unit type/contract tests
- **Evidence (2026-07-17):** `SecretPort` + core `SecretRef`; put/get/rotate return refs; `resolveMaterial` → `__redacted__` only

- [x] **T019 — OS keychain adapter**
- **Depends:** T018
- **Paths:** outbound keychain adapter
- **Deliverable:** platform keychain integration for stored secrets
- **Acceptance:** secret material absent from config JSON dump
- **Verification:** integration (platform-specific skip if unavailable with explicit unavailable)
- **Evidence (2026-07-17 security polish):** H1 unique account (`oc.<digest>.vN.<nonce>`) + concurrent two-writer asserts meta current account exists and internal material matches that account; H2 length bounds before copy; H3 Bun `read.ptr` only — fail closed null on throw (no bigint view fallback); M1 CFRelease after delete; M2 attributes-only exists; M3 namespace; M4 live durable Config/Flock/projectKey

- [x] **T020 — Env-ref CI adapter**
- **Depends:** T018
- **[P]** with T019
- **Paths:** outbound env-ref adapter
- **Deliverable:** resolve env name refs for CI only
- **Acceptance:** missing env → `secret_backend` / unavailable; no value logged
- **Verification:** unit tests
- **Evidence (2026-07-17):** `createEnvRefSecretPort`; missing → `secret_backend`; resolve never returns env value

- [x] **T021 — Plaintext rejection**
- **Depends:** T018
- **Paths:** validation in dispatcher/adapters
- **Deliverable:** reject payloads that embed raw secrets in known secret fields
- **Acceptance:** structured `invalid_argument` or `secret_backend`
- **Verification:** unit tests
- **Evidence (2026-07-17):** exact SecretRef only (no extra keys); broader credential/token aliases; recursive cycle-safe depth/size bounded; dispatcher rejects; unit tests green

---

## Group F — EventV2 audit and outbox

- [x] **T022 — Audit projector to EventV2**
- **Depends:** T010, T013
- **Paths:** outbound EventV2 adapter
- **Deliverable:** source, actor, scope, commandId, before/after version hashes, outcome
- **Acceptance:** audit record secret-free; fields match FR17
- **Verification:** integration
- **Evidence (fourth review):** `createLiveEventV2AuditPort` + Effect EventV2 surface; live `requireAudit` fail-closed; secrets not void in composition; memory port tests-only

- [x] **T023 — External-only outbox hook**
- **Depends:** T022
- **Paths:** application outbox port
- **Deliverable:** outbox used only for external systems; local config/event no dual write queue required
- **Acceptance:** unit proves local mutation does not require outbox for success
- **Verification:** unit tests
- **Evidence (2026-07-17):** `prepareExternal` **before** mutation; fail prepare → config unchanged; `requiredForLocalMutation() === false`

- [x] **T024 — Audit retention 90 days**
- **Depends:** T022
- **Paths:** retention policy hook; EventV2 live audit adapter; Config+Flock atomic auditOutbox; maintenance lifecycle
- **Deliverable:** 90-day audit retention + durable outbox reconcile + production maintenance
- **Acceptance:** policy constant = 90 days; bounded history; atomic intent; prune SQL; maintenance dispose/Flock
- **Verification:** unit + multi-process sandbox + real SQLite EventV2
- **Evidence (2026-07-17 independent review close):**
  - Bounded `readDurablePage` list (no infinite stream); hard limit + maxScan **fail-closed** (`listAuditsResult` ok:false)
  - Atomic CAS+auditIntent (main **and rollback** paths); post-commit failpoint + multi-process crash reclaim → single reconcile to real SQLite
  - Full-record stable `evt_opaudit_*` id; duplicate same data ok, different data fails
  - `pruneDurable` SQL: aggregate + `operator.audit.*` + `json_extract(data,'$.createdAtMs') < cutoff` + RETURNING count; invalid inputs fail (not silent 0); core unit + opencode SQLite integration
  - Maintenance: startup + unref timer + dispose; Flock single-run; coalesce; defaults 60s reconcile / daily prune; **typed `failed`/`error`/`onError`** (content-free) — no silent zero
  - Claim max-attempts → `dead_letter` status increments `deadLetter` metric; malformed dead-letter retained off pending
  - `createDurableAuditOutboxPort` de-exported (non-atomic parallel path); live uses `store.outbox` only
  - `createMemoryConfigPort` TEST-ONLY with atomic auditIntent capture; not used by live stack
  - Suites: opencode operator **236** pass / dev **23**; core event+operator **102**; schema **15**; sdk typecheck+build clean; sandbox/XDG only
  - Speckit status/guard/validate: pre-existing README/AGENTS findings only (not T024 regressions)

---

## Group G — Internal loopback API and SDK

- [x] **T025 — Loopback HTTP routes**
- **Depends:** T010, T014, T022
- **Paths:** `packages/server/**/operator/**`, opencode server routes
- **Deliverable:** `POST /operator/v1/commands`, `GET /operator/v1/registry`, health
- **Acceptance:** bind loopback only in sandbox (14096); unauthenticated mutation denied
- **Verification:** integration httpapi tests under sandbox
- **Evidence (authority-split):**
  - **Test stack:** `createTestOperatorStack` (memory Config/Event) — tests only
  - **Live stack:** `createLiveOperatorStack` / `getOrCreateLiveOperatorStack` — real Config.Service + EventV2Bridge + Flock under `Global.Path.state/operator-locks`; `requireAudit=true`
  - **External TCP:** `Server.listen` → `tryCreateOperatorHttpFetch` (LIVE unless `testStack`) under `OPENCODE_OPERATOR_HTTP=1` + loopback
  - **Internal worker:** `rpc.operatorFetch` + `handleWorkerOperatorFetch` injects principal/project from RPC closure (no spoofable headers)
  - **Local TUI:** `wireLocalOperatorSlashPort({ directory })` → live worker stack
  - Host/XFF never authority; body principal rejected; T019+T024 complete

- [x] **T026 — Operator principal bind for API**
- **Depends:** T025
- **Paths:** server auth middleware for operator
- **Deliverable:** local operator principal; LLM/subagent without principal denied
- **Acceptance:** AC8-style deny without credentials
- **Verification:** security integration tests
- **Evidence (review-fix):** Basic/`OPENCODE_SERVER_PASSWORD` + sandbox token; no password ⇒ deny; body principal rejected; projectBinding from Instance context only; cross-project 403; constant-time compare

- [x] **T027 — Internal SDK client**
- **Depends:** T025, T007
- **Paths:** `packages/sdk/**/operator/**`, `packages/sdk-next/**/operator/**`, client gen if required
- **Deliverable:** typed client + reserved catalog export
- **Acceptance:** client calls same command IDs as CLI
- **Verification:** contract tests
- **Evidence (review-fix):** `@opencode-ai/sdk/operator` export; catalog module points to core (no duplicate ID list); registry parity test `ids.length === listReservedIds().length`

- [x] **T028 — CSRF/origin note for future non-loopback**
- **Depends:** T025
- **Paths:** docs + guard comment in server bind
- **Deliverable:** code comment + plan/spec already state CSRF mandatory if non-loopback
- **Acceptance:** no non-loopback bind path in V1 code
- **Verification:** static grep / unit bind policy test
- **Evidence (review-fix):** `assertOperatorBind` on mount; missing Origin allowed only because mount is loopback-only (documented); non-loopback Origin rejected; operator never mounts on non-loopback listen

---

## Group H — Native slash interception

- [x] **T029 — Pre-prompt slash intercept**
- **Depends:** T010, T011, T022
- **Paths:** TUI/session prompt path hooks (narrow operator intercept only)
- **Deliverable:** `/op.*` intercepted before prompt admission/transcript
- **Acceptance:** no Message/Part created; zero LLM calls
- **Verification:** unit + integration
- **Evidence (2026-07-17 worker RPC):** Local `tui.ts` injects `wireOperatorSlashForTui({ mode:"local", directory, operatorFetch: client.call("operatorFetch") })` — no parent live stack. Worker `rpc.operatorFetch` → `handleWorkerOperatorFetch` → live stack. Attach uses remote HTTP/SDK. Shell intercept all modes. SessionId preserved on DialogConfirm re-try. Tests: worker RPC path, no operatorFetch throws, session confirm E2E.

- [x] **T030 — Slash confirmation UX**
- **Depends:** T029
- **Paths:** TUI slash handler
- **Deliverable:** interactive confirm for listed ops; never auto-yes
- **Acceptance:** cancel leaves config unchanged
- **Verification:** unit tests
- **Evidence (2026-07-17 runtime fix):** DialogConfirm wired; host-port confirm/cancel integration test; single-use+TTL; version-bound tokens; never `--yes`.

- [x] **T031 — Redacted slash output**
- **Depends:** T029
- **Paths:** outbound display mapper
- **Deliverable:** redacted human output; no transcript injection
- **Acceptance:** secret refs not expanded
- **Verification:** unit tests
- **Evidence (2026-07-17 runtime fix):** Bounded depth/size; PEM/JWT/entropy/credential redaction; SecretRef only; injectTranscript=false; audit_pending distinct.

---

## Group I — CLI human + JSON

- [x] **T032 — `opencode op` command surface**
- **Depends:** T010, T022
- **Paths:** `packages/opencode/src/cli/cmd/op.ts`, `packages/opencode/src/operator/adapters/inbound/cli*.ts`
- **Deliverable:** `opencode op <domain> <op>` human default; dotted id form; live stack
- **Acceptance:** exit codes map error taxonomy; offline status works
- **Verification:** e2e under sandbox wrapper
- **Evidence (2026-07-17):** Grammar `op <domain> <op> [qualifiers…]` + `op <canonical.dotted.id>`; registry resolve only; same `getOrCreateLiveOperatorStack` as slash/HTTP; descriptor-aware scope; mutations require `--expected-version` + `--idempotency-key`; sandbox e2e `langlock status --json` → not_implemented exit 51
- **Review fixes (2026-07-17):** shared `isOperatorDevSandbox()` (`OPENCODE_DEV_OPERATOR_=1`) for CLI/worker/HTTP keychain; payload ≤256KiB + depth 12 parity HTTP; create sentinel `--expected-version=-`; recursive `findPlaintextSecretFields`; V1 local process owner = operator (no principal flag)

- [x] **T033 — `--json` output**
- **Depends:** T032
- **Paths:** `packages/opencode/src/operator/adapters/inbound/cli-output.ts`
- **Deliverable:** machine JSON matching command envelope
- **Acceptance:** `unavailable` distinct from auth/argument/transport; audit_pending=202
- **Verification:** e2e
- **Evidence (2026-07-17):** Typed envelope stdout-only; diagnostics stderr; exit map (0/202/40–55); SecretRef-only redaction; unit tests green

- [x] **T034 — CLI `--yes` policy**
- **Depends:** T032, T011
- **Paths:** `packages/opencode/src/operator/adapters/inbound/cli.ts` + confirmation gate
- **Deliverable:** `--yes` only when non-TTY and authenticated; reject otherwise
- **Acceptance:** TTY + `--yes` on cutover → error; non-TTY auth OK; TTY interactive confirm; cancel no mutation
- **Verification:** unit + e2e
- **Evidence (2026-07-17):** TTY rejects `--yes`; non-TTY auth OK; interactive confirm via `@clack/prompts`; `cliInteractiveConfirmed` single execution; noninteractive without `--yes` → confirmation_required exit 44; unit matrix green; unauth `--yes` branch test-only (`testOnly: true`)

---

## Group J — TUI Settings / palette

- [x] **T035 — Palette entries from registry**
- **Depends:** T008, T010, T022
- **Paths:** `packages/tui/src/**/operator/**` or palette integration path
- **Deliverable:** palette invokes same command IDs
- **Acceptance:** parity with CLI for `langlock.status` sample
- **Verification:** unit + integration
- **Evidence (2026-07-17 final):** version+idempotencyKey honored on in-process/RPC/HTTP; preflightMutation required for mutations; secrets = mutating ops only (mcp.auth.status ok); Settings secret rows visible warning selectable; suggested safe status only

- [x] **T036 — Settings panels (representative domains)**
- **Depends:** T035, T013
- **Paths:** `packages/tui/src/**/settings/**`
- **Deliverable:** Settings for telemetry/smart/langlock/semantic binding status (representative)
- **Acceptance:** mutations go through dispatcher; audit emitted
- **Verification:** integration under sandbox
- **Evidence (2026-07-17 final):** Config-backed status; secret rows visible T019 warning (never port); preflight always; `/operator/v1/preflight` on worker/HTTP

- [x] **T037 — Surface parity tests (TUI/CLI/API)**
- **Depends:** T025, T032, T035
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** same command ID → same version/audit semantics across three surfaces
- **Acceptance:** AC1 proof for at least one query and one mutation
- **Verification:** integration/e2e
- **Evidence (2026-07-17 final):** mutation-parity.test.ts telemetry.on create/replay/conflict; CLI+HTTP preflight; live OPENCODE_OPERATOR_LIVE_BOOT=1 hard-pass recorded

---

## Group K — Domain ports and stubs (representative)

- [x] **T038 — Domain port interfaces**
- **Depends:** T010
- **[P]** after T010; may run in parallel with Groups D–J when path sets do not overlap
- **Paths:** application/ports
- **Deliverable:** ports for telemetry, smart, routing, budget, pools, process, task, jobs, langlock, output, semantic, mcp admin
- **Acceptance:** no direct domain package imports in application
- **Verification:** architecture unit / import lint if available
- **Evidence (2026-07-17):** `application/ports/domain-ports.ts` — 12 domain ports; no mcp/provider imports in application; unit lint test

- [x] **T039 — Deterministic stubs**
- **Depends:** T038
- **Paths:** outbound stubs
- **Deliverable:** stubs return `not_implemented` or fixture `unavailable` without fake business success
- **Acceptance:** stub never claims cutover success without real domain
- **Verification:** unit tests
- **Evidence (2026-07-17):** `domain-stubs.ts`; cutover → not_implemented; test/connect → unavailable; dispatcher samples all domains

- [x] **T040 — Wire representative real adapters when present**
- **Depends:** T038, T013
- **Paths:** outbound adapters
- **Deliverable:** prefer real Config-backed status for langlock/telemetry if modules exist; else stub
- **Acceptance:** documented mapping table in code comments
- **Verification:** integration
- **Evidence (2026-07-17 final review):** `stack-live` + `main` call `handlersFromDomainPorts(domainPorts,{config:store.config})`; Config-backed `langlock.status`/`telemetry.status` return query `configured`/`version` (not stub); mapping in `config-status.ts` + `domain-stubs.ts`

---

## Group L — Reserved names, migrations, feature flags

- [x] **T041 — Feature flag `operator_control_plane`**
- **Depends:** T010
- **Paths:** flag module + config + HTTP mount
- **Deliverable:** default off until harness+dispatcher green; rollout stages per plan
- **Acceptance:** flag off → adapters no-op without breaking non-admin customs
- **Verification:** unit + integration
- **Evidence (2026-07-17 final review + runtime gap close):** loopback bind mounts always; **per-request** `resolveFeatureEnabled()` from real Config (no frozen gate); enable→health/registry and disable→404 same process; non-loopback never mounts. **R2 production Node path:** `Server.listen` installs emit intercept on Node `http.Server` so `/operator/v1` is served with **request-scoped** `IncomingMessage.socket.remoteAddress` via ALS (`runWithOperatorClientIp`) — never invents 127.0.0.1; missing IP fail-closed. Live TCP test on `127.0.0.1:14096`. CAS `applied.rollbackSlot/clearRollback` skips redundant post-CAS dual-write.

- [x] **T042 — Reserved-name rejection at plugin/MCP/custom registration**
- **Depends:** T007, T041
- **Paths:** registration hooks (narrow)
- **Deliverable:** collision → `reserved_name`; config unchanged
- **Acceptance:** AC3 / AC16
- **Verification:** unit + integration
- **Evidence (2026-07-17 residual):** CommandV2 Effect transform collision test (`ReservedNameError` + catalog version); ToolRegistry/MCP external paths; builtin task/mcp skipped

- [x] **T043 — Migration notes for legacy admin-like names**
- **Depends:** T042
- **Paths:** docs + migration script if required
- **Deliverable:** reject/reserve colliding legacy names; leave non-colliding customs
- **Acceptance:** documented sequence in plan/spec; dry-run path
- **Verification:** unit tests on name classifier
- **Evidence (2026-07-17 review fix):** narrow classifier (exact set + `*-admin` boundary only; no mid-string admin false positives); `op migrate dry-run` CLI; `migration-legacy-admin-names.md`; autoRename/autoDelete false

---

## Group M — Security, SSRF, offline, OTEL

- [x] **T044 — Offline matrix enforcement**
- **Depends:** T010, T038
- **Paths:** dispatcher + descriptors
- **Deliverable:** offlineCapable flags; network ops → `unavailable` when offline
- **Acceptance:** Q10 matrix behaviors for status vs validate
- **Verification:** unit tests
- **Evidence (2026-07-17 review fix):** `resolveConnectivity` from OPENCODE_CONNECTIVITY/OPENCODE_OFFLINE/`experimental.offline`; live stack passes connectivity into dispatcher; status/show/list stay local

- [x] **T045 — SSRF policy helper for provider URLs**
- **Depends:** T038
- **Paths:** shared security helper used by semantic port adapter
- **Deliverable:** parse, resolve, revalidate; deny metadata/private without local allowance
- **Acceptance:** AC33-style rejects
- **Verification:** unit + security tests
- **Evidence (2026-07-17 residual):** production `createProductionDnsResolver` (node:dns lookup all+verbatim, fail-closed); live stack injects it; semantic/mcp add/test/update require URL + validate before stub; tests mock lookup

- [x] **T046 — OTEL content-free labels**
- **Depends:** T022
- **Paths:** operator telemetry hooks
- **Deliverable:** command id/source/scope/outcome/duration only; cardinality-safe
- **Acceptance:** no secret/path/content labels
- **Verification:** unit assert label keys
- **Evidence (2026-07-17 residual):** live recorder wires `@opentelemetry/api` tracer when present (harmless if absent); injected tracer once-per-dispatch test; allowlist only

- [x] **T047 — Security test suite**
- **Depends:** T026, T042, T021, T045
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** unauth API, reserved name, secret redaction, SSRF cases
- **Acceptance:** all security cases green under sandbox
- **Verification:** `bun test` package dir
- **Evidence (2026-07-17 residual):** core operator 57 + CommandV2 reserved Effect + config migrate; opencode operator 208 + sandbox 23; typechecks clean

---

## Group N — Docs, commits (documentary placeholders; no commit now)

- [x] **T048 — Update AGENTS/operator docs for reserved catalog**
- **Depends:** T007, T027
- **Paths:** docs only under allowed globs / feature docs
- **Deliverable:** integrator note for reserved IDs versioning
- **Acceptance:** link from feature research/spec
- **Verification:** markdown link check
- **Evidence (2026-07-17):** `reserved-catalog-v1.md` (v1.0.0 / 114 IDs, surfaces, flag, scopes, offline/SSRF, keychain mock-only, EventV2 90d + audit_pending + bounded fail-closed, errors, Phase2 T090–T092); `quickstart.md` runbook; migration/contracts/research/spec/plan links; root + packages/opencode AGENTS operator governance (ports/adapters only; never LLM/MCP/plugin admin); arch stubs filled (observability/quality/threat-model/functional/runbooks) without App/Desktop/multi-user Phase1 claims; prettier clean on touched md; relative link check 49/0 missing; `speckit validate --changed` → 0 findings; `speckit status` completeness ok; no application code changes in T048

- [x] **T049 — Commit unit: isolation harness (message only plan)**
- **Depends:** T001–T004
- **Paths:** `.gitignore`, `scripts/dev/opencode-operator-sandbox*`, `packages/opencode/src/dev/sandbox/**`, `packages/opencode/test/dev/sandbox/**`, `quickstart.md`, `packages/opencode/src/operator/dev-env.ts`
- **Deliverable:** `test(operator): add isolated development harness`
- **Acceptance:** committed on Feature 007 branch
- **Verification:** `git show --stat 63ff3168b`
- **Evidence (2026-07-17):** commit `63ff3168b` — `test(operator): add isolated development harness` (12 files; sandbox wrapper port 14096, `.dev/` gitignore, proof tests)

- [x] **T050 — Commit unit: core dispatcher + registry**
- **Depends:** T005–T012
- **Deliverable:** `feat(operator): add command registry and dispatcher`
- **Acceptance:** committed on Feature 007 branch
- **Verification:** `git show --stat f5b8abd50`
- **Evidence (2026-07-17):** commit `f5b8abd50` — `feat(operator): add command registry and dispatcher` (38 files; core VOs/catalog/errors + registry/dispatcher/confirmation/zero-LLM)

- [x] **T051 — Commit unit: persistence + secrets + audit**
- **Depends:** T013–T024
- **Deliverable:** `feat(operator): add durable config secrets and audit`
- **Acceptance:** committed on Feature 007 branch
- **Verification:** `git show --stat 1be08c74a`
- **Evidence (2026-07-17):** commit `1be08c74a` — `feat(operator): add durable config secrets and audit` (44 files; CAS/flock/idempotency/snapshots/rollback/keychain/EventV2/outbox/retention)

- [x] **T052 — Commit unit: API SDK CLI TUI**
- **Depends:** T025–T037
- **Deliverable:** `feat(operator): add native API SDK CLI and TUI adapters`
- **Acceptance:** committed on Feature 007 branch
- **Verification:** `git show --stat 470e579a1`
- **Evidence (2026-07-17):** commit `470e579a1` — `feat(operator): add native API SDK CLI and TUI adapters` (47 files; loopback HTTP/SDK/CLI/TUI slash/palette/settings + parity tests)

- [x] **T053 — Commit unit: flags migration security**
- **Depends:** T041–T047
- **Deliverable:** `feat(operator): add flags reserved names and security hardening`
- **Acceptance:** committed on Feature 007 branch (this commit)
- **Verification:** `git log -1 --oneline` after T053
- **Evidence (2026-07-17):** commit message `feat(operator): add flags reserved names and security hardening` — flags Config V1/V2, reserved plugin/MCP/custom, offline/SSRF/OTEL/security tests, docs/ADR/spec/plan/tasks/AGENTS/speckit.toml + composition root

---

## Group O — Phase 2 deferred (explicit; do not start in Phase 1)

- [ ] **T090 — App Settings parity**
- **Depends:** Phase 1 complete (T037+)
- **Deliverable:** App invokes same command IDs
- **Acceptance:** deferred

- [ ] **T091 — Desktop Settings parity**
- **Depends:** T090
- **Deliverable:** Desktop parity
- **Acceptance:** deferred

- [ ] **T092 — Multi-user / vault / non-loopback API**
- **Depends:** new ADR
- **Deliverable:** out of Feature 007 V1
- **Acceptance:** deferred

---

## Dependencies summary

```
T001 → T002 → T003 → T004
T004 → T005 → (T006 ∥ T007 ∥ T009) → T008 → T010
T010 → T011, T012
T010 → T013 → (T014 ∥ T015 ∥ T016) → T017
T010 → T018 → (T019 ∥ T020) → T021
T010+T013 → T022 → (T023 ∥ T024)
T010+T014+T022 → T025 → T026 → T027
T010+T011+T022 → T029 → T030, T031
T010+T022 → T032 → T033, T034
T008+T010+T022 → T035 → T036
T025+T032+T035 → T037
T010 → T038 → T039, T040
T010 → T041 → T042 → T043
T010+T038 → T044
T038 → T045
T022 → T046
T026+T042+T021+T045 → T047
```

## Parallelism rules

- Only tasks marked `[P]` may run concurrently, and only when path sets do not overlap.
- Never parallelize two tasks writing the same package module tree.
- Isolation group A is strictly serial before all implementation groups.

## Task counts

| Group                        | Tasks              | Phase                          |
| ---------------------------- | ------------------ | ------------------------------ |
| A Isolation                  | T001–T004 (4)      | 1                              |
| B Schemas/registry           | T005–T009 (5)      | 1                              |
| C Dispatcher                 | T010–T012 (3)      | 1                              |
| D Config/CAS                 | T013–T017 (5)      | 1                              |
| E Secrets                    | T018–T021 (4)      | 1                              |
| F Audit                      | T022–T024 (3)      | 1                              |
| G API/SDK                    | T025–T028 (4)      | 1                              |
| H Slash                      | T029–T031 (3)      | 1                              |
| I CLI                        | T032–T034 (3)      | 1                              |
| J TUI                        | T035–T037 (3)      | 1                              |
| K Domain ports               | T038–T040 (3)      | 1                              |
| L Flags/migration            | T041–T043 (3)      | 1                              |
| M Security/OTEL              | T044–T047 (4)      | 1                              |
| N Docs/commits               | T048–T053 (6)      | 1 (docs; commits planned only) |
| O Phase 2 deferred           | T090–T092 (3)      | 2                              |
| **Total Phase 1 actionable** | **T001–T053 (53)** |                                |
| **Deferred**                 | **3**              |                                |

## Definition of done (Phase 1)

- All T001–T047 acceptance checks green under sandbox wrapper
- No writes to `~/.config/opencode` in tests
- ADR-0003 remains accepted; no parallel config/event store
- App/Desktop not claimed complete
- `speckit validate` green on feature artifacts before each planned commit
