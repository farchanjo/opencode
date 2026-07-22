# Tasks: Surface Subagent Provider Model Effort And Tokens In Task

## Task Breakdown

- [x] T001 Guard scope: add the Feature 054 `specScopeGlobs` block to
  `doc/arch/speckit.toml` (the TUI session route file has no existing glob;
  `tool/task.ts` and its test are cited traceability from 044/049/053).
- [x] T002 Effort stamp (FR2): resolve `reasoningEffort` for the routed
  `{providerID, modelID}` from the merged config at spawn and add `effort` to
  the task metadata envelope beside `model`; omit when unconfigured.
- [x] T003 Token stamp (FR1): on the foreground completed/timeout return
  paths, read the child session record and spread
  `tokens: { input, output, reasoning, cache }` into the returned metadata;
  a read failure returns the spawn-time envelope unchanged (AC4).
- [x] T004 Renderer (FR3): extend `formatCompletedSubagentDetail` (and its
  task-part caller) to append `<provider>/<model> (<effort>)` and
  `<in> in/<out> out` segments from part metadata with per-segment
  degradation and compact thousands formatting; byte-identical floor (AC3).
- [x] T005 Tests: formatter unit coverage (all presence combinations + floor)
  and task-tool completion-envelope coverage (tokens/effort stamped; unchanged
  on session-read failure) against fakes.
- [x] T006 Gates: `bun test test/tool/` + TUI suite green;
  `bunx tsgo --noEmit` clean for both packages; `speckit validate --json`
  `ok:true`; rebuild + deploy `/opt/opencodev2` and observe one live completed
  task line showing the new segments.

## Dependencies

- Features 044/048/049/053 task-tool seams (spawn metadata, hierarchy
  dispatch) — shipped.
- The TUI reads part metadata only; no server/protocol changes required.
