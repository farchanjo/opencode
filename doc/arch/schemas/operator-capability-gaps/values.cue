// DDD role: ValueObject
// Package: operator_capability_gaps.shared
// Bounded numeric ValueObjects for the Feature 017 detail view tree (Group 7).
// Each bound is a named type so no bare int is carried inline (wrap-primitives);
// they cap the expand depth and total row count the view modal renders before an
// honest "… N more" truncation marker, keeping the detail tree bounded and
// distinct from the compact status strip (FR23). Shares the shared package with
// shared.cue and flags.cue (the operator-persistence corpus precedent).

package operator_capability_gaps.shared

// TreeDepth is the bounded expand depth of the detail view tree; records/arrays deeper than this collapse with an honest truncation marker (FR23).
#TreeDepth: int & >=1 & <=8

// TreeRowBudget is the bounded total row count the detail view tree renders before an honest "… N more" truncation marker (FR23).
#TreeRowBudget: int & >=1
