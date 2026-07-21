---
status: accepted
date: 2026-07-21
deciders: [opencode-operator]
consulted: []
informed: []
---

# Expose The Hierarchy Capability And Budget Operator Config

## Context and Problem Statement

`RoutingConfig.Enforcement` carries three operator-tunable policy blocks —
`budget`, `hierarchy`, and `capability`. Only five of the budget block's leaves
(`max_turns`, `max_context_tokens`, `max_output_tokens`, `max_workers`,
`token_budget`) are reachable from the operator surface, through the existing
`budget.show`/`budget.set` verbs (Feature 013). The remaining budget leaves and
the entire `hierarchy` and `capability` blocks can only be changed by hand-editing
config JSON — there is no `op` command and no TUI field for them.

We must expose EVERY budget/hierarchy/capability enforcement leaf for read AND
write, through BOTH the `op` CLI and the operator TUI, without regressing the
existing budget/pools/smart output shapes, the F030 layered read, or the
F032/F034/F035 scope-authority rules. A standing product requirement is that the
TUI has the SAME experience as the CLI — same leaves, same validation, same
effective-config read.

## Decision Drivers

- Completeness: every enforcement leaf viewable and editable from both surfaces.
- Parity: the CLI and TUI must not drift — same leaf set, same validation.
- Backward compatibility: `budget.show`/`pools.show`/`smart.status` shapes extend,
  never break; the layered read and scope-authority composition are unchanged.
- Persist only what the operator set (the F035 lesson) — no wholesale snapshot.
- No secret/credential exposure; validate untrusted values at the write boundary.

## Considered Options

- **Option A — a single shared leaf registry driving both surfaces, exposed as new
  `hierarchy`/`capability` domains plus a `budget.configure` verb.** One
  `@opencode-ai/protocol/enforcement/leaves` module names every leaf (key, path,
  label, typed constraint). The opencode backend validates + applies writes
  through it; the TUI generates its edit fields from it. New `hierarchy.*` /
  `capability.*` catalog domains and a `budget.configure` verb reuse the existing
  routing Config.Service authority, CAS pipeline, and dispatcher.
- **Option B — extend the existing `budget.set` payload to the full leaf set and
  add ad-hoc TUI fields per leaf.** Two hand-maintained leaf lists (backend +
  TUI) that must be kept in lockstep by discipline alone; changes `budget.set`
  semantics (currently a complete 5-leaf view) and risks the existing tests.
- **Option C — a generic `enforcement.set <path> <value>` command.** Minimal code
  but a poor operator UX (free-form paths, no per-leaf labels/validation surface)
  and no natural TUI form.

## Decision Outcome

Chosen option: **Option A**, because a single shared registry is the only design
that makes op↔TUI parity a structural guarantee (both surfaces consume the same
source, enforced by a parity test) rather than a maintenance promise, while
keeping every write on the existing routing document through the unchanged CAS +
authority-resolution pipeline.

Concretely:

- **Shared registry** (`packages/protocol/src/enforcement/leaves.ts`): every
  budget/hierarchy/capability leaf with its operator key, config path, label, and
  typed constraint (numeric bounds, enum members, boolean), plus pure
  validate/read/set helpers.
- **op surface**: new catalog domains `hierarchy` (`status`/`show`/`set`) and
  `capability` (`status`/`show`/`set`), and a `budget.configure` verb for partial
  writes of any budget leaf. A generic enforcement-leaf backend projects the
  effective leaves for `show`, and `set`/`configure` validate + return an
  `OperatorMutationPlan` that applies ONLY the set leaves onto the fresh on-disk
  config at commit time. `budget.show` is enriched (best-effort, additive) with a
  full `leaves` map. Catalog bumps `1.3.0 → 1.4.0` (additive).
- **TUI surface**: the multi-field form descriptors for `hierarchy.set`,
  `capability.set`, and `budget.configure` are GENERATED from the shared registry
  — numeric/enum/boolean fields prefilled from the effective read's `leaves` map,
  re-read on scope switch, persisted through the same CAS authority (Feature 040
  pattern).
- **Scope-authority composition**: `hierarchy`/`capability` resolve to the same
  per-scope routing authority (`routing` / `global:routing`) as `smart`/`budget`
  via the request scope (F033/F034/F035), so a project write never persists a
  global authority and global requires explicit `--scope global`.

### Budget hard-ceiling parity (FR4)

`budget.set` enforces a tighten-only hard ceiling on five limits
(`max_turns`/`max_context_tokens`/`max_output_tokens`/`max_workers`/`token_budget`)
via `validateLimits`, sourced from `DEFAULT_ROUTING_BUDGET`. `budget.configure`
MUST enforce the SAME ceiling so the two write surfaces cannot disagree. Because
the shared registry lives in `@opencode-ai/protocol` (which cannot import the
opencode-side `DEFAULT_ROUTING_BUDGET`), the ceiling is enforced in the opencode
enforcement backend (`enforcement/leaf-backend.ts`), reading its five ceiling
values directly from the ONE `DEFAULT_ROUTING_BUDGET` constant `validateLimits`
uses — no second hardcoded copy. The other twelve leaves keep their min-only
registry bounds. An over-ceiling `budget.configure` value is rejected
`invalid_argument` before any plan is produced, exactly as `budget.set` rejects it.

### Known residual — full-config snapshot on first write to an unconfigured scope

`planConfigure`'s create-if-absent fallback (`leaf-backend.ts`) snapshots the full
effective config into a new project document on the FIRST write to an unconfigured
scope. This is DELIBERATELY consistent with the shipped `budget`/`smart`/`pools`
`planWrite` pattern (`budget/backend-live.ts`), and scope-authority is intact — it
targets the project authority (`routing`), never `global:*`, so there is no F035
global leak. Changing only the two new domains would make them inconsistent with
the shipped features; a future feature could switch ALL enforcement-backed domains
to persist-only-set-on-fresh together. Recorded here as a known, consistent-with-
shipped residual.

### Consequences

- Good: op↔TUI parity is structurally enforced; every leaf is reachable; writes
  stay on one routing document with the existing CAS/audit/authority pipeline; no
  existing output shape breaks; validation rejects bad values at the boundary; the
  budget hard ceiling is enforced identically on both `budget.set` and
  `budget.configure` from one shared constant.
- Good: adding a future enforcement leaf is a one-line registry edit that flows to
  both surfaces automatically.
- Bad: two new catalog domains + a version bump require updating the pinned
  catalog/domain-count assertions (done); the `DomainPorts` closed set and the
  domain-stub map gain two members that must stay in lockstep.
- Neutral: `budget.set` (the legacy 5-leaf view) is retained alongside
  `budget.configure`; the two coexist on the same document.
