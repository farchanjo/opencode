Feature: Durable Tool Output Buffers And Primary Chat Output Budget
  As a maintainer
  I want Feature 059 to point at Feature 060
  So that the empty draft does not ship placeholders

  Scenario: Superseded by Feature 060
    Given Feature 059 was created as a scaffold only
    When the capability is implemented
    Then Feature 060 is the authoritative corpus and implementation
