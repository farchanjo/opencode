/**
 * Feature 026 / T003, T005 — the FLAT model-descriptor render + reranker eligibility.
 *
 * The operator `Semantic` panel showed "no model descriptors" because the config-backed
 * registry projected a NESTED `{ identity, capability, validation }` descriptor that the
 * `isModelDescriptor` guard (which requires a FLAT `{ displayName, capabilityKinds,
 * probeState, enabled }`) rejected as `shape_mismatch`. This drives the EXACT flat shape the
 * fixed `registry-backend.ts` `toDescriptor` now emits (from `semantic.model.list`) through
 * `projectSemanticSignal` and asserts: the payload projects (never `shape_mismatch`), the
 * descriptor renders in the badge row list, a reranker-capable VALIDATED model is an eligible
 * selector candidate, and a still-`declared` model is not.
 */
import { describe, expect, test } from "bun:test"
import { projectSemanticSignal } from "../../../src/operator/semantic/state"
import { SemanticPanelState } from "../../../src/operator/semantic/state"

/** The flat protocol shape `registry-backend.ts` `toDescriptor` emits (Feature 026 FR3). */
const flatDescriptor = (over: { id: string; probeState: string; kinds?: readonly string[] }) => ({
  id: over.id,
  providerProfileId: "prov_1",
  modelRef: "rerank-model-a",
  displayName: `display-${over.id}`,
  source: "manual",
  capabilityKinds: over.kinds ?? ["reranker"],
  endpointMode: "rerank",
  languageSupport: [],
  probeState: over.probeState,
  enabled: true,
})

describe("T003 — the flat descriptor projects and renders (no shape_mismatch, FR3)", () => {
  test("a semantic.model.list effective with flat descriptors projects (never shape_mismatch)", () => {
    const projection = projectSemanticSignal({
      descriptors: [flatDescriptor({ id: "m_a", probeState: "validated" }), flatDescriptor({ id: "m_b", probeState: "declared" })],
    })
    expect(projection.outcome).toBe("projected")
    expect(projection.signal.models).toHaveLength(2)
  })

  test("the nested legacy shape STILL fails the guard (regression anchor — this is what was broken)", () => {
    const nested = { descriptors: [{ id: "m_a", identity: { display_name: "x" }, capability: { kinds: ["reranker"] }, validation: { status: "validated" }, enabled: true }] }
    expect(projectSemanticSignal(nested).outcome).toBe("shape_mismatch")
  })

  test("the projected descriptors render as bounded badge rows", () => {
    const projection = projectSemanticSignal({ descriptors: [flatDescriptor({ id: "m_a", probeState: "validated" })] })
    const rows = SemanticPanelState.deriveVisibleModelBadges(projection.signal)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.displayNameText).toBe("display-m_a")
    expect(rows[0]!.capabilityBadgesText).toContain("reranker")
    expect(rows[0]!.probeStateText).toBe("validated")
  })
})

describe("T005 — a validated reranker model is an eligible selector candidate (FR4)", () => {
  test("only enabled + validated + reranker-capable descriptors are eligible candidates", () => {
    const projection = projectSemanticSignal({
      descriptors: [
        flatDescriptor({ id: "m_validated", probeState: "validated" }),
        flatDescriptor({ id: "m_declared", probeState: "declared" }),
        flatDescriptor({ id: "m_embedding", probeState: "validated", kinds: ["embedding"] }),
      ],
    })
    const candidates = SemanticPanelState.deriveRerankerSelectorCandidates(projection.signal)
    expect(candidates.map((c) => c.modelDescriptorIdText)).toEqual(["m_validated"])
  })

  test("isRerankerEligible is true for the validated reranker model, false for the declared one", () => {
    expect(SemanticPanelState.isRerankerEligible(flatDescriptor({ id: "m_a", probeState: "validated" }) as never)).toBe(true)
    expect(SemanticPanelState.isRerankerEligible(flatDescriptor({ id: "m_a", probeState: "declared" }) as never)).toBe(false)
  })
})
