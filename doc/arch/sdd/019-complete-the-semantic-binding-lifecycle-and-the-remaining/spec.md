---
id: 019f7dbd-d96d-7a00-95a2-87f52ccb82ed
number: 019
slug: complete-the-semantic-binding-lifecycle-and-the-remaining
status: implemented
created_at: 2026-07-20T04:17:01.805195Z
---
# Feature Specification: Complete the Semantic Binding Lifecycle and the Remaining Operator Residuals

Feature: 019-complete-the-semantic-binding-lifecycle-and-the-remaining
Created: 2026-07-20
Scope: Features 006 and 009 shipped the **complete semantic binding lifecycle
contract** (Feature 006 FR32 owns select/validate/reindex/cutover/rollback; Feature
009 reuses it verbatim so the `tools` collection cuts over atomically with
`agents`/`skills`/`skill_chunks`), and the **pure engines already exist**
(`packages/opencode/src/semantic/cutover-executor.ts` — `cutoverReranker`,
`cutoverEmbedding`/`rollbackEmbedding`; `packages/core/src/semantic/binding-lifecycle.ts`
— the typed `TRANSITIONS` machine). But the **operator activation is never composed**:
the reranker cutover/rollback route through the gated Milvus backend instead of the
config-backed registry, the operator `RegistryDocument` carries a single binding entry
per slot with a hardcoded `full_semantic` `bindingStatus` rung and no superseded target
for a rollback, the operator runtime binds `createGrpcMilvusAdapter({})` with **no gRPC
client** (every Milvus op resolves `reachable:false`), the reindex/reconcile live-doc
source and the enumerate-indexed-docs seam are absent, the MCP interactive-OAuth
auth/subscription/badge edges stay typed gaps, and the OTLP telemetry sink is built
**offline** so `telemetry.on` flips config but no signal is ever sent. This feature
**completes the lifecycle and the remaining residuals** by composing what already
exists: it activates the config-backed reranker cutover/rollback over a per-slot binding
**version archive** (Group A), binds a **live Milvus port** and physically builds and
validates a **blue/green generation** before an embedding alias swap plus wires the
reindex/reconcile live-doc source (Group B), completes the MCP delegation edges (Group
C), and composes a **real, eager, fail-open OTLP export pipeline** (Group D). Feature 007
remains the sole command-registration authority: no catalog id is added, no catalog
version is bumped, no new dispatch path or flag is introduced. Every completed verb rides
the same `OperatorClient` loopback; every unreachable dependency (an unconfigured Milvus
endpoint, a headless auth surface, a disabled telemetry config) degrades to the **exact
same typed capability gap** it returns today — never fabricated state. The **cardinal
honesty rule** (Feature 006 FR12/FR32) holds throughout: an embedding cutover is NEVER a
config-only alias flip — a generation is physically built and validated in Milvus before
the alias swaps; `select`/`reindex` alone never activate.

## Problem

A gap sweep (2026-07-20, every fact `file:line` verified this session) found the
semantic lifecycle contract and its pure engines shipped, but the operator activation
uncomposed, and three adjacent operator surfaces left at honest — but incomplete —
typed gaps:

### Group A — Reranker lifecycle activated over a config-backed archive

- **The pure engine is idle.** `cutoverReranker`
  (`packages/opencode/src/semantic/cutover-executor.ts:113-118`) is a pure decision that
  takes **no `MilvusPort`** and returns `committed`/`confirmation_required`, invalidating
  the rerank cache/eval version with `reEmbedded: false`; the typed `TRANSITIONS` table
  (`packages/core/src/semantic/binding-lifecycle.ts:56-63`) already types the legal
  `staged → active` cutover and the `active → active` rollback self-loop. But
  `semantic-command-port.ts` `rerankerInvoke` (`:243-244`) routes
  `semantic.reranker.cutover`/`rollback` through the **gated Milvus backend** `b` instead
  of the config-backed registry `c.registry` (the `planSelect` precedent at
  `registry-backend.ts:403-418` shows the config-backed path). A reranker change needs no
  Milvus, yet it rides the Milvus gap.
- **The archive is single-entry.** `registry-backend.ts` `bindingHistory` (`:285-291`)
  returns a **single** slot entry, `bindingStatus` (`:281`) hardcodes the degradation
  rung to `full_semantic`, and no superseded version is retained — so a rollback has **no
  real target** and history/status are not truthful.

### Group B — Embedding cutover, generation build, and reconcile composed against a live Milvus

- **The embedding executor is complete but has no live port.** `cutoverEmbedding`
  (`:58-78`) and `rollbackEmbedding` (`:90-102`) are pure CAS decisions that then call
  `deps.milvus.swapAliases`, but the operator runtime binds
  `MilvusAdapter.createGrpcMilvusAdapter({})` with **no gRPC client**
  (`packages/opencode/src/operator/stack-live.ts:513-537`) so every op resolves an honest
  `reachable:false` and there is no persisted generation/alias/CAS state.
