# Source: doc/arch/sdd/009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md
# (FR1-FR25, NFR1-NFR5, AC1-AC20, C1-C16) and ADR-0007 (Semantic Tool Search,
# proposed). Feature 009 extends the IMPLEMENTED Feature 006 semantic stack
# (pipeline, tie-break, query cache, cutover, degradation ladder, telemetry,
# eval harness) to the native ToolRegistry, MCP tool catalog, and code-mode
# catalog surfaces. Prose-style scenarios describe intended behavior
# precisely enough for later automation; they do not require concrete step
# bindings.

Feature: Add Semantic Embedding And Reranker Retrieval To All Tool
  As an agent answering a task-scoped query
  I want tool search ranked by hybrid lexical and semantic relevance across every tool-search surface
  So that tool selection matches the task without scanning the entire registry and MCP catalog while never widening permission-visible tools

  # ---------------------------------------------------------------------------
  # One canonical tool corpus across all three surfaces (FR5, FR6, C6, AC1)
  # ---------------------------------------------------------------------------

  Scenario: The native ToolRegistry, MCP catalog, and code-mode catalog share one canonical tool corpus
    Given native ToolRegistry tools, MCP catalog tools, and the code-mode catalog all reachable
    When the tool corpus is projected into the "tools" collection
    Then every tool-search surface indexes from the same canonical corpus
    And retrieval and ranking stay consistent across all three surfaces

  Scenario: A bounded ranked subset is returned instead of the full permission-visible tool set
    Given a task-scoped query and a large permission-visible tool set
    When tool search runs at full semantic capability
    Then a bounded deterministically ranked candidate set of the most relevant tools is returned
    And the candidate set is strictly smaller than the entire permission-visible set

  # ---------------------------------------------------------------------------
  # Sanitized parameter-schema projection (FR6, FR7, C6, AC18)
  # ---------------------------------------------------------------------------

  Scenario: A parameter default that looks like a secret or a path is stripped from the tool document
    Given a tool whose parameter schema contains a default value that looks like a secret or a path
    When the tool document is built
    Then only sanitized parameter names, types, and descriptions are indexed
    And no secret, credential, or filesystem path is stored in the tool document

  # ---------------------------------------------------------------------------
  # Permission hard filter and stale-index revalidation (FR3, C10, C15, AC3, AC4)
  # ---------------------------------------------------------------------------

  Scenario: A tool hidden by Wildcard deny never appears in candidates
    Given a tool hidden by Wildcard deny for the requesting agent
    When tool retrieval runs
    Then that tool never appears in the candidate set even if semantically similar

  Scenario: A tool removed from ToolRegistry but still indexed in Milvus is dropped before reaching the model
    Given a tool removed from ToolRegistry but still present in the Milvus tools collection
    When search returns that tool as a candidate
    Then post-retrieval revalidation against live ToolRegistry drops the candidate
    And the removed tool never reaches the model

  # ---------------------------------------------------------------------------
  # Hybrid retrieval and deterministic tie-break (FR11-FR13, C2, C3, C4, AC1, AC8, AC13)
  # ---------------------------------------------------------------------------

  Scenario: Tool retrieval runs the ordered pipeline stages while omitting the agent-only stages
    Given a task-scoped query profile for tool retrieval
    When the tool pass executes
    Then the stages run profile, hard filters, hybrid dense and lexical recall, reduced candidate set, rerank, and deterministic score in that fixed order
    And the agent-only "select_agent" and "skill_pass" stages never run for a tool pass
    And post-retrieval revalidation runs as the final stage before the result is returned

  Scenario: Identical inputs produce identical tool ordering via the reused deterministic tie-break
    Given two tools with identical rerank and dense scores
    When tool ranking runs twice with identical inputs
    Then both runs produce identical ordering by rerank score then dense score then lexical score then canonical tool id

  Scenario: retrieval_top_k and rerank_top_k bound every candidate set
    Given configured "retrieval_top_k" and "rerank_top_k" values for tool search
    When recall and rerank run
    Then candidate counts never exceed the configured caps
    And the returned result list is bounded by the configured result bound

  # ---------------------------------------------------------------------------
  # Multilingual query against en-US Lang Lock tool descriptions (FR16-FR17, C1, AC2, AC20)
  # ---------------------------------------------------------------------------

  Scenario Outline: A "<query-language>" query retrieves English tool descriptions without a translation call
    Given a "<query-language>" task-scoped query and en-US Lang Lock tool descriptions
    When tool retrieval runs against the multilingual embedding and reranker bindings
    Then relevant English tools appear among the candidates
    And no mandatory translation LLM call is required for retrieval

    Examples:
      | query-language |
      | pt-BR           |
      | es               |
      | en               |

  # ---------------------------------------------------------------------------
  # Three-rung degradation ladder, never a hard failure (FR18-FR20, C14, AC5-AC7, AC14, AC19)
  # ---------------------------------------------------------------------------

  Scenario: Milvus unavailable degrades tool search to lexical-only ranking
    Given Milvus unavailable and default per-surface policy
    When tool search runs
    Then ranking degrades to the lexical-only rung with an explicit degraded reason
    And tool availability suffers no hard failure

  Scenario: A reranker timeout ranks by dense and lexical scores without selecting another reranker model
    Given a reranker timeout during tool retrieval after hybrid recall completed
    When ranking proceeds
    Then ranking proceeds without rerank scores under the deterministic tie-break order
    And no other reranker model is ever auto-selected

  Scenario: The embedder and Milvus both unavailable falls back to the full-set passthrough floor
    Given the embedding model unavailable and Milvus also unavailable
    When tool search runs under default policy
    Then the entire permission-visible tool set is exposed unranked as the absolute floor
    And the binding state is recorded as "unavailable"

  Scenario: No embedding or reranker binding pinned degrades honestly without crashing
    Given no embedding or reranker binding pinned in Feature 006
    When tool search runs under default per-surface policy
    Then tool search degrades to the lexical-only or full-set passthrough rung with a typed capability gap
    And no hard failure of tool availability occurs

  Scenario: An operator opts one surface into fail-closed while others keep degrading honestly
    Given the operator explicitly configured fail-closed for the code-mode tool-search surface only
    When the semantic stack is unavailable
    Then the code-mode surface fails closed with a typed error
    And the native and MCP surfaces continue to degrade through the honest ladder instead of failing closed

  # ---------------------------------------------------------------------------
  # Per-surface enablement defaults keep tool exposure at least as capable as today (FR18, FR21, C9, C15, AC1, AC7, AC14)
  # ---------------------------------------------------------------------------

  Scenario Outline: The "<surface>" tool-search surface defaults to disabled and falls back to the full-set passthrough floor
    Given the "<surface>" tool-search surface at its default Config.Service enablement flag
    When the live tool list is resolved for "<surface>"
    Then the "<surface>" surface consumes the full permission-visible tool set unranked
    And the "FEATURE_009_TOOL_SELECTION_SEAM" wiring point is present and test-covered but never invoked on the hot path

    Examples:
      | surface   |
      | native    |
      | mcp       |
      | code_mode |

  # ---------------------------------------------------------------------------
  # code-mode ranked-subset consumption when enabled (FR5, C10, AC1)
  # ---------------------------------------------------------------------------

  Scenario: code-mode describeCatalog consumes the ranked subset after Permission.visibleTools when its surface flag is enabled
    Given the code-mode tool-search surface flag enabled and a task-scoped query
    When "describeCatalog" renders the confined-interpreter catalog
    Then it consumes the ranked bounded tool subset from the shared retrieval seam
    And the ranked subset is applied only after "Permission.visibleTools" and never widens it

  # ---------------------------------------------------------------------------
  # Coalesced reindex triggers and content-hash incremental upsert (FR8, C11, NFR2, AC9, AC10)
  # ---------------------------------------------------------------------------

  Scenario: A connected MCP server's list_changed event incrementally reindexes only that server's tool documents
    Given a connected MCP server emitting the "mcp.tools_changed" event
    When the event fires
    Then only that server's tool documents are incrementally upserted or tombstoned
    And no full rebuild of the "tools" collection occurs

  Scenario: A native tool description change is re-embedded by content hash without retaining stale vectors
    Given a native tool whose description changes on registry reload
    When the tool document is reprojected
    Then the tool document is re-embedded by content hash
    And the prior stale vector is not retained in the "tools" collection

  Scenario: A burst of registry and MCP catalog churn coalesces into one reindex pass
    Given a burst of ToolRegistry and MCP catalog changes within the bounded coalescing window
    When the window closes
    Then the three trigger sources coalesce into exactly one incremental reindex pass per affected scope
    And the tool trigger stays independent from the Feature 008 resource-index trigger

  # ---------------------------------------------------------------------------
  # Shared binding generation, atomic cutover, and cross-project isolation (FR9, FR10, C7, C13, AC9, AC11)
  # ---------------------------------------------------------------------------

  Scenario: The tools collection cuts over atomically together with agents, skills, and skill_chunks under one CAS token
    Given a validated new index generation covering the "agents", "skills", "skill_chunks", and "tools" collections
    When the operator confirms "semantic.embedding.cutover" under CAS
    Then all four collection aliases swap together atomically
    And no collection including "tools" is left on the prior generation after the swap

  Scenario: A project never receives another project's tool documents
    Given two distinct projects with their own indexed tool corpora
    When project A searches for tools
    Then no project B tool document is ever returned

  # ---------------------------------------------------------------------------
  # Shared query-embedding cache reuse across surfaces (FR14, C8, AC12)
  # ---------------------------------------------------------------------------

  Scenario: The native surface then the MCP surface reuse the same cached query embedding for one task fingerprint
    Given a query embedding cached by task fingerprint, binding version, and config hash
    When the native surface retrieves tools and then the MCP surface retrieves tools for the same task
    Then the MCP surface reuses the cached query embedding without a second embed call

  # ---------------------------------------------------------------------------
  # No binding mutation and no new operator surface (FR4, FR22, AC16, AC17)
  # ---------------------------------------------------------------------------

  Scenario: A prompt, plugin, MCP server, or ToolRegistry attempt to mutate the embedding or reranker binding leaves it unchanged
    Given a prompt, plugin, MCP, or ToolRegistry attempt to change the embedding or reranker binding or the tool corpus
    When the attempt is processed
    Then the attempt is rejected
    And the currently pinned binding and the tool corpus remain unchanged

  Scenario: An operator reindexes the tools collection through the existing reserved semantic.index.reindex command
    Given an operator running the reserved "semantic.index.reindex" command scoped to the "tools" collection
    When it executes
    Then reindex runs natively with zero model tokens
    And no new Feature 009 operator command ID is required

  # ---------------------------------------------------------------------------
  # Content-free telemetry and the extended offline golden eval (FR23-FR25, C16, AC15, AC20)
  # ---------------------------------------------------------------------------

  Scenario: Tool retrieval spans and metrics export without query text, vectors, tool ids, or session ids
    Given tool retrieval spans and metrics produced during a retrieval request
    When they are exported
    Then only stable enum span names and bounded latency, candidate-count, cache-hit, and rank-bucket labels are present
    And no query text, vector, tool id, MCP server name, or session id appears as a label

  Scenario: The extended offline golden harness reports zero permission-leakage for query-to-tool relevance
    Given a tool golden evaluation suite covering pt-BR, es, and en query-to-tool relevance
    When "runGolden" executes against the currently pinned bindings for the tool suite
    Then recall, ranking, and multilingual metrics are recorded per locale
    And the leakage count is exactly zero
    And no binding is mutated by the evaluation run
