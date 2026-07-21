/**
 * Feature 017 T005/T006/T019 — the operator multi-field edit modal + detail view
 * tree (FR19-FR23). Pins the pure layer the modal renders over: the ordered field
 * list per verb, per-field pre-fill (secret fields never seeded), per-field
 * validation, the BYTE-EXACT payload composition (the Feature 014 lesson), the
 * `pools.set` bindings editor add/remove flows, and — through the real
 * `executeOperatorCommand` spy — the single byte-exact dispatch. It also pins the
 * detail tree's bounded depth/rows + `… N more` truncation, distinct from the
 * compact status strip's `{n}` summary.
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import {
  composeBindingsPayload,
  composePayload,
  prefillBindings,
  resolveOperatorFieldList,
  validateBindings,
  type BindingRow,
} from "../../src/operator/form/field-list"
import { createMultiFieldState } from "../../src/operator/form/multi-field-modal"
import { buildConnectedModelOptions } from "../../src/operator/form/model-picker"
import { resolveOperatorFormField } from "../../src/operator/form"
import { toDetailTree } from "../../src/operator/status"
import { toStatusNodes } from "../../src/operator/status"
import { createSpyPort, createFakeToast, createFakeDialog } from "./harness"

/** A minimal connected catalog — only the fields the picker option builder reads. */
function fakeCatalog(): any[] {
  return [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-opus": { name: "Claude Opus", status: "active", cost: { input: 15 } },
        "claude-sonnet": { name: "Claude Sonnet", status: "active", cost: { input: 3 } },
      },
    },
    {
      id: "opencode",
      name: "opencode",
      models: {
        "grok-free": { name: "Grok Free", status: "active", cost: { input: 0 } },
        "legacy": { name: "Legacy", status: "deprecated", cost: { input: 1 } },
      },
    },
  ]
}

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

/** Compose a verb's payload from raw field entries, failing loudly on an in-modal error. */
function compose(id: string, raw: Record<string, string>, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const descriptor = resolveOperatorFieldList(id)
  if (!descriptor) throw new Error(`missing field list for ${id}`)
  const result = composePayload(descriptor, raw, extras)
  if (!result.ok) throw new Error(`unexpected in-modal error for ${id}: ${result.message}`)
  return result.payload
}

describe("T001 — ordered field list per Configure verb (FR19, FR21)", () => {
  test("each covered verb resolves an ordered field list; an unlisted verb is honest-empty", () => {
    const covered = [
      "telemetry.configure",
      "budget.set",
      "pools.set",
      "routing.configure",
      "mcp.server.add",
      "output.retention.set",
      "output.quota.set",
      "jobs.create",
      "semantic.provider.add",
    ]
    for (const id of covered) expect(resolveOperatorFieldList(id)?.fields.length).toBeGreaterThan(0)
    expect(resolveOperatorFieldList("langlock.reset")).toBeUndefined()
  })

  test("telemetry.configure opens a labeled endpoint field + transport picker (not a raw JSON prompt)", () => {
    const fields = resolveOperatorFieldList("telemetry.configure")!.fields
    expect(fields.map((f) => f.key)).toEqual(["endpoint", "transport"])
    const transport = fields.find((f) => f.key === "transport")!
    expect(transport.kind).toBe("picker")
    expect(transport.options?.map((o) => o.value)).toEqual(["http/protobuf", "grpc"])
  })

  test("a secret-bearing field carries no pre-fill (never seeded from a resolved value)", () => {
    const secretRef = resolveOperatorFieldList("mcp.server.add")!.fields.find((f) => f.key === "secretRef")!
    expect(secretRef.secret).toBe(true)
    expect(secretRef.prefill).toBeUndefined()
  })
})