- **Three reindex/reconcile seams are missing.** `runReconcile`
  (`packages/opencode/src/semantic/index-jobs.ts:131-155`) already diffs a live
  `LiveDoc[]` against an indexed `IndexedDoc[]` and applies upserts/tombstones through the
  `MilvusPort`, but (1) only the tool live-doc builder `toolLiveDoc` (`:85`) is bound — no
  agent/skill builder exists and nothing reads prior indexed state; (2) the `MilvusPort`
  (`milvus-adapter.ts:113-119` — `search`/`upsert`/`tombstone`/`health`/`swapAliases`
  only) lacks an **enumerate-indexed-docs** `{canonicalId, contentHash}` method and a
  **createCollection/buildGeneration** for the blue/green reindex; (3) the embedding
  client (`embedding-client.ts` `probe`/`embed`) is not bound from the operator runtime.

### Group C — MCP delegation edges completed

- **auth.start/finish stay typed gaps** (`operator/mcp/backend-live.ts:68-73`,
  `NOT_BOUND`) because ADR-0017 scoped them for a headless loopback actor — but the
  **interactive OAuth flow is fully real**: `MCP.Service.startAuth(serverId)`
  (`mcp/index.ts:827`) returns `{authorizationUrl, oauthState}`,
  `McpOAuthCallback.ensureRunning` (`oauth-callback.ts:105`) starts a **loopback callback
  server**, and `finishAuth` (`index.ts:939`) completes the exchange. The **TUI is
  interactive**, so the flow can be delegated.
- **resource.admin.subscribe/unsubscribe stay gaps** (`backend-live.ts:79-80`) even though
  the SDK client exposes `subscribeResource`/`unsubscribeResource` (probed at
  `sdk-probe.ts:24-25`) and a pure dual-authority subscription machine exists
  (`packages/core/src/mcp/subscription-machine.ts`, `resource-adapter.ts:104`
  `beginSubscribe`) — but **no code path connects the machine to a live client** and there
  is no `resources/updated` notification wiring.
- **Experimental/Extension toggle badges read `Unknown`** because `mcp.experimental.status`/
  `mcp.extension.status` are permanent gaps (`backend-live.ts:90-100`) never overridden by
  `createMcpServiceOverride`, and the live server read (`LiveServerRead`,
  `backend-live.ts:217-229`) has **no field** for the config-backed flag state.
- **Live-list is same-instance and correct-for-context.** The operator `AppRuntime`
  (`packages/opencode/src/effect/app-runtime.ts:35,94` — a module-level singleton) is the
  **same** instance the interactive CLI/TUI worker resolves `MCP.Service` through
  (`stack-live.ts:21,543-544`, the Feature 013 `InstanceRef` binding). An empty
  `mcp.server.list` genuinely reflects that process having no connected servers — **not a
  wiring bug** (recorded here so the spec does not chase a phantom fix).

### Group D — Real OTLP telemetry export activated

- **The export sink is built offline.** `stack-live.ts:354-361` builds the routing OTLP
  sink from effective config but calls `createOtlpAdapter({config, secret})` with **no
  transport**, so the adapter uses `createUnavailableTransport` (permanently
  `{ok:false}`) and the effective config is a frozen snapshot resolved once. `telemetry.on`
  flips `config.enabled` (visible via `telemetry.status`) but **no export fiber ever runs
  and nothing is sent**. The bounded `BoundedExportQueue`
  (`packages/core/src/observability/otlp.ts:145` — capacity/batch/drop) already exists, but
  **no real transport** (http/protobuf or grpc) is implemented, **retry-budget enforcement
  is absent**, and there is **no push-based config-invalidation seam** (`ConfigPort` has no
  `subscribe`/`onChange`), so a re-arm on config change must be pull-based.

Leaving these residuals means the semantic surface advertises a reranker cutover that
rides the Milvus gap, a rollback with no target, an embedding cutover that cannot reach a
live index, an MCP surface that gaps auth/subscription/badges it could complete, and a
telemetry toggle that sends nothing. The fix is a **composition** over machinery that
already exists — with no new executor, no Smart Routing, and no new catalog id or dispatch
path.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Reranker cutover/rollback activate without Milvus (Group A)

- As an operator, I want `semantic.reranker.cutover`/`rollback` routed through the
  config-backed registry so that activating a new reranker version invalidates the rerank
  cache/eval version under CAS + confirmation with **no re-embedding** and **no Milvus
  dependency**, and a rollback restores a real archived prior — never the Milvus gap and
  never a fabricated swap.

### P1 — A rollback has a real target and history is truthful (Group A)

- As an operator, I want the operator `RegistryDocument` extended with a per-slot binding
  **version archive** (the current version plus its superseded priors) so that
  `bindingHistory`/`bindingStatus` reflect real data and a rollback targets a real archived
  prior; a cutover without a validated staged candidate is a typed `not_validated`, and a
  rollback with no archived prior is a typed rejection.

