---
status: accepted
date: 2026-07-23
deciders: [opencode-operator]
consulted: []
informed: []
---

# Native Deterministic Skill Catalog Priming In OpenCode Code

## Context and Problem Statement

Large skill catalogs (100+) overload the Tier-1 system prompt when listed
verbosely. fapp skill-prime provided path/trigger matching only via external
hooks and MD bridges. OpenCode already had F051/F052 semantic surfaces, but
passthrough left the full catalog A–Z in context. Operators need native,
code-first listing control, natural relevance order, startup index hygiene,
and TUI knobs — without fapp runtime.

## Decision Drivers

- Native opencode-cli/TUI; no fapp-hooks dependency for listing
- Cap prompt size (max_listed + compact format)
- Natural order: semantic ranked when live, else match/lexical
- Startup reindex of skills/skill_chunks so ranking can leave passthrough
- Dynamic operator control (TUI → global config)
- Testable pure domain + wire-level debug optional

## Considered Options

- **A — Native matchSkills + skill_list policy + TUI + startup index jobs + optional HTTP debug.** Chosen.
- **B — Shell out to fapp-hooks skill-prime.** Rejected: external binary + MD bridges.
- **C — Only F052 embeddings, no hard cap.** Rejected: fails offline/cold; still overloads when passthrough.
- **D — Shrink catalog by hand only.** Rejected: not productized; still needs runtime policy.

## Decision Outcome

Chosen option: **A**.

1. `matchSkills` pure domain (fapp parity for path/trigger/hub).
2. `experimental.skill_list` caps/formats Tier-1 `<available_skills>`; natural
   order ranked → matched → lexical; never A–Z full dump as designed path.
3. TUI Skill list policy patches global config for next turn.
4. Startup dispatch of skills + skill_chunks index jobs on live IndexPort.
5. Optional `OPENCODE_DEBUG_LLM_HTTP` transport intercept for skill markers.
6. Skill tool remains the full-body path.

### Consequences

- Good: usable large catalogs; relevant tops; smaller wire payloads.
- Good: startup jobs improve chance of mode=ranked.
- Good: operator can tune max/format live.
- Bad: full SkillMeta-on-discovery and cwd sampler still deferred for matched mode depth.
- Neutral: skill tool error paths may still enumerate many names (load surface).

## Related

- Feature: [058 spec](../sdd/058-native-deterministic-skill-catalog-priming-in-opencode-code/spec.md)
- Related: F051, F052, F009, F018 (executor), F050 (index jobs)
- External: fapp skill-prime domain (reference only)
