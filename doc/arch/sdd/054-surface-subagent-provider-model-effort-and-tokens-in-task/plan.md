# Implementation Plan: Surface Subagent Provider Model Effort And Tokens In Task

## Overview

Enrich the completed subagent task line with executor coordinates
(provider/model), reasoning effort, and token usage, sourced exclusively from
in-process state (spec FR1-FR4). Two seams change: the task tool's completion
metadata stamp (`packages/opencode/src/tool/task.ts`) and the TUI's completed
detail formatter (`packages/tui/src/routes/session/index.tsx`). The telemetry
backend is explicitly NOT consulted (ADR-0054).

## Technical Approach

1. **Effort at spawn (FR2).** In the task tool, after the routed model is
   resolved, read the merged config once (`config.get()`, already in scope for
   the spawn path) and resolve
   `provider[providerID].models[modelID].options.reasoningEffort ??
   provider[providerID].options.reasoningEffort`. When a string is present,
   stamp `effort` into the SAME `metadata` object the spawn already builds
   (beside `model`); otherwise omit the key.
2. **Tokens at completion (FR1).** On the foreground completed path (and the
   timeout path where the child exists), read the child session record via the
   existing `sessions` service handle (`sessions.get(nextSession.id)`) and
   spread `tokens: { input, output, reasoning, cache }` into the returned
   metadata. Wrap the read in a catch that returns the spawn-time metadata
   unchanged (AC4) — a stats miss must never fail a successful task.
3. **Rendering (FR3).** Extend `formatCompletedSubagentDetail` to accept an
   optional usage record `{ providerID?, modelID?, effort?, tokens? }` parsed
   from part metadata by the caller: segments are appended in order
   `<provider>/<model>`, `(<effort>)` attached to the model segment, and
   `<in> in/<out> out` with compact thousands formatting (`10.2k`). Each
   segment renders only when its datum is present; with none present the
   output is byte-identical to today (AC3). The caller in the task part
   component reads `part.state.metadata` exactly as it already does for
   `background`/`jobId`.
4. **Tests.** Unit tests on the formatter (all degradation combinations,
   byte-identical floor) in the TUI test suite beside the existing
   `formatSubagent*` coverage, and a task-tool test asserting the completion
   metadata envelope carries `tokens`/`effort` against a fake session store
   (and stays unchanged when the session read fails).

## Companion Artifacts

- CUE contract: `doc/arch/schemas/surface-subagent-provider-model-effort-and-tokens-in-task.cue`
  (`#TaskCompletionUsage`) — the metadata envelope shape.
- Gherkin: `doc/arch/specs/features/surface-subagent-provider-model-effort-and-tokens-in-task.feature`.
