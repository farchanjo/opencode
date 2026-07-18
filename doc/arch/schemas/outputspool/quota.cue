// DDD role: ValueObject
// Package: outputspool.quota
// QuotaDescriptor — the per-scope backpressure and admission caps applied at
// global, root, session, process and channel scopes (FR10, C3). Numeric caps are
// provisional plan constants owned by Feature 007 Config.Service; unbounded page
// size, queue depth or retention is prohibited (Out of Scope). Quota exceed is a
// first-class observable admission fault, never swallowed (FR10, C4, AC7).

package outputspool.quota

import (
	"outputspool/values"
	"outputspool/enums"
)

// QuotaDescriptor is one scope's byte, queue-depth and page caps (FR10, C3, AC7).
#QuotaDescriptor: {
	scope:           enums.#QuotaScope
	byte_cap:        values.#ByteLength
	queue_depth_cap: values.#QueueDepthBytes
	page_cap:        values.#PageLimit
}

// QuotaSet is the first-class collection of per-scope quota descriptors (FR10, C3).
#QuotaSet: [...#QuotaDescriptor]
