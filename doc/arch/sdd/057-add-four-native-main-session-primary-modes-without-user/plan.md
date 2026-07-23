# Implementation Plan: Add Four Native Main Session Primary Modes Without User Profile Agent MD

## Overview

Ship four native main-session primaries—`plan`, `build` (UI Agent), `solo`,
`speckit`—with system prompts from package markdown defaults and TypeScript
permissions. Speckit mode runs Speckit CLI, read tools, and MCP for live
evidence; never free-edits product code or runs `speckit implement`. Spec:
[spec.md](spec.md). ADR: [0057](../../adr/0057-add-four-native-main-session-primary-modes-without-user.md).

## Technical Approach

### Layers

| Layer | Change |
| ----- | ------ |
| Domain/application agent registry | `packages/opencode/src/agent/agent.ts` — register `solo` + `speckit`; load prompts; tighten `plan` task deny; MCP-safe permission shape |
| Core plugin parity | `packages/core/src/plugin/agent.ts` — same four primaries + permissions |
| System prompts | `packages/opencode/src/agent/defaults/{plan,build,solo,speckit}.md` imported as strings |
| TUI | Agent picker labels Plan/Agent/Solo/Speckit (`build` → Agent) |
| Tests | Permission evaluate + agent list in `packages/opencode/test/agent/` (incl. MCP tool ids) |

### Key behaviours

- **build**: existing; ensure `task` allowed; optional prompt body from `defaults/build.md`.
- **plan**: existing; deny all `task`; prompt from `defaults/plan.md` where useful.
- **solo**: new primary; full tools **including MCP**; `task: deny`; never blanket `"*": "deny"`.
- **speckit**: new primary; **explicit** denials only (`edit`, `task`, restricted `bash`); **allow** read tools, `skill`, and **MCP** (server-prefixed tool ids); bash allowlist Speckit; deny `implement*`. **Forbidden:** blanket `"*": "deny"` (hides MCP via `Permission.disabled` / `visibleTools`).
- **plan_exit**: unchanged → `build`.

### MD import

Reuse the same bundler path used for `./prompt/*.txt` (Bun text import). If `.md`
is not already allowed, add the minimal loader config already used for other
markdown assets in the package.

### Out of package scope (document only unless tasks expand)

Profile cleanup (`~/.opencodedev` archive of manager-*/shadow build.md, hierarchy
scrub) is **operator local** — not required for product binary tests. Mention in
spec out-of-scope / optional ops note.

## Implementation Sequence

1. Add `defaults/*.md` system prompt bodies.
2. Wire imports + register `solo`/`speckit` + tighten plan in `agent.ts`.
3. Core plugin parity.
4. TUI labels.
5. Unit tests for permissions and registry.
6. `speckit validate` + package typecheck/tests.

## Success Criteria

- Four primaries present without profile agent MD.
- Speckit cannot implement code; Solo cannot task; Build can task.
- Solo and Speckit keep representative MCP tool ids (e.g. `chrome-devtools_list_pages`) permission-visible (not disabled by blanket deny).
- Prompts loaded from package defaults MD (solo/speckit mention MCP where relevant).
- Validate green; agent tests green.

## Residual (MCP permission shape)

Post-implement residual: Speckit originally used `"*": "deny"` + allowlist of
native tools, which hid all MCP tools. Residual FR 11b requires explicit
denials only. Code shipped in `c81fce19`; this plan/tasks/Gherkin/ADR alignment
is the corpus repair so SDD matches the runtime.
