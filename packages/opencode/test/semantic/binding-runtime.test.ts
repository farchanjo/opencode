/**
 * Feature 050 / T023 (FR4) — the runtime binding-join helper.
 *
 * Asserts the join resolves `{baseUrl, modelRef, secretRef, compatibilityMode,
 * bindingVersion}` from the normalized registry document, prefers the live
 * binding over the staged candidate, falls back to `modelRef ?? id` and
 * `secretRef ?? ""`, and returns `undefined` on a broken model/provider join.
 */
import { describe, expect, test } from "bun:test"
import { BindingRuntime } from "@/semantic/binding-runtime"
import type { RegistryDocumentView } from "@/semantic/binding-runtime"

const baseDoc: RegistryDocumentView = {
  providers: [{ id: "p1", baseUrl: "https://emb.local", secretRef: "keychain:emb@v1" }],
  models: [{ id: "m1", providerProfileId: "p1", modelRef: "qwen3-embedding-4b" }],
  embedding: { modelDescriptorId: "m1", compatibilityMode: "embedding", version: 3 },
  reranker: null,
}

describe("resolveActiveBinding", () => {
  test("joins the active embedding binding to its provider + model", () => {
    const binding = BindingRuntime.resolveActiveBinding(baseDoc, "embedding")
    expect(binding).toEqual({
      baseUrl: "https://emb.local",
      modelRef: "qwen3-embedding-4b",
      secretRef: "keychain:emb@v1",
      compatibilityMode: "embedding",
      bindingVersion: 3,
    })
  })

  test("falls back to modelRef ?? id and secretRef ?? empty", () => {
    const doc: RegistryDocumentView = {
      providers: [{ id: "p1", baseUrl: "https://emb.local", secretRef: null }],
      models: [{ id: "m1", providerProfileId: "p1" }],
      embedding: { modelDescriptorId: "m1", compatibilityMode: "embedding", version: 1 },
      reranker: null,
    }
    const binding = BindingRuntime.resolveActiveBinding(doc, "embedding")
    expect(binding?.modelRef).toBe("m1")
    expect(binding?.secretRef).toBe("")
  })

  test("prefers the live binding over the staged candidate", () => {
    const doc: RegistryDocumentView = {
      ...baseDoc,
      embedding: { modelDescriptorId: "m1", compatibilityMode: "embedding", version: 5 },
      embeddingStaged: { modelDescriptorId: "m1", compatibilityMode: "embedding", version: 9 },
    }
    expect(BindingRuntime.resolveActiveBinding(doc, "embedding")?.bindingVersion).toBe(5)
  })

  test("resolves the staged candidate when no live binding exists", () => {
    const doc: RegistryDocumentView = {
      ...baseDoc,
      embedding: null,
      embeddingStaged: { modelDescriptorId: "m1", compatibilityMode: "embedding", version: 9 },
    }
    expect(BindingRuntime.resolveActiveBinding(doc, "embedding")?.bindingVersion).toBe(9)
  })

  test("returns undefined for an empty slot", () => {
    expect(BindingRuntime.resolveActiveBinding(baseDoc, "reranker")).toBeUndefined()
  })

  test("returns undefined when the provider join is broken", () => {
    const doc: RegistryDocumentView = {
      providers: [],
      models: [{ id: "m1", providerProfileId: "missing", modelRef: "x" }],
      embedding: { modelDescriptorId: "m1", compatibilityMode: "embedding", version: 1 },
      reranker: null,
    }
    expect(BindingRuntime.resolveActiveBinding(doc, "embedding")).toBeUndefined()
  })

  test("returns undefined when the model join is broken", () => {
    const doc: RegistryDocumentView = {
      providers: [{ id: "p1", baseUrl: "https://emb.local", secretRef: null }],
      models: [],
      embedding: { modelDescriptorId: "missing", compatibilityMode: "embedding", version: 1 },
      reranker: null,
    }
    expect(BindingRuntime.resolveActiveBinding(doc, "embedding")).toBeUndefined()
  })
})
