# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
Feature: Complete the Semantic Binding Lifecycle and the Remaining Operator Residuals
  As an operator of the native control plane
  I want the semantic binding lifecycle activated over the shipped pure engines and
  the remaining MCP and telemetry residuals completed
  So that reranker/embedding cutover, resource subscription, and telemetry export
  actually work while every unreachable dependency stays an honest typed gap

  Background:
    Given the operator control plane is composed and Feature 007 is the sole command authority
    And no new catalog id, catalog version, dispatch path, or feature flag is introduced

  # Group A — reranker lifecycle over a config-backed archive

  Scenario: Reranker cutover activates through the config-backed registry without Milvus
    Given a validated staged reranker candidate and a per-slot binding version archive
    When the operator dispatches "semantic.reranker.cutover" under CAS and confirmation
    Then it routes through the config-backed registry as a mutation plan
    And the rerank cache and eval version are invalidated with re-embedded false
    And no Milvus dependency is touched
    And the prior version is retained in the superseded archive

  Scenario: Reranker cutover without a validated candidate is refused
    Given a staged reranker candidate that has not been validated
    When the operator dispatches "semantic.reranker.cutover"
    Then the result is a typed "not_validated" gate refusal
    And no cache invalidation and no swap occur

  Scenario: Rollback targets a real archived prior, else is rejected
    Given a reranker slot whose archive holds a superseded prior version
    When the operator dispatches "semantic.reranker.rollback" under CAS and confirmation
    Then the archived prior is restored to active
    But given a slot with no superseded prior the rollback returns a typed "no_archived_prior" rejection

  # Group B — embedding cutover, generation build, and reconcile against a live Milvus

  Scenario: Embedding cutover physically builds and validates a generation before the alias swap
    Given a configured Milvus endpoint and a staged embedding candidate needing a new vector space
    When the operator runs "semantic.index.reindex" then "semantic.embedding.cutover"
    Then a blue-green generation is built and validated in Milvus before the alias swaps
    And every collection swaps together under one CAS with agents, skills, skill_chunks, and tools never split
    And select or reindex alone never activate the live alias

  Scenario: An unconfigured Milvus endpoint degrades to the honest typed floor
    Given no Milvus endpoint is configured
    When the operator dispatches any embedding or index verb
    Then the result is the exact typed "milvus_unavailable" envelope returned today
    And no healthy endpoint is fabricated

  Scenario: Reconcile diffs real live and indexed state and never re-pins the binding
    Given the agent, skill, and tool live-doc builders and the enumerate-indexed-docs seam are bound
    When the operator dispatches "semantic.index.reconcile"
    Then reconcile diffs real live docs against real enumerated indexed docs
    And it reports content-free upserted, tombstoned, and unchanged counts
    And the pinned binding version is carried unchanged

  Scenario: Live Milvus validation is env-gated
    Given the environment sets a live Milvus endpoint
    When the env-gated integration path runs
    Then probe, create-generation, upsert, enumerate, and swapAliases succeed against real infrastructure
    And unit tests use a fake port and CI does not require the endpoint

  # Group C — MCP delegation edges completed

  Scenario: MCP auth delegates for an interactive TUI and gaps for headless
    Given an interactive TUI surface
    When the operator dispatches "mcp.auth.start"
    Then it returns the authorize URL and starts the loopback callback listener
    And "mcp.auth.finish" completes the token exchange
    And a headless surface keeps the honest typed gap
    And no token or secret material crosses the envelope

  Scenario: MCP resource subscription drives the dual-authority machine
    Given a subscribe-capable client, the server subscribe capability, and an operator grant
    When the operator dispatches "mcp.resource.admin.subscribe"
    Then the dual-authority subscription machine drives the client subscription
    But given a client without the subscribe capability the verb returns "capability_absent"

  Scenario: Experimental and Extension badges render truthfully
    Given a connected MCP server and config-backed experimental and extension flags
    When the operator reads the mcp status
    Then the badges render Enabled or Disabled from the config-backed flag state
    And they no longer read Unknown

  # Group D — real OTLP telemetry export

  Scenario: Enabled telemetry composes a real export pipeline that sends signals
    Given the effective telemetry config has enabled true and a configured endpoint
    When the export pipeline composes at server start
    Then a real transport binds and at least one signal reaches the collector
    And the bounded queue, drop policy, retry budget, and redaction defaults are honored
    And prompts, secrets, file paths, file content, and tool payloads never leave the process

  Scenario: Disabled telemetry runs no fiber and no network
    Given the effective telemetry config has enabled false
    When the pipeline is evaluated
    Then no export fiber runs and no network call is made

  Scenario: A slow collector never blocks the session loop
    Given telemetry is enabled and the collector is slow or unreachable
    When signals are produced beyond the queue capacity
    Then the drop policy applies and the session loop is never blocked

  # Group E — availability and parity

  Scenario: Availability flips to the composed truth and still-gapped verbs stay honest
    Given the composition lands
    When the grouped operator menu derives availability
    Then each completed verb reads the composed truth
    And any still-gapped verb stays honest_unavailable
    And every verb rides the same command id and loopback with no new dispatch path
