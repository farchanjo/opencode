# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
Feature: Polish the operator domain screen layout so the screen reads
  As an operator managing a domain through the control-plane TUI
  I want the domain screen to read header, then a compact status, then clean rows
  So that the panel reads top to bottom and the primary affordance is obvious

  Background:
    Given the operator control plane flag is enabled
    And the operator opens a domain screen from the single Operator entry

  Scenario: The screen reads header first, status second, search third, list fourth
    Given the MCP domain screen is opened
    When it renders
    Then the header "Operator · Mcp" renders first
    And the inline status section renders below the header
    And the search renders below the status
    And the action list renders below the search
    And the status section never renders above the header

  Scenario: Empty status groups collapse to a single summary line
    Given a domain screen whose servers, resources, experimental, and calls groups are empty
    When the status section renders
    Then no per-group "no <thing>" line renders for the empty groups
    And a single summary line "servers · resources · experimental · calls: empty" renders

  Scenario: Populated status groups render in full while honest states stay explicit
    Given a domain screen whose servers group is populated and whose read is still loading
    When the status section renders
    Then the populated servers group renders in full
    And the honest "Loading" state renders explicitly and is not collapsed into the empty summary

  Scenario: Action rows carry the action with no boilerplate or per-row kind badge
    Given a domain screen's action rows
    When they render
    Then each row title is the action, not "Read-only view" with the id
    And the "Read-only view" boilerplate prefix is absent
    And no per-row "view" kind badge renders
    And the section header carries the kind for its rows

  Scenario: The command id shows only when it fits without truncation
    Given an action row whose dotted command id fits the row width
    When it renders
    Then the command id renders as a single secondary line
    And a row whose command id would truncate mid-token omits the command id instead

  Scenario: An availability marker renders only when the verb is not fully available
    Given a fully-available verb and an unavailable verb on the same screen
    When their rows render
    Then the fully-available row carries no availability marker
    And the unavailable row carries the "unavailable" marker

  Scenario: Configure leads with the primary affordance on an entity domain
    Given the MCP screen with no servers configured
    When it renders
    Then the Configure section renders before the View section
    And the first Configure rows are "Add server" and "Servers"
    And selecting "Add server" opens the existing create flow
    And selecting "Servers" opens the existing list to item CRUD screen

  Scenario: Entity-first affordances per collection domain
    Given the jobs and semantic domain screens
    When they render
    Then jobs leads Configure with "Create job" and "Jobs"
    And semantic leads Configure with "Add provider" and the providers and models lists

  Scenario: Nothing behavioral changes under the polish
    Given the same command id is dispatched from the palette, slash, CLI, and the domain screen
    When any screen action is invoked
    Then it rides the same OperatorClient loopback with no new dispatch path
    And no catalog id is added and no catalog version is bumped
    And an unavailable verb stays marked and inert
