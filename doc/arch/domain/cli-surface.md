# CLI and Native Surface Map

How OpenCode exposes the operator control plane and related domain commands on
CLI and TUI. Management authority is Feature 007 only — typed registry commands,
never LLM tools, MCP admin tools, plugins, or free-form setup prompts.

Deep catalog: [reserved-catalog-v1.md](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/reserved-catalog-v1.md).
IDs are SSOT from `@opencode-ai/core/operator` (`listReservedIds()`,
`RESERVED_CATALOG_VERSION`).

## Surfaces

| Surface   | Entry                                        | Phase 1 role                                      |
| --------- | -------------------------------------------- | ------------------------------------------------- |
| CLI       | `opencode op <domain> <verb> …`              | primary scripted operator surface; `--json`, `--yes` |
| TUI slash | `/op.<domain>.…` (native intercept)          | pre-prompt intercept; zero tokens by default        |
| TUI palette / Settings | registry-driven palette entries     | same command ids as CLI/API                         |
| Loopback API / SDK | `GET /operator/v1/*`, `POST /operator/v1/commands` | local HTTP; principal + scope auth           |
| App / Desktop | deferred                                 | Phase 2 (T090–T091)                                 |

Surface aliases come from `generateAliases` only — never hand-fork slash/CLI/
palette names or duplicate ID lists in the SDK.

## CLI: `opencode op`

```bash
opencode op flag show --json
opencode op flag enable --yes
opencode op langlock status --json
opencode op telemetry status --json
opencode op telemetry test --json
# Domain examples (when adapters registered):
opencode op semantic index reindex --json
opencode op jobs list --json
opencode op migrate dry-run <legacy-names…> --json
```

| Convention        | Rule                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| Flag              | `experimental.operator_control_plane` default off; dynamic per dispatch |
| `--json`          | machine-readable structured result; no secrets                       |
| `--yes`           | non-TTY confirmation for destructive ops; never implied on slash     |
| Reserved intercept| `/op.*` and reserved CLI names never fall through to the LLM         |
| Zero LLM admin    | offline-capable status/query paths make zero provider calls          |
| Sandbox           | `./scripts/dev/opencode-operator-sandbox -- opencode op …`           |

## TUI slash

| Rule                 | Behavior                                                              |
| -------------------- | --------------------------------------------------------------------- |
| Pre-prompt intercept | reserved `/op.*` handled before session prompt admission              |
| Confirmation         | destructive ops require explicit confirm; no slash auto-`--yes`       |
| Output               | redacted structured outcomes; secrets never printed                   |
| Flag off             | intercept still blocks reserved names (no LLM admin fall-through)     |
| Parity               | same command id → same CAS / version / audit outcome as CLI and API   |

## Domain command groups (v1 conceptual)

| Domain     | Example ids / verbs                                      | Notes |
| ---------- | -------------------------------------------------------- | ----- |
| flag       | show, enable, disable                                    | control plane gate |
| telemetry  | status, test                                             | OTEL; test signal never an LLM call |
| langlock   | status, …                                                | offline-capable |
| routing / smart / budget / pools | configure, status, …                    | Feature 001 surfaces via 007 |
| jobs       | list, …                                                  | Feature 003 |
| semantic   | model register, embedding select, index reindex, cutover, rollback | Feature 006/050 |
| mcp        | server/admin verbs                                       | Feature 008; no MCP tools as admin authority |
| migrate    | dry-run                                                  | legacy admin-name one-release warn |

Full closed ID set: core package export — do not copy lists into docs as SSOT.

## Non-authority (forbidden management paths)

- `Config.command` / custom templates as admin authority
- Session prompt path for setup (`session.command`)
- ToolRegistry admin tools, MCP tools/prompts, plugins, skills as management
- Free-form LLM or shell setup that mutates operator config

## Acceptance linkage

| Check                         | Evidence / quality row                                      |
| ----------------------------- | ----------------------------------------------------------- |
| Surface parity                | QS-01 functional-suitability                                |
| Zero LLM admin                | QS-02; SLO-04                                               |
| Catalog SSOT                  | QS-03 compatibility                                         |
| Sandbox isolation             | QS-08; SLO-06; operator sandbox in operations.md            |
| Unauthorized loopback reject  | QS-06 security                                              |

## Stable Exit Codes

| Code | Meaning |
| ---- | ------- |
| 0 | Success; with `--json`, stdout is a single structured object |
| non-zero | Failure; prefer typed reason codes over free-form stderr only |
| HTTP 202 | `audit_pending` after durable CAS |
| HTTP 409 | CAS version conflict |

Exit codes are shared across CLI and loopback mapping of the same command id —
never a per-surface private vocabulary for reserved catalog commands.

## --json Contract

- When `--json` is set, stdout is **one** JSON object (no mixed human banners).
- Bodies are **secret-free**: no API keys, tokens, absolute home paths for
  secrets, or full prompt/transcript content on admin paths.
- Success and typed failure both use structured fields (`ok`, outcome codes,
  `version` / `auditId` when applicable).
- Human mode may print tables; machine mode never requires a TTY.

## Phase 2 note

App/Desktop operator UI parity and multi-user remote CLI/API are deferred
(T090–T092). Phase 1 claims only CLI, TUI slash/palette/Settings, and loopback.
