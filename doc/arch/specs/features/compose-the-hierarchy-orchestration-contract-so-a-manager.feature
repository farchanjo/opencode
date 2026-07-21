Feature: Compose the hierarchy orchestration contract so a Manager orchestrates its Workers
  As a maintainer of the Smart Routing hierarchy
  I want a Manager-role session to aggregate, gate, validate, and be woken by its delegated Workers
  So that a Manager orchestrates a set of Workers to completion without deadlocking, crashing, or silently finishing

  Background:
    Given Smart Routing is effectively enabled with mode "auto"
    And a Manager-role session dispatches Worker children through the Task spawn seam
    And the shared RoutingSessionState store and the session-owned Todo authority are wired

  Scenario: A Manager records a roll-up of every delegated Worker
    Given a Manager dispatches 3 Worker children
    When each dispatch is recorded on the shared store
    Then the Manager aggregate carries 3 WorkerOutcome entries keyed by child session id
    And each entry carries a WorkerLifecycle and a bounded TodoSummary roll-up
    And the roll-up counters total 3

  Scenario: A Manager turn is gated while a Worker is still pending
    Given at least one delegated Worker is still pending
    When the Manager reaches its turn boundary
    Then the completion gate returns blocked with the pending Worker count
    And the Manager turn is held open rather than reported complete

  Scenario: A failed Worker surfaces and satisfies the terminal gate
    Given every delegated Worker is terminal but one is failed
    When the completion gate is re-evaluated
    Then the gate is satisfied because all Workers are terminal
    And the failed Worker is represented in the aggregate with a bounded reason
    And the failure is surfaced into the Manager turn rather than blocking it forever

  Scenario: A Worker result is rejected when it fails the SHAPE stage
    Given a Worker returns a malformed result envelope
    When the Manager runs the ordered validation chain on the result
    Then the SHAPE stage fails and the result is rejected
    And the Worker is marked failed with a shape reason
    And the malformed result is never folded into the aggregate

  Scenario: A Worker result may be re-dispatched when it fails the POLICY stage
    Given a Worker returns a result that escaped the orchestration_only allowlist
    When the Manager runs the ordered validation chain on the result
    Then the SHAPE stage passes and the POLICY stage fails
    And the result is rejected and the unit may be re-dispatched

  Scenario: A Worker result surfaces a blocked reason when it fails the DOMAIN stage
    Given a Worker returns a well-formed and legal result with required Todo items incomplete
    When the Manager runs the ordered validation chain on the result
    Then the SHAPE and POLICY stages pass and the DOMAIN stage fails
    And a blocked completion reason is surfaced without crashing the Manager turn

  Scenario: A terminal Worker wakes the Manager exactly once, coalesced
    Given a delegated Worker reaches a terminal state
    When its terminal signal fires more than once for the same child session id
    Then the Manager is woken exactly once per Worker terminal transition
    And the aggregate advances and the completion gate is re-evaluated
    And no polling loop is used

  Scenario: A never-completing Worker is bounded by the max-wait
    Given a delegated Worker never reaches a terminal state
    When its bounded max-wait expires
    Then the Worker is force-transitioned to aborted with a timeout reason
    And the aggregate advances and the completion gate settles
    And the Manager turn never deadlocks

  Scenario: A disabled or non-auto session is byte-identical to today
    Given Smart Routing is disabled or in a non-auto mode
    When a Manager session dispatches a child
    Then no aggregate is recorded and no completion gate runs
    And no validation chain fires and no wake-rule engages
    And the existing foreground single-child spawn behavior is unchanged

  Scenario: A fan-out-denied Worker resolves the aggregate correctly
    Given the budget fan-out admission granted fewer Workers than requested
    When the Manager settles its delegated set
    Then a denied Worker produces no WorkerOutcome
    And the aggregate total counts only the granted Worker set
    And the completion gate settles over the granted set

  Scenario: A failure in the orchestration path degrades to today's ungated behavior
    Given a defect occurs while reading a child's Todo snapshot or evaluating the gate
    When the Manager turn proceeds
    Then the orchestration path degrades to the ungated single-child behavior
    And the Manager turn is never crashed, blocked, or deadlocked by the defect
