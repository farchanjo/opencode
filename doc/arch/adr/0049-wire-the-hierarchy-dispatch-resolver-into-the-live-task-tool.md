---
status: accepted
date: 2026-07-21
deciders: [your-org]
consulted: []
informed: []
---

# Wire The Hierarchy Dispatch Resolver Into The Live Task Tool

## Context and Problem Statement

Feature 042 (Architect -> Manager -> Worker hierarchy delegation) and Feature 048
(`force_manager` orchestration mode) resolve a per-spawn hierarchy decision via
`resolveHierarchyDispatch` and act on it in `TaskTool.execute` through a
`ctx.extra.hierarchyDispatch` payload. But only ONE of the two subagent spawn
paths produced that payload:

- `handleSubtask` (`session/prompt.ts`, the mention/slash path) called the
  resolver and injected `hierarchyDispatch`.
- `SessionTools.resolve` -> `TaskTool.execute` (the path a real LLM delegation
  and @mention take) built `ctx.extra` as `{ model, bypassAgentCheck, promptOps
  }`, with NO hierarchy wiring. Every F042/F048 branch was therefore inert on the
  hot path, and the child inherited the parent model.

The architectural constraint is that `SessionTools.resolve` builds the tool set
ONCE per turn, while a hierarchy decision is PER-SPAWN — it depends on the
specific `task.prompt`, and the LLM may emit several `task` calls with different
prompts in one turn. So resolution cannot happen at tool-build time.

A secondary defect: the command-subtask path stamped `SubtaskPart.model`
unconditionally (with the parent model for an unpinned command), which made
`shouldConsultHierarchy` return false and suppressed routing on the mention path
too.

## Decision Drivers

- Resolution must be per `TaskTool.execute` invocation (per-spawn prompt), not at
  tool-build time.
- The default (routing-off / heuristic-no-fanout) path must stay byte-identical.
- No second, divergent resolver — reuse the F042 engine, guard, seeding, and
  route->dispatch mapping.
- Hang/crash-safe: a resolver defect degrades to the ungated parent-inheritance
  spawn.

## Considered Options

- **Option A — Inject a per-invocation resolver closure into `ctx.extra`.**
  Compute the per-turn seeds (parent role, parent depth, main-context model)
  once at the `SessionTools.resolve` call site, build a closure via a shared
  `createLiveHierarchyResolve` factory, and inject it. `TaskTool.execute` calls
  it with the actual spawn prompt, then applies the routed model and the
  `hierarchyDispatch` payload.
- **Option B — Resolve at tool-build time in `SessionTools.resolve`.** Rejected:
  the tool set is built once per turn but the decision is per-spawn; a single
  build-time decision cannot serve multiple `task` calls with different prompts.
- **Option C — Duplicate the mention-path resolution logic inline in
  `TaskTool.execute`.** Rejected: a second divergent resolver would drift from
  `handleSubtask` and re-implement the route->dispatch mapping.

## Decision Outcome

Chosen option: "Option A — inject a per-invocation resolver closure into
`ctx.extra`", because it is the only option that resolves per-spawn while reusing
the single F042 engine end to end.

Concretely:

- A shared `createLiveHierarchyResolve(deps)` factory (in `routing-hierarchy.ts`)
  seeds the per-turn parent role/depth + main-context model, applies the
  `shouldConsultHierarchy` guard (an agent-pinned model short-circuits), calls the
  SAME `resolveHierarchyDispatch` engine, and reshapes the decision into a
  `{ route | blocked | degraded }` contract.
- A shared `toHierarchyDispatchExtra(routed, store)` helper builds the F042/F048
  `hierarchyDispatch` payload ONE way; both `handleSubtask` and the live seam use
  it (the previously inlined object in `handleSubtask` is replaced).
- `session/tools.ts` places the injected closure into every tool call's
  `ctx.extra.hierarchyResolve`.
- `TaskTool.execute` consumes it: when no precomputed `hierarchyDispatch` is
  present and a closure is injected, it resolves with THIS spawn's prompt,
  surfaces `blocked` as a failed spawn, warns on `degraded`, and on `route`
  applies the model (`next.model ?? routed ?? parent`) and the dispatch payload.
  The agent is resolved early only on this path (its pinned model must win); the
  default path is unchanged.
- The command-subtask path stamps `SubtaskPart.model` only when the model is
  genuinely pinned (`cmd.model` / agent model / explicit `--model`); an unpinned
  command leaves it unset so the resolver is consulted.

### Consequences

- Good: a live LLM / @mention `task` spawn now honors F042/F048 (force-manager
  routing, `orchestration_only` tool-gating, depth reconciliation, Manager
  persona, completion gate) — the feature works on the real hot path.
- Good: one engine, one guard, one route->dispatch mapping across both spawn
  paths; no divergence.
- Bad: the resolver (a cheap, TTL-cached, timeout-bounded, defect-tolerant call)
  now runs on every live `task` invocation even when routing is off. It returns
  undefined on the off/no-route path, so behavior is byte-identical, but there is
  a small constant per-spawn cost. Mitigated by the existing hang/crash-safety
  wrap and bounded per-spawn LRU.

## Links

- Related: ADR-0042, ADR-0043, ADR-0044, ADR-0053.
