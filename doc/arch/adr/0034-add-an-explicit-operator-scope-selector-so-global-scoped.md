---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0034 — Add An Explicit Operator Scope Selector So Global-Scoped Config Is Reachable

## Context and Problem Statement

A coherent Smart Routing config lives on ONE routing document persisted under a per-scope
Config authority (`routing` for project scope, `global:routing` for global scope). Feature
024/025/033 made all four writers of that document (`routing.configure`, `smart.*`,
`budget.*`, `pools.*`) follow the REQUEST scope — a global-scope request persists to
`global:routing`, a project-scope request to `routing` — and the catalog grants those
commands the Global+Project (`GP`) scope set. The intent: one global configuration can
govern Smart Routing in every project.

But `global:routing` is UNREACHABLE from any real frontend, because no request can carry the
global scope:

```
// scope-resolve.ts (before) — project preferred whenever a project is bound
if (projectId && allowed.includes("project")) return { kind: "project", ref: projectId }
...
if (allowed.includes("global")) return { kind: "global", ref: null }   // only when projectId is null
```

and opencode binds a project to EVERY directory (`ctx.project?.id` is always set — a probe
of `/tmp/x`, `$HOME`, `/`, `/var/empty` resolved a project in every case), so `projectId` is
never null and the global branch never fires. Compounding it: the `op` CLI has no
`--scope`/`--global` flag (only `--session`/`--project`/`--root-tree` REF flags); the HTTP
slash port deliberately strips `payload.scope`; the TUI form's "Global" option is the
`output.quota.set` budget/quota PAYLOAD value, not the request authority scope; and even if
the resolver returned global, the fail-closed `isScopeAllowedForPrincipal` rejects `global`
for the LOCAL operator whose ambient `projectBinding` is the cwd project. The Feature 033
tests could only reach global by passing `projectId: null` directly to the port, bypassing
the resolver's project-preference — a path no real frontend takes.

The question: how to let an operator EXPLICITLY request the global authority — so a
global-scope Save actually persists to `global:routing` — WITHOUT breaking the project-only
default every existing caller depends on, without a payload-smuggled scope, without weakening
remote cross-tenant safety, and without touching any backend write path, the routing engine,
or the `RoutingConfig` schema.

## Decision Drivers

- **Global must be reachable from real frontends.** An operator with a project bound to every
  directory must be able to select the GLOBAL authority explicitly and have the write land on
  `global:routing` — the capability Feature 033 made a valid write target but left
  unreachable.
- **The explicit scope must OVERRIDE the project preference.** Because a project is always
  bound, the selector has to win over the resolver's default project choice, or it is inert.
- **Preflight/CAS lockstep across scopes.** The explicit scope must thread into BOTH the
  dispatch and the preflight/version read, so the CAS token the client threads matches where
  the write lands and a second global Save never fails "mutations require version".
- **Strictly additive default.** With no explicit scope, resolution must be byte-for-byte
  identical to today; every existing resolver/CLI/dispatcher test must stay green.
- **No payload-smuggled scope.** The HTTP slash port must keep stripping `payload.scope`; the
  explicit scope must be a first-class request field.
- **No authorization widening for remote principals.** The change must not let a
  project-restricted REMOTE principal escalate to global; only the LOCAL operator's ambient
  binding may align with an explicit global request.
- **No backend / schema change.** Only the request-scope resolvers and inbound ports change;
  the backends already honor the resolved scope (Feature 025/033).

## Considered Options

- **Option A — An explicit `requestedKind` override in the core resolver, surfaced as a CLI
  `--scope` flag and a first-class `requestedScope` field on the ports/TUI, plus a
  local-operator binding alignment for global (chosen).** `scope-resolve.ts` gains an optional
  `requestedKind` on `OperatorScopeContext`; when present it resolves to exactly that kind (if
  allowed), overriding the project preference; absent it is unchanged. `op` adds a validated
  `--scope`; the HTTP/TUI ports thread `requestedScope` first-class; and the LOCAL operator
  principal is built UNBOUND when the resolved scope is global so the fail-closed capability
  check admits it. Minimal, additive, and reuses the existing scope value objects and
  authority resolver.
- **Option B — Make global the default when a project is bound.** Rejected: it inverts the
  established project-preferred default, breaking back-compat for every existing caller and
  test, and silently sends project-intended writes to the global authority.
- **Option C — Add a `--global` boolean instead of a general `--scope`.** Rejected: it does
  not cover `session`/`root-tree`, duplicates the existing ref-flag axis, and does not
  generalize to the TUI/HTTP first-class scope field the other frontends need.
- **Option D — Thread the scope through the operator payload.** Rejected: the HTTP slash port
  deliberately strips `payload.scope` (a client must not smuggle authority scope through the
  payload); reversing that is a security regression. The scope must be a first-class request
  field.
- **Option E — Globally relax `isScopeAllowedForPrincipal` to allow global for a
  project-bound principal.** Rejected: it would let a project-restricted REMOTE principal
  escalate to global (a cross-tenant hole). Only the LOCAL operator, whose ambient binding is
  cwd context rather than an authorization boundary, may be treated as unbound for an explicit
  global request.

## Decision Outcome

Chosen option: **Option A**, because an explicit `requestedKind` override — surfaced as a CLI
`--scope` flag and a first-class `requestedScope` field on the TUI/HTTP ports, with the LOCAL
operator principal built unbound for a global-resolved request — makes `global:routing`
reachable with the minimal, additive mechanism: it keeps the project-preferred default
byte-for-byte when no scope is selected, threads the explicit scope into the dispatch and the
preflight in lockstep, keeps the HTTP payload strip intact, leaves every backend write path
and the routing engine/schema untouched, and does not widen authorization for remote
principals.

