# OpenCode Agent Instructions

## Project

OpenCode monorepo (Bun workspaces): local-first AI coding agent with TUI, CLI,
loopback server/SDK, and domain packages under packages/. Default branch is dev.
Corpus source of truth: doc/arch.

## Architecture

Runtime dependencies: Schema → Core/Protocol → Server. Client depends on Schema
and Protocol only; sdk-next composes Client, Core, and Server. Operator management
authority is Feature 007 (`packages/core/src/operator`, `packages/opencode/src/operator`)
reusing Config Service and EventV2 — never parallel admin stores or LLM/MCP/plugin
management authority. Domain features register ports/adapters into the operator
control plane; reserved IDs live only in `packages/core/src/operator/catalog.ts`.

## Commands

- Regenerate legacy JS SDK: `./packages/sdk/js/script/build.ts`
- After public Protocol or Server HttpApi changes: `bun run generate` from `packages/client`
- Typecheck: `bun typecheck` from a package directory (never bare tsc from root)
- Tests: `bun test` from package directories (not repo root)
- Speckit loop: `speckit status` / `speckit next` / `speckit validate`
- Feature 007 sandbox: `./scripts/dev/opencode-operator-sandbox`

## Speckit CLI surface

Contract terms: exit code, `--json`, guard, validate. Config families: project,
git, guard, context, dedupe, adr, stats, semantic, gitlab, hygiene, compliance,
workflow, privacy (`speckit config list|get|set|unset|drift`).

- `speckit init` · `speckit constitution` · `speckit specify` · `speckit clarify`
- `speckit plan` · `speckit plan setup` · `speckit tasks` · `speckit tasks setup`
- `speckit analyze` · `speckit implement`
- `speckit feature` · `speckit feature new` · `speckit feature list` · `speckit feature select`
- `speckit feature renumber` · `speckit feature reorder` · `speckit feature insert`
- `speckit feature compact` · `speckit feature archive` · `speckit feature restore`
- `speckit status` · `speckit next` · `speckit validate` · `speckit explain` · `speckit verify`
- `speckit search` · `speckit diagram` · `speckit diagram render`
- `speckit workflow` · `speckit workflow render`
- `speckit guard` · `speckit guard check` · `speckit guard hook`
- `speckit hook` · `speckit hook session-start` · `speckit hook user-prompt`
- `speckit hook post-edit` · `speckit hook pre-commit`
- `speckit config` · `speckit config list` · `speckit config get` · `speckit config set`
- `speckit config unset` · `speckit config drift`
- `speckit on` · `speckit off` · `speckit check` · `speckit reindex` · `speckit migrate`
- `speckit version` · `speckit completions` · `speckit guide` · `speckit generate` · `speckit manual`
- `speckit context` · `speckit context score` · `speckit context pack`
- `speckit spec` · `speckit spec score` · `speckit dedupe`
- `speckit stats` · `speckit stats findings` · `speckit stats guard` · `speckit stats profile`
- `speckit stats attributes` · `speckit stats compliance` · `speckit stats corpus`
- `speckit stats recommendations`
- `speckit semantic` · `speckit semantic enable` · `speckit semantic off`
- `speckit semantic status` · `speckit semantic deep-status` · `speckit semantic eval`
- `speckit model` · `speckit model list` · `speckit model add` · `speckit model fetch`
- `speckit model check` · `speckit model select` · `speckit model remove` · `speckit model api`
- `speckit pack` · `speckit pack add` · `speckit pack list` · `speckit pack update`
- `speckit pack remove` · `speckit pack export` · `speckit pack import`
- `speckit library` · `speckit library add` · `speckit library list` · `speckit library show`
- `speckit library validate` · `speckit library update` · `speckit library remove`
- `speckit library ask` · `speckit library search` · `speckit library open`
- `speckit library extract` · `speckit library export` · `speckit library import`
- `speckit library serve` · `speckit library browse`
- `speckit mermaid` · `speckit mermaid render`
- `speckit gitlab` · `speckit gitlab sync` · `speckit gitlab status`
- `speckit missing` · `speckit brief` · `speckit ask`
- `speckit commit` · `speckit commit check` · `speckit commit suggest` · `speckit dismiss`
- `speckit license` · `speckit license list` · `speckit license show`
- `speckit license set` · `speckit license check`

