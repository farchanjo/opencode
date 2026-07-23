// DDD role: ValueObject
// Package: schemas
// Feature 060 — durable tool buffers + primary chat_output budget (structured only).

package schemas

// NonNegCap is a non-negative cap where 0 means unlimited.
// DDD role: ValueObject
#NonNegCap: int & >=0

// PositiveCap is a positive in-context preview threshold.
// DDD role: ValueObject
#PositiveCap: int & >0

// NonEmptyPath is a non-empty filesystem path string.
// DDD role: ValueObject
#NonEmptyPath: string & !=""

// ToolPreviewText is in-context tool result text (full or truncated preview).
// DDD role: ValueObject
#ToolPreviewText: string

// FlagBool wraps a boolean flag.
// DDD role: ValueObject
#FlagBool: bool

// ChatOutput is the ConfigV1 chat_output surface (0 = unlimited per axis).
// DDD role: ValueObject
#ChatOutput: {
	max_words?:  #NonNegCap
	max_tokens?: #NonNegCap
}

// ToolOutput is the ConfigV1 tool_output preview threshold surface.
// DDD role: ValueObject
#ToolOutput: {
	max_lines?: #PositiveCap
	max_bytes?: #PositiveCap
}

// DurableToolResult is Truncate.output return shape (full buffer always on disk).
// DDD role: ValueObject
#DurableToolResult: {
	content:    #ToolPreviewText
	truncated:  #FlagBool
	outputPath: #NonEmptyPath
}

// ChatBudget is the runtime console clamp state for a primary turn.
// DDD role: ValueObject
#ChatBudget: {
	maxWords?:  #PositiveCap
	maxTokens?: #PositiveCap
	exhausted:  #FlagBool
}
