---
status: proposed
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0017 — Close the Implementable Operator Capability Gaps

## Context and Problem Statement

Feature 014 completed the operator control plane persistence and wired the
reachable service backends, deliberately leaving a documented set of **typed
capability gaps** — verbs that degrade to a typed `unavailable`/`mcp_unavailable`/
`milvus_unavailable` envelope because their live dependency was not yet wired. A
gap sweep (2026-07-19, every `file:line` verified) found that a well-defined
subset of those gaps is **implementable now** over machinery already shipped,
with no executor-composition or Smart Routing dependency, plus a class of
operator-TUI editing defects the user hit on every screen:

- **MCP reads** are gapped although `MCP.Service` exposes `status()`
  (`packages/opencode/src/mcp/index.ts:165`) and `clients()` (`:166`) with the
  `Status` union already typed (`:83-106`); the override
  (`stack-live.ts:496`) supplies only auth + resource ports
  (`mcp/backend-live.ts:186`).
- **MCP mutations** are all gapped by the FR5 phantom-write trap
  (`mcp/backend-live.ts:128-135`): the port returns `kind:"query"` which the
  dispatcher rejects for a `mutates` descriptor after any side effect.
- **The OutputSpool is never populated** — Feature 005 shipped the full
  `outputspool/` machinery (`createChannelWriter`, `file-sink-writer.ts:139`)
  but a grep confirms no production caller; the operator reads an empty
  `operator-control.db` (`stack-live.ts:413-428`). Session output already exists
  as message parts on a `PartUpdated`/`PartDelta` bus
  (`session/message-v2.ts`). `output.follow` and `release`/`delete`/`purge` stay
  gapped on their seams (`backend-live.ts:100-103`).
- **Jobs occurrence projection** is gapped (`jobs/backend-live.ts:59-62`)
  although the durable `EventV2Bridge` read/subscribe seam is already wired for
  lifecycle (`lifecycle/stack-wiring.ts:180-259`).
- **The Milvus registry binding** is gapped (`semantic/backend-live.ts:79-85`)
  although the full adapter stack is shipped (`semantic/milvus-adapter.ts` et al).
- **The operator TUI cannot actually configure a domain.** User screenshots show:
  the Telemetry/Routing `Configure` rows open a single-field **raw-JSON prompt**
  (Feature 015 deferred multi-field modals); the `telemetry.test` view modal
  collapses the nested `target` record to a `{2}` placeholder
  (`status.ts:61-62`, the compact strip renderer reused wrongly in the detail
  modal); and `pools.set` toasts `requires a bindings array of { role, models }`
  because the single field cannot compose the list payload
  (`pools-command-port.ts:77`).
- **A runtime-generated `packages/opencode/config.json`** repeatedly leaks into
  the working tree carrying the operator's real config plus plaintext secrets
  (deleted twice this campaign); it is not git-ignored.

The corpus mandates the end state: Feature 007 is the sole registration authority
(FR11) with real typed ports over the effective runtime; availability is derived
from backend readiness, not the catalog.

## Decision Drivers

- **Close what is reachable now.** Wire the gaps whose live dependency already
  exists in the codebase — no new executor, no Smart Routing, no new store.
- **The user's burning pain first.** The TUI cannot configure anything; the
  multi-field modal + detail view tree ship as the FIRST implementation phase.
- **One command authority (Feature 007 FR11).** No catalog id is added and no
  catalog version is bumped; only backend wiring, the TUI editing surface, and
  repo health are supplied.
- **No phantom writes.** Every mutating verb commits through `mutateAuthority` /
  `OperatorMutationPlan`; no backend self-commits a write the dispatcher rejects.
- **Typed gaps over fabricated data.** Where a live dependency (a live Milvus, the
  Feature 002 executor, the lifecycle forced-abort edge, Smart Routing) is
  unreachable, the verb returns a typed capability gap — never synthesized state.
- **Reuse the shipped machinery.** Wire onto the `MCP.Service` host, the
  `outputspool/` writer/reader/control-store, the `EventV2Bridge` seam, and the
  `semantic/milvus-adapter` stack; do not re-author them.
- **Byte-exact TUI payloads.** The Feature 014 lesson — a form must compose the
  port's canonical keys, not a naive `{ [field.key]: rawText }` spread.

