---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0019 — Complete the Semantic Binding Lifecycle and the Remaining Operator Residuals

## Context and Problem Statement

Feature 006 (with Feature 009 reusing it verbatim) owns the complete semantic binding
lifecycle contract — `select`/`validate`/`reindex`/`cutover`/`rollback` per FR32, with
the blue/green generation build per FR12 — and the **pure engines already exist**:
`cutoverReranker` (no `MilvusPort`) and `cutoverEmbedding`/`rollbackEmbedding` in
`packages/opencode/src/semantic/cutover-executor.ts`, and the typed `TRANSITIONS`
machine in `packages/core/src/semantic/binding-lifecycle.ts`. A gap sweep (2026-07-20,
every `file:line` verified) found the operator activation **uncomposed**, plus three
adjacent operator residuals left at honest-but-incomplete typed gaps:

- **Group A (reranker).** `semantic.reranker.cutover`/`rollback`
  (`semantic-command-port.ts:243-244`) route through the gated Milvus backend instead of
  the config-backed registry (the `planSelect` precedent, `registry-backend.ts:403-418`);
  the operator `RegistryDocument` keeps a single binding entry per slot
  (`bindingHistory` `:285-291`), a hardcoded `full_semantic` rung (`bindingStatus` `:281`),
  and no superseded target for a rollback.
- **Group B (embedding + index).** The embedding cutover/rollback executor is complete but
  the operator binds `createGrpcMilvusAdapter({})` with **no gRPC client**
  (`stack-live.ts:513-537`, every op `reachable:false`); `runReconcile`
  (`index-jobs.ts:131-155`) needs a live-doc source (only `toolLiveDoc` is bound), an
  enumerate-indexed-docs `MilvusPort` method, a createCollection/buildGeneration, and a
  bound embedding client.
- **Group C (MCP).** `auth.start`/`finish` (`mcp/backend-live.ts:68-73`), resource
  `subscribe`/`unsubscribe` (`:79-80`), and the experimental/extension badges (`:90-100`)
  stay typed gaps although the interactive OAuth flow, the SDK subscription primitive + a
  pure dual-authority machine, and the config-backed flag doc all exist.
- **Group D (telemetry).** The routing OTLP sink is built **offline**
  (`stack-live.ts:354-361`, `createOtlpAdapter` with no transport →
  `createUnavailableTransport`), so `telemetry.on` flips config but no signal is ever sent;
  `BoundedExportQueue` exists but no real transport, no retry-budget enforcement, and no
  config-invalidation seam.

The question: how to complete the lifecycle and these residuals **without** re-authoring
the shipped machinery, adding a catalog id or dispatch path, or violating the cardinal
honesty rule that an embedding cutover is never a config-only alias flip.

## Decision Drivers

- Reuse the shipped pure executors, the `MilvusPort`, the embedding client, the MCP OAuth
  flow + subscription machine, and the `BoundedExportQueue` — compose, do not re-author.
- Preserve the cardinal honesty rule (Feature 006 FR12/FR32): a generation is physically
  built and validated in Milvus before an embedding alias swaps; `select`/`reindex` alone
  never activate.
- Preserve the Feature 007 registration invariant: no new catalog id, no version bump, no
  new dispatch path or flag; availability is derived from backend readiness.
- Prefer typed capability gaps over fabricated state on every unreachable dependency.
- Keep defensive posture: `SecretRef`-only credentials, redaction defaults on export, and
  fail-closed dual-authority subscriptions.

## Considered Options

- **Option A — Compose the existing machinery behind the existing verbs (chosen).** Route
  reranker cutover/rollback through the config-backed registry; extend the registry doc with
  a per-slot version archive; bind a live `MilvusPort` and build/validate a real generation
  before the embedding alias swap; wire the reindex/reconcile live-doc source + enumerate
  seam; delegate MCP auth to the interactive flow for the TUI (headless keeps the gap);
  drive the subscription machine over a subscribe-capable client; project the config-backed
  flag state; and compose a real, eager, fail-open OTLP export pipeline.
- **Option B — Author new executors/adapters per residual.** Rejected: duplicates shipped
  pure engines and the `BoundedExportQueue`, and risks divergent lifecycle semantics.
- **Option C — Leave the gaps and only flip availability copy.** Rejected: dishonest — a verb
  would still advertise a capability it lacks.

## Decision Outcome

Chosen option: **Option A**, because it activates the shipped contract with the smallest
composition surface and keeps every honesty and parity invariant intact.

Key decisions recorded:

