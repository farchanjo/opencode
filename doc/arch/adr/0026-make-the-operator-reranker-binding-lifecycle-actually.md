---
status: accepted
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0026 — Make The Operator Reranker Binding Lifecycle Actually Functional End-To-End

## Context and Problem Statement

The operator `Semantic` TUI screen advertised a reranker binding lifecycle it could not run. Feature
019 shipped the config-backed reranker archive (`select`/`validate`/`cutover`/`rollback`, per-slot
version archive, `reEmbedded:false`, NO Milvus), but three defects — verified 2026-07-20, every
`file:line` checked over the real wired dispatcher — left the lifecycle unreachable and the panel
empty:

- **The palette badge was statically unavailable.** `packages/core/src/operator/palette.ts` listed
  `semantic.reranker.validate` in NEITHER `OPERATOR_PERSISTING_VERBS` NOR
  `CONDITIONAL_PERSISTING_VERBS`, and `semantic` is not a persisting domain, so `persistenceFor`
  returned `honest_unavailable` and the row read "Unavailable · not implemented yet" — even though
  the reranker backend is config-backed and UNCONDITIONALLY composed (the SAME class as
  `reranker.cutover`/`reranker.rollback`, already in the static set).
- **The reranker validation probe was never composed.** `stack-live.ts` built the semantic backend
  with NO `rerankProbe`, so `registry-backend.ts` `planValidateReranker` returned the typed gap
  `{ type: "unavailable", reason: "reranker validation probe is not composed" }`. The seam
  (`RerankValidationProbe`, threaded through `backend-live.ts` → `createConfigBackedRegistry`) was
  present; only the composition was missing.
