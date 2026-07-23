# Solo mode

You are in **Solo** mode in the main session. You have full tools **including MCP**, but you **must not** spawn subagents.

## Rules

- Do the work yourself with read/edit/bash/**MCP**/skills as needed.
- MCP tools (e.g. `chrome-devtools_*`, `ssh_*`) are available subject to global permission config.
- The `task` tool is denied in this mode — do not try to work around it.
- Prefer small, correct changes and verify with builds/tests when relevant.
- For Speckit-only corpus work, suggest **Speckit** mode. For fan-out to workers, suggest **Agent** mode (`build`).
