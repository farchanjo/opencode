# Tasks: Make The Operator Reranker Binding Lifecycle Actually Functional End-To-End (Feature 026)

Synced with plan.md (Phase A palette flip, Phase B flat descriptor + modelRef, Phase C reranker.validate
model promotion, Phase D compose the reranker validation probe, Phase E regression proof + validate) and
the specScopeGlobs in doc/arch/speckit.toml. ADR-0026 proposed.

Composition + projection change ONLY. NO operator payload change, NO command id, NO catalog version bump,
NO new dispatch path, NO new flag, NO parallel config store, NO self-commit, NO weakening of the
single-committed-CAS-write / optimistic-concurrency guard, and NO Milvus dependency for the reranker slot
(FR5). The fix flips the palette truth for `semantic.reranker.validate` (FR1), composes a real reranker
validation probe over the Feature 006 rerank client with the provider secret resolved to an Authorization
header, redaction intact (FR2), reconciles the descriptor projection to the FLAT protocol shape (FR3),
promotes a validated reranker model to an eligible selector candidate through the `reranker.validate`
transition (FR4), keeps every failure honest (FR5), and proves the whole lifecycle over the REAL wired
dispatcher (FR6). `semantic.model.validate` stays `mutates: false`.

## Task Breakdown

- [x] T001 — Flip `semantic.reranker.validate` to persists_today in the palette (FR1)
- [x] T002 — Project the FLAT model descriptor + persist `modelRef` (FR3)
- [x] T003 — `reranker.validate` promotes the underlying model to `validated` (FR4)
- [x] T004 — Compose the reranker validation probe over the rerank client (FR2, FR5)
- [x] T005 — Wire the probe into the live stack with the secret resolved for the transport (FR2, FR5)
- [x] T006 — FR6 regression proof over the REAL wired dispatcher (no Milvus, no injected state)
- [x] T007 — `bun test` + `tsc` + `speckit validate --json` green + doc sync

---

## Phase A — palette truth flip (FR1) — FIRST

- [x] **T001 — Flip `semantic.reranker.validate` to persists_today**
- **Depends:** none
- **Paths:** `packages/core/src/operator/palette.ts`,
  `packages/core/test/operator/feature026-availability.test.ts`
- **Deliverable:** add `"semantic.reranker.validate"` to `OPERATOR_PERSISTING_VERBS` (next to
  `reranker.cutover`/`rollback`), config-backed + Milvus-free. It must NOT enter the Milvus-conditional
  set; `semantic.embedding.validate` + the Milvus-conditional verbs stay honest gaps.
- **Acceptance:** `persistenceFor("semantic.reranker.validate", …)` → `persists_today` with/without
  readiness; `operatorRowSubtitle` no longer reads "not implemented yet"; catalog count + version
  unchanged.
- **Verification:** `bun test test/operator/feature026-availability.test.ts test/operator/feature019-availability.test.ts`.
- **Evidence:** 2026-07-20 — `palette.ts` `OPERATOR_PERSISTING_VERBS` adds `semantic.reranker.validate`
  after `reranker.rollback`. `feature026-availability.test.ts` (12 tests): flip to persists_today
  with/without readiness, static-set membership, subtitle drops "not implemented yet", panel
  non-unavailable, catalog version `1.3.0` + count unchanged, embedding/Milvus verbs NOT added. Core
  `test/operator/` → 149 pass / 0 fail.

## Phase B — flat descriptor projection + modelRef (FR3)

