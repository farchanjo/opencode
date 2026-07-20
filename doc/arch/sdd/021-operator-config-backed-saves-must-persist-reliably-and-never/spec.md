---
id: 019f7ea7-6075-7173-9734-554e3d10f494
number: 021
slug: operator-config-backed-saves-must-persist-reliably-and-never
status: analyzed
created_at: 2026-07-20T08:32:06.262676Z
---
# Feature Specification: Operator Config Backed Saves Must Persist Reliably And Never Silently Zero

Feature: 021-operator-config-backed-saves-must-persist-reliably-and-never
Created: 2026-07-20
Scope: An operator config-backed save (the reproduced case is a role→model pool
`pools.set`) can fail to persist and re-open **empty** ("fica zerado") whenever
the mutation **preflight resolves the wrong Config authority**. `pools.set`
commits to the shared `"routing"` authority (`PROJECT_AUTHORITY`,
`packages/opencode/src/operator/pools/backend-live.ts:44`), but the **degraded
fallback** `authorityKeyForCommandId`
(`packages/opencode/src/operator/adapters/outbound/config-status.ts:10-13`)
returns the command-id **prefix** `"pools"` — an authority never written. Reading
a virgin authority yields `currentVersion=null`/`configured=false`, so no CAS
token is threaded; the second `pools.set` (and any `pools.set` on a config that
already holds a routing document) then hits the hard guard
`mutations require version (CAS token) when authority already exists`
(`packages/opencode/src/operator/application/mutation.ts:224-233`) and commits
nothing. This feature makes the **degraded fallback correct-by-construction** —
it consults the SAME domain command→authority source of truth as the wired
`createOperatorAuthorityResolver`
(`packages/opencode/src/operator/application/command-authority.ts:76-116`,
ADR-0017 fix-round) — so a config-backed save resolves the authority it actually
commits to even on a path that did not thread the full resolver; it **preserves**
the optimistic-concurrency (CAS) guard rather than weakening it; and it locks the
production wiring + user-visible-failure invariants behind regression proof for
the exact reproduced scenarios. Behavior contract only — no operator payload,
command id, catalog version, or dispatch path changes.

## Audit result (grounding — every anchor verified 2026-07-20)

An enumeration of every **production** (non-test) operator preflight/mutation
entrypoint establishes what is and is not a real gap, so this spec claims neither
more nor less than the codebase warrants:

- **Prong B — production wiring: NO gap at HEAD.** Every production entrypoint
  that performs (or forwards) a mutation preflight threads the real resolver
  `createOperatorAuthorityResolver` (`stack-live.ts:836-840,864`,
  `LiveOperatorStack.resolveAuthority`):
  - **Local TUI (parent):** `createWorkerRpcSlashPort`
    (`adapters/inbound/rpc-slash-port.ts:151-205`) forwards preflight over trusted
    worker RPC to `handleWorkerOperatorFetch` → `createTrustedWorkerOperatorFetch`
    → `createOperatorHttpHandler({ resolveAuthority: stack.resolveAuthority })`
    (`worker-adapter.ts:49`).
  - **Worker in-process slash port:** `createWorkerLocalSlashPort`
    (`worker-adapter.ts:72-74`) passes `resolveAuthority: stack.resolveAuthority`
    into `createTuiOperatorSlashPort`.
  - **HTTP server mount (remote/attach):** `createHttpOperatorSlashPort`
    (`adapters/inbound/http-slash-port.ts`) forwards preflight to
    `/operator/v1/preflight`, served by `createOperatorHttpHandler` with
    `resolveAuthority: stack.resolveAuthority` on BOTH the production and test
    branches of the mount (`http/mount.ts:88,149`); the handler resolves at
    `http/handler.ts:228`.
  - **CLI (`opencode op …`):** `op.ts:146-152` dispatches through the live stack
    and threads an explicit `--version`/`expectedVersion`; it does not use the
    naive fallback.
  So the user's field failure ("fica zerado") is a **stale binary** predating the
  ADR-0017 resolver wiring (`stack-live.ts:836`) OR a build/port that omitted it —
  NOT a defect in current HEAD's wiring. This spec does NOT invent a wiring gap
  that isn't there; FR-B is a **wiring invariant + regression guard**, not a fix.

