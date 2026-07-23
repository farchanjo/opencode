# Implementation Plan: Native Deterministic Skill Catalog Priming In OpenCode Code

## Overview

Ship native skill relevance + overload control for OpenCode: pure matchSkills,
Tier-1 list policy (cap/format/natural order), TUI dynamic control, startup
semantic index jobs for skills/skill_chunks, optional LLM HTTP debug. Full
bodies stay on the skill tool. Spec: [spec.md](spec.md). ADR: [0058](../../adr/0058-native-deterministic-skill-catalog-priming-in-opencode-code.md).

## Technical Approach

### Layers (shipped)

| Layer | Path / change |
| ----- | ------------- |
| Matcher pure | `packages/opencode/src/skill/match.ts` |
| List policy pure | `packages/opencode/src/skill/list-policy.ts` — ranked → matched → lexical → cap |
| Config | `experimental.skill_list` in `ConfigExperimental` + schema `SkillListConfig` + V1 config mirror |
| Session | `SystemPrompt.skills(agent, { ranked, prompt })`; `prompt.ts` passes narrowed.skills + promptText |
| TUI | `dialog-skill-list-policy.tsx` + entry from `dialog-skill.tsx` → global.config.update |
| Startup jobs | `packages/opencode/src/semantic/startup-index.ts` from `operator/stack-live.ts` after IndexPort live |
| HTTP debug | `packages/opencode/src/debug/llm-http.ts` wrapped in `provider.ts` fetch |
| Tests | `test/skill/match.test.ts`, `list-policy.test.ts`, `test/session/system.test.ts` |

### Algorithms

- **matchSkills**: path OR trigger; MAX=7; reserved trigger slots; hub variants.
- **applySkillListCap**: if `ranked !== undefined` preserve order (empty → empty list); else match/lexical; hard_cap slices to max_listed; **never** re-sort A–Z in formatSkillListBlock.
- **Startup**: collections `skills`, `skill_chunks`; reconcile default; env full/off.

### Deferred (not blocking ship of residual)

- Persist SkillMeta on Skill.Info at discovery (paths/triggers on every skill for matched mode without ad-hoc parse).
- Cwd file sampler wired into SystemPrompt order.cwdFiles every turn.
- Optional inject_bodies budget path.
- Scheduled periodic reconcile via jobs executor (startup dispatch is enough for v1).

## Success Criteria

- Unit tests green for match + list policy + system skills.
- Live profile: discovery under ~/.opencodedev; skill tool A/B; listing status
  mode ranked|lexical with cap ≤ max_listed; missing skill fail-closed.
- Speckit validate green; ADR accepted on ship commit.
