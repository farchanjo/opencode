// DDD role: ValueObject
// Package: langlock.detection
// DetectorResult and AdvisoryRecord — the content-free advisory-detection shapes
// (FR20, FR21, C5, C6). Advisory detection runs only on confidently classified
// prose and NEVER gates the write; generic source code is never blocked in V1
// (FR20, C14, AC11). Records carry no file text, diff, prompt or path (Security 5).
// Detector unknown/failure is a recorded outcome that never blocks hot paths (FR21).

package langlock.detection

import (
	"langlock/ids"
	"langlock/enums"
)

// DetectorClassification carries the path kind, detector provenance and confidence bucket (FR20, FR21, C5).
#DetectorClassification: {
	path_kind:  enums.#PathKind
	provenance: enums.#DetectorProvenance
	confidence: enums.#ConfidenceBucket
}

// DetectorResult is the content-free outcome of one advisory detection pass (FR21, C5, AC14).
#DetectorResult: {
	classification: #DetectorClassification
	policy_version: ids.#PolicyVersion
	remediation:    enums.#RemediationStatus
	detected_tag:   ids.#LanguageTag | null
}

// AdvisoryRecord binds a detector result to its execution context; it never gates the write (FR21, C6, AC8).
#AdvisoryRecord: {
	result:       #DetectorResult
	expected_tag: ids.#LanguageTag
	execution_id: ids.#ExecutionId
	reason:       ids.#Reason
}
