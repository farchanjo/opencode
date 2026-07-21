/**
 * Palette/Settings metadata from reserved catalog (Feature 007 T035–T036,
 * Feature 011 grouped navigation projection T001–T006).
 * No hardcoded command lists — generated from RESERVED_CATALOG only.
 *
 * Feature 011 adds the presentation projection consumed by the single grouped
 * `Operator` entry: static persistence/availability + input-mode metadata, the
 * normative relabelled copy (replacing "Operator query: <id>"), and the
 * group-list / domain-panel builders. It owns no dispatch path; command ids stay
 * canonical and every leaf dispatches through the same OperatorClient (FR8).
 */
import { RESERVED_CATALOG, type OperatorDomain } from "./catalog"
import { requiresConfirmation } from "./confirmation"

/** Which panel section a verb lands in (FR3). */
export type OperatorVerbSection = "view" | "configure"

/** Per-verb affordance badge (FR3, FR4, FR7). */
export type OperatorVerbAvailability = "available" | "confirm_required" | "unavailable"

/** Typed form a Configure verb opens to collect its payload before dispatch (FR5). */
export type OperatorInputMode = "none" | "value_picker" | "text_input"

/** Whether a verb's backend persists today or stays honest-unavailable (FR7). */
export type OperatorPersistenceClass = "persists_today" | "honest_unavailable"

export type OperatorPaletteEntry = {
  readonly id: string
  readonly domain: string
  readonly operation: string
  readonly commandName: string
  readonly title: string
  readonly description: string
  readonly category: string
  readonly mutates: boolean
  readonly confirmRequired: boolean
  readonly scopesAllowed: readonly string[]
  readonly offlineCapable: boolean
  readonly slashAlias: string
  readonly paletteAlias: string
  /** Mutating secret/credential ops — require keychain (T019) when true */
  readonly secretRelated: boolean
  /** False when secretRelated and keychain unavailable. */
  readonly executable: boolean
  /** Human verb label (never the dotted id) shown in a grouped row (FR4). */
  readonly verbLabel: string
  /** View (read) or Configure (mutation) section (FR3). */
  readonly section: OperatorVerbSection
  /** Derived affordance badge (FR3, FR7). */
  readonly availability: OperatorVerbAvailability
  /** Typed form the Configure verb opens, `none` when no payload (FR5). */
  readonly inputMode: OperatorInputMode
  /** Backend persistence class (FR7). */
  readonly persistence: OperatorPersistenceClass
}

/**
 * Feature 019 T018 (FR14) — the composed backend-readiness signal a conditional
 * verb flips to (`semantic-lifecycle/enums-remainder.cue` `#BackendReadiness`). The
 * palette default (no readiness) keeps a Milvus/interactive/capability-conditional
 * verb `honest_unavailable` — the truth when the dependency is NOT composed; a caller
 * that KNOWS the dependency is live (a configured Milvus endpoint, an interactive TUI
 * surface, a subscribe-capable client) passes the flag so the verb reads the composed
 * truth. Every flag defaults to `false` so an unconfigured/headless/absent context
 * stays the honest typed gap (FR14: unconfigured Milvus / headless auth / absent
 * capability stay `honest_unavailable`).
 */
export type OperatorBackendReadiness = {
  /** A Milvus endpoint is configured — the embedding cutover/rollback/reindex + index maintenance verbs are composed. */
  readonly milvusConfigured?: boolean
  /** The surface is an interactive TUI — the interactive-OAuth `mcp.auth.start`/`finish` delegation is composed. */
  readonly interactiveSurface?: boolean
  /** A subscribe-capable MCP client is connected — the resource subscribe/unsubscribe verbs are composed. */
  readonly subscriptionCapable?: boolean
}

export type ListPaletteOptions = {
  /** When true, secret mutation entries are executable (native keychain available). */
  readonly keychainAvailable?: boolean
  /** Composed backend readiness — flips a conditional verb from its honest gap to the live truth (FR14). */
  readonly readiness?: OperatorBackendReadiness
}

/** One row of the Home group list (navigation.cue #DomainGroup) (FR2, FR4). */
export type OperatorDomainGroup = {
  readonly domain: string
  readonly label: string
  readonly badge: string
  readonly availability: OperatorVerbAvailability
  readonly viewCount: number
  readonly configureCount: number
  /** Centralised composed subtitle copy for the domain row (FR4). */
  readonly subtitle: string
}