## Considered Options

- **Close the implementable subset (MCP reads/mutations, spool writer, jobs
  projection, Milvus binding), ship the multi-field modal + detail view tree, and
  git-ignore the leaked config — keeping the executor/cancel/Smart-Routing edges
  typed gaps.** The honest completion of what is reachable; preserves the
  parity/registration invariants. **Chosen.**
- **Force the executor/cancel/Smart-Routing edges through a synthetic path.**
  Fabricates a capability the operator `AppRuntime` cannot reach; rejected — typed
  gaps are the honest surface.
- **Keep the single-field raw-JSON prompt.** Leaves the user unable to configure;
  rejected — the exact pain to close.
- **Expand the `{n}` compaction into the view modal too.** Rejected — the view
  modal's purpose is detail; the compact strip and the detail tree are distinct
  contracts.
- **Bump the catalog to mark the newly-working verbs.** Breaks the Feature 007
  registration invariant; rejected — availability derives from backend readiness.

## Decision Outcome

Chosen option: **"Close the implementable subset over the shipped machinery,
ship the TUI multi-field editing surface FIRST, git-ignore the leaked config, and
keep the executor/cancel/Smart-Routing edges typed capability gaps"**, because it
closes every gap whose live dependency is already reachable while preserving the
Feature 007 parity and registration invariants and fabricating nothing.

- **MCP live reads (FR1, FR2).** `createMcpServiceOverride`
  (`mcp/backend-live.ts:186`) gains a `liveServerPort` reading `MCP.Service.status()`
  + `clients()` and projecting `{serverId, connection status, capabilities-present}`.
  SSOT-only fields (CAS version, `auditId`, trust profile, timestamps) stay
  absent/null — never fabricated. Guarded reads degrade to `mcp_unavailable`.
- **MCP mutations (FR3, FR4, FR5).** The config-backed MCP verbs
  (`server.add`/`update`/`delete`, `logging.level.set`,
  `experimental.enable`/`disable`, `extension.enable`/`disable`,
  `resource.admin.policy.set`) convert to the `OperatorMutationPlan` contract over
  the `store.config` MCP authority; the live-service actions
  (`server.connect`/`disconnect`/`reconnect`) dispatch as plans whose `apply`
  calls the live `MCP.Service` connection APIs with honest typed outcomes.

  **MCP auth headless verdict (FR5, flagged decision).** The interactive OAuth
  authorization-code flow (`mcp.auth.start`/`finish`) requires a browser redirect
  and an external callback that the operator loopback dispatch **cannot drive
  headless** in this wave — it stays a **typed capability gap**. `mcp.auth.remove`
  is a *local credential clear* (no external round-trip) and converts to the
  `mutation_plan` contract IF `McpAuth` exposes a clear/delete API; the implement
  phase confirms the API surface and records the final split in `tasks.md`. No
  fabricated success on any auth verb.
- **OutputSpool production writer (FR6-FR10).** A production writer subscribed at
  the session message-part seam (`session/message-v2.ts` `PartUpdated`/`PartDelta`)
  drives `createChannelWriter` per channel generation, writing to the SAME
  `operator-control.db` the operator reads. It honors the Feature 005 producer
  ownership (C21) and content-free events (C22), reuses the writer-queue/reconciler
  machinery, and preserves bounded memory + stale-generation fencing + seal/abort
  on cancel. `output.stat`/`read` then reflect real output; `output.follow` binds
  its cursor-codec seam.

  **`release`/`delete`/`purge` admin edge (FR9, flagged decision).** These are
  SQLite control-store operations, not config-CAS writes, so they **cannot**
  commit through the config-CAS authority (`CONTROL_STORE_ONLY`,
  `backend-live.ts:100-102`). Chosen: a **control-store admin port whose plans
  ride the `OperatorMutationPlan` contract but commit through a store-scoped
  authority** — the `apply` performs the control-store op and returns the typed
  outcome, and the mutation emits the Feature 007 EventV2 audit correlation, but
  the settled "version" is the control store's own generation/settlement token,
  NOT a fabricated config CAS version. This preserves both invariants: the audit
  is emitted through the single authority, and no phantom config write occurs. A
  bare non-CAS admin path without audit was rejected as it would drop the audit
  correlation.