### P1 — An embedding cutover physically builds a generation against a live Milvus (Group B)

- As an operator, I want a **live `MilvusPort`** bound when a Milvus endpoint is configured
  and a blue/green **generation physically built and validated** before the embedding alias
  swaps, so that `semantic.embedding.cutover`/`rollback` activate real index state under
  CAS + confirmation — never a config-only alias flip — while an unconfigured endpoint
  degrades to the exact same typed `milvus_unavailable` gap as today.

### P1 — Reindex/reconcile diff real live and indexed state (Group B)

- As an operator, I want the reindex/reconcile live-doc source (agent/skill builders
  joining the shipped tool builder), the enumerate-indexed-docs seam, and the embedding
  client bound from the operator runtime, so that `semantic.index.reindex`/`reconcile` diff
  real live docs against real indexed state and report content-free counts with the pinned
  binding version **unchanged** — a scheduled reconcile never re-pins.

### P1 — Live validation against a real Milvus endpoint

- As an operator, I want an env-gated integration path that exercises probe +
  create-generation + upsert + enumerate + swapAliases against a **live Milvus endpoint**
  so that the composition is proven against real infrastructure; unit tests use a fake port
  and CI never requires the live endpoint.

### P1 — Complete the MCP auth delegation (Group C)

- As an operator on the **interactive TUI**, I want `mcp.auth.start` to return the authorize
  URL and start the loopback callback listener and `mcp.auth.finish` to complete the
  exchange, delegating to the existing interactive OAuth flow, while a **headless** surface
  (CLI `--json`, HTTP) keeps the honest typed gap and no secret material crosses an envelope.

### P1 — Complete the MCP resource subscription and truthful badges (Group C)

- As an operator, I want `mcp.resource.admin.subscribe`/`unsubscribe` to drive the existing
  dual-authority subscription machine over a subscribe-capable client, and the `mcp` status
  read to carry the config-backed experimental/extension flag state so badges render
  `Enabled`/`Disabled` instead of `Unknown` — and where the client genuinely lacks the
  subscription capability, a fail-closed honest boundary is recorded rather than a fabricated
  subscription.

### P1 — Real telemetry export (Group D)

- As an operator, I want a **real OTLP export pipeline** composed eagerly and fail-open when
  the effective telemetry config has `enabled=true`, so that at least one real signal
  actually reaches the configured collector; `telemetry.off`/`configure` re-arm or stop the
  pipeline, `disabled` runs no fiber and touches no network, and a slow/unreachable collector
  never affects the session loop.

### P1 — Truthful availability after landing

- As an operator, I want each completed verb's palette availability to flip to the composed
  truth, and any verb that stays genuinely gapped (an unconfigured Milvus, a headless auth
  surface) to stay `honest_unavailable` — no verb advertises a capability it lacks, and no
  verb that now works reads as `unavailable`.

### P2 — Parity across surfaces

- As an operator, I want every completed verb to ride the same command id and the same
  `OperatorClient` loopback across palette, slash, CLI, and TUI, so that no surface diverges
  and no new dispatch path, catalog id, or catalog version is introduced.

## Functional Requirements

### Group A — Reranker lifecycle over a config-backed archive (FR1–FR3)

1. **Route reranker cutover/rollback through the config-backed registry (FR1).**
   `semantic.reranker.cutover` and `semantic.reranker.rollback`
   (`semantic-command-port.ts` `rerankerInvoke`, `:243-244`) MUST route through the
   config-backed registry (`c.registry`, mirroring the `planSelect` precedent at
   `registry-backend.ts:403-418`) as `OperatorMutationPlan`s committed by `mutateAuthority`
   under CAS + operator confirmation — NOT through the gated Milvus backend. A reranker
   cutover MUST reuse the pure `cutoverReranker` decision (no `MilvusPort`), invalidate the
   rerank cache/eval version, and set `reEmbedded: false`; the vector index is untouched.
2. **Per-slot binding version archive (FR2).** The operator `RegistryDocument` MUST be
   extended with a per-slot binding **version archive** — the current version plus its
   superseded predecessors (`#BindingVersionArchive`) — so `bindingHistory`
   (`registry-backend.ts:285-291`, currently single-entry) returns the real archive, and
   `bindingStatus` (`:281`) reports the real degradation rung instead of a hardcoded
   `full_semantic`. The archive is the source of truth a rollback targets.
3. **Honest gating for cutover and rollback (FR3).** A reranker/embedding cutover without a
   **validated** staged candidate MUST return a typed `not_validated`; a rollback with **no
   archived prior** in the slot's superseded set MUST return a typed `no_archived_prior`
   rejection; a CAS contention MUST swap nothing (`cas_conflict`); an unconfirmed activation
   MUST return `confirmation_required`. No path fabricates a swap.