- **Prong A — the degraded fallback IS incorrect (the real, substantive fix).**
  `authorityKeyForCommandId` (`config-status.ts:10-13`) and the inline
  `commandId.split(".")[0]` fallbacks (`http/handler.ts:229`,
  `http-slash-port.ts:216`, `rpc-slash-port.ts:196`, `tui-port.ts:114`) return the
  id **prefix**, which is the WRONG authority for every command whose commit
  authority ≠ its prefix (enumerated below). They are only reached when
  `resolveAuthority` is absent OR returns `null` — but that is exactly the
  stale-binary / mis-wired-port failure mode, and a latent hazard for any future
  port. The fix hardens the fallback so it resolves `pools.set → "routing"`
  correctly by construction.

- **Prong D — a rejected mutation IS surfaced at HEAD (non-regression, not a
  fix).** `executeOperatorCommand` (`packages/tui/src/operator/execute.ts`)
  returns the typed `outcome`/`display` for a rejected mutation; the operator
  form save handlers render it **in-modal** via `setError(failureReason(result))`
  and keep the modal open (`edit-modal.tsx:113-119`,
  `multi-field-modal.tsx:289-295`; `failureReason` prefers the typed
  `display.message`, `edit-modal.tsx:58-60`), and the slash/CLI path toasts it
  (`execute.ts:205,218`). The `silent:true` form path suppresses only the toast,
  never the in-modal error. So a rejected `pools.set` does not silently present as
  success — the modal shows *why*. FR-D LOCKS this: it must never regress into
  silent zeroing or a false success.

- **Prong D residual — the honest "fica zerado" mechanism.** The failed write
  persists nothing; the form's subsequent silent read
  (`multi-field-modal.tsx:166-177`) seeds fields from an authority that has no
  `pools` document, so the pool renders empty on re-open. The error WAS surfaced
  at save time; the empty re-read is the downstream symptom of the un-persisted
  write — which FR-A eliminates at the root.

### Mismatched commands (commit authority ≠ id prefix — degraded-fallback hazards)

| Command domain | Prefix (naive fallback) | Real commit authority | Correct in fallback? |
|---|---|---|---|
| `pools.*` | `pools` | `routing` (`pools/backend-live.ts:44`) | ❌ (the reproduced bug) |
| `telemetry.*` | `telemetry` | `global:telemetry` (`telemetry/backend-live.ts:47`) | ❌ |
| `smart.*` | `smart` | `global:routing` (global) / `routing` (project) (`smart/backend-live.ts:40-43`) | ❌ (project also ≠ prefix) |
| `budget.*` | `budget` | `global:routing` / `routing` (`budget/backend-live.ts:65-68`) | ❌ |
| `routing.*` | `routing` | `global:routing` (global) / `routing` (project) | ✅ project only; ❌ global |
| `mcp.*` (config verbs) | `mcp` | `global:mcp` / `global:mcp-connections` / `global:mcp-auth` (`mcp/backend-live.ts:289-293`) | ❌ |
| `output.*` (admin) | `output` | `global:output-admin` + scope lambdas (`outputspool/backend-live.ts:77`) | ❌ |
| `langlock.*` | `langlock` | scope-dependent (`langlockAuthorityFor`) | ❌ |
| `jobs.*` | `jobs` | `jobs` (`jobs/persistence.ts:59`) | ✅ |
| `semantic.*` | `semantic` | `semantic` (`semantic/registry-backend.ts:66`) | ✅ |

The scope-**independent** static authorities (`pools`→`routing`,
`telemetry`→`global:telemetry`, `mcp` config verbs, `jobs`, `semantic`) can be
resolved correctly by the hardened fallback with no scope knowledge; the
scope-**dependent** ones (`smart`/`budget`/`routing`-global/`output`/`langlock`)
cannot be fully resolved without scope and remain reachable only through the wired
`resolveAuthority` (which every production port already threads, Prong B).

## Problem

A config-backed operator save must EITHER persist end-to-end OR fail with a
surfaced, typed reason. The reproduced `pools.set` case does the worst thing: it
appears actionable, silently fails the CAS precondition because the preflight read
the wrong (empty) authority, and re-opens empty. The root cause is a single
degraded function returning the id prefix as the authority, reachable whenever the
full ADR-0017 resolver is not threaded. The resolver already exists and is wired
everywhere in HEAD; this feature closes the latent hazard by making the fallback
itself correct for the static-authority commands, and proves the reproduced
scenarios persist through the real wired port.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A config-backed save persists on the second write

