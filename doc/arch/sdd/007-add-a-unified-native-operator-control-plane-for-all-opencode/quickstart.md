# Quickstart & Runbook: Feature 007 Operator Control Plane

Documentary guide for local Feature 007 work and operator operations.  
**No production config or processes from the isolation harness.**

Deep reference: [reserved-catalog-v1.md](reserved-catalog-v1.md) · [migration-legacy-admin-names.md](migration-legacy-admin-names.md) · [contracts/command-envelope.md](contracts/command-envelope.md)

## Rules

1. Never write to `~/.config/opencode` from Feature 007 harness.
2. Never register OS services, real OAuth clients, or non-loopback listeners in V1 harness.
3. All OpenCode invocations for this feature use the sandbox wrapper (or equivalent env).
4. Default port: **14096** (loopback only). Never **4096** (prod), **19876** (OAuth).
5. Never `serve --register` / `service *` under the harness.
6. Catalog SSOT is `@opencode-ai/core/operator` — no divergent generated ID lists.

## Layout

```
.dev/                            # gitignored (entire tree)
.dev/opencode-operator/          # sandbox root
  config/                        # XDG_CONFIG_HOME + OPENCODE_CONFIG_DIR
  data/                          # XDG_DATA_HOME
  cache/                         # XDG_CACHE_HOME
  state/                         # XDG_STATE_HOME
  tmp/                           # TMPDIR
  home/                          # HOME + OPENCODE_TEST_HOME
  managed/                       # OPENCODE_TEST_MANAGED_CONFIG_DIR
  logs/                          # wrapper logs (no secrets)
scripts/dev/opencode-operator-sandbox
packages/opencode/src/dev/sandbox/   # constants, env builder, guards
packages/opencode/test/dev/sandbox/  # proof tests
```

## Environment (XDG / HOME / TMPDIR)

Export **before** any Bun/core import (the wrapper does this):

```bash
export OPENCODE_DEV_OPERATOR_=1
export OPENCODE_CONFIG_DIR="$PWD/.dev/opencode-operator/config"
export OPENCODE_OPERATOR_PORT=14096
export OPENCODE_OPERATOR_BIND=127.0.0.1
export XDG_CONFIG_HOME="$PWD/.dev/opencode-operator/config"
export XDG_DATA_HOME="$PWD/.dev/opencode-operator/data"
export XDG_CACHE_HOME="$PWD/.dev/opencode-operator/cache"
export XDG_STATE_HOME="$PWD/.dev/opencode-operator/state"
export TMPDIR="$PWD/.dev/opencode-operator/tmp"
export HOME="$PWD/.dev/opencode-operator/home"
export OPENCODE_TEST_HOME="$PWD/.dev/opencode-operator/home"
export OPENCODE_TEST_MANAGED_CONFIG_DIR="$PWD/.dev/opencode-operator/managed"
export OPENCODE_DISABLE_MODELS_FETCH=1
export OPENCODE_PURE=1
```

Safe defaults also disable auto-update/autocompact. Bun is resolved **before**
HOME isolation so the executable stays on the trusted PATH.

## Sandbox wrapper

```bash
./scripts/dev/opencode-operator-sandbox -- opencode op langlock status --json
./scripts/dev/opencode-operator-sandbox -- opencode serve   # binds 127.0.0.1:14096 only
```

Wrapper MUST:

- Create the sandbox layout under `.dev/opencode-operator/`
- Set sandbox env vars before any Bun/core import
- Resolve Bun on the trusted PATH before changing `HOME`
- Exec local `packages/opencode/src/index.ts` only (never global `opencode`)
- Refuse non-loopback bind
- Refuse if `OPENCODE_CONFIG_DIR` resolves under real `$HOME/.config/opencode`
- Refuse `service *`, `serve --register`, port **4096**, real OAuth / port **19876**
- Default serve to `127.0.0.1:14096`
- Log resolved paths to `.dev/opencode-operator/logs/` (no secrets env file)

## Feature flag enable / disable

Flag id: `operator_control_plane` · config key: `experimental.operator_control_plane`  
Default **OFF**. Sandbox sets `OPENCODE_DEV_OPERATOR_=1` → enabled for harness.

```bash
# Prefer native flag commands (writes Config.Service)
./scripts/dev/opencode-operator-sandbox -- opencode op flag show --json
./scripts/dev/opencode-operator-sandbox -- opencode op flag enable --yes
./scripts/dev/opencode-operator-sandbox -- opencode op flag disable --yes

# Optional env override (dev/ops only; not OPENCODE_OPERATOR_HTTP)
export OPENCODE_OPERATOR_CONTROL_PLANE=1   # force on
export OPENCODE_OPERATOR_CONTROL_PLANE=0   # force off
```

Precedence: sandbox → env → config → default off. Flag is **dynamic** (resolved per dispatch from live config/env, not a process-lifetime hardcode).

## Phase 1 surfaces

