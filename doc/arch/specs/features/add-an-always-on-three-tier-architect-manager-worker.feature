Feature: Add An Always On Three Tier Architect Manager Worker
  As an operator
  I want an opt-in mode where every Architect task flows Architect -> Manager ->
  Worker(s) -> Manager -> Architect on dedicated per-tier models
  So that decomposition, delegation, and aggregation happen on every task while
  the existing heuristic stays the byte-identical default

  Background:
    Given Smart Routing is enabled with mode "auto"
    And the routing role pools "manager" and "worker" are populated

  Scenario: force_manager classifies the architect edge as a Manager
    Given "hierarchy.orchestration_mode" is "force_manager"
    When the Architect spawns a subagent for a single-clause task
    Then the child role is "manager"
    And the Manager resolves its model from the "manager" role pool

  Scenario: heuristic keeps the architect edge a direct Worker for a simple task
    Given "hierarchy.orchestration_mode" is "heuristic"
    When the Architect spawns a subagent for a single-clause task
    Then the child role is "worker"

  Scenario: force_manager lets the Manager reach a Worker through the depth guard
    Given "hierarchy.orchestration_mode" is "force_manager"
    And "subagent_depth" is unset and "hierarchy.max_depth" is 2
    When a Manager at delegation depth 1 dispatches a Worker
    Then the spawn passes the depth guard
    And no "Subagent depth limit reached" error is raised

  Scenario: a Worker leaf cannot spawn a Manager
    Given "hierarchy.orchestration_mode" is "force_manager"
    When a Worker at delegation depth 2 attempts to spawn a subagent
    Then the spawn is refused
    And no Manager child is created

  Scenario: an explicit model wins in force_manager
    Given "hierarchy.orchestration_mode" is "force_manager"
    And the spawn carries an explicit model
    When the child is spawned
    Then the hierarchy resolver is not consulted
    And the explicit model is used

  Scenario: an unresolved tier model is surfaced, not silently inherited
    Given "hierarchy.orchestration_mode" is "force_manager"
    And the "manager" role pool model cannot resolve to an authenticated provider
    When the resolver evaluates the Manager tier
    Then a visible warning is surfaced
    And a telemetry observation with reason "model_unresolved" is emitted
    And the tier degrades to parent inheritance without blocking the turn

  Scenario: a hung Worker does not deadlock the turn
    Given "hierarchy.orchestration_mode" is "force_manager"
    And a foreground Worker hangs
    When "WORKER_MAX_WAIT_MS" elapses
    Then the Worker is force-aborted
    And the completion gate settles with a bounded error

  Scenario: the Manager persona is injected on the manager-role spawn
    Given "hierarchy.orchestration_mode" is "force_manager"
    When the Manager-role child session prompt is assembled
    Then the Manager persona prelude is prepended to the task prompt

  Scenario: heuristic mode injects no Manager persona
    Given "hierarchy.orchestration_mode" is "heuristic"
    When a Manager-role child session prompt is assembled
    Then no Manager persona prelude is prepended