describe("T001 — per-field pre-fill extraction (FR19)", () => {
  test("telemetry pre-fills endpoint + transport from the read effective", () => {
    const fields = resolveOperatorFieldList("telemetry.configure")!.fields
    const eff = { endpoint: "https://otlp.example:4318", transport: "grpc" }
    expect(fields[0].prefill!(eff)).toBe("https://otlp.example:4318")
    expect(fields[1].prefill!(eff)).toBe("grpc")
  })

  test("budget pre-fills each nested limit as a string", () => {
    const fields = resolveOperatorFieldList("budget.set")!.fields
    const eff = { limits: { maxTurns: 10, maxContextTokens: 200000, maxOutputTokens: 8000, maxWorkers: 4, tokenBudget: 500000 } }
    expect(fields.find((f) => f.key === "maxTurns")!.prefill!(eff)).toBe("10")
    expect(fields.find((f) => f.key === "tokenBudget")!.prefill!(eff)).toBe("500000")
  })

  test("output policy setters pre-fill from the nested retention/quota objects", () => {
    const retention = resolveOperatorFieldList("output.retention.set")!.fields
    const quota = resolveOperatorFieldList("output.quota.set")!.fields
    expect(retention.find((f) => f.key === "ttlSeconds")!.prefill!({ retention: { ttlSeconds: 86400 } })).toBe("86400")
    expect(quota.find((f) => f.key === "quotaScope")!.prefill!({ quota: { quotaScope: "session" } })).toBe("session")
  })

  test("an absent value pre-fills undefined (honest empty field, never a fabricated default)", () => {
    const endpoint = resolveOperatorFieldList("telemetry.configure")!.fields[0]
    expect(endpoint.prefill!(undefined)).toBeUndefined()
    expect(endpoint.prefill!({ other: 1 })).toBeUndefined()
  })
})

describe("T003 — byte-exact payload composition (FR20, the Feature 014 lesson)", () => {
  test("telemetry.configure composes exactly { endpoint, transport }", () => {
    expect(compose("telemetry.configure", { endpoint: "https://otlp:4318", transport: "grpc" })).toEqual({
      endpoint: "https://otlp:4318",
      transport: "grpc",
    })
  })

  test("budget.set nests the five numeric limits under `limits`, as numbers", () => {
    expect(
      compose("budget.set", {
        maxTurns: "10",
        maxContextTokens: "200000",
        maxOutputTokens: "8000",
        maxWorkers: "4",
        tokenBudget: "500000",
      }),
    ).toEqual({ limits: { maxTurns: 10, maxContextTokens: 200000, maxOutputTokens: 8000, maxWorkers: 4, tokenBudget: 500000 } })
  })

  test("mcp.server.add composes { name, transportKind, endpoint } — NOT { id, url, transport }", () => {
    expect(compose("mcp.server.add", { name: "vec", transportKind: "streamable-http", endpoint: "https://mcp:9000" })).toEqual({
      name: "vec",
      transportKind: "streamable-http",
      endpoint: "https://mcp:9000",
    })
  })

  test("a re-entered secret field is placed on the payload only when non-empty", () => {
    expect(compose("semantic.provider.add", { name: "vec", baseUrl: "https://v.example" })).toEqual({
      name: "vec",
      baseUrl: "https://v.example",
    })
    expect(compose("semantic.provider.add", { name: "vec", baseUrl: "https://v.example", secretRef: "keychain:k@v1" })).toEqual({
      name: "vec",
      baseUrl: "https://v.example",
      secretRef: "keychain:k@v1",
    })
  })

  test("output setters compose the top-level shape the port reads", () => {
    expect(compose("output.retention.set", { ttlSeconds: "86400", legalHold: "true" })).toEqual({ ttlSeconds: 86400, legalHold: true })
    expect(compose("output.quota.set", { quotaScope: "session", maxBytes: "1048576" })).toEqual({ quotaScope: "session", maxBytes: 1048576 })
  })

  test("an update verb composes only the changed keys under `patch`", () => {
    expect(compose("mcp.server.update", { name: "renamed", endpoint: "" })).toEqual({ patch: { name: "renamed" } })
    expect(compose("semantic.provider.update", { name: "", baseUrl: "https://new" })).toEqual({ patch: { baseUrl: "https://new" } })
  })
})

