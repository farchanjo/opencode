Feature: Four native main-session primary modes without profile agent MD
  As an OpenCode user
  I want Plan, Agent, Solo, and Speckit modes in the same session
  So that I can switch behaviour without profile agent markdown for those modes

  Scenario: Four native primaries exist and ask does not
    Given OpenCode loads the native agent registry
    When primary agents are listed
    Then plan, build, solo, and speckit are present as primary native agents
    And there is no primary agent named ask

  Scenario: Same session mode switch
    Given a session is active on build
    When the user switches agent to solo then speckit then plan
    Then the session identity is unchanged
    And each turn uses the selected agent permissions

  Scenario: Speckit mode denies free edit and implement
    Given the session agent is speckit
    When free edit of packages source is attempted
    Then the edit is denied
    When bash attempts speckit implement
    Then the bash invocation is denied

  Scenario: Speckit mode allows Speckit status CLI
    Given the session agent is speckit
    When bash runs an allowed Speckit status command form
    Then the bash permission ruleset allows it

  Scenario: Speckit mode keeps MCP tools permission-visible
    Given the session agent is speckit
    And no global deny rule targets a representative MCP tool id
    When permission is evaluated for chrome-devtools_list_pages
    Then the tool is not disabled by a blanket star deny
    And skill permission is allowed

  Scenario: Solo keeps MCP tools permission-visible
    Given the session agent is solo
    And no global deny rule targets a representative MCP tool id
    When permission is evaluated for chrome-devtools_list_pages
    Then the tool is allowed subject to global user permission config
    And task spawn remains denied

  Scenario: Solo denies task spawn
    Given the session agent is solo
    When task spawn of a subagent is attempted
    Then the spawn is denied

  Scenario: Build allows task spawn
    Given the session agent is build
    When task spawn of a valid subagent type is attempted
    Then the spawn is allowed subject to existing task rules

  Scenario: Plan exit targets build
    Given plan_exit completes with user approval
    When the synthetic follow-up user message is created
    Then its agent field is build

  Scenario: Defaults work without profile agent MD
    Given no profile agent MD exists for plan build solo or speckit
    When the agent registry loads
    Then all four modes are available from shipped defaults and native registration
