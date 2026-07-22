# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md
# (FR1-FR43, AC1-AC41, C1-C22) and ADR-0008 (Milvus-Backed Multilingual
# Semantic Retrieval and Reranking Stack, proposed). Prose-style scenarios
# describe intended behavior precisely enough for later automation; they do
# not require concrete step bindings.

Feature: Semantic Agent and Skill Retrieval (Milvus)
  As an Architect or Manager
  I want multilingual semantic retrieval and reranking over hard-gate-eligible agents and skills
  So that candidate selection improves relevance without becoming a second registry, permission authority, or route decider

  # ---------------------------------------------------------------------------
  # Operator pins a binding via probe/eval then cutover (FR28-FR32, C3, C12, AC19, AC31)
  # ---------------------------------------------------------------------------

  Scenario: An operator registers a local no-key embedding endpoint and pins it after validation
    Given a local OpenAI-compatible embedding endpoint without an API key
    When the operator adds the provider profile, discovers or registers the model, and runs native validate
    Then the model becomes eligible for the embedding selector only after the probe passes
    And selecting it pins a binding with no secret stored

  Scenario: An operator moves an embedding binding through select, validate, reindex, and explicit cutover
    Given an operator-selected candidate embedding binding version with a dimension change
    When the operator runs validate, then reindex into a new collection generation, then explicit "semantic.embedding.cutover" under CAS and confirmation
    Then the new collection generation becomes live only after cutover succeeds
    And "semantic.embedding.rollback" remains available to restore the prior active version

  # ---------------------------------------------------------------------------
  # Cold-start and no-binding-pinned degrade, never force-configure (FR24, C14, AC7, AC8, AC18, AC29)
  # ---------------------------------------------------------------------------

  Scenario: Retrieval degrades to catalog and lexical fallback when no binding is pinned
    Given an empty or cold semantic index with no embedding or reranker binding pinned
    When Feature 001 routing requests agent or skill candidates
    Then retrieval uses deterministic catalog plus lexical and rules fallback
    And the binding state is recorded as "unavailable" with an explicit degraded reason

  # ---------------------------------------------------------------------------
  # Milvus unavailable typed gap, never silent substitution (FR7, FR24, C1, C20, AC7, AC29)
  # ---------------------------------------------------------------------------

  Scenario: Milvus unavailability surfaces a typed capability gap and never substitutes a model
    Given the configured Milvus backend is unreachable during a retrieval request
    When the index port is called
    Then the outcome carries the typed "milvus_unavailable" capability-gap code
    And routing continues on the catalog plus lexical and rules fallback without hard failure
    And no other embedding or reranker model is ever auto-selected

  Scenario: A reranker timeout degrades ranking without selecting another reranker model
    Given the pinned reranker binding times out during a retrieval request
    When hybrid recall has already completed for the candidate set
    Then deterministic ranking proceeds without rerank scores
    And the degraded reason is recorded without selecting another reranker model

  # ---------------------------------------------------------------------------
  # Hybrid pipeline deterministic ordering and tie-break (FR3, FR19, FR22, C2, C7, AC1-AC3, AC17)
  # ---------------------------------------------------------------------------

  Scenario: The nine-stage pipeline runs in the immutable normative order
    Given a structured task profile for an incoming retrieval request
    When the pipeline executes
    Then the stages run profile, hard filters, hybrid dense and sparse recall, reduced candidate set, rerank, deterministic score, selected Agent, constrained Skill retrieval, and post-retrieval revalidation in that fixed order

  Scenario: Identical inputs produce identical candidate ordering via the deterministic tie-break
    Given two candidates with equal rerank, dense, and sparse scores
    When the deterministic tie-break resolves final order
    Then ties break by rerank score, then dense score, then sparse or lexical score, then canonical ID and version
    And repeated runs over the same inputs yield the same ordering

  # ---------------------------------------------------------------------------
  # Multilingual query against en-US Lang Lock artifacts (FR14-FR16, C4, AC1, AC40)
  # ---------------------------------------------------------------------------

  Scenario Outline: A "<query-language>" query retrieves English Lang Lock skills without a translation call
    Given a "<query-language>" task profile and en-US Lang Lock skills and agents
    When retrieval runs against the multilingual embedding and reranker bindings
    Then relevant English artifacts appear among the candidates
    And no mandatory translation LLM call is required for retrieval

    Examples:
      | query-language |
      | pt-BR           |
      | es               |
      | en               |

  # ---------------------------------------------------------------------------
  # Lazy skill two-pass and chunk injection post-selection (FR21, FR38-FR40, C9, AC2, AC3, AC12)
  # ---------------------------------------------------------------------------

  Scenario: Agent retrieval runs first and constrains the subsequent skill retrieval pass
    Given a task profile with no Agent selected yet
    When "retrieveAgents" completes and returns a selected Agent
    Then "retrieveSkills" runs constrained by that Agent's role and permissions
    And only selected skill chunks are injected after selection under the configured budget

  Scenario: Full skill body chunks are never duplicated into context before selection
    Given skill summary documents indexed ahead of full-body chunks
    When candidate skills are ranked
    Then only summary metadata is used for ranking
    And full-body chunks are retrieved only for selected skills via a Feature 005 OutputSpool ref

  # ---------------------------------------------------------------------------
  # Query-embedding cache reuse across passes (FR18, C10, AC16)
  # ---------------------------------------------------------------------------

  Scenario: The same task fingerprint reuses the cached query embedding across agent and skill retrieval
    Given a query embedding cached by task fingerprint and binding version
    When agent retrieval and then skill retrieval run for the same task
    Then skill retrieval reuses the cached query embedding without a second embed call
    And the cache invalidates only on a binding version or config hash change

  # ---------------------------------------------------------------------------
  # Stale candidate revalidation (FR20, FR27, C11, AC4, AC5)
  # ---------------------------------------------------------------------------

  Scenario: A disabled agent still present in the index is dropped by post-retrieval revalidation
    Given an agent disabled in AgentV2 but still present in the Milvus index
    When search returns that agent as a candidate
    Then post-retrieval revalidation against live AgentV2 rejects the candidate
    And the candidate is never injected into the routing decision

  Scenario: A skill outside the agent's permission profile is dropped after a stale index hit
    Given a skill returned from a stale index entry that is outside the selected Agent's permission profile
    When post-retrieval revalidation runs against live Permission and Policy
    Then the skill is dropped before injection
    And no elevated access is granted based on the stale index entry

  # ---------------------------------------------------------------------------
  # Blue/green cutover atomicity and rollback (FR12, FR32, C12, AC9, AC31-AC33, AC41)
  # ---------------------------------------------------------------------------

  Scenario: Cutover atomically swaps every collection alias in the binding generation together
    Given a validated new index generation covering agents, skills, skill_chunks, and tools collections
    When the operator confirms "semantic.embedding.cutover" under CAS
    Then all collection aliases in that generation swap together atomically
    And no collection is left on the prior generation after the swap

  Scenario: An in-flight Task retains its captured binding version across a cutover
    Given an in-flight Task that captured binding versions at start
    When the operator cutovers to new binding versions mid-task
    Then the in-flight Task keeps the binding versions captured at its start
    And new Tasks started after cutover use the post-cutover versions

  # ---------------------------------------------------------------------------
  # SSRF and DNS rebinding rejection (FR33, C17, AC36, AC38)
  # ---------------------------------------------------------------------------

  Scenario: A hostname resolving to a blocked private or link-local address is rejected
    Given a provider hostname that resolves to a blocked metadata, link-local, or private-range address without local-profile allowance
    When the operator runs provider test or connect
    Then the connection is rejected after post-resolution DNS revalidation
    And the rejection is re-checked after any redirect before connecting

  Scenario: A non-TLS remote endpoint is rejected without an explicit local allowance
    Given a remote provider URL without TLS and no explicit local insecure allowance
    When the operator attempts to add or test the provider profile
    Then the request is rejected
    And only an explicit local profile with a visible warning permits insecure HTTP

  # ---------------------------------------------------------------------------
  # Secret rotation is ref-only and preserves binding identity (FR31, FR35, C19, AC20, AC30, AC35)
  # ---------------------------------------------------------------------------

  Scenario: Rotating a provider secret changes only the secret reference and version
    Given a pinned provider profile bound to an active embedding or reranker binding
    When "semantic.provider.rotate-secret" runs for that profile
    Then only the secret reference and its version change
    And the endpoint, model, and binding identity remain unchanged
    And the plaintext secret never appears in config, history, output, or audit

  # ---------------------------------------------------------------------------
  # Offline golden evaluation with zero leakage tolerance (FR43, C18, AC40)
  # ---------------------------------------------------------------------------

  Scenario: Offline golden evaluation reports zero cross-project and over-permission leakage
    Given a golden evaluation suite covering pt-BR, es, and en task-to-agent and task-to-skill relevance
    When "runGolden" executes against the currently pinned bindings
    Then recall, ranking, and multilingual metrics are recorded per locale
    And the leakage count is exactly zero
    And no binding is mutated by the evaluation run

  # ---------------------------------------------------------------------------
  # Reserved semantic.* catalog authority, exactly 30 IDs, no collision (C15, AC14, AC28, AC37, AC39)
  # ---------------------------------------------------------------------------

  Scenario Outline: Reserved "<command>" command IDs are native-only and make zero LLM calls
    Given the reserved "<command>" command ID from the Feature 007 catalog at RESERVED_CATALOG_VERSION 1.3.0
    When an authorized operator principal issues it through Settings, palette, native-slash, or CLI
    Then it is served with zero provider or model calls, tokens, or cost
    And it is served outside the transcript, ToolRegistry, and MCP surfaces

    Examples:
      | command                          |
      | semantic.provider.add            |
      | semantic.model.validate          |
      | semantic.embedding.cutover       |
      | semantic.reranker.select         |
      | semantic.binding.status          |
      | semantic.index.reconcile         |

  Scenario: A plugin, MCP server, or custom registry cannot register a reserved semantic.* ID
    Given a plugin, MCP server, or custom command registry attempting to register "semantic.embedding.cutover"
    When registration is attempted
    Then the attempt is rejected with a structured "reserved_name" error
    And the canonical Feature 006/Feature 007 implementation remains the sole owner

  Scenario: A prompt, plugin, or MCP attempt to change a binding leaves it unchanged
    Given a prompt, plugin, MCP, or ToolRegistry attempt to select or cutover an embedding or reranker binding
    When the attempt is processed
    Then the attempt is rejected
    And the currently pinned binding and its configuration remain unchanged

  # ---------------------------------------------------------------------------
  # Content-free telemetry (FR41-FR42, C22, AC15)
  # ---------------------------------------------------------------------------

  Scenario: Semantic spans and metrics export without query text, vectors, or entity identifiers
    Given retrieval spans and metrics produced during a retrieval request
    When they are exported over OTLP
    Then only stable enum span names, bounded latency and candidate-count buckets, cache hit, and fallback or stale counts are present
    And no query text, vector, entity ID, session ID, or path label is present
