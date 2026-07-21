Feature: Emit Real Opentelemetry Spans And Metrics For Routing
  As an operator running Smart Routing in production
  I want real OTLP spans and metrics for the four routing domains
  So that I can observe the routing stack without slowing or breaking a turn

  Background:
    Given the shipped process-singleton OTLP export pipeline is available
    And the exported attribute set is restricted to the structural allow-list

  Scenario: A routing decision emits a content-free span and metric
    Given telemetry is enabled with a reachable OTLP endpoint
    When a routing decision is committed at the live session seam
    Then a "routing.decision" span and metric point are enqueued for export
    And the attributes carry only the allow-listed structural scalars
    And no prompt, response, or secret appears in the exported payload

  Scenario: A budget breach emits a consumption point and a breach counter
    Given telemetry is enabled with a reachable OTLP endpoint
    When the budget seam records a per-turn spend that hard-stops the turn
    Then a "budget.consumption" metric point is emitted with the turn totals
    And a "budget.breach" counter is emitted with the breached dimension
    And the routing turn completes without awaiting the export

  Scenario: A fan-out denial emits an admission span with a bounded reason
    Given telemetry is enabled with a reachable OTLP endpoint
    When the fan-out admission engine denies a requested fan-out
    Then a "hierarchy.fanout" signal is emitted with admitted false
    And it carries the parent role, child role, and the requested and granted counts
    And it carries a bounded typed denied-reason, never free user text

  Scenario: A delegated worker terminal transition emits an orchestration outcome
    Given telemetry is enabled with a reachable OTLP endpoint
    When a delegated worker reaches a terminal state
    Then an "orchestration.worker" signal is emitted with its lifecycle and verdict

  Scenario: A slow or down collector never breaks a routing turn
    Given telemetry is enabled but the OTLP collector is unreachable
    When the four domains emit during a routing turn
    Then the routing turn completes normally with unaffected latency
    And the exports drop silently without propagating an error

  Scenario: Disabled telemetry emits nothing and is byte-identical
    Given the telemetry authority is disabled
    When any of the four seams runs
    Then no signal is emitted
    And no tracer, meter, or transport is constructed on the hot path
