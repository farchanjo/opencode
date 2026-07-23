# Implementation Plan: Add Four Native Main Session Primary Modes Without User Profile Agent MD

## Overview

Ship four native main-session primaries—`plan`, `build` (UI Agent), `solo`,
`speckit`—with system prompts from package markdown defaults and TypeScript
permissions. Speckit mode runs Speckit CLI only and never implements product
code. Spec: [spec.md](spec.md). ADR: [0057](../../adr/0057-add-four-native-main-session-primary-modes-without-user.md).

## Technical Approach

### Layers

| Layer | Change |
| ----- | ------ |
| Domain/application agent registry | `packages/opencode/src/agent/agent.ts` — register `solo` + `speckit`; load prompts; tighten `plan` task deny |
| Core plugin parity | `packages/core/src/plugin/agent.ts` — same four primaries + permissions |
| System prompts | `packages/opencode/src/agent/defaults/{plan,build,solo,speckit}.md` imported as strings |
| TUI | Agent picker labels Plan/Agent/Solo/Speckit (`build` → Agent) |
| Tests | Permission evaluate + agent list in `packages/opencode/test/agent/` |

### Key behaviours

- **build**: existing; ensure `task` allowed; optional prompt body from `defaults/build.md`.
- **plan**: existing; deny all `task`; prompt from `defaults/plan.md` where useful.
- **solo**: new primary; full tools; `task: deny`.
- **speckit**: new primary; edit/task deny; bash allowlist Speckit; deny `implement*`.
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
- Prompts loaded from package defaults MD.
- Validate green; agent tests green.
