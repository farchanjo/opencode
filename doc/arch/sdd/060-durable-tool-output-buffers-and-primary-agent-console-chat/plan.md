# Plan: Durable Tool Output Buffers And Primary Agent Console Chat

Feature: 060-durable-tool-output-buffers-and-primary-agent-console-chat

## Technical approach

### Layer 1 — Truncate always-persist

- Change `Truncate.Result` so `outputPath` is always present.
- `output()` always `write(text)` first, then decide preview vs full for `content`.
- Update call sites: `tool.ts`, `session/tools.ts`, `tool/registry.ts`,
  `tool/shell.ts` to always set `metadata.outputPath`.

### Layer 2 — Compaction path preservation

- `SessionCompaction.prune`: before `time.compacted`, ensure disk file via
  `Truncate.write` if needed; set metadata; replace `state.output` with pointer.
- `MessageV2.compactedToolOutputText`: prefer path message over cleared placeholder.
- Depend on `Truncate.node` in compaction layer.

### Layer 3 — chat_output config + stream clamp

- ConfigV1: `chat_output.{max_words,max_tokens}` as NonNegativeInt (0 = unlimited).
- Migrate passthrough in `migrate.ts`.
- Pure domain `session/chat-output.ts`: resolve budget, apply clamp, system block.
- `LLMRequestPrep.prepare`: inject system block for primary agents.
- `SessionProcessor`: create budget from config when primary; clamp text-delta
  and text-end only.

### Layer 4 — TUI live control

- `DialogChatOutput` patches `global.config.update({ chat_output })`.
- Wire: app command `chat.output`, slash `/chat-output`, session menu, keybind
  `chat_output` → `chat.output`.

## Architecture fit

- Schema → Core config (V1) → opencode session/tool runtime → TUI client.
- No parallel stores; reuse truncation directory + existing global config write.
- Complements Feature 005 OutputSpool (path dual-read remains valid).

## Test plan

- `test/tool/truncation.test.ts` — always persist under/over limits.
- `test/session/chat-output.test.ts` — resolve/clamp/system block.
- `test/session/message-v2.test.ts` — compacted path vs cleared.
- Typecheck packages `core`, `opencode`, `tui`.
- Deploy binary smoke: version + TUI command presence after rebuild.

## Risks

- Deep-merge cannot delete keys: use 0 for unlimited to clear an axis.
- globalConfigFile prefers `opencode.json` over `config.json` when both exist —
  chat_output may land in opencode.json under OPENCODE_CONFIG_DIR; both load.
- Stream clamp is post-token generation for already-sent deltas; hard stop on
  further deltas once exhausted.
