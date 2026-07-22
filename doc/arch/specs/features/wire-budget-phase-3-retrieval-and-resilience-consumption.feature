# Source: doc/arch/sdd/055-wire-budget-phase-3-retrieval-and-resilience-consumption/spec.md
# Prose scenarios for AC intent; executable coverage is unit tests under
# packages/opencode/test/session/budget-consume.test.ts (no step harness yet).
Feature: Wire budget phase 3 retrieval and resilience consumption
  As an opencode maintainer
  I want retrieval and validation spend recorded into budget consumption
  So that Phase 3 residual dimensions enforce real observed spend

  Scenario: narrowing records retrieval chunks
    Given Smart Routing is enabled and semantic narrowing returns kept candidates
    When the turn records budget consumption
    Then retrieval_chunks_used reflects those candidates

  Scenario: multi-turn does not spurious-breach retrieval_top_k
    Given two turns each retrieve within retrieval_top_k
    When the budget is re-evaluated after each turn
    Then neither turn is blocked solely for cumulative retrieval sum

  Scenario: worker domain validation increments validation_count
    Given a Manager completes a Worker with domain validation performed
    When the fold records resilience consumption
    Then the parent session validation_count increases by one
