---
status: proposed
date: 2026-07-21
deciders: [your-org]
consulted: []
informed: []
---

# Auto Skill Semantic Chunk Auto Priming Fourth Retrieval Pass

## Context and Problem Statement

Feature 050 (ADR-0050) shipped a real skill chunker
(`core/src/semantic/skill-chunk.ts`) and a production `OutputSpoolStore`
(`packages/opencode/src/semantic/output-spool-store.ts`), so
`SkillChunkDoc.body_ref` — a Feature 005 OutputSpool content handle, never a
filesystem path — resolves to sanitized chunk bodies. Feature 051
(ADR-0051) wired the live per-turn query plane over three surfaces
(agents, skills, tools) and deliberately reserved two budgets,
`max_skill_chunks`/`max_skill_tokens` (`Budget.Retrieval`,
`packages/schema/src/routing/budget.ts:44-45`), spending neither:
`SystemPrompt.skills` (`session/system.ts:106-120`) renders only names and
descriptions into `<available_skills>` — Tier-1 listing. The model still
pays a full tool round trip to read any skill's body.

The wire contract already anticipated a content-level pass:
`RetrievalCandidate.kind` (`packages/protocol/src/semantic/commands.ts:393`)
includes `"skill_chunk"`, and `RetrievalCandidate.chunkRef?: OutputRef`
(`:396`) already exists "populated only for injected skill chunks" — but no
request is ever issued against the `skill_chunks` collection.
`PipelineRunnerPort` binds `runAgents`/`runSkills`/`runTools` only
(`pipeline-runner.ts:297-299`); `RetrievalPort` exposes
`retrieveAgents`/`retrieveSkills` only (`ports.ts:194-198`). This feature
(SR-C) is the fourth pass the shipped contract already left a slot for.

Auto-injecting a chunk body directly into the system prompt is a
qualitatively different trust placement than today's `skill` tool call: the
model currently CHOOSES to read a skill body after seeing its name and
description (Tier-1); this feature has the SYSTEM decide, unprompted, to
place skill content where the model reads it as ambient instruction. That
shift matters most for skill discovery's existing blind spot:
`discoverSkills` (`packages/opencode/src/skill/index.ts:184-231`) merges
local-directory scans and `cfg.skills.urls` remote-pack pulls into the
identical `state.skills` map with no provenance kept — `Skill.Info`
(`:33-38`) carries `name`/`description`/`location`/`content` only. A remote
pack is third-party content the operator did not author; auto-injecting it
unconditionally would hand a prompt-injection surface to anyone who
publishes a plausible-sounding `cfg.skills.urls` entry, which Tier-1 listing
(names/descriptions only, always model-mediated) never exposed.

This ADR decides how to add the fourth retrieval pass, the confidence gate
before any chunk is considered, the render/budget mechanics, the provenance
trust boundary, and session dedup — composing with Feature 051's existing
per-turn machinery without modifying it, and without regressing Feature
050's fail-closed index-plane posture or Feature 051's fail-open query-plane
posture.

## Decision Drivers

- Reuse Feature 051's per-turn machinery exactly: one embedding, one
  concurrency group, one shared deadline, one `RoutingState` memo keyed by
  `lastUser.id` — a fourth surface bolted onto the existing fan-out, never a
  second orchestration path.
- The two reserved budgets (`max_skill_chunks`/`max_skill_tokens`) exist
  for exactly this feature and for nothing else; Tier-1 listing must never
  spend them, now or in the future.
- Wrong or untrusted skill content injected into the system prompt pollutes
  every subsequent model turn until the session ends — injection must be
  conservative by construction (a strict confidence floor, local-only by
  default), not merely "best effort."
- A chunk body is reached only through the Feature 005 OutputSpool content
  plane, exactly as the chunker itself writes it — never a second read path
  through the raw `SKILL.md` file, which would bypass the sanitization and
  staleness guarantees Feature 050 already built.
- Auto-injection is materially higher-trust placement than a model-pulled
  tool call; the trust boundary between locally-authored and third-party
  remote content must be explicit in the schema, not inferred from
  discovery order.
- Staleness must degrade to "skip that one chunk," never to "inject stale or
  garbled content" — the chunker and the index can be up to one reconcile
  cycle behind a skill edit or deletion, by Feature 050's own documented
  contract.
- Zero live-turn retries and fail-open on any failure — the SAME query-plane
  posture ADR-0051 established, never a second policy for this fourth
  surface.

## Considered Options

