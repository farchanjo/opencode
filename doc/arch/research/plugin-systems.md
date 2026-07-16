# Plugin systems research note

**Status:** confirmed evidence; not an approved architectural decision

This stable technical note records the confirmed research available on the
plugin systems. It is deliberately not an ADR, feature specification, or
implementation plan. At the time of this research, it did not authorize Smart
Routing or any replacement of the current task lifecycle. Feature 001 later
records the user's approved decision that Smart Agent Routing is implemented in
core; this note remains evidence about plugin capabilities, not the rationale,
consequences, or V1/V2 seams of that decision.

## Scope and evidence

OpenCode has two plugin systems:

- **V1 public/documented:** the public JavaScript/TypeScript plugin contract
  and documented hooks in [`packages/web/src/content/docs/plugins.mdx`](../../../packages/web/src/content/docs/plugins.mdx).
- **V2 internal/experimental:** the Effect and Promise plugin contracts in
  [`packages/plugin/src/v2/effect/plugin.ts`](../../../packages/plugin/src/v2/effect/plugin.ts)
  and [`packages/plugin/src/v2/promise/plugin.ts`](../../../packages/plugin/src/v2/promise/plugin.ts),
  with runtime lifecycle and internal loading in
  [`packages/core/src/plugin.ts`](../../../packages/core/src/plugin.ts) and
  [`packages/core/src/plugin/internal.ts`](../../../packages/core/src/plugin/internal.ts).

The confirmed observations are:

1. V1 discovers and loads plugins globally and per project. The documented
   order covers global and project configuration plus global and project plugin
   directories; configured npm packages are also supported.
2. Relevant V1 hooks include `tool.execute.before` and
   `tool.execute.after`. `tool.execute.before` can mutate the hook output,
   including `output.args`, and the confirmed hook path permits changing
   `subagent_type`.
3. A plugin can retain metrics and health-check state in its own runtime
   state. This is an observed capability, not a commitment to a metrics API.
4. Public plugin surfaces do **not** expose dynamic model selection,
   transactional fallback, or the complete Task lifecycle.
5. Overriding `task` is partial: internal flows can call
   `ToolRegistry.named().task`, so an override of the public task path does not
   cover every execution path; the registry boundary is maintained in
   [`packages/core/src/tool/registry.ts`](../../../packages/core/src/tool/registry.ts).
6. `smart_task` is a possible prototype seam, but it loses native Task
   semantics and therefore is not equivalent to the native lifecycle.
7. At the time of this note, the recommended alternative under evaluation was a
   minimal core seam with policy in a plugin. That wording describes the then-current
   research direction only; Feature 001 supersedes it for Smart Agent Routing by
   recording the approved core constraint. The feature's rationale, consequences,
   and V1/V2 seams still require an ADR before planning or implementation.

## Summary matrix

| Capability | V1 public/documented | V2 internal/experimental | Confirmed limitation |
| --- | --- | --- | --- |
| Global/project discovery | Documented | Runtime-supported loading | Scope and ordering must remain explicit |
| Tool hooks | `tool.execute.before/after` | Internal registration/lifecycle hooks | Hook visibility is not full orchestration control |
| Change `subagent_type` | Available through `tool.execute.before` | Internal paths may differ | Does not expose dynamic model policy |
| Metrics/health checks | Plugin-owned state is possible | Plugin-owned state is possible | No public standardized contract confirmed |
| Dynamic model selection | Not publicly exposed | Not a stable public contract | Requires an explicit core seam or equivalent |
| Transactional fallback | Not publicly exposed | Not a stable public contract | Plugin-only interception cannot guarantee it |
| Complete Task lifecycle | Not publicly exposed | Internal lifecycle is not a public contract | Partial task override is insufficient |
| `task` override | Partial | Partial where internal named lookup bypasses it | `ToolRegistry.named().task` remains a bypass |

## Alternatives under consideration

These were options studied during research, not decisions recorded by this note:

1. **Plugin-only:** use existing hooks and plugin-owned policy. Lowest core
   change, but cannot guarantee dynamic model selection, transactional
   fallback, or complete Task lifecycle coverage.
2. **`smart_task`:** prototype a higher-level task tool. It may be easy to
   experiment with, but it loses native Task semantics and must not be treated
   as a transparent replacement.
3. **Minimal core + plugin:** expose the smallest explicit core seam needed
   for policy, while keeping selection and policy in a plugin. This is the
   recommended direction under evaluation at the time, not an approved architecture.

## Open questions

- Which core seam can expose policy without leaking the complete Task lifecycle?
- What transaction boundary and fallback guarantees are required?
- How should global and project plugin policy be isolated and composed?
- What metrics and health-check contract, if any, should be standardized?
- How can every internal `task` lookup be covered or deliberately documented?
- Which native Task semantics must remain invariant across any experiment?
- What validation and hook checks are required before an implementation is
  authorized?

## Governance boundary

This note is evidence for clarification and planning. Do not implement Smart
Routing, `smart_task`, or a core seam from this note alone. Feature 001 is the
later artifact that authorizes the core placement constraint; its rationale,
consequences, and V1/V2 seams require the ADR specified there before plan or
implementation. Any implementation must also follow the active Spec Kit
workflow on `fcustom`, with scope, acceptance criteria, and validation recorded
in the appropriate artifacts.