/** One verb row under a domain panel section (navigation.cue #VerbItem) (FR3, FR4). */
export type OperatorVerbItem = {
  readonly id: string
  readonly label: string
  readonly subtitle: string
  readonly section: OperatorVerbSection
  readonly availability: OperatorVerbAvailability
  readonly inputMode: OperatorInputMode
  readonly persistence: OperatorPersistenceClass
  readonly secretRelated: boolean
  readonly confirmRequired: boolean
}

/** Pushed submenu for one domain: View section + Configure section (navigation.cue #DomainPanel) (FR3). */
export type OperatorDomainPanel = {
  readonly domain: string
  readonly label: string
  readonly view: readonly OperatorVerbItem[]
  readonly configure: readonly OperatorVerbItem[]
}

/** Top-level grouped entry copy (FR1, FR4). */
export const OPERATOR_TOP_TITLE = "Operator" as const
export const OPERATOR_TOP_SUBTITLE = "Grouped operator settings and views" as const

/**
 * Domains whose mutations persist today (FR7). Every other domain's mutations
 * are honest-unavailable until their backend lands (out of scope here).
 */
export const OPERATOR_PERSISTING_DOMAINS = [
  "langlock",
  "jobs",
  "routing",
  "process",
  "task",
  "telemetry",
  "smart",
  "budget",
  "pools",
  // Feature 046 — hierarchy/capability persist to the routing config document.
  "hierarchy",
  "capability",
] as const

const PERSISTING_DOMAIN_SET: ReadonlySet<string> = new Set(OPERATOR_PERSISTING_DOMAINS)

/**
 * Per-verb persistence overrides for mixed domains (Feature 014 T012, FR12). A
 * verb listed here overrides its domain-level default so a domain whose Configure
 * verbs split between a persisting backend and a capability-gated one renders the
 * honest `Partial` badge — no verb advertises persistence it lacks, and no
 * persisting verb reads as `unavailable`.
 *
 * - semantic: the nine config-backed registry mutations persist through the
 *   Config.Service `semantic` authority (T009); the Milvus-gated
 *   embedding/reranker/index mutations fall to the domain default
 *   (`honest_unavailable`).
 * - output: the two policy setters persist through the round-trip seam (T007) and,
 *   from Feature 017 (T014), the control-store admin edge (release/delete/purge)
 *   commits through the store-scoped authority; export/share stay honest gaps.
 * - mcp: from Feature 017 the config-backed server/logging/experimental/extension
 *   mutations (T008), the live-service connection actions (T009), and auth.remove
 *   (T010) commit honestly; auth.start/finish and resource subscribe/unsubscribe
 *   stay typed capability gaps, so the domain renders the honest `Partial` badge.
 */
export const OPERATOR_PERSISTING_VERBS = [
  // semantic config-backed registry (T009)
  "semantic.provider.add",
  "semantic.provider.update",
  "semantic.provider.disable",
  "semantic.provider.delete",
  "semantic.provider.rotate-secret",
  "semantic.model.register",
  "semantic.model.disable",
  "semantic.embedding.select",
  "semantic.reranker.select",
  // Feature 019 T018 (FR1-FR3, FR14) — the reranker cutover/rollback route through the
  // config-backed registry over a per-slot version archive, with NO Milvus dependency
  // (the pure `cutoverReranker`, `reEmbedded:false`). They are UNCONDITIONALLY composed
  // in the live stack (the `store.config` `semantic` authority is always bound), so they
  // flip to the composed truth here — unlike the Milvus-conditional embedding/index verbs
  // (handled by `CONDITIONAL_PERSISTING_VERBS`, which stay honest gaps until configured).
  "semantic.reranker.cutover",
  "semantic.reranker.rollback",
  // Feature 026 (FR1) — the reranker validation transition is config-backed with NO Milvus
  // dependency: it runs the provider rerank probe and promotes the staged candidate to
  // `validated` through the same `store.config` `semantic` authority the cutover/rollback use
  // (same class as `reranker.cutover`/`reranker.rollback` above), so it is UNCONDITIONALLY
  // composed in the live stack and flips to the composed truth here. Unlike
  // `semantic.embedding.validate` (Milvus reindex-first) and the other Milvus-conditional verbs
  // (handled by `CONDITIONAL_PERSISTING_VERBS`), it needs no configured Milvus endpoint.
  "semantic.reranker.validate",
  // output config-backed policy (T007)
  "output.retention.set",
  "output.quota.set",
  // Feature 017 T014 — output control-store admin edge (store-scoped authority)
  "output.release",
  "output.delete",
  "output.purge",
  // Feature 017 T008 — mcp config-backed mutations (store.config MCP authority)
  "mcp.server.add",
  "mcp.server.update",
  "mcp.server.delete",
  "mcp.server.disable",
  "mcp.logging.level.set",
  "mcp.experimental.enable",
  "mcp.experimental.disable",
  "mcp.extension.enable",
  "mcp.extension.disable",
  "mcp.resource.admin.policy.set",
  // Feature 017 T009 — mcp live-service connection actions (store-scoped authority)
  "mcp.server.connect",
  "mcp.server.disconnect",
  "mcp.server.reconnect",
  // Feature 017 T010 — mcp local credential clear (store-scoped authority)
  "mcp.auth.remove",
] as const

