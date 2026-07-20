Feature: Operator config-backed saves must persist reliably and never silently zero
  As an operator saving a config-backed setting (the reproduced case: a role->model pool binding)
  I want the mutation preflight to resolve the SAME Config authority the command commits to
  So that the save persists on the second write and is never silently zeroed ("fica zerado")

  Background:
    Given the operator control plane is enabled on a live wired stack
    And "pools.set" commits to the shared "routing" Config authority
    And the mutation guard rejects a mutation with no CAS token when the authority already exists

  # FR-A / FR-E-a — the reproduced second-write bug is fixed at the root
  Scenario: A second pools.set persists end-to-end
    Given a first "pools.set" has committed a role pool binding to the "routing" authority
    When the operator saves a second "pools.set" binding "[reviewer, worker]"
    And the preflight resolves the authority to "routing" and threads its current version
    Then the second write commits and the "[reviewer, worker]" binding persists
    And re-opening the pool shows the saved binding, not an empty pool

  # FR-A / FR-E-b — a virgin-prefix read no longer blocks the first write
  Scenario: A first pools.set on a config already holding a routing document persists
    Given the config already holds a "routing" document from a prior routing write
    When the operator saves its first "pools.set" binding
    Then the preflight reads the existing "routing" version and threads it
    And the write commits without failing "mutations require version"

  # FR-A / FR-E-c — the degraded fallback is correct-by-construction
  Scenario: The degraded fallback resolves the right authority without the wired resolver
    Given a preflight path where the full authority resolver is absent
    When "pools.set" is preflighted through the hardened authorityKeyForCommandId
    Then it resolves the authority to "routing" and not to the id prefix "pools"
    And the save reads the real version and persists

  # FR-C — the optimistic-concurrency guard is preserved, never weakened
  Scenario: A stale CAS token is still rejected as a conflict
    Given two operators have read the same "routing" version
    And the first operator has committed a change that bumped the version
    When the second operator commits with the now-stale version
    Then the mutation is rejected with a CAS version conflict
    And no save auto-resolves or defaults the missing or stale token

  # FR-D / FR-E-d — a rejected save is surfaced, never a silent success
  Scenario: A rejected save is surfaced in-modal and never zeroes the pool
    Given a "pools.set" that the backend rejects with a typed failure
    When the save dispatches from an operator form
    Then the modal stays open and shows the typed, secret-free reason
    And the form does not close and does not fire onSaved
    And the existing binding is not silently zeroed

  # FR-B — the production wiring invariant is guarded against regression
  Scenario: Every production preflight port threads the real authority resolver
    Given the production operator ports for the trusted worker fetch, the worker-local slash port, and the HTTP mount
    When the preflight wiring is asserted
    Then each port threads the live stack's resolveAuthority into its preflight
    And no production preflight port falls back to the raw command-id prefix for a static-authority command
