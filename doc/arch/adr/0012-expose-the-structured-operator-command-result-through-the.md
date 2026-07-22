---
status: accepted
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0012 — Expose the Structured Operator Command Result Through the TUI

## Context and Problem Statement

Feature 007 already produces a typed structured operator result. The
`CommandResult` envelope (`packages/core/src/operator/envelope.ts:54-65`,
`kind operator.admin_result`) carries an optional `effective` field, and
`successResult` places the domain's typed payload — the same
`@opencode-ai/protocol` shapes the TUI read panels consume — into it. The slash
interceptor already returns both halves:
`{ result: CommandResult; display: OperatorSlashDisplay }`
(`packages/opencode/src/operator/adapters/inbound/slash.ts:51-52`).

The structured half is dropped at a single seam. The inbound TUI adapter
`packages/opencode/src/operator/adapters/inbound/tui-port.ts:114-135` builds its
outbound object from the display fields plus `currentVersion` only;
`result.result.effective` is never forwarded. Everything downstream is therefore
display-only: `OperatorSlashHandled`
(`packages/tui/src/context/operator-slash.tsx:22-28`) carries no `effective`;
`executeOperatorCommand` returns a display-derived `outcome` string; the five
built read panels (jobs, langlock, output, semantic, mcp) fall back to their
`EMPTY_*_SIGNAL` baseline because Feature 011 could reach no structured signal
(Feature 011 plan T013 evidence); and the entity pickers for
`jobs.enable`/`disable`/`delete`/`run-now`, `process.cancel`, and `task.cancel`
open with `NO_OPTIONS` (`packages/tui/src/operator/form/descriptor.ts:80-85`).

Separately, Feature 011 navigation used `ctx.replace` plus a manual back
affordance because the Dialog API (`packages/tui/src/ui/dialog.tsx`) exposes only
`clear`/`replace`/`stack`/`size`/`setSize`; `replace` resets the stack to a single
element even though the internal stack already pops one level on `escape`
(lines 118/132). There is no real Home → domain → panel back stack.

Three forces are in tension:

- **Reuse over rework.** The typed payload and the panel signal types already
  exist and already match; the only gap is transport across one adapter boundary.
- **Honesty.** Only `langlock` reads and `jobs.list`/`jobs.status` return an
  `effective` payload today; `output`/`semantic`/`mcp` reads are unavailable until
  a later backend feature. Any wiring must never fake data for an unavailable read.
- **Parity.** Feature 007's invariant (palette == slash == CLI, same id / version
  / audit) is non-negotiable; the fix must not create a second dispatch path.

## Decision Drivers

- One command authority: the structured result must ride the SAME
  `OperatorSlashPort.tryHandle` return on the SAME `OperatorClient` loopback as
  slash/CLI — no parallel registry, divergent name, or new route.
- Reuse the existing typed `CommandResult.effective` and the existing
  `*PanelSignal` types; add only the transport and the projection between them.
- Honest availability: panels and pickers light up only when a typed `effective`
  payload is present today; everything else degrades to the honest empty signal.
- Defensive projection: an unknown/malformed `effective` payload must never crash
  a panel; it degrades to empty.
- Minimal navigation change: add the ~5-line Dialog `push` primitive rather than a
  new navigation framework.
- No backend behavior change: only the inbound adapter `tui-port.ts` is touched
  under `packages/opencode/src/operator/**`.

## Considered Options

- **Forward the existing typed `effective` through the inbound adapter, project it
  per domain into the existing panel signals and picker options, and add a Dialog
  `push` primitive** — a consumption-only change over the unchanged Feature 007
  dispatch.
- **Add a separate structured-result query port for the TUI** — a second read path
  parallel to `tryHandle`; diverges from the parity invariant and duplicates
  transport for data the existing return already carries; rejected.
- **Have each panel call the domain read directly** — would bypass the operator
  dispatch, auth, and audit path and create a parallel registry; violates the
  parity invariant; rejected.
- **Synthesize placeholder rows when a read is unavailable** — would imply data
  that was never fetched; violates the honesty driver; rejected.

## Decision Outcome

