// DDD role: ValueObject
// Package: executor_composition.enums
// Bounded enums for the Feature 018 composition of the scheduled-jobs executor
// runtime into the live runtime: the arming state of the eager composition, the
// coordinator lifecycle phases a due occurrence walks, the typed capability gap a
// composed verb degrades to, the run-now enqueue outcome, the interrupt-edge
// disposition, and the readiness class the palette derives from. Features 002/003
// machinery is composed, not re-authored; Feature 007 stays the sole
// command-registration authority and no catalog id or version is added (FR12).

package executor_composition.enums

// ArmState is the eager composition's arming outcome at server start; a fail-open fault leaves it disarmed, never a crash (FR1, FR2).
#ArmState: "armed" | "disarmed"

// CoordinatorPhase is one step of the TaskProcessCoordinator lifecycle a due occurrence walks from admission through terminal (FR4, FR5).
#CoordinatorPhase: "admit" | "create_process" | "provision_todo" | "provision_output_group" | "run" | "terminal"

// ExecutorGap is the typed capability gap a composed verb degrades to when the executor is disarmed or a dependency is unreachable; never fabricated (FR7, FR13).
#ExecutorGap: "unavailable" | "executor_unavailable" | "invalid_argument" | "version_conflict"

// RunNowOutcome is the honest result of a run-now enqueue: an occurrence was enqueued, rejected by the overlap policy, or the executor is disarmed (FR7).
#RunNowOutcome: "enqueued" | "overlap_rejected" | "executor_unavailable"

// AdmissionDecision is the honest admission verdict; a denial is reported, never turned into a fake admitted (FR4).
#AdmissionDecision: "admitted" | "denied"

// InterruptDisposition records the second-press forced-abort edge: the registered coordinator interrupted the run, or no registry entry so the cancel is unconfirmed (FR9, FR10).
#InterruptDisposition: "interrupted" | "unconfirmed"

// OverlapPolicy is the Feature 003 bounded overlap vocabulary the executor honors so concurrency stays bounded (FR3).
#OverlapPolicy: "forbid" | "allow" | "queue" | "replace"

// MisfireDisposition is the explicit resolution of a missed trigger; never a hidden retry (FR3).
#MisfireDisposition: "fire" | "skip" | "coalesce"

// OwnerKind is the fixed provenance recorded on the Process Table row for a scheduled occurrence (FR4, Feature 003 C16).
#OwnerKind: "scheduled-job"

// BackendReadiness records how far the executor is composed for a verb: live once armed, or a typed capability gap when a dependency stays unreachable (FR11).
#BackendReadiness: "live" | "capability_gap"
