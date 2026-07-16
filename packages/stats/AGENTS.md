To start the stats site locally, run `bun dev:stats` from the repo root.

## Spec Kit governance on `fcustom`

- `doc/arch` is the source of truth: check `speckit status`/`speckit next`, active feature, and guard before changing this package.
- Follow `specify → clarify` (when needed) → `plan → tasks → analyze → implement → validate`, with incremental validation and the repository hook; record changed decisions.
- Do not implement Smart Routing while alternatives are open or without explicit authorization. Root `AGENTS.md` and the constitution govern; keep these package rules intact.
