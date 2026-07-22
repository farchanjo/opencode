---
id: 019f8048-1976-7be3-b473-657efb1b5f99
number: 026
slug: make-the-operator-reranker-binding-lifecycle-actually
status: implemented
created_at: 2026-07-20T16:07:16.598868Z
---
# Feature Specification: Make The Operator Reranker Binding Lifecycle Actually Functional End-To-End

Feature: 026-make-the-operator-reranker-binding-lifecycle-actually
Created: 2026-07-20
Scope: The operator `Semantic` TUI screen advertised a reranker binding lifecycle it could not
run. Three defects made `semantic.reranker.validate` unreachable and the panel empty even though
the config-backed reranker backend (a per-slot binding archive with NO Milvus dependency) had
shipped in Feature 019: (1) `semantic.reranker.validate` was in NEITHER the palette's static
persisting set NOR its Milvus-conditional set, so it rendered STATICALLY "Unavailable · not
implemented yet"; (2) the reranker validation probe was never COMPOSED into the live stack, so the
config-backed `planValidateReranker` returned "reranker validation probe is not composed"; (3) the
registry projected a NESTED model descriptor the protocol type and the TUI `isModelDescriptor`
guard reject, so `semantic.model.list` degraded to `shape_mismatch` ("no model descriptors") and
the reranker selector had "no eligible candidates". This feature makes the reranker lifecycle
functional end-to-end in production WITHOUT Milvus: it flips the palette truth, composes a real
reranker validation probe over the Feature 006 rerank client (with the provider secret resolved to
an Authorization header, redaction intact), reconciles the descriptor projection to the FLAT
protocol shape, and promotes a validated reranker model to an eligible selector candidate through
the same config-backed `reranker.validate` transition. No new command id, no catalog version bump,
no parallel config store, no self-commit, no weakening of the single-committed-CAS-write contract,
and no Milvus dependency for the reranker slot.

## Audit result (grounding — every anchor verified 2026-07-20)

- **The palette badge was statically unavailable.** `packages/core/src/operator/palette.ts` listed
  `semantic.reranker.validate` in NEITHER `OPERATOR_PERSISTING_VERBS` NOR
  `CONDITIONAL_PERSISTING_VERBS`, and `semantic` is not in `PERSISTING_DOMAIN_SET`, so
  `persistenceFor` returned `honest_unavailable` and `operatorRowSubtitle` rendered
  "Unavailable · not implemented yet" — even though the reranker backend is config-backed and
  UNCONDITIONALLY composed (the SAME class as `reranker.cutover`/`reranker.rollback`, already in the
  static set).
- **The reranker validation probe was never composed.**
  `stack-live.ts` constructed the semantic backend with NO `rerankProbe`, so
  `registry-backend.ts` `planValidateReranker` hit `probe === undefined` and returned the typed gap
  `{ type: "unavailable", reason: "reranker validation probe is not composed" }`. The seam
  (`RerankValidationProbe`, threaded `backend-live.ts` → `createConfigBackedRegistry`) was present
  and correct; only the composition was missing.
- **The descriptor projection was a shape mismatch.** `registry-backend.ts` `toDescriptor` emitted a
  NESTED `{ identity.display_name, capability.kinds, validation.status }` payload cast
  `as unknown as SemanticModelDescriptor`, but the protocol `SemanticModelDescriptor`
  (`packages/protocol/src/semantic/commands.ts`) and the TUI `isModelDescriptor` guard
  (`packages/tui/src/operator/semantic/state.ts`) require a FLAT `{ displayName, capabilityKinds,
  probeState, enabled, … }`. `projectSemanticSignal` therefore degraded to `shape_mismatch` and the
  panel rendered "no model descriptors".
- **Nothing promoted a registered reranker model to `validated`.** The reranker selector eligibility
  (`state.ts` `isRerankerEligible`) requires the model descriptor's `probeState === "validated"`,
  which projects from the registry model's `validationStatus`. `planRegisterModel` sets it
  `"declared"`, and `semantic.model.validate` is `mutates: false` in the catalog and routes to the
  un-composed provider gap — no config-backed path promoted the MODEL, so the selector had "no
  eligible candidates".
- **The registry write path is `mutateAuthority`; `apply` sees the FRESH payload.** The reranker
  plans return an `OperatorMutationPlan` the dispatcher commits through the single `mutateAuthority`
  CAS write; the probe runs in the plan EFFECT (after CAS, per the Feature 017 effectful-plan
  contract). Neither backend self-commits, so a rejected validate persists nothing.
