# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
Feature: Redesign the Operator TUI Domain Screens into True CRUD
  As an operator managing OpenCode through the native TUI
  I want each domain to render as a true CRUD screen — one palette entry, status
  and views on the screen, toggle rows, edit and view modals, and entity CRUD
  So that I manage configuration in one consistent way through the menu, never a
  flat wall of duplicated rows or a transient toast

  Background:
    Given the operator control plane flag is enabled
    And the operator dispatches through the Feature 007 OperatorClient loopback

  Scenario: The top-level palette shows exactly one Operator entry
    Given the top-level Commands palette is open
    When the Operator-category entries are listed
    Then exactly one "Operator" entry is present
    And no "View: Status" suggested rows are spread as top-level commands
    And the retired suggest machinery feeds no palette rows

  Scenario: Every row on a domain screen has a unique human title
    Given a domain screen is open
    When its rows are rendered
    Then no two rows on that surface share an identical human title
    And each row shows its dotted command id only as a secondary line

  Scenario: A domain screen renders its status inline on open
    Given a domain screen is opened
    When its silent status read returns
    Then the status renders as an inline section on the screen
    And no toast is emitted for the silent read

  Scenario: A detail verb opens a structural view modal, not a toast
    Given a plain domain exposes a detail verb
    When the operator invokes it
    Then a view modal renders the effective payload as a key/value tree
    And the modal closes on Esc
    And no toast is emitted

  Scenario: The status section refreshes after an on-screen mutation
    Given a mutation is dispatched from a domain screen and returns success
    When the dispatch completes
    Then the screen refetches its status section and reflects the committed change

  Scenario: A stale mutation leaves the prior state and surfaces the typed reason
    Given a mutation is dispatched from a domain screen with a stale version
    When the dispatch returns a version conflict
    Then the status section keeps the prior state
    And the typed version conflict reason is surfaced, not a fabricated success

  Scenario: An enable/disable pair renders as one toggle row
    Given a domain exposes an on/off verb pair
    When the screen renders the control
    Then a single toggle row shows the current-state badge
    And its action dispatches the opposite verb of the current state

  Scenario: A toggle on an unavailable backend is marked and inert
    Given an on/off verb whose backend is a typed capability gap
    When the toggle row renders
    Then the row is marked unavailable and inert
    And invoking it surfaces the typed envelope, never a fabricated success

  Scenario: A tri-state setting opens a pre-selected three-option picker
    Given smart routing is in "auto" mode
    When the operator opens its control
    Then a three-option picker of on, off, and auto opens pre-selected to auto
    And selecting a mode dispatches that mode's verb

  Scenario: An edit modal pre-fills the current value and validates per field
    Given an editable setting has a current effective value
    When the operator opens its edit modal
    Then each field is pre-filled with the current effective value
    And invalid input is rejected in the modal
    And Save dispatches through the existing path and closes the modal on success
    And a typed error surfaces in the modal, not a toast

  Scenario: Jobs render as a true CRUD list and item screen
    Given the jobs screen lists the scheduled jobs
    When the operator drills into a job
    Then the item screen offers edit, reschedule, an enable/disable toggle, and delete with confirm
    And the list offers create
    And run-now is marked as a typed capability gap

  Scenario: Semantic providers and models support entity CRUD
    Given the semantic screen lists providers and models
    When the operator manages an entity
    Then add, edit, rotate-secret, disable, and delete are available
    And secret values are handled as SecretRef only
    And the Milvus-gated index ops are marked as typed gaps

  Scenario: MCP servers support entity CRUD with a connect/disconnect toggle
    Given the mcp screen lists the configured servers
    When the operator manages a server
    Then add, edit, connect/disconnect, and delete are available
    And connect/disconnect renders as a toggle over the live service state

  Scenario: Command parity is preserved across every screen action
    Given the same command id is dispatched from palette, slash, CLI, and a CRUD screen
    When any screen action is invoked
    Then it rides the same OperatorClient loopback with no new dispatch path
    And no catalog id is added and no catalog version is bumped
