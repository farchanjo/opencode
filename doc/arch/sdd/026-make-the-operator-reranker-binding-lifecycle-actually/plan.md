# Implementation Plan: Make The Operator Reranker Binding Lifecycle Actually Functional End-To-End

Feature: 026-make-the-operator-reranker-binding-lifecycle-actually
Status target: implemented (this plan tracks the completed implement pass)
ADR: [ADR-0026](../../adr/0026-make-the-operator-reranker-binding-lifecycle-actually.md) **proposed**
Spec: [spec.md](spec.md) (FR1..FR6; audit result; domain model; palette-flip + composed-probe + flat-descriptor + binding-level-promotion + single-committed-CAS-write invariants)

## Overview

The operator `Semantic` screen advertised a reranker binding lifecycle it could not run: three
verified defects made `semantic.reranker.validate` read "not implemented yet", return "reranker
validation probe is not composed" when reached, render "no model descriptors", and show "no eligible
candidates". Feature 019 had already shipped the config-backed reranker archive
(`select`/`validate`/`cutover`/`rollback`, `reEmbedded:false`, NO Milvus) and the
`RerankValidationProbe` seam; the fix is composition + projection, not new domain logic. This plan
(a) flips the palette truth for `semantic.reranker.validate`, (b) composes a real reranker validation
probe over the Feature 006 rerank client with the provider secret resolved to an Authorization header
(redaction intact), (c) reconciles the descriptor projection to the FLAT protocol shape, and (d)
promotes a validated reranker model to an eligible selector candidate through the same config-backed
`reranker.validate` transition — with zero contract surface and no Milvus dependency.

**Audit conclusion driving this plan (every anchor verified 2026-07-20):**

- **The palette omitted `semantic.reranker.validate` from both persisting sets.** `persistenceFor`
  returned `honest_unavailable` → "Unavailable · not implemented yet", though the backend is
  config-backed and unconditionally composed (same class as `reranker.cutover`/`rollback`).
- **`stack-live.ts` never composed a `rerankProbe`.** `planValidateReranker` hit `probe === undefined`
  → typed gap "reranker validation probe is not composed". The seam was present and threaded.
- **`toDescriptor` emitted a nested shape the protocol type + TUI guard reject.**
  `projectSemanticSignal` degraded to `shape_mismatch`; nothing config-backed promoted a model's
  `validationStatus` from `declared` to `validated` (`model.validate` is `mutates: false`, un-composed
  provider gap).
- **The write path is `mutateAuthority`; the probe runs in the plan EFFECT (after CAS).** Neither
  backend self-commits; a rejected validate persists nothing.

**Explicitly out of this plan (invariants preserved):**

- **No self-commit, no parallel store.** The reranker plans read via `createConfigBackedRegistry` and
  return an `OperatorMutationPlan`; the single `mutateAuthority` CAS write commits it.
- **No Milvus for the reranker slot.** The lifecycle stays config-backed with `reEmbedded:false`; the
  ONLY provider interaction is the validation probe.
- **No contract change.** No operator payload, command id, catalog version, dispatch path, server/port
  surface, or feature flag is added or altered — the reranker verbs are already `mutates: true`, and
  `semantic.model.validate` stays `mutates: false`.
- **No Milvus/embedding verb is composed.** The embedding validate + index verbs stay honest gaps.

## Technical Approach

### Architecture layers affected

```
Phase A — palette truth flip  (FR1)
  packages/core/src/operator/palette.ts:
    OPERATOR_PERSISTING_VERBS += "semantic.reranker.validate" (config-backed, no Milvus)
        |
        v
Phase B — flat descriptor projection + modelRef  (FR3)
  packages/opencode/src/operator/semantic/registry-backend.ts:
    RegistryModel += optional modelRef; planRegisterModel persists input.modelRef
    toDescriptor -> FLAT SemanticModelDescriptor (drop the `as unknown` cast)
        |
        v
Phase C — reranker.validate promotes the model  (FR4)
  registry-backend.ts markValidated:
    staged.validated=true AND model.validationStatus="validated" (same passing probe)
        |
        v
Phase D — compose the reranker validation probe  (FR2, FR5)
  packages/opencode/src/operator/semantic/rerank-probe.ts (NEW):
    createRerankValidationProbe(http, resolveAuthHeader) over rerankNative/rerankStructured
    createFetchRerankHttpClient() for production
  registry-backend.ts RerankValidationProbe.run input += modelRef + secretRef
  planValidateReranker passes modelRef + secretRef to probe.run
  packages/opencode/src/operator/stack-live.ts:
    keychain SecretPort exposeInternalMaterial=true
    rerankProbe = createRerankValidationProbe({ http: fetch, resolveAuthHeader: SecretRef->Bearer })
    createLiveSemanticBackend({ …, rerankProbe })
        |
        v
Phase E — regression proof + validate  (FR6, FR-all)
  packages/opencode/test/operator/semantic/feature026-reranker-e2e.test.ts (real dispatcher, fake HTTP)
  packages/tui/test/operator/semantic/feature026-descriptor.test.ts (flat projection + eligibility)
  packages/core/test/operator/feature026-availability.test.ts (palette flip)
  bun test (opencode/core/tui operator+semantic) green; tsc 0 new; speckit validate ok
```

