// DDD role: ValueObject
// Package: semantic.shared
// Budget and probe-bound numeric ValueObjects. retrieval_top_k, rerank_top_k,
// max_skill_chunks and skill token budgets are consumed from the Feature 001
// Context, Turn and Delegation Budget and never free-form; exceeding them fails
// closed or degrades with an explicit reason (FR38, C8). Embedding-probe batch and
// per-request vector counts are server-capped. Defaults are plan constants (AC12, AC17).

package semantic.shared

// TopK bounds a hybrid-recall or rerank window; retrieval_top_k 64 / rerank_top_k 16 provisional (FR19, FR38, C8).
#TopK: uint & >=1

// ChunkBudget is max_skill_chunks from the Feature 001 budget; 8 provisional (FR38, FR39, C8).
#ChunkBudget: uint & >=0

// TokenBudget is the skill token budget from the Feature 001 budget (FR38, C8).
#TokenBudget: uint & >=0

// BatchSize is the server-capped embedding-probe batch size; plan constant (FR30, C5, AC23).
#BatchSize: uint & >=1

// VectorCount is the server-capped per-request vector count for embedding (FR30, C5, AC23).
#VectorCount: uint & >=1

// LatencyBudgetMs is the retrieval latency budget; timeout triggers the C20 fallback (NFR1, C8).
#LatencyBudgetMs: uint & >=1