| Surface    | Example                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| CLI        | `sandbox -- opencode op telemetry status --json`                                       |
| CLI mutate | `sandbox -- opencode op langlock set --payload '{"language":"en-US"}' --yes` (non-TTY) |
| Slash      | `/op.telemetry.status` in TUI under sandbox (never auto-yes)                           |
| Palette    | entry `telemetry.status` from registry                                                 |
| Settings   | TUI Settings panels for representative domains                                         |
| API        | `POST http://127.0.0.1:14096/operator/v1/commands`                                     |
| Registry   | `GET http://127.0.0.1:14096/operator/v1/registry`                                      |
| Health     | `GET http://127.0.0.1:14096/operator/v1/health`                                        |
| SDK        | `createOperatorClient({ baseUrl: "http://127.0.0.1:14096" })`                          |

JSON envelope: see [contracts/command-envelope.md](contracts/command-envelope.md).

### CLI examples

```bash
SB=./scripts/dev/opencode-operator-sandbox

$SB -- opencode op flag show --json
$SB -- opencode op langlock status --json
$SB -- opencode op telemetry status --json
$SB -- opencode op semantic binding status --json
$SB -- opencode op mcp server list --json
$SB -- opencode op migrate dry-run admin settings-admin my-notes --json

# Destructive / confirm leaves: interactive confirm in TTY; --yes only non-TTY
$SB -- opencode op semantic embedding rollback --yes --json
```

### TUI / Settings

1. Start sandbox TUI: `$SB -- opencode` (or package `bun dev` only with sandbox env).
2. Slash: type `/op.` — reserved IDs complete from registry; intercept is pre-prompt (zero LLM tokens).
3. Palette: search dotted id (e.g. `langlock.status`).
4. Settings: open Operator / domain panels; same command IDs as CLI/API.
5. Confirmations for cutover/rollback/delete/… are interactive; slash never auto-yes.

## Troubleshooting

| Symptom                           | Likely cause                                  | Action                                                                  |
| --------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `unavailable` + flag message      | `operator_control_plane` off                  | `op flag enable --yes` or sandbox env                                   |
| `unavailable` offline             | Command has `offlineCapable=false`            | Go online or use status/show/list                                       |
| `unavailable` domain              | Domain port stub / not wired                  | Expected until domain feature lands (`not_implemented` may also appear) |
| `unavailable` audit list          | Bounded EventV2 scan fail-closed (T024)       | Narrow query; check EventV2 backend health                              |
| `audit_pending` (exit/HTTP 202)   | CAS committed; audit outbox not yet published | State is durable; reconcile will publish; **not** a failed mutation     |
| `conflict` (409)                  | CAS version mismatch                          | Re-read version; retry with current CAS token                           |
| `confirmation_required`           | Missing confirm on destructive op             | Pass confirm / interactive yes; never slash auto-yes                    |
| `forbidden_scope`                 | Project binding / wrong scope                 | Align scope.ref with principal.projectBinding                           |
| `unauthorized`                    | No operator principal on API                  | Bind operator principal (loopback auth)                                 |
| `reserved_name`                   | Plugin/MCP/custom tried reserved id           | Rename; dry-run migrate                                                 |
| `secret_backend`                  | Keychain/env-ref failure                      | Check backend availability; tests use mocks only                        |
| Bind / port refused by wrapper    | Non-loopback, 4096, or 19876                  | Use 127.0.0.1:14096 only                                                |
| Writes under `~/.config/opencode` | Not using sandbox                             | Fix env; re-run proof tests                                             |

### Outcome / exit map (CLI JSON)

| Outcome               | CLI exit (HTTP-equiv) | Notes                  |
| --------------------- | --------------------- | ---------------------- |
| success               | 0                     |                        |
| idempotent_replay     | 0                     | Prior success body     |
| audit_pending         | 202                   | CAS ok; audit deferred |
| conflict              | 409                   |                        |
| confirmation_required | 400                   |                        |
| unavailable           | 503                   |                        |
| not_implemented       | 501                   | Stub domain            |

## Rollback

1. **Semantic cutover:** `opencode op semantic embedding rollback` / `semantic.reranker.rollback` (confirm required).
2. **Config snapshots:** restore via snapshot retention (≤10 or ≤30 days) through ConfigPort/CAS — not manual dual-store edits.
3. **Feature flag:** `opencode op flag disable --yes` returns adapters to unavailable; reserved `/op.*` still intercepts (no LLM admin).
4. **Harness:** delete `.dev/opencode-operator/` (gitignored); production paths untouched.
5. **Do not** roll back by inventing parallel config/event stores or LLM tools.

## Isolation proof (S0)

1. Without wrapper: default config path resolution unchanged (prod path constants).
2. With wrapper: config reads/writes only under `.dev/opencode-operator/`.
3. Listener address is loopback:14096 only.
4. No files created under `~/.config/opencode` during suite.
5. Keychain unit tests: mock FFI only — never real SecKeychain.

## Out of Phase 1 / quickstart

- **App Settings** (T090) — Phase 2
- **Desktop Settings** (T091) — Phase 2
- **Multi-user / vault / non-loopback public API** (T092) — Phase 2 + new ADR
- Real OS service registration, production OAuth bind, remote URL exposure