### Group B — Embedding cutover, generation build, and reconcile against a live Milvus (FR4–FR7)

4. **Bind a live `MilvusPort` when configured (FR4).** When `OPENCODE_SEMANTIC_MILVUS_ADDRESS`
   is configured, the operator composition MUST bind a **real Milvus gRPC/HTTP client**
   (replacing `createGrpcMilvusAdapter({})` at `stack-live.ts:513-537`) and persist the
   generation/alias/CAS state the embedding cutover/rollback need. When it is **unconfigured**,
   every index/binding verb MUST degrade to the **exact same** typed `milvus_unavailable`
   envelope it returns today (the current honest floor) — never a fabricated healthy endpoint.
5. **Physically build and validate a generation before an alias swap (FR5).** An embedding
   cutover MUST honor the **cardinal honesty rule** (Feature 006 FR12/FR32): a blue/green
   generation is **physically built and validated in Milvus** (`building → validated → live`,
   `#IndexGeneration`/`#GenerationBuild`) before `cutoverEmbedding` swaps the alias under CAS +
   confirmation across **every** collection together (`agents`/`skills`/`skill_chunks`/`tools`
   never split, Feature 006 C12). `select`/`reindex` alone MUST NOT activate the live alias.
6. **Add the two missing `MilvusPort` methods and the live-doc source (FR6).** The `MilvusPort`
   MUST gain an **enumerate-indexed-docs** method returning `{canonicalId, contentHash}` per
   collection AND a **createCollection/buildGeneration** for the blue/green reindex; the
   reindex/reconcile live-doc source MUST bind agent/skill builders alongside the shipped
   `toolLiveDoc`, and the embedding client (`embedding-client.ts` `probe`/`embed`) MUST be bound
   from the operator runtime, so `runReconcile` (`index-jobs.ts:131-155`) diffs a real
   `LiveDoc[]` against a real enumerated `IndexedDoc[]`.
7. **Content-free reconcile that never re-pins (FR7).** A `semantic.index.reindex`/`reconcile`
   MUST report a bounded, content-free `#ReconcilePlan` (upserted/tombstoned/unchanged counts)
   with the pinned binding version carried **unchanged** — a scheduled reconcile never re-pins
   the binding (`RepinnedBinding: false`, Feature 006 FR13). A Milvus gap propagates as a typed
   `milvus_unavailable`, never a crash.

### Group C — MCP delegation edges completed (FR8–FR10)

8. **Delegate interactive-OAuth auth, keep the headless gap (FR8).** `mcp.auth.start` MUST, for
   an **interactive TUI** surface, return the authorize URL and start the loopback callback
   listener by delegating to `MCP.Service.startAuth` (`mcp/index.ts:827`,
   `McpOAuthCallback.ensureRunning`); `mcp.auth.finish` MUST complete the exchange via
   `MCP.Service.finishAuth` (`:939`). A **headless** surface (CLI `--json`, HTTP) MUST keep the
   honest typed capability gap (the ADR-0017 boundary). No token or secret material crosses an
   operator envelope; the authorize URL is not a secret.
9. **Complete the resource subscription over the existing machine (FR9).**
   `mcp.resource.admin.subscribe`/`unsubscribe` MUST drive the existing pure dual-authority
   subscription machine (`subscription-machine.ts`, `resource-adapter.ts` `beginSubscribe`) over
   a **subscribe-capable** client (SDK `subscribeResource`/`unsubscribeResource`), gated by both
   the server `resources.subscribe` capability and the operator grant, with `resources/updated`
   notification handling. Where the client genuinely lacks the capability, the verb MUST return
   a fail-closed `capability_absent` honest boundary — never a fabricated subscription.
10. **Truthful experimental/extension badges (FR10).** The `mcp` status read MUST carry the
    config-backed experimental/extension flag **state** (from the operator's config-backed SSOT
    the toggles write) so a connected server's Experimental/Extension badges render
    `Enabled`/`Disabled` instead of `Unknown`. The distinction between the operator's
    config-backed flag doc and the runtime `cfg.mcp` schema (which has no such field) is recorded
    as a documented boundary; the badge reflects the config-backed flag the operator toggle owns.

### Group D — Real OTLP telemetry export activated (FR11–FR13)

11. **Compose an eager, fail-open export pipeline (FR11).** When the effective telemetry config
    has `enabled=true`, a **process-singleton** OTLP export pipeline MUST compose eagerly (at
    server start and on a `telemetry.*` config mutation), mirroring the Feature 017
    `ensureProcessSpoolWriter` (`spool-process-writer.ts:39-56`) and Feature 018
    `ensureExecutorComposition` (`executor-composition.ts:504-519`) eager, idempotent, fail-open
    precedent. It MUST bind a **real transport** (`http/protobuf` via fetch or the adapter
    transport; `grpc` if supported) to the configured endpoint, replacing the offline
    `createUnavailableTransport` at `stack-live.ts:354-361`. A `disabled` config runs **no fiber
    and touches no network**; a `telemetry.off`/`configure` re-arms or stops the pipeline
    (pull-based re-resolution — no push invalidation seam exists today). `telemetry.test` stays
    the reachability probe.
