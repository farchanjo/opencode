# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
Feature: Always-mode Smart Routing activation
  As an operator
  I want the `always` activation mode to re-evaluate Smart Routing on every turn
  So that a role, pool, or config change takes effect on the next turn without a
  new session, while an explicit model always wins and disabled stays a no-op.

  Background:
    Given Smart Routing is enabled with a populated role pool
    And the session model-selection seam consults the routing resolver

  Scenario: Always mode re-evaluates routing on every turn
    Given the activation mode is "always"
    And the session already routed to a model on its first turn
    When a later turn is prompted after the operator changed the role pool
    Then routing re-evaluates fresh with no persisted-model short-circuit
    And the changed pool takes effect on that turn without a new session

  Scenario: Auto mode short-circuits on the persisted model
    Given the activation mode is "auto"
    And the session already routed to a model on its first turn
    When a later turn is prompted
    Then the resolver serves the memoized first decision
    And it does not re-evaluate routing

  Scenario: An explicit model always wins under always mode
    Given the activation mode is "always"
    And the turn carries an explicit "--model" or an agent-pinned model
    When the turn is prompted
    Then routing is not consulted
    And the explicit model is used unchanged

  Scenario: Disabled or never is byte-identical to no routing
    Given Smart Routing is disabled or the activation mode is "never"
    When any turn is prompted
    Then no routing runs and no per-turn re-evaluation occurs
    And the static default or persisted model is used exactly as before

  Scenario: Always mode engages the hierarchy delegation gate
    Given the activation mode is "always"
    When a Task spawn resolves hierarchy dispatch
    Then delegation engages exactly as under auto mode with a routed child role and model

  Scenario: The always path is hang and crash safe
    Given the activation mode is "always"
    And the config read dies or a decision commit never settles
    When a turn is prompted
    Then the mode read degrades to "never" and the resolver degrades to undefined within the timeout
    And the turn falls back to the static default without hanging or crashing
