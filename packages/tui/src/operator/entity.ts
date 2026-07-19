/**
 * Pure entity-CRUD classification for the Feature 015 collection domains (FR12,
 * FR13, FR14). Total and side-effect free: it maps a collection domain (jobs,
 * semantic providers/models, mcp servers) to its list-read id, its create id, and
 * the per-entity actions each row drills into, and it projects a list read's
 * already-redacted `effective` payload into bounded entity rows. Every action
 * carries the SAME canonical command id and the Feature 014 per-verb availability
 * as slash/CLI (FR15, FR17); a typed capability gap (jobs.run-now, a secret-gated
 * rotate, an honest-unavailable mcp mutation) resolves to `unavailable` so the row
 * renders marked + inert, never a fabricated success. No I/O, no solid-js —
 * mirrors `doc/arch/schemas/operator-crud-screens/entity-crud.cue` and the
 * per-domain projection modules (./status.ts, ./controls.ts).
 */
import { listOperatorPaletteEntries, type OperatorVerbAvailability } from "@opencode-ai/core/operator"
import { isRecord } from "./projection"
import { projectJobsSignal } from "./jobs/state"
import { projectSemanticSignal } from "./semantic/state"
import { projectMcpSignal } from "./mcp/state"

/** The managed collection an entity list projects (mirrors `entity-crud.cue #EntityKind`). */
export type OperatorEntityKind = "job" | "provider" | "model" | "mcp_server"

/** The CRUD action a collection-domain entity exposes (mirrors `entity-crud.cue #EntityVerb`, plus the `run_now` typed gap FR12). */
export type OperatorEntityVerb =
  | "create"
  | "edit"
  | "delete"
  | "enable"
  | "disable"
  | "reschedule"
  | "rotate_secret"
  | "connect"
  | "disconnect"
  | "run_now"

/** How an entity action is invoked: an on/off toggle, a pre-filled modal, a confirm gate, or a direct dispatch. */
export type OperatorEntityInteraction = "toggle" | "modal" | "confirm" | "direct"

/** One bounded, redacted row of an entity list (mirrors `entity-crud.cue #EntityRow`). */
export interface OperatorEntityRow {
  readonly entityId: string
  readonly label: string
  /** Short state marker rendered on the row (enabled/disabled, connection state). */
  readonly badge: string
  /** The on/off state a per-entity toggle reflects (enabled / connected); absent when the kind has no toggle. */
  readonly active?: boolean
}

/** One action offered on an entity item (mirrors `entity-crud.cue #EntityAction`). */
export interface OperatorEntityAction {
  readonly verb: OperatorEntityVerb
  readonly id: string
  readonly label: string
  readonly availability: OperatorVerbAvailability
  readonly interaction: OperatorEntityInteraction
}

/** One collection domain's list surface (mirrors `entity-crud.cue #EntityListScreen`). */
export interface OperatorEntityScreen {
  readonly kind: OperatorEntityKind
  readonly domain: string
  readonly title: string
  readonly listRead: string
  readonly createId?: string
  readonly idKey: string
}

/** Max entity rows rendered per list — bounded like the rich panels' row caps. */
export const MAX_ENTITY_ROWS = 50

/** Human label per entity verb. */
const VERB_LABEL: Readonly<Record<OperatorEntityVerb, string>> = {
  create: "Add",
  edit: "Edit",
  delete: "Delete",
  enable: "Enable",
  disable: "Disable",
  reschedule: "Reschedule",
  rotate_secret: "Rotate secret",
  connect: "Connect",
  disconnect: "Disconnect",
  run_now: "Run now",
}

/**
 * Presentation-layer typed capability gaps that stay marked + inert even though
 * their domain persists (Feature 014 FR9/FR10). `jobs.run-now` has no runtime
 * backend; it dispatches the canonical id and surfaces the typed envelope, never a
 * fabricated success (FR15).
 */
const TYPED_GAP_IDS: ReadonlySet<string> = new Set(["jobs.run-now"])

const ENTRY_BY_ID = new Map(listOperatorPaletteEntries().map((entry) => [entry.id, entry]))

/**
 * The per-verb availability an entity action renders (FR15). Folds the Feature 014
 * palette availability with the secret-keychain gate (a secret-related verb is
 * inert until keychain) and the presentation typed-gap set, so an unreachable
 * action is always `unavailable`, never a fabricated success.
 */
