---
id: 019f7cb5-1e69-7022-b1da-9b64b6e1c52d
number: 017
slug: close-the-implementable-operator-capability-gaps-so-the
status: analyzed
created_at: 2026-07-19T23:27:52.425498Z
---
# Feature Specification: Close the Implementable Operator Capability Gaps

Feature: 017-close-the-implementable-operator-capability-gaps-so-the
Created: 2026-07-19
Scope: Feature 014 wired the reachable operator service backends and left a
documented residual set of **honest capability gaps** — verbs the surface
advertises that still degrade to a typed `unavailable`/`mcp_unavailable`/
`milvus_unavailable` because their live dependency was not yet wired. A gap
sweep confirmed a subset of those gaps is **implementable now** over machinery
that already exists in the codebase, without an executor-composition or Smart
Routing dependency. This feature closes exactly that implementable subset —
MCP live reads and mutations, the OutputSpool production writer plus its reads
and admin edge, the jobs occurrence projection, and the Milvus registry binding
— and updates the TUI availability map to the new truth, while the
executor-gated (`jobs.run-now`), lifecycle forced-abort (`cancel`), and Smart
Routing consumption edges stay **typed capability gaps** by design. Feature 007
remains the sole command-registration authority: no catalog id is added, no
catalog version is bumped, no new dispatch path or flag is introduced. Every
new backend degrades to a typed envelope and never fabricates state or a
phantom write.

## Problem

Feature 014 closed the config round-trip, converted `langlock`/`jobs` to the
`mutation_plan` contract, and wired the OutputSpool control store, the MCP
admin host reads, and the config-backed semantic registry. It deliberately left
a class of verbs as **typed capability gaps** — honest `unavailable` envelopes
rather than fabricated success — where a live dependency was not yet reachable.
A subsequent exhaustive gap sweep (2026-07-19, every fact `file:line` verified)
found that a well-defined subset of those gaps is implementable **now** over
machinery already shipped, with no executor-composition or Smart Routing
dependency:

- **MCP reads are gapped although the service exposes them (GAP E).**
  `mcp.server.list`/`status`/`capabilities` return `unavailable` even though
  `MCP.Service` exposes `status(): Record<string, Status>`
  (`packages/opencode/src/mcp/index.ts:165`) and `clients()`
  (`:166`), with the `Status` union (`connected`/`disabled`/`failed`/
  `needs_auth`/`needs_client_registration`, `:83-106`) already typed. The
  composition root injects `createMcpServiceOverride`
  (`stack-live.ts:496`) supplying ONLY the auth + resource read ports
  (`mcp/backend-live.ts:186`); the server/logging/experimental/extension ports
  stay `gapBackend` (`backend-live.ts:93`). The "would fabricate state" caution
  (`backend-live.ts:125-135`) is over-cautious for a **faithful** projection of
  `{serverId, connection status, capabilities-present}`: the SSOT-only fields
  (CAS version, `auditId`, trust profile, timestamps) stay absent/null and are
  never fabricated.

- **Every MCP mutation is gapped by the phantom-write trap.** The `mcp.*`
  command port returns `kind:"query"` (Feature 008), which the Feature 007
  dispatcher rejects for a `mutates` descriptor **after** any side effect — the
  FR5 phantom-write trap documented at `backend-live.ts:128-135`. So no MCP
  mutation can commit even where the operation is a real, reachable action.

- **The OutputSpool is never populated (GAP A, headline).** Feature 005 shipped
  the full `outputspool/` machinery — `control-store.ts`, `page-reader.ts`,
  `spool-layout.ts`, `retention-sweeper.ts`, `file-sink-writer.ts`
  (`createChannelWriter`, `:139`), `reconciler.ts`, `writer-queue.ts` — but a
  grep confirms **no production caller** ever populates the spool. The operator
  reads its own `<Global.Path.data>/outputspool/operator-control.db`
  (`stack-live.ts:413-428`, the deliberate `bun:sqlite` choice documented at
  `:404-408`), which stays empty, so `output.stat`/`read` reflect nothing.
  Session output already exists as structured message parts
  (`packages/opencode/src/session/message-v2.ts`, `session.ts`, `processor.ts`)
  with a `PartUpdated`/`PartDelta` bus — the seam a production writer subscribes
  to. `output.follow` stays gapped on its cursor-codec seam
  (`outputspool/backend-live.ts:103`, `FOLLOW_GAP`); `release`/`delete`/`purge`
  stay gapped on the control-store admin edge
  (`backend-live.ts:100-102`, `CONTROL_STORE_ONLY`).

- **Jobs occurrence projection is gapped although the durable read seam is
  wired (GAP F).** `jobs.history`/`show-occurrences`/`watch` fail with
  `unavailable` (`jobs/backend-live.ts:59-62`), yet the EventV2 durable
  read/subscribe seams are already wired for lifecycle
  (`lifecycle/stack-wiring.ts:180-259`, over the `EventV2Bridge.Service`
  singleton). Projecting `job.*` occurrence events through the same
  `EventV2Bridge` closes the gap with a bounded watch subscription.