## Conventions or constraints

- Conventional commits; short hyphenated branch names (no type prefixes).
- Prefer Bun APIs; avoid any; no try/catch when avoidable; functional array methods.
- Do not edit packages/client generated sources by hand.
- Local main ref may not exist; use dev or origin/dev for diffs.

## Spec-first protocol

spec-first: doc/arch is the source of truth — run `speckit status` then `speckit next`
and read the active feature spec before writing code. On fcustom, Speckit guard and
validation govern; do not hand-edit doc/.specify databases.

## SDK and package graph

- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server HttpApi, run `bun run generate` from `packages/client`. Do not edit client generated sources directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; sdk-next composes Client, Core, and Server.
- The default branch in this repo is dev.
- Local main ref may not exist; use dev or origin/dev for diffs.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

- One function unless reusable; no single-use helper extraction by default.
- Avoid try/catch and any; prefer const, early returns, no else.
- Prefer functional arrays with type guards on filter; Bun APIs when possible.
- Config modules: self-export pattern (`export * as ConfigAgent from "./agent"`).
- Effect generators: bind services to named vars before method calls.
- Inline one-shot values; avoid unnecessary destructuring; never alias or star-import.
- Dynamic-import heavy branch-only modules; Effect schema helpers for untrusted JSON.
- Drizzle fields snake_case; comments only for non-obvious constraints.
- Happy-path main + small helpers below for multi-branch validation.

## Testing and typecheck

- Prefer real implementations over mocks; avoid globalThis unless required.
- Tests not from repo root (do-not-run-tests-from-root); package dirs only.
- Always bun typecheck from package dirs; never tsc from root.

## V2 Session Core

- Durable admission separate from execution: SessionV2 prompt admits one
  session_input then advisory SessionExecution wake unless resume false.
- Session ID reuse adopts Session; prompt ID reuse only exact matching retry.
- SessionExecution process-global by Session ID; interrupt is no-op when idle.
- Runner/tools/permissions Location-scoped; omitted workspaceID = implicit-local.
- One llm stream call per provider turn; reload history before continuation.
- Local drains process-local until clustering; steers promote at safe boundaries;
  queue promotes one-at-a-time when idle.
- System Context algebra in packages/core/src/system-context; history/epoch Session-owned.

## Operator Control Plane (Feature 007)

ADR-0003. Integrator:
doc/arch/sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/reserved-catalog-v1.md

- Sole path: typed registry + dispatcher + TUI/CLI/loopback adapters; Config Service + EventV2.
- Never authority: Config templates, session command setup, ToolRegistry/MCP/plugin free-form admin.
- Domains register ports under packages/opencode/src/operator/; reserved IDs only via catalog bumps.
- Flag experimental operator control plane (default off); sandbox OPENCODE_DEV_OPERATOR env.
- Phase 1: core + TUI + CLI + loopback. App/Desktop and multi-user = Phase 2.
- Isolation: scripts/dev/opencode-operator-sandbox, port 14096, .dev/ only.

## Spec Kit on fcustom

- Installed speckit + doc/arch SSOT; status then next before code; no hand-edit of doc/.specify.
- Loop specify → clarify (if needed) → plan → tasks → analyze → implement → validate.
- Record decision changes in artifacts; no Smart Routing while alternatives open without auth.
- make install-hooks → .husky local hooksPath. On fcustom, pre-commit: cached check +
  speckit validate --json on HEAD vs staged worktree (new findings only). Missing
  Speckit/Bun is hard fail.
