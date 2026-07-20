# Implementation Plan: Complete the Semantic Binding Lifecycle and the Remaining Operator Residuals

Feature: 019-complete-the-semantic-binding-lifecycle-and-the-remaining
Status target: planned (after this plan is complete)
ADR: [ADR-0019](../../adr/0019-complete-the-semantic-binding-lifecycle-and-the-remaining.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR16; domain model; cardinal-honesty + typed-gap + parity invariants)

## Overview

Features 006 and 009 shipped the **complete semantic binding lifecycle contract** and
the **pure engines** (`cutover-executor.ts` `cutoverReranker`/`cutoverEmbedding`/
`rollbackEmbedding`; `binding-lifecycle.ts` `TRANSITIONS`), but the operator activation
is uncomposed, and three adjacent operator residuals sit at honest-but-incomplete typed
gaps. A gap sweep (2026-07-20, every `file:line` verified) found:

1. **Reranker cutover/rollback ride the Milvus gap** — `semantic-command-port.ts:243-244`
   routes them through the gated Milvus backend, not the config-backed registry; the
   `RegistryDocument` keeps a single binding entry per slot with a hardcoded
   `full_semantic` rung and no rollback target.
2. **The embedding executor has no live Milvus port** — `stack-live.ts:513-537` binds
   `createGrpcMilvusAdapter({})` (every op `reachable:false`); the reindex/reconcile
   live-doc source, the enumerate seam, and the embedding client are unbound.
3. **MCP auth/subscription/badge edges stay gaps** although the interactive OAuth flow,
   the SDK subscription primitive + a pure dual-authority machine, and the config-backed
   flag doc all exist.
4. **The OTLP telemetry sink is built offline** (`stack-live.ts:354-361`,
   `createOtlpAdapter` with no transport) — `telemetry.on` flips config but nothing is
   sent; `BoundedExportQueue` exists but no real transport, no retry enforcement, no
   config-invalidation seam.

This plan is a **composition** change: activate the config-backed reranker lifecycle over
a per-slot version archive FIRST, then bind a live Milvus port + build/validate a
blue/green generation before the embedding alias swap and wire the reindex/reconcile
source, then complete the MCP delegation edges, then compose a real eager fail-open OTLP
export pipeline, then flip availability to truth — keeping every unreachable dependency a
typed gap and the cardinal honesty rule intact.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR15).** No catalog id, no version bump, no new
  dispatch path or flag; only composition, backend wiring, and the availability flip.
- **Cardinal honesty (FR5).** An embedding cutover physically builds and validates a
  generation before the alias swaps; `select`/`reindex` alone never activate.
- **Reuse the shipped machinery.** The pure executors, the `TRANSITIONS` machine,
  `runReconcile` + `toolLiveDoc`, the `MilvusPort`, the embedding client, the MCP OAuth
  flow + subscription machine, and the `BoundedExportQueue` + `OtlpAdapter` are reused.
- **Typed gaps over fabricated state (FR16).** An unconfigured Milvus, a headless auth
  surface, an absent subscription capability, and a disabled telemetry config return the
  exact typed capability gap.

## Technical Approach

### Architecture layers affected

```
Group A — reranker lifecycle over a config-backed archive  -- FIRST --  (FR1-FR3)
  semantic-command-port.ts rerankerInvoke -> c.registry (config-backed, no Milvus);
  registry-backend.ts: extend RegistryDocument with per-slot version archive
  (current + superseded); cutoverReranker pure engine; not_validated / no_archived_prior gates
        |
        v
Group B — embedding + index against a live Milvus  (FR4-FR7)
  B1: bind real Milvus gRPC/HTTP client when OPENCODE_SEMANTIC_MILVUS_ADDRESS set
      (stack-live.ts) + add enumerate-indexed-docs + createCollection/buildGeneration to MilvusPort
  B2: cutoverEmbedding/rollbackEmbedding over the live port; build+validate generation before swap
  B3: reindex/reconcile live-doc source (agent/skill builders) + bound embedding client -> runReconcile
        |
        v
Group C — MCP delegation edges  (FR8-FR10)
  auth.start/finish delegate to MCP.Service.startAuth/finishAuth for interactive TUI (headless gap);
  resource.admin.subscribe/unsubscribe drive the dual-authority machine over a subscribe-capable client;
  mcp status carries config-backed experimental/extension flag state -> truthful badges
        |
        v
Group D — real OTLP telemetry export  (FR11-FR13)
  process-singleton eager fail-open pipeline; real transport bound when enabled=true;
  BoundedExportQueue + drop policy + retry + redaction defaults; pull-based re-arm; env-gated live validation
        |
        v
Group E — availability flip + parity + honest degradation  (FR14-FR16)
  palette.ts per-verb truth flip; still-gapped verbs stay honest_unavailable; typed gaps everywhere
```

