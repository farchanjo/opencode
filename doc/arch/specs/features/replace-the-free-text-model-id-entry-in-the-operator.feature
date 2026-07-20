Feature: Replace the free-text model id entry in the Operator
  As an operator configuring model bindings in the admin palette
  I want to pick a model from an always-up-to-date list of the connected models
  So that I choose a real connected model by name instead of hand-typing
  "anthropic/claude-…" and risking a typo, while a catalog-absent id stays enterable

  Background:
    Given the Operator admin palette is open and the sync connected catalog is loaded
    And the operator payload contracts and the OperatorSlashPort dispatch are unchanged
    And no operator command id, catalog version, dispatch path, or feature flag is introduced

  # Group A / B — pick from the live connected list (pools.set)

  Scenario: Pick a bound model from the live connected list and append it
    Given a role pool editor whose connected catalog includes "anthropic/claude-…"
    When the operator triggers "+ Add model" and selects that model from the provider-grouped list
    Then "anthropic/claude-…" is appended to the binding models as its "provider/model" id string
    And the composed "pools.set" payload keeps the shape "{ bindings: [{ role, models: string[] }] }"
    And no free-text prompt is required for the selection

  Scenario: Search narrows the connected list before selection
    Given the picker is open over several connected providers
    When the operator types a query
    Then the list fuzzy-filters over the model title and provider category
    And selecting a filtered entry appends that "provider/model" id

  Scenario: A model already in the binding list is indicated and not duplicated
    Given a binding whose models already include "anthropic/claude-…"
    When the operator opens the picker
    Then that model is indicated as already selected and is skippable
    And it is not silently duplicated into the binding models

  # Group B — pick from the live connected list (semantic.model.disable)

  Scenario: Pick a model to disable from the live connected list
    Given the "semantic.model.disable" field with a loaded connected catalog
    When the operator selects a model from the picker
    Then the composed payload is "{ id: \"provider/model\" }" unchanged

  # Group C — the raw-text escape hatch never regresses

  Scenario: Enter a catalog-absent id through the Custom id… escape hatch
    Given a "provider/model" id that is not in the connected catalog
    When the operator chooses "Custom id…" in the picker
    Then the existing raw free-text prompt opens
    And a trimmed non-empty string is accepted exactly as it is today
    And for "pools.set" it is appended to the binding models
    And for "semantic.model.disable" it composes "{ id }"

  Scenario: A registered-but-disconnected model is entered through the escape hatch
    Given a model that is registered but whose provider is not currently connected
    When the operator opens the "semantic.model.disable" picker
    Then the model is not in the connected list
    But the "Custom id…" escape hatch still allows entering its id

  # Group D — reactivity, empty catalog, and cancel

  Scenario: An empty catalog never dead-ends the picker
    Given no providers are connected and the connected catalog is empty
    When the operator opens the picker
    Then the picker still renders and offers the "Custom id…" action
    And it does not present an empty, unusable dialog

  Scenario: The list updates reactively while the picker is open
    Given the picker is open over the connected catalog
    When a provider connects or disconnects and the sync store updates
    Then the option list re-derives to reflect the new connected set without reopening the picker

  Scenario: Cancel leaves the form state untouched
    Given the picker is open
    When the operator presses esc or cancels
    Then the picker closes
    And neither the binding models nor the descriptor value is mutated
