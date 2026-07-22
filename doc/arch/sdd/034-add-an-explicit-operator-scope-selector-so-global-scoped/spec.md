---
id: 019f8167-7841-7d80-9a9b-ddc334d47cd1
number: 034
slug: add-an-explicit-operator-scope-selector-so-global-scoped
status: implemented
created_at: 2026-07-20T21:21:09.697408Z
---
# Feature Specification: Add An Explicit Operator Scope Selector So Global-Scoped Config Is Reachable

Feature: 034-add-an-explicit-operator-scope-selector-so-global-scoped
Created: 2026-07-20
Scope: the request-scope RESOLVERS (`resolveOperatorScope` in core; `resolveCliScope` in
the CLI) and the inbound ports (CLI `op`, slash interceptor, TUI port, HTTP slash port)
that feed them. Feature 033 wired `pools.*` — and Feature 024/025 already wired
`routing.configure`/`smart.*`/`budget.*` — so the persistence AUTHORITY follows the request
SCOPE (`global` → `global:routing`, `project` → `routing`), and the catalog grants those
commands the Global+Project (`GP`) scope set. BUT no frontend can actually REQUEST global
scope, so `global:routing` is unreachable in practice: both `resolveOperatorScope` and
`resolveCliScope` PREFER project whenever a `projectId` is bound — and opencode binds a
project to EVERY directory — so the global branch (reached only when `projectId` is null)
never fires. The op CLI has no `--scope`/`--global` flag; the HTTP slash port strips any
payload-smuggled scope; the TUI form's "Global" option is the budget/quota PAYLOAD field,
not the request authority scope. The Feature 033 tests could only reach global by passing
`projectId: null` directly to the port, bypassing the resolver's project-preference. This
feature adds an EXPLICIT request-scope selector that OVERRIDES the ambient-project
preference when the command allows the requested kind, making `global:routing` reachable
from the real CLI/TUI/HTTP frontends. The default (no explicit scope) stays project — full
back-compat. No new command id, no catalog bump, no change to any backend write path, the
routing engine, or the `RoutingConfig` schema.

## Audit result (grounding — every anchor verified 2026-07-20)

- **The resolvers prefer project whenever a project is bound.** `resolveOperatorScope`
  (`packages/core/src/operator/scope-resolve.ts`, the block around lines 84–99) returns
  `{kind:"project"}` as soon as `projectId` is truthy and `project` is allowed; the
  `global` branch (`allowed.includes("global")`) is reached only when `projectId` is null.
  `resolveCliScope` (`packages/opencode/src/operator/adapters/inbound/cli-parse.ts`, the
  preference order near line 162) does the same. So with a bound project — the normal case
  for every directory — global is unreachable.
- **opencode binds a project to every directory.** `ctx.project?.id` in
  `packages/opencode/src/cli/cmd/op.ts` is always set (a probe of `/tmp/x`, `$HOME`, `/`,
  `/var/empty` resolved a PROJECT in every case), so `projectId` is never null on the real
  CLI path and the resolver never falls through to global.
- **No CLI scope flag exists.** The `op` command exposes `--session`/`--project`/
  `--root-tree` ref flags but NO `--scope`/`--global` authority-scope selector, so the CLI
  cannot request the global authority even though `pools.*`/`smart.*`/`budget.*`/
  `routing.configure` carry the `GP` scope set.
- **The HTTP slash port strips client scope (correctly).**
  `packages/opencode/src/operator/adapters/inbound/http-slash-port.ts` deletes
  `record.scope` from the parsed payload — a deliberate security strip of payload-smuggled
  scope that MUST stay. The port must accept an explicit scope as a FIRST-CLASS request
  field instead, never through the payload.
- **The TUI "Global" option is a payload field, not the request scope.** The multi-field
  form (`packages/tui/src/operator/form/field-list.ts`) exposes a `QUOTA_SCOPES` "Global"
  option — the `output.quota.set` budget/quota-scope PAYLOAD value — not the request
  AUTHORITY scope. Selecting it does not change which config document the write lands on.
- **The fail-closed principal binding blocks a global request from a project-bound
  principal.** `authorizeCommand`/`isScopeAllowedForPrincipal`
  (`packages/core/src/operator/capability.ts`, `scope.ts`) reject `global` for a principal
  whose `projectBinding` is non-null. The LOCAL (process-owner) operator principal binds to
  the ambient cwd project, so even a resolver that returned global would be refused at the
  authorization layer — the ambient binding, not an authorization boundary for the local
  operator, must not fail-close an EXPLICIT global request.
