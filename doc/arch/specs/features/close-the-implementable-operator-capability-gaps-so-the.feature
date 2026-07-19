Feature: Close the Implementable Operator Capability Gaps
  As an operator
  I want the operator control plane's implementable capability gaps closed and
  the TUI able to actually configure a domain
  So that MCP, output, jobs, and semantic verbs reflect real state and every
  Configure verb opens a real multi-field form instead of a raw JSON prompt

  Background:
    Given the operator control plane flag is enabled
    And every verb rides the same OperatorClient loopback with no new dispatch path

  Scenario: MCP server reads reflect the live client
    Given MCP.Service is bound with one connected server and one needs_auth server
    When the operator runs mcp.server.list
    Then the result reflects the live connection status and capabilities-present
    And the SSOT-only fields CAS version, auditId, and trust profile are absent
    And nothing is fabricated

  Scenario: MCP config mutation commits through the shared authority
    Given mcp.server.add rides the OperatorMutationPlan contract
    When the operator dispatches it through the full pipeline
    Then mutateAuthority owns the single committed CAS write over the MCP config authority
    And no self-committed query result is rejected after a write

  Scenario: Live MCP connection action returns an honest outcome
    Given mcp.server.reconnect dispatches as a plan whose apply calls MCP.Service
    When the operator reconnects a configured server
    Then it returns a typed outcome reflecting the resulting Status
    And it never performs a phantom write

  Scenario: Session output is spooled and read back
    Given the production writer is subscribed at the session message-part seam
    When a session produces output and the operator runs output.stat and output.read
    Then the result reflects the real populated control store
    And output.follow streams committed pages under bounded backpressure

  Scenario: Populated spool admin edge acts through a store-scoped authority
    Given the control store is populated and the admin edge is wired
    When the operator runs output.release, output.delete, or output.purge
    Then the op acts on the real control store with the Feature 007 audit preserved
    And no config CAS version is fabricated

  Scenario: Jobs occurrence history is projected over the durable seam
    Given the EventV2Bridge durable seam is bound
    When the operator runs jobs.history and opens jobs.watch
    Then the durable job occurrence events are projected as a bounded read model
    And the watch subscription is bounded and closable

  Scenario: Semantic index binds when Milvus is configured
    Given a Milvus endpoint is configured
    When the operator runs semantic.index
    Then the op binds over the live milvus-adapter under bounded probes
    But with no endpoint configured it returns the typed milvus_unavailable gap

  Scenario: Deferred edges stay typed capability gaps
    Given the Feature 002 executor and the lifecycle forced-abort edge are unreachable
    When the operator runs jobs.run-now or process cancel
    Then each returns a typed unavailable capability gap
    And nothing is fabricated

  Scenario: Configure telemetry with a real multi-field form
    Given telemetry.configure is a payload-carrying Configure verb
    When the operator opens its Configure modal
    Then it shows a labeled endpoint field pre-filled from the current value
    And a transport picker offering http/protobuf and grpc
    And Save composes the byte-exact endpoint and transport payload and dispatches once

  Scenario: Edit pools bindings with the list editor
    Given pools.set opens the bindings-list editor pre-filled from pools.show
    When the operator adds a role and models binding and saves
    Then the modal composes exactly bindings and expectedVersion and dispatches once
    And a payload it cannot compose surfaces an in-modal error not a global toast

  Scenario: Configure routing without a bare JSON prompt
    Given the routing policy is a large document
    When the operator opens routing.configure
    Then it shows the structured common fields enabled toggle and mode picker
    And a labeled advanced JSON field
    But never a bare unlabeled JSON prompt as the only path

  Scenario: Read full detail in the view modal
    Given telemetry.test returns an effective payload with a nested target record
    When the operator opens the view modal
    Then target expands to its endpoint and transport fields as an indented tree
    And a bounded depth is honored with an honest truncation marker when exceeded
    But the inline status strip keeps its compact count summary

  Scenario: The runtime-generated config is never committed
    Given a live CLI run generates packages/opencode/config.json
    When git status is checked
    Then the file is ignored and cannot be staged or committed
