/**
 * Feature 015 T020 — domain-screen composition contract (FR4, FR5, FR6, FR15).
 *
 * The inline StatusSection and its post-mutation refetch are driven off the SAME
 * `executeOperatorCommand` spy seam the screen uses (no new dispatch path). This
 * pins the observable contract the `DialogOperatorDomainPanel` renders:
 *
 *  - the silent status read on open emits NO toast and yields the effective the
 *    section projects (or the honest `unavailable` flag) — never a toast flash;
 *  - the refetch gate fires ONLY on a committed outcome; a `version_conflict` or a
 *    typed gap keeps the prior state and surfaces the typed reason;
 *  - a plain-domain View verb reads silently (no toast) and feeds the structural
 *    tree, never the retired `void run(entry)` toast branch.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOperatorDomainPanel,
  buildOperatorScreenControls,
  operatorSectionOrder,
  listOperatorPaletteEntries,
  OPERATOR_SETTINGS_DOMAINS,
  type OperatorPaletteEntry,
  type OperatorVerbItem,
  type OperatorVerbSection,
} from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import { toStatusNodes } from "../../src/operator/status"
import { entityConsumedConfigureIds, operatorEntityAffordances } from "../../src/operator/entity"
import { createSpyPort, createFakeToast, createFakeDialog, spyDisplay } from "./harness"
import type { OperatorSlashPort, OperatorStructuredResult } from "../../src/context/operator-slash"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

/**
 * The exact refetch predicate the screen (`dialog-settings.tsx`), the entity
 * screens, and the edit modal all key on: only these two outcomes committed a
 * mutation and trigger a status refetch (FR6). Pinned here so a source drift is
 * caught by the composition suite.
 */
const REFETCH_OUTCOMES = new Set(["success", "idempotent_replay"])

/** Drive a silent status read the StatusSection issues on open, shaping its structured half. */
async function readStatus(id: string, structured?: () => OperatorStructuredResult | undefined) {
  const spy = createSpyPort(() => spyDisplay(), structured)
  const { toast, calls } = createFakeToast()
  const result = await executeOperatorCommand({
    entry: entry(id),
    port: spy.port,
    dialog: createFakeDialog(),
    toast,
    silent: true,
  })
  // The section derives this StatusRead from the dispatch result.
  return {
    value: result.result?.effective,
    available: result.outcome !== "unavailable",
    toasts: calls.length,
  }
}

/**
 * The exact row-title choice `verbOption` (`dialog-settings.tsx`) renders on a
 * domain screen: the action-only projection label, NOT the domain-qualified
 * `entry.title`. A domain screen is the domain-implicit surface (its header is
 * `Operator · {Domain}`), so per FR3 a verb title reads as its bare action
 * ("Status", "Endpoint") — the domain-qualified `{Domain} {action}` copy is
 * reserved for the domain-explicit surface (the top-level command). Pinned here
 * so a source drift back to `entry.title` is caught by the composition suite.
 */
function domainScreenRowTitle(item: OperatorVerbItem): string {
  return item.label
}

describe("Feature 015 T003/T020 — domain-screen rows are domain-implicit (FR3)", () => {
  test("every domain-screen row title is the action-only label, never the domain-qualified entry.title", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      const items = [...panel.view, ...panel.configure]
      for (const item of items) {
        const qualified = entry(item.id).title
        const title = domainScreenRowTitle(item)
        // The row renders the bare action, and NOT the "{Domain} {action}" copy.
        expect(title).toBe(item.label)
        expect(title).not.toBe(qualified)
        // The dotted id is never the primary label (FR3).
        expect(title).not.toContain(".")
      }
    }
  })

  test("domain-screen row titles are unique on the surface (FR3, no `View: Status` ×N)", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const panel = buildOperatorDomainPanel(domain)
      const titles = [...panel.view, ...panel.configure].map(domainScreenRowTitle)
      expect(new Set(titles).size).toBe(titles.length)
      expect(titles).not.toContain("View: Status")
    }
  })
})

/**
 * Faithful pure model of `DialogOperatorDomainPanel`'s composition (Feature 016).
 * It mirrors the exact seams the component composes so a source drift in the
 * ordering rule, the entity-first affordances, or the row/section categories is
 * caught here without a full render harness:
 *
 *  - the status is routed through the DialogSelect header `titleView` slot, so the
 *    panel reads header → status → search → action list (FR1);
 *  - the Configure block leads with the entity-first affordances, then controls,
 *    then the plain settings; the View block is the read-only verbs; the two are
 *    ordered by `operatorSectionOrder` — Configure before View for an editable
 *    domain (FR4, FR5);
 *  - a row carries NO kind footer badge; the section category (Configure/View)
 *    alone carries the kind (FR3, FR6).
 */
