---
id: 019f8224-173a-75e1-981f-eae6ef86af70
number: 038
slug: make-operator-role-pools-accept-the-standard-provider
status: analyzed
created_at: 2026-07-21T00:47:11.162323Z
---
# Feature Specification: Make Operator Role Pools Accept The Standard Provider

Feature: 038-make-operator-role-pools-accept-the-standard-provider
Created: 2026-07-21
Scope: the Smart Routing candidate-resolution seam
(`packages/opencode/src/routing/adapters/outbound/catalog-adapter.ts`) and the
operator `pools.set` write path
(`packages/opencode/src/operator/pools/backend-live.ts`). Feature 001 built the
routing engine and its catalog candidate resolution; Features 033/034 made the
per-scope role pools (`routing` / `global:routing`) operator-writable; Feature 037
wired the engine into the live session so a populated role pool finally governs the
implicit-default model. This feature fixes a confirmed silent-failure footgun that
Feature 037 exposes: an operator `role_pool` model id in the STANDARD opencode
provider-qualified format (`provider/model`, used everywhere else — `--model`,
`cfg.model`, `tool/task.ts`) never resolves against the catalog, so routing silently
degrades to the static default with no error at configure time and no error at
routing time.

## The confirmed bug

The candidate resolver matches a configured role-pool model id against the catalog
by the provider-INTERNAL (bare) model id ONLY
(`catalog-adapter.ts#createCatalogAdapter.resolveCandidates`, keyed on
`CatalogModelSnapshot.modelId`). A role pool populated with the provider-qualified
form never matches any catalog model, so the routing candidate set is empty:

- `openai/gpt-5.6-sol-fast` → `routing.evaluate` returns `no_authorized_candidate`;
  the bare `gpt-5.6-sol-fast` resolves and routes. (Confirmed on the binary.)
- `openrouter/openai/gpt-oss-120b` → fails; the within-openrouter bare id
  `openai/gpt-oss-120b` resolves. (Confirmed on the binary.)

The failure is SILENT end-to-end: `pools.set` accepts the id with NO catalog
validation (`backend-live.ts#planSet` validates only structural shape — non-empty
role/model — never resolvability); every operator status command reports the config
present; and the Feature 037 session resolver, finding no authorized candidate,
degrades to the static default (`undefined`, its designed fallback). A mistyped or
provider-qualified pool id therefore looks configured but has zero effect.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A provider-qualified role-pool id routes like the bare id

- As an operator who configured a role pool with the standard `provider/model` form
  (the same format I use for `--model` and `cfg.model`), I want that id to resolve to
  the SAME routing candidate the bare id resolves to, so Smart Routing actually runs
  the model I configured instead of silently falling back to the static default.

### P1 — A mistyped or unresolvable id is rejected at configure time

- As an operator, I want `pools.set` to REJECT a role-pool model id that resolves to
  no known catalog model with a typed, actionable error naming the id, so a typo
  surfaces the moment I configure it rather than as a silent no-op discovered much
  later.

### P1 — Bare ids keep resolving exactly as before (back-compat)

- As a maintainer, I want every bare role-pool id that resolves today to keep
  resolving byte-for-byte identically, and the whole change to be inert for configs
  that use no provider-qualified ids, so this fix cannot regress an existing routing
  config.

### P2 — The nested provider-qualified case resolves to the right provider

- As an operator using a re-exposing provider (e.g. openrouter), I want
  `openrouter/openai/gpt-oss-120b` to resolve to provider `openrouter`'s model
  `openai/gpt-oss-120b` — never to provider `openai` — so re-exposed models route to
  the provider I actually named.

## Functional Requirements

### Group A — provider-qualified candidate resolution (FR-A)

1. **FR-A1 — accept both forms in candidate resolution.** `resolveCandidates` MUST
   resolve a role-pool model id that is provider-qualified (`provider/model`, where the
   head segment names a known provider present in the live catalog) against THAT
   provider's catalog entry for the tail model id, in addition to today's bare
   (within-provider) match.

2. **FR-A2 — bare-first precedence (back-compat).** Resolution MUST try the FULL id as
   a within-provider (bare) catalog id FIRST, and only fall back to the
   provider-qualified split when the full id matches no catalog model. This preserves
   full back-compat: every bare id that resolves today keeps resolving identically —
   even a within-provider id that itself contains slashes (e.g. openrouter's
   `openai/gpt-oss-120b`).

3. **FR-A3 — strip only the first known-provider segment.** When splitting a
   provider-qualified id, resolution MUST strip ONLY the first `/`-separated segment,
   and only when that segment names a known provider; the remainder is the
   within-provider model id and MAY itself contain slashes. So
   `openrouter/openai/gpt-oss-120b` resolves to provider `openrouter`, model
   `openai/gpt-oss-120b` — never provider `openai`.