12. **Honor the bounded queue, drop policy, retry, and redaction contract (FR12).** The pipeline
    MUST honor the Feature 001 pipeline contract: the bounded `BoundedExportQueue`
    (capacity/batch/`drop`|`backpressure`/enqueue+export timeouts), retry-budget enforcement (the
    `retry_budget` today unread), and the **redaction defaults** — `prompts`, `secrets`,
    `file_paths`, `file_content`, `tool_payloads` all excluded (defensive posture) so no prompt,
    secret, path, file content, or tool payload leaves the process. An export failure or an
    unreachable endpoint MUST apply the drop policy and NEVER block or affect the session loop.
13. **Live telemetry validation (FR13).** An **env-gated** integration path MUST enable telemetry
    against a **live OTLP collector**, emit at least one real signal (e.g. a session/operator
    counter, and a log/trace if the pipeline supports them), and verify ingestion by querying the
    collector's downstream. Unit tests MUST use a **fake transport**; CI MUST NOT require the live
    endpoint.

### Group E — Availability, invariants, and boundaries (FR14–FR16)

14. **Availability flip to truth (FR14).** The palette per-verb classification
    (`packages/core/src/operator/palette.ts`) MUST be updated so each completed verb
    (`semantic.reranker.cutover`/`rollback`, `semantic.embedding.cutover`/`rollback`,
    `semantic.index.reindex`/`reconcile`, `mcp.auth.start`/`finish`,
    `mcp.resource.admin.subscribe`/`unsubscribe`, the mcp badges, `telemetry.on` export)
    reflects the composed truth, and any verb that stays genuinely gapped (an unconfigured
    Milvus, a headless auth surface, an absent subscription capability) stays
    `honest_unavailable`. No verb may advertise a capability it still lacks.
15. **Parity + registration invariant preserved (FR15).** This feature adds NO catalog id, bumps
    NO catalog version, introduces NO new dispatch path, and adds NO new flag: every verb rides
    the same `OperatorClient` loopback with unchanged command ids across palette/slash/CLI/TUI.
    Feature 007 stays the sole command-registration authority.
16. **Honest degradation everywhere (FR16).** Every mutation MUST commit through
    `mutateAuthority`/`OperatorMutationPlan` with the Feature 007 audit correlation; every
    read/observation MUST degrade to a typed envelope (`milvus_unavailable`,
    `embedding_unavailable`, `not_validated`, `mcp_unavailable`, `capability_absent`,
    `version_conflict`, `invalid_argument`) on any unreachable/disarmed path — never a fabricated
    success, a synthesized generation/subscription/occurrence, or a phantom write. No error path
    leaks a prompt, a secret, an embedding vector body, a session transcript, an OTLP signal body,
    or a raw config fragment. Where 018's `effectOnly`/effectful mutation-plan patterns fit a
    non-versioned effect (e.g. a cache/eval-version invalidation), they are reused.

## Non-Functional Requirements

- **Reuse the shipped machinery.** The `cutoverReranker`/`cutoverEmbedding`/`rollbackEmbedding`
  pure executors, the `binding-lifecycle.ts` `TRANSITIONS` machine, `runReconcile` + `toolLiveDoc`,
  the `MilvusPort`, the `embedding-client`, the MCP interactive OAuth flow + subscription machine,
  and the `BoundedExportQueue` + `OtlpAdapter` are REUSED, not re-authored; the composition roots
  wire onto them.
- **Cardinal honesty (no config-only cutover).** An embedding cutover physically builds and
  validates a generation in Milvus before the alias swaps; `select`/`reindex` alone never activate
  (Feature 006 FR12/FR32).
- **Typed gaps over fabricated data.** An unconfigured Milvus endpoint, a headless auth surface, an
  absent subscription capability, and a disabled telemetry config each return the exact typed
  capability gap — never synthesized state.
- **Fail-open, bounded, defensive.** The telemetry pipeline never breaks the server and never
  blocks the session loop; redaction defaults exclude all sensitive categories; the interrupt/eager
  seams are narrow process singletons.
- **No new flag / no new catalog id or dispatch path.** All operator work stays behind the existing
  operator control-plane flag; Feature 007 stays the sole command authority; availability is derived
  from backend readiness, not the catalog.

## Acceptance Scenarios

Given the operator control plane is composed

- **Reranker cutover activates without Milvus.**
  Given a validated staged reranker candidate and a per-slot archive,
  When the operator dispatches `semantic.reranker.cutover` under CAS + confirmation,
  Then it routes through the config-backed registry, invalidates the rerank cache/eval version with
  `reEmbedded:false`, retains the prior in the superseded archive, and never touches Milvus; an
  unvalidated candidate returns `not_validated`.

