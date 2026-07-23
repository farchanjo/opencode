---
status: accepted
date: 2026-07-23
deciders: [opencode-operator]
consulted: []
informed: []
---

# Add Four Native Main Session Primary Modes Without User Profile Agent MD

## Context and Problem Statement

Users need four explicit modes in the main session—Plan, Agent, Solo, Speckit—
without relying on profile-scoped agent markdown for those modes, and without a
generic “ask” primary. Speckit work must not free-edit product code or run
`speckit implement` inside Speckit mode. Feature 056 collapsed hierarchy to
main→workers; only the Agent mode should spawn workers.

## Decision Drivers

- Same session identity when switching modes
- Native harness ownership (no required profile agent MD for the four)
- Speckit mode = full non-implement Speckit loop only
- Align with task-only-from-build (F056)
- Versioned system prompts in-repo

## Considered Options

- **A — Four native primaries (`plan`, `build`, `solo`, `speckit`) with shipped
  `defaults/*.md` prompts and TS permissions.** Chosen.
- **B — Profile MD for all four modes.** Rejected: not portable defaults; shadows
  natives; user forbade primary-via-profile-MD for this design.
- **C — Single agent with soft prompt-only modes.** Rejected: cannot enforce
  task/edit/bash gates.
- **D — Primary named `ask` wrapping Speckit.** Rejected: user wants wire id
  `speckit` and no `ask` mode.

## Decision Outcome

Chosen option: **A**.

Concretely:

1. Wire ids: `plan`, `build` (UI Agent), `solo`, `speckit`.
2. `build` alone among the four allows `task`.
3. `solo`: full tools, `task` deny.
4. `speckit`: edit/task deny; bash allowlist Speckit binary; deny `implement*`.
5. System prompts: `packages/opencode/src/agent/defaults/{plan,build,solo,speckit}.md`.
6. Registry/permissions: TypeScript native agents + core plugin parity.
7. `plan_exit` continues to target `build`.

### Consequences

- Good: clear modes, enforceable permissions, Speckit-safe surface, in-repo prompts.
- Good: no fapp/profile dependency for defaults.
- Bad: developers must switch to build/solo for code implement after Speckit phases.
- Neutral: profile MD that shadows native names still overrides if present—docs
  recommend not shadowing the four.

## Related

- Feature: [057 spec](../sdd/057-add-four-native-main-session-primary-modes-without-user/spec.md)
- Related: ADR-0056 (hierarchy collapse), ADR-0002 (routing hierarchy, partially superseded)