- As an operator saving a role→model pool binding, I want `pools.set` to persist
  reliably on the second save (and on the first save when the config already holds
  a routing document) so that the pool is never silently zeroed — the preflight
  must resolve the SAME authority (`"routing"`) the command commits to and thread
  the correct CAS token.

### P1 — The degraded fallback is correct by construction

- As a maintainer, I want the degraded authority fallback to consult the same
  domain command→authority source of truth as the wired resolver so that a
  static-authority command (`pools`→`routing`, `telemetry`→`global:telemetry`, …)
  resolves the right authority even on a code path that did not thread the full
  resolver — closing the stale-binary / mis-wired-port hazard at the root.

### P1 — Optimistic concurrency is preserved, not weakened

- As a maintainer, I want the fix to be **correct preflight**, NOT an auto-resolve
  of a missing CAS token, so that the `mutations require version` guard
  (`mutation.ts:224-233`) still protects every mutation against a lost update; a
  save must never overwrite a concurrent edit because the token was silently
  invented.

### P1 — A rejected save is always surfaced, never silently zeroed

- As an operator, I want a rejected config-backed save to always show me *why*
  (an in-modal typed reason for a form, a toast for slash/CLI) so that a failure
  is never presented as success and never silently empties the surface.

### P2 — Every production preflight port stays wired

- As a maintainer, I want a regression guard asserting every production operator
  preflight entrypoint threads the real `resolveAuthority`, so that a future port
  cannot silently reintroduce the prefix-fallback bug.

## Functional Requirements

### Group A — Correct-by-construction preflight authority (FR-A)

1. **FR-A — The degraded fallback resolves the authority the command commits to.**
   The naive `authorityKeyForCommandId`
   (`config-status.ts:10-13`) MUST consult the SAME domain command→authority
   source of truth as `createOperatorAuthorityResolver`
   (`command-authority.ts:76-116`) for every **scope-independent static
   authority**, so `pools.set` resolves `"routing"` (not `"pools"`),
   `telemetry.*` resolves `"global:telemetry"`, the config-backed `mcp.*` verbs
   resolve `global:mcp*`, and `jobs`/`semantic` resolve unchanged. It MUST NOT
   re-type a parallel string table: the resolution MUST derive from the domain
   modules' own exported authority constants (the `command-authority.ts` imports),
   as ONE source of truth shared by the wired resolver and the fallback. A
   scope-dependent authority the fallback cannot resolve without scope
   (`smart`/`budget`/`routing`-global/`output`/`langlock`) MAY still fall to the
   prefix — those are reached only through the wired `resolveAuthority` in
   production (Prong B) — and an unknown/non-mutating id MUST continue to fall to
   the prefix (no regression). The inline `commandId.split(".")[0]` fallbacks
   (`http/handler.ts:229`, `http-slash-port.ts:216`, `rpc-slash-port.ts:196`,
   `tui-port.ts:114`) MUST route through the same hardened resolution so no
   preflight path keeps the raw-prefix behavior for a static-authority command.

### Group B — Production wiring invariant (FR-B)

2. **FR-B — Every production preflight port threads the real resolver.** The audit
   found NO production entrypoint that omits `resolveAuthority` at HEAD (Prong B).
   This feature MUST NOT regress that: every production operator port/stack that
   performs or forwards a mutation preflight MUST guarantee the real
   `LiveOperatorStack.resolveAuthority` (`stack-live.ts:864`) is threaded — the
   trusted worker fetch (`worker-adapter.ts:49`), the worker-local slash port
   (`worker-adapter.ts:72-74`), and the HTTP mount's production and test branches
   (`http/mount.ts:88,149`). A regression test MUST assert this wiring so a future
   port cannot silently drop it. FR-A makes the fallback safe *even if* it were
   dropped; FR-B keeps it from being dropped.

### Group C — Preserve optimistic concurrency (FR-C, guard/non-goal)

3. **FR-C — The single-committed-CAS-write / optimistic-concurrency contract is
   PRESERVED.** The fix MUST be correct preflight authority resolution, NOT a
   weakening of the CAS guard. `mutateAuthority`'s
   `mutations require version (CAS token) when authority already exists`
   rejection and the `CAS version conflict` check (`mutation.ts:224-242`) MUST
   remain byte-for-byte in force. It is an explicit **non-goal** to auto-resolve a
   missing/absent token, to default an absent version to the current version at
   mutate time, or to otherwise let a save proceed without a genuine CAS token —
   any of which would drop lost-update protection. The correct token flows because
   the preflight now reads the RIGHT authority's real version; nothing about the
   guard changes.

