# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/054-surface-subagent-provider-model-effort-and-tokens-in-task/spec.md
# (FR1-FR4, AC1-AC4) and ADR-0054. Prose-style scenarios describe intended behavior
# for humans and unit/integration tests; they do not require concrete step bindings
# in `speckit verify` (project-wide: no executable step harness yet — same stance as
# Features 009/010/052/053). Covered by packages/opencode test/tool/task.test.ts and
# packages/tui test/cli/tui/inline-tool-wrap-snapshot.test.tsx plus live smokes.
Feature: Surface subagent provider, model, effort, and tokens in the task line
  As an opencode TUI user
  I want each completed subagent task line to show the executor coordinates and token usage
  So that I can see which model ran the delegated work and what it consumed without opening the child session

  Scenario: completed foreground task shows executor and token summary
    Given a foreground subagent task completes on "openai/gpt-5.6-terra-fast" with reasoningEffort "xhigh"
    And the child session recorded 10200 input tokens and 1300 output tokens
    When the TUI renders the completed task line
    Then the detail line contains the toolcall count and duration
    And it contains "openai/gpt-5.6-terra-fast (xhigh)"
    And it contains a compact token summary for input and output

  Scenario: model without configured effort omits the effort segment
    Given a completed task whose model has no configured reasoningEffort
    When the TUI renders the completed task line
    Then the detail line contains the provider and model coordinates
    And it contains no parenthesised effort segment

  Scenario: legacy metadata renders byte-identically
    Given a completed task part whose metadata carries none of the new keys
    When the TUI renders the completed task line
    Then the detail line is byte-identical to the pre-054 rendering

  Scenario: child session read failure degrades to spawn-time metadata
    Given the child session record cannot be read at completion
    When the task tool returns its completed result
    Then the task result is still successful
    And its metadata equals the spawn-time envelope unchanged