- **A fourth concurrent retrieval pass over `skill_chunks`, gated by its own
  flag composing with the Feature 051 skills gate, rendering through a new
  `SystemPrompt` sibling method that resolves bodies via `OutputSpoolStore`
  (chosen).** One embed, one deadline, one memo — extended, not duplicated;
  a confidence floor and a provenance filter applied before any candidate is
  considered eligible; render-time budget enforcement over the two reserved
  knobs.
- **Inject full skill bodies unconditionally for any ranked hit, no
  confidence floor.** Rejected: a semantic reranker's score distribution
  has no natural cutoff a fixed top-K alone captures — a top-ranked-but-
  mediocre hit would still inject wrong-domain content into every turn,
  and the reserved token budget would be exhausted by low-value chunks
  before a genuinely relevant one is considered. A confidence floor (FR2)
  is the correct conservative default; a fixed top-K is not.
- **Resolve chunk bodies from the raw `SKILL.md` file at render time instead
  of through `OutputSpoolStore`.** Rejected: `SkillChunkDoc.body_ref` is
  explicitly an `OutputRef` whose offset/limit index the SANITIZED spool
  body Feature 050's chunker wrote, not raw file bytes (ADR-0050); reading
  the raw file would silently diverge from what was actually indexed
  (different sanitization, different chunk boundaries, no staleness
  signal) and would reintroduce exactly the filesystem-path content
  handle Feature 005's OutputSpool design was built to avoid. The spool
  read is also how staleness is CHEAP to detect: a `not_found`/
  `spool_unavailable` resolve error is a clean, typed skip signal a raw
  file read cannot provide as cleanly (a stale file read just silently
  succeeds with wrong content).
- **Trust `cfg.skills.urls` remote packs identically to local skills for
  auto-injection.** Rejected: today's discovery keeps no provenance at all,
  and a remote pack is third-party content an operator did not author.
  Auto-injecting it unconditionally converts every remote skill pack into a
  standing prompt-injection vector — a materially different risk than
  Tier-1 listing (names/descriptions, always model-mediated) or `skill`-tool
  loading (an explicit model action visible to the operator via tool-call
  logs). Provenance-gating to local-only by default, with an explicit
  per-pack `autoprime_opt_in` escape hatch, closes this without blocking
  legitimate remote-pack use of the OTHER two tiers.
- **Skip session dedup; let the reranker's own memo (Feature 051 FR1/FR7)
  naturally avoid re-injection.** Rejected: Feature 051's memo is per-TURN,
  not per-session — a new user turn several messages later that again ranks
  the same skill highly would re-embed and could re-inject the same content,
  accumulating duplicate guidance in the system prompt across a long
  session. An explicit session-scoped "already fully injected" set is a
  small, targeted addition to `RoutingSessionState` that closes this
  without touching Feature 051's turn-scoped memo semantics at all.

## Decision Outcome

Chosen option: a fourth concurrent retrieval pass over `skill_chunks`,
confidence-floored and provenance-filtered, rendered through a new
`SystemPrompt` sibling method resolving bodies via `OutputSpoolStore`, under
the two budgets Feature 051 already reserved, with session-scoped dedup.

1. **One more surface in the existing fan-out, not a new orchestration
   path.** `narrowForTurn` (`live-narrowing.ts`) gains a fourth branch in
   its `Effect.all` group, sharing the turn's single prompt embedding, the
   shared `latencyBudgetMs` deadline, and the `RoutingState` memo keyed by
   `lastUser.id`. `NarrowedSets` gains an optional `chunks?:
   readonly AutoSkillChunkRef[]` field, following the identical
   absent-means-passthrough / present-non-empty-means-narrowed convention
   the other three fields already use.
2. **A new gate that composes with, never replaces, the skills gate.**
   `skill_autoprime` (default `false`) is a SEPARATE config flag; the
   effective gate is `skill_autoprime.enabled &&
   semantic_narrowing.skills.enabled`. This is a deliberate two-key design:
   an operator who has not turned on Feature 051's skills narrowing at all
   should never see Tier-2 injection either, and turning `skill_autoprime`
   on is always an explicit, additional, reversible step.
3. **A confidence floor gates injection, not a fixed top-K.** Only
   candidates whose `SemanticScore.confidence` clears a configurable
   `score_floor` (strict default `0.75`) are considered; zero qualifying
   candidates is passthrough (no block), never an empty-but-present list —
   the same degenerate-to-passthrough discipline ADR-0051 established for
   its three surfaces.
4. **Bodies are resolved exclusively through `OutputSpoolStore.resolve`,
   never the raw file.** A `not_found`/`spool_unavailable` result for one
   chunk's ref skips only that chunk, silently — the render pass never
   fails the whole block over one stale reference, and never falls back to
   reading `SKILL.md` directly.