Key decisions recorded:

1. **An explicit `requestedKind` overrides the project preference (FR-A).**
   `scope-resolve.ts` adds an optional `requestedKind?: ScopeKind` on `OperatorScopeContext`,
   threaded through `resolveOperatorScope`/`resolveScopeForCommandId`/
   `resolveScopeForDescriptor`. When present, `resolveExplicitScope` resolves to EXACTLY that
   kind: `forbidden_scope` when not in `scopesAllowed`; `global` → `{global,null}`; a
   ref-bearing kind → its bound ref, else the existing missing-context error. When absent, the
   resolver falls through to the unchanged project-preferred logic — strictly additive.
2. **The CLI adds a validated `--scope` flag with conflict precedence (FR-B).** `op.ts` adds
   `--scope <global|project|session|root-tree>`; `resolveCliScope`'s `resolveExplicitCliScope`
   validates the kind against the closed `ScopeKind` set, rejects an unknown value and a
   conflicting different-kind ref flag, enforces `scopesAllowed`, and binds the kind's ref
   (`global` → null), OVERRIDING the project preference. `--scope` takes precedence for the
   kind; a same-kind ref flag supplies the ref. The explicit scope flows through
   `parsed.scope` into BOTH the dispatch and the resolved read authority, so the CAS
   `--expected-version` read authority equals the write authority.
3. **The TUI/HTTP thread the scope FIRST-CLASS, never via payload (FR-C, FR-D).**
   `field-list.ts` gains pure metadata (`isScopeFlexibleCommand`, `requestScopePickerOptions`,
   `DEFAULT_REQUEST_SCOPE`) exposing the request-scope options limited to a command's
   `scopesAllowed`; the TUI port types + `executeOperatorCommand` thread `requestedScope` into
   the preflight and dispatch and into `resolveScopeForCommandId` as `requestedKind`. The HTTP
   slash port KEEPS `delete record.scope` and threads the first-class `requestedScope` as
   `requestedKind` in both paths.
4. **A global-resolved request is unbound for the LOCAL operator (FR-E).** `slash.ts` and
   `cli.ts` build the LOCAL operator principal AFTER scope resolution and set
   `projectBinding: null` when the resolved scope is global, so the fail-closed
   `authorizeCommand` admits the explicit global request; project/session/root-tree scopes
   keep the ambient binding (cross-project safety unchanged), and a server-derived REMOTE
   principal is untouched (no cross-tenant escalation).
5. **No backend / schema / catalog / dispatch change (FR-A NFR).** `pools`/`smart`/`budget`/
   `routing.configure` already honor `ctx.request.scope.kind` and the wired authority
   resolver; only the request-scope resolvers, the inbound ports, and the CLI flag surface
   change. No operator payload shape, command id, catalog version, dispatch path, or feature
   flag is added.
6. **Regression test over the REAL wired stack (load-bearing).**
   `packages/opencode/test/operator/feature034-explicit-scope.test.ts` drives the SAME live
   dispatcher the TUI uses (pools + smart + budget + routing over one shared `store.config`,
   production authority resolver threaded) with a BOUND `projectId` — the exact scenario
   Feature 033 could not reach through the resolver — and proves: an explicit-global
   `pools.set` persists to `global:routing` (project `routing` absent); a second explicit-
   global save succeeds under CAS (preflight authority `global:routing`, version bumps); an
   explicit-project save still writes `routing`; and the default (no explicit scope) still
   writes `routing`. Core resolver + CLI unit tests cover the `requestedKind`/`--scope`
   override, forbidden/unknown rejection, and the unchanged default.

### Consequences

- Good: an operator can finally select the GLOBAL authority explicitly and one configuration
  governs Smart Routing in every project — the reachability Feature 033 was missing.
- Good: the explicit scope overrides the always-bound project preference, so global is
  actually selected rather than silently downgraded.
- Good: the preflight and committed authority stay in lockstep across scopes, so a second
  global Save never fails the RED "mutations require version" — the same class Feature 024/025
  fixed, now closed for the explicit-scope path.
- Good: strictly additive — with no scope selector every resolver returns exactly what it
  returned before; the existing resolver/CLI/dispatcher tests stay green unchanged.
- Good: the HTTP payload strip stays intact and remote principals keep their binding, so no
  scope can be smuggled through the payload and no remote principal can escalate to global.
- Neutral: the LOCAL operator principal's binding now depends on the resolved scope (unbound
  for global), converging the CLI and slash principal construction on one rule.
- Residual (accepted): the TUI request-scope picker is exposed as pure metadata + threaded
  port plumbing; wiring it into a specific domain screen's render is left to the composing UI
  (the mechanism, types, and default are in place and unit-tested). This is a presentation
  detail, not a behavioral gap — the CLI/HTTP/core paths are fully wired and tested.

## Related

- Feature specification: [034 Add an explicit operator scope selector so global-scoped config is reachable](../sdd/034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md)
- The pools global WRITE target this makes reachable: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
- The request-scope write authority + preflight lockstep the selector feeds: [025 Align smart and budget operator config write authority with the request scope](../sdd/025-align-smart-and-budget-operator-config-write-authority-with/spec.md)
- The original request-scope persistence + shared-`routing`-document contract: [024 Implement routing configure persistence so operator routing](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- The shared-authority CAS-token / preflight invariants preserved: [021 Operator config-backed saves must persist reliably and never silently zero](../sdd/021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md)
- The project-profile vs global write the reachable global scope targets: [032 Operator config writes must persist only the project owned](../sdd/032-operator-config-writes-must-persist-only-the-project-owned/spec.md)