### Group D — A rejected save is always surfaced (FR-D, non-regression)

4. **FR-D — A rejected operator mutation is surfaced, never silently zeroed.** A
   rejected config-backed save MUST surface its typed reason to the user and MUST
   NOT be presented as success or silently empty the surface: an operator **form**
   MUST render the bounded, secret-free reason **in-modal** and keep the modal open
   (`edit-modal.tsx:113-119`, `multi-field-modal.tsx:289-295`, via
   `failureReason`, `edit-modal.tsx:58-60`), and the **slash/CLI** path MUST toast
   it (`execute.ts:205,218`). This is already the HEAD behavior; the requirement
   LOCKS it against regression. The `silent:true` form path MAY suppress the toast
   but MUST still surface the in-modal error and MUST NOT close the modal on a
   non-success outcome. Only a success outcome (`SUCCESS_OUTCOMES`) may close the
   form and fire `onSaved`.

### Group E — Regression proof for the reproduced scenarios (FR-E)

5. **FR-E — The exact reproduced scenarios persist / surface through the REAL
   wired production port.** Regression coverage MUST prove, over the real wired
   stack (not a bespoke helper that hand-threads authority):
   - (a) a **second** `pools.set` persists end-to-end (the reproduced
     `[reviewer, worker]` binding survives the 2nd write);
   - (b) a **first** `pools.set` on a config that **already holds a routing
     document** persists (no false `mutations require version`);
   - (c) with the hardened fallback in force but the full resolver **absent**, a
     `pools.set` preflight still resolves `"routing"` and threads the right token
     (the correctness of FR-A, proving the stale-binary/mis-wired path is now
     safe);
   - (d) a genuinely **rejected** mutation (e.g. a real CAS conflict) still returns
     a typed failure that the form surfaces in-modal (FR-C + FR-D), never a silent
     success. The parity/authority-split suites
     (`packages/opencode/test/operator/authority-split.test.ts`,
     `mutation-parity.test.ts`, `surface-parity.test.ts`) are the home for this
     coverage.

## Non-Functional Requirements

- **One source of truth, no drift.** The static command→authority resolution is
  derived ONCE from the domain modules' exported constants and shared by both the
  wired resolver and the hardened fallback; no parallel string table is
  introduced (the ADR-0017 "sourced from the domains" invariant is extended, not
  duplicated).
- **No contract, catalog, or dispatch change.** No operator payload, command id,
  catalog version, dispatch path, server/port surface, or feature flag is added or
  altered; this is a behavior-correctness change to preflight authority resolution
  plus regression proof.
- **No fabrication, no weakened guard.** No path invents a CAS token, a version,
  or an authority document; the optimistic-concurrency guard is preserved
  verbatim (FR-C).
- **Honest failure.** Every rejected save surfaces a typed, bounded, secret-free
  reason; no failure is swallowed or rendered as success (FR-D).

## Acceptance Scenarios

Given the operator control plane is enabled and a live wired stack is in use

- **Second pools.set persists (FR-A, FR-E-a).**
  Given a first `pools.set` has committed a role→model binding to the `"routing"`
  authority,
  When the operator issues a second `pools.set` (e.g. `[reviewer, worker]`) and
  the preflight resolves `"routing"` and threads its current version,
  Then the second write commits, the binding persists, and re-opening the pool
  shows the saved binding — never an empty pool.

- **First pools.set on an existing routing document persists (FR-A, FR-E-b).**
  Given the config already holds a `"routing"` document (from a prior
  routing/smart/budget write),
  When the operator issues its first `pools.set`,
  Then the preflight reads the existing `"routing"` version, threads it, and the
  write commits — it does NOT fail `mutations require version`.

- **Degraded fallback resolves the right authority (FR-A, FR-E-c).**
  Given a preflight path where the full `resolveAuthority` is absent (a
  stale/mis-wired port),
  When `pools.set` is preflighted through the hardened `authorityKeyForCommandId`,
  Then it resolves `"routing"` (not `"pools"`), reads the real version, and the
  save persists — the stale-binary failure mode is closed at the root.