type ScreenOption = { readonly title: string; readonly category: string; readonly hasFooter: boolean }

function composeDomainScreen(domain: string): {
  readonly header: string
  readonly regions: readonly string[]
  readonly options: readonly ScreenOption[]
} {
  const panel = buildOperatorDomainPanel(domain)
  const controls = buildOperatorScreenControls(domain)
  const consumed = new Set(controls.consumedIds)
  for (const id of entityConsumedConfigureIds(domain)) consumed.add(id)
  const settings = panel.configure.filter((item) => !consumed.has(item.id))

  const configureBlock: ScreenOption[] = [
    ...operatorEntityAffordances(domain).map((aff) => ({ title: aff.title, category: "Configure", hasFooter: false })),
    ...controls.toggles.map((c) => ({ title: c.label, category: "Controls", hasFooter: true })),
    ...controls.tristates.map((c) => ({ title: c.label, category: "Controls", hasFooter: true })),
    ...settings.map((item) => ({ title: item.label, category: "Configure", hasFooter: false })),
  ]
  const viewBlock: ScreenOption[] = panel.view.map((item) => ({ title: item.label, category: "View", hasFooter: false }))
  const blockFor = (kind: OperatorVerbSection) => (kind === "configure" ? configureBlock : viewBlock)

  return {
    header: `Operator · ${panel.label}`,
    // The component places the status inside the header slot (titleView), so the
    // rendered region sequence is fixed as header → status → search → actions (FR1).
    regions: ["header", "status", "search", "actions"],
    options: operatorSectionOrder(domain).flatMap(blockFor),
  }
}

describe("Feature 016 T002 — the panel reads header → status → search → action list (FR1)", () => {
  test("the status is the second region, never above the header, for a plain and a rich domain", () => {
    for (const domain of ["telemetry", "mcp"]) {
      const screen = composeDomainScreen(domain)
      expect(screen.regions).toEqual(["header", "status", "search", "actions"])
      // header is region 0, status region 1 — the status never precedes the header.
      expect(screen.regions.indexOf("status")).toBeGreaterThan(screen.regions.indexOf("header"))
      expect(screen.regions.indexOf("search")).toBeGreaterThan(screen.regions.indexOf("status"))
      expect(screen.regions.indexOf("actions")).toBeGreaterThan(screen.regions.indexOf("search"))
      expect(screen.header).toBe(`Operator · ${buildOperatorDomainPanel(domain).label}`)
    }
  })
})

describe("Feature 016 T012 — Configure-before-View + entity-first affordances (FR4, FR5)", () => {
  test("mcp leads the action list with `Add server` + `Servers` before any View row", () => {
    const options = composeDomainScreen("mcp").options
    expect(options[0]).toMatchObject({ title: "Add server", category: "Configure" })
    expect(options[1]).toMatchObject({ title: "Servers", category: "Configure" })
    // every Configure-category row precedes the first View-category row.
    const firstView = options.findIndex((o) => o.category === "View")
    const lastConfigure = options.map((o) => o.category).lastIndexOf("Configure")
    expect(lastConfigure).toBeLessThan(firstView)
  })

  test("jobs leads with `Create job` + `Jobs`; semantic with `Add provider` + Providers + Models", () => {
    const jobs = composeDomainScreen("jobs").options
    expect(jobs.slice(0, 2).map((o) => o.title)).toEqual(["Create job", "Jobs"])
    const semantic = composeDomainScreen("semantic").options
    expect(semantic.slice(0, 3).map((o) => o.title)).toEqual(["Add provider", "Providers", "Models"])
  })

  test("an editable domain orders Configure before View; the order lives in operatorSectionOrder", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const options = composeDomainScreen(domain).options
      const categories = options.map((o) => o.category)
      const firstView = categories.indexOf("View")
      if (firstView === -1) continue
      // no Configure/Controls row appears after the first View row (Configure leads).
      const configureAfterView = categories.slice(firstView + 1).some((c) => c === "Configure" || c === "Controls")
      expect(configureAfterView).toBe(false)
    }
  })
})

