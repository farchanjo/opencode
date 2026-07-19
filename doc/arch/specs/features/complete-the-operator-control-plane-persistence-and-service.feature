Feature: Complete the Operator Control Plane Persistence and Service
  As an operator managing OpenCode through the native control plane
  I want config mutations to round-trip persist, every mutating verb to commit
  through the shared authority, and the reachable service backends wired to real
  runtime instead of honest capability gaps
  So that management works end to end across palette, slash, CLI, and TUI without
  any fabricated success or orphaned write

  Background:
    Given the operator control plane flag is enabled
    And Feature 007 remains the sole command-registration authority
    And no catalog id is added and no catalog version is bumped

  Scenario: Round-trip a config mutation across a process restart
    Given the operator config namespace is a recognized typed schema key
    And the write path is aligned with a read path the instance loader consumes
    When the operator runs a "langlock" mutation from the CLI, re-reads, then restarts
    Then the mutation returns success with a version bump
    And the immediate re-read shows the mutated state
    And the state still shows after the process restart

  Scenario: Reject a schema-key-only change as a false success
    Given the operator key is accepted but the write path is not aligned with the loader read path
    When a mutation is committed and the state is re-read
    Then the re-read shows configured false
    And the schema-key-only change is not shipped because it is a false success

  Scenario: Invalidate the config cache on commit
    Given a domain document is cached by the instance loader
    When an operator CAS mutation commits
    Then the cache for that authority is invalidated
    And an immediate re-read reflects the new state rather than the stale cached document

  Scenario: Commit a langlock mutation through the shared authority
    Given langlock mutating verbs ride the mutation_plan contract
    When a langlock mutation is dispatched through the full pipeline
    Then mutateAuthority owns the single committed CAS write and the audit correlation
    And no self-committed query result is rejected after a write persisted

  Scenario: Commit a jobs mutation through the shared authority
    Given jobs mutating verbs ride the mutation_plan contract
    When a jobs mutation is dispatched through the full pipeline
    Then the mutation persists over the jobs persistence seam under CAS
    And a re-read reflects the committed job definition

  Scenario: Read and mutate real output spool state
    Given the output spool backend resolves the AppLayer database
    When the operator runs "output.stat" and "output.retention.set"
    Then the read reflects the real control store
    And the retention policy is mutated under the deny-by-default export and share guard

  Scenario: Administer the live MCP host
    Given the mcp backend resolves MCP.Service and McpAuth via AppRuntime
    When the operator runs an "mcp" admin verb
    Then it reflects the live client host
    And it degrades to the typed mcp_unavailable envelope only when the service is unbound

  Scenario: Persist a semantic registry mutation but gate the index
    Given the semantic registry is config-backed and no live Milvus is reachable
    When the operator runs "semantic.provider.add" and then "semantic.index"
    Then "semantic.provider.add" persists and re-reads under CAS
    And "semantic.index" returns the typed milvus_unavailable capability gap

  Scenario: Keep the executor and cancel edges typed capability gaps
    Given the Feature 002 executor and the lifecycle cancel edge are unreachable from the operator AppRuntime
    When the operator runs "jobs.run-now" or a process cancel
    Then each returns the typed unavailable capability gap
    And no fabricated success is returned

  Scenario: Show a truthful Partial availability badge
    Given semantic registry verbs persist while its index verbs are Milvus-gated
    When the grouped operator menu derives the semantic availability
    Then the domain renders the Partial badge
    And its registry Configure entries are editable
    And its index entries surface the typed capability gap

  Scenario: Degrade honestly when config is unreachable
    Given the Config.Service authority is unreachable
    When the operator runs "pools.status"
    Then the read degrades to the typed unavailable envelope
    And no fabricated effective state is synthesized

  Scenario: Preserve command parity across surfaces
    Given the same command id is dispatched from palette, slash, CLI, and TUI
    When any wired verb is invoked
    Then it rides the same OperatorClient loopback with no new dispatch path
    And no catalog id is added and no catalog version is bumped
