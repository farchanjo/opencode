# Deploy & Operator Runbook — OpenCode

Operational procedures for validating, enabling, and rolling back the Feature 007
Operator Control Plane and for cutting a release from a clean checkout. Follow
steps in order; never skip verification.

Feature-local sandbox detail:
[quickstart](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/quickstart.md).

## Purpose

1. Build, validate, and release OpenCode safely.
2. Enable or disable `operator_control_plane` without LLM admin paths.
3. Recover from CAS/audit/secret failures without inventing dual stores.

## Trigger

Run this procedure when:

- A release is scheduled or a release tag is requested.
- Operator control plane is enabled for a host for the first time.
- Isolation harness work must prove production paths are unchanged.
- Rollback of a semantic cutover or flag is required after an incident.

## Preconditions

- Working tree clean on the intended commit (release) or Feature 007 sandbox env set.
- Tooling: `bun`, `make`, `git`, `speckit`.
- For Feature 007 local work: use `./scripts/dev/opencode-operator-sandbox` only
  (port **14096**, `.dev/opencode-operator/`, no `~/.config/opencode`, no service
  register, no OAuth **19876**, no prod port **4096**).

## Steps — release gate

1. Sync: `git fetch --all` and check out the release commit.
2. Validate specs: `speckit validate` — must exit `0`.
3. Package typecheck/tests for touched packages (from package dirs, not repo root
   for `bun test`).
4. Build: `make build` (or project-equivalent).
5. Full gate: `make check` when wired.

## Steps — enable operator control plane (Phase 1)

1. Confirm flag default off: `opencode op flag show --json`.
2. Enable via native path (writes Config.Service):
   `opencode op flag enable --yes` (non-TTY) or interactive equivalent.
3. Optional env override for ops only: `OPENCODE_OPERATOR_CONTROL_PLANE=1`
   (not `OPENCODE_OPERATOR_HTTP`).
4. Smoke: `opencode op langlock status --json` and
   `opencode op telemetry status --json`.
5. Loopback only: serve on `127.0.0.1` per server policy; sandbox uses **14096**.
6. Migration dry-run for plugins/custom names:
   `opencode op migrate dry-run <names…> --json` — one-release warn for legacy
   admin-like; reject reserved collisions (no auto-rename).

## Steps — isolation harness (developers)

1. `./scripts/dev/opencode-operator-sandbox -- opencode op flag show --json`
2. Confirm XDG/HOME/TMPDIR under `.dev/opencode-operator/`.
3. Confirm listener would be `127.0.0.1:14096` only.
4. Run package operator/sandbox tests under package directories.

## Verification

- `speckit validate` exits `0`.
- Flag resolution: sandbox → env → `experimental.operator_control_plane` → default off.
- Reserved `/op.*` intercepts even when flag is off (never LLM fall-through).
- Mutations produce secret-free EventV2 audit (or `audit_pending` + durable outbox).
- No harness writes under real `~/.config/opencode`.
- Keychain automated tests use mocks only (no real SecKeychain).
- Bounded audit history scan fails closed on budget exhaustion (`unavailable`).

## Troubleshooting (operator outcomes)

| Outcome / code          | Meaning                                             | Operator action                             |
| ----------------------- | --------------------------------------------------- | ------------------------------------------- |
| `audit_pending` (202)   | CAS committed; audit not yet published              | Wait/reconcile; do not re-apply blindly     |
| `conflict` (409)        | CAS mismatch                                        | Re-read version; retry                      |
| `unavailable` (503)     | Flag off, offline, stub domain, or scan fail-closed | Check flag/offline/backend                  |
| `confirmation_required` | Destructive op without confirm                      | Confirm interactively; never slash auto-yes |
| `secret_backend`        | Keychain/env-ref failure                            | Restore backend; rotate via SecretRef only  |
| `reserved_name`         | Collision with catalog                              | Rename plugin/custom; dry-run migrate       |

## Rollback

1. **Flag:** `opencode op flag disable --yes` — adapters return unavailable; reserved
   slash still intercepts (no LLM admin).
2. **Semantic cutover:** `opencode op semantic embedding rollback` /
   `semantic.reranker.rollback` with confirmation.
3. **Config snapshots:** restore via snapshot retention (≤10 or ≤30 days) through
   ConfigPort/CAS only.
4. **Release:** stop publishing; check out previous known-good tag; re-run
   `speckit validate` / `make check`.
5. **Harness:** delete `.dev/opencode-operator/` (gitignored).

Never roll back by creating a parallel config/event store or by granting LLM/MCP
plugin management authority.

## Phase 2 out of scope for this runbook

App Settings (T090), Desktop Settings (T091), and multi-user/vault/non-loopback
public API (T092) are **deferred Phase 2** — not incomplete Phase 1 deploy steps.