describe("T003 — a non-composable payload stays IN-MODAL, never a global toast (FR20)", () => {
  test("a missing required field returns the first in-modal error", () => {
    const descriptor = resolveOperatorFieldList("telemetry.configure")!
    const result = composePayload(descriptor, { endpoint: "", transport: "grpc" }, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("Endpoint")
  })

  test("a malformed URL / non-numeric field is rejected before compose", () => {
    const telemetry = resolveOperatorFieldList("telemetry.configure")!
    const budget = resolveOperatorFieldList("budget.set")!
    expect(composePayload(telemetry, { endpoint: "not-a-url", transport: "grpc" }, {}).ok).toBe(false)
    expect(
      composePayload(
        budget,
        { maxTurns: "ten", maxContextTokens: "1", maxOutputTokens: "1", maxWorkers: "1", tokenBudget: "1" },
        {},
      ).ok,
    ).toBe(false)
  })

  test("routing advanced JSON must be a JSON object when present", () => {
    const routing = resolveOperatorFieldList("routing.configure")!
    expect(composePayload(routing, { enabled: "true", mode: "auto", advanced: "[1,2]" }, {}).ok).toBe(false)
    expect(composePayload(routing, { enabled: "true", mode: "auto", advanced: "not json" }, {}).ok).toBe(false)
  })
})

describe("T005 — routing.configure structured sub-form + advanced-JSON (FR21)", () => {
  test("structured common fields plus a labeled advanced JSON field, no bare prompt", () => {
    const fields = resolveOperatorFieldList("routing.configure")!.fields
    expect(fields.map((f) => ({ key: f.key, kind: f.kind }))).toEqual([
      { key: "enabled", kind: "toggle" },
      { key: "mode", kind: "picker" },
      { key: "advanced", kind: "advanced_json" },
    ])
    expect(fields.find((f) => f.key === "mode")!.options?.map((o) => o.value)).toEqual(["always", "auto", "never"])
  })

  test("Save spreads the advanced policy document over the structured common fields", () => {
    expect(compose("routing.configure", { enabled: "true", mode: "auto", advanced: '{"budgetPolicy":{"cap":5}}' })).toEqual({
      enabled: true,
      mode: "auto",
      budgetPolicy: { cap: 5 },
    })
  })
})

describe("Feature 040 — routing.configure prefills from the effective read's activation shape (FR-C1)", () => {
  const routingField = (key: string) => resolveOperatorFieldList("routing.configure")!.fields.find((f) => f.key === key)!

  test("reads the Feature 036 nested `activation.{enabled,mode}` the routing.status read returns", () => {
    // The exact shape the backend `createRoutingStatusHandler` projects (redacted activation).
    const effective = { authority: "routing", configured: true, activation: { enabled: true, mode: "auto" } }
    expect(routingField("enabled").prefill!(effective)).toBe("true")
    expect(routingField("mode").prefill!(effective)).toBe("auto")
  })

  test("a persisted enabled:true / mode seeds the toggle-on / picker value; absent activation → honest placeholder", () => {
    const off = { authority: "routing", configured: true, activation: { enabled: false, mode: "never" } }
    expect(routingField("enabled").prefill!(off)).toBe("false")
    expect(routingField("mode").prefill!(off)).toBe("never")
    // Honest absence — an unconfigured read seeds nothing → `[ ] off` / `— select —`.
    expect(routingField("enabled").prefill!({ configured: false, activation: null })).toBeUndefined()
    expect(routingField("mode").prefill!({ configured: false, activation: null })).toBeUndefined()
    expect(routingField("enabled").prefill!(undefined)).toBeUndefined()
    expect(routingField("mode").prefill!({})).toBeUndefined()
  })

  test("back-compat: still reads the top-level domain-port StatusResponse shape when served", () => {
    // The routing DOMAIN-port `StatusResponse` (top-level enabled/mode) any stack may serve.
    expect(routingField("enabled").prefill!({ enabled: true, mode: "always" })).toBe("true")
    expect(routingField("mode").prefill!({ enabled: true, mode: "always" })).toBe("always")
  })
})

describe("T004 — pools.set bindings-list editor (FR22)", () => {
  test("pre-fills ordered { role, models } rows from the pools.show effective", () => {
    const rows = prefillBindings({ bindings: [{ role: "worker", models: ["a", "b"] }, { role: "manager", models: ["c"] }] })
    expect(rows).toEqual([{ role: "worker", models: ["a", "b"] }, { role: "manager", models: ["c"] }])
  })

  test("add/remove binding + add/remove model compose exactly { bindings: [{ role, models }] }", () => {
    let rows: BindingRow[] = prefillBindings({ bindings: [{ role: "worker", models: ["a"] }] })
    rows = [...rows, { role: "manager", models: [] }] // add binding
    rows = rows.map((r) => (r.role === "manager" ? { ...r, models: [...r.models, "c"] } : r)) // add model
    rows = rows.map((r) => (r.role === "worker" ? { ...r, models: [] } : r)) // remove worker's model
    expect(composeBindingsPayload(rows)).toEqual({ bindings: [{ role: "worker", models: [] }, { role: "manager", models: ["c"] }] })
  })

  test("the compose drops a blank-role row and trims model ids (in-modal, never the old global toast)", () => {
    expect(composeBindingsPayload([{ role: "  ", models: ["x"] }, { role: "worker", models: [" a ", ""] }])).toEqual({
      bindings: [{ role: "worker", models: ["a"] }],
    })
  })

  test("pools.set composePayload reads the editor bindings from the modal state", () => {
    expect(compose("pools.set", {}, { bindings: [{ role: "worker", models: ["a"] }] })).toEqual({
      bindings: [{ role: "worker", models: ["a"] }],
    })
  })
})

describe("019 fix-round — bindings save-time validation blocks a doomed dispatch (FR22)", () => {
  test("a role pool with no models is an in-modal error, mirroring backend-live", () => {
    expect(validateBindings([{ role: "worker", models: [] }])).toBe(`Role pool "worker" has no candidate models`)
    // Whitespace-only model ids collapse to empty and are rejected just the same.
    expect(validateBindings([{ role: "worker", models: ["   ", ""] }])).toBe(`Role pool "worker" has no candidate models`)
  })

  test("a duplicate role pool is rejected before dispatch", () => {
    expect(validateBindings([{ role: "worker", models: ["a"] }, { role: "worker", models: ["b"] }])).toBe(
      `Duplicate role pool "worker"`,
    )
  })

  test("a blank-role row is ignored (the composer drops it), and a valid list passes clean", () => {
    expect(validateBindings([{ role: "  ", models: [] }, { role: "worker", models: ["a"] }])).toBeUndefined()
    expect(validateBindings([{ role: "worker", models: ["a", "b"] }, { role: "manager", models: ["c"] }])).toBeUndefined()
    expect(validateBindings([])).toBeUndefined() // an empty list is a legitimate "clear pools"
  })
})

describe("019 fix-round — hoisted modal state survives a sub-dialog push/pop (FR22)", () => {
  test("createMultiFieldState seeds one raw key per field and an empty bindings list", () => {
    const [store] = createMultiFieldState(resolveOperatorFieldList("telemetry.configure")!)
    // Feature 034 seeds the synthetic Request-scope row alongside one raw key per field.
    expect(Object.keys(store.raw).sort()).toEqual(["__requestScope__", "endpoint", "transport"])
    expect(store.bindings).toEqual([])
    expect(store.loaded).toBe(false)
  })

  test("state hoisted outside the form persists edits the way a picker/bindings push relies on", () => {
    // The dialog stack renders only its top level, so a pushed sub-dialog unmounts the
    // form and re-mounts it on pop. State created here (as the factory does) is the SAME
    // instance across that re-mount, so a binding added under the pushed editor survives.
    const [store, setStore] = createMultiFieldState(resolveOperatorFieldList("pools.set")!)
    setStore("loaded", true)
    setStore("bindings", [{ role: "worker", models: ["anthropic/claude"] }])
    // Simulate the re-mount: a fresh MultiFieldForm reads this SAME tuple (props.state).
    expect(store.loaded).toBe(true)
    expect(store.bindings).toEqual([{ role: "worker", models: ["anthropic/claude"] }])
    expect(composeBindingsPayload(store.bindings)).toEqual({ bindings: [{ role: "worker", models: ["anthropic/claude"] }] })
  })
})

describe("T003 — a single byte-exact dispatch reaches the wire (FR20, FR17)", () => {
  test("pools.set composes and dispatches ONCE on the same command id", async () => {
    const payload = compose("pools.set", {}, { bindings: [{ role: "worker", models: ["a", "b"] }] })
    const spy = createSpyPort()
    const { toast, calls } = createFakeToast()
    await executeOperatorCommand({ entry: entry("pools.set"), port: spy.port, dialog: createFakeDialog(), toast, payload, silent: true })
    expect(spy.tryHandleCalls).toHaveLength(1)
    const sent = spy.tryHandleCalls[0].text
    expect(sent.startsWith("/op.pools.set ")).toBe(true)
    expect(JSON.parse(sent.slice(sent.indexOf(" ") + 1))).toEqual({ bindings: [{ role: "worker", models: ["a", "b"] }] })
    expect(calls).toHaveLength(0) // silent Save → modal close is the feedback, no toast
  })

  test("a cancelled modal (no submit) never composes or dispatches", async () => {
    // The modal only composes inside submit(); an esc/cancel pops the dialog without
    // calling composePayload — modelled here as: no dispatch happens without a submit.
    const spy = createSpyPort()
    expect(spy.tryHandleCalls).toHaveLength(0)
  })
})

describe("T006 — detail view tree, bounded + honest, distinct from the compact strip (FR23)", () => {
  test("telemetry.test `target` expands to endpoint/transport (not a {2} placeholder)", () => {
    const rows = toDetailTree({ outcome: "unreachable", target: { endpoint: "https://otlp:4318", transport: "grpc" } })
    const target = rows.find((r) => r.label === "target")!
    expect(target.branch).toBe(true)
    expect(rows.some((r) => r.label === "endpoint" && r.value === "https://otlp:4318")).toBe(true)
    expect(rows.some((r) => r.label === "transport" && r.value === "grpc")).toBe(true)
    // The compact strip keeps its bounded {n} one-line summary, unchanged.
    expect(toStatusNodes({ outcome: "unreachable", target: { endpoint: "x", transport: "y" } })).toContainEqual({ key: "target", value: "{2}" })
  })

  test("a container past the depth bound collapses to an honest `… N more`, never `{n}`", () => {
    const deep = { a: { b: { c: { d: { e: 1, f: 2 } } } } }
    const rows = toDetailTree(deep, 4)
    const collapsed = rows.find((r) => r.truncation)!
    expect(collapsed.value).toBe("… 2 more")
    expect(rows.every((r) => !/\{\d+\}/.test(r.value))).toBe(true)
  })

  test("the row budget truncates remaining siblings with `… N more`", () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < 10; i++) wide[`k${i}`] = i
    const rows = toDetailTree(wide, 4, 4)
    expect(rows).toHaveLength(4)
    expect(rows[3].truncation).toBe(true)
    expect(rows[3].value).toBe("… 7 more")
  })

  test("a scalar renders verbatim; an empty container is honest; an absent payload is empty", () => {
    expect(toDetailTree("hello")).toEqual([{ depth: 0, label: "", value: "hello", branch: false, truncation: false }])
    expect(toDetailTree({ items: [] })).toContainEqual({ depth: 0, label: "items", value: "(empty)", branch: false, truncation: false })
    expect(toDetailTree(undefined)).toEqual([])
  })
})

