# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/050-wire-the-semantic-index-data-plane-production-pipeline/spec.md
# (FR1-FR13, Acceptance Criteria 1-10) and the approved semantic-selection plan
# (Feature SR-A). Prose-style scenarios describe intended behavior precisely
# enough for later automation; they do not require concrete step bindings.

Feature: Wire The Semantic Index Data Plane Production Pipeline
  As an operator running the semantic index on the ~/.opencodedev profile
  I want a production pipeline runner, real dimension discovery, and a bounded retry policy
  So that agents, skills, skill chunks, and tools are actually embedded and upserted with zero live-turn behavior change

  Background:
    Given the profile "~/.opencodedev" with OPENCODE_CONFIG_DIR set to that path
    And Milvus reachable at "vm.services:19530"
    And the solaris embedding and reranker bindings active and validated

  # ---------------------------------------------------------------------------
  # Full reindex across all four collections (FR1, FR7-FR10, AC1)
  # ---------------------------------------------------------------------------

  Scenario: A full reindex upserts non-zero documents into all four collections
    Given the production PipelineRunnerPort and LiveDocSource are wired into the profile
    When the operator runs "embedding-reindex" on the profile
    Then the "agents", "skills", "skill_chunks", and "tools" collections each report non-zero upserts
    And no live session or turn code path is invoked during the reindex

  # ---------------------------------------------------------------------------
  # Model-driven dimension discovery, probe authoritative (FR6, AC2)
  # ---------------------------------------------------------------------------

  Scenario: The generation is stamped with the real probed dimension, not a hardcoded default
    Given the solaris Qwen3-Embedding-4B embedding binding is bound
    When "generationVectorSpace" builds a new generation
    Then "EmbeddingClient.probe" embeds a fixed test string against the bound model
    And the generation is stamped with dimension 2560, never a hardcoded 1024

  # ---------------------------------------------------------------------------
  # Fail closed on unknown dimension, no silent default (FR6, AC8)
  # ---------------------------------------------------------------------------

  Scenario: An unreachable embedding endpoint refuses the generation build instead of defaulting
    Given the bound embedding model's endpoint is unreachable
    When the dimension probe runs during generation build
    Then the probe retries twice with bounded backoff
    And generation build refuses with a typed capability gap
    And no generation is ever stamped with a silent default dimension

  # ---------------------------------------------------------------------------
  # Staleness: delete drives drift to zero (FR8-FR10, AC3)
  # ---------------------------------------------------------------------------

  Scenario: Deleting a seeded skill file removes its document and spool entry on reconcile
    Given a seeded skill file indexed in "skills" and "skill_chunks" with a resolvable body_ref
    When the skill file is deleted and reconcile runs
    Then the corresponding SkillDoc and SkillChunkDoc are removed
    And the associated OutputSpool entry is removed
    And drift against the live registry is 0

  # ---------------------------------------------------------------------------
  # Staleness: edit supersedes, never duplicates (FR8, AC4)
  # ---------------------------------------------------------------------------

  Scenario: Editing a seeded skill body supersedes the indexed chunk without duplicating it
    Given a seeded skill file already indexed with a known content hash
    When the skill body is edited and reconcile runs
    Then the chunk document is superseded by the new content hash
    And no duplicate chunk document remains for the same skill

  # ---------------------------------------------------------------------------
  # Staleness: unchanged corpus skips embedding entirely (FR9, AC5)
  # ---------------------------------------------------------------------------

  Scenario: An unchanged corpus produces zero embedding calls on reconcile
    Given "LiveDocSource.collect" receives the indexed {id, contentHash} map from the prior generation
    When reconcile runs with no source changes
    Then zero embedding calls are made
    And the reconcile job reports zero upserts and zero deletes

  # ---------------------------------------------------------------------------
  # Retry: bounded, per-batch resume, domain errors never retried (FR12, AC7)
  # ---------------------------------------------------------------------------

  Scenario: A transient Milvus failure mid-reindex retries in bounds and resumes per batch
    Given a reindex job with several embed batches in flight
    When Milvus becomes transiently unavailable mid-reindex
    Then the affected batch retries with bounded jittered exponential backoff, at most 3 attempts
    And reconcile resumes from the last durable per-batch step, never restarting the full reindex
    And "ConsumptionResilience.retry_count" increments for each retry

  Scenario: A domain error during reindex is never retried
    Given a reindex job encounters a typed domain error such as "dimension_mismatch"
    When the runner classifies the error
    Then the operation fails immediately without any retry attempt
    And "ConsumptionResilience.retry_count" does not increment for that failure

  # ---------------------------------------------------------------------------
  # Zero live-turn behavior change (FR13)
  # ---------------------------------------------------------------------------

  Scenario: Live turns remain byte-identical while this feature ships only the data plane
    Given the production pipeline runner, doc builders, chunker, and reindex triggers are all wired
    When a live session turn runs before and after this feature is deployed
    Then the turn's tool set, skill listing, and agent catalog are byte-identical
    And no session or turn code path calls the retrieval facade or the new runner