- **Rollback targets a real archived prior.**
  Given a slot whose archive holds a superseded prior,
  When the operator dispatches `semantic.reranker.rollback`,
  Then it restores the archived prior under CAS + confirmation; a slot with no superseded prior
  returns a typed `no_archived_prior` rejection, never a fabricated swap.

- **Embedding cutover physically builds a generation.**
  Given a configured Milvus endpoint and a staged embedding candidate needing a new vector space,
  When the operator runs `reindex` then `cutover`,
  Then a blue/green generation is built and validated (`building → validated → live`) before the
  alias swaps under one CAS across every collection together; `select`/`reindex` alone never
  activate; an unconfigured endpoint returns `milvus_unavailable`.

- **Reconcile diffs real state and never re-pins.**
  Given the live-doc source and the enumerate seam are bound,
  When the operator runs `semantic.index.reconcile`,
  Then `runReconcile` diffs real live docs against real enumerated indexed docs and reports
  content-free upsert/tombstone/unchanged counts with the pinned binding version unchanged.

- **Live Milvus validation.**
  Given `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is set to a live Milvus endpoint,
  When the env-gated integration path runs,
  Then probe + create-generation + upsert + enumerate + swapAliases succeed against real
  infrastructure; unit tests use a fake port and CI does not require the endpoint.

- **MCP auth delegates for the TUI, gaps for headless.**
  Given an interactive TUI surface,
  When the operator dispatches `mcp.auth.start`,
  Then it returns the authorize URL and starts the loopback callback listener, and `mcp.auth.finish`
  completes the exchange; a headless surface keeps the typed gap; no secret crosses the envelope.

- **MCP subscription and truthful badges.**
  Given a subscribe-capable client and an operator grant,
  When the operator dispatches `mcp.resource.admin.subscribe`,
  Then the dual-authority subscription machine drives the client subscription; a client without the
  capability returns `capability_absent`; and a connected server's Experimental/Extension badges
  render `Enabled`/`Disabled` from the config-backed flag state instead of `Unknown`.

- **Real telemetry export.**
  Given the effective telemetry config has `enabled=true` and a configured endpoint,
  When the pipeline composes at server start,
  Then a real transport binds and at least one signal reaches the collector, honoring the bounded
  queue + drop policy + retry + redaction defaults; a disabled config runs no fiber and no network;
  a slow collector never blocks the session loop.

- **Truthful availability + parity.**
  Given the composition lands,
  When the grouped operator menu derives availability,
  Then each completed verb reads the composed truth and any still-gapped verb stays
  `honest_unavailable`; every verb rides the same command id and loopback with no new dispatch path,
  no catalog id, and no version bump.

## Security Requirements

- **Data sensitivity/classification.** This feature reads persisted binding/provider/model registry
  records (endpoint identity, `SecretRef`s, binding versions), Milvus generation/alias/CAS state,
  MCP server capability + auth status, and effective telemetry config; it mutates by activating
  binding versions (cutover/rollback), building index generations, driving MCP subscriptions, and
  arming the telemetry export pipeline. It reads no embedding vector body, session transcript, prompt
  body, or spool page body across the operator seam; reads project bounded, content-free summaries;
  and an index/collection never crosses a project partition (Feature 006 FR9/C13).
- **Authentication/authorization.** No new authenticated surface. `mcp.auth.start`/`finish` delegate
  to the **existing** interactive OAuth flow bound to a loopback callback only; the authorize URL is
  surfaced but no token or `code_verifier`/`SecretRef` crosses an operator envelope. Every operator
  verb rides the Feature 007 `OperatorClient` loopback and operator principal, scope, version/CAS,
  and confirmation gates. A resource subscription is gated by BOTH the server capability AND the
  operator grant (fail-closed).
- **Input validation.** The untrusted inputs are the CAS token + confirmation on a cutover/rollback,
  the Milvus endpoint + `SecretRef`, the OAuth authorization code returned to the callback (state-param
  CSRF-checked by the existing flow), the subscription resource URI (SSRF/URI-policy validated by the
  resource adapter), and the effective telemetry config. A malformed input is rejected with a typed
  `invalid_argument`; a CAS contention swaps nothing.
- **Cryptography in transit/at rest.** No new at-rest store beyond the existing operator config +
  Milvus generation state. A provider/Milvus/collector credential stays `SecretRef`-only under the
  Feature 007 SecretPort, resolved at use time, never persisted or logged in plaintext. Remote Milvus
  and OTLP endpoints require TLS by default; insecure HTTP only for an explicit local profile with a
  visible warning (Feature 006 FR33). The telemetry export applies its redaction defaults before any
  signal leaves the process.
- **Logging/audit.** Every mutation emits the Feature 007 audit correlation through `mutateAuthority`
  with content-free, bounded labels (command id, domain, outcome). The generation build, the
  subscription machine, and the telemetry pipeline record only bounded, typed outcomes — never a
  prompt, transcript, vector body, OTLP signal body, definition secret, or config payload. The eager
  telemetry arming logs a bounded fail-open reason on a caught error.
- **Error-handling information exposure.** Every failure path degrades to a typed envelope carrying
  only a bounded, secret-free reason. An unconfigured Milvus, an unvalidated candidate, a missing
  rollback prior, a headless auth surface, an absent subscription capability, or a disabled telemetry
  config never leaks a stack trace, a secret, a vector body, a transcript, an OTLP signal body, or a
  raw config fragment in a result, toast, or log.

## Domain Model

The lifecycle-completion ValueObjects are specified in `doc/arch/schemas/semantic-lifecycle/` and the
binding-generation lifecycle as a statechart in
`doc/arch/statecharts/binding-generation-lifecycle.md`:

```
Group A — reranker over a config-backed archive
  reranker.cutover → registry OperatorMutationPlan (mutateAuthority, CAS + confirm) →
    cutoverReranker (no MilvusPort) → invalidate rerank cache/eval version, reEmbedded=false →
    archive: current + superseded[]                                                (FR1, FR2)
  reranker.rollback → resolve #RollbackTarget from superseded[] →
    { restored | no_archived_prior }                                              (FR3)

