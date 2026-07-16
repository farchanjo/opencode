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

The lifecycle is `constitution` → `specify` → `clarify` (when needed) →
`plan` → `tasks` → `analyze` → `implement` → `validate`. Work must follow
the applicable phases and keep the committed artifacts synchronized with
the implementation.

Changes to this constitution require a recorded Architecture Decision
(MADR) with status `accepted` and at least one `deciders` entry. Trivial
corrections (typos, formatting) may be committed directly; structural
changes must go through the ADR process.
