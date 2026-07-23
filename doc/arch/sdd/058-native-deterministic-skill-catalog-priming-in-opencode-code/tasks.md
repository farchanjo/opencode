# Tasks: Native Deterministic Skill Catalog Priming In OpenCode Code

## Task Breakdown

### Core matcher + listing (shipped)

- [x] T001 Pure `matchSkills` + `SkillMeta` in `packages/opencode/src/skill/match.ts`
  with MAX=7 and reserved trigger slots; unit tests.

- [x] T011 `applySkillListCap` + formats in `packages/opencode/src/skill/list-policy.ts`
  (ranked order preserved; lexical fallback; empty ranked → empty list).

- [x] T012 Config `experimental.skill_list` (`max_listed`, `format`, `hard_cap`,
  `show_status`) + `resolveSkillListConfig` defaults (24 / compact / hard_cap true).

- [x] T013 Wire `SystemPrompt.skills` + `SessionPrompt` promptText/ranked; status
  line `[skill_list: …]`; omit undescribed skills from Tier-1 list.

- [x] T014 TUI: Skill list policy dialog (dynamic global config patch) from skills
  dialog control entry.

- [x] T015 Startup semantic index jobs: dispatch skills + skill_chunks reconcile
  (or full via env) on live IndexPort mount; fail-open.

- [x] T016 Optional LLM HTTP debug intercept (`OPENCODE_DEBUG_LLM_HTTP`) with
  skill markers and redacted headers.

- [x] T017 Tests: match + list-policy + system skills; typecheck core/opencode/tui.

- [x] T018 Live smoke on OPENCODE_CONFIG_DIR=~/.opencodedev: discovery, skill tool
  with/without, natural/ranked listing cap, missing skill, semantic index populated.

- [x] T019 Corpus residual: update spec/plan/tasks/ADR/Gherkin/CUE to match shipped
  residual (cap/TUI/startup/debug); `~/bin/speckit validate` green.

### Deferred follow-ups

- [ ] T002 Line-tolerant frontmatter meta attached to Skill.Info at discovery
  (paths/triggers/variants for every skill without ad-hoc parse).

- [ ] T004 Cwd file sampler wired into every turn order.cwdFiles.

- [ ] T006 Optional inject_bodies with hard char budget.

- [ ] T020 Periodic reconcile job via Feature 018 executor (beyond startup).

## Dependencies

- Skill discovery + skill tool (existing).
- F051/F052 when Milvus + embedding binding live.
- Operator stack IndexPort for startup jobs.
- Profile isolation: `OPENCODE_CONFIG_DIR` skills catalog.