Chosen option: **Forward the existing structured result through the inbound
adapter and project it into the existing panels, pickers, and a real Dialog back
stack, layered over the unchanged Feature 007 dispatch.**

- **Forward at the seam.** `TuiOperatorSlashPort.tryHandle`
  (`tui-port.ts`) forwards the typed `outcome`, the optional `effective` payload,
  and the `version` from `result.result` alongside the existing `display` and
  `currentVersion`. This widens the SAME return object; no new method or route.
- **Thread through the TUI.** `OperatorSlashHandled` gains an optional structured
  result (typed `outcome`, optional `effective`, `version`) kept separate from the
  human `display`; `executeOperatorCommand` returns it to callers. Absence of
  `effective` is representable and is not an error.
- **Project per domain.** A pure projection function per read domain (`jobs`,
  `langlock`, `output`, `semantic`, `mcp`) maps `effective` to that domain's
  `*PanelSignal`, validating the shape and returning the honest `EMPTY_*_SIGNAL` on
  any mismatch or absence. A projection outcome is exactly `projected`,
  `empty_fallback`, or `shape_mismatch`.
- **Feed panels and pickers.** `DialogOperatorReadPanel` feeds the projected signal
  to its panel; the entity-picker loaders issue the corresponding read query
  (`jobs.list`, `process.tree`, `task.tree`) through the same dispatch path and
  project the `effective` payload into picker options keyed by the entity id.
- **Honest availability.** `langlock` reads and `jobs.list`/`jobs.status` populate;
  `output`/`semantic`/`mcp` reads and any unavailable/missing-`effective` result
  degrade to the honest empty signal. No fabricated data, ever.
- **Dialog `push`.** `packages/tui/src/ui/dialog.tsx` gains a `push(input, onClose?)`
  primitive that appends a level; operator navigation adopts it so `escape` pops
  exactly one level (Home → domain → panel/form).
- **Parity preserved.** No new dispatch path, registry, divergent command name, or
  flag; command IDs are unchanged; only `tui-port.ts` is touched under the operator
  backend.

The projection model is specified as ValueObjects in
`doc/arch/schemas/operator-result-signal/` and as a statechart in
`doc/arch/statecharts/operator-result-projection.md`.

### Consequences

#### Positive

- The five built read panels finally render live effective state, with an honest
  empty fallback that is now a real availability signal rather than a permanent
  default.
- Entity pickers populate from real read queries, making the `jobs`/`process`/
  `task` Configure verbs usable.
- Navigation gains a real back stack from a ~5-line primitive, retiring Feature
  011's manual back affordance.
- The Feature 007 parity invariant is untouched: no new dispatch path, registry,
  or divergent command name; one adapter file changes on the backend side.

#### Trade-offs

- The TUI projections stay coupled to the domains' `effective` payload shapes;
  a protocol change to a panel signal type must keep the projection honest.
- Honest-unavailable domains (`output`, `semantic`, `mcp` reads) still show empty
  panels until a later backend feature lands their backends; the affordance makes this
  explicit rather than hiding the panel.
- Defensive shape validation adds a small per-render cost, accepted to guarantee a
  panel never crashes on a malformed payload.

#### Follow-ups

- Feature 012 `plan`/`tasks` implement the forward seam, the context/dispatch
  threading, the five projections, the picker loaders, the Dialog `push` primitive
  and its adoption, and the tests (projection, honest-fallback, parity).
- Landing the `output`/`semantic`/`mcp` read backends and the `jobs` mutation
  backends is separate domain work (a later backend feature).

## Related

- Feature specification: [012 Expose the Structured Operator Command Result](../sdd/012-expose-the-structured-operator-command-result-through-the/spec.md)
- Navigation feature: [011 Restructure Operator TUI](../sdd/011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Projection schema: [operator-result-signal ValueObjects](../schemas/operator-result-signal/projection.cue)
- Projection statechart: [operator-result-projection](../statecharts/operator-result-projection.md)
- Related ADR: [0011 — Grouped operator TUI navigation](0011-restructure-the-operator-control-plane-tui-from-a-flat.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)

## Links

- Related: ADR-0011, ADR-0015, ADR-0017.