Group B — embedding + index against a live Milvus
  configured endpoint → bind real MilvusPort + persisted generation/alias/CAS state (FR4)
  embedding.reindex → build generation (building → validated) in Milvus            (FR5, FR6)
  embedding.cutover → cutoverEmbedding CAS + confirm → swapAliases (all collections) → live (FR5)
  index.reconcile → live-doc source + enumerate-indexed-docs → runReconcile →
    content-free counts, binding version UNCHANGED                                 (FR6, FR7)
  unconfigured → the exact typed milvus_unavailable floor                          (FR4, FR16)

Group C — MCP delegation edges
  auth.start (interactive TUI) → startAuth → { authorizationUrl + loopback listener } ;
    headless → typed gap                                                          (FR8)
  auth.finish → finishAuth (token exchange)                                        (FR8)
  resource.admin.subscribe/unsubscribe → dual-authority subscription machine →
    { subscribed | capability_absent }                                            (FR9)
  mcp status → config-backed experimental/extension flag state → badges truthful   (FR10)
  live-list: same MCP.Service singleton — empty is correct-for-context, not a bug

Group D — real OTLP export
  server start / telemetry.* mutation → ensure pipeline (process singleton, fail-open) →
    enabled=true → bind real transport → BoundedExportQueue (drop|backpressure, retry) →
    redaction defaults (prompts/secrets/paths/content/payloads excluded) → export   (FR11, FR12)
  disabled → no fiber, no network                                                  (FR11)
  live validation → env-gated, emit + verify ingestion; fake transport in unit tests (FR13)

