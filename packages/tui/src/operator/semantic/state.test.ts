import { describe, expect, test } from "bun:test"
import type { SemanticModelBinding, SemanticModelDescriptor } from "@opencode-ai/protocol/semantic/commands"
import {
  deriveEmbeddingBindingView,
  deriveEmbeddingSelectorCandidates,
  deriveRerankerBindingView,
  deriveRerankerSelectorCandidates,
  deriveVisibleModelBadges,
  EMPTY_SEMANTIC_PANEL_SIGNAL,
  isEmbeddingEligible,
  isRerankerEligible,
  MAX_VISIBLE_MODELS,
  mergeSemanticEffective,
  projectSemanticSignal,
  type SemanticPanelSignal,
} from "./state"

function descriptor(id: string, overrides: Partial<SemanticModelDescriptor> = {}): SemanticModelDescriptor {
  return {
    id,
    providerProfileId: "provider_1",
    modelRef: `ref_${id}`,
    displayName: `Model ${id}`,
    source: "manual",
    capabilityKinds: ["embedding"],
    endpointMode: "embeddings",
    languageSupport: ["en"],
    probeState: "validated",
    enabled: true,
    ...overrides,
  }
}

function binding(slot: SemanticModelBinding["slot"]): SemanticModelBinding {
  return {
    id: `binding_${slot}`,
    slot,
    bindingVersion: 1,
    providerProfileId: "provider_1",
    modelDescriptorId: "model_1",
    compatibilityMode: slot === "embedding" ? "embedding" : "native-rerank",
    capabilityContract: [slot],
    state: "active",
    selectedBy: "operator_1",
    selectedAt: "2026-07-18T00:00:00.000Z",
    configHash: "hash_1",
  }
}

describe("semantic-panel signal + projections (FR29, FR30, C16, AC34)", () => {
  test("the empty baseline renders no badges and no bindings", () => {
    expect(deriveVisibleModelBadges(EMPTY_SEMANTIC_PANEL_SIGNAL)).toEqual([])
    expect(deriveEmbeddingBindingView(EMPTY_SEMANTIC_PANEL_SIGNAL)).toBeNull()
    expect(deriveRerankerBindingView(EMPTY_SEMANTIC_PANEL_SIGNAL)).toBeNull()
    expect(deriveEmbeddingSelectorCandidates(EMPTY_SEMANTIC_PANEL_SIGNAL)).toEqual([])
    expect(deriveRerankerSelectorCandidates(EMPTY_SEMANTIC_PANEL_SIGNAL)).toEqual([])
  })

  test("a resolved binding renders the effective binding card per slot", () => {
    const signal: SemanticPanelSignal = { models: [], embeddingBinding: binding("embedding"), rerankerBinding: binding("reranker") }
    expect(deriveEmbeddingBindingView(signal)?.slotText).toBe("embedding")
    expect(deriveRerankerBindingView(signal)?.slotText).toBe("reranker")
  })

  test("the visible model badge count is bounded", () => {
    const models = Array.from({ length: MAX_VISIBLE_MODELS + 10 }, (_, i) => descriptor(`m${i}`))
    expect(deriveVisibleModelBadges({ models }).length).toBe(MAX_VISIBLE_MODELS)
  })

  test("embedding selector excludes disabled and non-validated candidates", () => {
    const models = [
      descriptor("eligible", { capabilityKinds: ["embedding"] }),
      descriptor("disabled", { capabilityKinds: ["embedding"], enabled: false }),
      descriptor("declared", { capabilityKinds: ["embedding"], probeState: "declared" }),
    ]
    const candidates = deriveEmbeddingSelectorCandidates({ models })
    expect(candidates.map((c) => c.modelDescriptorIdText)).toEqual(["eligible"])
  })

  test("reranker selector excludes profile C (embedding-similarity) entirely (AC34)", () => {
    const models = [
      descriptor("reranker-eligible", { capabilityKinds: ["reranker"] }),
      descriptor("profile-c", { capabilityKinds: ["embedding-similarity"] }),
    ]
    const candidates = deriveRerankerSelectorCandidates({ models })
    expect(candidates.map((c) => c.modelDescriptorIdText)).toEqual(["reranker-eligible"])
    expect(isRerankerEligible(models[1]!)).toBe(false)
    expect(isEmbeddingEligible(models[0]!)).toBe(false)
  })
})

describe("projectSemanticSignal — total structured-result projection (Feature 012 T007, FR4, FR8)", () => {
  test("a semantic.model.list effective projects the descriptors (projected)", () => {
    const result = projectSemanticSignal({ descriptors: [descriptor("model_a"), descriptor("model_b")] })
    expect(result.outcome).toBe("projected")
    expect(result.signal.models.map((m) => m.id)).toEqual(["model_a", "model_b"])
  })

  test("a semantic.binding.status effective projects the pinned bindings and degradation", () => {
    const result = projectSemanticSignal({ embedding: binding("embedding"), reranker: binding("reranker"), degradation: { rung: "full_semantic" } })
    expect(result.outcome).toBe("projected")
    expect(result.signal.embeddingBinding?.slot).toBe("embedding")
    expect(result.signal.rerankerBinding?.slot).toBe("reranker")
    expect(result.signal.degradation?.rung).toBe("full_semantic")
  })

  test("a dual-read merge of model.list + binding.status projects models and pinned bindings", () => {
    const merged = mergeSemanticEffective(
      { descriptors: [descriptor("model_a")] },
      { embedding: binding("embedding"), reranker: binding("reranker"), degradation: { rung: "full_semantic" } },
    )
    const result = projectSemanticSignal(merged)
    expect(result.outcome).toBe("projected")
    expect(result.signal.models.map((m) => m.id)).toEqual(["model_a"])
    expect(result.signal.embeddingBinding?.slot).toBe("embedding")
    expect(result.signal.rerankerBinding?.slot).toBe("reranker")
    expect(deriveEmbeddingBindingView(result.signal)?.modelDescriptorIdText).toBe("model_1")
  })

  test("an absent effective degrades to the honest empty baseline (empty_fallback)", () => {
    for (const absent of [undefined, null]) {
      const result = projectSemanticSignal(absent)
      expect(result.outcome).toBe("empty_fallback")
      expect(result.signal).toBe(EMPTY_SEMANTIC_PANEL_SIGNAL)
    }
  })

  test("a malformed effective degrades to the honest empty baseline without throwing (shape_mismatch)", () => {
    for (const bad of [3, "semantic", [], {}, { descriptors: [{ id: 1 }] }, { descriptors: "x" }]) {
      const result = projectSemanticSignal(bad)
      expect(result.outcome).toBe("shape_mismatch")
      expect(result.signal).toBe(EMPTY_SEMANTIC_PANEL_SIGNAL)
    }
  })
})
