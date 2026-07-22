Feature: Collapse The Three Tier Architect Manager Worker Hierarchy
  As an OpenCode user
  I want the main session to act as Architect and Manager
  So that only Worker children are dispatched and the failed middle Manager tier is gone

  Scenario: Main always dispatches Workers
    Given Smart Routing hierarchy dispatch is active
    When the main Architect session spawns a task child for any task text
    Then the child is classified as worker
    And the child is never classified as manager

  Scenario: Legacy force_manager does not create a Manager child
    Given hierarchy.orchestration_mode is force_manager
    When the main session spawns a hierarchy child
    Then no Manager child session is created
    And the spawn follows the collapsed two-tier path

  Scenario: Worker is a leaf at depth one
    Given a Worker session at hierarchy depth 1
    When the Worker attempts to spawn a hierarchy subagent
    Then the spawn is refused
    And max delegation depth remains 1

  Scenario: Main validates Workers without a Manager middle session
    Given main has dispatched one or more Workers under budget admission
    When the Workers complete
    Then main validates and synthesizes the results
    And no intermediate Manager session participates in the validation chain

  Scenario: Illegal manager child edge is blocked by the engine
    Given a dispatch request with parent architect and child manager
    When HierarchyDispatcher planDispatch evaluates the edge
    Then the dispatch is blocked as an illegal edge

  Scenario: Telemetry records architect to worker only
    Given a main to Worker hierarchy dispatch occurs
    When hierarchy observations are exported
    Then parent_role is architect
    And child_role is worker
    And depth is less than or equal to 1