- **Jobs occurrence projection (FR11, FR12).** `jobs.history`/`show-occurrences`/
  `watch` project the durable `job.*` occurrence events through the same
  `EventV2Bridge.Service` seam the lifecycle domain uses; `watch` opens a bounded,
  closable subscription and degrades to `unavailable` when the bridge is unbound.
- **Milvus registry binding (FR13, FR14).** `createLiveSemanticBackend` binds an
  `override.index`/`override.provider` over `milvus-adapter` when a Milvus endpoint
  is configured (Feature 006/009 config shape), under bounded gRPC probes and the
  `url-guard` SSRF policy; unconfigured degrades to the same typed
  `milvus_unavailable` gap. Semantic stays a mixed domain.
- **Operator TUI editing, FIRST phase (FR19-FR23).** The Feature 015
  edit-descriptor/edit-modal machinery is extended from ONE field to an **ordered
  field list**; enum properties render as pickers; `pools.set` gets a
  **bindings-list editor** composing exactly `{bindings:[{role,models}],
  expectedVersion}`; Save composes the byte-exact port payload and dispatches once;
  a payload the form cannot compose surfaces an **in-modal error**, never a global
  toast. The view modal gains a **detail tree renderer** (bounded depth ≈4 +
  bounded rows + `… N more`) as a contract DISTINCT from the compact status strip
  (`status.ts` `toStatusNodes`/`formatStatusValue`), which keeps its `{n}`/`[n]`
  one-line summary.

  **`routing.configure` field contract (FR21, flagged decision).** The routing
  policy is a large document (`enabled`/`mode` plus the full policy/`budgetPolicy`
  per `packages/protocol/src/routing/index.ts`). Chosen: a **structured sub-form
  for the common fields** (`enabled` toggle, `mode` picker) PLUS an explicit
  **advanced JSON field** carrying the remaining document as a labeled fallback — a
  bare unlabeled JSON prompt is never the only path. Where the `routing.configure`
  port persistence is itself a documented backend boundary, the modal still
  replaces the raw prompt and surfaces the typed outcome in-modal.
- **Repo health (FR18).** `packages/opencode/config.json` is git-ignored via
  `packages/opencode/.gitignore` so a runtime-generated config can never be
  committed.
- **Parity preserved (FR17).** No new catalog id, no catalog version bump, no new
  dispatch path or flag; command ids unchanged.

The capability-gap closure classes are specified as ValueObjects in
`doc/arch/schemas/operator-capability-gaps/` and the OutputSpool production
writer lifecycle as a statechart in `doc/arch/statecharts/output-spool-writer.md`.

### Consequences

#### Positive

- The operator can finally configure every domain with a real labeled form, read
  full detail in the view modal, and see real MCP/output/jobs/semantic state.
- Every mutating verb commits through the single `mutateAuthority` path; the
  phantom-write trap is eliminated for the newly-wired verbs.
- Feature 007 stays the sole registration authority: no catalog id or version
  changes; availability derives from backend readiness.

#### Trade-offs

- The OutputSpool writer subscribes at the session message-part seam
  (`packages/opencode/src/session/**`), a shared runtime seam — the write access is
  scoped narrowly to the writer hook and recorded in the guard block.
- The control-store admin edge commits through a store-scoped authority rather than
  config-CAS; the settled token is the store's own generation, documented here to
  avoid any false-CAS reading.
- Semantic stays a mixed domain; the palette classification carries the per-verb
  `Partial` granularity to keep the badge truthful.
- The MCP interactive-OAuth auth verbs, the executor edge (`jobs.run-now`), the
  lifecycle forced-abort `cancel`, and the Smart Routing consumption edge remain
  typed gaps (documented, not fabricated).

#### Follow-ups

- Feature 017 `plan`/`tasks` implement the TUI editing surface first, then the MCP
  reads/mutations, the spool writer + reads + admin edge, the jobs projection, the
  Milvus binding, the availability-map flip, the guard-scope + `.gitignore`, and
  the tests.
- A live Milvus deployment, the `jobs.run-now` executor edge, the lifecycle
  forced-abort edge, and the Smart Routing consumption edge remain open for future
  features once those dependencies are reachable from the operator `AppRuntime`.

## Superseding decision — fix-round (2026-07-19)

