# Implementation Plan: Close the Implementable Operator Capability Gaps

Feature: 017-close-the-implementable-operator-capability-gaps-so-the
Status target: planned (after this plan is complete)
ADR: [ADR-0017](../../adr/0017-close-the-implementable-operator-capability-gaps-so-the.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR23; domain model; honest-degradation + parity invariants)

## Overview

Feature 014 completed the operator control plane persistence and wired the
reachable service backends, deliberately leaving a documented set of **typed
capability gaps**. A gap sweep (2026-07-19, every `file:line` verified) found a
well-defined subset of those gaps is implementable **now** over machinery already
shipped, plus a class of operator-TUI editing defects the user hit on every screen
(telemetry/pools/routing raw-JSON prompts; the `{2}` view-modal collapse):

1. **MCP reads** are gapped although `MCP.Service` exposes `status()`
   (`mcp/index.ts:165`) + `clients()` (`:166`); the override
   (`stack-live.ts:496`) supplies only auth + resource ports.
2. **MCP mutations** are all gapped by the phantom-write trap
   (`mcp/backend-live.ts:128-135`).
3. **The OutputSpool is never populated** — no production caller drives
   `createChannelWriter` (`file-sink-writer.ts:139`); the operator reads an empty
   `operator-control.db` (`stack-live.ts:413-428`).
4. **Jobs occurrence projection** is gapped (`jobs/backend-live.ts:59-62`) although
   the `EventV2Bridge` seam is wired (`lifecycle/stack-wiring.ts:180-259`).
5. **The Milvus binding** is gapped (`semantic/backend-live.ts:79-85`) although the
   adapter stack ships (`semantic/milvus-adapter.ts`).
6. **The operator TUI cannot configure a domain** — the single-field raw-JSON
   prompt and the `{n}` view-modal collapse (`status.ts:61-62`).

This plan is a **wiring + TUI-editing** change: extend the Feature 015 edit modal
to multi-field and the view modal to a detail tree FIRST (the burning user pain),
then wire the MCP reads/mutations, the spool writer + reads + admin edge, the jobs
projection, and the Milvus binding, flip the TUI availability map to truth, and
git-ignore the leaked runtime config — keeping the executor/cancel/Smart-Routing
edges typed gaps.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR17).** No catalog id is added and no
  catalog version is bumped; only backend wiring, the TUI editing surface, and repo
  health are supplied.
- **No new dispatch path (parity, FR17).** Each verb rides the SAME
  `OperatorClient`/`executeOperatorCommand` loopback; no parallel registry.
- **Reuse the shipped machinery.** The `MCP.Service` host, the `outputspool/`
  writer/reader/control-store, the `EventV2Bridge` seam, the
  `semantic/milvus-adapter` stack, and the Feature 015 edit-modal machinery are
  reused; the ports, the composition root, and the modal wire onto them.
