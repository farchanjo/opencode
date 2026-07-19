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
import type { DescriptorDraft } from "./descriptor"

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
  readonly suggest: boolean
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

export type ListPaletteOptions = {
  /** When true, secret mutation entries are executable (native keychain available). */
  readonly keychainAvailable?: boolean
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
] as const

const PERSISTING_DOMAIN_SET: ReadonlySet<string> = new Set(OPERATOR_PERSISTING_DOMAINS)

/**
 * Per-verb input-mode descriptor map (T002, FR5). Only the persisting Configure
 * verbs open a typed form; every other verb resolves to `none`. Payload-free
 * mutations (e.g. langlock.reset) stay `none` and dispatch directly.
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

/** Backend persistence class for a verb (T001, FR7). Reads are honest today. */
function persistenceFor(domain: string, mutates: boolean): OperatorPersistenceClass {
  if (!mutates) return "persists_today"
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

/** Normative verb title (T003, FR4): View/Configure prefix + human label. */
function verbTitleFor(section: OperatorVerbSection, label: string): string {
  return section === "view" ? `View: ${label}` : `Configure: ${label}`
}

/** Normative verb subtitle (T003, FR4). Dotted id stays discoverable, never primary. */
function verbSubtitleFor(input: {
  commandId: string
  section: OperatorVerbSection
  availability: OperatorVerbAvailability
  secretRelated: boolean
}): string {
  const { commandId, section, availability, secretRelated } = input
  let base: string
  if (availability === "unavailable") {
    base = `Unavailable · not implemented yet · ${commandId}`
  } else if (section === "view") {
    base = `Read-only view · ${commandId}`
  } else if (availability === "confirm_required") {
    base = `Editable setting · confirm required · ${commandId}`
  } else {
    base = `Editable setting · ${commandId}`
  }
  return secretRelated ? `${base} · secret` : base
}

export function listOperatorPaletteEntries(options: ListPaletteOptions = {}): readonly OperatorPaletteEntry[] {
  const keychainAvailable = options.keychainAvailable === true
  return RESERVED_CATALOG.entries.map((draft) => {
    const { domain, operation } = splitId(draft.id)
    const confirmRequired = draft.confirmRequired || requiresConfirmation(draft.id)
    const secretRelated = isOperatorSecretMutationId(draft.id)
    const secretBlocked = secretRelated && !keychainAvailable
    const section: OperatorVerbSection = draft.mutates ? "configure" : "view"
    const persistence = persistenceFor(domain, draft.mutates)
    const availability = availabilityFor(draft.mutates, confirmRequired, persistence)
    const verbLabel = draft.title ?? verbLabelFor(operation)
    const suggest =
      !draft.mutates &&
      !secretRelated &&
      (operation === "status" ||
        operation === "show" ||
        operation.endsWith(".status") ||
        operation.endsWith(".show") ||
        operation === "auth.status")
    return {
      id: draft.id,
      domain,
      operation,
      commandName: `operator.${draft.id}`,
      title: verbTitleFor(section, verbLabel),
      description: verbSubtitleFor({ commandId: draft.id, section, availability, secretRelated }),
      category: secretRelated ? `Operator / ${domain} / secrets` : `Operator / ${domain}`,
      mutates: draft.mutates,
      confirmRequired,
      scopesAllowed: [...draft.scopesAllowed],
      offlineCapable: draft.offlineCapable ?? !draft.mutates,
      slashAlias: `/op.${draft.id}`,
      paletteAlias: draft.id,
      secretRelated,
      suggest,
      executable: !secretBlocked,
      verbLabel,
      section,
      availability,
      inputMode: inputModeFor(draft.id),
      persistence,
    }
  })
}

export function listOperatorSuggestedEntries(): readonly OperatorPaletteEntry[] {
  return listOperatorPaletteEntries().filter((e) => e.suggest)
}

/** All 12 reserved catalog domains project into the group menu (T004, FR2). */
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

export function buildOperatorPaletteCommands(): readonly {
  readonly name: string
  readonly title: string
  readonly category: string
  readonly suggested: boolean
  readonly enabled: boolean
  readonly id: string
  readonly secretRelated: boolean
}[] {
  return listOperatorPaletteEntries().map((e) => ({
    name: e.commandName,
    title: e.title,
    category: e.category,
    suggested: e.suggest,
    enabled: e.executable,
    id: e.id,
    secretRelated: e.secretRelated,
  }))
}

export * as OperatorPalette from "./palette"