- [x] **T002 — Project the FLAT model descriptor + persist `modelRef`**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/semantic/registry-backend.ts`,
  `packages/tui/test/operator/semantic/feature026-descriptor.test.ts`
- **Deliverable:** add optional `modelRef` to `RegistryModel` (back-compatible), persist `input.modelRef`
  in `planRegisterModel`, and rewrite `toDescriptor` to emit the flat `SemanticModelDescriptor`
  (`id`/`providerProfileId`/`modelRef`/`displayName`/`source`/`capabilityKinds`/`endpointMode`/
  `languageSupport`/`probeState`/`enabled`) with only closed-enum narrowings — drop the `as unknown`
  shape cast. Import `CapabilityKind`/`EndpointMode`/`ModelSource`/`ProbeState`.
- **Acceptance:** `semantic.model.list` projects `projected` (never `shape_mismatch`); the descriptor
  passes the TUI `isModelDescriptor` guard; the nested legacy shape still fails the guard (regression
  anchor).
- **Verification:** `bun test packages/tui/test/operator/semantic/feature026-descriptor.test.ts`.
- **Evidence:** 2026-07-20 — `registry-backend.ts` `RegistryModel.modelRef` optional; `planRegisterModel`
  persists `input.modelRef`; `toDescriptor` emits the flat shape (no `as unknown`). TUI
  `feature026-descriptor.test.ts` (5 tests): flat descriptors project (not shape_mismatch), nested legacy
  shape still `shape_mismatch`, badge rows render, eligibility. TUI `test/operator/` → 206 pass / 0 fail.

## Phase C — reranker.validate model promotion (FR4)

- [x] **T003 — `reranker.validate` promotes the underlying model to `validated`**
- **Depends:** T002
- **Paths:** `packages/opencode/src/operator/semantic/registry-backend.ts`
- **Deliverable:** in `markValidated`, on the SAME passing probe that promotes the staged binding to
  `{ state: "staged", validated: true }`, also promote the underlying model's `validationStatus` to
  `"validated"`. So after `select → validate`, `semantic.model.list` projects the reranker model with
  `probeState === "validated"`, satisfying the TUI selector eligibility. `semantic.model.validate` stays
  `mutates: false` — no catalog change.
- **Acceptance:** after `reranker.validate`, the model descriptor's `probeState === "validated"` and it
  is an eligible reranker selector candidate; a declared model is not; nothing else is clobbered.
- **Verification:** `bun test packages/opencode/test/operator/semantic/feature026-reranker-e2e.test.ts`.
- **Evidence:** 2026-07-20 — `registry-backend.ts` `markValidated` maps the staged candidate's model
  `validationStatus → "validated"` for both slots. e2e test asserts model A `probeState` flips
  declared→validated after validate while B stays declared; eligibility predicate holds only for the
  validated reranker model. Existing feature019 reranker tests still green.

## Phase D — compose the reranker validation probe (FR2, FR5)

- [x] **T004 — Compose the reranker validation probe over the rerank client**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/semantic/rerank-probe.ts` (NEW),
  `packages/opencode/src/operator/semantic/registry-backend.ts`
- **Deliverable:** `createRerankValidationProbe({ http, resolveAuthHeader })` composes
  `RerankClient.rerankNative` (profile A `/v1/rerank`) / `rerankStructured` (profile B) over an injected
  `RerankProbeHttpClient` (`postJson` seam), refusing profile C and failing HONESTLY when a required
  secret cannot be resolved. `createFetchRerankHttpClient` is the production transport. Extend
  `RerankValidationProbe.run` input with `modelRef` + `secretRef`; `planValidateReranker` passes them.
- **Acceptance:** a passing transport → `{ passed: true }`; an empty/unparseable response → `{ passed:
  false }`; profile C → `{ passed: false }`; a required-but-unresolvable secret → `{ passed: false }`; the
  auth header is only handed to the transport.
- **Verification:** `bun test packages/opencode/test/operator/semantic/feature026-reranker-e2e.test.ts`.
- **Evidence:** 2026-07-20 — `rerank-probe.ts` `createRerankValidationProbe` + `createFetchRerankHttpClient`
  over `rerankNative`/`rerankStructured`; `registry-backend.ts` `RerankValidationProbe.run` input += `modelRef`
  + `secretRef`; `planValidateReranker` passes `modelRef` (model.modelRef ?? id) + `secretRef` (ref). e2e:
  passing fake transport validates; failing transport → `validation_failed`; secret used but never leaked.

- [x] **T005 — Wire the probe into the live stack with the secret resolved for the transport**
- **Depends:** T004
- **Paths:** `packages/opencode/src/operator/stack-live.ts`
- **Deliverable:** build the keychain SecretPort with `exposeInternalMaterial: true`; construct
  `rerankProbe = createRerankValidationProbe({ http: createFetchRerankHttpClient(), resolveAuthHeader:
  SecretRef-coordinate -> keychain internal material -> "Bearer …" })`; pass `rerankProbe` to
  `createLiveSemanticBackend`. The secret is handed only to the transport (redaction intact — public
  `resolveMaterial` still returns `__redacted__`).
- **Acceptance:** `createLiveSemanticBackend` receives a composed `rerankProbe`; the public secret
  redaction is unchanged; a non-keychain/env-ref coordinate or an unresolvable ref resolves `null` (honest
  non-pass).
- **Verification:** `bunx tsc --noEmit` (opencode) 0 new errors; the composed backend path exercised by the
  operator test stacks.