- **No control-plane flag change.** All work stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`.
- **No fabricated success / no phantom write (FR18).** Every read/mutation degrades
  to a typed envelope; the admin edge commits through a store-scoped authority, not
  a fabricated config CAS version.
- **Deferred edges stay typed gaps (FR16).** `jobs.run-now`, the lifecycle
  forced-abort `cancel`, and the Smart Routing consumption edge remain typed gaps.

## Technical Approach

### Architecture layers affected

```
Operator TUI editing (packages/tui/src/operator/form/**, status.ts)  -- FIRST -->  (FR19-FR23)
  edit-descriptor: one field -> ordered EditFieldList; enum -> picker;
  pools -> bindings-list editor; routing -> structured + advanced-JSON;
  Save composes byte-exact payload, single dispatch, in-modal error;
  view modal -> detail tree (bounded depth+rows) distinct from compact strip
        |
        v
MCP live reads (packages/opencode/src/operator/mcp/backend-live.ts, stack-live.ts)
  createMcpServiceOverride gains liveServerPort over status()+clients()  -->  (FR1, FR2)
        |
        v
MCP mutations (operator/mcp/**, application/handler.ts)
  config verbs -> mutation_plan (store.config); connect/disconnect/reconnect ->
  live-action plan; auth start/finish gap, remove convertible  -->  (FR3, FR4, FR5)
        |
        v
OutputSpool writer (packages/opencode/src/session/**, outputspool/**, operator/outputspool/**)
  production writer @ message-part seam -> createChannelWriter -> control store;
  stat/read/follow reflect real output; release/delete/purge admin edge  -->  (FR6-FR10)
        |  (statechart: doc/arch/statecharts/output-spool-writer.md)
        v
Jobs projection (operator/jobs/backend-live.ts)
  history/show-occurrences/watch over EventV2Bridge, bounded watch  -->  (FR11, FR12)
        |
        v
Milvus binding (operator/semantic/backend-live.ts, stack-live.ts)
  override.index/provider over milvus-adapter when endpoint configured  -->  (FR13, FR14)
        v
TUI availability (packages/core/src/operator/palette.ts) + repo health
  mcp/output verbs flip honest_unavailable -> persists_today/partial  -->  (FR15)
  packages/opencode/.gitignore ignores config.json  -->  (FR18)
Deferred edges stay typed gaps -- jobs.run-now / cancel / smart routing  -->  (FR16)
Honest degradation everywhere -- typed envelopes, no fabricated success  -->  (FR18)
```

The reused runtime — the Feature 015 edit-modal/edit-descriptor
(`packages/tui/src/operator/form/`), the `MCP.Service` host (`mcp/index.ts`), the
`outputspool/` machinery, the `EventV2Bridge` seam, and the
`semantic/milvus-adapter` stack — is the single source the ports and the modal wire
onto; the capability-gap ValueObjects are specified in
`doc/arch/schemas/operator-capability-gaps/` and the OutputSpool writer lifecycle
in `doc/arch/statecharts/output-spool-writer.md`.

### Phase 1 — Operator TUI editing: multi-field modals + detail view tree (FR19-FR23) — FIRST

- **Extend the edit descriptor to an ordered field list.** `edit-descriptor.ts`
  (Feature 015, single `extract`) grows to an `EditFieldList` per verb — one
  labeled field per payload property, each pre-filled from the read the descriptor
  already issues, enum properties as pickers. The `edit-modal.tsx` contract (title,
  in-modal error, busy, Save/Cancel, `esc`) is unchanged.
- **Byte-exact payload + single dispatch.** On Save the modal composes exactly the
  port-contract payload (byte-exact keys — the Feature 014 lesson) and dispatches
  ONCE through `executeOperatorCommand`. A payload it cannot compose, or a per-field
  validation failure, surfaces an **in-modal error**, never a global toast.
- **`pools.set` bindings-list editor.** An ordered list of `{role, models}` rows
  (role picker/text over the known vocabulary; models bounded add/remove list),
  pre-filled from `pools.show`; Save composes `{bindings:[{role,models}],
  expectedVersion}` (`pools-command-port.ts` `parseBindings`, `PoolsSetInput`).
- **`routing.configure` structured + advanced-JSON.** Structured common fields
  (`enabled` toggle, `mode` picker) plus a labeled advanced JSON field for the
  remaining policy document; never a bare unlabeled JSON prompt.
- **Field coverage.** `telemetry.configure` (endpoint + transport picker; headers
  SecretRef-only, deferred with honest note), `budget.set` (numeric per limit),
  `jobs.create`/`update` (definition core fields), `mcp.server.add`/`update`
  (id/name/url/transport), `output.retention.set` (ttlSeconds + legalHold),
  `output.quota.set` (scope + maxBytes), `semantic.provider.add`/`update`
  (name/baseUrl/newSecretRef).
- **Detail view tree.** A new renderer for the view modal expands records/arrays to
  a bounded depth (~4) + bounded rows with an honest `... N more` marker; scalars
  verbatim under the string cap; NO `{n}` within the bound. Kept DISTINCT from
  `status.ts` `toStatusNodes`/`formatStatusValue` (the compact strip is unchanged).

### Phase 2 — MCP live reads (FR1, FR2)

- **Add a `liveServerPort`** to `createMcpServiceOverride`
  (`mcp/backend-live.ts:186`) reading `MCP.Service.status()` + `clients()` and
  projecting `{serverId, connection status, capabilities-present}` for
  `server.list`/`status`/`capabilities`. SSOT-only fields stay absent — never
  fabricated. Guarded reads degrade to typed `mcp_unavailable`.

### Phase 3 — MCP mutations: mutation_plan + live actions + auth verdict (FR3, FR4, FR5)

- **Convert the config-backed MCP verbs** (`server.add`/`update`/`delete`,
  `logging.level.set`, `experimental.enable`/`disable`,
  `extension.enable`/`disable`, `resource.admin.policy.set`) to the
  `OperatorMutationPlan` contract over the `store.config` MCP authority (the
  `telemetry-command-port.ts` `runPlan` + Feature 014 conversions are the template).
- **Dispatch the live-service actions** (`server.connect`/`disconnect`/`reconnect`)
  as plans whose `apply` calls the live `MCP.Service` connection APIs with honest
  typed outcomes.
- **Auth verdict.** `auth.start`/`finish` stay typed gaps (interactive OAuth cannot
  run headless); `auth.remove` converts to `mutation_plan` if `McpAuth` exposes a
  clear/delete API — confirmed in implement, recorded in tasks.md.

### Phase 4 — OutputSpool production writer + stat/read/follow (FR6, FR7, FR8, FR10)

- **Subscribe a production writer** at the session message-part seam
  (`session/message-v2.ts` `PartUpdated`/`PartDelta`) driving `createChannelWriter`
  per channel generation, writing to the SAME `operator-control.db`
  (`stack-live.ts:413-428`). Honor the Feature 005 producer ownership (C21),
  content-free events (C22), bounded memory, and stale-generation fencing; seal/abort
  on cancel preserving committed bytes.
- **Reflect real reads.** `output.stat`/`read` project the populated control store;
  `output.follow` binds its cursor-codec seam (`backend-live.ts:103`, `FOLLOW_GAP`).

### Phase 5 — OutputSpool admin edge (FR9)

- **Wire `release`/`delete`/`purge`** (`backend-live.ts:100-102`,
  `CONTROL_STORE_ONLY`) through a **store-scoped authority** via the `mutation_plan`
  contract: the `apply` performs the control-store op and emits the Feature 007
  audit correlation; the settled version is the control-store generation, NOT a
  fabricated config CAS version (ADR-0017).

### Phase 6 — Jobs occurrence projection (FR11, FR12)

- **Project `job.*` occurrence events** for `jobs.history`/`show-occurrences`/`watch`
  through the same `EventV2Bridge.Service` seam the lifecycle domain uses
  (`lifecycle/stack-wiring.ts:180-259`); `watch` opens a bounded, closable
  subscription and degrades to `unavailable` when the bridge is unbound.

### Phase 7 — Milvus registry binding (FR13, FR14)

- **Bind `override.index`/`override.provider`** over `milvus-adapter` in
  `createLiveSemanticBackend` WHEN a Milvus endpoint is configured (Feature 006/009
  config shape), under bounded gRPC probes + the `url-guard` SSRF policy; unconfigured
  degrades to the same typed `milvus_unavailable` gap. Semantic stays mixed.

### Phase 8 — TUI availability flip + deferred gaps + repo health (FR15, FR16, FR18)

- **Flip the palette availability** (`packages/core/src/operator/palette.ts`,
  `OPERATOR_PERSISTING_DOMAINS`/`OPERATOR_PERSISTING_VERBS`/`persistenceFor`/
  `domainBadge`) so the now-working MCP + output verbs read `persists_today` (or the
  domain `Partial` where it stays mixed); no verb advertises what it lacks.
- **Keep the deferred edges typed gaps** (`jobs.run-now`, lifecycle `cancel`, smart
  routing) — documented, not fabricated.
- **Git-ignore `packages/opencode/config.json`** via `packages/opencode/.gitignore`.

### Phase 9 — Tests + guard scope + doc sync (FR17)

- **TUI editing (Phase 1).** Multi-field modal renders/pre-fills/validates per verb;
  Save composes the byte-exact payload and dispatches once; the in-modal error path;
  the `pools.set` bindings editor; the `routing.configure` structured + advanced-JSON;
  the detail tree bounded-depth/rows + `... N more`, distinct from the compact strip.
- **MCP (Phases 2-3).** Live reads over a `MCP.Service` double; the config mutation
  `mutation_plan` commit + a stale-CAS no-phantom-write case; the live-action plan;
  the auth verdict split.
- **OutputSpool (Phases 4-5).** Writer subscribed at a message-part seam populates a
  real control store; stat/read/follow reflect it; stale-generation fencing;
  seal/abort on cancel; the admin edge commits through the store-scoped authority.
- **Jobs + Milvus (Phases 6-7).** Occurrence projection over a bridge double + bounded
  watch; Milvus binding when configured + the `milvus_unavailable` gate.
- **Availability + parity (Phase 8, FR17).** The palette flip is truthful; reuse the
  Feature 007 parity harness to assert each verb rides the same command id / loopback
  with no new dispatch path, no new catalog id, no catalog version bump.
- **Doc sync.** Keep the spec, ADR-0017, the `operator-capability-gaps/*.cue` corpus,
  and the output-spool-writer statechart in sync with the shipped shapes.

## Data model and migration strategy

No new store or table. The MCP reads/mutations wire onto the EXISTING `MCP.Service`
host + `store.config` authority; the OutputSpool writer populates the EXISTING
`operator-control.db` (a `bun:sqlite` control store); the jobs projection reads the
EXISTING `EventV2Bridge` durable seam; the Milvus binding reaches the EXISTING
adapter stack. Config-backed mutations are optimistic CAS writes under a
`CasExpectation(authority, expectedVersion)`; the OutputSpool admin edge commits
through a store-scoped authority whose settled token is the control-store
generation (never a fabricated config CAS version). **Migration note:** none — the
spool was never populated before, so `output.stat`/`read` simply begin reflecting
real state once the writer lands. The operator-surface projections and readiness
classes are typed by the ValueObjects in
`doc/arch/schemas/operator-capability-gaps/` (`#LiveServerRead`,
`#LiveServerReadResult`, `#McpMutation`, `#McpAuthDisposition`, `#MutationEnvelope`,
`#SpoolWriterBinding`, `#SpoolReadResult`, `#SpoolAdminEdge`, `#OccurrenceProjection`,
`#WatchSubscription`, `#MilvusBinding`, `#EditField`, `#EditFieldList`,
`#EditModalDescriptor`, `#DetailTree`, and the bounded enums). The editing-surface
enums — the per-property input kinds the multi-field edit modal renders, the
per-verb availability class the grouped menu derives, and the two effective-payload
renderers (the compact bounded-height status strip vs the detail expand tree) — are
bound by `enums-tui.cue`.

## OutputSpool writer state machine

Per `doc/arch/statecharts/output-spool-writer.md`:

```
subscribed -> generation_open -> { fenced (stale) | appending -> { sealed | aborted } } -> recorded
operator_read -> resolve_control_store -> { projected (populated) | typed_gap (empty/unbound) }
```

The writer honors the Feature 005 producer ownership (C21) and content-free events
(C22); the admin edge commits through a store-scoped authority preserving the audit
+ no-phantom-write invariants (FR9).

## Security and threat boundaries

| Concern                      | Mitigation                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| No new authenticated surface | Every verb rides the Feature 007 `OperatorClient` loopback + operator principal/scope/CAS (FR17).      |
| Secret handling              | MCP + semantic provider credentials persisted as `SecretRef` only; SecretPort-resolved (FR11, FR18).  |
| Input validation             | MCP payloads, message parts, occurrence events, Milvus config schema-validated -> typed `invalid_argument`/`unavailable`; writer fences stale generations + bounds offsets. |
| External reach               | MCP/Milvus reach external systems only under the offline/SSRF `url-guard` policy and secret refs.       |
| Typed capability gaps        | Milvus-unconfigured, executor, cancel, smart-routing, interactive-OAuth edges return typed gaps (FR14, FR16). |
| No phantom write             | Config mutations commit via `mutateAuthority`; the spool admin edge uses a store-scoped authority, not a fabricated config CAS version (FR9, FR18). |
| No secret/payload leakage    | Reads/errors/toasts carry only bounded, secret-free reasons; no spool page body, MCP header, credential, or config fragment. |
| Content-free events          | The spool writer carries no content on any event; content leaves only as an authorized paged `output.read` (Feature 005 C22). |
| No leaked runtime config     | `packages/opencode/config.json` git-ignored so a live CLI run cannot commit real config or a plaintext secret (FR18). |
| Audit                        | Mutations emit the Feature 007 EventV2 audit correlation via `mutateAuthority` / the store-scoped authority with bounded labels. |

## Observability

No new telemetry of its own. Operator dispatches continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels. The production spool writer reuses the Feature 005
writer-latency/read-latency observability; the occurrence projection and the Milvus
binding record only bounded, typed outcomes. No spool page body, MCP server secret,
provider credential, Milvus endpoint, or config payload is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths; most of the surface is already in scope under the Feature 007 / 005 /
006 / 008 / 011 / 014 blocks. Genuinely new to Feature 017: the session message-part
writer hook (WRITE access scoped to the writer entry only) and the
`packages/opencode/.gitignore`. Reused seams are listed for traceability:

```toml
# Genuinely new to Feature 017:
"packages/opencode/src/session/**",           # production spool writer subscribed at the message-part seam (FR6, FR10) — scoped to the writer hook
"packages/opencode/.gitignore",               # git-ignore the runtime-generated config.json (FR18)
"packages/tui/src/operator/form/**",           # multi-field edit modal + descriptor (FR19-FR22)
"packages/tui/src/operator/status.ts",         # detail view tree renderer kept distinct from the compact strip (FR23)
# Already in scope — NOT re-added, listed for traceability:
#   packages/opencode/src/operator/**          -> mcp/output/jobs/semantic backend wiring (FR1-FR14) [Feature 007]
#   packages/opencode/src/mcp/**               -> MCP.Service host reused (FR1-FR5)                  [Feature 008]
#   packages/opencode/src/outputspool/**       -> writer/reader/control-store reused (FR6-FR10)      [Feature 005]
#   packages/opencode/src/semantic/**          -> milvus-adapter reused (FR13)                       [Feature 006]
#   packages/opencode/src/jobs/**              -> occurrence events reused (FR11)                     [Feature 002/003]
#   packages/core/src/operator/**              -> palette.ts availability flip (FR15)                [Feature 007]
#   packages/{opencode/test/operator,core/test/operator,tui/test/operator}/** -> tests
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Operator TUI editing — multi-field modals + detail view tree (FIRST, user pain).
2. MCP live reads.
3. MCP mutations (mutation_plan + live actions + auth verdict).
4. OutputSpool production writer + stat/read/follow.
5. OutputSpool admin edge (release/delete/purge).
6. Jobs occurrence projection.
7. Milvus registry binding.
8. TUI availability flip + deferred gaps + repo health.
9. Tests (TUI, MCP, spool, jobs, Milvus, availability, parity) + guard scope + doc sync.

## Companion artifacts

None required beyond this plan. The capability-gap ValueObjects
(`doc/arch/schemas/operator-capability-gaps/`) and the statechart
(`doc/arch/statecharts/output-spool-writer.md`) carry the data model; no
`research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR23 mapped to ordered phases (TUI editing FIRST)
- [x] No new catalog id / no catalog version bump / no new dispatch path / no flag (FR17)
- [x] Multi-field edit modal + detail view tree specified (FR19-FR23)
- [x] MCP reads + mutations + auth verdict wired (FR1-FR5)
- [x] OutputSpool writer + reads + admin edge (FR6-FR10)
- [x] Jobs projection + Milvus binding (FR11-FR14)
- [x] TUI availability flip + deferred typed gaps + config.json git-ignore (FR15, FR16, FR18)
- [x] Secrets `SecretRef`-only; no fabricated success / no phantom write (FR11, FR18)
- [x] specScopeGlobs narrow; only the session writer hook + `.gitignore` + TUI form paths genuinely new
- [x] `tasks.md` generated and filled
- [x] `speckit analyze` clean of new Critical/High/Medium blockers
- [x] `speckit validate --json` green (0 new findings on Feature 017 artifacts)

## Implementation notes (recorded during implement)

- 2026-07-19 — T001-T024 + the adversarial-review fix-round landed per plan.

  **Group A (T001-T006, FR19-FR23) — operator TUI editing, first.** The Feature 015
  single-field `OperatorEditPrefill` grew into an ordered `EditFieldList`
  (`packages/tui/src/operator/form/field-list.ts`): one labeled `EditField` per
  payload property, enum properties as `picker`, secret fields never pre-filled.
  `multi-field-modal.tsx` renders the ordered list (inputs, `DialogSelect` pickers,
  toggles, a `BindingsEditor` for `pools.set`) inside the unchanged Feature 015 modal
  contract (title/in-modal error/busy/Save-Cancel/`esc`). `composePayload` builds the
  byte-exact per-verb payload (the Feature 014 lesson: never a naive
  `{ [field.key]: rawText }` spread) and dispatches once through
  `executeOperatorCommand`. `routing.configure` renders a structured `enabled`/`mode`
  sub-form plus a labeled advanced-JSON field — no bare unlabeled JSON prompt remains.
  `status.ts` gained a `toDetailTree` renderer (bounded depth ~4, bounded rows, honest
  `… N more`), kept strictly distinct from the existing compact `toStatusNodes` strip.

  **Group B/C (T007-T010, FR1-FR5) — MCP live reads + mutations.** `mcp-port.ts`
  gained a content-free `McpLiveServerReader` projecting `MCP.Service.status()`/
  `clients()`; SSOT-only fields (CAS version, `auditId`, trust profile, timestamps)
  stay absent. Config-backed MCP verbs (`server.add`/`update`/`delete`, `logging.
  level.set`, `experimental.*`, `extension.*`, `resource.admin.policy.set`) convert to
  the `OperatorMutationPlan` contract over the `store.config` `"global:mcp"`
  authority, eliminating the FR5 phantom-write trap. Live-service actions
  (`connect`/`disconnect`/`reconnect`) and `auth.remove` (confirmed real via
  `McpAuth.Service.remove` / `MCP.Service.removeAuth`) record their outcome under
  store-scoped authorities (`"global:mcp-connections"`, `"global:mcp-auth"`);
  `auth.start`/`finish` stay typed gaps (interactive OAuth cannot run headless
  through the operator loopback). Fixed a latent port bug in the same pass:
  `mcp-command-port.ts` default transport `"streamable_http"` was not a valid
  `TransportKind` member — corrected to `"streamable-http"`.

  **Group D/E (T011-T014, FR6-FR10) — OutputSpool writer + reads + admin edge.** A
  new production writer (`session/output-spool-writer.ts`) subscribes at the session
  message-part seam via the `GlobalBus` fan-out and drives the existing
  `outputspool/file-sink-writer.ts` machinery into the SAME control store the
  operator reads — REUSED, not re-authored, honoring producer ownership, content-free
  events, bounded memory, and stale-generation fencing. `output.stat`/`read` project
  the now-populated store; `output.follow` binds an opaque base64url cursor over a
  bounded 64 KiB page read on an independent read-only handle, never blocking the
  writer. `output.release`/`delete`/`purge` wire through a control-store admin port
  whose plan records the outcome under a store-scoped authority
  (`"global:output-admin"`) — never a fabricated config CAS version — preserving
  audit + no-phantom-write.

  **Group F/G (T015-T016, FR11-FR14) — jobs projection + Milvus binding.** The jobs
  occurrence projection (`operator/jobs/occurrence-projection.ts`) folds the durable
  `job.*` vocabulary through the SAME `EventV2Bridge.Service` seam the lifecycle
  domain already uses; `jobs.watch` opens a bounded, closable subscription and
  degrades to a typed gap when the bridge is unbound. The Milvus binding
  (`operator/semantic/milvus-binding.ts`) binds an `IndexPort` under a
  hard-capped-10s probe when an endpoint is configured; the full index-maintenance
  pipeline stays a typed `milvus_unavailable` gap (honest "mixed" readiness per
  spec) — never a fabricated generation/count. Fixed a second latent port bug:
  `semantic-command-port.ts` `semantic.provider.add` residency default
  `"unrestricted"` was not a `ResidencyProfile` member — corrected to `"remote"`.

  **Group H (T017-T018, FR15, FR16, FR18) — availability + deferred gaps.**
  `packages/core/src/operator/palette.ts` `OPERATOR_PERSISTING_VERBS` gained the 14
  newly-real MCP mutations + the 3 output admin verbs, flipping mcp
  `Unavailable → Partial` (output stays `Partial`); the still-gapped verbs
  (`auth.start`/`finish`, `resource.admin.subscribe`/`unsubscribe`, output
  export/share) stay `honest_unavailable`. `jobs.run-now`, the lifecycle
  forced-abort `cancel`, and the Smart Routing consumption edge are confirmed still
  typed capability gaps — no code path fabricates their availability.
  `packages/opencode/.gitignore` already carries `config.json`
  (`git check-ignore` confirms).

  **Fix-round (adversarial review, same day) — 3 defects, 1 root mechanism, see
  ADR-0017's superseding-decision section for full rationale.** (1) The irreversible
  op in `output.release`/`delete`/`purge`, `mcp.server.connect`/`disconnect`/
  `reconnect`, and `mcp.auth.remove` ran at plan-BUILD time, before
  `mutateAuthority`'s CAS/idempotency checks — a `plan.effect` seam
  (`application/handler.ts`, `application/mutation.ts`, `application/dispatcher.ts`)
  now defers the destructive op to run AFTER all checks pass, before the CAS write,
  so a failed CAS or an idempotent replay never re-runs it. (2) The root mechanism:
  the preflight resolved the authority from `commandId.split(".")[0]`, which never
  matched the shared global authorities (`global:mcp`, `global:output-admin`, …) —
  a new `application/command-authority.ts` registry (sourced from each domain's
  exported authority constants, no re-typed string table) is now threaded through
  every inbound surface (`http/handler.ts`, `http/mount.ts`, `stack-live.ts`,
  `worker-adapter.ts`, `adapters/inbound/tui-port.ts`, `http-slash-port.ts`,
  `rpc-slash-port.ts`) so the client always threads the CAS token for the SAME
  authority the plan commits to. (3) The production spool writer was armed only
  inside the lazy operator stack, so a session that never opened the operator lost
  its output — `outputspool/spool-process-writer.ts` is now an idempotent,
  fail-open process singleton armed eagerly at server start (`server/server.ts`),
  reused (not duplicated) by the operator stack.

  **Tests + guard + docs (T019-T024, FR17).** All test coverage for T001-T018 landed
  incrementally inside each group's own commit (per-task Evidence above cites the
  exact `describe()` blocks and files) rather than as a deferred end-of-phase
  authoring pass — T019-T023 close as verification passes over that existing
  coverage, re-run and re-confirmed on 2026-07-19 (see each task's Evidence for the
  per-suite counts). No guard scope change was needed: every genuinely-new implement
  path (the fix-round's `command-authority.ts`, `spool-process-writer.ts`, and the
  http/worker/adapter threading) resolves under the ALREADY-declared
  `packages/opencode/src/operator/**` / `packages/opencode/src/outputspool/**` /
  `packages/opencode/src/server/server.ts` globs — none of it is a new top-level
  glob. The `operator-capability-gaps/*.cue` corpus (`#EditField`/`#EditFieldList`/
  `#DetailTree`, `#LiveServerRead`/`#LiveServerReadResult`, mutation/flag/spoolwriter
  shapes) already types the shipped shapes with no drift. ADR-0017 carries its own
  superseding-decision section for the fix-round (no new ADR). `speckit analyze` →
  consistent, 0 ADR overlaps; `speckit validate --json` → `ok:true`, 0 new findings
  (the 4 findings present are pre-existing waived `hygiene.empty-file` hits unrelated
  to Feature 017).

- _(reserved — filled during implement with date + file:line + test results)_
