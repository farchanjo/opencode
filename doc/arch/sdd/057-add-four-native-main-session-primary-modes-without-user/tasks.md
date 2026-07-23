# Tasks: Add Four Native Main Session Primary Modes Without User Profile Agent MD

## Task Breakdown

- [x] T001 Add system prompt markdown files
  `packages/opencode/src/agent/defaults/{plan,build,solo,speckit}.md` with
  mode-specific instructions (speckit: no implement; solo: no task; build: Agent
  main→workers; plan: plan-only). Bodies only — no permission authority in MD.

- [x] T002 Register native primaries in `packages/opencode/src/agent/agent.ts`:
  import defaults MD; add `solo` and `speckit` with FR permissions; tighten
  `plan` to deny all task; ensure `build` remains task-capable and
  `plan_enter`/`plan_exit` targets unchanged.

- [x] T003 Mirror `solo` and `speckit` (and prompt/permission parity) in
  `packages/core/src/plugin/agent.ts` so the plugin agent catalog stays aligned.

- [x] T004 TUI agent picker labels: Plan / Agent / Solo / Speckit mapping Agent→`build`
  (packages/tui agent dialog or equivalent). Primaries remain selectable.

- [x] T005 Tests in `packages/opencode/test/agent/` (and permission tests if needed):
  four primaries exist; no primary `ask`; solo/speckit deny task; speckit denies
  edit and bash implement patterns; allows a Speckit status-style bash pattern;
  build allows task evaluation.

- [x] T006 Run `bun typecheck` / targeted `bun test` in `packages/opencode` (and
  core if touched); `~/bin/speckit validate` green for the feature artefacts.

## Residual — MCP visibility (FR 6 / 11b)

- [x] T007 Speckit permissions: remove blanket `"*": "deny"`; keep explicit
  denials for `edit`, `task`, `plan_enter`/`plan_exit`, and bash (allowlist
  Speckit CLI + deny `implement*`). Allow `skill` and leave MCP server-prefixed
  tools permission-visible subject to global/user config.

- [x] T008 Solo: document/assert full tools including MCP; never introduce
  blanket `"*": "deny"`; keep `task: deny`.

- [x] T009 Update defaults MD for solo/speckit to state MCP is allowed for live
  evidence; Speckit still never free-edits product code or runs implement.

- [x] T010 Tests: `Permission.evaluate` / `Permission.disabled` for a
  representative MCP tool id (e.g. `chrome-devtools_list_pages`) is allow / not
  disabled on both `solo` and `speckit`; `skill` allow on speckit.

- [x] T011 Corpus residual: align plan, tasks, ADR-0057, Gherkin feature, and CUE
  schema with FR 6 / 11b; `~/bin/speckit validate` green.

## Dependencies

- Feature 056 hierarchy collapse (main→workers) already implemented.
- Existing native `plan`/`build`/`general`/`explore` agents.
- Speckit CLI external binary for runtime Speckit mode (not bundled).
- No fapp catalog dependency.
- MCP servers configured by operator (e.g. chrome-devtools) — product only
  exposes tools when servers are enabled; this residual is permission shape only.
