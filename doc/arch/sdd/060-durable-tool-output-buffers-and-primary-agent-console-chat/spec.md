---
id: 019f8d43-a626-74c2-800d-39f16ee4f28f
number: 060
slug: durable-tool-output-buffers-and-primary-agent-console-chat
status: implemented
created_at: 2026-07-23T04:37:28.742547Z
---
# Feature Specification: Durable Tool Output Buffers And Primary Agent Console Chat

Feature: 060-durable-tool-output-buffers-and-primary-agent-console-chat
Created: 2026-07-23

## Summary

Two operator-facing controls for session fidelity and chat verbosity:

1. **Durable tool buffers (subagent path)** — when the executing agent is a
   **subagent** (or over `tool_output` limits), the full tool buffer is written
   to disk with `metadata.outputPath` so peer agents can recover it. Primary
   console agents only write to disk when the in-context preview is truncated.
   Compaction prune keeps a recoverable path instead of irreversible clear.

2. **Primary chat output budget (soft)** — config `chat_output.{max_words,max_tokens}`
   (0 = unlimited) instructs the **primary** model to *compose* console chat
   within the limit via system prompt only — **no stream filtering**. Tool-call
   arguments and file write/edit payloads are exempt. Live TUI control patches
   global config so the next model turn picks up the budget.

## User Stories

- As a user I want full tool output always on disk so a later agent can
  Read/Grep everything even after preview truncation or compaction.
- As a user I want compaction prune to leave a path pointer, not destroy the
  only copy of large tool results.
- As a user I want to cap how long the primary agent chats in the console
  (words and/or estimated tokens) without breaking file writes.
- As an operator I want to change that chat budget from the TUI in real time
  (slash / command palette / session menu) without restarting the process.

## Functional Requirements

### Durable tool buffers

1. `Truncate.output` MUST persist the full text and return `outputPath` when
   `agent.mode === "subagent"` (or `persistFull: true`), even under limits.
2. For primary/console agents under limits, MUST NOT write disk; content is full
   text in context only.
3. When over `tool_output` limits for any agent, MUST write full buffer, return
   preview + path, `truncated: true`.
4. Compaction prune, before marking `time.compacted`, MUST ensure a full file
   exists (`write` if `outputPath` missing) and MUST replace bulky in-context
   `output` with a pointer to that path.
5. `MessageV2` model conversion for compacted tools MUST surface the path when
   present instead of the generic cleared placeholder.

### Chat output budget

6. Config surface `chat_output` MUST support optional non-negative
   `max_words` and `max_tokens` (0 or omit = unlimited for that dimension).
7. Budget MUST apply only when `agent.mode === "primary"` (main context console).
8. Budget MUST be communicated via system instruction so the **model self-sizes**
   its console chat. Runtime MUST NOT hard-truncate or filter streamed text.
9. Tool-call arguments and write/edit/apply_patch payloads MUST remain exempt.
10. When active, primary turns MUST inject a system block stating the console
    budget, self-edit expectation, and file-write exemption.

### Live TUI

11. TUI MUST expose DialogChatOutput via:
    - command palette "Chat output budget" (`chat.output`)
    - slash `/chat-output` (aliases `response-budget`, `chat-budget`)
    - session menu entry
    - keybind name `chat_output` (default unbound)
12. Dialog MUST offer OFF (0/0), word presets, token presets, and clear-per-axis.
13. Dialog MUST patch global config via `global.config.update` under
    `OPENCODE_CONFIG_DIR` / config root; changes apply on the next model turn
    (`config.get` at processor create).

## Security Requirements

- **Data sensitivity/classification.** Tool outputs may contain secrets, paths,
  and credentials. Full buffers are stored under the existing truncation dir
  with the same 7-day cleanup as today. Chat budget does not add new stores.
- **Authentication/authorization.** No new auth surface. Global config write is
  local operator authority (same as skill_list TUI).
- **Input validation.** Config fields are schema-validated non-negative ints.
  Stream clamp bounds text length; no network input.
- **Cryptography in transit/at rest.** Not applicable — local files only;
  no new transport.
- **Logging/audit.** Do not log full tool buffers or chat budget text content
  at INFO; prune/write paths may log counts only.
- **Error-handling information exposure.** Config update errors surface TUI
  error text without dumping unrelated secrets.

## Acceptance Scenarios

Given a short bash tool result under tool_output limits
When the tool completes
Then metadata.outputPath points to a file whose content equals the full output

Given a large tool result over max_lines
When the tool completes
Then in-context content is a truncated preview with path hint and the full
file on disk is complete

Given compaction prune selects a completed tool part
When prune runs
Then the part keeps metadata.outputPath and model replay shows the path, not
"[Old tool result content cleared]"

Given chat_output.max_words=50 and a primary agent turn
When the model streams long console text
Then the stored assistant text part is clamped to ≤50 words

Given chat_output is set and the model issues a write tool with a long file body
When the tool call is executed
Then the file content is not truncated by the chat budget

Given the operator sets max words to 150 via TUI DialogChatOutput
When the next primary turn runs
Then the system prompt includes the console budget block and stream clamp uses 150

## Observability

- Existing Truncate cleanup logs on failure remain.
- Compaction prune continues to log pruned counts (no full payload).
- No new metric series required for v1; optional later: chat budget hit counter.

## Out of scope

- Grok response-budget bridges.
- Hard maxOutputTokens that would break multi-tool file writes.
- Feature 005 OutputSpool cutover changes beyond path compatibility.
- Per-session ephemeral budget without global config persistence.
