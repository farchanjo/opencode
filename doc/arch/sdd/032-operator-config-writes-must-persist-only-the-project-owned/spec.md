---
id: 019f812b-d996-7d53-8176-d32f2144008d
number: 032
slug: operator-config-writes-must-persist-only-the-project-owned
status: implemented
created_at: 2026-07-20T20:16:02.454874Z
---
# Feature Specification: Operator Config Writes Must Persist Only The Project Owned

Feature: 032-operator-config-writes-must-persist-only-the-project-owned
Created: 2026-07-20

## User Stories

- As a user who runs opencode with `OPENCODE_CONFIG_DIR` pointed at an isolated
  profile while my real global config at `~/.config/opencode` holds third-party
  `mcp`/`provider` entries with plaintext API keys, I want an operator mutation
  (e.g. `pools.set`, `routing.configure`) to persist ONLY the operator authority
  records it changes, so my base-layer secrets are never copied into a brand-new
  per-project profile `config.json`.
- As a security-conscious user, I want the per-project profile file to contain
  only what that file legitimately owns (the `operator` namespace plus any config
  I actually set in it), so inspecting it never reveals a snapshot of my base
  `mcp`/`provider`/`agent`/`command`/`mode`/`tools`/`permission`/`username` keys.
- As that same user, I want the layered read (Feature 030) to keep working — the
  base is still inherited and merged at load time — so stopping the DUPLICATION on
  write does not change which values are effective.
- As an operator, I want the CAS authority version and the mutation/idempotency/
  rollback protocol to be byte-for-byte unchanged, so this fix is invisible to the
  operator control plane except that the persisted file is now minimal.
- As a user who has NOT set `OPENCODE_CONFIG_DIR`, I want the default global
  `config.json` write path to behave exactly as before, so this correction is
  invisible to the non-profile case.

## Functional Requirements

1. **Persist only the project-owned namespace.** An operator write that targets a
   per-project profile file (`<configRoot>/profiles/<encoded-path>/config.json`)
   MUST serialize ONLY the `operator` namespace (authority records, idempotency,
   rollback, and the audit outbox) it owns. It MUST NOT serialize base/global keys
   inherited through the layered read — `mcp`, `provider`, `agent`, `command`,
   `mode`, `tools`, `permission`, `username`, `references`, or any other key not
   owned by that file.
2. **No secret leak.** No secret value carried by the inherited base layer (e.g. an
   `mcp` server auth header or a `provider` API key) MAY appear anywhere in a
   per-project profile file written by an operator mutation. This is the security
   guarantee this feature exists to enforce.
3. **Preserve project-owned keys already in the file.** Because the write seam
   (`Config.update`) deep-merges the persisted patch into the existing target file,
   any genuinely project-scoped keys the user already set in that file MUST be
   preserved; the fix only stops ADDING inherited base keys, it does not clobber
   pre-existing project-owned content.
4. **CAS/authority round-trip preserved.** The persisted operator document MUST
   round-trip through the operator read seam (`loadOperatorNamespace`) unchanged in
   meaning: the authority version written by a CAS commit MUST read back identical,
   and a subsequent mutation threading that version MUST succeed. The operator
   authority schema and the mutation/CAS/idempotency/rollback protocol MUST NOT
   change.
5. **Layered read unaffected.** At read time the base layer MUST still be inherited
   and deep-merged (Feature 030): the effective config after an operator write MUST
   still expose the base `mcp`/`provider` keys. The per-project profile file simply
   stops DUPLICATING them on disk.
