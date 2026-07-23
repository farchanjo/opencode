---
id: 019f8c9a-2b86-7f30-ab04-f9a644a820ff
number: 057
slug: add-four-native-main-session-primary-modes-without-user
status: implemented
created_at: 2026-07-23T01:32:21.766325Z
---
# Feature Specification: Add Four Native Main Session Primary Modes Without User Profile Agent MD

Feature: 057-add-four-native-main-session-primary-modes-without-user
Created: 2026-07-23

## Summary

OpenCode already ships native primary agents `plan` and `build` in harness code.
Users need four explicit main-session modes in the **same session** without
depending on profile MD files (`~/.config/opencode` / `OPENCODE_CONFIG_DIR` agent
MD) for those modes:

| UI label | Wire id | Role |
| -------- | ------- | ---- |
| Plan | `plan` | plan-only (existing) |
| Agent | `build` | full tools + `task` spawn (existing wire id) |
| Solo | `solo` | full tools, **no** `task`/subagents (new) |
| Speckit | `speckit` | Speckit CLI only; **no** free edit; **no** `implement` (new) |

There is **no** primary named `ask`. Speckit mode is the dedicated Speckit loop
surface and MUST NOT implement product code.

System prompts for the four modes ship as markdown under
`packages/opencode/src/agent/defaults/` and are imported by the native agent
registry. Wire ids, mode, and permissions live in TypeScript only.

Aligns with Feature 056 (main → workers only): only **`build`** may spawn
workers via `task`.

## User Stories

- As a user I want Plan / Agent / Solo / Speckit as first-class primary modes in
  one session so that I switch mode without losing session history.
- As a user I want Agent mode (`build`) to remain the default executor that can
  spawn subagents so that complex work can fan out.
- As a user I want Solo mode to use full tools in the main context without
  spawning subagents so that I keep full control without hierarchy noise.
- As a user I want Speckit mode to run the Speckit SDD/corpus CLI safely so that
  I never free-edit code or run `speckit implement` in that mode.
- As a maintainer I want system prompts as shipped MD under the package agent
  tree so that defaults are versioned in the monorepo, not user profile MD.
- As a maintainer I want core plugin agent parity so that V1 and V2 agent paths
  expose the same four primaries.

## Functional Requirements

### Modes and session

1. The product MUST expose exactly four **user-visible native primary** agents for
   main-session work: `plan`, `build`, `solo`, `speckit`. Hidden internals
   (`compaction`, `title`, `summary`, …) remain unchanged.
2. Wire id **`build`** MUST remain the Agent-mode executor. UI MAY label it
   “Agent”; MUST NOT rename the wire id in this feature.
3. Wire id **`plan`** MUST remain the plan mode agent. `plan_exit` MUST continue
   to switch the next user turn to **`build`** (not solo/speckit).
4. Same-session mode switch MUST use the existing user-message `agent` field;
   session id MUST NOT change solely because the primary mode changed.
5. Default main agent MUST remain **`build`** unless the operator sets
   `default_agent` to another **primary** that exists and is not hidden.

### Solo (new)

6. Native primary `solo` MUST allow normal project tools (edit/bash/MCP subject
   to global/user permission config) and MUST deny **`task`** (no subagent spawn).
7. `solo` MUST be `mode: "primary"`, `native: true`, and MUST NOT require a
   profile agent MD file to exist.

### Speckit (new)

8. Native primary `speckit` MUST be `mode: "primary"`, `native: true`.
9. `speckit` MUST deny free file mutation tools: at least `edit` (and
   `apply_patch` / write equivalents if exposed as separate permissions).
10. `speckit` MUST deny **`task`**.
11. `speckit` MUST allow read-oriented tools needed for orientation: at least
    `read`, `grep`, `glob`, `list`, and `question`.
12. `speckit` MUST allow `bash` only for Speckit CLI invocations via an allowlist
    of patterns that match the canonical binary paths and `speckit <subcommand>`
    forms (including `~/bin/speckit` and `*/bin/speckit`). All other bash MUST
    deny by default.
13. `speckit` MUST deny bash patterns that invoke **`speckit implement`**
    (including path-prefixed forms such as `*/bin/speckit implement*`). The mode
    MUST never implement product code; when Speckit `next` recommends implement,
    the agent MUST instruct the user to switch to `build` or `solo`.
14. Speckit CLI commands that mutate **`doc/arch`** SDD artefacts (specify, plan,
    tasks, analyze, validate, feature lifecycle, etc.) remain allowed when invoked
    through the bash allowlist; that is not “code implementation”.
15. `speckit` MUST NOT depend on embedding Speckit logic inside another agent
    named `ask`. There is no primary `ask` mode in this feature.

### Plan tightening

