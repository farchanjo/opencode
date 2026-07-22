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

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun file APIs when possible (see example below)
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `packages/opencode/src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not nest service yields.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun["file"](join(dir, "journal.json")).json()

// Bad
const journalPath = join(dir, "journal.json")
const journal = await Bun["file"](journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use property access to preserve context.

```ts
// Good
record["a"]
record["b"]

// Bad
const { a, b } = record
```

### Imports

- Never alias imports. Do not rename imports at the import site.
- Never use star imports.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference the project id constant from that namespace.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline dynamic-import chains. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return Effect from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as UnknownFromJsonString and decodeUnknownOption over manual JSON parse wrapped in Effect try when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: do-not-run-tests-from-root); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. SessionV2 prompt admits one durable session_input row before scheduling advisory SessionExecution wake(sessionID) unless resume false requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep SessionExecution process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through SessionStore plus LocationServiceMap lookup for the session location only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep SessionRunner, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted Location workspaceID means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit llm stream call per provider turn and reload projected history before durable continuation. Do not bridge through legacy SessionPrompt loop or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. SessionRunCoordinator joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit queue input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `packages/core/src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## Operator Control Plane (Feature 007)

Native management authority for setup/configuration. ADR-0003 accepted. Full integrator
reference: `doc/arch/sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/reserved-catalog-v1.md`

- **Sole management path:** typed operator commands via Feature 007 registry + dispatcher + thin adapters (TUI Settings/palette/native slash, CLI opencode op, loopback HTTP/SDK). Reuse Config Service and EventV2 — no parallel config or event store.
- **Never authority:** Config command / custom templates, session command prompt path, ToolRegistry admin tools, MCP tools/prompts, plugins, skills, LLM/shell free-form setup. Do not create LLM, custom, MCP, or plugin management authority.
- **Future domain features (001–006, 008, …):** own domain schemas and business logic; register ports + adapters into the operator composition root under `packages/opencode/src/operator/`. Add reserved IDs only by additive bumps to `packages/core/src/operator/catalog.ts`. Surface aliases come from generateAliases only — never hand-fork slash/CLI/palette names or duplicate ID lists in the SDK.
- **Reserved catalog v1:** import listReservedIds / RESERVED_CATALOG_VERSION from packages/core/src/operator (core package export). Collisions fail closed (reserved_name). Legacy admin-like names: one-release warn, reject new — see feature migration note.
- **Flag:** experimental operator control plane (default off); sandbox OPENCODE_DEV_OPERATOR env. Dynamic resolve per dispatch — do not hardcode featureEnabled true in live stack.
- **Phase 1 surfaces only:** core + TUI + CLI + loopback API/SDK. App/Desktop (T090–T091) and multi-user/vault/non-loopback (T092) are Phase 2, not Phase 1 incomplete work.
- **Isolation:** Feature 007 local work uses `scripts/dev/opencode-operator-sandbox`, port 14096, `.dev/` only — never production user config dir, port 4096, service register, or real OAuth 19876.

## Spec Kit on `fcustom`

- On branch `fcustom`, the installed `speckit` library is the source of truth for requirements, decisions, and execution changes. `doc/arch` is the project source of truth; run `speckit status` and `speckit next` before changing anything.
- Respect the active feature and the guard. Follow `specify → clarify` (when needed) → `plan → tasks → analyze → implement → validate`, and use incremental validation plus the repository hook.
- When a decision or acceptance criterion changes, update the affected artifact and record the changed decision. Preserve upstream/project behavior unless the artifacts document an intentional divergence.
- Do not implement Smart Routing while alternatives remain open and without explicit authorization. Do not edit `doc/.specify/` databases by hand or bypass the guard; require official validation before completion.

### Versioned commit hook

Run `make install-hooks` once per clone to set the local-only core hooksPath to
`.husky`; the target is idempotent and does not change global Git configuration.
On `fcustom`, `.husky/pre-commit` runs `git diff --cached --check` and the
official `speckit validate --json` in both HEAD and a disposable worktree with
only the staged patch applied. It compares deterministic finding identities
(artifact, rule, message, heading, line span, and severity), so pre-existing
findings in an edited file do not block while newly introduced findings do.
The hook does not run on other branches. A missing Speckit or Bun executable is
an explicit failure, never an automatic bypass.
