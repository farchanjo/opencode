# Operations Guide

How OpenCode is operated day-to-day: environments, deploy gates, operator
sandbox isolation, incident response, and rollback. Keep this aligned with
[deploy runbook](../runbooks/deploy.md), Feature 007
[quickstart](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/quickstart.md),
and [service-level objectives](../slo/service-level-objectives.md).

## Environments

| Environment | Purpose                                              | Config / bind                                      | Notes |
| ----------- | ---------------------------------------------------- | -------------------------------------------------- | ----- |
| production  | shippable user install                               | real user config dir; loopback serve default 4096  | never use sandbox env vars |
| sandbox     | Feature 007 local operator work                      | `.dev/opencode-operator/`; bind `127.0.0.1:14096`  | wrapper only; no OS service register |
| CI          | package typecheck and tests under package directories | ephemeral TMPDIR / pure mode as required           | no production config writes |

## Deploy

Release and enablement follow the standing deploy workflow:

1. Integrate shippable work on the durable release line (project default branch
   policy); keep history clean of merged topic branches after ship.
2. Version bump and annotated tag when the project tracks version in source.
3. Build release binaries for macOS and Linux when a multi-platform binary
   release is expected; attach artifacts (and checksums when the project already
   produces them).
4. Gate with `speckit validate` green and package-level `bun typecheck` /
   `bun test` for touched packages (never bare `tsc` or tests from repo root).

Operator control plane enablement is a **native flag path** only
(`opencode op flag enable|disable`), never LLM admin tools. Full step lists live
in [deploy.md](../runbooks/deploy.md).

## Operator sandbox

Feature 007 isolation harness is mandatory for control-plane development:

- Wrapper: `./scripts/dev/opencode-operator-sandbox`
- Port **14096** loopback only — never production **4096**, never OAuth **19876**
- Tree under `.dev/opencode-operator/` only (XDG/HOME/TMPDIR overrides)
- Env: `OPENCODE_DEV_OPERATOR_=1`; never write `~/.config/opencode`
- Refuse `serve --register` / OS service registration under the harness
- Proof: isolation tests under `packages/opencode/test/dev/sandbox/**`

Example:

```bash
./scripts/dev/opencode-operator-sandbox -- opencode op flag show --json
./scripts/dev/opencode-operator-sandbox -- opencode op langlock status --json
```

## On-call and incident response

Phase 1 is local single-user / loopback. There is no multi-tenant on-call roster
(deferred with T092). Operator response still follows structured outcomes:

| Signal                         | First action                                              |
| ------------------------------ | --------------------------------------------------------- |
| `audit_pending` (HTTP 202)     | CAS committed; wait or reconcile outbox — do not re-apply |
| `conflict` (409)               | re-read version; retry with fresh CAS                     |
| `unavailable` (503)            | check flag, offline mode, backend, scan budget            |
| `confirmation_required`        | confirm on CLI/TUI; never auto-yes on slash               |
| loopback bind / port collision | confirm bind is `127.0.0.1`; sandbox uses 14096           |

Secrets never appear in logs, slash/CLI output, or OTEL labels. Audit detail
lives in EventV2 (90-day retention), not free-form log bodies.

## Rollback

| Surface                    | Procedure                                                                 |
| -------------------------- | ------------------------------------------------------------------------- |
| Operator flag              | `opencode op flag disable --yes` (or env force-off for ops only)          |
| Config snapshot            | operator rollback / snapshot restore within 10 snapshots or 30 days       |
| Semantic embedding cutover | `semantic.embedding.rollback` / generation rollback after failed cutover  |
| Release binary             | reinstall previous tag artifacts; do not leave partial multi-platform ship |

## Ownership

- Control plane / reserved catalog: Feature 007 owners; catalog SSOT
  `@opencode-ai/core/operator`.
- Domain adapters (routing, jobs, semantic, MCP, …): owning feature teams
  register ports into the operator composition root only.
- Telemetry: operator OTEL content-free labels — see
  [observability](../observability/observability.md).

## Environment Variables

| Variable | Purpose |
| -------- | ------- |
| `OPENCODE_DEV_OPERATOR_` / sandbox wrapper | Forces operator isolation under `.dev/`; never production config |
| `OPENCODE_CONFIG_DIR` | Profile config root (e.g. `~/.opencodedev`) when not using default |
| `OPENCODE_OPERATOR_CONTROL_PLANE` | Optional force-on for the control plane flag path |
| `OPENCODE_SEMANTIC_MILVUS_*` | Semantic index address / insecure / project scope for data plane |
| `OPENCODE_NATIVE_LIB_DIR` | Co-located native dylibs for production-like binaries |

Unset or production defaults must never point sandbox work at the user production
config directory.

## Exit Codes

| Code | Meaning (operator CLI / package tools) |
| ---- | -------------------------------------- |
| 0 | Success; structured `--json` result valid when requested |
| non-zero | Failure; prefer typed outcomes (`conflict`, `unavailable`, `confirmation_required`) over opaque stack dumps |
| HTTP 202 | `audit_pending` — CAS durable, audit outbox still reconciling |
| HTTP 409 | CAS conflict — re-read version and retry |

CLI and loopback map the same effective outcomes; never invent a second exit
vocabulary per surface.

## Phase 2 note

App/Desktop operator chrome and multi-user / non-loopback API operations are
deferred (T090–T092). Phase 1 operations do not claim those surfaces.
