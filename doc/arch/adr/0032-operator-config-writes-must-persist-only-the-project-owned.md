---
status: accepted
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0032 — Operator Config Writes Must Persist Only The Project Owned

## Context and Problem Statement

Feature 030 made the global config READ layered: with `OPENCODE_CONFIG_DIR` set, the
base `~/.config/opencode` layer ALWAYS loads and the profile is deep-merged on top, so
`Config.get()` now returns the base's third-party `mcp`/`provider` entries — including
their PLAINTEXT API keys and auth headers — merged into the effective document.

The durable operator store persists operator authority records (routing bindings, pool
bindings, langlock state, ...) into the per-project profile file
`<configRoot>/profiles/<encoded-path>/config.json` (Feature 027). Its write path
(`mergeOperator`) computes the current authority state by reading the FULL effective
config, then serialized that WHOLE merged document back to the profile file:

```
const root = await readRoot(authority)   // = Config.get() → full layered effective config
const state = asState(root[ns])           // current operator namespace
mutate(state)
const nextRoot = { ...root, [ns]: state } // <-- spreads EVERY base-inherited key back
await options.config.update(nextRoot)     // deep-merged into profiles/<key>/config.json
```

Post-030 that `root` carries the base secrets, so a single `pools.set` under a profile
wrote a ~28 KB plaintext per-project file snapshotting a base provider's `Z_AI_API_KEY`
plus every base top-level key (`mcp`, `provider`, `agent`, `command`, `mode`, `tools`,
`permission`, `username`). Confirmed in production: a brand-new plaintext-secret file,
outside the base config dir, silently widening where the secret physically exists. The
per-project profile file legitimately owns ONLY the `operator` namespace; everything
else was base-inherited noise that must not be written.

The question: how to make the operator write persist only what the profile file owns —
without breaking the layered read (Feature 030 must still inherit the base at load
time), without changing the operator authority schema or the CAS/mutation protocol, and
without regressing the default (override-unset) global write.

## Decision Drivers

- **No secret leak.** No base-inherited secret (`mcp`/`provider` API key or auth
  header) may appear in a per-project profile file an operator mutation writes. This is
  the security guarantee the feature exists to enforce.
- **Persist only what the file owns.** The operator write must serialize the `operator`
  namespace (authority records, idempotency, rollback, audit outbox) and nothing
  base-inherited — not `mcp`, `provider`, `agent`, `command`, `mode`, `tools`,
  `permission`, `username`, or `references`.
- **CAS/authority round-trip preserved.** The persisted document must round-trip through
  `loadOperatorNamespace` unchanged in meaning; the CAS version must survive and a
  subsequent read must return the same authority state. The authority schema and the
  mutation/CAS/idempotency/rollback protocol must not change.
- **Layered read intact.** Feature 030 must keep inheriting and merging the base at
  read time; the file just stops DUPLICATING it on disk.
- **Zero default drift.** With `OPENCODE_CONFIG_DIR` unset, the default global
  `config.json` write path must behave exactly as before.
- **No leak on the global write either.** The same over-broad serialization also
  affected the global operator write (it could copy the layered base into the profile's
  own global `config.json`); the fix must scope that write too, while keeping global
  `config.json` semantics intact.

## Considered Options

- **Option A — Persist a namespaced document `{ $schema, operator }` (chosen).**
  `mergeOperator` builds the write patch as `{ $schema, [ns]: state }` instead of
  spreading the whole root. The write seams (`Config.update` / `Config.updateGlobal`)
  deep-merge the patch into the target file, so a namespaced patch preserves any
  pre-existing project-owned keys while writing only the `operator` namespace. `readRoot`
  still reads the full effective config so the current authority state (possibly
  inherited/merged) is computed correctly — only the WRITE is narrowed.
- **Option B — Compute a project-owned delta by diffing the effective root against the
  inherited base and writing only keys that differ.** Rejected: it re-derives what the
  operator store already knows precisely (it owns exactly the `operator` namespace), adds
  a base-vs-effective diff with subtle deep-equality edge cases, and is strictly more
  complex than persisting the one namespace the file owns. The namespaced write is the
  minimal correct approach.
- **Option C — Fix the write at `Config.update` by stripping inherited keys there.**
  Rejected: `Config.update` is a generic merge-and-write seam; it is correct for it to
  persist what it is handed. The over-read is the operator store's; the fix belongs at
  the source that over-reads, not in a shared writer that other callers rely on.
- **Option D — Stop layering the base into the operator read.** Rejected and out of
  scope: the layered read is Feature 030's deliberate, correct behavior (the base must
  keep resolving). The current authority state legitimately depends on the merged view;
  the defect is duplication on WRITE, not inheritance on READ.

## Decision Outcome

Chosen option: **Option A**, because persisting the namespaced `{ $schema, operator }`
document writes exactly what the per-project profile file owns, provably excludes every
base-inherited key and secret, preserves the operator CAS/authority round-trip, leaves
the Feature 030 layered read and the operator protocol untouched, and — because the
write seams merge the patch into the existing file — neither clobbers pre-existing
project-owned keys nor regresses the default global write.

Key decisions recorded:

1. **Namespaced WRITE (FR1/FR2/FR7).** `mergeOperator`
   (`src/operator/adapters/outbound/config-service.ts`) builds
   `patch = { $schema, [ns]: state }` and passes it to `Config.update` (project
   authority) or `Config.updateGlobal` (global authority). The `$schema` makes a freshly
   created per-project profile `config.json` a valid, self-describing config file rather
   than a bare `{ operator }` fragment.