- **The Milvus registry binding is gapped although the machinery exists (GAP
  D).** `semantic.index`/`validate`/`reindex`/`cutover` stay
  `milvus_unavailable` (`semantic/backend-live.ts:79-85`) although the full
  machinery is shipped (`semantic/milvus-adapter.ts`, `grpc-probe.ts`,
  `embedding-client.ts`, `rerank-client.ts`, `credential-resolver.ts`,
  `url-guard.ts`). Binding an `override.index`/`override.provider` over
  `milvus-adapter` **when a Milvus endpoint is configured** closes the gap;
  unconfigured degrades to the same typed `milvus_unavailable` gap.

- **The operator TUI cannot actually configure a domain (user evidence).** Two
  screenshots from the polished Feature 015/016 screens show the editing surface
  is half-built:
  1. On the Telemetry screen, selecting **Configure `telemetry.configure`**
     opens a **single-field raw-JSON text prompt**. The user reports they still
     "cannot configure" — a raw JSON blob is not a usable edit affordance. The
     Feature 015 ADR deferred multi-field modals; that deferral is now the exact
     user pain and must land here.
  2. On the same screen, **Test** (`telemetry.test`) renders through the view
     modal as `outcome: unreachable / target: {2} / reason: endpoint refused or
     unreachable` — the nested `target` record collapses to a `{2}` count
     placeholder (`status.ts` `formatStatusValue`,
     `packages/tui/src/operator/status.ts:61-62`) instead of showing its
     `endpoint`/`transport` fields. The `{n}`/`[n]` compaction is correct for the
     bounded-height **inline status strip** (`toStatusNodes`, `:46`), but wrong
     for the dedicated **view modal**, whose entire purpose is detail. The two
     renderers must be distinct contracts.
  3. On the Pools screen, selecting **Set `pools.set`** immediately toasts
     `Operator invalid — pools.set requires a bindings array of { role, models }`
     with the status strip showing `bindings: empty, configured: false`. The
     single-field form cannot compose the `{bindings: [{role, models}],
     expectedVersion}` payload the port contract requires
     (`pools-command-port.ts:77` `parseBindings`,
     `packages/protocol/src/pools/commands.ts:88` `PoolsSetInput`), and the
     failure surfaces as a **global toast** rather than an in-modal error. A
     structured bindings-list editor is required.
  4. On the Routing screen, **Configure `routing.configure`** is the same raw
     single-field JSON prompt family — the user reports they "cannot configure
     ANYTHING". The routing policy is a large document
     (`routing.configure`, catalog `mutates:true`, `catalog.ts:83`; the payload
     spans `enabled`/`mode` plus the full policy/`budgetPolicy` document per
     `packages/protocol/src/routing/index.ts`), so a bare unlabeled JSON prompt
     must never be the only path.

- **A runtime-generated `config.json` keeps leaking into the working tree.**
  `packages/opencode/config.json` is generated by live CLI runs and has
  repeatedly appeared as an untracked file carrying the operator's real global
  config plus plaintext secret material (deleted twice this campaign, Feature
  014 close-out). It must be git-ignored so it can never be committed.

Leaving these residuals means the palette/slash/CLI/TUI advertise verbs that
degrade to a permanent gap even where a live backend is now reachable, and the
TUI availability map is stale. The fix is a **wiring** change over machinery
that already exists — no new executor, no Smart Routing, no new catalog id or
dispatch path.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — MCP reads reflect the live client

- As an operator, I want `mcp.server.list`/`status`/`capabilities` to reflect
  the live `MCP.Service` connection status and advertised capabilities so that
  the surface shows real client state, with the SSOT-only fields honestly
  absent, never fabricated.

### P1 — MCP mutations commit honestly

- As an operator, I want MCP config-backed mutations (`server.add`/`update`/
  `delete`, `logging.level.set`, `experimental.enable`/`disable`,
  `extension.enable`/`disable`, `resource.admin.policy.set`) to commit through
  the shared `mutateAuthority` path so they persist under CAS, and the
  live-service actions (`server.connect`/`disconnect`/`reconnect`) to dispatch
  as plans whose apply calls the live `MCP.Service` connection APIs with honest
  typed outcomes, never a phantom write.

### P1 — Session output is actually spooled

- As an operator, I want session output to be written into the OutputSpool
  control store by a production writer subscribed at the session message-part
  seam, so that `output.stat`/`read` reflect real session output instead of an
  empty store, and `output.follow` streams from the populated store.
- As an operator, I want `output.release`/`delete`/`purge` to act on the
  populated control store through an honest admin edge that preserves the
  audit and no-phantom-write invariants.

### P1 — Jobs occurrence history is projected

- As an operator, I want `jobs.history`/`show-occurrences`/`watch` to project
  the durable `job.*` occurrence events through the same `EventV2Bridge` the
  lifecycle domain uses, with a bounded watch subscription, so that scheduled
  job occurrence history is real, not a permanent gap.

### P1 — Semantic index binds when Milvus is configured