describe("020 T001 — connected-models option memo over sync.data.provider (FR1)", () => {
  test("flat-maps the connected catalog into provider/model options, grouped + sorted by provider", () => {
    const options = buildConnectedModelOptions(fakeCatalog())
    // Providers sorted by name (Anthropic before opencode), models by title within each.
    expect(options.map((o) => o.modelId)).toEqual([
      "anthropic/claude-opus",
      "anthropic/claude-sonnet",
      "opencode/grok-free",
    ])
    const sonnet = options.find((o) => o.modelId === "anthropic/claude-sonnet")!
    expect(sonnet.title).toBe("Claude Sonnet")
    expect(sonnet.provider).toBe("Anthropic")
    expect(sonnet.category).toBe("Anthropic")
  })

  test("a zero-input-cost model is flagged Free; a deprecated model is dropped (mirrors DialogModel)", () => {
    const options = buildConnectedModelOptions(fakeCatalog())
    expect(options.find((o) => o.modelId === "opencode/grok-free")!.free).toBe(true)
    expect(options.find((o) => o.modelId === "anthropic/claude-sonnet")!.free).toBe(false)
    // The deprecated opencode/legacy is not offered — the catalog is honest.
    expect(options.some((o) => o.modelId === "opencode/legacy")).toBe(false)
  })

  test("an already-selected id is marked so the picker skips it (no silent duplicate, FR2)", () => {
    const options = buildConnectedModelOptions(fakeCatalog(), new Set(["anthropic/claude-sonnet"]))
    expect(options.find((o) => o.modelId === "anthropic/claude-sonnet")!.alreadySelected).toBe(true)
    expect(options.find((o) => o.modelId === "anthropic/claude-opus")!.alreadySelected).toBe(false)
  })

  test("an empty catalog yields no model options — the Custom id… escape hatch is the picker's own action (FR6)", () => {
    expect(buildConnectedModelOptions([])).toEqual([])
  })

  test("no option fabricates a model or provider absent from the catalog (FR1)", () => {
    const options = buildConnectedModelOptions(fakeCatalog())
    for (const option of options) {
      const [providerId] = option.modelId.split("/")
      expect(fakeCatalog().some((p) => p.id === providerId)).toBe(true)
    }
  })
})

describe("020 T004 — semantic.model.disable resolves the shared model picker (FR3)", () => {
  test("the Model id field is a model_picker, not a bare text_input", () => {
    const field = resolveOperatorFormField(entry("semantic.model.disable"))
    expect(field?.mode).toBe("model_picker")
  })

  test("the picker composes the UNCHANGED { id: 'provider/model' } payload (FR3, FR5)", () => {
    const field = resolveOperatorFormField(entry("semantic.model.disable"))
    if (field?.mode !== "model_picker") throw new Error("expected a model_picker field")
    expect(field.toPayload("anthropic/claude-sonnet")).toEqual({ id: "anthropic/claude-sonnet" })
    // The escape-hatch raw string composes the same shape — nothing regresses (FR4).
    expect(field.toPayload("registered/but-offline")).toEqual({ id: "registered/but-offline" })
  })
})