16. `plan` SHOULD deny all `task` spawns (not only `task.general`) so plan mode
    cannot fan out workers. Existing plan path edit exceptions MUST remain.

### System prompts (shipped MD)

17. System prompt bodies for `plan`, `build`, `solo`, and `speckit` MUST ship as
    markdown files under `packages/opencode/src/agent/defaults/` named
    `plan.md`, `build.md`, `solo.md`, `speckit.md`.
18. The native agent registry MUST load those bodies into each agent’s `prompt`
    (or equivalent system prompt field). Permission and wire metadata MUST NOT
    be defined solely in those MD files’ frontmatter as the authority (TS owns
    ids/mode/permission).
19. User profile agent MD MUST NOT be required for the four modes to work. If a
    profile file shadows a native name, existing override rules apply; product
    docs SHOULD recommend not shadowing `plan`/`build`/`solo`/`speckit`.

### TUI / discovery

20. The agent picker MUST list the four primaries with user-facing labels Plan,
    Agent, Solo, Speckit (Agent maps to `build`).
21. Core plugin agent registration (`packages/core/src/plugin/agent.ts` or
    successor) MUST stay parity-capable for the new primaries so non-opencode
    surfaces that consume the plugin catalog do not omit them.

### Hierarchy alignment

22. Only **`build`** among the four primaries MAY allow `task` for worker spawn,
    consistent with Feature 056 (main → workers). `solo` and `speckit` MUST NOT
    reintroduce Manager-child orchestration.

### Tests

23. Automated tests MUST prove: all four primaries exist and are primary/native;
    `solo` and `speckit` deny `task`; `speckit` denies free `edit` and denies
    bash `implement` patterns while allowing a representative Speckit status
    command pattern; same-session switch retains session identity (existing
    seams if already covered).

## Security Requirements

- **Data sensitivity/classification.** This feature configures agent identity,
  permission rulesets, and system prompt text. It does not store secrets. Speckit
  mode may invoke Speckit CLI which reads/writes `doc/arch` under Speckit guard
  policy — not a new secret store.
- **Authentication/authorization.** No new auth principals. Permissions reuse
  existing Permission evaluate/visibleTools. Speckit bash allowlist is a
  deny-by-default command-prefix gate.
- **Input validation.** Bash patterns are closed allow/deny lists in code. Agent
  names are closed wire ids. No free-form user permission DSL introduced.
- **Cryptography in transit/at rest.** Not applicable — no new encrypted
  transport or store.
- **Logging/audit.** Agent switches already appear on user messages; no prompt
  bodies or Speckit command output in metric labels. Failures are typed
  permission denies without dumping secrets.
- **Error-handling information exposure.** Denied implement/edit surfaces a
  clear, non-secret reason (permission denied / instruct switch to build|solo).

## Acceptance Scenarios

Given OpenCode starts with default configuration
When  the user lists primary agents
Then  `plan`, `build`, `solo`, and `speckit` are present as primary native agents
      and there is no primary named `ask`.

Given a session on agent `build`
When  the user switches to `solo` then `speckit` then `plan` without ending the session
Then  the session id is unchanged and each turn uses the selected agent’s
      permissions and system prompt.

Given agent `speckit`
When  the model attempts free `edit` of a source file under `packages/`
Then  the edit is denied.

Given agent `speckit`
When  bash runs `~/bin/speckit status` (or an equivalent allowed Speckit path form)
Then  the command is permitted by the agent permission ruleset.

Given agent `speckit`
When  bash attempts `speckit implement` or `*/bin/speckit implement …`
Then  the command is denied.

Given agent `solo`
When  the model attempts to invoke `task` to spawn a subagent
Then  the spawn is denied.

Given agent `build`
When  the model invokes `task` with a valid subagent type
Then  the spawn is allowed subject to existing hierarchy/task rules.

Given `plan_exit` completes with user approval
When  the synthetic follow-up user message is created
Then  its agent field is `build`.

Given a clean install without profile agent MD for the four modes
When  the agent registry loads
Then  all four modes are available from shipped defaults MD + native TS registration.

## Observability

No new high-cardinality metrics required. Reuse existing session/agent labels on
traces if present. Do not export system prompt bodies or full bash command lines
as metric labels. Optional debug logs for denied implement in speckit mode use
bounded reason enums only. Export conventions: `doc/arch/observability/observability.md`.

## Out of Scope

- Renaming wire id `build` to `agent`
- Profile archive scripts as mandatory product code (may be documented only)
- Embedding Speckit binary inside OpenCode
- Multi-user remote agent modes
- Restoring three-tier Manager primary modes

## Clarifications

- C1 — UI “Agent” maps to wire `build`.
- C2 — Speckit mode forbids **code** implementation; Speckit CLI writes under
  `doc/arch` remain in scope for that mode.
- C3 — System prompt MD lives under the package agent tree, not user profile.