- **The backends already honor the resolved scope.** `pools`/`smart`/`budget` read
  `ctx.request.scope.kind` and write `SMART_AUTHORITY[norm(kind)]`, and the wired
  `createOperatorAuthorityResolver` resolves the preflight authority from the same scope. So
  once the request scope RESOLVES to global, the write, the preflight, and the read all
  follow — no backend change is needed; only the resolver/ports must be able to PRODUCE a
  global request.

## Problem

An operator who wants ONE Smart Routing config (role pools + activation + budget + mode) to
govern every project cannot request the global authority from any real frontend: the CLI
has no scope flag, the resolvers prefer project whenever a project is bound (always, per
directory), the HTTP port strips payload scope, and the TUI "Global" option is a payload
field. Feature 033 made `global:routing` a valid WRITE target, but it is unreachable in
practice — the persistence scope follows the request scope, and no request can carry the
global scope. This feature adds an EXPLICIT request-scope selector (`--scope` on the CLI, a
first-class `requestedScope` field on the ports/TUI) that overrides the ambient-project
preference when the command allows the requested kind, so a global-scope request finally
reaches `global:routing`. Absent the selector, behavior is byte-for-byte identical to today.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — An operator can request the global authority explicitly

- As an operator, I want to select the GLOBAL authority scope for a scope-flexible command
  (`--scope global` on the CLI, the request-scope picker in the TUI) even while a project is
  bound to my working directory, so that I can persist a configuration that governs Smart
  Routing in every project — the capability Feature 033 made a valid write target but left
  unreachable.

### P1 — The explicit scope overrides the ambient-project preference

- As an operator, I want an explicit `global` request to WIN over the resolver's
  project-preference (which otherwise always chooses project because a project is bound to
  every directory), so that the global authority is actually selected, not silently
  downgraded to project.

### P1 — The read, preflight, and write authorities all follow the explicit scope

- As a maintainer, I want the explicit scope threaded into the mutation dispatch AND the
  preflight/version read, so the CAS `expectedVersion` read authority matches the write
  authority and a second global-scope Save never fails RED "mutations require version".

### P1 — The default stays project (back-compat)

- As a maintainer, I want a request with NO explicit scope selector to resolve exactly as
  before (project-preferred when a project is bound), so that every existing caller and test
  behaves identically and the change is strictly additive.

### P2 — A forbidden or unknown scope is rejected cleanly

- As an operator, I want an explicit scope the command does NOT allow (or an unknown scope
  string) to be rejected with a typed, bounded operator error envelope, so I get a clear
  reason and exit-code parity with the existing bad-input paths, never a crash or a silent
  wrong-authority write.

### P2 — Payload-smuggled scope stays stripped

- As a maintainer, I want the HTTP slash port to keep stripping `payload.scope` and to
  accept the explicit scope only as a FIRST-CLASS request field, so a client can never
  smuggle an authority scope through the payload.

## Functional Requirements

### Group A — the core resolver honors an explicit requested kind (FR-A)

1. **FR-A — `resolveOperatorScope` accepts an optional explicit `requestedKind` that
   overrides the project preference.** `scope-resolve.ts` MUST accept an optional
   `requestedKind?: ScopeKind` on `OperatorScopeContext`, threaded through
   `resolveOperatorScope`, `resolveScopeForCommandId`, and `resolveScopeForDescriptor`. When
   present: if `requestedKind` is NOT in `scopesAllowed` → `{ok:false, code:"forbidden_scope"}`;
   if allowed, resolve to EXACTLY that kind, OVERRIDING the ambient-project preference —
   `global` → `{kind:"global", ref:null}`; `project` → ref = projectId else the existing
   `project scope required; projectId missing` error; `session` → ref = sessionId else its
   missing error; `root-tree` → ref = rootTreeRef else its missing error. When ABSENT,
   behavior is IDENTICAL to today (project-preferred), proven by the existing resolver tests
   staying green.

### Group B — the CLI exposes an explicit `--scope` selector (FR-B)

2. **FR-B — the `op` CLI adds a validated `--scope` flag threaded into the resolver.**
   `op.ts` MUST add `--scope <global|project|session|root-tree>` and thread it into
   `resolveCliScope`. An explicit `--scope <kind>` MUST force that kind when
   `descriptor.scopesAllowed.includes(kind)` (`global` → ref null), OVERRIDING the
   ambient-project preference; a kind the command does not allow → `{ok:false, reason:...}`;
   an unknown scope string → a clean scope error. The existing
   `--session`/`--project`/`--root-tree` explicit ref flags MUST keep working; an explicit
   `--scope` that CONFLICTS with a different-kind ref flag MUST be rejected (documented
   precedence). The explicit scope MUST thread into BOTH the mutation dispatch AND the
   preflight/version read so the CAS read authority equals the write authority.

