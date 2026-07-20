---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0021 — Operator Config Backed Saves Must Persist Reliably And Never Silently Zero

## Context and Problem Statement

An operator config-backed save can fail to persist and re-open **empty** ("fica
zerado"). The reproduced case is a role→model pool `pools.set`: the operator
saves a binding, the save appears to succeed, and the pool re-opens empty. A deep
trace (2026-07-20, every `file:line` verified) isolated the root cause to the
**mutation preflight resolving the wrong Config authority**:

- `pools.set` commits to the shared `"routing"` authority — `PROJECT_AUTHORITY`
  (`packages/opencode/src/operator/pools/backend-live.ts:44`) — the same authority
  routing/smart/budget documents share.
- The mutation preflight must resolve `pools.set → "routing"` to read that
  authority's CAS token. The correct resolver
  (`packages/opencode/src/operator/application/command-authority.ts:76-116`,
  introduced by the ADR-0017 fix-round) maps `case "pools" → POOLS_AUTHORITY
  ("routing")`.
- The **degraded fallback** `authorityKeyForCommandId`
  (`packages/opencode/src/operator/adapters/outbound/config-status.ts:10-13`)
  returns the command-id **prefix** `"pools"` — an authority that is NEVER
  written. Reading a virgin authority yields `currentVersion=null`/
  `configured=false`, so no CAS token is threaded; the second `pools.set` (and any
  first `pools.set` on a config that already holds a routing document) then hits
  the correct-by-design guard `mutations require version (CAS token) when
  authority already exists`
  (`packages/opencode/src/operator/application/mutation.ts:224-233`) and commits
  nothing. The pool's subsequent silent read seeds from an authority with no
  `pools` document, so it renders empty.

**Audit conclusion (grounds this ADR's honesty — every anchor verified):**

- **Prong B — NO wiring gap at HEAD.** Every production operator preflight
  entrypoint threads the real `LiveOperatorStack.resolveAuthority`
  (`stack-live.ts:836-840,864`): the trusted worker fetch
  (`worker-adapter.ts:49`, used by the local TUI via the RPC slash port), the
  worker-local slash port (`worker-adapter.ts:72-74`), and the HTTP mount's
  production and test branches (`http/mount.ts:88,149`, resolving at
  `http/handler.ts:228`). The remote/attach `createHttpOperatorSlashPort` and the
  local `createWorkerRpcSlashPort` forward preflight to that server handler. The
  CLI (`op.ts:146-152`) threads an explicit version and does not use the fallback.
  So the user's field failure is a **stale binary** predating `stack-live.ts:836`
  OR a mis-wired port — NOT a defect in current HEAD's wiring. This ADR does not
  invent a wiring gap that isn't there.
- **Prong A — the degraded fallback IS incorrect (the substantive fix).** The
  naive prefix fallback is the wrong authority for every command whose commit
  authority ≠ its prefix: `pools → routing`, `telemetry → global:telemetry`,
  `smart`/`budget → global:routing`|`routing`, `mcp.* → global:mcp*`,
  `output → global:output-admin`, `langlock → scope-dependent` (only `jobs` and
  `semantic` match their prefix). It is reached exactly on the stale/mis-wired
  path, and is a latent hazard for any future port.
- **Prong D — a rejected save IS surfaced at HEAD (non-regression).**
  `executeOperatorCommand` (`packages/tui/src/operator/execute.ts`) returns the
  typed `outcome`/`display` for a rejected mutation; the form save handlers render
  it in-modal via `setError(failureReason(result))` and keep the modal open on a
  non-success outcome (`edit-modal.tsx:113-119`, `multi-field-modal.tsx:289-295`),
  and the slash/CLI path toasts it (`execute.ts:205,218`). A rejected `pools.set`
  is not presented as success — the "fica zerado" symptom is the un-persisted
  write, surfaced at save time and empty on re-read.

The question: how to make a config-backed save persist reliably — closing the
prefix-fallback hazard at the root — **without** weakening the optimistic-
concurrency (CAS) guard, and **without** any operator payload/command-id/dispatch
change.

## Decision Drivers

- **Correct preflight, not a weakened guard.** The `mutations require version` /
  `CAS version conflict` guard (`mutation.ts:224-242`) is correct-by-design; the
  bug is the preflight reading the WRONG authority. Fix the authority resolution,
  never the guard.
- **One source of truth, no drift.** The static command→authority resolution must
  derive from the domain modules' exported constants that `command-authority.ts`
  already imports — extending the ADR-0017 "sourced from the domains" invariant to
  the fallback, not re-typing a parallel table.
- **Close the hazard at the root.** The fallback must be correct-by-construction so
  a stale/mis-wired port resolves `pools.set → "routing"` even without the full
  resolver.
- **Preserve every invariant.** No operator payload, command id, catalog version,
  dispatch path, or feature flag change; no fabricated CAS token or version;
  lost-update protection intact.
- **Prove the reproduced scenarios.** Regression coverage over the REAL wired
  stack, not a bespoke helper that hand-threads authority.

## Considered Options

- **Option A — Harden the degraded fallback to a correct-by-construction static
  authority resolution sourced from one domain SSOT, keep the CAS guard verbatim,
  and lock the wiring + surfaced-failure invariants with regression proof
  (chosen).** Extract `staticAuthorityForCommandId` from the domain constants in
  `command-authority.ts`; the wired resolver and the fallback both consult it;
  `authorityKeyForCommandId` (and the inline `split(".")[0]` sites) resolve
  `pools.set → "routing"` even with no resolver threaded; scope-dependent/unknown
  ids keep the prefix. Prove the second-`pools.set`, existing-routing-document,
  resolver-absent, and rejected-save scenarios.
- **Option B — Weaken the CAS guard: let a mutation proceed when the version is
  absent even though the authority exists.** Rejected: it drops lost-update
  protection — a save would overwrite a concurrent edit whenever the token was
  missing. The guard is correct; the preflight was wrong.
- **Option C — Auto-resolve the missing token at mutate time (default an absent
  `version` to `current.version`).** Rejected: same lost-update hazard as B by a
  different route — it silently invents optimistic-concurrency agreement the
  client never made, and it masks a wrong-authority preflight instead of fixing
  it.
- **Option D — Fix only the wiring (ensure every port threads the resolver) and
  leave the fallback returning the prefix.** Rejected as insufficient: HEAD is
  already fully wired (Prong B), so this fixes nothing the user is hitting, and it
  leaves the latent hazard — the next port that forgets the resolver silently
  breaks `pools.set` again. (The wiring invariant is still kept, as a regression
  guard, in the chosen option.)
- **Option E — Re-type a command→authority string table inside `config-status.ts`.**
  Rejected: it duplicates the domain SSOT and will drift from the backends'
  exported constants — the exact anti-pattern ADR-0017 avoided by sourcing the
  resolver from the domains.

## Decision Outcome

Chosen option: **Option A**, because it eliminates the reproduced failure at its
root — a correct-by-construction preflight authority — while preserving the CAS
guard verbatim, sourcing the resolution from one domain SSOT, and proving the
exact reproduced scenarios over the real wired stack.

Key decisions recorded:

1. **One-SSOT static authority resolution (FR-A).** A pure
   `staticAuthorityForCommandId(commandId): string | null` is extracted in
   `command-authority.ts`, covering the scope-**independent** authorities sourced
   from the domain constants already imported there
   (`POOLS_AUTHORITY`/`TELEMETRY_AUTHORITY`/`JOBS_AUTHORITY`/`SEMANTIC_AUTHORITY`
   and the `MCP_*`/`OUTPUT_ADMIN` verb sets). `createOperatorAuthorityResolver`
   reuses it for its static cases and keeps ONLY the scope-dependent branches
   (`SMART_AUTHORITY[s]`, `BUDGET_AUTHORITY[s]`, the injected `langlock`/`output`
   lambdas). One source of truth; the resolver and the fallback cannot drift.
2. **The degraded fallback is correct-by-construction (FR-A).**
   `authorityKeyForCommandId` (`config-status.ts:10-13`) becomes
   `staticAuthorityForCommandId(commandId) ?? commandId.split(".")[0]`, so
   `pools.set → "routing"` even with no resolver threaded; the inline preflight
   fallbacks (`http/handler.ts:229`, `http-slash-port.ts:216`,
   `rpc-slash-port.ts:196`, `tui-port.ts:114`) route through the same resolution.
   Scope-dependent authorities (reachable only via the wired resolver in
   production) and unknown/non-mutating ids keep the prefix — no regression.
3. **The CAS / optimistic-concurrency guard is PRESERVED verbatim (FR-C).**
   `mutation.ts:224-242` is untouched: a mutation with an absent version on an
   existing authority is still rejected, and a stale token still returns `CAS
   version conflict`. The correct token now flows because the preflight reads the
   RIGHT authority's real version — the guard never auto-resolves or defaults a
   token. Weakening the guard (Option B) and auto-resolving the token (Option C)
   are explicitly rejected.
4. **The production wiring invariant is guarded, not fixed (FR-B).** Prong B found
   NO production port omits the resolver at HEAD; a regression test asserts every
   production preflight port threads `stack.resolveAuthority` (trusted worker
   fetch, worker-local slash, HTTP mount production+test) so a future port cannot
   silently drop it. FR-A makes the fallback safe even if it were dropped; FR-B
   keeps it from being dropped.
5. **A rejected save is surfaced, never silently zeroed (FR-D, non-regression).**
   The existing in-modal `failureReason` surfacing (`edit-modal.tsx:113-119`,
   `multi-field-modal.tsx:289-295`) and slash/CLI toast (`execute.ts:205,218`) are
   locked against regression: a non-success outcome keeps the form open with a
   typed, secret-free reason and never fires `onSaved`; only a success outcome
   closes the form.
6. **Reproduced-scenario regression proof (FR-E).** Over the real wired stack:
   (a) a second `pools.set` persists; (b) a first `pools.set` on a config already
   holding a routing document persists; (c) with the hardened fallback but the
   resolver absent, `pools.set` preflight resolves `"routing"`; (d) a genuinely
   rejected mutation returns a typed failure the form surfaces in-modal.
7. **No contract change (invariant).** No operator payload, command id, catalog
   version, dispatch path, server/port surface, or feature flag is added or
   altered; this is a preflight-authority correctness change plus regression proof.

### Consequences

- Good: a config-backed save persists reliably on the second write and on a first
  write over an existing routing document; the reproduced "fica zerado" is
  eliminated at its root — the preflight reads the authority the command actually
  commits to.
- Good: the fallback is correct-by-construction for the static-authority commands,
  so a stale binary or a future mis-wired port no longer silently breaks
  `pools.set` (and telemetry/mcp/jobs/semantic) — the latent hazard is closed.
- Good: one domain SSOT for both the wired resolver and the fallback means they
  cannot drift; the ADR-0017 "sourced from the domains" invariant is extended, not
  duplicated.
- Good: zero contract surface and an unchanged CAS guard — no server, SDK, or
  catalog work, and lost-update protection is fully preserved; the audit's
  `beforeVersion`/`afterVersion` now reference the correct document (an integrity
  improvement).
- Bad (documented boundary): the scope-**dependent** authorities
  (`smart`/`budget`/`routing`-global/`output`/`langlock`) remain resolvable
  correctly ONLY through the wired `resolveAuthority`; the scope-free fallback
  cannot resolve them without scope and keeps the prefix. This is acceptable
  because every production port threads the resolver (Prong B, guarded by FR-B),
  and the static subset that reproduced the bug (`pools`) is fully covered.
- Bad (residual): FR-D locks existing behavior rather than adding a new surface —
  if a future refactor of the operator form removes the in-modal `failureReason`
  surfacing, the FR-D guard must catch it; the guard is the safeguard, not a
  structural guarantee.

## Related

- Feature specification: [021 Operator config-backed saves must persist reliably and never silently zero](../sdd/021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md)
- Preflight resolver + degraded fallback origin: [ADR-0017 Close the implementable operator capability gaps](0017-close-the-implementable-operator-capability-gaps-so-the.md) — the fix-round "Superseding decision" introduced `command-authority.ts`, noting "Unknown ids fall back to the prefix (no regression)"; this ADR hardens that fallback for the static-authority commands.
- `pools.set` backend + `PROJECT_AUTHORITY = "routing"`: [Feature 013 Wire the four remaining config-backed operator domains](../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md)
- Authority resolver / preflight seam: [Feature 017 Close the implementable operator capability gaps](../sdd/017-close-the-implementable-operator-capability-gaps-so-the/spec.md)
- Operator TUI in-modal error surface: [Feature 015 Redesign the operator TUI domain screens into true CRUD](../sdd/015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md)
- Operator form dispatch (`executeOperatorCommand`, `pools.set` bindings editor): [Feature 019 Complete the semantic binding lifecycle and the remaining operator residuals](../sdd/019-complete-the-semantic-binding-lifecycle-and-the-remaining/spec.md), [Feature 020 Replace the free-text model id entry in the operator](../sdd/020-replace-the-free-text-model-id-entry-in-the-operator/spec.md)
- Mutation authority / CAS guard: [ADR-0003 Operator control plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Domain schema: [operator-config-backed-saves ValueObject](../schemas/operator-config-backed-saves-must-persist-reliably-and-never.cue)
