# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/052-auto-skill-semantic-chunk-auto-priming-fourth-retrieval-pass/spec.md
# (FR1-FR8, Acceptance Scenarios) and the approved semantic-selection plan
# (Feature SR-C). Prose-style scenarios describe intended behavior precisely
# enough for later automation; they do not require concrete step bindings.

Feature: Auto Skill Semantic Chunk Auto Priming Fourth Retrieval Pass
  As a user sending a prompt in a live opencode session
  I want relevant skill content auto-primed into the system prompt
  So that the model gets the guidance it needs without a tool round trip, and only from skills I trust

  Background:
    Given the Feature 051 live per-turn narrowing is wired and its skills gate is enabled
    And the "skill_autoprime" gate is enabled
    And the semantic index's "skill_chunks" collection is populated and reachable

  # ---------------------------------------------------------------------------
  # Fourth retrieval pass, same turn context as the three SR-B surfaces (FR1)
  # ---------------------------------------------------------------------------

  Scenario: The skill_chunks pass reuses the turn's single embedding, deadline, and memo
    Given a user turn that already computes NarrowedSets for agents, skills, and tools
    When "narrowForTurn" runs with "skill_autoprime" enabled
    Then the skill_chunks retrieval pass runs concurrently with the other three surfaces
    And it reuses the SAME prompt embedding, the SAME latency budget, and the SAME "lastUser.id" memo key
    And a subsequent runLoop step within the same turn reads the identical memoized chunk set

  Scenario: skill_autoprime composes with, but does not replace, the skills gate
    Given "skill_autoprime" is enabled and the Feature 051 skills gate is disabled
    When "narrowForTurn" resolves the turn
    Then the skill_chunks retrieval pass never runs
    And no "<auto_skills>" block is rendered

  # ---------------------------------------------------------------------------
  # Confidence threshold (FR2)
  # ---------------------------------------------------------------------------

  Scenario: A prompt squarely in a seeded skill's domain clears the confidence floor
    Given a prompt whose top skill_chunk candidates score at or above the configured "score_floor"
    When the skill_chunks pass completes
    Then those candidates are kept as the turn's chunk set
    And the Tier-1 "<available_skills>" listing is unaffected

  Scenario: An off-domain prompt yields zero qualifying candidates
    Given a prompt whose skill_chunk candidates all score below the configured "score_floor"
    When the skill_chunks pass completes
    Then the chunk surface resolves to passthrough (no injection)
    And no "<auto_skills>" block is rendered
    And the Tier-1 "<available_skills>" listing still renders normally

  # ---------------------------------------------------------------------------
  # <auto_skills> render via the OutputSpool store, never the raw file (FR3)
  # ---------------------------------------------------------------------------

  Scenario: Qualifying chunks are rendered into an <auto_skills> block resolved from the spool
    Given a turn whose chunk set contains one or more qualifying skill_chunk candidates
    When "SystemPrompt.Service" renders the auto-skills block
    Then each chunk body is resolved via "OutputSpoolStore.resolve" using the chunk's body_ref
    And the raw SKILL.md file is never read directly
    And the rendered block appears beside "<available_skills>" in the system prompt

  Scenario: A dangling or superseded body_ref is skipped silently
    Given a skill file was deleted or edited without a reindex having run yet
    And a chunk in the turn's chunk set still references the stale body_ref
    When "SystemPrompt.Service" renders the auto-skills block
    Then that chunk is skipped without error
    And no stale content is injected into the system prompt
    And the turn completes normally

  # ---------------------------------------------------------------------------
  # Render-time budgets, exclusive to Tier 2 (FR4)
  # ---------------------------------------------------------------------------

  Scenario: The rendered block never exceeds the configured chunk or token budget
    Given a turn whose qualifying chunk set exceeds "max_skill_chunks" or "max_skill_tokens"
    When "SystemPrompt.Service" renders the auto-skills block
    Then the block is truncated to stay within both budgets
    And neither budget is ever spent by the Tier-1 "<available_skills>" listing

  # ---------------------------------------------------------------------------
  # Provenance trust boundary — local only, remote opt-in (FR5)
  # ---------------------------------------------------------------------------

  Scenario: A local, user-authored skill's chunks are eligible for auto-injection
    Given a qualifying skill_chunk candidate whose parent skill has provenance "local"
    When the turn's chunk set is assembled
    Then that candidate remains eligible for the "<auto_skills>" block

  Scenario: A remote pack skill's chunks are never auto-injected without opt-in
    Given a qualifying skill_chunk candidate whose parent skill has provenance "remote-pack"
    And that pack's "autoprime_opt_in" is false
    When the turn's chunk set is assembled
    Then that candidate is excluded from the "<auto_skills>" block
    And the parent skill remains listed in "<available_skills>" and loadable via the skill tool

  Scenario: A remote pack that explicitly opts in is eligible for auto-injection
    Given a qualifying skill_chunk candidate whose parent skill has provenance "remote-pack"
    And that pack's "autoprime_opt_in" is true
    When the turn's chunk set is assembled
    Then that candidate remains eligible for the "<auto_skills>" block

  # ---------------------------------------------------------------------------
  # Session dedup (FR6)
  # ---------------------------------------------------------------------------

  Scenario: A skill already fully injected this session is not re-injected
    Given a skill's chunks were already injected into the system prompt earlier in this session
    When a later turn's chunk set again ranks that skill highly
    Then that skill's chunks are not injected a second time
    And the skill tool remains available to load its full body on demand

  # ---------------------------------------------------------------------------
  # Fail-open, content-free observability (FR8)
  # ---------------------------------------------------------------------------

  Scenario: A skill_chunks retrieval or resolve failure never blocks the turn
    Given the skill_chunks retrieval pass or a body_ref resolution fails
    When the turn completes
    Then no "<auto_skills>" block is rendered
    And the turn completes normally without an error surfaced to the user
    And any debug log entry records only chunk ids and scores, never chunk content

  # ---------------------------------------------------------------------------
  # Disabled path is byte-identical (mirrors Feature 051 AC7)
  # ---------------------------------------------------------------------------

  Scenario: skill_autoprime disabled renders byte-identical to Feature 051 behavior
    Given "skill_autoprime" is disabled
    When a live turn runs before and after this feature is deployed
    Then no skill_chunks retrieval pass is attempted
    And the rendered system prompt is byte-identical to Feature 051's output
