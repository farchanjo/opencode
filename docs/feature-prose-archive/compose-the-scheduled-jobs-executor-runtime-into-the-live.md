# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
Feature: Compose the Scheduled Jobs Executor Runtime into the Live Runtime
  As an operator
  I want the shipped-but-idle Feature 002/003 scheduled executor composed into the live runtime
  So that scheduled jobs actually run, run-now fires, history reflects real executions, and the forced abort interrupts

  Background:
    Given the operator control plane flag is enabled
    And the Feature 002 execution seams and the Feature 003 scheduler machinery are present

  Scenario: Arm the executor eagerly and fail open at server start
    Given an enabled scheduled definition is persisted
    When the server starts
    Then the scheduler engine, cron adapter, and trigger service arm at listen() independent of the operator stack
    And the definition re-registers on the startup reconcile sweep without claiming past execution
    And a construction or arming fault is caught so the server still starts with the executor disarmed
    And the schedule and run-now verbs stay at their typed capability gap while disarmed

  Scenario: A due occurrence becomes a real headless session
    Given the executor is armed
    When a definition's cron time fires and onDue claims the occurrence
    Then the TaskProcessCoordinator admits it under the Feature 002 admission and Feature 001 routing gates
    And it creates the Task Process with owner_kind scheduled-job
    And it provisions the occurrence-owned Todo and OutputGroup before goal-bearing work
    And the session runs headless and captures output through the shared Feature 017 spool writer
    And it emits the terminal occurrence events
    And a denied admission is reported honestly, never a fake admitted

  Scenario: Run a job now through the effectful mutation plan
    Given jobs.run-now rides the mutation_plan contract with an effectful apply
    When the operator dispatches it against an armed executor
    Then mutateAuthority runs the effect exactly once after the contract, idempotency, and CAS checks
    And an immediate occurrence is enqueued and the occurrence identity is returned
    And an idempotent replay returns the stored result without re-enqueuing

  Scenario: Run-now honours the overlap policy
    Given a run is already in flight under a forbid overlap policy
    When the operator dispatches jobs.run-now
    Then it returns the typed overlap rejection, never a second concurrent occurrence

  Scenario: Run-now degrades when the executor is disarmed
    Given the eager arming failed open and the executor is disarmed
    When the operator dispatches jobs.run-now
    Then it returns the typed unavailable capability gap, never a fabricated occurrence

  Scenario: See real occurrence history keyed by definition
    Given the executor emits definition-keyed occurrence events
    When a job runs and the operator runs jobs.history, jobs.show-occurrences, and jobs.watch
    Then the projection resolves the job.* events by jobDefinitionId
    And history reflects the real executions instead of an honest-empty list
    And the watch subscription is bounded and closable

  Scenario: Second-press forced abort actually interrupts the active run
    Given the execution layer registered the active root run into the narrow interrupt registry
    When the operator issues the second-press forced abort
    Then the operator consults the registry and drives SessionRunCoordinator.interrupt so the active root run stops
    And the first-press cancel with cancel_requested and the admission fence is unchanged

  Scenario: Forced abort degrades honestly when no interrupt entry exists
    Given the requested root key is absent from the interrupt registry
    When the operator issues the second-press forced abort
    Then it degrades to the honest unconfirmed cancel outcome, never a fabricated stop

  Scenario: A scheduled session never bypasses a permission or config surface
    Given a scheduled session and a normal interactive session request the same capability
    When each runs
    Then the scheduled session is subject to the identical permission and config surfaces
    And a capability a headless session cannot satisfy degrades to a typed terminal outcome, never an auto-approved bypass

  Scenario: The availability map reflects the composed truth
    Given the executor is composed
    When the grouped operator menu derives availability
    Then jobs.run-now and the process and task cancel read as the composed truth
    And mcp.auth.start and mcp.auth.finish stay honest_unavailable
    And no verb advertises a capability it still lacks

  Scenario: Command parity is preserved across surfaces
    Given the same command id is dispatched from palette, slash, CLI, and TUI
    When any composed verb is invoked
    Then it rides the same OperatorClient loopback with no new dispatch path
    And no catalog id is added and no catalog version is bumped
