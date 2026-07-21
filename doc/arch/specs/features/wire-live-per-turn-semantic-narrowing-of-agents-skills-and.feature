# Source: doc/arch/sdd/051-wire-live-per-turn-semantic-narrowing-of-agents-skills-and/spec.md
# (FR1-FR9, Acceptance Scenarios) and the approved semantic-selection plan
# (Feature SR-B). Prose-style scenarios describe intended behavior precisely
# enough for later automation; they do not require concrete step bindings.

Feature: Wire Live Per Turn Semantic Narrowing Of Agents Skills And
  As a user sending a prompt in a live opencode session
  I want the agents, skills, and tools surfaces narrowed to what is relevant to my turn
  So that irrelevant catalog surface shrinks without ever breaking or blocking my turn

  Background:
    Given the Feature 050 semantic index data plane is populated and reachable
    And SemanticRetrieval.Service is mounted into the live AppLayer with real bindings
    And the agents, skills, and tools narrowing gates are enabled

  # ---------------------------------------------------------------------------
  # One memoized computation per turn, tool-call continuity (FR1)
  # ---------------------------------------------------------------------------

  Scenario: Narrowing is computed once per user turn and reused across tool-call round trips
    Given a user turn that requires several tool-call round trips inside the runLoop
    When "narrowForTurn" computes NarrowedSets for the turn's "lastUser.id"
    Then the same memoized NarrowedSets is read by every runLoop step of that turn
    And the narrowed agent, skill, and tool sets never mutate mid-turn

  Scenario: A single prompt embedding feeds every surface's retrieval pass
    Given a new user turn with all narrowing gates enabled
    When "narrowForTurn" runs
    Then the turn's prompt is embedded exactly once
    And the agents, skills, and tools retrieval passes run concurrently under one shared latency budget

  # ---------------------------------------------------------------------------
  # Degenerate-input guard and the first-turn hole (FR2)
  # ---------------------------------------------------------------------------

  Scenario: A short follow-up turn reuses the previous narrowing memo
    Given a session with an existing NarrowedSets memo from a prior turn
    When the next user turn's text is below the degenerate-input length threshold
    Then "narrowForTurn" reuses the previous memo verbatim
    And no new embedding call is made

  Scenario: A short first turn with no prior memo falls back to passthrough
    Given a brand new session with no prior NarrowedSets memo
    When the first user turn's text is below the degenerate-input length threshold
    Then "narrowForTurn" returns passthrough for every surface
    And no embedding call is made

  # ---------------------------------------------------------------------------
  # Empty and degenerate results normalize to passthrough (FR3)
  # ---------------------------------------------------------------------------

  Scenario: A retrieval pass with zero hits never yields an empty catalog
    Given an agents retrieval pass that returns zero ranked hits for the turn
    When "live-narrowing.ts" resolves the surface's gate
    Then the agents surface resolves to passthrough (undefined), never an empty ranked list

  Scenario: A result set emptied entirely by revalidation never yields an empty catalog
    Given a ranked result set whose every hit is dropped by live-registry revalidation
    When "live-narrowing.ts" resolves the surface's gate
    Then that surface resolves to passthrough (undefined), never an empty ranked list

  # ---------------------------------------------------------------------------
  # Three seams delegating to the shared ToolRetrieval primitive (FR4)
  # ---------------------------------------------------------------------------

  Scenario: Agent narrowing pins every hidden orchestration agent outside the ranked set
    Given a prompt whose semantics do not surface "manager-router" or "manager-composer"
    When "ToolRegistry.describeTask" renders the narrowed agent description
    Then every agent with "hidden: true" is rendered alongside, never filtered by, the ranked agents
    And narrowing edits only the task description prose, never task spawn permission

  Scenario: Skill narrowing reorders the available-skills listing without spending chunk or token budget
    Given a prompt that ranks a specific skill highly
    When "SystemPrompt.skills" renders the narrowed listing
    Then the ranked skill appears first in the "<available_skills>" listing
    And neither "max_skill_chunks" nor "max_skill_tokens" is consumed by this listing pass

  Scenario: Tool narrowing unions the essential-tool floor before applying the ranked gate
    Given a prompt that ranks no file or shell tools highly
    When the live gate replaces "ToolRetrieval.PASSTHROUGH" at the native and MCP surfaces
    Then "task", "skill", "todowrite", "question", "read", "edit", "write", "bash", "grep", and "glob" are all present in the narrowed tool set
    And the reranker may reorder these tools but never remove one

  # ---------------------------------------------------------------------------
  # Orchestration-child sessions skip tool narrowing (FR5)
  # ---------------------------------------------------------------------------

  Scenario: A session carrying orchestrationChildToolRules is never tool-narrowed
    Given a session whose permission ruleset carries "orchestrationChildToolRules"
    When "narrowForTurn" resolves the tools surface for that session
    Then the tools surface resolves to passthrough without attempting retrieval

  # ---------------------------------------------------------------------------
  # Independent per-surface gates, byte-identical when disabled (FR6)
  # ---------------------------------------------------------------------------

  Scenario: All narrowing gates disabled renders byte-identical to the pre-Feature-051 catalog
    Given the agents, skills, and tools narrowing gates are all disabled
    When a live turn runs before and after this feature is deployed
    Then "narrowForTurn" short-circuits before any embedding or Milvus call
    And the turn's agent catalog, skill listing, and tool set are byte-identical

  # ---------------------------------------------------------------------------
  # Fail-open query plane, zero live-turn retries (FR7)
  # ---------------------------------------------------------------------------

  Scenario: Milvus is unreachable for the whole turn
    Given Milvus is unreachable when the turn's narrowing passes run
    When "narrowForTurn" resolves every surface
    Then every surface passes through to its full catalog
    And exactly one content-free warning is logged for the turn
    And the turn completes normally

  Scenario: Milvus fails once and would succeed on a second attempt
    Given Milvus responds with a transient failure on the first attempt during a live turn
    When "narrowForTurn" resolves the affected surface
    Then no second attempt is made within the turn
    And the surface passes through immediately, preserving the latency budget

  Scenario: A stale specialist is dropped by revalidation, never surfaced
    Given a specialist agent's file was deleted without a reindex having run yet
    And the stale entry still ranks highly in the semantic index
    When the turn's agent narrowing runs
    Then the stale specialist is revalidated against the live registry and dropped
    And the stale specialist never appears in the rendered task description

  # ---------------------------------------------------------------------------
  # Mounting the retrieval service with real bindings (FR9)
  # ---------------------------------------------------------------------------

  Scenario: SemanticRetrieval.Service is mounted with live runner deps, not the degraded default
    Given the live AppLayer composition root
    When the application starts with narrowing gates available to be enabled
    Then "SemanticRetrieval.Service" is composed via "createSemanticRetrievalPort" with real Milvus, embedding, and reranker bindings
    And no second composition site constructs these bindings