4. **FR-A4 — normalise to the same candidate.** A provider-qualified id that resolves
   MUST produce the SAME resolved candidate as the bare id (identical resolved
   `modelId` — the catalog's within-provider bare id — and `providerId`) when the bare
   id is unique to that provider. The candidate identity and the derived
   `executor_model` are therefore identical for the two forms.

5. **FR-A5 — determinism and ambiguity unchanged.** A bare id served by MULTIPLE
   providers keeps today's deterministic behavior (the bare match is unchanged); a
   provider-qualified id REMOVES that ambiguity by naming the provider explicitly.
   Overall resolution determinism is unchanged.

6. **FR-A6 — normalise the decision-model pool consistently.** The decision-model pool
   ids MUST be resolved through the SAME catalog normalisation so a provider-qualified
   decision-pool id maps to the bare candidate id `pickHealthyDecisionModel` matches
   against; bare ids resolve to themselves, so this is byte-identical for pre-038
   configs.

### Group B — write-time validation at `pools.set` (FR-B)

7. **FR-B1 — reject unresolvable ids at write time.** `pools.set` MUST validate each
   role-pool model id against the live catalog (using the exact FR-A resolution) and
   REJECT any id that resolves to NO known catalog model with a typed operator error
   (`invalid_argument`), so a mistyped or unresolvable model surfaces at configure
   time rather than silently degrading a session.

8. **FR-B2 — actionable error naming the offender.** The rejection MUST name the
   offending id(s) in the error message.

9. **FR-B3 — a valid provider-qualified id passes.** An id that DOES resolve under
   FR-A (bare OR provider-qualified) MUST pass validation. A KNOWN-but-unhealthy model
   (disabled/deprecated) is a valid id and MUST pass — only `not_found_in_catalog`
   rejects.

10. **FR-B4 — preserve existing pools.set semantics.** Validation MUST NOT change the
    existing CAS/scope/idempotency behavior (Features 033/034) or the structural
    binding checks. It is a preflight over the SAME mutation plan; a rejected mutation
    leaves nothing persisted. The validator is INJECTED and OPTIONAL: a catalog-less
    construction keeps the pre-038 write behavior (so no existing test regresses).

## Non-Functional Requirements

- **Zero regression for bare configs.** With no provider-qualified id present, both the
  resolution path (bare-first) and the write path (a resolvable bare id) are
  byte-for-byte identical to today. No behavior change until an operator uses the
  provider-qualified form.
- **One resolution, one source of truth.** The `pools.set` validator reuses the exact
  `resolveCandidates` resolution (via `createCatalogModelValidator`), so a
  configure-time accept and a routing-time resolve can never diverge.
- **No new provider/model call cost on the hot path.** Candidate resolution already
  reads the live catalog; the change is pure in-memory map/lookup logic. `pools.set`
  validation reads the catalog once per write (an operator action, not a per-turn hot
  path).
- **Determinism.** Provider-qualified resolution is deterministic (bare-first, then a
  single known-provider prefix strip); no change to the sorted/first-match rules.

## Security Requirements

- **Data sensitivity/classification.** This feature reads operator configuration
  metadata (role-pool model ids) and the live provider catalog (model ids +
  provider ids + status). No credential, secret, or payload is read, written, logged,
  or surfaced; a role-pool model id is a non-sensitive catalog lookup key.
- **Authentication/authorization.** No new authenticated surface or permission
  boundary. `pools.set` keeps its existing principal check (only `operator`/`system`
  may mutate); validation runs AFTER the authorization gate and only narrows what may
  be written (it can reject, never widen).
- **Input validation.** The untrusted input is the operator-supplied role-pool model
  id. It is bounded by the catalog resolution: an id is accepted only when it resolves
  to a known catalog model (bare or a known-provider-qualified form); everything else
  is rejected with a typed error. The provider-qualified split is a single, bounded
  first-segment strip — no unbounded parsing, no recursion, no interpolation into any
  command or path.
- **Cryptography in transit/at rest.** Not applicable — this feature moves and persists
  no secret and adds no network I/O beyond the catalog read the routing/operator stack
  already performs.
- **Logging/audit.** No new logging. The existing bounded, secret-free `pools`
  operator audit event (which never carries a model id or payload) is unchanged; a
  rejected `pools.set` audits as `invalid` exactly like today's structural rejection.
- **Error-handling information exposure.** The rejection message contains only the
  operator's own offending model id and a fixed explanation — no catalog dump, no
  provider list, no credential, no internal path. A catalog read failure during
  validation degrades to a typed `unavailable` error (no stack trace surfaced).

## Acceptance Scenarios

Given the live catalog exposes `gpt-5.6-sol-fast` under provider `openai` and
`openai/gpt-oss-120b` under provider `openrouter`

- **Provider-qualified resolves like bare (FR-A1, FR-A4).**
  Given a role pool `worker = ["openai/gpt-5.6-sol-fast"]`,
  When candidate resolution runs,
  Then it resolves to the SAME candidate as `worker = ["gpt-5.6-sol-fast"]`
  (resolved `modelId` `gpt-5.6-sol-fast`, provider `openai`).

- **Nested provider-qualified case (FR-A3).**
  Given `openrouter/openai/gpt-oss-120b`,
  When candidate resolution runs,
  Then it resolves to provider `openrouter`, model `openai/gpt-oss-120b` — never
  provider `openai`.

- **Bare-first precedence (FR-A2).**
  Given `openai/gpt-oss-120b` (openrouter's within-provider id),
  When candidate resolution runs,
  Then it resolves as the bare openrouter id (unchanged), not the openai split.

- **Bare id back-compat (FR-A2).**
  Given a bare `gpt-5.6-sol-fast`,
  When candidate resolution runs,
  Then it resolves exactly as today.

- **pools.set rejects an unresolvable id (FR-B1, FR-B2).**
  Given `pools.set` with `worker = ["totally-not-a-model"]` (or
  `["unknown-provider/nope"]`),
  When the write is planned,
  Then it fails with an `invalid_argument` error naming the offending id and persists
  nothing.

- **pools.set accepts a valid provider-qualified id (FR-B3).**
  Given `pools.set` with `worker = ["openai/gpt-5.6-sol-fast"]`,
  When the write is planned,
  Then it is accepted and the mutation plan installs the binding.

## Observability

This feature adds no new metrics, log events, or trace spans. The behavioral change
is confined to WHICH role-pool ids resolve to a routing candidate (now both bare and
provider-qualified) and WHEN an unresolvable id is rejected (now at `pools.set`
configure time rather than silently at routing time). The existing routing decision
record (Feature 001, redacted) and the bounded `pools` operator audit event are
unchanged. Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

```
pools.set (backend-live.ts#planSet)                                     (FR-B)
  firstBindingDefect(bindings)        structural check (unchanged)
  catalog?  -> unknownModelIds(distinct ids)   resolve each id          (FR-B1)
                any not_found_in_catalog -> invalid_argument(name id)   (FR-B1,B2)
  planWrite(...)                       unchanged CAS/scope/idempotency   (FR-B4)
        |
        v
routing.evaluate -> candidates.resolve (catalog-adapter.ts)             (FR-A)
  resolveCandidates(modelIds):
    byId (bare), byProviderModel (`provider/model`), providers set
    for each id: resolveCatalogModel(id):
       byId.get(id)                     bare-first (back-compat)         (FR-A2)
       else first "/" head is known provider? byProviderModel.get(id)   (FR-A1,A3)
    candidate.modelId = resolved.modelId (bare) | requested id          (FR-A4)
  decisionPoolModelIds normalised through the SAME resolution           (FR-A6)
        |
        v
executor_model = candidate.model_id (bare within-provider id)  -> Feature 037
  resolveProviderForModel matches m.id === executor_model (UNCHANGED)
```

## Out of Scope

- **The Feature 037 session seam** (`session/routing-resolve.ts`, `session/prompt.ts`)
  and its provider re-resolution. Because a resolved candidate normalises to the
  within-provider bare id, `decision.selection.executor_model` stays bare (the id
  `Provider.list()` exposes as `model.id`), so `resolveProviderForModel` matches it
  unchanged — no parallel F037 change is required.
- **The scope/authority machinery** (Features 033/034) — unchanged; validation is a
  preflight over the same plan.
- **The operator-stack `InstanceRef` candidate-resolver defect**
  (`operator/stack-live.ts`) — a separate Feature 037 Phase 2 residual, untouched.
- **A UI/TUI model picker** for provider-qualified ids — out of scope; this feature is
  the resolution + validation fix only.

## Related Features and Decisions

- [ADR-0038 — Make operator role pools accept the standard provider-qualified id](../../adr/0038-make-operator-role-pools-accept-the-standard-provider.md)
- [Feature 001 — Define one cohesive Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the routing engine and the catalog candidate-resolution seam this feature corrects.
- [Feature 033 — Add a global authority scope for the pools (role_pools) operator config](../033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md) — the per-scope `pools.set` write path whose CAS/scope behavior this validation preserves.
- [Feature 034 — Add an explicit operator scope selector so global-scoped config is reachable](../034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md) — the explicit scope selector on the same write path.
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — the consumer this fix unblocks: a provider-qualified role pool now governs the live-session model instead of silently falling back.

## Clarifications

### Session 2026-07-21

- **Bare-first precedence protects full back-compat (FR-A2).** An id is matched as a
  within-provider bare id first; only a full-id miss triggers the provider-qualified
  split. So an existing within-provider id containing slashes keeps resolving as-is.
- **Only the first known-provider segment is stripped (FR-A3).** The remainder is the
  within-provider model id and may contain slashes, so nested ids resolve to the named
  provider, not an inner segment.
- **A resolved candidate normalises to the bare within-provider id (FR-A4).** The two
  forms yield the identical candidate and `executor_model`, so Feature 037's provider
  re-resolution needs no parallel change.
- **`pools.set` validates via the SAME resolution, and is injected/optional (FR-B1,
  FR-B4).** The validator reuses `resolveCandidates`; a catalog-less construction keeps
  the pre-038 write behavior, so the change is inert for existing tests and configs.
