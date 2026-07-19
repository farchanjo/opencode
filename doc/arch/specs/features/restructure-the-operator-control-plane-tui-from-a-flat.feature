Feature: Grouped operator control plane TUI navigation
  As an operator using the OpenCode TUI
  I want the operator palette grouped into domains with editable forms and honest availability
  So that I can find, configure, and view operator state without a flat wall of verbs or fake success

  Background:
    Given the operator control plane flag is enabled
    And the operator palette is open

  Scenario: Open the Operator menu
    When the operator selects the single "Operator" entry
    Then the home group list shows all 12 reserved domains
    And each domain row shows a human label and an availability badge
    And no flat per-verb rows appear at the top level of the palette

  Scenario: Drill into a domain
    Given the home group list is shown
    When the operator selects the "langlock" domain
    Then a domain panel is pushed onto the dialog stack
    And the panel shows a "View" section of read-only queries
    And the panel shows a "Configure" section of mutations
    And confirm-required and secret-bearing verbs are marked in their rows

  Scenario: Run a read-only query
    Given the "langlock" domain panel is shown
    When the operator selects the "langlock.show" view verb
    Then the langlock read panel renders the effective state from the operator result signal
    And no mutation is dispatched
    And the panel falls back to its honest empty state when no signal is present

  Scenario: Configure langlock via a form that persists
    Given the "langlock" domain panel is shown
    When the operator selects the "langlock.set" configure verb
    And the value picker collects a target language
    And the operator confirms the change
    Then "langlock.set" is dispatched with the collected payload
    And the dispatch flows through the same OperatorClient loopback as slash and CLI
    And the change persists with a version and an audit record

  Scenario: Invoke an unavailable verb without false success
    Given a domain whose backend is not implemented
    When the operator invokes a mutation verb marked unavailable
    Then the typed unavailable envelope is surfaced
    And the UI does not imply that any change persisted
    And no success message is synthesized