2. **READ still full, only WRITE narrowed (FR4/FR5).** `readRoot` still returns the full
   effective (layered) config, so the current authority state is computed from the merged
   view. Feature 030's `loadGlobal` keeps inheriting and merging the base at read time, so
   the effective config after an operator write still exposes the base `mcp`/`provider`
   keys — the file simply stops duplicating them.
3. **Sibling preservation (FR3), later narrowed to the global write only.** `Config.update`
   originally deep-merged the patch into the existing target file, so any genuinely
   project-scoped keys already in the profile file were preserved; the change only stopped
   ADDING inherited base keys. An adversarial review found this insufficient — see the
   "Project-profile wholesale write" consequence below, which supersedes this point for the
   project authority (non-global) write. `Config.updateGlobal` keeps deep-merging
   unconditionally: the global config file legitimately has user-authored siblings
   (`mcp`/`provider`/`model`, ...) that an operator write must not drop.
4. **Global write scoped too, no default drift (FR6).** The same narrowing applies to the
   global operator write, so no base layer leaks into the profile's own global
   `config.json`. With `OPENCODE_CONFIG_DIR` unset, the namespaced patch merges into the
   base file the root was read from, so the net effect is byte-for-byte the prior
   behavior; `updateGlobal`'s sibling-key preservation and `changed` detection are
   unchanged.
5. **Protocol untouched (invariant).** The operator authority schema and the
   CAS/mutation/idempotency/rollback/audit-outbox protocol are unchanged. The persisted
   `state` still carries the full `operator` namespace (authorities, idempotency,
   rollback, auditOutbox); the CAS version written by a commit reads back identical.
6. **Security regression test (load-bearing).** A test in
   `packages/opencode/test/config/config.test.ts` seeds a base config with a distinctive
   fake secret in an `mcp` auth header, sets `OPENCODE_CONFIG_DIR` to a temp profile,
   drives a real operator CAS mutation through a durable store wired to the real
   `Config.Service`, then reads the RAW persisted profile file and asserts the secret is
   absent, the top-level keys are limited to `{ $schema, operator }`, and the authority
   round-trips with its CAS version. It fails on the pre-fix source and passes after.

### Consequences

- Good: an operator mutation under a profile can no longer copy base-layer secrets into a
  per-project profile file — the leak is closed and test-locked.
- Good: the persisted profile file shrinks to the project-owned namespace, so inspecting
  it never reveals a snapshot of the user's base `mcp`/`provider`/`agent`/... keys.
- Good: the Feature 030 layered read is unaffected — the base is still inherited and
  merged; only the on-disk duplication stops.
- Good: the operator CAS/authority protocol and schema are unchanged; the fix is a single
  narrowing at the write seam.
- Good: the default (override-unset) global write is byte-for-byte unchanged; the global
  operator write is scoped too, so no operator-written file leaks the base.
- Neutral: a freshly written per-project profile file now carries `$schema` (a valid
  config document) instead of the previous full-config snapshot.
- **Project-profile wholesale write (follow-up, adversarial review, MEDIUM residual
  closed).** Narrowing the patch to `{ $schema, operator }` stops NEW leaks, but
  `Config.update`'s deep-merge (`remeda.mergeDeep`) never REMOVES keys, so a profile file
  already leaked by the shipped pre-fix code (a stale base `mcp`/`provider` secret sitting
  on disk alongside the operator namespace) stayed leaked forever — the merge only ever
  adds/overwrites the `operator` key, it never scrubs whatever else is already there. The
  per-project profile file is 100% operator-owned (Features 027/030: users author
  `opencode.json` in the project tree; they never author this file), so its write can go
  further than the narrowing alone: `Config.update` now takes an opt-in
  `{ replace: true }` option (default remains deep-merge, unchanged for every other
  caller — the HTTP config route, `flag-bootstrap`), and `mergeOperator`'s non-global
  branch passes it, so the project-profile write REPLACES the file wholesale with
  `{ $schema, operator: state }` instead of deep-merging. `state` already reflects the
  full current operator document (`readRoot` reads the layered effective config before
  mutating), so nothing operator-owned is lost — only stale non-operator keys sitting in
  the file are dropped. This is safe specifically because the file has no legitimate
  siblings to preserve; the global write (`Config.updateGlobal`) keeps deep-merging
  unconditionally, because `~/.config/opencode/config.json` legitimately carries
  user-authored `mcp`/`provider`/`model` siblings that must survive an operator write.
- Good: self-healing. A profile file already leaked by the pre-fix code is scrubbed on its
  very next operator mutation — no migration or manual cleanup step is required for a
  project that keeps using the operator control plane.
- Residual (accepted): a leaked profile file that is NEVER mutated again by any operator
  authority is not auto-scrubbed — nothing proactively scans and rewrites profile files at
  rest. Operator remediation for an already-leaked, since-abandoned file: delete it (it is
  regenerated from the layered base + any surviving operator state on the next write) or
  trigger any operator mutation against that project to force the self-heal.

## Related

- Feature specification: [032 Operator config writes must persist only the project owned](../sdd/032-operator-config-writes-must-persist-only-the-project-owned/spec.md)
- The layered global READ that exposed the leak vector: [030 Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../sdd/030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md)
- The per-project relocation that owns the profile write target: [027 Relocate per-project operator persistence out of the working tree](../sdd/027-relocate-per-project-operator-persistence-out-of-the-working/spec.md)
</content>

## Links

- Related: ADR-0030, ADR-0027, ADR-0035, ADR-0014.