Every mutation carries the Feature 007 audit correlation and commits through mutateAuthority;
an unreachable dependency (unconfigured Milvus, headless auth, absent capability, disabled
telemetry) → a typed capability gap — never a fabricated generation/subscription/signal,
phantom write, or config-only cutover (FR14–FR16).
```

## Observability

Operator dispatches continue to project through the Feature 007 EventV2 audit and the ADR-0001 OTLP
foundation with content-free, bounded labels (command id, domain, surface, scope, outcome). The
semantic composition reuses the Feature 006 binding/index observability; the generation build emits a
bounded `building`/`validated`/`live` signal. The telemetry pipeline is the FIRST real exporter — it
emits the Feature 001 queue-depth/capacity/drop/export-error instrument signals, all content-free, and
applies its redaction defaults before any signal leaves the process. No prompt, transcript, embedding
vector body, OTLP signal body, definition secret, or config payload is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Standing up a new semantic engine, scheduler, or lifecycle — the Feature 006/009 machinery and pure
  executors are composed, not re-authored.
- Smart Routing consumption (repo rule: no Smart Routing implementation without explicit
  authorization); the composition adds no new routing path.
- A distributed/multi-node Milvus generation coordinator or cross-process alias arbitration — the
  generation/alias/CAS state is process-local, honest within a single process.
- Reconciling the operator's config-backed experimental/extension flag doc with the runtime `cfg.mcp`
  schema (which has no such field) — Feature 019 makes the badge truthful against the config-backed
  SSOT the toggle owns and records the schema split as a boundary.
- A push-based config-invalidation seam — none exists today; the telemetry re-arm is pull-based
  (re-resolve on server start / `telemetry.*` dispatch), mirroring the eager-singleton precedent.
- Adding any catalog id, bumping the catalog version, or introducing a new dispatch path, parallel
  registry, or divergent command name.
- A new feature flag, and App/Desktop parity (Feature 007 Phase 2).

## Related Features and Decisions

- [ADR-0019 — Complete the semantic binding lifecycle and the remaining operator residuals](../../adr/0019-complete-the-semantic-binding-lifecycle-and-the-remaining.md)
- [Feature 006 Milvus-backed multilingual semantic retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — FR32 owns the binding lifecycle; FR12 the blue/green generation; the pure executors and `MilvusPort` composed here.
- [Feature 009 Semantic embedding and reranker retrieval to all tool search](../009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md) — reuses the lifecycle verbatim; the `tools` collection cuts over atomically.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant, `mutateAuthority`/`OperatorMutationPlan`, the SecretPort seam.
- [Feature 008 MCP client tools and resources lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — the resource subscription machine and auth flow completed here.
- [Feature 001 Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the OTLP pipeline contract (queue/batch/retry/drop/redaction) the telemetry export honors.
- [Feature 017 Close the Implementable Operator Capability Gaps](../017-close-the-implementable-operator-capability-gaps-so-the/spec.md) — the eager `ensureProcessSpoolWriter` seam and the `OperatorMutationPlan.effect` seam mirrored here.
- [Feature 018 Compose the Scheduled Jobs Executor Runtime](../018-compose-the-scheduled-jobs-executor-runtime-into-the-live/spec.md) — the eager-arming and `effectOnly`/effectful mutation-plan patterns reused where they fit.
- [ADR-0017 — Operator capability gap boundaries](../../adr/0017-close-the-implementable-operator-capability-gaps-so-the.md) — the headless auth boundary this feature revisits for the interactive TUI.
- [Semantic binding statechart](../../statecharts/semantic-binding.md) and [Binding generation lifecycle statechart](../../statecharts/binding-generation-lifecycle.md)
- [Domain schema](../../schemas/semantic-lifecycle/enums.cue)

## Clarifications

### Session 2026-07-20

- **Reranker path is config-backed, not Milvus-gated (FR1).** `semantic.reranker.cutover`/
  `rollback` route through the config-backed registry (`c.registry`) as
  `OperatorMutationPlan`s, reusing the pure `cutoverReranker` (no `MilvusPort`); a
  cache/eval-version invalidation that is a non-versioned effect reuses the Feature 018
  `effectOnly` mutation-plan pattern to avoid CAS churn. Recorded in ADR-0019.
- **Generation-archive shape (FR2, FR5).** The per-slot binding version archive (current +
  superseded) lives in the operator config `RegistryDocument` (no new store); the Milvus
  generation/alias/CAS state is persisted alongside the existing operator config + Milvus
  generation state. The exact durable shape is confirmed during implement against the
  registry document read. Recorded in ADR-0019.
- **Cardinal honesty for the embedding cutover (FR5).** An embedding cutover is NEVER a
  config-only alias flip — a blue/green generation is physically built and validated in
  Milvus (`building → validated → live`) before `cutoverEmbedding` swaps the alias under one
  CAS across every collection together; `select`/`reindex` alone never activate.
- **MCP auth delegation verdict (FR8).** For an **interactive TUI**, `mcp.auth.start`
  delegates to `MCP.Service.startAuth` (authorize URL + loopback callback listener) and
  `mcp.auth.finish` to `finishAuth`; a **headless** surface keeps the typed gap. This is a
  scoped revision of the ADR-0017 headless boundary, not a technical unblock — the
  primitives already exist. Recorded in ADR-0019.
- **Resource subscription is real and fail-closed (FR9).** `resource.admin.subscribe`/
  `unsubscribe` drive the existing dual-authority subscription machine over a
  subscribe-capable client (SDK `subscribeResource`/`unsubscribeResource`); an absent
  capability returns `capability_absent` — a genuine feature completion (the machine + SDK
  primitive exist but were never connected to a live client), not merely operator wiring.
- **Badges project the config-backed flag SSOT (FR10).** The `mcp` status read carries the
  operator's config-backed experimental/extension flag state; the runtime `cfg.mcp` schema
  has no such field, so reconciling the two SSOTs is a documented boundary. The live-list is
  same-instance (`effect/app-runtime.ts` singleton) — an empty list is correct-for-context.
- **Telemetry re-arm is pull-based (FR11).** No push-based config-invalidation seam exists
  (`ConfigPort` has no `subscribe`), so the eager, fail-open OTLP pipeline re-resolves on
  server start / `telemetry.*` dispatch, mirroring `ensureProcessSpoolWriter`/
  `ensureExecutorComposition`. A real transport must be built (only a reachability probe
  exists today) and the `retry_budget` enforced (today unread). Recorded in ADR-0019.
- **Phase order.** Group A (reranker lifecycle) is first; then B1 (Milvus client + port
  methods), B2 (embedding cutover/rollback), B3 (reindex/reconcile + live-doc source), C
  (MCP), then D (telemetry export), then the availability flip + tests. Reflected in plan.md
  and the task DAG.
