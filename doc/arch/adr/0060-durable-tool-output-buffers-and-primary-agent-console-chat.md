---
status: accepted
date: 2026-07-23
deciders: [opencode-operator]
consulted: []
informed: []
---

# Durable Tool Output Buffers And Primary Agent Console Chat

## Context and Problem Statement

Tool results larger than context budgets were partially truncated; smaller
results never hit disk. Compaction prune then replaced older tool outputs with
`[Old tool result content cleared]`, destroying recoverability for later
agents. Separately, operators wanted an enforceable console chat word/token
budget for primary agents only, without breaking file writes, with live TUI
control.

## Decision Drivers

- Never lose full tool buffers; always recoverable via path
- Compaction must free context without discarding the only copy
- Chat budget: primary console text only; tools/writes exempt
- Live operator control (TUI → global config, next turn)
- Code-first, testable pure helpers + existing Truncate dir

## Considered Options

- **A — Always-persist Truncate + path-preserving prune + chat_output config
  with stream clamp + TUI dialog.** Chosen.
- **B — Rely only on Feature 005 OutputSpool.** Rejected for this loop: V1
  session path still uses Truncate; dual-read path stays complementary.
- **C — maxOutputTokens as the only chat budget.** Rejected: breaks large
  write tool payloads in the same completion.
- **D — Soft system prompt only (no stream clamp).** Rejected: not enforceable.

## Decision Outcome

Chosen option: **A**.

1. `Truncate.output` always writes full buffer and returns `outputPath`.
2. Prune and MessageV2 keep path pointers instead of irreversible clear.
3. `chat_output` config (0 = unlimited) + primary system inject + text stream
   clamp only.
4. TUI DialogChatOutput patches global config live.

### Consequences

- Good: other agents can always Read/Grep full tool output.
- Good: console verbosity controllable without file-write breakage.
- Good: operator can change budget without process restart.
- Bad: disk use grows with every tool call (mitigated by 7-day cleanup).
- Neutral: chat_output may land in opencode.json when it exists first in
  config root candidate order; layered load still applies.

## Related

- Feature: [060 spec](../sdd/060-durable-tool-output-buffers-and-primary-agent-console-chat/spec.md)
- Related: F005 OutputSpool, F008 MCP lifecycle, F058 TUI config dialog pattern