- **CAS guard preserved (FR-C).**
  Given two operators reading the same `"routing"` version,
  When one commits and the other then commits with the now-stale version,
  Then the second is rejected with `CAS version conflict` (lost-update protection
  intact) — the fix never auto-resolves the missing/stale token.

- **A rejected save is surfaced in-modal (FR-D, FR-E-d).**
  Given a `pools.set` that the backend rejects (a real conflict / invalid
  argument),
  When the save dispatches from an operator form,
  Then the modal stays open and shows the typed, secret-free reason via
  `setError(failureReason(result))`; the form does NOT close and does NOT fire
  `onSaved`, and the pool is not silently zeroed.

- **Production wiring invariant holds (FR-B).**
  Given the production operator ports (trusted worker fetch, worker-local slash,
  HTTP mount),
  When the wiring is asserted,
  Then each threads `LiveOperatorStack.resolveAuthority` into its preflight —
  no production preflight port omits it.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and resolves Config
  **authority keys** (opaque strings like `"routing"`, `"global:telemetry"`) and
  the CAS **version token** of the authority a command commits to — metadata, not
  payload. The preflight status query is already payload/secret-free by
  construction (`createConfigStatusHandler` returns version + `configured` flags
  only, never the config body or secrets, `config-status.ts:19-39`); this feature
  does not change that. No new sensitive data is read, written, or exposed.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary. Every dispatch continues to ride the existing operator
  principal, scope, and CAS/confirmation gates unchanged; correcting the resolved
  authority does not change who may mutate what — the same scope/authority
  binding is enforced, just read correctly.
- **Input validation.** The command id and scope drive authority resolution; both
  are already validated upstream (`parseCommandId`/`parseScope`,
  `http/handler.ts:213-221`). The hardened fallback maps a *validated* command id
  to an authority via the domain constants — it introduces no new untrusted parse
  and no weaker path; an unknown id still falls to the prefix (no new surface).
- **Cryptography in transit/at rest.** Not applicable — this feature moves no new
  data across a boundary and persists nothing new; it corrects which existing
  authority the preflight reads.
- **Logging/audit.** No new logging. Every mutation continues to emit its Feature
  007 EventV2 audit correlation through the single `mutateAuthority` path
  (`mutation.ts` `finalize`), unchanged. Correcting the authority makes the audit
  `beforeVersion`/`afterVersion` reflect the RIGHT document — an integrity
  improvement, not a new log surface.
- **Error-handling information exposure.** Rejected saves surface the existing
  typed, bounded reason (`failureReason` prefers `display.message`, falls back to
  the typed outcome — never a stack trace or a raw config fragment,
  `edit-modal.tsx:58-60`); this feature preserves that honest, secret-free error
  path (FR-D) and adds no new error detail.

## Observability

This is a preflight-authority-resolution correctness change with no new backend
surface, so it emits no new metrics, log events, or trace spans. Operator
mutations from the corrected preflight continue to project through the existing
Feature 007 EventV2 audit (with the now-correct `beforeVersion`/`afterVersion`)
and the ADR-0001 OTLP foundation with content-free, bounded labels (command id,
domain, surface, outcome) — unchanged, because the payload contracts and dispatch
path are unchanged. Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The preflight-authority resolution and its guarantees are specified in
`doc/arch/schemas/operator-config-backed-saves-must-persist-reliably-and-never.cue`:

```
command id + scope  --resolveAuthority (wired, ADR-0017)-->  commit authority     (Prong B)
command id          --authorityKeyForCommandId (HARDENED)-->  commit authority     (FR-A)
    static authority (pools->routing, telemetry->global:telemetry, mcp*, jobs,
      semantic): resolved from the domain constants (one SSOT)                     (FR-A)
    scope-dependent (smart/budget/routing-global/output/langlock): prefix fallback,
      reached only via wired resolveAuthority in production                        (FR-A, Prong B)
    unknown / non-mutating id: prefix fallback (no regression)                     (FR-A)

preflight reads authority.version  -->  client threads expectedVersion (CAS token)
    correct authority => correct token => 2nd pools.set persists                   (FR-A, FR-E)
    CAS guard unchanged: absent/stale token still rejected (no auto-resolve)       (FR-C)

rejected mutation  -->  typed outcome+display  -->  form setError(in-modal) | toast (FR-D)
    success outcome ONLY closes the form / fires onSaved                           (FR-D)

No path fabricates a CAS token, a version, or an authority document; the
optimistic-concurrency guard (mutation.ts:224-242) is preserved verbatim (FR-C).
No operator payload, command id, catalog version, or dispatch path changes.
```