const PERSISTING_VERB_SET: ReadonlySet<string> = new Set(OPERATOR_PERSISTING_VERBS)

/**
 * Feature 019 T018 (FR14) — the verbs whose backend IS composed but whose
 * dependency is only reachable when configured/interactive/capable. Each maps to
 * the `#BackendReadiness` flag that flips it from the honest typed gap to the live
 * truth. With NO readiness (the default), they stay `honest_unavailable` — the
 * truth when the dependency is not composed (an unconfigured Milvus endpoint, a
 * headless auth surface, an absent subscription capability). This is what keeps the
 * `semantic` and `mcp` domain badges honestly `Partial` in the default projection
 * the TUI renders. Unlike `OPERATOR_PERSISTING_VERBS`, these are NOT unconditionally
 * persisting, so they are deliberately kept OUT of that static set (a gapped verb
 * must never leak into it — Feature 014/017 parity).
 *
 * - semantic embedding cutover/rollback/reindex + index reindex/reconcile: the
 *   config-backed registry physically builds + validates a Milvus blue/green
 *   generation before the alias swaps (T006/T007) and the reindex/reconcile live-doc
 *   source diffs real enumerated state (T008/T009); all require a configured Milvus
 *   endpoint (`milvusConfigured`).
 * - mcp.auth.start/finish: the interactive-OAuth delegation is composed only for an
 *   interactive TUI surface; a headless surface keeps the typed gap (T010,
 *   `interactiveSurface`).
 * - mcp.resource.admin.subscribe/unsubscribe: driven over the dual-authority machine
 *   only when a subscribe-capable client is connected; an absent capability is a
 *   fail-closed `capability_absent` (T011, `subscriptionCapable`).
 */
const CONDITIONAL_PERSISTING_VERBS: Readonly<Record<string, keyof OperatorBackendReadiness>> = {
  "semantic.embedding.reindex": "milvusConfigured",
  "semantic.embedding.cutover": "milvusConfigured",
  "semantic.embedding.rollback": "milvusConfigured",
  "semantic.index.reindex": "milvusConfigured",
  "semantic.index.reconcile": "milvusConfigured",
  "mcp.auth.start": "interactiveSurface",
  "mcp.auth.finish": "interactiveSurface",
  "mcp.resource.admin.subscribe": "subscriptionCapable",
  "mcp.resource.admin.unsubscribe": "subscriptionCapable",
}

/**
 * Per-verb input-mode descriptor map (T002, FR5; Feature 014 T012). Only the
 * persisting Configure verbs open a typed form; every other verb resolves to
 * `none`. Payload-free mutations (e.g. langlock.reset) stay `none` and dispatch
 * directly. Feature 014 adds the newly-editable config-backed verbs: the semantic
 * registry mutations (T009) and the two output policy setters (T007).
 */