- **The reranker slot has NO Milvus dependency.** Feature 019 established the config-backed reranker
  archive (`select`/`validate`/`cutover`/`rollback`) with `reEmbedded:false`; the ONLY provider
  interaction is the validation probe. This feature composes that probe without touching Milvus.

## Problem

The operator `Semantic` screen presented a reranker binding lifecycle that could not be driven to
completion in production. The validate verb read "not implemented yet"; even when reached, it
returned "reranker validation probe is not composed"; the model list rendered "no model
descriptors"; and the selector showed "no eligible candidates". Each is a distinct, verified defect
in the palette projection, the live composition, the descriptor projection, and the model-validation
promotion. This feature closes all four so that, from an empty registry, an operator can add a
provider, register a reranker model, select it, validate it (a real provider probe, no Milvus),
cut over, and roll back — with each transition persisted under CAS and the model surfaced as an
eligible selector candidate.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — An operator can validate a reranker binding from the Semantic screen

- As an operator, I want `semantic.reranker.validate` to read as an available, config-backed setting
  (not "not implemented yet") and to actually run a provider rerank probe that promotes my staged
  candidate to `validated`, so that I can complete a reranker cutover without a live Milvus stack.

### P1 — An operator can see the registered semantic models

- As an operator, I want `semantic.model.list` to render every registered model in the Semantic
  panel (not "no model descriptors"), so that I can see what I have registered and pick a reranker
  candidate.

### P1 — A validated reranker model is an eligible selector candidate

- As an operator, I want a reranker-capable model that has passed the validation probe to appear as
  an eligible candidate in the reranker selector (not "no eligible candidates"), so that I can bind
  it to the reranker slot.

### P1 — The reranker lifecycle works end-to-end without Milvus

- As an operator, I want the full chain — provider add, model register, reranker select, validate,
  cutover, rollback — to persist reliably under CAS with the archive growing and rollback restoring
  the prior, so that reranker configuration is durable and reversible with zero Milvus dependency.

### P1 — A failed or unauthenticated probe fails honestly

- As a maintainer, I want a non-passing probe, an unreachable endpoint, or an unresolvable secret to
  reject the validate with a typed error and commit NOTHING, and the resolved secret to never appear
  in a result, log, or audit line, so that the reranker slot never fabricates a validated state or
  leaks a credential.

### P2 — The badge flip is scoped to the reranker validate verb

- As a maintainer, I want ONLY `semantic.reranker.validate` to flip to persists_today, leaving the
  Milvus-conditional embedding/index verbs honest gaps, so no verb advertises persistence it lacks.

## Functional Requirements

### Group A — Palette truth flip (FR1)

1. **FR1 — `semantic.reranker.validate` reads persists_today / available.** It MUST be added to
   `OPERATOR_PERSISTING_VERBS` (`palette.ts`), alongside `reranker.cutover`/`reranker.rollback`, so
   `persistenceFor` returns `persists_today` and `operatorRowSubtitle` no longer reads "not
   implemented yet" — WITH or WITHOUT any `#BackendReadiness`. It MUST NOT be added to the
   Milvus-conditional set, and `semantic.embedding.validate` and the Milvus-conditional verbs MUST
   stay honest gaps. No catalog id, catalog version, or dispatch path changes.

### Group B — Compose the reranker validation probe (FR2)

2. **FR2 — a real `RerankValidationProbe` is composed into the live stack.** `stack-live.ts` MUST
   construct a reranker validation probe over the Feature 006 rerank client
   (`RerankClient.rerankNative` profile A `/v1/rerank`, `RerankClient.rerankStructured` profile B)
   and pass it as `rerankProbe` to `createLiveSemanticBackend`. The probe MUST resolve the provider
   base URL from the config-registered provider and the Authorization header from the provider's
   bounded `SecretRef` COORDINATE via the operator SecretPort's internal-material path (redaction
   intact — the secret is only handed to the transport, never logged, echoed into a result, or
   persisted). The transport is an injected seam (production `fetch`; tests a fake) so the whole
   chain runs with NO network. The probe seam input carries the provider-facing `modelRef` (a
   registered field) and the bounded `secretRef`; the reranker slot has NO Milvus dependency.

### Group C — Flat descriptor projection (FR3)

