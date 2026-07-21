# opencode Constitution

This constitution governs changes made on the `fcustom` branch. The
Spec Kit installation at `/Users/farchanjo/bin/speckit` is the source of
truth for requirements, decisions, and execution of those changes.

## Principles

1. **Branch-scoped work:** This constitution applies only to work on
   `fcustom`; upstream behavior and project structure remain the baseline
   unless a Spec Kit artifact explicitly records an intentional change.
2. **Spec-first traceability:** Every non-trivial decision or change must
   be traceable from its decision or requirement to the feature `spec.md`,
   `plan.md`, and `tasks.md`, and from those artifacts to the changed code
   and its tests. A reviewer must be able to follow that chain by path or
   stable identifier.
3. **Decision synchronization:** When scope, rationale, design, acceptance
   criteria, or implementation approach changes, update the affected Spec
   Kit artifact before or during implementation; code must not become the
   record of an undocumented decision.
4. **Upstream preservation:** Do not remove, weaken, or silently diverge
   existing upstream/project behavior. Any deliberate incompatibility must
   state the affected behavior, rationale, and migration or compatibility
   impact in the relevant Spec Kit artifacts.
5. **Verifiable delivery:** A change is complete only when its acceptance
   criteria are covered by appropriate tests and `speckit validate` exits
   successfully. Validation failures must be fixed in the named artifact,
   not bypassed or hidden.

## Governance

**Authority.** `doc/arch` is the single source of truth for the opencode
operator control plane and smart-routing work: spec beats code, code beats
assumption. The merged control-plane config `doc/arch/speckit.toml`
(ADR-0029) governs the deterministic workflow `constitution` → `specify` →
`clarify` (when needed) → `plan` → `tasks` → `analyze` → `implement` →
`validate`. Contributors run `speckit status` then `speckit next` and read
the active `spec.md` before writing any code; no phase is skipped and none
is executed out of order.

**Write scope (guard).** The `[guard]` policy in `doc/arch/speckit.toml`
runs in `enforce` mode. The active write scope is the union of the static
`specScopeGlobs` and the derived globs (`doc/arch/sdd/NNN-slug/**` for the
active feature's branch, `doc/.specify/**`, and `doc/arch/**` always). A
denied write means the target is outside the active feature's scope: adjust
the scope or revise the plan — never disable the guard, never hand-edit
`doc/.specify/` state, and never reach for `--allow-out-of-spec` to force a
change through.

**Delivery gate.** A change is complete only when its acceptance criteria
are covered by tests and `speckit validate` exits clean. `validate` errors
are never waivable; a red `validate`, `check`, or `verify` blocks every
commit. Fix the named artifact — never the rule, never the gate.

**Commit discipline.** Commits use Angular Conventional Commit headers
(`<type>(<scope>): <subject>`, ≤ 72 characters) and land one logical change
at a time; the git history is part of the spec corpus and stays legible.
AI attribution — co-author trailers, "generated with" notices, assistant
session links — is forbidden in code, docs, and messages (ADR-0025,
ADR-0026); commits authored under the recognized upstream identities in
`[git].foreignEmails` are synced upstream history and are exempt from the
own-commit discipline gate.

**Amending this constitution.** Changes to this document require a recorded
Architecture Decision (MADR) with status `accepted` and at least one
`deciders` entry. Trivial corrections (typos, formatting) may be committed
directly; structural or principle-level changes must go through the ADR
process and keep `AGENTS.md`, `README.md`, and this constitution in sync.
