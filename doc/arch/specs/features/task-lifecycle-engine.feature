# Source: doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md
# (FR1-FR65, AC1-AC47, C1-C26). Prose-style scenarios describe intended behavior
# precisely enough for later automation; they do not require concrete step bindings.

Feature: Task Lifecycle Engine
  As an operator and a session owner
  I want a projected, idempotent, bounded lifecycle for every Task attempt
  So that visibility, cancellation, handoff, and recovery stay canonical and honest

  # ---------------------------------------------------------------------------
  # State machine legal transitions (C7, FR25)
  # ---------------------------------------------------------------------------

  Scenario Outline: Legal Process Table state transition on a lifecycle event
    Given a process row in state "<from_state>"
    When the projector applies a "<event>" lifecycle event for that process
    Then the row transitions to state "<to_state>"
    And the transition is recorded without inventing a terminal state

    Examples:
      | from_state | event            | to_state  |
      | created    | admitted         | queued    |
      | queued     | started          | running   |
      | queued     | waiting          | waiting   |
      | waiting    | promoted         | running   |
      | running    | waiting          | waiting   |
      | queued     | cancel_requested | cancelling |
      | waiting    | cancel_requested | cancelling |
      | running    | cancel_requested | cancelling |
      | cancelling | cancelled        | cancelled |
      | cancelling | failed           | failed    |
      | cancelling | unknown          | unknown   |
      | running    | completed        | completed |
      | running    | failed           | failed    |
      | created    | zombie_detected  | zombie    |
      | queued     | zombie_detected  | zombie    |
      | waiting    | zombie_detected  | zombie    |
      | running    | zombie_detected  | zombie    |
      | created    | owner_lost       | unknown   |
      | queued     | owner_lost       | unknown   |
      | waiting    | owner_lost       | unknown   |
      | running    | owner_lost       | unknown   |

  Scenario Outline: Illegal Process Table state transition is rejected
    Given a process row in state "<from_state>"
    When the projector receives a "<event>" lifecycle event that implies state "<to_state>"
    Then the transition is rejected as illegal for the state machine
    And the row remains in state "<from_state>"
    And the rejection is an observable anomaly, not a silently invented terminal state

    Examples:
      | from_state | event     | to_state  |
      | completed  | started   | running   |
      | cancelled  | admitted  | queued    |
      | created    | completed | completed |
      | zombie     | promoted  | running   |
      | unknown    | started   | running   |

  Scenario: Handoff is an event, never a Process Table state
    Given a running process that receives a canonical handoff
    When the handoff event is projected
    Then the process retains its current Process Table state
    And no Session or process ever reports "handoff" as its status

  # ---------------------------------------------------------------------------
  # Idempotent projection under duplicate events (C9, AC14)
  # ---------------------------------------------------------------------------

  Scenario: Duplicate delivery of the same durable event is idempotent
    Given a durable "completed" lifecycle event already projected for a process
    When the identical event is delivered a second time with the same event id and (aggregateID, seq)
    Then the Process Table state does not change a second time
    And the projector records a "duplicate" anomaly
    And no new terminal state is invented

  Scenario: Out-of-order delivery surfaces an anomaly without inventing state
    Given a durable aggregate with the last applied sequence at seq 5
    When an event for that aggregate arrives with seq 3
    Then the projector detects an "out_of_order" anomaly
    And the Process Table row is not regressed to an earlier lifecycle state
    And the anomaly is observable to operators and telemetry

  Scenario: Unknown process reference surfaces an anomaly
    Given a lifecycle event referencing a process id with no known Process Table row
    When the projector applies that event
    Then it records an "unknown_process" anomaly
    And it does not fabricate a new row with an invented lifecycle history

  # ---------------------------------------------------------------------------
  # Restart rehydration with unknown/unreconciled rows (C6, C13, AC13)
  # ---------------------------------------------------------------------------

  Scenario: Restart rebuilds the Process Table by replaying the durable aggregate
    Given a durable EventV2 aggregate with prior admitted, started, and turn events
    And the in-memory Process Table is empty after a runtime restart
    When the lifecycle engine replays the durable aggregate via EventV2.readAggregate
    Then the Process Table row is rebuilt to reflect the last durable state
    And no event is reconstructed from the Process Table itself

  Scenario: A row without a live owner after restart projects as unknown/unreconciled
    Given a process that was "running" before an unclean shutdown
    And the process-local BackgroundJob registry that owned it is gone after restart
    When the lifecycle engine reconciles that row against durable Sessions
    Then the row projects as "unknown" or "unreconciled"
    And no automatic retry or re-execution of the process effects occurs

  Scenario: Explicit versioned reconciliation resolves a known durable Session
    Given an unreconciled process row and a matching durable Session record
    When an operator triggers explicit reconciliation for that root scope
    Then the reconciliation is recorded as explicit and versioned
    And the row's owner/runtime linkage is corrected without replaying side effects

  # ---------------------------------------------------------------------------
  # Watchdog zombie detection (C12, AC11)
  # ---------------------------------------------------------------------------

  Scenario: Watchdog detects a zombie process from an expired lease
    Given a running process whose lease has expired
    And no heartbeat has been observed from its owner within the bucket window
    When the shared bucketed watchdog sweep runs
    Then a "zombie_detected" lifecycle event is published for that process
    And the watchdog does not claim that the provider or external tool has stopped
    And no automatic re-execution of the process effects is triggered

  Scenario: Watchdog uses one shared sweeper, never a per-Task timer
    Given many concurrently running processes across several sessions
    When the watchdog evaluates lease expiry for all of them
    Then a single shared bucketed sweep mechanism performs the evaluation
    And heartbeat/lease state is kept in memory, not written per heartbeat to SQLite

  Scenario: Owner loss without lease expiry is reported distinctly from a zombie
    Given a process whose owning runtime instance disconnects
    But whose lease has not yet expired
    When the watchdog evaluates that process
    Then an "owner_lost" outcome is published, distinct from "zombie_detected"
    And the outcome does not imply the underlying provider call has been stopped

  # ---------------------------------------------------------------------------
  # Cancel outcome matrix (C17, AC9, AC10, AC29, AC32)
  # ---------------------------------------------------------------------------

  Scenario Outline: Cancel outcome depends on process state and remote confirmation
    Given a process in state "<state>"
    When an authorized cancel request is issued for that process
    Then the recorded cancel outcome is "<outcome>"
    And no remote kill, reversal, or mutation rollback is promised

    Examples:
      | state      | outcome     |
      | queued     | accepted    |
      | waiting    | accepted    |
      | running    | requested   |
      | cancelling | unconfirmed |

  Scenario: Cancelling a queued or waiting process prevents it from starting
    Given a process in state "queued"
    When an authorized cancel is requested before the process starts
    Then the process transitions to "cancelling" and then "cancelled"
    And the process never transitions to "running"

  Scenario: First Ctrl+C requests root-tree cancellation including invisible descendants
    Given a root session with a main context, visible foreground agents, and Manager-owned Workers not currently rendered in the direct-child Session UI
    When the operator presses Ctrl+C once while execution is active in that root
    Then RootCancelService requests cancellation of the entire authorized root tree
    And every permitted descendant, including invisible ones, transitions toward cancelling
    And another root session or another project is left unaffected

  Scenario: Second Ctrl+C within the escalation window forces local abort
    Given a root cancellation request already issued and still pending acknowledgement
    When the operator presses Ctrl+C a second time within the escalation window
    Then the current root scope is locally aborted
    And no remote-kill guarantee is claimed for unconfirmed descendants

  Scenario: Esc never cancels a root process tree
    Given a modal, detail, or navigation view is open during active execution
    When the operator presses Esc
    Then the view dismisses, closes, or navigates back
    And the current root process tree is not cancelled

  Scenario: Root cancellation fences new descendant admission
    Given a root cancellation request has been issued
    When a new child process attempts admission under that root
    Then the admission is rejected or quarantined
    And the rejection is visible in the lifecycle projection

  Scenario: Cancelling a scheduled occurrence never disables its Job Definition
    Given an active scheduled occurrence running as a process under a root tree
    When root Ctrl+C cancels that occurrence
    Then only that occurrence's process is cancelled
    And the future Job Definition remains enabled and unaffected

  # ---------------------------------------------------------------------------
  # Handoff single-owner (C16, AC6)
  # ---------------------------------------------------------------------------

  Scenario: One canonical handoff event projects identically to both sides
    Given a source session and a target session eligible for handoff
    When the canonical run/session coordinator records and publishes one durable handoff event
    Then the event carries source and target session/process, reason, generation, correlation, and causation
    And the source session's permitted projection shows those exact fields
    And the target session's permitted projection shows the same exact fields
    And no second, divergent handoff event is published for the same transfer

  Scenario: Only the canonical coordinator may publish a handoff event
    Given a candidate handoff between two sessions
    When any component other than the canonical run/session coordinator attempts to publish a handoff event
    Then the attempt is rejected
    And no duplicate or unauthorized handoff aggregate is recorded

  # ---------------------------------------------------------------------------
  # Todo gate exemptions (C24, AC33, AC38)
  # ---------------------------------------------------------------------------

  Scenario: Goal-bearing session requires a non-empty Todo before execution
    Given a goal-bearing Worker session about to begin execution
    When the session has no Todo items at all
    Then the completion/execution gate rejects starting work with an empty list
    And execution is blocked until at least one bounded item exists

  Scenario: Simple task uses at least one bounded Todo item
    Given a simple goal-bearing session performing a single bounded task
    When execution starts
    Then a non-empty session-owned Todo with at least one item is present
    And the empty-list bypass is rejected

  Scenario Outline: Todo gate exemption applies only to non-goal-bearing sessions
    Given a session classified as "<session_kind>"
    When that session begins its activity
    Then the non-empty Todo gate outcome is "<gate_outcome>"

    Examples:
      | session_kind                       | gate_outcome |
      | goal-bearing Worker                | enforced     |
      | goal-bearing Manager                | enforced     |
      | goal-bearing Architect              | enforced     |
      | pure social or no-goal chat         | exempt       |
      | hidden lifecycle agent (title)      | exempt       |
      | hidden lifecycle agent (summary)    | exempt       |
      | hidden lifecycle agent (compaction) | exempt       |

  Scenario: An exempt hidden lifecycle agent is never represented as already using Todo
    Given a hidden lifecycle agent exempt from the Todo gate
    When its projection is rendered anywhere in the system
    Then it is not shown as an active Todo-tool user
    And no Todo aggregate is fabricated on its behalf

  Scenario: Premature completion is blocked while required items remain open
    Given a session with at least one Todo item still "pending" or "in_progress"
    When the session or its Task attempts to transition to "completed"
    Then completion is blocked
    And a "todo.completion_blocked" event is recorded

  # ---------------------------------------------------------------------------
  # Operator authority on process.*/task.* (C19, AC18, Security 4)
  # ---------------------------------------------------------------------------

  Scenario: Only Feature 007 native operator commands can act on process/task lifecycle
    Given the reserved "process.cancel" and "task.cancel" command IDs
    When an authorized Feature 007 operator principal issues "process.cancel" through the native command registry
    Then the cancel request is accepted for authorization and dispatched to native services
    And an audit event is recorded for the request

  Scenario Outline: Non-operator surfaces attempting lifecycle management are rejected
    Given the "<surface>" attempts to invoke "process.cancel" or "task.cancel" directly
    When the attempt reaches the operator command boundary
    Then the attempt is rejected
    And no lifecycle state is mutated by that surface

    Examples:
      | surface               |
      | an LLM free-form instruction |
      | a tool call                  |
      | an MCP call                  |
      | a prompt template             |

  Scenario: Plugin, MCP, and custom registries cannot register reserved operator IDs
    Given a plugin, MCP server, or custom command registry attempting to register "process.status"
    When registration is attempted
    Then the reserved operator ID registration is rejected
    And the canonical Feature 007 "process.status" implementation remains the sole owner

  Scenario: Observers can never mutate lifecycle state directly
    Given an active subscription through observeSession, observeProcess, or observeTree
    When the observer receives lifecycle events
    Then it cannot cancel, steer, hand off, or otherwise mutate the Process Table
    And any control action it wants must pass through a native Feature 007 command