- **The descriptor projection was a shape mismatch.** `toDescriptor` emitted a NESTED
  `{ identity.display_name, capability.kinds, validation.status }` cast `as unknown as
  SemanticModelDescriptor`, but the protocol `SemanticModelDescriptor` and the TUI `isModelDescriptor`
  guard require a FLAT `{ displayName, capabilityKinds, probeState, enabled, … }`.
  `projectSemanticSignal` degraded to `shape_mismatch` → "no model descriptors", and the reranker
  selector (which filters on the descriptor's `probeState === "validated"`) had "no eligible
  candidates". Additionally, nothing config-backed promoted a registered model's `validationStatus`
  from `"declared"` to `"validated"` (the model-level `semantic.model.validate` is `mutates: false`
  and routes to the un-composed provider gap).

The question: how to make the reranker lifecycle functional end-to-end in production WITHOUT Milvus —
flip the palette truth, compose a real validation probe (authenticated, redaction intact), render
the descriptor, and promote a validated model to an eligible selector candidate — **without** a new
command id, a catalog version bump, a parallel store, a self-commit, or a weakening of the
single-committed-CAS-write contract.

## Decision Drivers

- **Compose what already shipped.** Feature 019's reranker backend + the `RerankValidationProbe` seam
  are present and correct; the fix is composition + projection, not new domain logic.
- **No Milvus for the reranker slot.** The reranker lifecycle is config-backed with
  `reEmbedded:false`; the ONLY provider interaction is the validation probe.
- **Honest truth in the palette.** A config-backed, unconditionally-composed verb must read
  persists_today; a Milvus-conditional verb must stay an honest gap.
- **Redaction intact.** The provider secret is resolved to an Authorization header for the probe
  transport ONLY; it never crosses the CommandResult/audit/config seam.
- **Preserve the single-committed-CAS-write / optimistic-concurrency guard.** No self-commit, no
  fabricated `validated`; a failing probe or stale version commits nothing.
- **Zero contract surface.** No operator payload, command id, catalog version, dispatch path, or
  feature flag change; the reranker verbs are already `mutates: true`.

## Considered Options

- **Option A — Flip the palette set, compose a real probe over the rerank client, reconcile the
  descriptor to the flat protocol shape, and promote the model through the `reranker.validate`
  transition (chosen).** `palette.ts` adds `semantic.reranker.validate` to
  `OPERATOR_PERSISTING_VERBS`; `stack-live.ts` composes `createRerankValidationProbe` (over
  `rerankNative`/`rerankStructured` with the provider secret resolved to an auth header);
  `registry-backend.ts` `toDescriptor` emits the flat descriptor (and `RegistryModel` persists
  `modelRef`); `markValidated` promotes both the staged binding AND the model's `validationStatus`.
- **Option B — Flip `semantic.model.validate` to a `mutates: true` mutation and wire a
  `planValidateModel`.** Rejected: it churns the reserved catalog (a `mutates` flag flip + version
  considerations) and duplicates the probe with no selected profile at the model level, when the
  already-`mutates:true` `reranker.validate` transition (which knows the profile from the staged
  binding) can promote the model on the same passing probe.
- **Option C — Leave `rerankProbe` unset (the honest gap) and only fix the palette/descriptor.**
  Rejected: the operator still cannot complete a validate — it returns "reranker validation probe is
  not composed"; the lifecycle stays non-functional.
- **Option D — Widen the TUI `isModelDescriptor` guard to accept the nested shape.** Rejected: it
  forks the protocol `SemanticModelDescriptor` shape into two, breaking the single wire authority; the
  registry projection must match the protocol type, not the other way around.
- **Option E — Read the provider secret as plaintext into the probe result / a header echoed back.**
  Rejected: it breaks the Feature 007 redaction guarantee. The secret is resolved through the
  SecretPort internal-material path for the transport only and never returned.

## Decision Outcome

Chosen option: **Option A**, because it makes the reranker lifecycle functional end-to-end in
production WITHOUT Milvus — one committed CAS write per transition, no self-commit, no parallel store,
redaction intact — by composing the backend that already shipped (Feature 019) and reconciling the
descriptor projection to the authoritative protocol shape, with zero contract surface.

Key decisions recorded:

1. **Palette truth flip (FR1).** `semantic.reranker.validate` joins `OPERATOR_PERSISTING_VERBS`
   (config-backed, no Milvus, same class as `reranker.cutover`/`rollback`); the Milvus-conditional
   embedding/index verbs stay honest gaps.
2. **Compose the reranker validation probe (FR2).** `stack-live.ts` constructs
   `RerankProbe.createRerankValidationProbe` over `RerankClient.rerankNative` (profile A `/v1/rerank`)
   / `rerankStructured` (profile B) with an injected HTTP transport (production `fetch`; tests a
   fake). The Authorization header is resolved from the provider's bounded `SecretRef` coordinate via
   the keychain internal-material path (`exposeInternalMaterial`), handed only to the transport. The
   probe seam input is extended with the provider-facing `modelRef` and the `secretRef`; a
   required-but-unresolvable secret fails HONESTLY.
3. **Flat descriptor projection (FR3).** `toDescriptor` emits the flat `SemanticModelDescriptor`
   (dropping the `as unknown` cast); `RegistryModel` persists the registered `modelRef` (optional,
   back-compatible). `semantic.model.list` then projects to `projected`, so the panel renders every
   registered model.
4. **The `reranker.validate` transition promotes the model (FR4).** `markValidated` promotes both the
   staged binding to `{ state: "staged", validated: true }` AND the underlying model's
   `validationStatus` to `"validated"` on the SAME passing probe, so the reranker-capable model
   becomes an eligible selector candidate. `semantic.model.validate` stays `mutates: false` — no
   catalog change.
5. **Honest single-committed-CAS-write + secret safety (FR5).** Neither backend self-commits;
   `mutateAuthority` owns the ONE committed CAS write + audit. A non-passing probe rejects
   `validation_failed`, an unresolvable secret / unreachable endpoint fails honestly, a stale version
   stays a CAS conflict — each committing nothing. The resolved secret never appears in a result, log,
   or audit line. Profile C stays reranker-ineligible.
6. **Regression proof over the REAL wired dispatcher (FR6).** `feature026-reranker-e2e.test.ts` drives
   the same live construction the TUI uses (semantic domain over one `store.config`, the real probe
   over a fake HTTP transport, NO Milvus, NO injected staged state): `provider.add → model.register →
   reranker.select → reranker.validate → reranker.cutover → reranker.rollback` from an EMPTY registry,
   the flat descriptor render, the validated-model eligibility, the failing-probe rejection, and the
   secret-never-leaks assertion. `feature026-descriptor.test.ts` (TUI) proves the flat projection +
   eligibility; `feature026-availability.test.ts` (core) proves the palette flip.
7. **No contract change (invariant).** No operator payload, command id, catalog version, dispatch
   path, server/port surface, or feature flag is added or altered; only the palette set, the backend
   composition, the descriptor projection, the model promotion, the `RegistryModel.modelRef` field,
   and the `RerankValidationProbe` seam input change.

### Consequences

- Good: an operator can finally drive the reranker binding lifecycle to completion from the Semantic
  screen — validate is available, the models render, a validated reranker model is an eligible
  candidate, and cutover/rollback persist under CAS — with ZERO Milvus dependency.
- Good: the reranker validation probe is composed honestly — a real provider rerank call, the secret
  resolved for the transport only (redaction intact), and a failing/unauthenticated probe rejects
  without fabricating a `validated`.
- Good: the descriptor projection now matches the single protocol wire authority; the nested-shape
  `shape_mismatch` that emptied the panel is gone.
- Good: zero contract surface and an unchanged CAS guard — no server, SDK, or catalog work, and
  lost-update protection is fully preserved.
- Neutral (documented): the model reaches `validated` through the `reranker.validate` binding
  transition rather than a `model.validate` mutation; `semantic.model.validate` stays `mutates:
  false`. The promotion is honest — it fires only on the same passing provider probe.
- Neutral (documented): the production `fetch`-backed probe transport + the keychain internal-material
  resolver are exercised in production but not by the offline test suite (which injects a fake
  transport + resolver); a non-parseable/unreachable provider response degrades to a non-pass.

## Related

- Feature specification: [026 Make the operator reranker binding lifecycle actually functional end-to-end](../sdd/026-make-the-operator-reranker-binding-lifecycle-actually/spec.md)
- The reranker lifecycle backend + the `RerankValidationProbe` seam this feature composes: [Feature 019 Reranker/embedding cutover-rollback](../sdd/019-complete-the-semantic-binding-lifecycle-and-the-remaining/spec.md)
- The config-backed semantic registry + the palette per-verb persistence overrides: [Feature 014 Wire the config-backed semantic registry](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- The rerank client + the `SemanticModelDescriptor` protocol shape + the reranker capability rules: [Feature 006 Milvus-backed multilingual semantic retrieval](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- The operator mutation-plan handler contract + `mutateAuthority` pipeline + the SecretPort: [ADR-0017 Close the implementable operator capability gaps](0017-close-the-implementable-operator-capability-gaps-so-the.md)
- Mutation authority / CAS guard: [ADR-0003 Operator control plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)

## Links

- Related: ADR-0007, ADR-0008, ADR-0019, ADR-0050, ADR-0051.