- As an operator, I want `semantic.index`/`validate`/`reindex`/`cutover` to
  bind over the shipped `milvus-adapter` when a Milvus endpoint is configured,
  and to degrade to the same typed `milvus_unavailable` gap when it is not, so
  that the index verbs work where the dependency is reachable and stay honest
  where it is not.

### P1 — Deferred edges stay typed gaps

- As an operator, I want `jobs.run-now`, the lifecycle process/task forced-abort
  `cancel`, and the Smart Routing consumption edge to remain **typed**
  capability gaps, so that the surface never claims a capability it cannot
  reach and no fragile or fabricated path is forced.

### P1 — Truthful TUI availability

- As an operator, I want the grouped operator menu availability map updated to
  the new truth so that the MCP and output verbs that now work flip from
  `honest_unavailable` to `persists_today`/`partial`, and no verb advertises a
  capability it still lacks.

### P1 — Configure a domain with a real multi-field form

- As an operator, I want a payload-carrying Configure verb to open a real
  multi-field form modal — one labeled field per payload property, pre-filled
  from the current effective value, per-field validation, enum properties as
  pickers, and a bindings-list editor where the payload is a list — instead of a
  single raw-JSON prompt, so that I can actually configure a domain, and Save
  composes exactly the typed payload the port contract expects and dispatches once.

### P1 — Read a result's full detail in the view modal

- As an operator, I want the view modal to render the effective payload as an
  indented key-value tree that expands nested records and arrays to a bounded
  depth with honest truncation, so that a probe result or entity detail shows its
  fields instead of a `{n}` count placeholder, while the compact inline status
  strip keeps its bounded one-line summary.

### P2 — Parity across surfaces

- As an operator, I want every newly-wired verb to ride the same command id and
  the same `OperatorClient` loopback across palette, slash, CLI, and TUI, so
  that no surface diverges and no new dispatch path, catalog id, or catalog
  version is introduced.

### P2 — No leaked runtime config

- As an operator, I want the runtime-generated `packages/opencode/config.json`
  git-ignored so that a live CLI run can never leak the operator's real config
  or a plaintext secret into a commit.

## Functional Requirements

### Group 1 — MCP live reads (GAP E)

1. **Live server read port (FR1).** `createMcpServiceOverride`
   (`packages/opencode/src/operator/mcp/backend-live.ts:186`) MUST gain a
   `liveServerPort` that reads `MCP.Service.status()`
   (`packages/opencode/src/mcp/index.ts:165`) and `MCP.Service.clients()`
   (`:166`) and projects each server onto the content-free read model
   `{serverId, connection status, capabilities-present}`, backing
   `mcp.server.list`/`status`/`capabilities`. The projection MUST be faithful:
   the SSOT-only fields (CAS version, `auditId`, trust profile, timestamps)
   stay absent/null and are NEVER fabricated. No secret, raw token, header
   value, or filesystem path crosses this seam.
2. **Honest MCP read degradation (FR2).** The live server reads MUST be wrapped
   in a guarded `Effect.tryPromise` that degrades to the typed
   `mcp_unavailable` gap only when `MCP.Service` is genuinely unbound — never a
   fabricated success and never a leaked raw error.

### Group 2 — MCP mutation commit contract

3. **Config-backed MCP mutations via `mutation_plan` (FR3).** The MCP
   config-backed mutating verbs — `server.add`/`update`/`delete`,
   `logging.level.set`, `experimental.enable`/`disable`,
   `extension.enable`/`disable`, `resource.admin.policy.set` — MUST convert to
   the `OperatorMutationPlan` contract
   (`packages/opencode/src/operator/application/handler.ts`; the
   `telemetry-command-port.ts` `runPlan` helper and the Feature 014
   `langlock`/`jobs` conversions are the template) so `mutateAuthority` owns the
   single committed CAS write over the `store.config` MCP authority and the
   Feature 007 audit correlation. This eliminates the FR5 phantom-write trap
   (`mcp/backend-live.ts:128-135`) for these verbs. Reads are unchanged.
4. **Live-service MCP actions as plans (FR4).** The live-service MCP actions —
   `server.connect`/`disconnect`/`reconnect` — MUST dispatch as
   `OperatorMutationPlan`s whose `apply` calls the live `MCP.Service` connection
   APIs (`packages/opencode/src/mcp/index.ts`), returning an honest typed
   outcome (`success` reflecting the resulting `Status`, or a typed
   `mcp_unavailable`/`invalid_argument` gap). No self-committed `query` result
   and no phantom write.
5. **MCP auth headless verdict (FR5).** `mcp.auth.start`/`finish`/`remove` MUST
   be investigated against `McpAuth`
   (`packages/opencode/src/operator/mcp/backend-live.ts`,
   `packages/opencode/src/mcp/index.ts`): if the interactive OAuth flow can run
   headless through the operator, they convert to the `mutation_plan` contract;
   if it genuinely cannot, they stay typed capability gaps. Whichever is true
   MUST be recorded in ADR-0017 — never a fabricated success.

### Group 3 — OutputSpool production writer (GAP A, headline)

