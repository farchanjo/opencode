import { describe, expect, test } from "bun:test"
import type { SemanticModelDescriptor } from "@opencode-ai/protocol/semantic/commands"
import { deriveModelBadgeRowView } from "./badges"

function descriptor(overrides: Partial<SemanticModelDescriptor> = {}): SemanticModelDescriptor {
  return {
    id: "model_1",
    providerProfileId: "provider_1",
    modelRef: "text-embedding-3",
    displayName: "Text Embedding 3",
    source: "manual",
    capabilityKinds: ["embedding", "multilingual"],
    endpointMode: "embeddings",
    dimensions: 1536,
    limits: { maxBatchSize: 64, maxInputTokens: 8192 },
    languageSupport: ["en", "pt-BR", "es"],
    probeState: "validated",
    enabled: true,
    ...overrides,
  }
}

describe("semantic-panel model badge projection (FR30, C16, AC34)", () => {
  test("derives text-first fields, never color-only", () => {
    const view = deriveModelBadgeRowView(descriptor())
    expect(view.modelDescriptorIdText).toBe("model_1")
    expect(view.displayNameText).toBe("Text Embedding 3")
    expect(view.capabilityBadgesText).toEqual(["embedding", "multilingual"])
    expect(view.dimensionsText).toBe("1536")
    expect(view.limitsText).toBe("batch<=64 tokens<=8192")
    expect(view.probeStateText).toBe("validated")
    expect(view.enabledText).toBe("enabled")
  })

  test("embedding-similarity (profile C) is its own distinct badge, never labeled reranker", () => {
    const view = deriveModelBadgeRowView(descriptor({ capabilityKinds: ["embedding-similarity"] }))
    expect(view.capabilityBadgesText).toEqual(["embedding-similarity"])
    expect(view.capabilityBadgesText).not.toContain("reranker")
  })

  test("absent dimensions/limits render an honest placeholder, not a fabricated value", () => {
    const view = deriveModelBadgeRowView(descriptor({ dimensions: undefined, limits: undefined }))
    expect(view.dimensionsText).toBe("-")
    expect(view.limitsText).toBe("-")
  })

  test("a disabled descriptor surfaces disabled textually", () => {
    const view = deriveModelBadgeRowView(descriptor({ enabled: false }))
    expect(view.enabledText).toBe("disabled")
  })
})