### Guard-scope note

Every write lands inside the active-feature implement scope (`doc/arch/speckit.toml` `[guard]
specScopeGlobs`): `packages/core/src/operator/palette.ts`,
`packages/opencode/src/operator/semantic/**` (registry-backend, rerank-probe),
`packages/opencode/src/operator/stack-live.ts`, and the test trees under
`packages/{opencode,core,tui}/test/operator/**`. `semantic-command-port.ts`,
`backend-live.ts`, the protocol `SemanticModelDescriptor`, and the TUI `state.ts` guard are READ
(their shape/seam is matched), not modified.

### Phase A — palette truth flip (FR1)

- `palette.ts`: add `"semantic.reranker.validate"` to `OPERATOR_PERSISTING_VERBS` (next to
  `reranker.cutover`/`rollback`), with a comment recording it is config-backed and Milvus-free.
  `persistenceFor` → `persists_today`; `operatorRowSubtitle` drops "not implemented yet". The
  Milvus-conditional set is untouched.

### Phase B — flat descriptor projection + modelRef (FR3)

- `registry-backend.ts`: add optional `modelRef` to `RegistryModel` (back-compatible); persist
  `input.modelRef` in `planRegisterModel`. Rewrite `toDescriptor` to emit the flat
  `SemanticModelDescriptor` (`id`, `providerProfileId`, `modelRef`, `displayName`, `source`,
  `capabilityKinds`, `endpointMode`, `languageSupport`, `probeState`, `enabled`) with only closed-enum
  narrowings — no `as unknown` shape cast. Import `CapabilityKind`/`EndpointMode`/`ModelSource`/
  `ProbeState`.

### Phase C — reranker.validate promotes the model (FR4)

- `registry-backend.ts` `markValidated`: on the same passing probe that promotes the staged binding to
  `{ state: "staged", validated: true }`, also map the underlying model's `validationStatus` to
  `"validated"`. So `semantic.model.list` projects the reranker model with `probeState === "validated"`
  and the selector eligibility holds. `semantic.model.validate` stays `mutates: false`.

### Phase D — compose the reranker validation probe (FR2, FR5)

- New `rerank-probe.ts`: `createRerankValidationProbe({ http, resolveAuthHeader })` composes
  `RerankClient.rerankNative` (profile A `/v1/rerank`) / `rerankStructured` (profile B) over an
  injected `RerankProbeHttpClient` (a single `postJson` seam), resolving the Authorization header from
  the provider `SecretRef` (failing HONESTLY when unresolvable) and refusing profile C.
  `createFetchRerankHttpClient` is the production transport. Extend `RerankValidationProbe.run` input
  with `modelRef` + `secretRef`; `planValidateReranker` passes them.
- `stack-live.ts`: build the keychain SecretPort with `exposeInternalMaterial: true`; construct
  `rerankProbe = createRerankValidationProbe({ http: createFetchRerankHttpClient(), resolveAuthHeader:
  SecretRef-coordinate -> keychain internal material -> "Bearer …" })`; pass `rerankProbe` to
  `createLiveSemanticBackend`. The secret is handed only to the transport (redaction intact).

### Phase E — regression proof + validate (FR6)

- `feature026-reranker-e2e.test.ts` drives the REAL wired dispatcher (semantic domain over one
  `store.config`, the real probe over a FAKE HTTP transport, NO Milvus, NO injected staged state):
  `provider.add → model.register → reranker.select → reranker.validate → reranker.cutover →
  reranker.rollback` from EMPTY; the flat descriptor render; the validated-model eligibility; the
  failing-probe rejection; the secret-never-leaks assertion. `feature026-descriptor.test.ts` (TUI)
  proves the flat projection + eligibility; `feature026-availability.test.ts` (core) proves the
  palette flip. `bun test` (opencode/core/tui operator+semantic) green; `bunx tsc --noEmit` 0 new
  errors (beyond the pre-existing `dialog-move-session.tsx`); `speckit validate --json` `ok:true`.

## Companion Artifacts

The following optional companion files may be created alongside this plan:

- `research.md` — the four-defect audit + the compose-vs-rewire trade-off (captured inline in the spec
  and ADR; deferred as a separate file).
- `data-model.md` — no new domain shape; the fix reuses the Feature 019 registry document + the
  Feature 006 `SemanticModelDescriptor` (`RegistryModel.modelRef` is an optional, back-compatible
  field).
- `contracts/` — no new interface contract; the operator payload, command id, and dispatch path are
  unchanged (the `RerankValidationProbe` seam is an internal seam, not a wire contract).
- `quickstart.md` — reproducing the empty-registry reranker chain over the operator sandbox (covered
  by `feature026-reranker-e2e.test.ts`).