### Group C — the TUI selects the request scope first-class (FR-C)

3. **FR-C — the TUI offers a request-scope picker and threads it as `requestedScope`.** The
   TUI MUST offer a request-scope PICKER for scope-flexible commands (those whose
   `scopesAllowed` includes global AND project), limited to the command's `scopesAllowed`,
   defaulting to `project` (back-compat). The chosen kind MUST thread as a first-class
   `requestedScope` into `resolveScopeForCommandId` in the TUI port (both the preflight and
   the dispatch paths) — NEVER into the payload.

### Group D — the HTTP slash port accepts the scope first-class, not via payload (FR-D)

4. **FR-D — the HTTP slash port keeps stripping `payload.scope` and threads an explicit
   first-class scope.** The HTTP slash port MUST keep `delete record.scope` (payload strip)
   and accept the explicit scope as a FIRST-CLASS request field, threaded as `requestedKind`
   into `resolveScopeForCommandId` (both preflight and dispatch). A payload-smuggled scope
   MUST NOT reach the resolver.

### Group E — an explicit global request is authorized for the local operator (FR-E)

5. **FR-E — a global-resolved request is not project-bound for the local operator.** The
   LOCAL (process-owner) operator principal's `projectBinding` is the AMBIENT cwd project,
   not an authorization boundary; when the request resolves to GLOBAL scope the principal
   MUST be built UNBOUND (`projectBinding: null`), so the fail-closed `authorizeCommand`
   admits the explicit global request the operator asked for. A project/session/root-tree
   scope MUST keep the ambient binding, so cross-project safety (the CLI cross-project guard
   and the project-ref match) is unchanged. A server-derived REMOTE principal binds
   server-side and MUST NOT be weakened here.

### Group F — regression proof over the REAL wired dispatcher (FR-F)

6. **FR-F — the explicit scope persists / surfaces through the REAL wired stack.**
   Regression coverage MUST drive the SAME live dispatcher the TUI uses (pools + smart +
   budget + routing over ONE shared `store.config`, production authority resolver threaded)
   with a BOUND `projectId` — the exact scenario the CLI/TUI hit and Feature 033 could not
   reach through the resolver — and prove:
   - (a) an explicit-GLOBAL `pools.set` persists `role_pools` to `global:routing` while a
     project is bound, and the project `routing` document stays absent;
   - (b) a SECOND explicit-global save succeeds (preflight authority == write authority ==
     read authority — CAS bump, no "mutations require version");
   - (c) an explicit-PROJECT `pools.set` still writes the project `routing` authority;
   - (d) the DEFAULT (no explicit scope, project bound) still writes the project `routing`
     authority (back-compat).

## Non-Functional Requirements

- **Resolver-only mechanism, no backend change.** The change touches the request-scope
  resolvers and the inbound ports; no operator backend write path, the routing engine, the
  `RoutingConfig` schema, or the effective read/merge is altered. `pools`/`smart`/`budget`
  already honor the resolved scope (Feature 025/033).
- **Strictly additive default.** With no explicit scope, every resolver returns exactly what
  it returned before; the existing resolver/CLI/dispatcher tests stay green unchanged.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id,
  catalog version, dispatch path, or feature flag is added; the `GP` scope set already
  exists on the scope-flexible commands.
- **Zero provider/model cost.** The resolver and ports are model-independent and
  offline-capable; they make no provider/model calls, consume no tokens, and incur no cost.
- **Honest, bounded rejection.** A forbidden or unknown scope surfaces a typed, bounded,
  secret-free reason with exit-code parity; no failure is swallowed or rendered as success.

## Acceptance Scenarios

Given the operator control plane is enabled and a project is bound to the working directory

- **Explicit global overrides the bound project (FR-A, FR-B, FR-F-a).**
  Given a scope-flexible command and a bound project,
  When the operator requests `global` scope explicitly (`--scope global` / the TUI picker),
  Then the request resolves to the GLOBAL authority, the write lands on `global:routing`,
  and the project `routing` document stays absent.

- **Preflight tracks the explicit scope (FR-B, FR-F-b).**
  Given a fresh store and a bound project,
  When the operator Saves an explicit-global mutation and then a second explicit-global Save
  threading the bumped version,
  Then BOTH commit `success` to `global:routing`, the CAS version bumps, and no Save fails
  "mutations require version".