6. **Production spool writer (FR6).** A production writer subscribed at the
   session message-part seam (`packages/opencode/src/session/message-v2.ts`
   `PartUpdated`/`PartDelta` bus, `session.ts`, `processor.ts`) MUST drive
   `createChannelWriter` (`packages/opencode/src/outputspool/file-sink-writer.ts:139`)
   per channel generation, writing to the SAME control-store database path the
   operator reads (`<Global.Path.data>/outputspool/operator-control.db`,
   `stack-live.ts:413-428`). The writer MUST honor the Feature 005 producer
   ownership contract (`doc/arch/sdd/005-*/spec.md` C21 — the producer that owns
   a Feature 002 Process owns its OutputGroup) and the intended writer contract
   in `doc/arch/sdd/005-*/data-model.md`; it REUSES the shipped `outputspool/`
   machinery and does not re-author it.
7. **Real spool reads (FR7).** With the store populated, `output.stat` and
   `output.read` MUST reflect real session output over `control-store.ts` and
   `page-reader.ts`, replacing the empty-store gap.
8. **`output.follow` cursor-codec seam (FR8).** `output.follow` MUST gain its
   cursor-codec seam (`outputspool/backend-live.ts:103`, `FOLLOW_GAP`) so a
   follower streams committed pages from the populated store; a slow follower
   sees the Feature 005 backpressure/`eof` semantics, never blocking the writer.
9. **Admin edge for `release`/`delete`/`purge` (FR9).** `output.release`/
   `delete`/`purge` MUST act on the populated control store through an honest
   admin mutation edge (`outputspool/backend-live.ts:100-102`,
   `CONTROL_STORE_ONLY`). Because these are SQLite control-store operations, not
   config-CAS writes, ADR-0017 MUST record the chosen dispatch shape — either a
   control-store admin port whose plans commit through a store-scoped authority,
   or a documented non-CAS admin path with audit — and it MUST preserve the
   audit and no-phantom-write invariants.
