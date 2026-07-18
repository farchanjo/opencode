// DDD role: ValueObject
// Package: langlock.enums
// Core bounded enums for the Feature 004 Lang Lock engine — scope, origin,
// enforcement mode, language axis, path kind, confidence bucket, detector
// provenance, remediation status and exception category (FR2, FR7, FR16, FR20,
// FR21, C1, C5). Event/actor enums live in enums-event.cue; the closed event
// vocabulary lives in event-types.cue.

package langlock.enums

// Scope bounds ownership/visibility of a policy; the langlock.* default scope is project (FR5, C2).
#Scope: "global" | "project" | "root" | "session"

// Origin names the source that produced the effective value (FR7).
#Origin: "default" | "global" | "project" | "managed"

// EnforcementMode is advisory in V1; strict blocking is deferred to a separate policy (FR16, FR22, C5, C14).
#EnforcementMode: "advisory" | "strict_deferred"

// Axis names the four independent language axes; Lang Lock governs only artifact (FR2, C1).
#Axis: "ui_locale" | "product_docs" | "conversational" | "artifact"

// PathKind classifies a write target for advisory eligibility; generic code is never blocked (FR20, C5).
#PathKind: "prose_markdown" | "docs" | "instruction_file" | "commit_text" | "generic_code" | "exempt" | "unknown"

// ConfidenceBucket is a bounded detector-confidence bucket; no raw score is exported (FR21, C5, AC14).
#ConfidenceBucket: "low" | "medium" | "high" | "unknown"

// DetectorProvenance names the advisory detector that produced a result; content-free (FR21, C5).
#DetectorProvenance: "heuristic" | "statistical" | "declared" | "none"

// RemediationStatus tracks the advisory follow-up; it never gates the write (FR21, C6, AC8).
#RemediationStatus: "none" | "flagged" | "acknowledged" | "suppressed"

// ExceptionCategory bounds the operator-owned exemption kinds (FR14, C16).
#ExceptionCategory: "i18n_resource" | "vendor_generated" | "lockfile" | "legal" | "external_contract" | "golden_fixture" | "exact_string"