- **Explicit project still writes the project authority (FR-A, FR-F-c).**
  Given a bound project,
  When the operator requests `project` scope explicitly,
  Then the write lands on the PROJECT `routing` authority with `global:routing` absent.

- **The default stays project (FR-A, FR-F-d).**
  Given a bound project and NO explicit scope selector,
  When the operator Saves,
  Then the request resolves to project exactly as before and the write lands on `routing`.

- **A forbidden scope is rejected (FR-A, FR-B).**
  Given a project-only command,
  When the operator requests `global` scope explicitly,
  Then the resolver returns `forbidden_scope` and nothing is committed.

- **An unknown scope string is rejected (FR-B).**
  Given `--scope planet`,
  When the invocation is parsed,
  Then the CLI returns a clean scope error with exit-code parity, no crash.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes no data itself; it
  selects WHICH Config authority (`routing` vs `global:routing`) a downstream command
  targets. The downstream write is the same `RoutingConfig.Info` document Feature 033
  governs — operator configuration metadata (role names, catalog-resolved model ids,
  activation/budget), never end-user content or secrets. No credential or token is read,
  written, or exposed.
- **Authentication/authorization.** No new authenticated surface or credential. The explicit
  selector does NOT widen authorization: it only lets a request RESOLVE to a scope the
  descriptor already allows (`GP`), and the committed authority still MATCHES the request
  scope the preflight authorizes. For the LOCAL (process-owner) operator, whose ambient
  `projectBinding` is cwd context rather than an authorization boundary, an EXPLICIT global
  request builds an unbound principal so the fail-closed capability check admits the global
  scope the operator asked for — it aligns the binding with the requested scope, it does not
  bypass a boundary. A server-derived REMOTE principal binds server-side and is untouched, so
  a project-restricted remote principal still cannot escalate to global. The CLI
  cross-project guard (a `--project` ref differing from cwd) and the project-ref match are
  preserved.
- **Input validation.** The untrusted input is the explicit scope value (a `--scope` string
  or a `requestedScope` field). It is normalized to the closed `{global, project, session,
  root-tree}` `ScopeKind` set before it selects anything; an unknown value or a kind the
  command forbids is rejected as a typed scope error BEFORE any dispatch — never a crash,
  never a wrong-authority write. A conflicting explicit ref flag is rejected rather than
  silently resolved. The HTTP slash port keeps stripping `payload.scope`, so a client can
  never smuggle the authority scope through the payload.
- **Cryptography in transit/at rest.** Not applicable — this feature introduces no new
  data-in-transit path and no new at-rest requirement; the downstream write persists through
  the existing Config.Service boundary Features 027/030/032 govern, unchanged.
- **Logging/audit.** No new logging. The downstream committed mutation projects through the
  existing Feature 007 EventV2 audit correlation unchanged; the bounded, secret-free operator
  access-audit event already carries the resolved target scope (now the explicitly requested
  one). No scope string beyond the closed kind set, and no payload, is carried into a log
  line.