5. **Render-time budget enforcement spends the two reserved knobs for the
   first time.** `Budget.Retrieval.max_skill_chunks`/`max_skill_tokens`
   (`schema/routing/budget.ts:44-45`) — already carried by every session's
   routing budget and explicitly left unspent by Feature 051 — cap the
   rendered block; `Token.estimate` measures cumulative body size, and
   truncation drops the lowest-ranked remaining chunks first. Tier-1
   listing continues to spend neither knob.
6. **Provenance is a first-class field on `Skill.Info` and `SkillDoc`, not
   inferred at render time.** `source: "local" | "remote-pack"`,
   `pack_ref?`, and `autoprime_opt_in` (default `false`) are stamped at
   DISCOVERY time — local-directory scans stamp `"local"`, the
   `cfg.skills.urls` loop stamps `"remote-pack"` — so the chunk pass filters
   on a durable classification rather than re-deriving trust from a URL
   string at read time. A remote pack without opt-in is unaffected in every
   OTHER respect: still Tier-1 listable, still `skill`-tool loadable.
7. **Session-scoped dedup is a small, additive `RoutingSessionState`
   field.** A set of skill names already fully rendered this session,
   cleared with the rest of the session state; the render pass consults it
   before resolving bodies. The `skill` tool's own availability is
   completely unaffected — dedup governs auto-injection only.
8. **Fail-open, zero-retry, exactly Feature 051's posture — extended, not
   forked.** Any failure on this feature's path (retrieval timeout, resolve
   error) resolves to "no injection," reuses Feature 051's
   one-warning-per-turn discipline, and adds no second warning path, no
   retry, and no new failure-handling policy.

### Consequences

- Good: the fourth surface is structurally indistinguishable from the other
  three at the orchestration level (same embed, same deadline, same memo),
  so Feature 051's existing tool-call-continuity and fail-open guarantees
  extend to it for free — no new correctness surface for "does this
  surface stay fixed mid-turn" or "does a Milvus outage block the turn."
- Good: the provenance trust boundary is enforced at the SAME layer
  (discovery-time classification) rather than at N different render-time
  checks, so a future consumer of `Skill.Info`/`SkillDoc` provenance
  inherits a correct, already-stamped classification instead of having to
  re-derive it.
- Good: reusing `OutputSpoolStore.resolve` for reads means this feature
  inherits Feature 050's staleness contract (content-hash-keyed spool
  entries, superseded-on-edit) for free — "skip a dangling ref" is a
  one-line check, not a new staleness-detection mechanism.
- Bad: the confidence floor and the two reserved budgets are now consumed
  by exactly one feature; a future second Tier-2-style consumer (if one is
  ever proposed) would need to either share this feature's gate/budget
  path or introduce its own reserved knobs — this ADR does not generalize
  the budget ownership model beyond "one consumer, Feature 052."
- Bad: local-only-by-default means an operator who genuinely trusts a
  specific remote pack must take an explicit extra configuration step
  (`autoprime_opt_in: true`) per pack before that pack's chunks are ever
  auto-injected — a deliberate friction point, not an oversight, but a real
  cost for legitimate trusted-remote-pack use cases.
- Bad: session dedup is name-keyed and session-scoped only; a skill
  re-injected in a DIFFERENT session (a fresh conversation) is not
  deduplicated against a prior session's injection — this is accepted as
  correct (a new session has no shared context to avoid repeating), not a
  gap.

## Related

- Depends on [ADR-0050 — Wire The Semantic Index Data Plane Production
  Pipeline](0050-wire-the-semantic-index-data-plane-production-pipeline.md)
  for the skill chunker, `SkillChunkDoc.body_ref`, and the production
  `OutputSpoolStore` this feature's render pass resolves through unmodified.
- Depends on [ADR-0051 — Wire Live Per Turn Semantic Narrowing Of Agents
  Skills And](0051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and.md)
  for `narrowForTurn`, `NarrowedSets`, the `RoutingState` per-turn memo, and
  the config-gate convention this feature's fourth surface composes with.
- Extends [ADR-0008 — Milvus-Backed Multilingual Semantic Retrieval and
  Reranking Stack](0008-milvus-semantic-retrieval-stack.md), whose wire
  contract (`RetrievalCandidate.kind: "skill_chunk"`, `chunkRef`) already
  anticipated this pass.
- Feature specification: [052 Auto Skill Semantic Chunk Auto Priming
  Fourth Retrieval Pass](../sdd/052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass/spec.md).
- Downstream consumer (out of scope here): Feature 053 (orchestration
  handoff), which depends on this feature's memo/seam shape unmodified.
