Feature: Native deterministic skill catalog priming in OpenCode
  As an OpenCode user
  I want relevant capped skill listings without fapp hooks
  So that large catalogs do not overload the model and ranking stays natural

  Scenario: Hard cap limits Tier-1 listing
    Given a catalog of more than 24 discoverable skills
    And experimental.skill_list max_listed is 24 with hard_cap true
    When a user turn builds system context
    Then available_skills contains at most 24 skills
    And a skill_list status line reports the listing mode and cap

  Scenario: Semantic ranked order is preserved
    Given F051 returns ranked skill ids with rust before monoio
    When SystemPrompt.skills renders the list
    Then rust appears before monoio in available_skills
    And the list is not alphabetically re-sorted

  Scenario: Lexical fallback when ranking is absent
    Given no ranked skill ids are available
    And the user prompt mentions rust panic tokio
    When the listing is ordered
    Then mode is lexical or matched
    And rust-related skills appear near the top of the capped list

  Scenario: Empty ranked list does not widen
    Given ranked skill ids is an empty array
    When SystemPrompt.skills runs
    Then no skill names are listed in available_skills

  Scenario: Skill tool loads full body
    Given skill rust exists in the catalog
    When the model invokes the skill tool with name rust
    Then the full skill body is returned

  Scenario: Missing skill fails closed
    Given no skill named this-does-not-exist-xyz
    When the skill tool is invoked with that name
    Then the tool fails with not found

  Scenario: Startup index jobs for skills collections
    Given a live semantic IndexPort is available when OpenCode opens
    When the operator stack mounts
    Then background index work for skills and skill_chunks is dispatched once
    And a failure does not prevent startup

  Scenario: TUI can change skill list policy
    Given the skills dialog is open
    When the operator opens Skill list policy and sets max_listed to 16
    Then global experimental.skill_list is updated
    And the next turn uses the new max

  Scenario: HTTP debug shows skill_content only after skill load
    Given OPENCODE_DEBUG_LLM_HTTP is enabled
    When a turn loads skill rust then completes
    Then a later LLM request body includes skill_content markers
    When a turn does not load any skill
    Then LLM request bodies do not include skill_content