function entityAvailability(id: string): OperatorVerbAvailability {
  if (TYPED_GAP_IDS.has(id)) return "unavailable"
  const entry = ENTRY_BY_ID.get(id)
  if (!entry) return "unavailable"
  if (!entry.executable || entry.secretRelated) return "unavailable"
  return entry.availability
}

type ToggleSpec = {
  readonly onId: string
  readonly offId: string
  readonly onVerb: OperatorEntityVerb
  readonly offVerb: OperatorEntityVerb
}

type ActionSpec = { readonly verb: OperatorEntityVerb; readonly id: string; readonly interaction: OperatorEntityInteraction }

interface EntityKindSpec extends OperatorEntityScreen {
  readonly project: (effective: unknown) => readonly OperatorEntityRow[]
  readonly toggle?: ToggleSpec
  readonly actions: readonly ActionSpec[]
}

/** `jobs.list` effective → bounded job rows keyed by `jobDefinitionId`. */
function projectJobRows(effective: unknown): readonly OperatorEntityRow[] {
  return projectJobsSignal(effective)
    .signal.definitions.slice(0, MAX_ENTITY_ROWS)
    .map((def) => ({ entityId: def.jobDefinitionId, label: def.name, badge: def.enabled ? "enabled" : "disabled", active: def.enabled }))
}

/** `semantic.model.list` effective → bounded model rows keyed by descriptor id. */
function projectModelRows(effective: unknown): readonly OperatorEntityRow[] {
  return projectSemanticSignal(effective)
    .signal.models.slice(0, MAX_ENTITY_ROWS)
    .map((model) => ({ entityId: model.id, label: model.displayName, badge: model.enabled ? "enabled" : "disabled" }))
}

/** `semantic.provider.list` effective (`{ profiles: [...] }`) → bounded provider rows; honest-empty on absence/mismatch. */
function projectProviderRows(effective: unknown): readonly OperatorEntityRow[] {
  if (!isRecord(effective) || !Array.isArray(effective.profiles)) return []
  const rows: OperatorEntityRow[] = []
  for (const profile of effective.profiles) {
    if (rows.length >= MAX_ENTITY_ROWS) break
    if (!isRecord(profile) || typeof profile.id !== "string") continue
    const enabled = typeof profile.enabled === "boolean" ? profile.enabled : undefined
    rows.push({
      entityId: profile.id,
      label: typeof profile.name === "string" ? profile.name : profile.id,
      badge: enabled === undefined ? "provider" : enabled ? "enabled" : "disabled",
      ...(enabled === undefined ? {} : { active: enabled }),
    })
  }
  return rows
}

/** `mcp.server.list` effective → bounded server rows with the live connection state. */
function projectServerRows(effective: unknown): readonly OperatorEntityRow[] {
  return projectMcpSignal(effective)
    .signal.servers.slice(0, MAX_ENTITY_ROWS)
    .map((server) => ({
      entityId: server.id,
      label: server.name,
      badge: server.connectionState,
      active: server.connectionState === "connected",
    }))
}