export const OPERATOR_INPUT_MODES: Readonly<Record<string, OperatorInputMode>> = {
  "langlock.set": "value_picker",
  "langlock.reset": "none",
  "jobs.create": "text_input",
  "jobs.update": "text_input",
  "jobs.enable": "value_picker",
  "jobs.disable": "value_picker",
  "jobs.delete": "value_picker",
  "jobs.reschedule": "text_input",
  "jobs.run-now": "value_picker",
  "routing.configure": "text_input",
  "process.cancel": "value_picker",
  "process.steer": "text_input",
  "process.handoff": "text_input",
  "task.cancel": "value_picker",
  // Feature 014 T012 — semantic config-backed registry Configure verbs (T009).
  "semantic.provider.add": "text_input",
  "semantic.provider.update": "text_input",
  "semantic.provider.disable": "text_input",
  "semantic.provider.delete": "text_input",
  "semantic.provider.rotate-secret": "text_input",
  "semantic.model.register": "text_input",
  "semantic.model.disable": "text_input",
  "semantic.embedding.select": "text_input",
  "semantic.reranker.select": "text_input",
  // Feature 014 T012 — output config-backed policy setters (T007).
  "output.retention.set": "text_input",
  "output.quota.set": "text_input",
}

/**
 * Block mutating secret operations; allow safe queries like mcp.auth.status.
 */
export function isOperatorSecretMutationId(id: string): boolean {
  const lower = id.toLowerCase()
  // Safe status/show queries involving auth are allowed
  if (lower.endsWith(".status") || lower.endsWith(".show") || lower.endsWith(".list") || lower.endsWith(".history")) {
    return false
  }
  if (lower.includes("rotate-secret") || lower.includes("rotate_secret")) return true
  if (lower.includes("mcp.auth.start") || lower.includes("mcp.auth.finish") || lower.includes("mcp.auth.remove")) {
    return true
  }
  if (lower.includes("password") || lower.includes("credential") || lower.includes("token")) {
    // token in middle of non-mutate already excluded
    return true
  }
  if (lower.includes("secret") && !lower.includes("status")) return true
  return false
}

/** @deprecated use isOperatorSecretMutationId — kept for call sites */
export function isOperatorSecretRelatedId(id: string): boolean {
  return isOperatorSecretMutationId(id)
}

function splitId(id: string): { domain: string; operation: string } {
  const i = id.indexOf(".")
  if (i <= 0) return { domain: id, operation: id }
  return { domain: id.slice(0, i), operation: id.slice(i + 1) }
}