The reused runtime — the Feature 006/009 pure executors, `MilvusPort`, embedding client,
the MCP OAuth + subscription machine, and the Feature 001 `BoundedExportQueue`/`OtlpAdapter`
— is the single source the composition roots wire onto; the lifecycle-completion
ValueObjects are specified in `doc/arch/schemas/semantic-lifecycle/` and the activation
lifecycle in `doc/arch/statecharts/binding-generation-lifecycle.md`.

### Phase A — Reranker lifecycle over a config-backed archive (FR1-FR3) — FIRST

- **Route reranker cutover/rollback through the registry.** Move
  `semantic.reranker.cutover`/`rollback` (`semantic-command-port.ts:243-244`) off the gated
  Milvus backend `b` onto the config-backed registry `c.registry` as `OperatorMutationPlan`s
  (the `planSelect` precedent, `registry-backend.ts:403-418`), committed under
  `mutateAuthority`. Reuse the pure `cutoverReranker` (no `MilvusPort`); invalidate the
  rerank cache/eval version with `reEmbedded:false`. Where the invalidation is a
  non-versioned effect, reuse the Feature 018 `effectOnly` pattern to avoid CAS churn.
- **Extend the RegistryDocument with a per-slot version archive.** Add the current +
  superseded entries (`#BindingVersionArchive`) so `bindingHistory` (`:285-291`) returns the
  real archive and `bindingStatus` (`:281`) reports the real rung. A cutover without a
  validated candidate → `not_validated`; a rollback with no superseded prior →
  `no_archived_prior`; a CAS contention swaps nothing.

### Phase B1 — Live Milvus client + port methods (FR4, FR6)

