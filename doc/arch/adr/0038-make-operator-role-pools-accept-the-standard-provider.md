---
status: proposed
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0038 — Make Operator Role Pools Accept The Standard Provider-Qualified Id

## Context and Problem Statement

Feature 037 wired the Feature 001 Smart Routing engine into the live session: when
Smart Routing is enabled in `auto` mode with a populated role pool, the engine now
chooses the session's implicit-default model. That exposed a confirmed silent-failure
footgun in how role pools are resolved.

Operator `role_pools` store model ids as catalog lookup keys. The candidate resolver
(`routing/adapters/outbound/catalog-adapter.ts#createCatalogAdapter.resolveCandidates`)
matches those keys against the catalog by the provider-INTERNAL (bare) model id ONLY
(`CatalogModelSnapshot.modelId`). But everywhere else in opencode a model is named in
the STANDARD provider-qualified form `provider/model` (`--model`, `cfg.model`,
`tool/task.ts`). A role pool populated with that standard form matches NO catalog
model, so the routing candidate set is empty:

- `openai/gpt-5.6-sol-fast` → `routing.evaluate` returns `no_authorized_candidate`;
  the bare `gpt-5.6-sol-fast` resolves and routes. (Confirmed on the binary.)
- `openrouter/openai/gpt-oss-120b` → fails; the within-openrouter bare id
  `openai/gpt-oss-120b` resolves. (Confirmed on the binary.)

The failure is SILENT end-to-end. `pools.set`
(`operator/pools/backend-live.ts#planSet`) validates only structural shape — non-empty
role and non-empty model ids — and NEVER resolvability, so it accepts the id with no
error. Every operator status command reports the config present. And the Feature 037
resolver, finding no authorized candidate, degrades to the static default — its
designed, non-throwing fallback. A mistyped or provider-qualified pool id therefore
looks configured but has zero effect, discoverable only by noticing routing never
engages.

The question: how to accept the standard provider-qualified id in routing candidate
resolution — resolving it to the SAME candidate the bare id resolves to, handling the
nested re-exposing case (`openrouter/openai/gpt-oss-120b`) correctly, preserving full
back-compat for bare ids, and surfacing an unresolvable id at configure time — without
touching the Feature 037 session seam or the Features 033/034 scope/authority
machinery.

## Decision Drivers

- **Accept the standard format, resolve to the SAME candidate.** A provider-qualified
  id must resolve to the identical routing candidate (and `executor_model`) the bare
  id resolves to when that bare id is unique to the provider.
- **Full back-compat for bare ids.** Every bare id that resolves today must resolve
  byte-for-byte identically, including a within-provider id that itself contains
  slashes; the change must be inert for configs that use no provider-qualified id.
- **Handle the nested case correctly.** Strip only the first segment, and only when it
  names a known provider; the remainder is the within-provider model id and may
  contain slashes.
- **Fail loud at configure time, not silent at routing time.** `pools.set` must reject
  an unresolvable id with a typed, actionable error naming it.
- **No collateral damage.** Do not change the Feature 037 session seam, its provider
  re-resolution, or the Features 033/034 CAS/scope/idempotency behavior.
- **One resolution, one source of truth.** The configure-time validator and the
  routing-time resolver must share the exact same resolution logic so they cannot
  diverge.

## Considered Options

- **Option A — bare-first resolution with a known-provider prefix strip, plus a
  `pools.set` validator that reuses that resolution (chosen).** In
  `resolveCandidates`, try the FULL id as a within-provider (bare) catalog id first
  (back-compat); on a miss, if the first `/`-separated segment names a known provider,
  resolve the id against that provider's `provider/model` catalog entry. Normalise a
  resolved candidate to the catalog's within-provider bare id so the two forms yield
  the identical candidate and `executor_model`. Expose the same resolution as
  `createCatalogModelValidator`, and have `pools.set` reject any id it flags as
  `not_found_in_catalog`. This is deterministic, byte-identical for bare configs,
  leaves `executor_model` bare (so Feature 037 is untouched), and makes the
  configure-time accept and routing-time resolve provably consistent.
- **Option B — provider-qualified-first (strip the provider whenever the head looks
  like one).** Rejected: it would change resolution for an existing within-provider id
  that contains a slash (e.g. openrouter's `openai/gpt-oss-120b` would be re-read as
  provider `openai`), breaking back-compat. Bare-first is the only order that preserves
  today's behavior.