An adversarial review of the landed backend work found the "no phantom writes" and
"the operator reads real output" outcomes were only PARTIALLY realized. Three
defects, and the honest fix now recorded as superseding the relevant clauses above:

- **The store-scoped / live-service op ran at plan-BUILD time, before the CAS
  checks (supersedes the `release`/`delete`/`purge` and `server.connect`/`disconnect`/
  `reconnect` + `auth.remove` clauses).** The plan's `apply` was described as "performs
  the control-store op", but in code the op executed inside the effect that BUILT the
  plan — i.e. at `dispatcher.ts` `handler(ctx)`, BEFORE `mutateAuthority`'s
  contract/idempotency/CAS validation. A second op on a shared authority
  (`global:output-admin`/`global:mcp-connections`/`global:mcp-auth`) destroyed data and
  then failed CAS, and an idempotent replay re-ran the destructive op. **Fix:**
  `OperatorMutationPlan` gains an optional `effect` (`packages/opencode/src/operator/
  application/handler.ts`). `mutateAuthority` runs it EXACTLY ONCE, AFTER contract +
  idempotency-claim + CAS-precondition validation and BEFORE the committed CAS write;
  a typed failure aborts with an envelope and commits nothing, and an idempotent replay
  returns the stored result WITHOUT running the effect. The non-destructive pre-read
  (`require`) stays at plan build so `not_found` still fails before any op. The pure
  config-backed plans keep `effect` unset and stay pure.

- **The preflight resolved the wrong authority (new decision).** The mutation preflight
  read `commandId.split(".")[0]`, which never equals the shared global authority a plan
  commits to, so the client threaded the wrong `expectedVersion` and every 2nd mutation
  on a shared authority failed `mutations require version` (this also broke the
  pre-existing Feature 014 verbs, e.g. a 2nd `telemetry.configure`). **Fix:** a per-command
  authority registry (`packages/opencode/src/operator/application/command-authority.ts`)
  SOURCED from the domains — static authorities are the domain modules' own exported
  constants, scope-dependent ones use the SAME resolver lambdas the composition root
  binds to the backends. It is threaded into the preflight through every operator surface
  (HTTP handler, the trusted worker fetch, the in-process TUI slash port); the client
  sends the resolved scope so a scope-dependent authority matches. Unknown ids fall back
  to the prefix (no regression).

- **The production spool writer was unreachable in normal sessions (supersedes the
  "writer subscribed at the session message-part seam" placement).** The subscription
  lived only inside the lazy `createLiveOperatorStack`, so a session that never opened
  the operator never spooled, and output before first operator access was lost. **Fix:**
  a process-wide singleton bootstrap (`packages/opencode/src/outputspool/
  spool-process-writer.ts`) armed eagerly at server start (`server.ts`), independent of
  the operator stack; the operator stack REUSES the one store + subscription (never a
  second `operator-control.db` connection or a duplicate GlobalBus listener). Fail-open.

All three preserve the invariants: every mutating verb still commits through the single
`mutateAuthority` path, nothing is fabricated on a rejected mutation, and no catalog id
or version changes.

## Related

- Feature specification: [017 Close the Implementable Operator Capability Gaps](../sdd/017-close-the-implementable-operator-capability-gaps-so-the/spec.md)
- Backend-wiring precedent + gaps closed: [014 Complete the Operator Control Plane Persistence and Service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- OutputSpool machinery: [005 Output Spool](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Executor composition deferred: [002 Task Lifecycle Engine](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Occurrence events: [003 Scheduled Jobs](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Milvus adapter: [006 Semantic Retrieval](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- MCP client host: [008 MCP Client](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- Edit-modal machinery extended: [015 Redesign the Operator TUI Domain Screens into CRUD](../sdd/015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md)
- Compact status strip kept distinct: [016 Polish the Operator Domain Screen Layout](../sdd/016-polish-the-operator-domain-screen-layout-so-the-screen-reads/spec.md)
- Domain schema: [operator-capability-gaps ValueObjects](../schemas/operator-capability-gaps/enums.cue)
- Writer statechart: [output-spool-writer](../statecharts/output-spool-writer.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0014 — Complete the Operator Control Plane Persistence and Service](0014-complete-the-operator-control-plane-persistence-and-service.md)
