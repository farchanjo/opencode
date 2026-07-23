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

1. **Durable tool buffers** — every tool result (native, shell, MCP) is always
   written to the truncation/tool-output directory with `metadata.outputPath`.
   In-context preview may still truncate via `tool_output` limits, but the full
   buffer is never discarded. Compaction prune keeps a recoverable path instead
   of `[Old tool result content cleared]`.

2. **Primary chat output budget** — config `chat_output.{max_words,max_tokens}`
   (0 = unlimited) enforces a console-chat reply budget for **primary** agents
   only, via system instruction + stream clamp on text-delta/text-end. Tool-call
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

1. `Truncate.output` MUST always persist the full text to the truncation
   directory and MUST always return `outputPath`.
2. When under `tool_output` limits, in-context `content` remains the full text;
   when over limits, `content` is a preview with path hint and `truncated: true`.
3. Native tool wrap (`tool.ts`), MCP session tools, plugin registry path, and
   shell MUST attach `metadata.outputPath` (and `truncated`) on completed results.
4. Compaction prune, before marking `time.compacted`, MUST ensure a full file
   exists (`write` if `outputPath` missing) and MUST replace bulky in-context
   `output` with a pointer to that path.
5. `MessageV2` model conversion for compacted tools MUST surface the path when
   present instead of the generic cleared placeholder.

### Chat output budget

6. Config surface `chat_output` MUST support optional non-negative
   `max_words` and `max_tokens` (0 or omit = unlimited for that dimension).
7. Budget MUST apply only when `agent.mode === "primary"` and the assistant
   message is not a summary/compaction-only path.
8. Budget MUST clamp only assistant **console text** (text-delta / text-end).
   Tool-call argument streams and write/edit/apply_patch payloads MUST NOT be
   clamped by this budget.
9. When active, primary turns MUST inject a system block stating the console
   budget and the file-write exemption.
10. Stream enforcement MUST stop appending text once the word and/or token
    budget is exhausted; final text-end MUST re-apply the clamp after plugins.

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
