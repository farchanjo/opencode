// DDD role: ValueObject
// Package: jobs.enums
// Notification enums for the bounded, authorized async channel (FR20, FR22, FR24,
// C8, C9). The default action is operator-only; wake/queue/child are explicit,
// authorized, bounded and audited — never the default (C9).

package jobs.enums

// NotificationType classifies the occurrence signal a notification carries (FR22).
#NotificationType: "occurrence_settled" | "occurrence_failed" | "occurrence_cancelled" | "occurrence_timed_out" | "misfire" | "reconciled" | "operator_advisory"

// NotificationPriority is a bounded priority bucket; no high-cardinality label (C18).
#NotificationPriority: "low" | "normal" | "high" | "urgent"

// NotificationSource names the emitter of a notification (FR22).
#NotificationSource: "scheduler" | "executor" | "reconciler" | "operator"

// DeliveryState is the notification delivery lifecycle at a safe boundary (FR25, C9).
#DeliveryState: "enqueued" | "queued" | "coalesced" | "delivered" | "expired"

// AckState records acknowledgement or TTL expiry of a delivered notification (FR22).
#AckState: "unacknowledged" | "acknowledged" | "expired"

// DeliveryAction distinguishes operator-only from explicit wake/queue/child actions (FR24, C9).
#DeliveryAction: "operator_only" | "manager_wake" | "input_queue" | "child_session"

// SafeBoundary flags whether delivery occurred at a safe active-turn boundary (FR25, AC7).
#SafeBoundary: "safe" | "unsafe"