3. **FR3 — the registry projects the FLAT protocol descriptor shape.** `registry-backend.ts`
   `toDescriptor` MUST emit the flat `SemanticModelDescriptor` (`{ id, providerProfileId, modelRef,
   displayName, source, capabilityKinds, endpointMode, languageSupport, probeState, enabled }`) that
   the protocol type and the TUI `isModelDescriptor` guard require, dropping the `as unknown` shape
   cast. `semantic.model.list` MUST then project to `projected` (never `shape_mismatch`), so the
   panel renders every registered model. The persisted `RegistryModel` MUST carry the registered
   `modelRef` (optional, back-compatible) so the descriptor and the probe address the real provider
   model.

### Group D — Validated reranker model becomes eligible (FR4)

4. **FR4 — the `reranker.validate` transition promotes the model to `validated`.** The config-backed
   `markValidated` MUST, on the SAME passing probe that promotes the staged binding to
   `{ state: "staged", validated: true }`, also promote the underlying model descriptor's
   `validationStatus` to `"validated"`. So after `select → validate`, `semantic.model.list` projects
   the reranker-capable model with `probeState === "validated"`, satisfying the TUI selector
   eligibility (`enabled && probeState === "validated" && capabilityKinds includes "reranker"`) — no
   separate `semantic.model.validate` mutation is required (its catalog entry stays `mutates: false`).
   Nothing is fabricated: the model is marked validated ONLY on the passing provider probe.

### Group E — Honest single-committed-CAS-write + secret safety (FR5)

5. **FR5 — the CAS-write contract is intact and failures are honest.** Neither backend MUST
   self-commit: the Feature 007 `mutateAuthority` pipeline owns the ONE committed CAS write + audit.
   A non-passing probe MUST reject `validation_failed`, an unreachable endpoint / unresolvable secret
   MUST fail HONESTLY, and a stale expected-version MUST stay a CAS conflict — each committing
   NOTHING (no phantom write, no fabricated `validated`, no version bump). The resolved secret MUST
   never appear in a `CommandResult`, log, or audit line (redaction intact). Profile C
   (`embedding-similarity`) MUST stay reranker-ineligible.

### Group F — Regression proof over the REAL wired dispatcher (FR6)

6. **FR6 — the whole lifecycle is proven end-to-end.** Coverage MUST drive the SAME live dispatcher
   construction the TUI uses (the semantic domain over one shared `store.config`, the real reranker
   validation probe over a FAKE rerank HTTP transport, NO Milvus, NO injected staged state) and
   prove: (a) `provider.add → model.register → reranker.select → reranker.validate → reranker.cutover
   → reranker.rollback` from an EMPTY registry, each persisting under CAS, the archive growing and
   rollback restoring the prior; (b) `semantic.model.list` returns a FLAT descriptor that passes
   `isModelDescriptor` (no `shape_mismatch`); (c) a validated reranker model is an eligible selector
   candidate, a declared one is not; (d) `semantic.reranker.validate` resolves to persists_today /
   available in the palette; (e) a failing probe → typed `validation_failed`, nothing committed; (f)
   the resolved secret is used for the probe call but NEVER appears in any result or audit line.

## Non-Functional Requirements

- **No new store, no self-commit.** The change reuses the config-backed registry's
  `createConfigBackedRegistry` reads + `OperatorMutationPlan`; no parallel config store, no
  self-commit, no second authority.
- **Zero Milvus dependency for the reranker slot.** The reranker lifecycle stays config-backed with
  `reEmbedded:false`; the ONLY provider interaction is the validation probe.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id, catalog
  version, dispatch path, server/port surface, or feature flag is added or altered;
  `semantic.reranker.validate`/`select`/`cutover`/`rollback` are already `mutates: true`.
- **Redaction intact.** The provider secret is resolved to an Authorization header for the probe
  transport only; it is never logged, echoed into a result, or persisted.
- **Honest failure.** Every rejected validate surfaces a typed, bounded, secret-free reason; no
  failure is swallowed or rendered as a fabricated `validated`.

## Acceptance Scenarios

Given the operator control plane is enabled and a live wired stack is in use

- **The reranker validate verb is available (FR1, FR6-d).**
  Given the Operator · Semantic screen,
  When it lists the Configure verbs,
  Then `semantic.reranker.validate` reads as an available config-backed setting, not "Unavailable ·
  not implemented yet".

- **The full reranker lifecycle drives end-to-end (FR2, FR4, FR5, FR6-a).**
  Given a FRESH (empty) registry and a passing provider rerank probe over the fake transport,
  When the operator dispatches `provider.add`, `model.register`, `reranker.select`,
  `reranker.validate`, `reranker.cutover`, then `reranker.rollback`,
  Then every step commits under CAS, the validate promotes the staged binding AND the model to
  `validated`, the cutover archives the outgoing active, and the rollback restores the prior.