- **Bind a real Milvus client.** Replace `createGrpcMilvusAdapter({})` (`stack-live.ts:513-537`)
  with a real gRPC/HTTP client when `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is configured, plus
  persisted generation/alias/CAS state; unconfigured keeps the exact `milvus_unavailable`
  floor. Add the two missing `MilvusPort` methods: **enumerate-indexed-docs**
  `{canonicalId, contentHash}` per collection and **createCollection/buildGeneration**.

### Phase B2 — Embedding cutover/rollback over the live port (FR5)

- **Build and validate before the swap.** Drive `cutoverEmbedding`/`rollbackEmbedding` over
  the live port: build a blue/green generation (`building → validated → live`) and only then
  swap the alias under one CAS across every collection together — the cardinal honesty rule;
  `select`/`reindex` alone never activate.

### Phase B3 — Reindex/reconcile + live-doc source (FR6, FR7)

- **Bind the live-doc source and embedding client.** Add agent/skill live-doc builders
  alongside `toolLiveDoc`, bind the embedding client (`probe`/`embed`) from the operator
  runtime, and read prior indexed state via the enumerate seam, so `runReconcile`
  (`index-jobs.ts:131-155`) diffs real `LiveDoc[]` against real `IndexedDoc[]` and reports
  content-free counts with the pinned binding version unchanged (never re-pins).

### Phase C — MCP delegation edges (FR8-FR10)

- **Delegate auth for the interactive TUI.** `mcp.auth.start` → `MCP.Service.startAuth`
  (authorize URL + loopback listener), `mcp.auth.finish` → `finishAuth`; headless keeps the
  typed gap; no token/secret crosses the envelope.
- **Complete the subscription.** `resource.admin.subscribe`/`unsubscribe` drive the
  dual-authority machine over a subscribe-capable client with `resources/updated` handling;
  absent capability → `capability_absent`.
- **Truthful badges.** Project the config-backed experimental/extension flag state into the
  mcp status read; record the `cfg.mcp` schema-split boundary; the live-list is same-instance
  (no fix).

### Phase D — Real OTLP telemetry export (FR11-FR13)

- **Compose an eager fail-open pipeline.** A process-singleton mirroring
  `ensureProcessSpoolWriter`/`ensureExecutorComposition` binds a **real transport** when the
  effective config enables telemetry (replacing `createUnavailableTransport`), honors the
  bounded queue + drop policy + retry + redaction defaults, and re-resolves pull-based on
  server start / `telemetry.*` dispatch (no push seam exists). Disabled runs no fiber/network.
- **Live validation.** An env-gated path enables telemetry against a live OTLP collector,
  emits a real signal, and verifies ingestion; unit tests use a fake transport.

### Phase E — Availability flip + parity + honest degradation (FR14-FR16)

- **Flip the palette availability** (`packages/core/src/operator/palette.ts`) so each
  completed verb reads the composed truth; still-gapped verbs stay `honest_unavailable`.
- **Preserve parity.** No new catalog id, no version bump, no new dispatch path or flag;
  command ids unchanged.

### Phase F — Tests + guard scope + doc sync (FR15)

- **Group A.** Reranker cutover routes config-backed (no Milvus), invalidates cache/eval
  with `reEmbedded:false`; not_validated / no_archived_prior gates; archive round-trip.
- **Group B.** Live Milvus port methods; generation build+validate before swap; unconfigured
  → `milvus_unavailable`; reconcile diffs real state, never re-pins; env-gated live Milvus.
- **Group C.** Auth delegation (TUI) vs headless gap; subscription over the machine +
  capability_absent; truthful badges; live-list same-instance.
- **Group D.** Enabled → real transport sends a signal (fake transport in unit tests);
  disabled → no fiber/network; slow collector never blocks; redaction enforced; env-gated
  live collector.
- **Group E.** Palette flip truthful; Feature 007 parity harness (same command id/loopback,
  no new dispatch path/catalog id/version).
- **Doc sync.** Keep the spec, ADR-0019, the `semantic-lifecycle/*.cue` corpus, and the
  binding-generation-lifecycle statechart in sync with the shipped shapes.

## Data model and migration strategy

No new store or table. The reranker archive extends the EXISTING operator `RegistryDocument`
(`registry-backend.ts`); the Milvus generation/alias/CAS state is persisted alongside the
EXISTING operator config + Milvus generation state; the telemetry pipeline reuses the
EXISTING `BoundedExportQueue` + `OtlpAdapter`. **Migration note:** none — the reranker path
simply stops riding the Milvus gap, the archive begins retaining superseded versions as
cutovers land, the embedding cutover begins reaching a live Milvus once the endpoint is
configured, and telemetry begins exporting once enabled. The operator-surface projections and
readiness classes are typed by the ValueObjects in `doc/arch/schemas/semantic-lifecycle/`
(`#BindingVersionArchive`, `#ArchivedBindingVersion`, `#RollbackTarget`,
`#RerankerCutoverPlan`, `#RerankerActivationResult`, `#MilvusEndpointBinding`,
`#IndexGeneration`, `#GenerationBuild`, `#EmbeddingCutover`, `#LiveDocProjection`,
`#EnumeratedIndexedDoc`, `#ReconcilePlan`, `#McpAuthStart`, `#McpSubscription`,
`#McpToggleBadgeState`, `#TelemetryExportPipeline`, `#ExportQueueBound`,
`#TelemetryRedaction`, and the bounded enums).

## Activation state machine

Per `doc/arch/statecharts/binding-generation-lifecycle.md`:

```
staged -> cutover (CAS + confirm) -> { reranker path (config-backed, no Milvus) |
          embedding path: building -> validated -> live under one CAS } -> active
active -> rollback -> { restored (archived prior) | no_archived_prior }
reconcile: live-doc source + enumerate -> runReconcile -> content-free counts, version UNCHANGED
unreachable dependency -> typed capability gap (milvus_unavailable / not_validated / ...)
```

The activation is honest and bounded; an embedding cutover never flips the alias without a
built+validated generation (FR5); every mutation commits through `mutateAuthority` and every
unreachable dependency degrades to a typed gap (FR16).

## Security and threat boundaries

| Concern                      | Mitigation                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| No new authenticated surface | MCP auth delegates to the EXISTING loopback OAuth flow; no token/secret crosses an envelope (FR8).      |
| SecretRef-only credentials   | Provider/Milvus/collector credentials stay SecretRef under the Feature 007 SecretPort, resolved at use time (Security). |
| Cardinal honesty             | An embedding cutover builds+validates a generation before the alias swaps; never a config-only flip (FR5). |
| Fail-closed subscription     | A resource subscription is gated by BOTH the server capability AND the operator grant; absent → capability_absent (FR9). |
| Defensive redaction          | The telemetry export excludes prompts/secrets/file paths/file content/tool payloads by default (FR12). |
| Fail-open telemetry          | An export failure or unreachable collector applies the drop policy and never blocks the session loop (FR11, FR12). |
| Typed capability gaps        | An unconfigured Milvus, a headless auth surface, an absent capability, and a disabled telemetry config return typed gaps (FR16). |
| No phantom write             | Every mutation commits through mutateAuthority; a CAS contention swaps nothing; a non-versioned effect uses effectOnly (FR1, FR16). |
| No content leakage           | Reads/errors carry only bounded, secret-free reasons; no prompt, transcript, vector body, OTLP signal body, or config fragment (FR16). |
| Audit                        | Every mutation emits the Feature 007 EventV2 audit correlation with bounded labels (Security).          |

## Observability

The telemetry pipeline is the FIRST real exporter — it emits the Feature 001
queue-depth/capacity/drop/export-error instrument signals, all content-free, and applies its
redaction defaults before any signal leaves the process. The generation build emits a bounded
`building`/`validated`/`live` signal. Operator dispatches continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free labels. No
prompt, transcript, embedding vector body, OTLP signal body, definition secret, or config
payload is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Most of the surface is already in scope under the Feature 006 / 007 / 008 / 001 blocks.
Genuinely new to Feature 019: none outside those blocks — the reranker routing, the registry
archive, the Milvus client binding, the reindex/reconcile source, the MCP delegation, the
telemetry pipeline, and the palette flip all live under already-scoped globs. Reused seams are
listed for traceability:

```toml
# Already in scope — NOT re-added, listed for traceability:
#   packages/opencode/src/semantic/**            -> cutover-executor, milvus-adapter, index-jobs,
#                                                    embedding-client, reranker path (FR1-FR7) [Feature 006]
#   packages/core/src/semantic/**                -> binding-lifecycle TRANSITIONS (FR1-FR3) [Feature 006]
#   packages/opencode/src/operator/semantic/**   -> registry-backend archive, semantic-command-port routing (FR1-FR7) [Feature 006/007]
#   packages/opencode/src/operator/**            -> stack-live Milvus + telemetry composition, mcp/backend-live (FR4-FR13) [Feature 007]
#   packages/opencode/src/mcp/**                 -> auth/subscription/badge delegation (FR8-FR10) [Feature 008/007]
#   packages/core/src/mcp/**                     -> subscription-machine (FR9) [Feature 008]
#   packages/opencode/src/routing/**             -> otlp-adapter, telemetry-service export pipeline (FR11-FR13) [Feature 001]
#   packages/core/src/observability/**           -> BoundedExportQueue (FR12) [Feature 001]
#   packages/core/src/operator/**                -> palette.ts availability flip (FR14) [Feature 007]
#   packages/{schema,protocol}/src/{semantic,mcp,telemetry}/** -> typed ports (FR1-FR13) [Feature 006/008/001]
#   packages/{opencode,core}/test/{semantic,operator,mcp,routing,telemetry}/** -> tests (FR15)
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`. An 019-specific block is
added ONLY if implement discovers a genuinely-new path outside these globs.

## Implementation order (task groups preview)

1. Group A — reranker lifecycle over a config-backed archive (FIRST).
2. Group B1 — live Milvus client + the two `MilvusPort` methods.
3. Group B2 — embedding cutover/rollback over the live port (build+validate before swap).
4. Group B3 — reindex/reconcile live-doc source + bound embedding client.
5. Group C — MCP auth delegation + subscription + truthful badges.
6. Group D — real eager fail-open OTLP export pipeline + live validation.
7. Group E — availability flip + parity.
8. Group F — tests (all groups) + guard scope + doc sync.

## Companion artifacts

None required beyond this plan. The lifecycle-completion ValueObjects
(`doc/arch/schemas/semantic-lifecycle/`) and the statechart
(`doc/arch/statecharts/binding-generation-lifecycle.md`) carry the data model; no
`research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR16 mapped to ordered phases (reranker lifecycle FIRST)
- [x] No new catalog id / no version bump / no new dispatch path / no flag (FR15)
- [x] Cardinal honesty: embedding cutover builds+validates a generation before the swap (FR5)
- [x] Per-slot archive gives rollback a real target; not_validated / no_archived_prior gates (FR2, FR3)
- [x] Live Milvus client + enumerate + createGeneration seams; reconcile never re-pins (FR4, FR6, FR7)
- [x] MCP auth delegation (TUI) + headless gap; subscription over the machine; truthful badges (FR8-FR10)
- [x] Real eager fail-open OTLP export + bounded queue/retry/redaction + live validation (FR11-FR13)
- [x] Availability flip + typed gaps for still-absent verbs (FR14, FR16)
- [x] specScopeGlobs already cover the surface; 019 block added only if implement finds a new path
- [ ] `tasks.md` generated and filled
- [ ] `speckit analyze` clean of new Critical/High/Medium blockers
- [ ] `speckit validate --json` green (0 new findings on Feature 019 artifacts)

## Implementation notes (recorded during implement)

- _(reserved — filled during implement with date + file:line + test results)_
