// DDD role: ValueObject
// Package: ffi.shared
// Shared monotonic count ValueObjects for the Feature 010 FFI payloads and leak stress
// (FR1, FR3, FR4, FR5, FR6, FR17, C16, C18). The line count bounds a read page and reports a
// read result size; the allocation and free counters back the oc_alloc_stats leak-freedom
// assertion (allocated == freed at rest, C18); the match, replacement, hunk and path counts
// report tool results at parity with the references. All are non-negative and none is a
// telemetry label (FR24, C14). Grouped in ffi.shared and reached through the `counters`
// import alias. Every count is a ValueObject.

package ffi.shared

// LineCount is a non-negative line count bounding a read page and reporting result size (FR1, C16).
#LineCount: int & >=0

// AllocationCount is the total oc_free-tracked allocations from oc_alloc_stats (FR17, C18).
#AllocationCount: int & >=0

// FreeCount is the total frees from oc_alloc_stats; it equals AllocationCount at rest (FR17, C18).
#FreeCount: int & >=0

// MatchCount is the per-file grep match count in count mode (FR6, AC7).
#MatchCount: int & >=0

// ReplacementCount is the number of substitutions an edit applied (FR3, AC4).
#ReplacementCount: int & >=0

// HunkCount is the number of hunks an apply_patch applied (FR4, AC5).
#HunkCount: int & >=0

// PathCount is a bounded file-path result count for glob and apply_patch (FR4, FR5, AC6).
#PathCount: int & >=0
