Feature: Expose The Hierarchy Capability And Budget Operator Config
  As an operator
  I want to view and edit every hierarchy, capability, and budget enforcement leaf
  So that I can audit and tune the routing policy from both the op CLI and the TUI
     without hand-editing config files

  Background:
    Given the routing enforcement config exposes budget, hierarchy, and capability blocks
    And the op CLI and the TUI both consume one shared enforcement-leaf registry

  Scenario: Read the effective capability leaves through op
    Given a project with no explicit routing config
    When the operator runs "op capability show"
    Then the effective metadata_source, unknown_policy, and probing_enabled are shown
    And the values are projected from the layered (project over global over default) config

  Scenario: Set a single hierarchy leaf on the project scope
    Given a project with no explicit routing config
    When the operator sets hierarchy max_depth to 1 on the project scope
    Then only enforcement.hierarchy.max_depth changes to 1 on the project routing document
    And orchestration_only, activation, and role_pools are preserved
    And the global routing document is not written
    And the CAS version is bumped

  Scenario: Reject an out-of-bounds numeric value at the write boundary
    When the operator sets budget cost_budget_usd to -5
    Then the command is rejected with a typed invalid_argument naming cost_budget_usd
    And nothing is persisted

  Scenario: Reject an unknown enum member
    When the operator sets capability unknown_policy to "maybe"
    Then the command is rejected with a typed invalid_argument naming unknown_policy
    And the allowed members deny and allow are listed

  Scenario: Global scope requires the explicit flag and lands on the global authority
    When the operator sets hierarchy max_depth to 1 with "--scope global"
    Then the write persists to the global routing authority
    And the project routing document is not written

  Scenario: The TUI prefills each leaf from the effective config and re-reads on scope switch
    Given the operator opens the capability screen on a project
    When the screen prefills its fields
    Then each field shows the effective (layered) value
    And switching the scope selector to global re-reads and re-prefills from the global config

  Scenario: op and TUI have parity over every enforcement leaf
    Given every leaf the op CLI can edit for a domain
    When the operator opens the corresponding TUI screen
    Then the same leaves are editable with the same validation and the same effective-config read
