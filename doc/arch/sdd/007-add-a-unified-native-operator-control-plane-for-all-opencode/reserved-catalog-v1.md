# Reserved Operator Catalog v1 (Feature 007 / T048)

**Catalog version:** `1.0.0` (`RESERVED_CATALOG_VERSION` in `@opencode-ai/core/operator`)  
**SSOT:** `packages/core/src/operator/catalog.ts` — **never** hand-copy divergent ID lists into SDK, docs, plugins, or clients.  
**ID count (v1.0.0):** 114 reserved command IDs across 12 domains.

Related:

- [spec.md](spec.md) · [plan.md](plan.md) · [contracts/command-envelope.md](contracts/command-envelope.md)
- [migration-legacy-admin-names.md](migration-legacy-admin-names.md) · [quickstart.md](quickstart.md)
- [ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)

## Authority model (integrator rules)

| Layer                               | Owns                                                                                                                                                | Must not                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Feature 007**                     | OperatorCommandRegistry, dispatcher, principal/scope, CAS, idempotency, audit, SecretPort, reserved catalog, thin adapters (CLI/TUI/slash/HTTP/SDK) | Domain business outcomes; LLM/tool/MCP/plugin admin authority                                            |
| **Domain features (001–006, 008)**  | Domain schemas + real services; register **ports/adapters** into the control plane composition root                                                 | Create parallel admin registries, LLM tools for setup, custom slash authority, MCP admin as ToolRegistry |
| **Plugins / MCP / custom commands** | Runtime data-plane tools under Permission                                                                                                           | Register reserved IDs, `/op.*`, or legacy admin-like names as new authority                              |

**Never authority for management:** Config.command / custom templates, `session.command` prompt path, ToolRegistry admin, MCP tools/prompts, plugins, skills, shell issued by an LLM, free-form model instructions.

Future domains **must**:

1. Add or reuse dotted IDs only via an additive catalog version bump in `catalog.ts`.
2. Implement a domain **port** interface under `packages/opencode/src/operator/application/ports/`.
3. Wire a real adapter **or** a deterministic stub (`not_implemented` / `unavailable`) in the composition root (`packages/opencode/src/operator/main.ts` / stack).
4. Never invent CLI/slash/palette names outside `generateAliases(id)`.

## Domains (v1)

`telemetry` · `smart` · `routing` · `budget` · `pools` · `process` · `task` · `jobs` · `langlock` · `output` · `semantic` · `mcp`

Semantic and MCP ID sets are **exhaustive** (no open set). Other domains may grow only with an additive catalog semver bump and registry tests.

## Surface aliases (registry-generated)

Canonical ID is dotted. Aliases are **derived**, not independently authored:

| Surface        | Rule                           | Example for `langlock.status`    |
| -------------- | ------------------------------ | -------------------------------- |
| Slash (native) | `/op.{id}`                     | `/op.langlock.status`            |
| CLI            | `opencode op <segments…>`      | `opencode op langlock status`    |
| Palette        | same as dotted id              | `langlock.status`                |
| Settings       | same command id via registry   | Settings panel → `langlock.*`    |
| HTTP / SDK     | `id` field on command envelope | `{ "id": "langlock.status", … }` |

Implementation: `generateAliases` in `packages/core/src/operator/reserved-aliases.ts`. Clients **must not** hardcode divergent admin names.

## SDK / export parity

| Export                                                              | Location                                                       | Rule                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `RESERVED_CATALOG_VERSION`, `listReservedIds()`, `RESERVED_CATALOG` | `@opencode-ai/core/operator`                                   | **Only** ID list SSOT                                                 |
| SDK note                                                            | `@opencode-ai/sdk` → `packages/sdk/js/src/operator/catalog.ts` | Re-exports module pointer; **no** duplicated ID strings               |
| HTTP                                                                | `GET /operator/v1/registry`                                    | Returns `catalogVersion` / `reservedCatalogVersion` + `ids` from core |
| Dry-run migration                                                   | `opencode op migrate dry-run …`                                | Report includes `catalogVersion`                                      |

```ts
import { RESERVED_CATALOG_VERSION, listReservedIds, isReservedCommandId } from "@opencode-ai/core/operator"

// RESERVED_CATALOG_VERSION === "1.0.0"
// listReservedIds().length === 114 (v1.0.0)
```

