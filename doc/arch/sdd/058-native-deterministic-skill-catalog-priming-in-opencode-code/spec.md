---
id: 019f8cf1-bab9-7481-b5bf-b0d084dd5a84
number: 058
slug: native-deterministic-skill-catalog-priming-in-opencode-code
status: analyzed
created_at: 2026-07-23T03:08:00.058193Z
---
# Feature Specification: Native Deterministic Skill Catalog Priming In OpenCode Code

Feature: 058-native-deterministic-skill-catalog-priming-in-opencode-code
Created: 2026-07-23

## Summary

Make large skill catalogs usable natively in OpenCode **without fapp hooks** and
**without flooding the system prompt**:

1. Pure `matchSkills` (path/trigger/hub) for deterministic relevance.
2. **Natural Tier-1 listing order**: F051 semantic `ranked` → path/trigger match
   → lexical prompt tokens → hard cap (never A–Z full dump as primary path).
3. **`experimental.skill_list`**: `max_listed`, `format` (verbose|compact|names),
   `hard_cap`, `show_status` — dynamic via TUI + global config.
4. **Startup index jobs**: on operator stack open, background reconcile/reindex
   of `skills` + `skill_chunks` so ranking can leave passthrough.
5. Optional **LLM HTTP debug** intercept for wire verification of skill markers.
6. Full bodies remain on-demand via the existing **`skill` tool**.

Interchange may remain `SKILL.md` on disk; runtime authority is structured
policy + ranked/matched IDs (code-first, min-MD in system context).

## User Stories

- As a user with a large catalog (100+ skills) I want only a small, relevant
  Tier-1 list each turn so the model is not overloaded.
- As a user I want listing order to follow semantic ranking when the index is
  live, else path/trigger or lexical relevance to my prompt.
- As a user I want to load full skill bodies via the skill tool when needed.
- As an operator I want to change max/format from the TUI without restarting
  (config hot path) and have startup reindex keep skills searchable.
- As a maintainer I want pure unit tests for matcher and list policy, plus
  HTTP-level proof when debugging.

## Functional Requirements

### Matcher (deterministic)

1. OpenCode MUST implement pure `matchSkills(cwdFiles, prompt, catalog)` with
   no I/O inside the pure function (`packages/opencode/src/skill/match.ts`).
2. A skill matches when any cwd-relative file matches any `paths` glob OR any
   `triggers` entry appears as case-insensitive whole-word/token in the prompt.
3. Skills with `userInvocable === false` MUST be excluded from top-level match;
   hubs resolve highest-scoring variant as body source.
4. Cap matched set at MAX=7 with reserved trigger slots (fapp slot weighting).

### Tier-1 listing policy (`experimental.skill_list`)

5. Config surface `experimental.skill_list` MUST support:
   - `max_listed` (default 24, clamped 1–256)
   - `format`: `verbose` | `compact` | `names` (default `compact`)
   - `hard_cap` (default true) — apply max even when semantic ranking is absent
   - `show_status` (default true) — inject `[skill_list: mode=… ]` line
6. Natural order for the Tier-1 `<available_skills>` block MUST be:
   - **ranked** when F051 returns skill ids (preserve rank order; do not A–Z re-sort)
   - else **matched** when path/trigger meta + cwd/prompt available
   - else **lexical** scoring of name+description against prompt tokens
   - else membership order (never full-catalog A–Z as the designed path)
7. Empty ranked array MUST list zero skills (must not widen to full set).
8. Undescribed skills MUST be omitted from Tier-1 listing (skill tool still lists
   all discoverable names on error paths as today).
9. Full `SKILL.md` bodies MUST NOT be injected by default; skill tool remains
   the body path. Optional future `inject_bodies` remains deferred.

### Session wire

10. `SystemPrompt.skills` MUST accept order context `{ ranked?, prompt?, cwdFiles? }`
    and apply list policy after permission filter.
11. `SessionPrompt` MUST pass `narrowed.skills` and the turn `promptText` into
    `SystemPrompt.skills` each user turn.

