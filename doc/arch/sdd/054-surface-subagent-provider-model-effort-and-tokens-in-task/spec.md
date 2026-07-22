---
id: 019f8750-bef8-7062-986d-a58374f05f72
number: 054
slug: surface-subagent-provider-model-effort-and-tokens-in-task
status: analyzed
created_at: 2026-07-22T00:54:03.768339Z
---
# Feature Specification: Surface Subagent Provider Model Effort And Tokens In Task

Feature: 054-surface-subagent-provider-model-effort-and-tokens-in-task
Created: 2026-07-22

## User Stories

- As a user watching the TUI, I want each completed subagent task line to show
  the provider, model, reasoning effort, and token usage of the child session,
  so that I can see at a glance which executor ran the delegated work and what
  it cost — without opening the child session or an external telemetry backend.

## Context

The completed task line today renders `✓ <Agent> Task — <description>` +
`↳ N toolcalls · <duration>` (`packages/tui/src/routes/session/index.tsx`,
`formatCompletedSubagentDetail`). The TUI reads everything it shows from the
task tool part's `state.metadata`, which the task tool already stamps with
`model: { providerID, modelID }` at spawn (`tool/task.ts`). The child session
row already accumulates authoritative token counters (`tokens.input/output/
reasoning/cache`). Reasoning effort is resolved from the effective config's
provider model options at spawn time. Telemetry is intentionally NOT the
source: the OTel export is redacted and outbound-only; the in-process session
store is authoritative and already local.

## Functional Requirements

1. **FR1 — completion metadata.** On FOREGROUND task completion (and on the
   timeout/error paths where a child session exists), the task tool stamps the
   returned metadata with the child's final token usage read from the child
   session record: `tokens: { input, output, reasoning, cache: { read, write } }`.
   A session read failure degrades to the current metadata unchanged — never a
   failed task return.
2. **FR2 — effort resolution.** At spawn, the task tool resolves the effective
   reasoning effort for the routed `{providerID, modelID}` from the merged
   config (`provider.<id>.models.<id>.options.reasoningEffort`, falling back to
   `provider.<id>.options.reasoningEffort`) and stamps it as
   `effort: <string>` in the SAME metadata envelope. Absent config → the key is
   omitted (never a fabricated value).
3. **FR3 — TUI rendering.** The completed subagent detail line appends the
   provider/model, effort, and token summary when present in part metadata:
   `↳ N toolcalls · 21.1s · openai/gpt-5.6-terra-fast (xhigh) · 10.2k in/1.3k out`.
   Missing fields degrade individually (model without effort renders without
   the parenthesis; no tokens renders no token segment) — the current line is
   the floor and remains byte-identical when none of the new keys are present.
4. **FR4 — no telemetry dependency.** The rendering path performs no network
   or OTel-backend reads; every displayed value originates from the in-process
   task metadata envelope.

## Security Requirements

- **Data sensitivity/classification.** Reads model coordinates, a config-derived
  effort label, and numeric token counters — operational metadata, no prompt or
  file content. Rendered only in the local TUI.
- **Authentication/authorization.** Not applicable — no new surface; the data
  flows over the existing task-part metadata channel already visible to the TUI.
- **Input validation.** Token counters are numbers read from the local session
  store; the renderer treats absent/non-numeric values as missing (no crash).
- **Cryptography in transit/at rest.** Not applicable — no new persistence or
  transport; metadata rides the existing session event stream.
- **Logging/audit.** No new logs; the values are content-free coordinates and
  counters consistent with the routing telemetry policy.
- **Error-handling information exposure.** Session-read failures degrade to the
  unchanged metadata; no error text is added to the rendered line.

## Acceptance Scenarios

- **AC1.** A foreground task completes → its part metadata carries
  `tokens.input/output/reasoning` matching the child session record and, when
  configured, `effort`; the TUI line shows
  `N toolcalls · <duration> · <provider>/<model> (<effort>) · <in>k in/<out>k out`.
- **AC2.** A model without a configured `reasoningEffort` renders the same line
  without the `(<effort>)` segment.
- **AC3.** A part whose metadata lacks ALL new keys renders byte-identically to
  the pre-054 line (toolcalls · duration).
- **AC4.** A child-session read failure at completion still returns a
  successful task result with the spawn-time metadata unchanged.

## Observability

- No new telemetry signals: the feature is a display path over metadata that
  the routing/session planes already record (session token counters, routed
  model coordinates). The existing `routing.*`/session spans remain the audit
  trail; adding a duplicate UI-render signal would violate the closed
  telemetry key allow-list for no diagnostic gain.
- Debuggability: the stamped metadata envelope is inspectable via the session
  event stream (part `state.metadata`), which is how the acceptance tests and
  any regression triage read it — no log lines are added or removed.

## Non-Goals

- Reading anything back from the OTel/telemetry backend for UI display.
- Live (in-flight) token streaming on the running task line; only the
  completed line is in scope.
- Cost (USD) display.