If docs and runtime disagree, **runtime catalog wins**; fix docs, do not fork IDs.

## Feature flag `operator_control_plane` (T041)

Single resolver (`resolveOperatorControlPlaneFlag`). Precedence **highest → lowest**:

1. Sandbox: `OPENCODE_DEV_OPERATOR_=1` → enabled (`source: sandbox`)
2. Env: `OPENCODE_OPERATOR_CONTROL_PLANE=0|1|true|false` when explicitly set
3. Config: `experimental.operator_control_plane` via Config.Service
4. Default: **OFF** (`source: default_off`) — migration safety

`OPENCODE_OPERATOR_HTTP` is **not** an enable flag.

When flag is OFF:

- Operator adapters no-op / return structured `unavailable`.
- Reserved `/op.*` still **intercepts** and never falls through to the LLM prompt.

Enable / disable (native, non-LLM):

```bash
opencode op flag show
opencode op flag enable --yes
opencode op flag disable --yes
```

## Principals and scopes (RBAC V1)

**Principals** (closed): `operator` | `system` | `manager-view`

| Kind           | Mutate             | Notes                 |
| -------------- | ------------------ | --------------------- |
| `operator`     | yes                | Local single-user V1  |
| `system`       | yes                | Internal/system paths |
| `manager-view` | **no** (read-only) | Optional RO view      |

LLM / tool / MCP / plugin are **never** principals.

**Scopes** (closed): `global` | `project` | `session` | `root-tree`

- Project-bound principal: cannot use `global`; `project` ref must match binding; `session` / `root-tree` require matching project context (**fail-closed** if missing).
- Multi-user RBAC / vault / non-loopback API: **Phase 2** (T092), not Phase 1.

Descriptor `scopesAllowed` is catalog metadata; dispatcher enforces principal + descriptor + binding.

## Confirmation, CAS, rollback

**Confirm leaves** (always): `cutover`, `rollback`, `delete`, `disable`, `purge`, `rotate-secret`, `export`, `share`, plus trailing `experimental.enable`.

| Source                       | Auto-yes                                      |
| ---------------------------- | --------------------------------------------- |
| slash / palette / settings   | **never**                                     |
| cli                          | `--yes` only when **non-TTY** + authenticated |
| api / system / app / desktop | explicit `confirm: true`                      |

Mutations: operator principal, allowed scope, schema validation, confirmation gate, CAS, idempotency key, audit.

**Snapshots:** max **10** or **30 days**. Cutover keeps a rollback slot (`semantic.embedding.rollback` / `semantic.reranker.rollback`). Select/reindex alone never activate live binding.

## Offline matrix (T044)

Connectivity resolution:

1. `OPENCODE_CONNECTIVITY=offline|online`
2. `OPENCODE_OFFLINE=1|true`
3. Config `experimental.offline === true`
4. Default **online**

When offline, commands with `offlineCapable: false` return `unavailable` **before** network handlers. Catalog invariant: `status` / `show` / `list` leaves must be offline-capable.

## SSRF / DNS (T045)

`validateOperatorUrl` (and related helpers in `packages/core/src/operator/ssrf.ts`):

- Parse → resolve DNS → **revalidate** addresses; port validated before accept.
- Profiles: `remote` (deny private/loopback/metadata) vs `local` (allow local ranges for local providers).
- IPv6-mapped IPv4 covered; metadata hostnames denied.
- Production DNS: `createProductionDnsResolver` (`dns.ts`) — **fail-closed** on lookup error / empty results (deny).
- Unit tests inject resolvers; no real DNS required in suites.

## Secrets / keychain (T018–T021)

| Backend    | Use                                                     |
| ---------- | ------------------------------------------------------- |
| `keychain` | OS keychain (Darwin Security FFI adapter in production) |
| `env-ref`  | CI only                                                 |

- Config stores **SecretRef** only (`backend`, `name`, `version`) — no plaintext.
- Plaintext secret fields rejected by bounded recursive scanner.
- **Tests:** mock FFI / memory backends only — **never** real SecKeychain in automated tests (T019).
- Keychain failures surface as `secret_backend` (retryable where appropriate).

## EventV2 audit (T022–T024)