### TUI (dynamic control)

12. Skills dialog MUST expose a **Skill list policy** control that patches
    global config `experimental.skill_list` (max/format/hard_cap/show_status)
    so the next turn reloads without process restart.

### Startup index jobs

13. When the live operator semantic `IndexPort` is available, OpenCode MUST
    fire-and-forget index jobs for collections **`skills`** and **`skill_chunks`**
    (default incremental reconcile; env `OPENCODE_SEMANTIC_STARTUP_INDEX=full`
    for full rebuild; `=0` disables). Fail-open: never block boot.
14. Jobs MUST log only bounded content-free counts (upserted/tombstoned), never
    skill bodies or secrets.

### Debug (optional)

15. `OPENCODE_DEBUG_LLM_HTTP=1` MUST wrap provider fetch to write per-request
    summaries (URL redacted, skill markers: available_skills / skill_content /
    auto_skills) under a debug dir; Authorization headers redacted. Optional
    body dump via `OPENCODE_DEBUG_LLM_HTTP_BODY=1`.

### Composition

16. Feature MUST compose with F051/F052: ranking and chunk autoprime remain
    authoritative when live; this feature caps/formats and provides offline
    natural fallbacks. Skill tool catalog for load-by-name is not reduced by
    the Tier-1 listing cap (tool may still load any discovered skill).

### Tests

17. Unit tests for matchSkills, applySkillListCap (ranked order preserved,
    lexical fallback, empty ranked), and SystemPrompt skills membership.
18. Live smoke (operator profile): discovery under OPENCODE_CONFIG_DIR; skill
    tool with/without; listing status line + cap; missing skill fail-closed.

## Security Requirements

- **Data sensitivity.** Skill names/descriptions may enter model context;
  bodies only via skill tool or explicit debug body dump. Catalog paths are
  operator-local.
- **Auth.** No new principals. Startup index uses system principal id
  `system:startup-index`. Config updates use existing global config auth.
- **Input validation.** max_listed clamped; globs/triggers from frontmatter
  bounded lists; HTTP debug redacts secrets.
- **Crypto.** N/A.
- **Logging.** Content-free index counts; debug dumps opt-in and redacted.
- **Errors.** Missing skill tool returns typed not-found + available names;
  index/startup failures fail-open.

## Acceptance Scenarios

Given a catalog of 100+ skills and skill_list max_listed=24 hard_cap=true
When a user turn runs without semantic ranked ids
Then at most 24 skills appear in available_skills
And a status line reports mode matched|lexical|passthrough and the cap.

Given F051 returns ranked skill ids including rust first for a rust prompt
When the system prompt is built
Then available_skills lists rust before lower-ranked skills
And format does not alphabetically re-sort the list.

Given the operator live IndexPort is available at OpenCode open
When the stack mounts
Then background index jobs for skills and skill_chunks are dispatched once
And failure does not prevent the server from starting.

Given OPENCODE_DEBUG_LLM_HTTP=1 and the model loads skill rust
When the LLM HTTP POST is intercepted
Then the request after the skill tool includes skill_content markers
And a request without skill load does not include skill_content.

Given the skill tool is called with an unknown name
When the tool executes
Then it fails closed with not found and does not inject a body.

## Observability

- Status line in system prompt when show_status true.
- Startup index console lines: collection + upserted/tombstoned counts.
- Optional HTTP debug NDJSON under config debug dir.
- No high-cardinality prompt/body labels in metrics.

## Out of Scope

- Porting fapp brain-mode / model-router / agent-prime hooks
- Converting all skills from MD to TS modules
- Replacing F051/F052
- Mandatory inject_bodies path (deferred)

## Clarifications

- C1 — Tier-1 listing cap does not remove skills from discovery for the skill tool.
- C2 — Natural order prefers semantic ranked when present; lexical is offline fallback.
- C3 — Startup jobs require live Milvus + embedding binding; otherwise fail-open.
- C4 — Personal catalog under OPENCODE_CONFIG_DIR/skills is first-class data, not fapp runtime.
