# Implementation Plan: Add A Global Authority Scope For The Pools (role_pools) Operator Config

## Overview

Widen the persistence scope of the `pools.*` (role_pools) operator commands so a
global-scope `pools.set`/`pools.reset` persists to the `global:routing` authority while a
project-scope write keeps targeting the per-project `routing` authority. This lets ONE
global Smart Routing config govern every project, mirroring the request-scope derivation
`smart.*`/`budget.*`/`routing.configure` already use on the shared routing document
(Feature 024/025). The routing engine, the `RoutingConfig` schema, the effective read/merge
precedence, and the single-committed-CAS-write contract are all preserved; only the write
authority and the preflight resolution for pools change.

## Technical Approach

Layers affected (all inside `packages/opencode/src/operator`, plus the shared
`command-authority`):

- **Authority resolution (`application/command-authority.ts`).** Make the wired
  `createOperatorAuthorityResolver` resolve `pools.*` scope-dependently
  (`SMART_AUTHORITY[norm(scopeKind)]` → `global:routing` / `routing`) instead of
  short-circuiting on the static project value. `staticAuthorityForCommandId` keeps pools'
  PROJECT-default entry so the degraded `authorityKeyForCommandId` fallback still resolves
  `pools.set → "routing"` (Feature 021). (FR-A, FR-B)
- **Pools backend (`pools/backend-live.ts`).** Add a per-scope `AUTHORITY` map (mirroring
  `SmartBackendLive.AUTHORITY`) and a `scopeForRequest(kind)` helper (default `project`).
  Replace `readProject` with `readScoped(scope)`, thread the scope through
  `planWrite`/`planSet`/`planReset`, and harden `apply` to merge `models.role_pools` into
  the FRESH `current` payload rather than returning a plan-time snapshot. Keep
  `PROJECT_AUTHORITY` exported (as the project entry) for the degraded fallback. (FR-A, FR-C)
- **Pools ports (`pools/pools-port.ts`, `pools/pools-command-port.ts`).** Add an optional
  `requestScopeKind` parameter to the `PoolsBackend` methods (default `project`), and thread
  `ctx.request.scope.kind` from the command port into
  `resolve`/`validate`/`planSet`/`planReset`, exactly as `smart-command-port.ts` does. (FR-A)
- **CLI + TUI (no code change).** The catalog already grants `pools.*` the `GP` scope set and
  `resolveCliScope`/`resolveScopeForCommandId` already resolve pools scope from the ambient
  `projectId`/`--project`, so the scope affordance is already shared with
  `routing.configure`. This plan makes the backend HONOR the resolved scope; the CLI/TUI need
  no change. (FR-F)
- **Read/merge (no change).** `config-adapter.resolveEffective` keeps document-shadowing
  (project doc > global doc > default), giving project-over-global precedence and letting a
  global config govern projects without their own document. (FR-D)

Testing: a new `test/operator/feature033-pools-global-scope.test.ts` drives the REAL wired
dispatcher (pools + smart + budget + routing over one shared `store.config`, production
authority resolver threaded) — the same harness as `feature025-smart-budget-scope.test.ts`
— proving global persistence, project back-compat, global-governs-project, project-shadows-
global precedence, and preflight/CAS lockstep across two global saves (FR-G).

## Companion Artifacts

No companion files are required for this feature: it introduces no new entity, interface
contract, or external integration — it reuses the existing routing config domain, the
`pools/*` protocol commands, and the `OperatorMutationPlan` write path. The optional
`research.md` / `data-model.md` / `contracts/` / `quickstart.md` are intentionally omitted
(the Domain Model section in `spec.md` carries the flow diagram).