- **Error-handling information exposure.** A rejected scope surfaces the existing typed,
  bounded reason (`forbidden_scope` with the requested/allowed kinds, or a clean "unknown
  scope kind" message) — never a stack trace, a raw payload fragment, or a resolver-internal
  dump. Exit codes match the existing bad-input paths.

## Observability

This is a request-scope resolution + inbound-port fix with no new backend surface, so it
emits no new metrics, log events, or trace spans. The downstream committed mutation projects
through the existing Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with
content-free, bounded labels (command id, domain, surface, outcome) — unchanged, because the
payload contract and dispatch path are unchanged. The behavioral change is only WHICH scope
(and thus which authority) a request resolves to when the operator selects one explicitly.
Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The explicit request-scope selector reuses the existing scope value objects
(`packages/core/src/operator/scope.ts`) and the routing config domain; no new schema shape
is introduced. The corrected flow:

```
CLI  op … --scope global        TUI  request-scope picker        HTTP  first-class scope field
        |                              |                                |
        +----------------- explicit requestedKind ----------------------+
                                       |
                                       v
resolveOperatorScope(ctx{ …, requestedKind })                              (FR-A)
  requestedKind present:
    requestedKind ∉ scopesAllowed  -> forbidden_scope
    global   -> { global, null }   (OVERRIDES the project preference)      (FR-A/B/C/D)
    project  -> projectId | error
    session  -> sessionId | error
    root-tree-> rootTreeRef | error
  requestedKind absent:
    UNCHANGED project-preferred resolution                                 (back-compat)
        |
        v
local operator principal: global scope => projectBinding = null            (FR-E)
  => authorizeCommand admits the explicit global request
        |
        v
dispatch + preflight both carry the resolved scope
  => pools/smart/budget write & read SMART_AUTHORITY[norm(kind)]           (FR-B/F)
     preflight authority == write authority == read authority (CAS)        (FR-B/F-b)
        |
        v
global request  -> global:routing (governs every project)                 (FR-F-a)
project request -> project routing                                         (FR-F-c)
```

## Out of Scope

- **Changing any operator backend write path, the routing engine, or the `RoutingConfig`
  schema** — `pools`/`smart`/`budget`/`routing.configure` already honor the resolved scope
  (Feature 024/025/033); only the resolvers and inbound ports change.
- **Widening authorization for remote principals** — a server-derived remote principal binds
  server-side and is untouched; only the LOCAL operator's ambient binding aligns with an
  explicit global request.
- **Any operator payload, command id, catalog version, or dispatch path change** — the `GP`
  scope set already exists; only the resolver/port bodies and the CLI flag surface change.
- **Rewriting `resolveEffective` or the document-shadowing read** — unchanged (Feature
  001/024/033); this feature only makes the global WRITE scope reachable, not the read merge.
- **Adding a global selector to single-scope commands** — the picker/flag apply only where
  the catalog already grants the requested kind; a forbidden kind is rejected.

## Related Features and Decisions

- [ADR-0034 — Add an explicit operator scope selector so global-scoped config is reachable](../../adr/0034-add-an-explicit-operator-scope-selector-so-global-scoped.md)
- [Feature 033 — Add a global authority scope for the pools (role_pools) operator config](../033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md) — made `global:routing` a valid pools WRITE target; this feature makes it reachable from real frontends.
- [Feature 025 — Align smart and budget operator config write authority with the request scope](../025-align-smart-and-budget-operator-config-write-authority-with/spec.md) — the request-scope write authority + preflight lockstep the selector feeds.
- [Feature 024 — Implement routing configure persistence so operator routing](../024-implement-routing-configure-persistence-so-operator-routing/spec.md) — the original request-scope persistence + shared-`routing`-document contract.
- [Feature 021 — Operator config-backed saves must persist reliably and never silently zero](../021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md) — the shared-authority CAS-token / preflight invariants the explicit-scope preflight preserves.
- [Feature 032 — Operator config writes must persist only the project owned](../032-operator-config-writes-must-persist-only-the-project-owned/spec.md) — the project-profile vs global write the reachable global scope now targets.

## Clarifications

### Session 2026-07-20

- **An explicit requested kind overrides the project preference (FR-A).** The resolver gains
  an optional `requestedKind` on `OperatorScopeContext`; when present it resolves to exactly
  that kind (if allowed) instead of preferring project, and is validated against
  `scopesAllowed`. Absent, resolution is byte-for-byte unchanged. Recorded in ADR-0034.
- **The CLI adds a validated `--scope` flag with conflict precedence (FR-B).** `op` gains
  `--scope <kind>`; it forces the kind when allowed (global → ref null), overriding the
  project preference; an unknown value or a kind the command forbids is a clean scope error;
  a conflicting explicit ref flag of a different kind is rejected. Recorded in ADR-0034.
- **The TUI/HTTP thread the scope FIRST-CLASS, never via payload (FR-C, FR-D).** The TUI
  offers a request-scope picker for scope-flexible commands and threads the chosen kind as
  `requestedScope`; the HTTP slash port keeps `delete record.scope` and accepts the scope as
  a first-class field. Recorded in ADR-0034.
- **A global-resolved request is unbound for the LOCAL operator (FR-E).** The local
  operator's ambient `projectBinding` is nulled when the request resolves to global, so the
  fail-closed `authorizeCommand` admits the explicit global request; a server-derived remote
  principal is untouched, and non-global scopes keep the ambient binding. Recorded in
  ADR-0034.
- **Alternatives rejected (ADR-0034).** Making global the default when a project is bound
  (breaks back-compat), a `--global` boolean instead of a general `--scope` (does not cover
  session/root-tree and duplicates the ref flags), threading scope through the payload
  (defeats the HTTP strip), and globally relaxing `isScopeAllowedForPrincipal` (would weaken
  remote cross-tenant safety) were all rejected in favor of an explicit `requestedKind`
  override plus a local-operator-only binding alignment for global.