## Out of Scope

- **Weakening the CAS guard** or auto-resolving a missing/absent token — an
  explicit non-goal (FR-C).
- **Any operator payload, command id, catalog version, dispatch path, or feature
  flag change** — the contracts are untouched.
- **Re-architecting the scope-dependent authority resolution** (smart/budget/
  routing-global/output/langlock) into the scope-free fallback — those stay
  reachable only through the wired `resolveAuthority`; the fallback covers the
  static-authority subset that reproduced the bug.
- **Rewriting the operator form failure UI** — the in-modal surfacing already
  exists (Features 015/019/020); FR-D only locks it against regression.

## Related Features and Decisions

- [ADR-0021 — Operator config-backed saves must persist reliably and never silently zero](../../adr/0021-operator-config-backed-saves-must-persist-reliably-and-never.md)
- [ADR-0017 — Close the implementable operator capability gaps](../../adr/0017-close-the-implementable-operator-capability-gaps-so-the.md) — the fix-round "Superseding decision" introduced `command-authority.ts` and the preflight resolver whose degraded fallback this feature hardens; it explicitly noted "Unknown ids fall back to the prefix (no regression)".
- [Feature 013 — Wire the four remaining config-backed operator domains](../013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md) — `pools.set` backend and `PROJECT_AUTHORITY = "routing"` (`pools/backend-live.ts:44`).
- [Feature 017 — Close the implementable operator capability gaps](../017-close-the-implementable-operator-capability-gaps-so-the/spec.md) — the authority resolver / preflight seam and the ADR-0017 fix-round.
- [Feature 015 — Redesign the operator TUI domain screens into true CRUD](../015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md) — the operator edit-modal / multi-field-modal in-modal error surface.
- [Feature 019 — Complete the semantic binding lifecycle and the remaining operator residuals](../019-complete-the-semantic-binding-lifecycle-and-the-remaining/spec.md) and [Feature 020 — Replace the free-text model id entry in the operator](../020-replace-the-free-text-model-id-entry-in-the-operator/spec.md) — the operator form dispatch (`executeOperatorCommand`) and `pools.set` bindings editor.
- [Domain schema](../../schemas/operator-config-backed-saves-must-persist-reliably-and-never.cue)

## Clarifications

### Session 2026-07-20

- **The root cause is the preflight authority, not the mutation guard (FR-A,
  FR-C).** `pools.set` commits to `"routing"` (`pools/backend-live.ts:44`) but the
  degraded fallback returns the prefix `"pools"` (`config-status.ts:10-13`); the
  wrong (empty) authority yields no CAS token and the write fails the correct-by-
  design guard (`mutation.ts:224-233`). The fix is correct preflight, not a
  weakened guard. Recorded in ADR-0021.
- **HEAD production is fully wired (Prong B).** Every production preflight
  entrypoint threads `stack.resolveAuthority` (`worker-adapter.ts:49,72-74`,
  `http/mount.ts:88,149`, `stack-live.ts:864`); the user's "fica zerado" is a
  stale binary or a mis-wired port, not a HEAD wiring gap. FR-B is a regression
  guard, not a fix. Recorded in ADR-0021.
- **The fallback is hardened from ONE source of truth (FR-A, NFR).** The static
  command→authority resolution derives from the domain modules' exported
  constants that `command-authority.ts` already imports — no parallel table —
  extending the ADR-0017 "sourced from the domains" invariant to the fallback.
  Recorded in ADR-0021.
- **A rejected save is already surfaced in-modal (FR-D).** The form save handlers
  render `failureReason(result)` in-modal and keep the modal open on a non-success
  outcome (`edit-modal.tsx:113-119`, `multi-field-modal.tsx:289-295`); FR-D locks
  this against regression rather than adding it. Recorded in ADR-0021.
- **Alternatives rejected (ADR-0021).** Weakening the CAS guard and auto-resolving
  a missing token were both rejected — they drop lost-update protection; the
  chosen fix is a correct-by-construction fallback plus a wiring regression guard.
</invoke>