const ENTITY_SPECS: Readonly<Record<OperatorEntityKind, EntityKindSpec>> = {
  job: {
    kind: "job",
    domain: "jobs",
    title: "Jobs",
    listRead: "jobs.list",
    createId: "jobs.create",
    idKey: "jobDefinitionId",
    project: projectJobRows,
    toggle: { onId: "jobs.enable", offId: "jobs.disable", onVerb: "enable", offVerb: "disable" },
    actions: [
      { verb: "edit", id: "jobs.update", interaction: "modal" },
      { verb: "reschedule", id: "jobs.reschedule", interaction: "modal" },
      { verb: "delete", id: "jobs.delete", interaction: "confirm" },
      { verb: "run_now", id: "jobs.run-now", interaction: "direct" },
    ],
  },
  provider: {
    kind: "provider",
    domain: "semantic",
    title: "Providers",
    listRead: "semantic.provider.list",
    createId: "semantic.provider.add",
    idKey: "id",
    project: projectProviderRows,
    actions: [
      { verb: "edit", id: "semantic.provider.update", interaction: "modal" },
      { verb: "rotate_secret", id: "semantic.provider.rotate-secret", interaction: "modal" },
      { verb: "disable", id: "semantic.provider.disable", interaction: "direct" },
      { verb: "delete", id: "semantic.provider.delete", interaction: "confirm" },
    ],
  },
  model: {
    kind: "model",
    domain: "semantic",
    title: "Models",
    listRead: "semantic.model.list",
    createId: "semantic.model.register",
    idKey: "id",
    project: projectModelRows,
    actions: [{ verb: "disable", id: "semantic.model.disable", interaction: "direct" }],
  },
  mcp_server: {
    kind: "mcp_server",
    domain: "mcp",
    title: "Servers",
    listRead: "mcp.server.list",
    createId: "mcp.server.add",
    idKey: "id",
    project: projectServerRows,
    toggle: { onId: "mcp.server.connect", offId: "mcp.server.disconnect", onVerb: "connect", offVerb: "disconnect" },
    actions: [
      { verb: "edit", id: "mcp.server.update", interaction: "modal" },
      { verb: "delete", id: "mcp.server.delete", interaction: "confirm" },
    ],
  },
}

const KINDS_BY_DOMAIN: Readonly<Record<string, readonly OperatorEntityKind[]>> = {
  jobs: ["job"],
  semantic: ["provider", "model"],
  mcp: ["mcp_server"],
}

/** The entity-list kinds a domain screen surfaces, or `[]` for a non-collection domain (FR12-FR14). */
export function listOperatorEntityKinds(domain: string): readonly OperatorEntityKind[] {
  return KINDS_BY_DOMAIN[domain] ?? []
}

/** The list surface descriptor for one entity kind (FR12-FR14). */
export function resolveOperatorEntityScreen(kind: OperatorEntityKind): OperatorEntityScreen {
  const spec = ENTITY_SPECS[kind]
  return { kind: spec.kind, domain: spec.domain, title: spec.title, listRead: spec.listRead, createId: spec.createId, idKey: spec.idKey }
}

/** Project a list read's effective payload into bounded entity rows for one kind (FR12-FR14). */
export function projectEntityRows(kind: OperatorEntityKind, effective: unknown): readonly OperatorEntityRow[] {
  return ENTITY_SPECS[kind].project(effective)
}

/** Resolve the toggle action for a row given its live active state, or the fixed non-toggle action. */
function toggleAction(toggle: ToggleSpec, row: OperatorEntityRow): OperatorEntityAction {
  const active = row.active === true
  const verb = active ? toggle.offVerb : toggle.onVerb
  const id = active ? toggle.offId : toggle.onId
  return { verb, id, label: VERB_LABEL[verb], availability: entityAvailability(id), interaction: "toggle" }
}

/** The per-entity actions an item screen offers, with the live availability per verb (FR12-FR15). */
export function buildOperatorEntityActions(kind: OperatorEntityKind, row: OperatorEntityRow): readonly OperatorEntityAction[] {
  const spec = ENTITY_SPECS[kind]
  const actions: OperatorEntityAction[] = []
  if (spec.toggle) actions.push(toggleAction(spec.toggle, row))
  for (const action of spec.actions) {
    actions.push({ verb: action.verb, id: action.id, label: VERB_LABEL[action.verb], availability: entityAvailability(action.id), interaction: action.interaction })
  }
  return actions
}

/** Availability of the create/add action on a list screen (FR15). */
export function entityCreateAvailability(kind: OperatorEntityKind): OperatorVerbAvailability {
  const createId = ENTITY_SPECS[kind].createId
  return createId ? entityAvailability(createId) : "unavailable"
}

/**
 * The Configure verb ids a domain's entity screens own (create + toggle + item
 * actions), so the domain panel drops them from its plain settings list and never
 * renders a verb twice — mirrors the controls' `consumedIds` partition (FR12).
 */
export function entityConsumedConfigureIds(domain: string): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const kind of listOperatorEntityKinds(domain)) {
    const spec = ENTITY_SPECS[kind]
    if (spec.createId) ids.add(spec.createId)
    if (spec.toggle) ids.add(spec.toggle.onId).add(spec.toggle.offId)
    for (const action of spec.actions) ids.add(action.id)
  }
  return ids
}

export * as OperatorEntity from "./entity"
