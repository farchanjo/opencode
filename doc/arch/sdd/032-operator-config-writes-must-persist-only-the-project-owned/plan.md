# Implementation Plan: Operator Config Writes Must Persist Only The Project Owned

## Overview

Close the secret-leak the layered-config work (Feature 030) exposed in the operator
persistence path. The operator store computes the current authority state by reading
the FULL effective config, then — pre-fix — serialized that whole merged document
back to the per-project profile `config.json`, copying inherited base `mcp`/`provider`
secrets into a brand-new plaintext file. This plan narrows the operator write to the
`operator` namespace it legitimately owns, satisfying the Functional and Security
Requirements of feature
032-operator-config-writes-must-persist-only-the-project-owned without changing the
layered read (Feature 030), the per-project relocation (Feature 027), or the
operator CAS/authority protocol.

## Technical Approach

- **Seam.** The single fix is in the durable operator store,
  `packages/opencode/src/operator/adapters/outbound/config-service.ts`, function
  `mergeOperator`. It read the effective root (`options.config.get()` for a project
  authority, `getGlobal()` for a global authority), spread the whole root back
  (`{ ...root, [ns]: state }`), and handed that to the write seam.
- **Change.** Build the write patch as a namespaced document
  `{ $schema, [ns]: state }` instead of spreading the whole root. The write seams
  (`Config.update` / `Config.updateGlobal`) deep-merge the patch into the target
  file, so a namespaced patch preserves any pre-existing project-owned keys while
  writing only the `operator` namespace. `readRoot` still reads the full effective
  config so the current authority state (which may be inherited/merged) is computed
  correctly — only the WRITE is narrowed.
- **Both authorities.** The same narrowing applies to the project write
  (`Config.update` → `projectOperatorConfigPath`) and the global write
  (`Config.updateGlobal` → `globalConfigFile`), so no base layer leaks into any
  operator-written file. When `OPENCODE_CONFIG_DIR` is unset, the global patch merges
  into the base file that the root was read from, so the net effect is byte-for-byte
  the prior behavior (no regression).
- **Read path untouched.** `loadOperatorNamespace` (config.ts) already consumes only
  the `operator` key, and Feature 030's layered `loadGlobal` still inherits and merges
  the base at load time, so the effective config is unchanged.
- **Verification.** A load-bearing security regression test in
  `packages/opencode/test/config/config.test.ts` seeds a base config carrying a
  distinctive fake secret in an `mcp` auth header, sets `OPENCODE_CONFIG_DIR` to a
  temp profile, drives a real operator CAS mutation through a durable store wired to
  the real `Config.Service`, then reads the RAW persisted profile file and asserts the
  secret is absent, the top-level keys are limited to `{ $schema, operator }`, and the
  authority reads back with its CAS version. The test fails on the pre-fix source and
  passes after.

## Companion Artifacts

No companion artifacts are required for this feature. The change is a single,
well-scoped correction to an existing write seam; the behavior contract is fully
captured by the spec's Functional/Security Requirements and the ADR.

- `research.md` — not needed (root cause is understood and reproduced).
- `data-model.md` — not needed (no schema or entity change; the operator authority
  schema is explicitly unchanged).
- `contracts/` — not needed (no interface change).
- `quickstart.md` — not needed.
</content>