6. **Global write path not regressed.** When `OPENCODE_CONFIG_DIR` is unset, the
   default global `config.json` write path MUST behave identically to before. The
   same over-broad serialization also affected the global operator write (it could
   copy the layered base into the profile's own global `config.json`); the fix MUST
   likewise scope the global operator write to the `operator` namespace so no base
   layer leaks into any operator-written file, while keeping global `config.json`
   semantics (sibling-key preservation, `changed` detection) intact.
7. **Self-describing persisted file.** A freshly created per-project profile file
   MUST be a valid opencode config document (carry `$schema`), not a bare
   `{ operator }` fragment.

## Security Requirements

- **Data sensitivity/classification.** The inherited base layer read by the
  operator store (via `Config.get()`, layered per Feature 030) can carry
  third-party `mcp`/`provider` entries with PLAINTEXT credentials — API keys, auth
  headers, tokens — the most sensitive material opencode handles. The per-project
  profile file legitimately owns only the `operator` authority records (routing
  bindings, pool bindings, langlock state, etc.), which are non-secret control-plane
  data. This feature narrows what the operator write persists from the full merged
  document down to that project-owned namespace.
- **The leak vector (root cause).** Pre-fix, the operator store's write path read
  the FULL effective (post-Feature-030 layered) config to compute the current
  authority state, then serialized that WHOLE merged document — including the
  inherited base `mcp`/`provider` secrets — into the per-project profile
  `config.json`. A single `pools.set` under a profile produced a ~28 KB plaintext
  file snapshotting a base provider's API key plus every base top-level key. The
  file is world-of-the-user readable and lives outside the base config dir, so the
  copy silently widened where the secret physically exists.
- **The guarantee.** After this fix, an operator write to a per-project profile
  file persists only `{ $schema, operator }`. A load-bearing regression test seeds a
  base config with a distinctive fake secret, drives an operator mutation under a
  profile, reads the RAW persisted profile file, and asserts the secret string is
  absent and the top-level keys are limited to the project-owned set — while the
  operator authority reads back with its CAS version intact.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary is introduced. The operator CAS write authority and its
  single-committed-write contract are unchanged. Auth material (`auth.json`,
  keychain) is out of scope and untouched: it resolves from `Global.Path.data`, not
  the config root, and no seam changed here reads or writes it.
- **Input validation.** No new untrusted input is parsed. The persisted patch is
  built from the operator store's own typed `OperatorState`; both the base and the
  per-project profile files continue to be parsed by the existing `ConfigParse`
  schema (`loadOperatorNamespace` consumes only the `operator` key, degrading a
  malformed or absent document to `undefined` rather than crashing).
- **Cryptography in transit/at rest.** Not applicable — this feature performs no
  transport and adds no at-rest encryption. It REDUCES at-rest exposure by no longer
  copying base secrets into an additional plaintext file; the base file's own
  storage posture is unchanged.
- **Logging/audit.** No new logs. The audit outbox intent recorded atomically with a
  CAS commit is unchanged and continues to carry only the canonical operator audit
  record (command id, scope, versions, outcome) — never config or secret contents.
- **Error-handling information exposure.** The write path's failure modes are
  unchanged (typed `unavailable`/`conflict` CAS results). No error message echoes
  config bodies or secret values; a failed write persists nothing.

## Acceptance Scenarios

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
And   the real base global config declares an `mcp` server whose auth header
      carries a plaintext secret
When  an operator mutation (`pools.set`) commits to the project `routing` authority
Then  the raw per-project profile `config.json` contains no occurrence of the secret
And   its top-level keys are limited to `$schema` and `operator`

Given the same operator mutation has committed under a profile
When  the persisted profile file is read back through the operator load seam
Then  the `routing` authority is present with the exact CAS version the commit
      returned
And   a subsequent mutation threading that version succeeds

Given an operator mutation has written the per-project profile file under a profile
When  the effective instance config is loaded
Then  the base-layer `mcp` server still resolves (the base is still inherited)
And   the profile file did not duplicate it on disk

Given `OPENCODE_CONFIG_DIR` is unset
When  an operator mutation writes the default global `config.json`
Then  the write preserves the file's existing sibling keys and updates only the
      `operator` namespace, unchanged from prior behavior

## Observability

This feature introduces no new metrics, log events, or trace spans. It reuses the
existing config update span and the operator CAS/audit-outbox path. The persisted
document shrinks to the project-owned namespace; no telemetry label set changes.
Conventions live in `doc/arch/observability/observability.md`.

## Clarifications
</content>
</invoke>