- Audit projects to **EventV2 only** (no parallel event store). Fields: source, actorRef, scope, commandId, before/after version, outcome, createdAtMs — **secret-free**.
- Retention: **90 days** (`AUDIT_RETENTION_DAYS`).
- Outbox: durable intent written **atomically with Config CAS** (same document/Flock). External-only outbox publish.
- Reconcile leases pending intents → EventV2.
- **Bounded list** of audit history: hard scan limit; if budget exhausted before page fill → **fail-closed** `unavailable` (not partial silent page).
- Outcome `audit_pending`: CAS committed, audit publish deferred (HTTP/CLI map **202**). Distinct from `conflict` / `unavailable` / `confirmation_required`.

## Error taxonomy (closed)

| Code                    | HTTP | Meaning                                                                    |
| ----------------------- | ---- | -------------------------------------------------------------------------- |
| `unauthorized`          | 401  | Missing/invalid operator principal                                         |
| `forbidden_scope`       | 403  | Scope not allowed / cross-project                                          |
| `conflict`              | 409  | CAS version mismatch                                                       |
| `idempotent_replay`     | 200  | Same key returns prior success body                                        |
| `invalid_argument`      | 400  | Schema/payload failure                                                     |
| `reserved_name`         | 409  | Collision with reserved operator ID                                        |
| `confirmation_required` | 400  | Listed mutation without confirm                                            |
| `unavailable`           | 503  | Flag off, offline matrix, domain/backend missing, bounded scan fail-closed |
| `secret_backend`        | 503  | Keychain/env-ref failure                                                   |
| `transport_error`       | 502  | Transport failure                                                          |
| `not_implemented`       | 501  | Domain port stub only                                                      |

Outcomes may also include `success`, `idempotent_replay`, `audit_pending`.

## Migration dry-run and one-release warning (T043)

Policy: `warn_existing_reject_new` · `autoRename: false` · `autoDelete: false`.

```bash
opencode op migrate dry-run admin settings-admin my-notes langlock.status --json
```

| Class                                                   | Existing             | New    |
| ------------------------------------------------------- | -------------------- | ------ |
| Reserved catalog / `/op.*`                              | Reject / fail load   | Reject |
| Legacy admin-like (narrow list + `*-admin` / `*.admin`) | **Warn one release** | Reject |
| Clean                                                   | Keep                 | Allow  |

See [migration-legacy-admin-names.md](migration-legacy-admin-names.md).

## Phase 2 deferred (not Phase 1 incomplete work)

| Task     | Scope                                 | Why deferred (not Phase 1 incomplete)                      |
| -------- | ------------------------------------- | ---------------------------------------------------------- |
| **T090** | App Settings parity                   | Phase 1 surfaces: core + TUI + CLI + loopback API/SDK only |
| **T091** | Desktop Settings parity               | Depends on T090; separate delivery                         |
| **T092** | Multi-user / vault / non-loopback API | Requires new ADR; V1 is local single-user + loopback       |

These are **explicit Phase 2 backlog**, not open Phase 1 defects. Do not mark Phase 1 incomplete for App/Desktop/remote multi-user.

## OTEL (T046)

Allowed label keys only: `command_id`, `domain`, `surface`, `scope_kind`, `outcome`, `error_code`, `duration_ms`, `retry`.  
Forbidden: args, payload, path, secret, project ids, user text.

## Catalog ID inventory (v1.0.0)

Full list is `listReservedIds()` at runtime. Groups:

- **telemetry.** `status` `show` `on` `off` `configure` `test`
- **smart.** `status` `on` `off` `auto`
- **routing.** `status` `configure` `test`
- **budget.** `status` `show` `set` `reset` `validate`
- **pools.** `status` `show` `set` `reset` `validate`
- **process.** `status` `list` `pause` `resume` `kill` · `process.workspace.status`
- **task.** `status` `list` `cancel`
- **jobs.** `list` `status` `create` `update` `enable` `disable` `delete` `run-now`
- **langlock.** `status` `show` `set` `reset`
- **output.** `stat` `read` `follow` `export` `share` `release` `delete` `purge` `retention.set` `quota.set`
- **semantic.** provider/model/embedding/reranker/binding/index ops (exhaustive per research)
- **mcp.** server/auth/resource.admin/logging/experimental/extension ops (exhaustive per Feature 008 schemas)

When adding IDs: bump catalog version (additive), update registry tests, re-export via core only — **do not** paste a second list into the SDK.