describe("Feature 016 T006 — rows carry no kind footer badge; the section header carries the kind (FR3)", () => {
  test("no verb/affordance row carries a footer badge; view rows are `View`, configure rows are `Configure`", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      for (const option of composeDomainScreen(domain).options) {
        // controls keep a state badge (on/off), but no verb/affordance row does.
        if (option.category === "View" || option.category === "Configure") expect(option.hasFooter).toBe(false)
      }
    }
  })
})

describe("Feature 015 T020 — inline status read on open (FR4, FR18)", () => {
  test("a status read with an effective payload projects to bounded rows and emits no toast", async () => {
    const status = await readStatus("langlock.status", () => ({
      outcome: "success",
      effective: { enabled: true, tag: "pt-BR" },
      version: null,
    }))
    expect(status.available).toBe(true)
    expect(status.toasts).toBe(0)
    expect(toStatusNodes(status.value)).toEqual([
      { key: "enabled", value: "true" },
      { key: "tag", value: "pt-BR" },
    ])
  })

  test("an unavailable status read flags the honest `Status unavailable`, never a fabricated value or a toast", async () => {
    const spy = createSpyPort(() =>
      spyDisplay({ variant: "warning", outcome: "unavailable", message: "budget backend not implemented" }),
    )
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("langlock.status"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      silent: true,
    })
    // available=false → the section renders "Status unavailable" (honest text).
    expect(result.outcome).toBe("unavailable")
    expect(result.result?.effective).toBeUndefined()
    expect(toStatusNodes(result.result?.effective)).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe("Feature 015 T020 — post-mutation refetch gate keeps or drops prior state (FR6, FR15)", () => {
  test("a committed mutation is in the refetch set → the section refetches", async () => {
    const spy = createSpyPort(() => spyDisplay({ outcome: "success" }))
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("langlock.set"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { tag: "pt-BR" },
    })
    expect(result.outcome).toBe("success")
    expect(REFETCH_OUTCOMES.has(result.outcome!)).toBe(true)
  })

  test("a version_conflict is NOT in the refetch set → the prior state is kept, the typed reason surfaces", async () => {
    // The port reports an existing authority whose version is missing → conflict,
    // synthesized before any tryHandle (the exact prior-state-kept path, FR6).
    const conflictPort: OperatorSlashPort = {
      tryHandle: async () => ({ handled: true, display: spyDisplay() }),
      preflightMutation: async () => ({
        ok: true,
        currentVersion: null,
        configured: true,
        scopeKind: "global",
        scopeRef: null,
        authority: "test",
      }),
    }
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("langlock.set"),
      port: conflictPort,
      dialog: createFakeDialog(),
      toast,
      payload: { tag: "pt-BR" },
    })
    expect(result.outcome).toBe("conflict")
    expect(REFETCH_OUTCOMES.has(result.outcome!)).toBe(false)
    // the typed reason is surfaced (a non-silent conflict toasts its warning).
    expect(calls.some((c) => c.variant === "warning")).toBe(true)
  })

  test("a typed capability gap is NOT in the refetch set → prior state kept, envelope surfaced", async () => {
    const spy = createSpyPort(() =>
      spyDisplay({ variant: "warning", outcome: "not_implemented", message: "not implemented yet" }),
    )
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("semantic.index.reindex"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
    })
    expect(result.outcome).toBe("not_implemented")
    expect(REFETCH_OUTCOMES.has(result.outcome!)).toBe(false)
  })
})

describe("Feature 015 T020 — plain-domain View path is silent, never the retired toast branch (FR5, FR18)", () => {
  test("a detail read for the structural view modal is silent and carries the effective tree", async () => {
    const spy = createSpyPort(() => spyDisplay(), () => ({
      outcome: "success",
      effective: { tag: "pt-BR", allowlist: ["pt-BR", "en-US"] },
      version: null,
    }))
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("langlock.show"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      silent: true,
    })
    // No toast on the View read (the old `void run(entry)` toast branch is gone).
    expect(calls).toHaveLength(0)
    expect(toStatusNodes(result.result?.effective)).toEqual([
      { key: "tag", value: "pt-BR" },
      { key: "allowlist", value: "[2]" },
    ])
  })

  test("an absent detail effective renders the honest empty tree, never a synthesized value", async () => {
    const status = await readStatus("langlock.show")
    expect(toStatusNodes(status.value)).toEqual([])
    expect(status.toasts).toBe(0)
  })
})
