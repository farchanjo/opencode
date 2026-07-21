# Source: doc/arch/sdd/053-deterministic-orchestration-handoff-role-to-agent-binding/spec.md
# (FR1-FR8, Acceptance Scenarios) and the approved deterministic-orchestration
# plan (Feature ORCH). Prose-style scenarios describe intended behavior precisely
# enough for later automation; they do not require concrete step bindings.

Feature: Deterministic Orchestration Handoff Role To Agent Binding
  As an operator running the opt-in force_manager orchestration mode
  I want the manager role bound to a specific agent and its task deterministically
    reconnoitered and decomposed before the Manager's own turn starts
  So that a manager-role spawn is predictable and its Workers are addressed by a
    validated brief instead of the LLM's unchecked first-turn judgment

  Background:
    Given "orchestration_mode" resolves to "force_manager"
    And "manager_agent", "data_agent", and "composer_agent" are all bound to existing, unpinned, resolvable agents

  # ---------------------------------------------------------------------------
  # Role-to-agent binding (FR1)
  # ---------------------------------------------------------------------------

  Scenario: A manager-role spawn is overridden to the bound manager_agent
    Given an Architect task that classifies its child as "manager"
    When the spawn resolves its agent
    Then the spawn runs the bound "manager_agent", not the LLM-chosen "subagent_type"

  Scenario: An unresolvable or model-pinned manager_agent binding degrades to today's behavior
    Given "hierarchy.manager_agent" names an agent that does not exist, or that carries a pinned model
    When a manager-role spawn resolves its agent
    Then the spawn runs the LLM-chosen "subagent_type" unchanged
    And exactly one content-free warning is emitted
    And the spawn is never blocked

  Scenario: data_agent defaults to the builtin read-only explore agent
    Given "hierarchy.data_agent" is absent
    When the Data stage of the interception runs
    Then it runs the builtin "explore" agent

  Scenario: composer_agent has no default and its absence skips the Composer stage
    Given "hierarchy.composer_agent" is absent
    When the interception reaches the Composer stage
    Then the Composer stage is skipped and the whole interception degrades to the raw prompt

  # ---------------------------------------------------------------------------
  # Synchronous, in-binary interception — never a delegation (FR2)
  # ---------------------------------------------------------------------------

  Scenario: Data then Composer run as synchronous sub-sessions before the Manager persona is applied
    Given a manager-role spawn eligible for interception
    When "tool/task.ts" assembles the spawn's prompt
    Then a Data sub-session runs first, followed by a Composer sub-session
    And both run via the existing synchronous TaskPromptOps primitive
    And this happens strictly before the Manager persona prelude is applied

  Scenario: Neither Data nor Composer consumes a delegation edge or a worker slot
    Given "max_delegation_depth" is at its schema cap of 2 for an in-progress Architect -> Manager -> Worker chain
    When the Data and Composer sub-sessions run as part of the interception
    Then neither sub-session is evaluated against the delegation depth limit
    And neither sub-session is evaluated against the max_workers fan-out budget

  # ---------------------------------------------------------------------------
  # Composer catalog — fresh retrieval, fail-open (FR3)
  # ---------------------------------------------------------------------------

  Scenario: The Composer's catalog is a fresh retrieval for the subtask, not the turn memo
    Given a Composer sub-session about to run
    When its specialist catalog is assembled
    Then a fresh retrieveAgents call is issued using the subtask's own text
    And the parent turn's per-turn narrowing memo is never consulted for this catalog

  Scenario: A catalog retrieval failure falls open to the full specialist registry
    Given the fresh retrieveAgents call fails or returns no results
    When the Composer's catalog is assembled
    Then the Composer receives the full list of visible, non-hidden specialists
    And the Composer is never handed an empty or missing catalog

  # ---------------------------------------------------------------------------
  # Composed brief becomes the Manager's prompt; degrade path (FR4)
  # ---------------------------------------------------------------------------

  Scenario: A successfully composed brief replaces the raw prompt fed to the Manager persona
    Given Data and Composer both complete successfully
    When the Manager persona prelude is applied
    Then it wraps the Composer's composed brief, not the raw Architect prompt
    And the Manager receives the brief as its prompt

  Scenario: A Data or Composer failure degrades the whole interception to the raw prompt
    Given the Data sub-session fails, times out, or its bound agent does not resolve
    When the Manager spawn proceeds
    Then the Manager receives the raw Architect prompt unchanged
    And exactly one content-free warning is emitted
    And no new retry is attempted for the failed stage

  # ---------------------------------------------------------------------------
  # Re-entrancy guard — structurally closed (FR5)
  # ---------------------------------------------------------------------------

  Scenario: A Data or Composer sub-session is stamped synthetic before it runs
    Given a Data or Composer sub-session is about to be created
    When its session is created
    Then it is stamped synthetic in the session routing state before its own turn runs

  Scenario: A synthetic sub-session can never re-trigger the interception
    Given a Composer sub-session's own turn attempts to call task in a way that would otherwise classify as a manager-role spawn
    When that spawn attempt is evaluated
    Then the interception does not fire a second time
    And across the whole run, zero nested interceptions are ever observed

  # ---------------------------------------------------------------------------
  # Brief validation against the full registry; repair, not silent drop (FR6)
  # ---------------------------------------------------------------------------

  Scenario: A hallucinated specialist name with an unambiguous valid substitute is repaired
    Given the Composer's brief names a specialist that does not exist in the live registry
    And an unambiguous highest-ranked valid specialist exists for that subtask
    When the brief is validated
    Then that subtask's specialist name is repaired to the valid substitute
    And the Manager never sees the invalid name

  Scenario: A hallucinated specialist name with no unambiguous substitute is flagged, not dropped
    Given the Composer's brief names a specialist that does not exist in the live registry
    And no unambiguous valid substitute exists for that subtask
    When the brief is validated
    Then that subtask is flagged in the brief for the Manager to route explicitly
    And the subtask is never silently dropped from the plan

  Scenario: Brief validation uses the full live registry, not the narrowed retrieval catalog
    Given a specialist name that is valid in the live registry but missed the fresh retrieval catalog's top-K ranking
    When the brief is validated
    Then that specialist name is accepted, not rejected
    And the narrowed catalog is treated only as ranking input, never as the legality check

  # ---------------------------------------------------------------------------
  # Gates and byte-identical default (FR7)
  # ---------------------------------------------------------------------------

  Scenario: The interception never runs outside force_manager
    Given "orchestration_mode" resolves to "heuristic" (the default)
    When an Architect delegates a task
    Then the interception code path never executes

  Scenario: An unbound configuration renders byte-identical to Feature 048's shipped behavior
    Given "hierarchy.manager_agent", "hierarchy.data_agent", and "hierarchy.composer_agent" are all absent
    When a force_manager Architect delegates a task before and after this feature is deployed
    Then the rendered Manager spawn and its prompt are byte-identical

  # ---------------------------------------------------------------------------
  # Content-free observability (FR8)
  # ---------------------------------------------------------------------------

  Scenario: Interception stage outcomes are logged content-free
    Given an interception attempt runs to completion, whether it ran, degraded, or was skipped
    When its outcome is recorded
    Then the log contains only stage identifiers, result enums, and durations
    And it never contains subtask text, agent output, or brief content

  Scenario: Brief validation emits a bounded tally, never specialist names
    Given a brief validation pass with a mix of valid, repaired, and flagged subtasks
    When the tally is recorded
    Then it contains only valid/repaired/flagged counts
    And it never contains specialist names or subtask text