- **Evidence:** 2026-07-20 — `stack-live.ts` keychain SecretPort `exposeInternalMaterial: true` (typed with
  the internal `resolveSecretMaterial`); `rerankProbe` composed with the fetch client + a SecretRef-coordinate
  resolver returning `Bearer <material>` or `null`; `createLiveSemanticBackend({ …, rerankProbe })`. opencode
  `tsc` → 0 new errors (pre-existing `dialog-move-session.tsx` only).

## Phase E — regression proof + validate (FR6, FR-all)

- [x] **T006 — FR6 regression proof over the REAL wired dispatcher (no Milvus, no injected state)**
- **Depends:** T003, T005
- **Paths:** `packages/opencode/test/operator/semantic/feature026-reranker-e2e.test.ts`,
  `packages/tui/test/operator/semantic/feature026-descriptor.test.ts`,
  `packages/core/test/operator/feature026-availability.test.ts`
- **Deliverable:** a suite driving the SAME live dispatcher the TUI uses (semantic domain over one
  `store.config`, the real probe over a FAKE rerank HTTP transport, NO Milvus, NO injected staged state)
  proving: (a) `provider.add → model.register → reranker.select → reranker.validate → reranker.cutover →
  reranker.rollback` from EMPTY, each persisting under CAS, the archive growing + rollback restoring; (b)
  `semantic.model.list` returns a FLAT descriptor that passes `isModelDescriptor` (no shape_mismatch); (c)
  a validated reranker model is an eligible selector candidate, a declared one is not; (d) the palette flip;
  (e) a failing probe → `validation_failed`, nothing committed; (f) the resolved secret used for the probe
  but NEVER in any result/audit line.
- **Acceptance:** all scenarios green; (a) asserts each step ok + version bump + archive/rollback; (e)
  asserts a non-success + unchanged (declared) model; (f) asserts the header reached the transport but the
  secret is absent from the serialized result + audit.
- **Verification:** `bun test` across opencode/tui/core operator suites.
- **Evidence:** 2026-07-20 — `feature026-reranker-e2e.test.ts` (4 tests, 56 expect()): full driven chain
  from EMPTY (two models, archive grows, rollback restores A); flat descriptor render + no nested shape;
  validated-model eligibility; failing probe → `validation_failed`, model stays declared, cutover
  `not_validated`; secret reaches transport (`Bearer …`) but absent from result/audit/list.
  `feature026-descriptor.test.ts` (5) + `feature026-availability.test.ts` (12) green.

- [x] **T007 — `bun test` + `tsc` + `speckit validate --json` green + doc sync**
- **Depends:** T006
- **Paths:** `doc/arch/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm every write stayed inside scope; run the suites, typecheck, and
  `speckit validate --json`; author the 026 corpus (spec/plan/tasks/ADR) in the Feature 024/025 style; keep
  `AGENTS.md`/`README`/`doc/arch` in sync (no code-doc surface change expected — the operator command
  surface is unchanged).
- **Acceptance:** guard clean; `bun test` (opencode `test/operator/ test/semantic/`, core `test/operator/`,
  tui `test/operator/`) green; `tsc` 0 new errors; `speckit validate --json` `ok:true`.
- **Evidence:** 2026-07-20 — opencode `bun test test/operator/ test/semantic/` → 641 pass / 4 skip / 0 fail
  (incl. the new feature026 suite); core `test/operator/` → 149 pass; tui `test/operator/` → 206 pass;
  `bunx tsc --noEmit` (core 0 / opencode 0-new / tui 0-new — pre-existing `dialog-move-session.tsx` only);
  `speckit validate --json` → `ok:true` (pre-existing waived hygiene findings only). Corpus authored:
  spec/plan/tasks + ADR-0026. No AGENTS.md/README surface change (operator command surface unchanged).

## Dependencies

- **Phase A (palette) and Phase B (descriptor) are independent** (core vs opencode files disjoint); T003
  depends on T002 (same registry file, model promotion after the flat projection); T004 (probe module) is
  independent; T005 depends on T004; T006 depends on T003/T005; T007 gates the commit.
- **No external dependency.** The Feature 019 reranker registry, the Feature 006 rerank client, the
  `RerankValidationProbe` seam, and the operator test stacks (`createDurableOperatorStore`,
  `createFakeConfigService`, `createLiveSemanticBackend`) are already present; no new SDK call, server
  change, provider connection, or Milvus endpoint is required.
- **Invariant:** no task self-commits, opens a parallel store, weakens the CAS guard, adds a Milvus
  dependency for the reranker slot, leaks the resolved secret, or adds an operator payload change, command
  id, catalog version bump, dispatch path, or feature flag (FR5, NFR).