- **The model descriptors render flat (FR3, FR6-b).**
  Given a provider + a registered reranker model,
  When the panel projects `semantic.model.list`,
  Then it yields a FLAT descriptor that passes `isModelDescriptor` (no `shape_mismatch`) and renders
  in the model badge rows.

- **A validated reranker model is an eligible candidate (FR4, FR6-c).**
  Given a reranker model promoted to `validated` through `reranker.validate`,
  When the reranker selector filters candidates,
  Then the model is eligible; a still-`declared` model is not.

- **A failing probe rejects honestly (FR5, FR6-e).**
  Given a non-passing provider probe,
  When the operator dispatches `reranker.validate`,
  Then it rejects `validation_failed`, the model stays `declared`, a subsequent cutover is
  `not_validated`, and nothing is committed.

- **The secret never leaks (FR2, FR5, FR6-f).**
  Given a provider with a resolvable secret,
  When the probe runs,
  Then the transport receives the resolved Authorization header, but the secret material never
  appears in any result, log, or audit line.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes the config-backed semantic
  REGISTRY document (providers, models, and per-slot reranker bindings) under the `semantic` Config
  authority — operator configuration metadata. It additionally RESOLVES a provider credential to an
  Authorization header for the reranker validation probe. The credential is the only sensitive
  material; it is resolved through the operator SecretPort's internal-material path for the probe
  transport ONLY and is never persisted, logged, echoed, or returned. Providers persist a bounded
  `SecretRef` coordinate, never plaintext (Feature 007 FR11 preserved).
- **Authentication/authorization.** No new authenticated operator surface, credential, or permission
  boundary. The reranker verbs ride the existing Feature 007 operator principal, scope, CAS, and
  confirmation gates unchanged; `mutateAuthority` enforces the same authorization every other
  mutation uses. The validation probe authenticates to the provider using the operator-entered
  `SecretRef` — no new secret is minted.
- **Input validation.** The untrusted inputs are the operator payloads (`provider.add` endpoint +
  `SecretRef`, `model.register` capabilities + `modelRef`, `reranker.select` profile) and the probe's
  provider response. Endpoints are parsed under the existing offline SSRF-safe static policy;
  `SecretRef` values are validated against the bounded coordinate pattern; profile C
  (`embedding-similarity`) is refused for the reranker slot; the provider probe response is parsed
  defensively (an unrecognized/empty shape yields a non-pass, never a crash or a fabricated pass).
- **Cryptography in transit/at rest.** The reranker validation probe MUST send its request over the
  provider's configured endpoint (TLS required by default; an insecure-local profile is opt-in via
  the existing transport policy). No new at-rest encryption requirement beyond what Config.Service
  and the SecretPort already provide.
- **Logging/audit.** No new logging. The committed reranker mutations project through the existing
  Feature 007 EventV2 audit correlation via the single `mutateAuthority` `finalize` path, unchanged.
  The resolved secret and the probe request/response body are never carried into a log or audit line.
- **Error-handling information exposure.** Rejected validates surface the existing typed, bounded
  reasons (`validation_failed`, `not_validated`, `reranker_not_eligible`, `unavailable`, CAS
  conflict) — never a stack trace, a raw provider response, a secret, or an endpoint credential.
  Config reads and the probe transport are guarded and degrade to a typed non-pass, never an
  unhandled throw.

## Observability

This feature composes an existing config-backed lifecycle and adds a single injected probe seam, so
it emits no new metrics, log events, or trace spans. Committed `semantic.reranker.*` mutations
project through the existing Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with
content-free, bounded labels (command id, domain, surface, outcome) — unchanged, because the payload
contract and dispatch path are unchanged. The behavioral change is only WHICH verbs are composed
(the reranker validate probe), the descriptor SHAPE the panel renders, and the model promotion the
validate transition writes. Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The reranker lifecycle reuses the Feature 019 config-backed registry
(`packages/opencode/src/operator/semantic/registry-backend.ts`) and the Feature 006 rerank client
(`packages/opencode/src/semantic/rerank-client.ts`); no new schema shape is introduced (the
`RegistryModel.modelRef` field is optional and back-compatible). The corrected flow:

```
Operator · Semantic screen (reranker lifecycle)
        |
        v
palette.ts: semantic.reranker.validate ∈ OPERATOR_PERSISTING_VERBS  -> persists_today (FR1)
        |
        v
dispatch: provider.add -> model.register (modelRef persisted)      (FR3)
        |                        |
        |                        v
        |        registry toDescriptor -> FLAT SemanticModelDescriptor (FR3)
        |            semantic.model.list -> isModelDescriptor OK (no shape_mismatch)
        v
dispatch: reranker.select (stages draft) -> reranker.validate
        |
        v
stack-live.ts: rerankProbe = createRerankValidationProbe(          (FR2)
    http: fetch (prod) | fake (tests),
    resolveAuthHeader: SecretRef -> keychain internal material -> "Bearer …" (redaction intact))
        |
        v
registry planValidateReranker: probe.run({ baseUrl, profile, modelRef, secretRef })  (FR2/FR5)
    pass  -> markValidated: staged.validated=true AND model.validationStatus="validated" (FR4)
    fail  -> validation_failed, commit nothing (FR5)
        |
        v
model.list descriptor probeState="validated" -> reranker selector eligible candidate (FR4)
        |
        v
dispatch: reranker.cutover -> reranker.rollback  (config-backed archive, NO Milvus)   (FR6-a)
    mutateAuthority = ONE committed CAS write; a stale version -> conflict, nothing committed (FR5)
```

## Out of Scope

- **Wiring `semantic.model.validate` as a mutation / flipping its catalog `mutates` flag** — the
  model is promoted to `validated` through the already-`mutates:true` `reranker.validate` transition
  (FR4); `semantic.model.validate` stays `mutates: false`, no catalog change.
- **Composing the embedding validate / index verbs** — they stay Milvus-conditional honest gaps
  (FR1); this feature does not touch Milvus.
- **Any operator payload, command id, catalog version, dispatch path, or feature flag change** — the
  reranker verbs are already `mutates: true`; only the palette set, the backend composition, the
  descriptor projection, and the model promotion change.
- **Changing the TUI reranker forms or the selector projection logic** — the selector already filters
  on the flat descriptor's `probeState`; this feature only makes the descriptor render flat and the
  model reach `validated`.

## Related Features and Decisions

- [ADR-0026 — Make the operator reranker binding lifecycle actually functional end-to-end](../../adr/0026-make-the-operator-reranker-binding-lifecycle-actually.md)
- [Feature 019 — Reranker cutover/rollback + per-slot binding archive (config-backed, no Milvus)](../019-complete-the-semantic-binding-lifecycle-and-the-remaining/spec.md) — the reranker lifecycle backend + the `RerankValidationProbe` seam this feature composes.
- [Feature 014 — Wire the config-backed semantic registry half](../014-complete-the-operator-control-plane-persistence-and-service/spec.md) — the `createConfigBackedRegistry` round-trip + the palette per-verb persistence overrides this feature extends.
- [Feature 006 — Milvus-backed multilingual semantic retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — the rerank client (`rerankNative`/`rerankStructured`) + the `SemanticModelDescriptor` protocol shape + the reranker capability rules (profile C never eligible).
- [Feature 007 — Operator control plane and native command authority](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — the `mutateAuthority` single-committed-CAS-write + audit + the SecretPort the probe resolver uses.

## Clarifications

### Session 2026-07-20

- **The palette flip is scoped to `semantic.reranker.validate` (FR1).** It joins the static persisting
  set (config-backed, no Milvus, same class as cutover/rollback); the Milvus-conditional embedding/
  index verbs stay honest gaps. Recorded in ADR-0026.
- **The reranker validation probe is composed over the rerank client with the secret resolved for the
  transport only (FR2).** The probe rides `rerankNative`/`rerankStructured` over an injected HTTP
  transport; the Authorization header is resolved from the provider `SecretRef` via the SecretPort's
  internal-material path and never leaves the transport. Recorded in ADR-0026.
- **The descriptor projection is reconciled to the FLAT protocol shape (FR3).** `toDescriptor` emits
  the flat `SemanticModelDescriptor` (dropping the `as unknown` cast) so `isModelDescriptor` accepts
  it; `RegistryModel` persists the `modelRef`. Recorded in ADR-0026.
- **The model reaches `validated` through the `reranker.validate` transition, not a `model.validate`
  mutation (FR4).** `markValidated` promotes both the staged binding and the underlying model's
  `validationStatus` on the SAME passing probe; `semantic.model.validate` stays `mutates: false`.
  Recorded in ADR-0026.
- **Alternatives rejected (ADR-0026).** Flipping `semantic.model.validate` to a mutation (catalog
  churn), leaving `rerankProbe` unset (the honest gap that blocks the operator), a nested-shape TUI
  guard (widening the protocol type), and reading the secret plaintext into the result were all
  rejected in favor of the scoped palette flip + composed probe + flat projection + binding-level
  promotion.