10. **Bounded, crash-safe writer (FR10).** The writer MUST preserve the Feature
    005 durability and safety invariants it REUSES: bounded per-writer memory
    (queue + page, not O(total output)), stale-generation fencing (a superseded
    writer's append/seal is rejected), and seal/abort on cancel preserving
    committed bytes. No content byte is ever carried on an event; events stay
    content-free and secret-free (Feature 005 C22).

### Group 4 — Jobs occurrence projection (GAP F)

11. **Occurrence projection over `EventV2Bridge` (FR11).** `jobs.history`/
    `show-occurrences`/`watch` (`jobs/backend-live.ts:59-62`) MUST project the
    durable `job.*` occurrence events through the same `EventV2Bridge.Service`
    seam the lifecycle domain already uses
    (`lifecycle/stack-wiring.ts:180-259`), returning the bounded, content-free
    occurrence read model. No new store or executor is introduced.
12. **Bounded watch subscription (FR12).** `jobs.watch` MUST open a **bounded**
    subscription over the `EventV2Bridge` durable stream (bounded buffer,
    explicit close), mirroring the lifecycle watch pattern, so a slow consumer
    cannot grow memory without bound; it degrades to a typed `unavailable` when
    the bridge is unbound.

### Group 5 — Milvus registry binding (GAP D)

13. **Bind the index/provider override when configured (FR13).**
    `createLiveSemanticBackend` (`semantic/backend-live.ts`) MUST bind an
    `override.index`/`override.provider` over `semantic/milvus-adapter.ts`
    **when a Milvus endpoint is configured** (the config shape from the Feature
    006/009 corpus), backing `semantic.index`/`validate`/`reindex`/`cutover`
    against the live adapter under bounded gRPC probes
    (`semantic/grpc-probe.ts`, `url-guard.ts`). When no endpoint is configured,
    the verbs degrade to the same typed `milvus_unavailable` gap as today.
14. **Bounded probes, no fabrication (FR14).** Every Milvus-backed op MUST be
    guarded by a bounded probe/timeout and degrade to the typed
    `milvus_unavailable` envelope on any unreachable/timeout/error path — never
    a fabricated index state or a leaked endpoint/credential.

### Group 6 — Availability, boundaries, parity, and repo health

15. **TUI availability map updated to truth (FR15).** The palette per-verb
    classification (`packages/core/src/operator/palette.ts`,
    `OPERATOR_PERSISTING_DOMAINS`/`OPERATOR_PERSISTING_VERBS`/`persistenceFor`/
    `domainBadge`) MUST be UPDATED so the MCP and output verbs that now work
    flip from `honest_unavailable` to `persists_today` (or the domain to
    `partial` where it stays mixed). No verb may advertise persistence it still
    lacks, and no verb that now works may read as `unavailable`.
16. **Deferred edges stay typed gaps (FR16).** `jobs.run-now` (needs the Feature
    002 executor composition — `TaskProcessCoordinator` seam
    `jobs/trigger-service.ts:122-131` is never composed), the lifecycle
    process/task forced-abort `cancel` (`SessionRunCoordinator`
    `packages/core/src/session/run-coordinator.ts:14` is not exposed to the
    operator `AppRuntime`; first-press cancel is already real via
    `stack-wiring.ts:291-295`), and the Smart Routing consumption edge (repo
    rule: no Smart Routing implementation without explicit authorization) MUST
    remain typed capability gaps, with the boundary recorded in ADR-0017 — never
    fabricated or forced.
17. **Parity + registration invariant preserved (FR17).** This feature adds NO
    catalog id, bumps NO catalog version, introduces NO new dispatch path, and
    adds NO new flag: every verb rides the same `OperatorClient` loopback with
    unchanged command ids across palette/slash/CLI/TUI. Feature 007 stays the
    sole command-registration authority (Feature 007 FR11).
18. **Honest degradation + repo health (FR18).** Every read/mutation MUST
    degrade to a typed envelope (`unavailable`, `mcp_unavailable`,
    `milvus_unavailable`, `version_conflict`, `invalid_argument`) via a guarded
    effect — never a fabricated success, a synthesized effective state, or a
    phantom write. Secrets stay `SecretRef`-only; no error path leaks a secret,
    credential, endpoint, spool page body, or config payload fragment.
    `packages/opencode/config.json` MUST be git-ignored
    (`packages/opencode/.gitignore`) so a runtime-generated config can never be
    committed.

### Group 7 — Operator TUI editing: multi-field modals and detail view tree

19. **Multi-field edit modal (FR19).** A payload-carrying Configure verb MUST
    open a **multi-field form modal** — one labeled field per payload property —
    instead of the single-field raw-JSON prompt. Each field is pre-filled from the
    current effective value (via the read the Feature 015 `edit-descriptor.ts`
    already issues), validated per field, and enum properties (e.g. telemetry
    `transport` = `http/protobuf` | `grpc`) render as pickers. The Feature 015
    edit-descriptor/edit-modal machinery
    (`packages/tui/src/operator/form/edit-descriptor.ts`,
    `form/edit-modal.tsx`) is the base: extend the descriptor from ONE field to an
    **ordered field list**; the modal contract (title, in-modal error, busy state,
    Save/Cancel, `esc`) stays unchanged. A secret-bearing field is never pre-filled
    from a resolved value; its `SecretRef` is re-entered (FR11).
20. **Byte-exact payload composition, single dispatch (FR20).** On Save the modal
    MUST compose exactly the typed payload the port contract expects — byte-exact
    keys (the Feature 014 lesson: a `{ [field.key]: rawText }` spread that misses
    the port's canonical keys is rejected) — and dispatch ONCE through the same
    `executeOperatorCommand`/`OperatorClient` loopback. A payload the form cannot
    yet compose, or a per-field validation failure, MUST surface as an **in-modal
    error**, never a global toast, once the modal exists.
21. **Configure verb field coverage (FR21).** The multi-field modal MUST cover at
    least these verbs with their port-contract fields:
    - `telemetry.configure` — `endpoint` (URL text) + `transport` (picker:
      `http/protobuf` | `grpc`); `headers` stay `SecretRef`-only and MAY be
      deferred with an honest in-modal note.
    - `budget.set` — one numeric field per limit in the limits view
      (`maxTurns`/`maxContextTokens`/`maxOutputTokens`/`maxWorkers`/`tokenBudget`).
    - `pools.set` — a **bindings-list editor** (FR22).
    - `jobs.create`/`update` — the definition's core fields (name/schedule/enabled
      and the bounded definition parts), not a JSON blob.
    - `mcp.server.add`/`update` — `id`/`name`/`url`/`transport` fields.
    - `output.retention.set` — `ttlSeconds` (numeric) + `legalHold` (toggle);
      `output.quota.set` — `scope` (picker) + `maxBytes` (numeric).
    - `semantic.provider.add`/`update` — `name`/`baseUrl`/`newSecretRef`.
    - `routing.configure` — because the routing policy is a large document, a
      **structured sub-form for the common fields** (`enabled` toggle, `mode`
      picker) PLUS an explicit **advanced JSON field** carrying the remaining
      policy/`budgetPolicy` document as a labeled fallback; a bare unlabeled JSON
      prompt is never the only path. (Recorded in ADR-0017. Where the
      `routing.configure` port persistence is itself a documented backend
      boundary, the modal still replaces the raw prompt and surfaces the typed
      outcome in-modal.)
    Verbs absent from the field-list registry keep the honest single-field/empty
    behavior.
22. **`pools.set` bindings-list editor (FR22).** The `pools.set` modal MUST manage
    an **ordered list of binding rows**, each `{role: picker/text over the known
    role vocabulary, models: bounded add/remove list of model-id entries}`,
    pre-filled from the current `pools.show`/`status` `bindings`, with
    add-binding/remove-binding actions inside the modal. Save MUST compose exactly
    `{bindings: [{role, models}], expectedVersion}` — the shape
    `pools-command-port.ts` `parseBindings` and `PoolsSetInput`
    (`packages/protocol/src/pools/commands.ts`) require — and dispatch once; a
    payload it cannot compose surfaces the in-modal error (FR20).
23. **Detail view tree renderer (FR23).** The view modal MUST render the effective
    payload as an **indented key-value tree**: records and arrays expand to a
    bounded depth (≈4 levels) and a bounded total row count, with an honest
    truncation marker (`… N more`) when a bound is exceeded; scalars render
    verbatim under the existing string cap; NO `{n}`/`[n]` count placeholder
    appears at a depth within the bound. This is a **distinct contract** from the
    compact inline status strip (`status.ts` `toStatusNodes`/`formatStatusValue`),
    which keeps its bounded `{n}`/`[n]` one-line summary unchanged. The detail tree
    applies everywhere the view modal is used — detail verbs, probe results (e.g.
    `telemetry.test` `target`), and entity item views.

## Non-Functional Requirements

- **Reuse the shipped machinery.** The `MCP.Service` host, the `outputspool/`
  writer/reader/control-store, the `EventV2Bridge` durable seam, and the
  `semantic/milvus-adapter` stack are REUSED, not re-authored; the operator
  ports and the composition root wire onto them.
- **Bounded, content-free surfaces.** Reads project bounded, redacted summaries;
  no raw MCP header value, spool page body, endpoint credential, or config
  payload is surfaced. The writer and the watch subscription are memory-bounded.
- **Typed gaps over fabricated data.** Where a live dependency (a live Milvus,
  the Feature 002 executor, the lifecycle forced-abort edge, Smart Routing) is
  unreachable, the verb returns a typed capability gap — never synthesized state.
- **No new flag.** All work stays behind the existing operator control-plane
  flag (`OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`).
- **No new catalog id or dispatch path.** Feature 007 stays the sole command
  authority; availability is derived from backend readiness, not the catalog.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **Read live MCP server state.**
  Given `MCP.Service` is bound with one connected and one `needs_auth` server,
  When the operator runs `mcp.server.list`/`status`,
  Then the result reflects the live connection status and advertised
  capabilities, with CAS version / `auditId` / trust profile honestly absent,
  degrading to typed `mcp_unavailable` only when the service is genuinely unbound.

- **Commit an MCP config mutation through the shared authority.**
  Given `mcp.server.add` rides the `mutation_plan` contract,
  When the operator dispatches it through the full pipeline,
  Then `mutateAuthority` owns the single committed CAS write over the MCP config
  authority and no self-committed `query` result is rejected after a write.

- **Dispatch a live MCP connection action.**
  Given `mcp.server.reconnect` dispatches as a plan whose apply calls the live
  `MCP.Service`,
  When the operator reconnects a configured server,
  Then it returns an honest typed outcome reflecting the resulting `Status`,
  never a phantom write.

- **Spool and read real session output.**
  Given the production writer is subscribed at the session message-part seam,
  When a session produces output and the operator runs `output.stat`/`read`,
  Then the result reflects the real populated control store, and `output.follow`
  streams committed pages from it under the Feature 005 backpressure/`eof`
  semantics.

- **Administer the populated spool.**
  Given the control store is populated and the admin edge is wired,
  When the operator runs `output.release`/`delete`/`purge`,
  Then the op acts on the real control store through the chosen admin edge with
  audit preserved and no phantom write.

- **Project jobs occurrence history.**
  Given the `EventV2Bridge` durable seam is bound,
  When the operator runs `jobs.history`/`show-occurrences` and opens `jobs.watch`,
  Then the durable `job.*` occurrence events are projected as a bounded,
  content-free read model and the watch subscription is bounded and closable.

- **Bind the semantic index when Milvus is configured.**
  Given a Milvus endpoint is configured,
  When the operator runs `semantic.index`/`reindex`/`validate`/`cutover`,
  Then the op binds over the live `milvus-adapter` under bounded probes; with no
  endpoint configured it returns the typed `milvus_unavailable` gap.

- **Keep the deferred edges typed gaps.**
  Given the Feature 002 executor, the lifecycle forced-abort edge, and Smart
  Routing are out of scope,
  When the operator runs `jobs.run-now` or process/task `cancel`,
  Then each returns a typed `unavailable` capability gap with the boundary
  documented, never a fabricated success.

- **Show a truthful availability map.**
  Given the MCP and output verbs now work,
  When the grouped operator menu derives availability,
  Then those verbs read as `persists_today` (or the domain as `Partial` where it
  stays mixed) and no verb advertises a capability it still lacks.

- **Preserve command parity.**
  Given the same command id is dispatched from palette, slash, CLI, and TUI,
  When any wired verb is invoked,
  Then it rides the same `OperatorClient` loopback with no new dispatch path, and
  no catalog id is added and no catalog version is bumped.

- **No leaked runtime config.**
  Given a live CLI run generates `packages/opencode/config.json`,
  When git status is checked,
  Then the file is ignored and cannot be staged or committed.

- **Configure telemetry with a real multi-field form.**
  Given `telemetry.configure` is a payload-carrying Configure verb,
  When the operator opens its Configure modal,
  Then it shows a labeled `endpoint` field pre-filled from the current value and a
  `transport` picker (`http/protobuf` | `grpc`), and Save composes the byte-exact
  `{endpoint, transport}` payload and dispatches once — not a raw JSON prompt.

- **Edit pools bindings with the list editor.**
  Given `pools.set` opens the bindings-list editor pre-filled from `pools.show`,
  When the operator adds a `{role, models}` binding and saves,
  Then the modal composes exactly `{bindings:[{role,models}], expectedVersion}` and
  dispatches once, and any payload it cannot compose surfaces an in-modal error, not
  a global toast.

- **Configure routing without a bare JSON prompt.**
  Given the routing policy is a large document,
  When the operator opens `routing.configure`,
  Then it shows the structured common fields (`enabled` toggle, `mode` picker) plus
  a labeled advanced JSON field, never a bare unlabeled JSON prompt as the only path.

- **Read full detail in the view modal.**
  Given `telemetry.test` returns an effective payload with a nested `target` record,
  When the operator opens the view modal,
  Then `target` expands to its `endpoint`/`transport` fields as an indented tree to
  a bounded depth with honest `… N more` truncation, never a `{2}` placeholder,
  while the inline status strip keeps its compact `{n}` summary.

## Security Requirements

- **Data sensitivity/classification.** This feature reads live MCP connection
  status and advertised capabilities, session output pages (via authorized paged
  reads only), scheduled-job occurrence events, and semantic index/provider
  state, and mutates MCP config, the OutputSpool control store, and the semantic
  index. Reads project bounded, redacted summaries; the raw MCP header value,
  spool page body, resolved secret value, and Milvus endpoint credential are
  never surfaced. Session output content leaves the content plane only as an
  authorized paged `output.read`, never as an event payload (Feature 005 C22).
- **Authentication/authorization.** No new authenticated surface. Every verb
  rides the Feature 007 `OperatorClient` loopback and operator principal, scope,
  version/CAS, and confirmation gates; the wired backends register no command
  ids and cannot relax those gates. MCP reaches external servers only under the
  existing offline/SSRF policy and secret refs; the MCP auth verbs follow the
  ADR-0017 headless verdict.
- **Input validation.** The untrusted inputs are the MCP mutation payloads, the
  session message parts the writer consumes, the durable occurrence events, and
  the Milvus endpoint config. Payloads are schema-validated and rejected with a
  typed `invalid_argument` envelope on mismatch; a malformed message part,
  occurrence event, or endpoint config degrades to a typed
  `unavailable`/`milvus_unavailable` read, never a crash. The writer enforces
  stale-generation fencing and offset/backpressure bounds against a hostile or
  runaway producer.
- **Cryptography in transit/at rest.** No new at-rest secret store. MCP and
  semantic provider credentials stay `SecretRef` only, resolved by the Feature
  007 `SecretPort` at use time, never persisted or logged in plaintext. The
  Milvus gRPC probe uses the existing transport under the `url-guard` SSRF policy.
- **Logging/audit.** Mutations emit the Feature 007 audit correlation through the
  same EventV2 authority with content-free, bounded labels (command id, domain,
  outcome). The writer, the occurrence projection, and the admin edge record only
  bounded, typed outcomes — never a spool page body, MCP server secret, provider
  credential, or config payload fragment.
- **Error-handling information exposure.** Every failure path degrades to a typed
  envelope carrying only a bounded, secret-free reason. An unbound MCP service, a
  stale writer generation, an unreachable Milvus, an unbound `EventV2Bridge`, or a
  malformed input never leaks a stack trace, credential, endpoint, secret value,
  spool page body, or raw config fragment in a result, toast, or log.

## Domain Model

The capability-gap closure classes are specified as ValueObjects in
`doc/arch/schemas/operator-capability-gaps/` and the OutputSpool production
writer lifecycle as a statechart in
`doc/arch/statecharts/output-spool-writer.md`:

```
Closable gaps (wired now over shipped machinery)
  mcp.server.*   → LiveServerRead over MCP.Service status()/clients()   readiness: live    (FR1, FR2)
  mcp mutations  → mutation_plan (config) | live-action plan (connect)  readiness: live    (FR3, FR4, FR5)
  output.*       → SpoolWriter (message-part seam → createChannelWriter) readiness: live    (FR6-FR10)
  jobs history   → OccurrenceProjection over EventV2Bridge               readiness: live    (FR11, FR12)
  semantic index → MilvusBinding when endpoint configured                readiness: mixed   (FR13, FR14)

Deferred gaps (stay typed capability gaps by design)
  jobs.run-now   → Feature 002 executor composition (never composed)     readiness: gap     (FR16)
  lifecycle cancel (forced-abort) → SessionRunCoordinator not exposed    readiness: gap     (FR16)
  smart routing consumption edge  → out of scope (repo rule)             readiness: gap     (FR16)

Session output → message-part seam → ChannelWriter (per generation) → control store
               → operator-control.db (same path the operator reads)
               → output.stat/read/follow reflect real output (FR6-FR8);
               release/delete/purge act through the admin edge (FR9).

Every mutation carries a CasExpectation where config-backed; a live-service action
returns an honest typed outcome; an unreachable dependency → a typed capability gap
(unavailable | mcp_unavailable | milvus_unavailable); never a fabricated success or
phantom write (FR15-FR18).

Operator TUI editing (Group 7)
  Configure verb → EditFieldList (ordered fields; enum→picker; pools→BindingsEditor;
                   routing→structured + advanced-JSON) → byte-exact payload → single
                   dispatch; in-modal error, never a global toast (FR19-FR22)
  View modal     → DetailTree (bounded depth + rows, honest "… N more"), a DISTINCT
                   contract from the compact status strip's {n}/[n] summary (FR23)
```

## Observability

Operator dispatches continue to project through the Feature 007 EventV2 audit and
the ADR-0001 OTLP foundation with content-free, bounded labels (command id,
domain, surface, scope, outcome). The production spool writer reuses the Feature
005 writer-latency/read-latency observability; the occurrence projection and the
Milvus binding emit no telemetry of their own and record only bounded, typed
outcomes. No spool page body, MCP server secret, provider credential, Milvus
endpoint, or config payload is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Standing up the Feature 002 executor composition for `jobs.run-now`, exposing
  the lifecycle forced-abort `cancel` edge, or implementing the Smart Routing
  consumption edge — these stay typed capability gaps unless a future feature
  makes the dependency reachable (Smart Routing only under explicit authorization).
- Re-authoring the shipped machinery — the `MCP.Service` host, the `outputspool/`
  writer/reader/control-store, the `EventV2Bridge` seam, and the
  `semantic/milvus-adapter` stack are reused unchanged.
- Adding any catalog id, bumping the catalog version, or introducing a new
  dispatch path, parallel registry, or divergent command name.
- A new feature flag or an i18n/translation layer.
- App/Desktop parity (Feature 007 Phase 2), multi-user directory, vault backends,
  or a non-loopback operator API.

## Related Features and Decisions

- [ADR-0017 — Close the implementable operator capability gaps](../../adr/0017-close-the-implementable-operator-capability-gaps-so-the.md)
- [Feature 014 Complete the Operator Control Plane Persistence and Service](../014-complete-the-operator-control-plane-persistence-and-service/spec.md) — the backend-wiring precedent and the typed capability gaps this feature closes.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant (FR11), `mutateAuthority`/`OperatorMutationPlan`, the SecretPort seam.
- [Feature 005 OutputSpool](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — the writer/reader/control-store machinery wired by FR6-FR10 (producer ownership C21, content-free events C22).
- [Feature 002 Task Lifecycle Engine](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md) — the executor composition deferred by FR16.
- [Feature 003 Scheduled Jobs](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md) — the `job.*` occurrence events projected by FR11.
- [Feature 006 Semantic Retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — the Milvus adapter bound by FR13.
- [Feature 008 MCP Client](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — the `MCP.Service` host read/mutated by FR1-FR5.
- [Feature 011 Restructure the Operator Control Plane TUI](../011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md) — the grouped menu availability map refined by FR15.
- [Feature 015 Redesign the Operator TUI Domain Screens into CRUD](../015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md) — the single-field edit-modal/edit-descriptor machinery extended to multi-field by FR19-FR22, and the deferred multi-field modal now landed.
- [Feature 016 Polish the Operator Domain Screen Layout](../016-polish-the-operator-domain-screen-layout-so-the-screen-reads/spec.md) — the compact inline status strip (`toStatusNodes`) kept distinct from the FR23 detail view tree.
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Domain schema](../../schemas/operator-capability-gaps/enums.cue)
- [OutputSpool writer statechart](../../statecharts/output-spool-writer.md)

## Clarifications

### Session 2026-07-19

- **MCP auth headless verdict (FR5).** The interactive OAuth authorization-code
  flow (`mcp.auth.start`/`finish`) cannot run headless through the operator
  loopback (it needs a browser redirect + external callback) — it stays a typed
  capability gap. `mcp.auth.remove`, a local credential clear, converts to the
  `mutation_plan` contract if `McpAuth` exposes a clear/delete API (confirmed in
  implement). Recorded in ADR-0017.
- **`release`/`delete`/`purge` admin edge (FR9).** These are SQLite control-store
  ops, not config-CAS writes, so they commit through a **store-scoped authority**
  via the `mutation_plan` contract: the `apply` performs the store op and emits
  the Feature 007 audit correlation, but the settled version is the control-store
  generation, not a fabricated config CAS version — preserving audit +
  no-phantom-write. Recorded in ADR-0017.
- **`routing.configure` field contract (FR21).** Because the routing policy is a
  large document, the modal shows structured common fields (`enabled` toggle,
  `mode` picker) plus a labeled advanced-JSON fallback — never a bare unlabeled
  JSON prompt as the only path. Recorded in ADR-0017.
- **Phase order.** The operator-TUI editing group (multi-field modal + detail view
  tree) is the FIRST implementation phase — it is the user's burning pain on every
  screen — ahead of the backend gap groups. Reflected in plan.md and the task DAG.
- **Deferred edges (FR16).** `jobs.run-now` (Feature 002 executor composition,
  never composed), the lifecycle forced-abort `cancel` (`SessionRunCoordinator`
  not exposed to the operator `AppRuntime`), and the Smart Routing consumption edge
  (repo rule: no Smart Routing without explicit authorization) stay typed gaps.
