# Tasks: Durable Tool Output Buffers And Primary Agent Console Chat

## Task Breakdown

### Durable tool buffers (shipped)

- [x] T001 `Truncate.output` persist-full for **subagents** (or over limits);
  primary under limits = no disk (`packages/opencode/src/tool/truncate.ts`).

- [x] T002 Attach `metadata.outputPath` when present on native/MCP/registry/shell.

- [x] T003 Compaction prune writes missing full file and pointer output before
  `time.compacted` (`session/compaction.ts` + Truncate dep).

- [x] T004 MessageV2 compact rendering prefers path over cleared placeholder
  (`session/message-v2.ts`).

- [x] T005 Truncation tests: primary no-disk under limits; subagent persists.

### Chat output budget (shipped)

- [x] T010 Config `chat_output` NonNegativeInt max_words/max_tokens + migrate
  (`packages/core/src/v1/config/config.ts`, `migrate.ts`).

- [x] T011 Domain helper `session/chat-output.ts` (system block self-size) + unit tests.

- [x] T012 Primary system inject in `session/llm/request.ts` (soft only).

- [x] T013 No stream filter in processor — model composes within budget.

### Live TUI (shipped)

- [x] T020 `DialogChatOutput` global config patch
  (`packages/tui/src/component/dialog-chat-output.tsx`).

- [x] T021 Wire command palette + slash + session menu + keybind
  (`app.tsx`, `routes/session/index.tsx`, `config/keybind.ts`).

- [x] T022 Typecheck tui/core/opencode.

### Corpus + release

- [x] T030 Speckit feature 060 corpus (spec/plan/tasks/ADR/Gherkin/CUE) aligned
  with shipped code; validate green.

- [x] T031 Commit conventional; build `--single --skip-embed-web-ui`; deploy
  `/opt/opencodev2`; push `fcustom`.

## Dependencies

- Existing Truncate + compaction prune (pre-F060).
- Global config update path (Feature 028/030 OPENCODE_CONFIG_DIR).
- TUI DialogSelect + SDK `global.config.update` (same as F058 skill_list).
