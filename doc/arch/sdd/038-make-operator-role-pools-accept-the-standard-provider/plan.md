# Implementation Plan: Make Operator Role Pools Accept The Standard Provider

## Overview

Fix a confirmed silent-failure footgun: an operator `role_pool` model id in the
standard opencode `provider/model` provider-qualified form never resolves against
the catalog, so Smart Routing (Feature 037) silently degrades to the static default
— with no error at configure time and no error at routing time. This plan makes the
candidate resolver accept BOTH the provider-internal bare id (today) AND the
provider-qualified form, and makes `pools.set` reject an unresolvable id at write
time. Bare configs are byte-for-byte unchanged; a resolved provider-qualified id
normalises to the same candidate as its bare id, so Feature 037's provider
re-resolution needs no parallel change.

## Technical Approach

Two seams change; one composition-root thread wires them together.

- **Candidate resolution
  (`packages/opencode/src/routing/adapters/outbound/catalog-adapter.ts`).**
  - **`resolveCatalogModel` (new pure helper).** Given a requested id plus the
    catalog's `byId` (bare) map, `byProviderModel` (`provider/model`) map, and the set
    of known providers: try `byId.get(id)` FIRST (bare-first, full back-compat); on a
    miss, if the first `/`-separated segment names a known provider, return
    `byProviderModel.get(id)` (the remainder is the within-provider model id, which may
    itself contain slashes). No known-provider head → unresolved. (FR-A1, FR-A2, FR-A3)
  - **`createCatalogAdapter.resolveCandidates`.** Build the two maps + provider set
    once, resolve each id via `resolveCatalogModel`, and NORMALISE the resolved
    candidate's `modelId` to the catalog's within-provider bare id (`model.modelId`);
    keep the requested id only for an unresolved entry (so callers can name the
    offender). This makes the provider-qualified and bare forms yield the identical
    candidate identity + `executor_model`. (FR-A4)
  - **`createCandidateSource.resolve`.** Resolve the decision-model pool through the
    SAME `resolveCandidates`, so a provider-qualified decision-pool id maps to the bare
    id `pickHealthyDecisionModel` matches against; bare ids resolve to themselves. (FR-A6)
  - **`createCatalogModelValidator` (new, exported).** A narrow seam over
    `resolveCandidates`: `unknownModelIds(ids)` returns the subset that resolve with
    reason `not_found_in_catalog` (KNOWN-but-unhealthy disabled/deprecated ids are NOT
    flagged). This is the one place the write path reuses the exact resolution. (FR-B)
- **Write-time validation
  (`packages/opencode/src/operator/pools/backend-live.ts`).**
  - Add an OPTIONAL `catalog?: CatalogModelValidator` dep. `planSet` becomes an
    `Effect.gen`: structural `firstBindingDefect` first (unchanged), then — when a
    catalog validator is present — `unknownModelIds` over the deduped ids; any unknown
    id fails with `invalid_argument` naming the offender(s), before `planWrite`. A
    catalog read failure maps to a typed `unavailable`. With no validator injected the
    path is exactly today's (`planReset` is untouched). (FR-B1..FR-B4)
- **Composition root (`packages/opencode/src/operator/stack-live.ts`).** Extract the
  `createCatalogAdapter(...)` into a shared `catalogAdapter`, reuse it for both
  `createCandidateSource` and a new `createCatalogModelValidator(catalogAdapter)`, and
  pass that validator into `createLivePoolsBackend({ config, catalog })`. Only the live
  stack wires the validator; every unit test that builds the backend directly stays
  catalog-less and unaffected.

Back-compat (FR-A2, FR-B4): with no provider-qualified id, `byId.get` hits first and
the resolved bare id equals the requested id, so resolution is byte-identical; and a
catalog-less backend skips validation, so `pools.set` is unchanged.

Feature 037 (Out of Scope): a resolved candidate normalises to the within-provider
bare id, so `decision.selection.executor_model` stays bare — the exact id
`Provider.list()` exposes as `model.id`. `resolveProviderForModel` matches it
unchanged; no F037 edit is needed.

Testing (FR-A, FR-B):
- `packages/opencode/test/routing/catalog-adapter.test.ts` — provider-qualified id
  resolves to the SAME candidate as bare; the nested `openrouter/openai/gpt-oss-120b`
  case; bare-first precedence for a within-provider slash id; plain bare unchanged;
  unknown-provider stays unresolved; `createCandidateSource` parity + normalised
  decision pool; and `createCatalogModelValidator` flags only `not_found_in_catalog`.
- `packages/opencode/test/operator/pools/backend.test.ts` — `pools.set` rejects a bare
  and a provider-qualified unresolvable id (naming it, nothing persisted), accepts a
  valid provider-qualified id (flat + nested), and skips validation with no catalog.
- No existing routing/pools assertion is weakened.

## Companion Artifacts

No companion files are required: this feature adds no new entity, external contract,
or integration — it corrects the resolution logic of an existing seam and adds a
preflight over an existing mutation plan. The optional
`research.md` / `data-model.md` / `contracts/` / `quickstart.md` are intentionally
omitted (the Domain Model section in `spec.md` carries the flow); the `.feature` /
`.cue` scaffolds follow the 024–037 convention.