- **Option C — validate/resolve by string-normalising role-pool ids to bare at
  `pools.set` write time (rewrite the stored id).** Rejected: it would lose the
  operator's explicit provider choice (the whole point of the qualified form for
  disambiguation), and a stored-bare id served by multiple providers is exactly the
  ambiguity the qualified form removes. Resolution, not rewriting, is the right layer.
- **Option D — also change the Feature 037 `resolveProviderForModel` to parse a
  provider-qualified `executor_model`.** Rejected as unnecessary: because a resolved
  candidate normalises to the within-provider bare id, `executor_model` stays the exact
  id `Provider.list()` exposes as `model.id`, so F037 already matches it. Adding a
  parallel parse there would be dead code and a second place to drift.

## Decision Outcome

Chosen option: **Option A**. Bare-first resolution with a single known-provider prefix
strip resolves the standard provider-qualified id to the same candidate as its bare id,
handles the nested case by construction, and is byte-identical for bare configs;
reusing that exact resolution as a `pools.set` validator turns the silent no-op into a
loud, actionable rejection at configure time.

Key decisions recorded:

1. **Bare-first precedence protects back-compat.** `resolveCandidates` tries the full
   id as a within-provider catalog id first; only a miss triggers the
   provider-qualified split. A within-provider id containing slashes keeps resolving
   as-is.
2. **Strip only the first known-provider segment.** The head must name a provider
   present in the live catalog; the remainder is the within-provider model id (which
   may itself contain slashes). So `openrouter/openai/gpt-oss-120b` resolves to
   provider `openrouter`, model `openai/gpt-oss-120b` — never provider `openai`.
3. **Resolved candidates normalise to the within-provider bare id.** The
   provider-qualified and bare forms produce the identical candidate identity and
   `executor_model`. The decision-model pool is normalised through the same resolution
   so a qualified decision-pool id still selects its candidate.
4. **`pools.set` validates via the same resolution and rejects unresolvable ids.** A
   new `createCatalogModelValidator` over `resolveCandidates` returns the
   `not_found_in_catalog` subset; `pools.set` fails with a typed `invalid_argument`
   error naming the offender before any write. A KNOWN-but-unhealthy id
   (disabled/deprecated) passes. The validator is INJECTED and OPTIONAL, so a
   catalog-less construction keeps the pre-038 write behavior; the CAS/scope/idempotency
   behavior (Features 033/034) is unchanged.
5. **Feature 037 needs no parallel change.** Because `executor_model` stays the bare
   within-provider id, `resolveProviderForModel` (which matches `m.id === executor_model`
   from `Provider.list()`) resolves it unchanged.

### Consequences

- Good: a role pool configured with the standard `provider/model` form now routes
  exactly like the bare id — Feature 037 finally governs the model an operator
  configured, instead of silently falling back to the static default.
- Good: a mistyped or unresolvable role-pool id is rejected at `pools.set` configure
  time with an error naming it, closing the silent-no-op footgun.
- Good: bare configs are byte-for-byte unchanged, and the write-time validation is
  inert unless the live catalog validator is injected (only the composition root wires
  it), so no existing routing/pools test regresses.
- Good: the configure-time accept and the routing-time resolve share one resolution
  function, so they cannot diverge.
- Neutral: `pools.set` now performs one catalog read per write (an operator action, not
  a per-turn hot path); a catalog outage during validation surfaces as a typed
  `unavailable` rather than a silent accept. A transiently-EMPTY catalog (a successful
  but empty provider read before providers are loaded/authed) degrades the SAME way —
  `unavailable`, never a false `invalid_argument` — so a valid write is not rejected
  while the catalog is cold.
- Residual: a UI/TUI affordance for entering/validating provider-qualified ids is out
  of scope; the operator-stack `InstanceRef` candidate-resolver defect remains a
  Feature 037 Phase 2 residual, untouched here.

## Related

- Feature specification: [038 Make operator role pools accept the standard provider-qualified id](../sdd/038-make-operator-role-pools-accept-the-standard-provider/spec.md)
- The routing engine and catalog candidate-resolution seam corrected here: [001 Define one cohesive Smart Agent Routing and OpenTelemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The per-scope `pools.set` write path whose CAS/scope behavior this validation preserves: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
- The explicit operator scope selector on the same write path: [034 Add an explicit operator scope selector so global-scoped config is reachable](../sdd/034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md)
- The consumer this fix unblocks (a provider-qualified role pool now governs the live-session model): [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
