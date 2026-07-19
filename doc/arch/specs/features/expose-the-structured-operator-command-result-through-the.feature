Feature: Expose the Structured Operator Command Result Through the TUI
  As an operator using the TUI operator control plane
  I want the typed effective result of a command to reach the read panels and pickers
  So that panels render live state and pickers list real entities, honestly and without a new dispatch path

  Background:
    Given the operator control plane flag is enabled
    And the operator dispatch rides the same OperatorClient loopback as slash and CLI

  Scenario: The inbound adapter forwards the structured result
    Given a command whose CommandResult carries a typed effective payload and version
    When the TUI inbound adapter builds its tryHandle return
    Then the return forwards the typed outcome, the optional effective payload, and the version
    And it introduces no new dispatch path or command name

  Scenario: A live view renders effective state
    Given the langlock domain panel is open
    When the operator selects langlock.show
    Then the langlock read panel renders the effective policy and allowlist state
    And no mutation is dispatched

  Scenario: An unavailable read falls back to the honest empty signal
    Given a domain whose read backend is not implemented
    When the operator opens its read panel
    Then the panel renders its EMPTY panel signal baseline
    And the UI does not imply that any data was fetched

  Scenario: A shape mismatch never crashes the panel
    Given a read whose effective payload does not match the expected panel shape
    When the per-domain projection runs
    Then the projection returns the honest empty signal
    And the panel renders without throwing

  Scenario: A jobs entity picker populates from a read query
    Given the jobs Configure section
    When the operator selects jobs.delete
    Then the picker loads job-definition options projected from a jobs.list read on the same path
    And the selected value is the jobDefinitionId taken from the payload

  Scenario: An entity picker is honest-empty when the read is unavailable
    Given process.cancel when process.tree returns no effective payload
    When the picker opens
    Then it renders its honest empty view with no fabricated candidate

  Scenario: Back navigation unwinds exactly one level
    Given Home then the jobs domain then a read panel opened via the Dialog push primitive
    When the operator presses escape
    Then exactly one level is popped and the jobs domain panel is shown
    And the whole dialog is not closed
