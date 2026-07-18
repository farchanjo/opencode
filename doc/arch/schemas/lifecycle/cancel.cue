// DDD role: ValueObject
// Package: lifecycle.cancel
// Root-tree cancellation is a request, not a mutation (C17). It propagates through
// the canonical SessionRunCoordinator root scope, fences descendant admission, and
// never promises remote kill, reversal, or mutation rollback (FR41, FR62).

package lifecycle.cancel

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// CancelPress distinguishes first request from second-press local abort (C17).
#CancelPress: "first" | "second"

// FencedDescendants flags that new descendants of the root were quarantined (AC30).
#FencedDescendants: bool

// RootCancelScope identifies the authorized root tree targeted by Ctrl+C.
#RootCancelScope: {
	root_session_id: ids.#RootSessionId
	root_process_id: ids.#RootProcessId
	press:           #CancelPress
}

// CancelRequestRecord records the request outcome and fencing; no remote kill (C17).
#CancelRequestRecord: {
	scope:              #RootCancelScope
	outcome:            enums.#CancelOutcome
	fenced_descendants: #FencedDescendants
	reason:             ids.#Reason
}