/** Humanise the operation into a verb label (never the dotted id) (FR4). */
function verbLabelFor(operation: string): string {
  const words = operation.replace(/[.\-_]/g, " ").trim()
  if (words.length === 0) return operation
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Humanise a domain token into a group label (FR2). */
function domainLabelFor(domain: string): string {
  return domain.charAt(0).toUpperCase() + domain.slice(1)
}

/**
 * Backend persistence class for a verb (T001, FR7; refined per-verb in Feature
 * 014 T012, FR12). Reads are honest today. A mutating verb persists when either
 * its whole domain persists OR it is a per-verb config-backed exception
 * (`OPERATOR_PERSISTING_VERBS`), so a mixed domain classifies each verb truthfully.
 */
function persistenceFor(
  id: string,
  domain: string,
  mutates: boolean,
  readiness?: OperatorBackendReadiness,
): OperatorPersistenceClass {
  if (!mutates) return "persists_today"
  if (PERSISTING_VERB_SET.has(id)) return "persists_today"
  // Feature 019 T018 (FR14) — a conditional verb flips to the composed truth ONLY when
  // its `#BackendReadiness` dependency is present; otherwise it stays the honest gap.
  const readinessFlag = CONDITIONAL_PERSISTING_VERBS[id]
  if (readinessFlag !== undefined) {
    return readiness?.[readinessFlag] === true ? "persists_today" : "honest_unavailable"
  }
  return PERSISTING_DOMAIN_SET.has(domain) ? "persists_today" : "honest_unavailable"
}

/** Derive the per-verb availability badge (T001, FR3, FR7). */
function availabilityFor(
  mutates: boolean,
  confirmRequired: boolean,
  persistence: OperatorPersistenceClass,
): OperatorVerbAvailability {
  if (!mutates) return "available"
  if (persistence === "honest_unavailable") return "unavailable"
  return confirmRequired ? "confirm_required" : "available"
}

/** Typed input mode for a verb (T002, FR5). */
function inputModeFor(id: string): OperatorInputMode {
  return OPERATOR_INPUT_MODES[id] ?? "none"
}

/**
 * Domain-qualified entry title (Feature 015 T003, FR3). This is the row title on
 * a surface where the domain is NOT implicit (the entry-level `title`): it reads
 * `{Domain} {action}` — e.g. `Telemetry status`, `Langlock set` — so the copy is
 * globally unique and the old `View: Status` ×8 duplication is gone. The dotted
 * command id stays discoverable only in `description`, never as the primary label.
 * On a domain screen (domain implicit) the action-only `verbLabel` is the row
 * title instead (see `toVerbItem`).
 */
function entryTitleFor(domainLabel: string, verbLabel: string): string {
  const action = verbLabel.charAt(0).toLowerCase() + verbLabel.slice(1)
  return `${domainLabel} ${action}`
}

/**
 * The longest dotted command id kept as a row's secondary line (Feature 016 FR3).
 * A longer id would truncate mid-token on the domain screen's row width, so it is
 * omitted rather than shown truncated. A sane bound, not a pixel measurement — the
 * screen is domain-implicit and short ids stay discoverable, long ones drop.
 */
export const MAX_ROW_COMMAND_ID = 28

/**
 * The row secondary line under the Feature 016 copy contract (FR3). Drops the old
 * `Read-only view ·`/`Editable setting ·` boilerplate — the section header alone
 * carries the kind. It carries an availability marker ONLY when the verb is not
 * fully available (`unavailable`/`confirm required`/`secret`) and appends the
 * dotted command id ONLY when it fits without truncation, omitting it otherwise.
 * A fully-available verb whose id fits reads as the bare id; one whose id is too
 * long reads as an empty string (no secondary line).
 */
export function operatorRowSubtitle(input: {
  commandId: string
  availability: OperatorVerbAvailability
  secretRelated?: boolean
}): string {
  const { commandId, availability, secretRelated } = input
  const parts: string[] = []
  if (availability === "unavailable") parts.push("Unavailable · not implemented yet")
  else if (availability === "confirm_required") parts.push("confirm required")
  if (secretRelated) parts.push("secret")
  if (commandId.length <= MAX_ROW_COMMAND_ID) parts.push(commandId)
  return parts.join(" · ")
}

export function listOperatorPaletteEntries(options: ListPaletteOptions = {}): readonly OperatorPaletteEntry[] {
  const keychainAvailable = options.keychainAvailable === true
  return RESERVED_CATALOG.entries.map((draft) => {
    const { domain, operation } = splitId(draft.id)
    const confirmRequired = draft.confirmRequired || requiresConfirmation(draft.id)
    const secretRelated = isOperatorSecretMutationId(draft.id)
    const secretBlocked = secretRelated && !keychainAvailable
    const section: OperatorVerbSection = draft.mutates ? "configure" : "view"
    const persistence = persistenceFor(draft.id, domain, draft.mutates, options.readiness)
    const availability = availabilityFor(draft.mutates, confirmRequired, persistence)
    const verbLabel = draft.title ?? verbLabelFor(operation)
    return {
      id: draft.id,
      domain,
      operation,
      commandName: `operator.${draft.id}`,
      title: entryTitleFor(domainLabelFor(domain), verbLabel),
      description: operatorRowSubtitle({ commandId: draft.id, availability, secretRelated }),
      category: secretRelated ? `Operator / ${domain} / secrets` : `Operator / ${domain}`,
      mutates: draft.mutates,
      confirmRequired,
      scopesAllowed: [...draft.scopesAllowed],
      offlineCapable: draft.offlineCapable ?? !draft.mutates,
      slashAlias: `/op.${draft.id}`,
      paletteAlias: draft.id,
      secretRelated,
      executable: !secretBlocked,
      verbLabel,
      section,
      availability,
      inputMode: inputModeFor(draft.id),
      persistence,
    }
  })
}

/** All reserved catalog domains project into the group menu (T004, FR2; Feature 046 adds hierarchy/capability). */
export const OPERATOR_SETTINGS_DOMAINS: readonly OperatorDomain[] = [
  "telemetry",
  "smart",
  "routing",
  "budget",
  "pools",
  "process",
  "task",
  "jobs",
  "langlock",
  "output",
  "semantic",
  "mcp",
  "hierarchy",
  "capability",
] as const

export function listOperatorSettingsEntries(domain: string): readonly OperatorPaletteEntry[] {
  return listOperatorPaletteEntries().filter((e) => e.domain === domain)
}

export function listAllOperatorSettingsDomains(): readonly {
  readonly domain: string
  readonly title: string
  readonly entryCount: number
}[] {
  return OPERATOR_SETTINGS_DOMAINS.map((domain) => ({
    domain,
    title: domainLabelFor(domain),
    entryCount: listOperatorSettingsEntries(domain).length,
  }))
}

/** Map a verb entry into a projection row (T006). */
function toVerbItem(entry: OperatorPaletteEntry): OperatorVerbItem {
  return {
    id: entry.id,
    label: entry.verbLabel,
    subtitle: entry.description,
    section: entry.section,
    availability: entry.availability,
    inputMode: entry.inputMode,
    persistence: entry.persistence,
    secretRelated: entry.secretRelated,
    confirmRequired: entry.confirmRequired,
  }
}

/** Derive the domain-level availability badge from its Configure verbs (T006, FR2). */
function domainBadge(
  configureCount: number,
  persistingConfigure: number,
): { badge: string; availability: OperatorVerbAvailability } {
  if (configureCount === 0 || persistingConfigure === configureCount) {
    return { badge: "Available", availability: "available" }
  }
  if (persistingConfigure === 0) {
    return { badge: "Unavailable", availability: "unavailable" }
  }
  return { badge: "Partial", availability: "confirm_required" }
}

/** Compose the normative domain-row subtitle copy (T003, FR4). */
function domainGroupSubtitle(badge: string, viewCount: number, configureCount: number): string {
  return `${badge} · ${viewCount} views · ${configureCount} settings`
}

/** Home group list: 12 domain rows with availability badge + section counts (T006, FR2). */
export function buildOperatorGroupList(): readonly OperatorDomainGroup[] {
  return OPERATOR_SETTINGS_DOMAINS.map((domain) => {
    const entries = listOperatorSettingsEntries(domain)
    const configure = entries.filter((e) => e.section === "configure")
    const view = entries.filter((e) => e.section === "view")
    const persistingConfigure = configure.filter((e) => e.availability !== "unavailable").length
    const { badge, availability } = domainBadge(configure.length, persistingConfigure)
    return {
      domain,
      label: domainLabelFor(domain),
      badge,
      availability,
      viewCount: view.length,
      configureCount: configure.length,
      subtitle: domainGroupSubtitle(badge, view.length, configure.length),
    }
  })
}

/** Per-domain panel: View section + Configure section verb lists (T006, FR3). */
export function buildOperatorDomainPanel(domain: string): OperatorDomainPanel {
  const entries = listOperatorSettingsEntries(domain)
  return {
    domain,
    label: domainLabelFor(domain),
    view: entries.filter((e) => e.section === "view").map(toVerbItem),
    configure: entries.filter((e) => e.section === "configure").map(toVerbItem),
  }
}

/**
 * The centralised section reading order for a domain screen (Feature 016 FR4).
 * A domain with editable (Configure) state leads with Configure so the primary
 * affordance is visible before the read-only View; a pure read-only domain keeps
 * View leading. Owned here — never open-coded per screen — so the ordering is one
 * source of truth the TUI consumes (mirrors `operator-screen-layout` `#SectionKind`).
 */
export function operatorSectionOrder(domain: string): readonly OperatorVerbSection[] {
  return buildOperatorDomainPanel(domain).configure.length > 0 ? ["configure", "view"] : ["view"]
}

/**
 * A collapsed enable/disable toggle control (Feature 015 T008, FR7). One control
 * replaces a domain's on/off (or enable/disable) verb pair: its enable/disable
 * command ids, a human label, and the derived availability. An `unavailable`
 * control renders marked + inert (FR15). Mirrors `controls.cue #ToggleRow`.
 */
export type OperatorToggleControl = {
  readonly kind: "toggle"
  readonly domain: string
  readonly base: string
  readonly label: string
  readonly enableId: string
  readonly disableId: string
  readonly availability: OperatorVerbAvailability
  readonly confirmRequired: boolean
}

/**
 * A tri-state routing control (Feature 015 T009, FR8). Smart routing is
 * `on`/`off`/`auto`; a binary toggle cannot honestly represent three states, so it
 * renders a pre-selected three-option picker instead. Mirrors
 * `controls.cue #TriStateRow`.
 */
export type OperatorTriStateControl = {
  readonly kind: "tristate"
  readonly domain: string
  readonly base: string
  readonly label: string
  readonly modes: readonly { readonly state: "on" | "off" | "auto"; readonly id: string }[]
  readonly availability: OperatorVerbAvailability
}

/**
 * The composed controls of one domain screen (Feature 015 T008/T009). Toggle and
 * tri-state controls collapse the on/off/auto Configure verb groups; `consumedIds`
 * lists every Configure verb a control absorbed so the screen can drop those from
 * its plain settings list and not render a verb twice.
 */
export type OperatorScreenControls = {
  readonly toggles: readonly OperatorToggleControl[]
  readonly tristates: readonly OperatorTriStateControl[]
  readonly consumedIds: ReadonlySet<string>
}

/** The on/off/auto role a Configure verb plays in a control group, or `undefined`. */
function controlRoleOf(id: string): { base: string; role: "on" | "off" | "auto" } | undefined {
  const dot = id.lastIndexOf(".")
  if (dot <= 0) return undefined
  const base = id.slice(0, dot)
  const seg = id.slice(dot + 1)
  if (seg === "on" || seg === "enable") return { base, role: "on" }
  if (seg === "off" || seg === "disable") return { base, role: "off" }
  if (seg === "auto") return { base, role: "auto" }
  return undefined
}

/** Human label for a control: the humanised last segment of its base (FR7, FR8). */
function controlLabelFor(base: string): string {
  return domainLabelFor(base.slice(base.lastIndexOf(".") + 1))
}

/** Fold a control group's member availabilities into one row availability (FR15). */
function controlAvailabilityOf(members: readonly OperatorPaletteEntry[]): OperatorVerbAvailability {
  if (members.some((e) => e.availability === "unavailable")) return "unavailable"
  if (members.some((e) => e.availability === "confirm_required")) return "confirm_required"
  return "available"
}

/**
 * Compose a domain's toggle and tri-state controls (Feature 015 T008/T009, FR7,
 * FR8). Only payload-free Configure verbs (`inputMode === "none"`) collapse into a
 * domain-level control — a per-entity toggle that selects an id (`jobs.enable`,
 * `value_picker`) stays a per-entity action for the collection CRUD screens
 * (FR12), never a domain toggle. A base with both `on` and `off` poles is a
 * toggle; a base that also has an `auto` pole is a tri-state. An `unavailable`
 * backend yields an inert, marked control (FR15).
 */
export function buildOperatorScreenControls(domain: string): OperatorScreenControls {
  const configure = listOperatorSettingsEntries(domain).filter(
    (e) => e.section === "configure" && e.inputMode === "none",
  )
  const groups = new Map<string, Partial<Record<"on" | "off" | "auto", OperatorPaletteEntry>>>()
  for (const entry of configure) {
    const role = controlRoleOf(entry.id)
    if (!role) continue
    const group = groups.get(role.base) ?? {}
    group[role.role] = entry
    groups.set(role.base, group)
  }

  const toggles: OperatorToggleControl[] = []
  const tristates: OperatorTriStateControl[] = []
  const consumedIds = new Set<string>()
  for (const [base, group] of groups) {
    const { on, off, auto } = group
    if (!on || !off) continue
    if (auto) {
      tristates.push({
        kind: "tristate",
        domain,
        base,
        label: controlLabelFor(base),
        modes: [
          { state: "on", id: on.id },
          { state: "off", id: off.id },
          { state: "auto", id: auto.id },
        ],
        availability: controlAvailabilityOf([on, off, auto]),
      })
      consumedIds.add(on.id).add(off.id).add(auto.id)
      continue
    }
    toggles.push({
      kind: "toggle",
      domain,
      base,
      label: controlLabelFor(base),
      enableId: on.id,
      disableId: off.id,
      availability: controlAvailabilityOf([on, off]),
      confirmRequired: on.confirmRequired || off.confirmRequired,
    })
    consumedIds.add(on.id).add(off.id)
  }
  return { toggles, tristates, consumedIds }
}

export function buildOperatorPaletteCommands(): readonly {
  readonly name: string
  readonly title: string
  readonly category: string
  readonly enabled: boolean
  readonly id: string
  readonly secretRelated: boolean
}[] {
  return listOperatorPaletteEntries().map((e) => ({
    name: e.commandName,
    title: e.title,
    category: e.category,
    enabled: e.executable,
    id: e.id,
    secretRelated: e.secretRelated,
  }))
}

export * as OperatorPalette from "./palette"
