Feature: Wire the Four Remaining Config-Backed Operator Domains
  As an operator managing OpenCode through the native control plane
  I want the telemetry, smart, budget, and pools domains backed by real
  Config-backed ports instead of generic not_implemented stubs
  So that I can read their live effective state and mutate it under CAS through
  the same palette, slash, CLI, and TUI surfaces as every other domain

  Background:
    Given the operator control plane flag is enabled
    And the telemetry, smart, budget, and pools verbs are reserved in the catalog
    And Feature 007 remains the sole command-registration authority

  Scenario: Read live telemetry effective state
    Given the effective telemetry config has an export endpoint configured
    When the operator runs "telemetry.status"
    Then the redacted telemetry summary reports the enabled flag, transport, and endpoint
    And the summary carries the Config.Service version
    And no export header secret is disclosed in the result

  Scenario: Configure telemetry export with a secret-bearing header
    Given the operator supplies an export header as a SecretRef
    When the operator runs "telemetry.configure" with the expected version
    Then the header is persisted as a SecretRef only, never as plaintext
    And the mutation persists through the same Config.Service seam langlock uses

  Scenario: Probe telemetry export reachability
    Given the effective telemetry config points at a reachable OTLP endpoint
    When the operator runs "telemetry.test"
    Then the probe returns a typed reachable outcome bounded by a timeout
    And no telemetry signal content is sent beyond the probe
    And the operator loop is never blocked

  Scenario: Probe an unconfigured telemetry endpoint
    Given no telemetry export endpoint is configured
    When the operator runs "telemetry.test"
    Then the probe returns the typed misconfigured outcome without dialing the network

  Scenario: Toggle smart routing through its own domain port
    Given smart routing Activation.enabled is false in routing config
    When the operator runs "smart.on" with the expected version
    Then Activation.enabled is set true over the routing Config.Service authority
    And "smart.status" reports the projected enabled state

  Scenario: Read and mutate the budget policy
    Given the effective budget is seeded from the default routing budget
    When the operator runs "budget.show"
    Then the bounded budget limits view is returned from the effective config
    And a "budget.set" mutation persists under an optimistic CAS expectation

  Scenario: Project and mutate role pools
    Given the routing config Models role_pools map holds role-to-model bindings
    When the operator runs "pools.show"
    Then the projected role-pool bindings are returned over routing config
    And "pools.reset" is available as a CAS-guarded mutation

  Scenario: Reject a stale mutation with a typed conflict
    Given the persisted config version has advanced past the operator's expected version
    When the operator runs "budget.set" with the stale expected version
    Then the mutation degrades to the typed version_conflict envelope
    And no fabricated success is returned

  Scenario: Degrade honestly when config is unreachable
    Given the Config.Service authority is unreachable
    When the operator runs "pools.status"
    Then the read degrades to the typed unavailable envelope
    And no fabricated effective state is synthesized

  Scenario: Flip the four domains to persists_today in the TUI
    Given the Feature 011 grouped operator menu lists the four Configure sections
    When the availability map is consulted for telemetry, smart, budget, and pools
    Then each domain reports persists_today instead of honest_unavailable
    And its Configure entries are editable in the TUI menu

  Scenario: Preserve command parity across surfaces
    Given the same command id is dispatched from palette, slash, CLI, and TUI
    When any telemetry, smart, budget, or pools verb is invoked
    Then it rides the same OperatorClient loopback with no new dispatch path
    And no catalog id is added and no catalog version is bumped
