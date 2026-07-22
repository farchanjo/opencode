# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md
# (FR1-FR32 plus FR8a, AC1-AC29, C1-C22) and ADR-0004 (Scheduled Job Runtime and
# Async Notification Channel, proposed). Prose-style scenarios describe intended
# behavior precisely enough for later automation; they do not require concrete
# step bindings.

Feature: Persistent Bun-Native Scheduled Jobs and Async Main-Context Notification
  As an operator
  I want durable scheduled jobs whose triggers become canonical Feature 002 occurrences
  So that recurring work is explicit, auditable, admission-safe, and never a second scheduler

  # ---------------------------------------------------------------------------
  # Registration rehydration at startup (FR3, FR6, C5, AC2, AC23)
  # ---------------------------------------------------------------------------

  Scenario: Restart rehydrates persisted definitions without claiming past execution
    Given persisted Job Definitions in Config.Service with no active in-process registrations
    When the runtime starts
    Then each enabled definition validates and re-registers with the Bun.cron adapter
    And registration state transitions from "pending" toward "registered" or an explicit "unknown"
    And no definition's rehydration claims that a past occurrence executed

  Scenario: Partial registration reconciliation never claims a cross-system atomic commit
    Given a persisted definition whose durable intent committed in Config.Service
    But whose Bun/OS registration crashed or returned an unknown result
    When startup reconciliation runs
    Then the registration state transitions through "pending" then "unknown" then "reconciled"
    And idempotent compensation or re-registration is applied
    And no single transaction spanning Config.Service and the scheduler is ever claimed

  Scenario: In-process Bun.cron registration is never treated as durable by itself
    Given a Job Definition registered only in-process with the Bun.cron adapter
    When the process exits and restarts without persisted definitions being read
    Then no occurrence history or registration state survives from the in-process registration alone
    And Config.Service remains the sole durable authority for definitions and intent

  # ---------------------------------------------------------------------------
  # Misfire policy matrix (FR15, FR19, C3, C19, AC3, AC24)
  # ---------------------------------------------------------------------------

  Scenario Outline: Misfire policy governs a missed or overdue trigger explicitly
    Given a Job Definition configured with misfire policy "<policy>"
    And its due time has passed without a claimed occurrence
    When reconciliation or the next Bun.cron callback evaluates the missed trigger
    Then the occurrence outcome is "<outcome>"
    And schedule lag is recorded from the nominal due time
    And no infinite catch-up occurs

    Examples:
      | policy            | outcome    |
      | skip               | skipped    |
      | fire_once           | misfired   |
      | bounded_catch_up   | misfired   |
      | coalesce            | coalesced  |

  Scenario: Unsupported misfire policy fails validation before registration
    Given a Job Definition requests a misfire policy the selected adapter cannot enforce
    When the definition is created or updated
    Then validation fails before any external registration
    And the durable definition records the rejected capability without an external job

  # ---------------------------------------------------------------------------
  # No-overlap forbid default and mutation-safe replace (FR16, C3, AC5, AC24, AC25)
  # ---------------------------------------------------------------------------

  Scenario: Default forbid overlap policy blocks a second concurrent invocation
    Given a Job Definition with the default "forbid" overlap policy
    And its in-process handler is still pending past the next nominal due time
    When the next scheduled fire is due
    Then the Bun.cron in-process no-overlap guarantee holds and no second handler invocation starts
    And an explicit misfire outcome is recorded instead of a silent skip

  Scenario Outline: Overlap policy outcome is evented and replace never blindly kills mutating work
    Given a running occurrence and a new due trigger under overlap policy "<policy>"
    When the overlap policy is evaluated
    Then the outcome "<outcome>" is evented
    And "replace" never silently stops or kills a mutating handler or process

    Examples:
      | policy   | outcome           |
      | allow     | overlap_replaced  |
      | forbid    | overlap_rejected  |
      | queue     | queued            |
      | replace   | overlap_replaced  |

  Scenario: Unsupported overlap policy fails validation before registration
    Given a Job Definition requests an overlap policy the selected adapter/occurrence layer cannot enforce
    When the definition is created or updated
    Then validation fails before external registration
    And no external job is registered for that definition

  # ---------------------------------------------------------------------------
  # Occurrence idempotency under duplicate triggers (FR10, C6, AC6)
  # ---------------------------------------------------------------------------

  Scenario: Duplicate trigger delivery resolves to one execution
    Given an occurrence identified by the idempotency tuple "(job_definition_id, schedule_id, nominal_due_time, generation)"
    When two duplicate trigger deliveries arrive for that same tuple
    Then only one execution is admitted for that occurrence
    And the duplicate delivery is an observable outcome, never a second execution

  Scenario: Projection idempotency reuses the Feature 002 dedupe posture
    Given a durable "job.execution_completed" event already projected for an occurrence
    When the identical event is delivered a second time with the same event id and (aggregateID, seq)
    Then the occurrence projection does not change a second time
    And the duplicate is recorded without inventing a new terminal state

  # ---------------------------------------------------------------------------
  # Occurrence as the canonical Feature 002 process through admission (FR8, FR9, C16, AC11)
  # ---------------------------------------------------------------------------

  Scenario: A trigger becomes an occurrence before admission, never a second executor
    Given an enabled Job Definition whose due time arrives
    When the Bun.cron in-process callback fires
    Then "job.trigger_due" is published and an occurrence is created before admission
    And the occurrence then creates or associates a Feature 002 Task Process through TaskTool, BackgroundJob, SessionExecution, SessionRunCoordinator, and SessionRunner
    And no second executor, runtime, EventV2 system, or lifecycle is created

  Scenario: Smart routing and hard gates govern every dispatched occurrence
    Given a configured routing action on a Job Definition
    When an occurrence is admitted
    Then Feature 001 routing and hard gates select the allowed route
    And the Process Table records owner_kind "scheduled-job" for the resulting process

  Scenario: The Process Table observes occurrences and never executes a job
    Given "job.trigger_due", notification delivery, and executor start/completion as distinct observations
    When these lifecycle events are projected
    Then the Process Table reflects each observation
    And the Process Table itself never executes a job

  # ---------------------------------------------------------------------------
  # Occurrence-owned Todo and OutputGroup (FR8, FR8a, C14, C15, AC26-AC29)
  # ---------------------------------------------------------------------------

  Scenario: Each executable occurrence owns its own Todo aggregate
    Given an executable scheduled occurrence admitted for goal-bearing work
    When it begins execution
    Then it has its own non-empty session-owned Todo snapshot under Feature 002
    And it does not share the Job Definition's list or any sibling occurrence's list

  Scenario: Cancelling one occurrence preserves definition and Todo independence
    Given an active occurrence with incomplete Todo items
    When that occurrence is cancelled
    Then only that occurrence/process is cancelled
    And the incomplete Todo items and outcome/reason are preserved for that occurrence
    And the future Job Definition remains enabled and unchanged for later triggers

  Scenario: Each admitted occurrence that produces output owns its own OutputGroup
    Given an admitted scheduled occurrence that produces observed output
    When execution runs
    Then that occurrence owns its own Feature 005 OutputGroup scoped to process/attempt/generation
    And it does not share a mutable OutputGroup or spool channel with the Job Definition or siblings

  # ---------------------------------------------------------------------------
  # Notification safe-boundary delivery, ack, and expiry (FR20-FR27, C8, C9, AC7-AC10, AC29)
  # ---------------------------------------------------------------------------

  Scenario: A notification is delivered only at a safe active-turn boundary
    Given an enqueued "job.notification_enqueued" for an authorized root/session target
    When a safe active-turn boundary is reached for that target
    Then "job.notification_delivered" is published
    And the notification awaits acknowledgement or its TTL

  Scenario: A busy or unsafe active turn queues, coalesces, or expires instead of interrupting
    Given an active unsafe main turn
    When a notification arrives for that target
    Then it queues, coalesces, or expires according to configured policy
    And it never interrupts the unsafe active turn

  Scenario: An acknowledged notification records ack state
    Given a delivered notification awaiting acknowledgement
    When the authorized target acknowledges it
    Then "job.notification_acknowledged" is published
    And the notification's ack state becomes "acknowledged"

  Scenario: An unavailable target and TTL expiry are recorded without unbounded growth
    Given an unavailable target context and a notification TTL
    When delivery cannot occur before the TTL elapses
    Then "job.notification_expired" is published
    And no unbounded notification queue grows for that target

  Scenario: A notification envelope carries only a bounded summary and opaque OutputRef
    Given an occurrence with sealed or open Feature 005 output
    When a main-context notification is delivered
    Then the envelope includes only a bounded summary and an opaque Feature 005 OutputRef
    And it never includes full content or spool filesystem paths

  Scenario: Cross-session and cross-project notification leakage is rejected before delivery
    Given sibling sessions and sibling projects with distinct authorized scopes
    When a notification or tree view is requested for one scope
    Then only events authorized for that root/session/project are delivered
    And leakage into a sibling scope is a rejected failure, not a silent drop

  Scenario: The default notification action is operator-only; other actions are explicit and audited
    Given a Job Definition with no configured notification action override
    When a notification is enqueued for it
    Then the default action is "operator_only" notification
    And manager wake, structured input queue, and new child session creation occur only when explicitly configured, authorized, bounded, and audited
    And no raw prompt is ever silently injected into an active turn

  # ---------------------------------------------------------------------------
  # Run-now as a normal occurrence (FR28, FR31, C12, AC14)
  # ---------------------------------------------------------------------------

  Scenario: Operator run-now creates a normal occurrence through admission and routing
    Given an operator invokes "jobs.run-now" for an enabled Job Definition
    When the command executes
    Then it creates a normal occurrence carrying the same idempotency identity shape as a scheduled trigger
    And that occurrence follows admission, Feature 001 routing, permissions, and lifecycle events
    And no scheduled-job identity or Process Table semantics are bypassed

  Scenario: Run-now never starts an LLM turn solely for administration
    Given an operator invokes "jobs.run-now" for a Job Definition
    When the command is dispatched through the Feature 007 native operator command registry
    Then zero provider/model calls, tokens, or cost are incurred by the administration action itself
    And any model call happens only inside the resulting occurrence's configured action, if any

  # ---------------------------------------------------------------------------
  # Disable never kills mutating work (FR16, C17, AC25, Security 7)
  # ---------------------------------------------------------------------------

  Scenario: Disabling a definition while an occurrence may be mutating never reports a false kill
    Given a Job Definition with an active occurrence that may be performing mutating work
    When an operator disables that definition
    Then the definition's registration is unregistered
    And the active occurrence's control outcome is "unconfirmed" or "unknown", never a confirmed remote kill
    And no mutation is silently repeated or silently terminated without a native lifecycle result

  Scenario: Deleting a definition compensates unregistration without silently terminating active work
    Given a Job Definition scheduled for deletion with no currently active occurrence
    When an operator deletes the definition
    Then the definition is deleted and a compensating unregister is applied
    And no confirmed remote kill is claimed for any occurrence outcome

  Scenario: A disable/update/delete racing an in-flight trigger produces one auditable outcome
    Given a trigger claim races with a concurrent disable, update, or delete operation
    When the operations commit
    Then atomic version/occurrence rules produce exactly one auditable outcome
    And no partial definition or registration state is left behind

  # ---------------------------------------------------------------------------
  # Reserved jobs.* authority (FR28, FR30, FR32, C12, C13, AC17)
  # ---------------------------------------------------------------------------

  Scenario Outline: Non-operator surfaces attempting job administration are rejected
    Given the "<surface>" attempts to invoke a "jobs.*" administration command directly
    When the attempt reaches the operator command boundary
    Then the attempt is rejected
    And no Job Definition or registration state is mutated by that surface

    Examples:
      | surface                       |
      | an LLM free-form instruction  |
      | a tool call                   |
      | an MCP call                   |
      | a plugin                      |
      | a prompt template              |

  Scenario: Plugin, MCP, and custom registries cannot register reserved job.*/jobs.* names
    Given a plugin, MCP server, custom command registry, or PromptTemplate attempting to register "job.triggered" or "jobs.create"
    When registration or migration is attempted
    Then the attempt is rejected with a structured "reserved_name" error
    And the canonical Feature 003/Feature 007 implementation remains the sole owner

  Scenario: Native operator commands remain functional without an LLM or provider
    Given the reserved "jobs.list", "jobs.status", and "jobs.show" command IDs
    When an authorized Feature 007 operator principal issues them through the native command registry
    Then each command is served with zero provider/model calls, tokens, or cost
    And an audit event is recorded identifying the operator principal, scope, and outcome

  Scenario: All scheduled-job administration is native-only through Feature 007
    Given the canonical "jobs.*" operations list, status, show, create, update, enable, disable, delete, reschedule, run-now, history, and watch
    When any of these operations is invoked
    Then it is served exclusively through Feature 007 Settings/menu/palette/native-slash/CLI/App/Desktop adapters calling typed core domain commands/queries directly
    And it never uses Config.command, custom templates, session.command, ToolRegistry, MCP tools, plugins, skills, or free-form model instructions as management authority
