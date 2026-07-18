import { describe, expect, test } from "bun:test"
import type { DegradationOutcome, SemanticModelBinding } from "@opencode-ai/protocol/semantic/commands"
import { deriveBindingCardView } from "./card"

function binding(overrides: Partial<SemanticModelBinding> = {}): SemanticModelBinding {
  return {
    id: "binding_1",
    slot: "embedding",
    bindingVersion: 3,
    providerProfileId: "provider_1",
    modelDescriptorId: "model_1",
    compatibilityMode: "embedding",
    capabilityContract: ["embedding", "multilingual"],
    state: "active",
    selectedBy: "operator_1",
    selectedAt: "2026-07-18T00:00:00.000Z",
    configHash: "hash_1",
    ...overrides,
  }
}

describe("semantic-panel binding card projection (FR29, FR30, C1, C20)", () => {
  test("unpinned (undefined) binding derives to null, never an invented card", () => {
    expect(deriveBindingCardView(undefined)).toBeNull()
  })

  test("derives text-first fields for a nominal binding, never color-only", () => {
    const view = deriveBindingCardView(binding())
    expect(view?.slotText).toBe("embedding")
    expect(view?.stateText).toBe("active")
    expect(view?.modeText).toBe("embedding")
    expect(view?.modelDescriptorIdText).toBe("model_1")
    expect(view?.originText).toBe("operator_1")
    expect(view?.versionText).toBe("v3")
    expect(view?.degradedText).toBe("nominal")
  })

  test("a full_semantic rung is never rendered as degraded", () => {
    const degradation: DegradationOutcome = { rung: "full_semantic" }
    expect(deriveBindingCardView(binding(), degradation)?.degradedText).toBe("nominal")
  })

  test("a non-full_semantic rung surfaces degraded status textually without substituting the model", () => {
    const degradation: DegradationOutcome = { rung: "catalog_lexical", gapCode: "milvus_unavailable" }
    const view = deriveBindingCardView(binding(), degradation)
    expect(view?.degradedText).toBe("degraded (milvus_unavailable)")
    expect(view?.modelDescriptorIdText).toBe("model_1")
    expect(view?.versionText).toBe("v3")
  })
})