1. **Reranker path is config-backed, not Milvus-gated (Group A).** `semantic.reranker.cutover`/
   `rollback` route through `c.registry` as `OperatorMutationPlan`s under `mutateAuthority`;
   the reranker cutover reuses the pure `cutoverReranker` (no `MilvusPort`), invalidates the
   rerank cache/eval version, and sets `reEmbedded:false`. Where a cache/eval-version
   invalidation is a non-versioned effect, the Feature 018 `effectOnly` mutation-plan pattern
   is reused so a successful activation does not churn the authority CAS version.
2. **Per-slot binding version archive (Group A).** The operator `RegistryDocument` is extended
   with a per-slot archive — the current version plus its superseded predecessors
   (`#BindingVersionArchive`) — so `bindingHistory`/`bindingStatus` are truthful and a rollback
   resolves a real `#RollbackTarget`. A cutover without a validated staged candidate is a typed
   `not_validated`; a rollback with no archived prior is a typed `no_archived_prior` rejection.
3. **Generation-archive shape (Group A/B).** The archive keeps the current + superseded
   binding versions in the operator config document (not a new store), and the Milvus
   generation/alias/CAS state is persisted alongside the existing operator config + Milvus
   generation state. The exact durable shape is confirmed during implement against the
   registry document read.
4. **Cardinal honesty for the embedding cutover (Group B).** A blue/green generation is
   physically built and validated in Milvus (`building → validated → live`) before
   `cutoverEmbedding` swaps the alias under one CAS across every collection together; an
   unconfigured endpoint returns the exact typed `milvus_unavailable` floor.
5. **MCP auth delegation verdict (Group C).** For an **interactive TUI** surface,
   `mcp.auth.start` delegates to `MCP.Service.startAuth` (returns the authorize URL + starts
   the loopback callback listener) and `mcp.auth.finish` to `finishAuth`; a **headless**
   surface (CLI `--json`, HTTP) keeps the typed gap. This is a **scoped revision of the
   ADR-0017 headless boundary**, not a technical unblock — the primitives already exist; no
   token or secret crosses an operator envelope.
6. **Resource subscription is real, gated, fail-closed (Group C).** `resource.admin.subscribe`/
   `unsubscribe` drive the existing dual-authority machine over the SDK
   `subscribeResource`/`unsubscribeResource` with `resources/updated` handling; a client
   without the `resources.subscribe` capability returns `capability_absent`.
7. **Badges project the config-backed flag SSOT; the schema split is a boundary (Group C).**
   The `mcp` status read carries the operator's config-backed experimental/extension flag
   state so badges render truthfully. The runtime `cfg.mcp` schema has no such field;
   reconciling the two SSOTs is out of scope and recorded as a boundary. The live-list is
   same-instance (`effect/app-runtime.ts` singleton) — an empty list is correct-for-context,
   not a wiring bug.
8. **Real telemetry export, pull-based re-arm (Group D).** A process-singleton, eager,
   fail-open OTLP pipeline binds a real transport when the effective config enables telemetry,
   honors the bounded queue + drop policy + retry + redaction defaults, and re-resolves on
   server start / `telemetry.*` dispatch. **No push-based config-invalidation seam exists**
   (`ConfigPort` has no `subscribe`), so the re-arm is pull-based, mirroring
   `ensureProcessSpoolWriter`/`ensureExecutorComposition`. Disabled runs no fiber and no
   network; an export failure never affects the session loop.
9. **Live validation is env-gated (Group B, Group D).** Integration paths gated on
   `OPENCODE_SEMANTIC_MILVUS_ADDRESS` / a telemetry endpoint exercise the composition against a
   live Milvus endpoint and a live OTLP collector; unit tests use fake ports/transports and CI
   never requires the live endpoints.

### Consequences

- Good: the shipped contract activates with a minimal composition surface; every honesty,
  parity, and defensive-security invariant holds; no catalog id or dispatch path is added.
- Good: reranker changes stop riding the Milvus gap; rollbacks target real archived versions;
  telemetry actually exports.
- Bad: the MCP auth delegation revises the ADR-0017 headless boundary for the interactive TUI —
  the two surfaces (interactive vs headless) now diverge in capability, which must be
  documented at the surface level.
- Bad: the telemetry re-arm is pull-based because no push invalidation seam exists — a config
  change is observed at the next re-resolution tick, not instantly; acceptable given the
  fail-open, bounded design.
- Bad: the experimental/extension badge reflects the operator's config-backed flag doc, not the
  runtime `cfg.mcp` behavior — a documented boundary until the SSOTs are reconciled.
