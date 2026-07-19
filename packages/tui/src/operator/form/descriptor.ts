// Per-verb input descriptor for the generalised operator Configure form
// (Feature 011 T010, FR5). Pure metadata — no I/O, no solid-js. It maps a
// persisting-domain Configure verb to the single typed field it collects before
// dispatch: a `value_picker` (a bounded option set, e.g. the langlock allowlist)
// or a `text_input` (free-form text handed to the Feature 007 typed command
// schema for validation). The form never constructs a command id or scope from
// this value — it only fills the payload the SAME executeOperatorCommand path
// serialises (FR8). The `#InputMode` per verb is fixed in core
// (`OPERATOR_INPUT_MODES`, T002); this map adds the field key + option/validation
// specifics core does not carry.
//
// The value_picker verbs that select a live entity (a job definition, a running
// process, a task) load their candidates from a read query issued through the SAME
// executeOperatorCommand path (Feature 012 T010/T011): `jobs.*` from `jobs.list`
// (→ jobDefinitionId), `process.cancel` from `process.tree` (→ processId),
// `task.cancel` from `task.tree` (→ taskId). Each carries a pure `source`
// describing the read id + a projection of its `effective` payload into options;
// an unavailable read yields an empty option set and the picker renders its honest
// empty view (FR6, FR8). `langlock.set` keeps its static option source (the fixed
// allowlist). The option `value` is always the entity id, never a command id.
import { deriveAllowlistOptions } from "../../settings/langlock/row"
import { projectJobsSignal } from "../jobs/state"
import { isRecord } from "../projection"
import type { OperatorPaletteEntry } from "@opencode-ai/core/operator"

/** One selectable option in a value_picker field; `value` is the payload value, never a command id. */
export type OperatorFormOption = {
  readonly title: string
  readonly description?: string
  readonly value: string
}

/** Result of validating a text_input value before it becomes a payload (FR5). */
export type OperatorFormValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string }

/**
 * A dynamic option source for an entity value_picker (Feature 012 T010/T011): the
 * read command id issued through executeOperatorCommand plus a pure projection of
 * its `effective` payload into options. Kept metadata-only — the form supplies the
 * runtime port and dispatches; a missing/unavailable read projects to `[]` (FR6).
 */
export type OperatorPickerSource = {
  readonly read: string
  readonly project: (effective: unknown) => readonly OperatorFormOption[]
}

/** The single typed field a Configure verb collects (navigation.cue #InputMode `value_picker` | `text_input`). */
export type OperatorFormField =
  | {
      readonly mode: "value_picker"
      readonly key: string
      readonly options: () => readonly OperatorFormOption[]
      readonly emptyText: string
      /** Dynamic entity loader; when set the form loads options from this read query (T010/T011). */
      readonly source?: OperatorPickerSource
    }
  | {
      readonly mode: "text_input"
      readonly key: string
      readonly placeholder: string
      readonly validate: (raw: string) => OperatorFormValidation
      /**
       * Build the dispatch payload from the validated value. A scalar field carries
       * the value under its canonical key (`{ [key]: value }`); a JSON field parses
       * the object and spreads its fields to the top level, because the domain
       * command ports read canonical top-level keys (`name`/`baseUrl`/`ttlSeconds`/…)
       * — nesting the raw text under a single wrapper key silently drops the operator
       * input and persists a default (Feature 014 FR12/FR14).
       */
      readonly toPayload: (value: string) => Record<string, unknown>
    }

/** Non-empty guard for a scalar text_input; the typed command schema does the real validation on dispatch. */
function requireText(label: string): (raw: string) => OperatorFormValidation {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, message: `${label} is required` }
    return { ok: true, value }
  }
}

/** A JSON-object text_input must parse to a non-array object before it is spread into the payload (FR12). */
function requireJsonObject(label: string): (raw: string) => OperatorFormValidation {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, message: `${label} is required` }
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      return { ok: false, message: `${label} must be valid JSON` }
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: `${label} must be a JSON object` }
    }
    return { ok: true, value }
  }
}

/** The fixed langlock artifact-language allowlist projected as picker options (reuses DialogLangLockPicker's source). */
function langlockTagOptions(): readonly OperatorFormOption[] {
  return deriveAllowlistOptions().map((option) => ({
    title: option.titleText,
    description: option.descriptionText,
    value: option.tag,
  }))
}

/** `jobs.list` effective → job-definition options keyed by `jobDefinitionId` (T010, FR6). */
function projectJobDefinitionOptions(effective: unknown): readonly OperatorFormOption[] {
  return projectJobsSignal(effective).signal.definitions.map((definition) => ({
    title: definition.name,
    description: `${definition.jobDefinitionId} · ${definition.enabled ? "enabled" : "disabled"}`,
    value: definition.jobDefinitionId,
  }))
}

/** The bounded `view` records carried by a process/task tree effective (`{ nodes: [{ view }] }`). */
function treeViews(effective: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(effective) || !Array.isArray(effective.nodes)) return []
  const views: Record<string, unknown>[] = []
  for (const node of effective.nodes) {
    if (isRecord(node) && isRecord(node.view)) views.push(node.view)
  }
  return views
}

/** `process.tree` effective → process options keyed by `processId` (T011, FR6). */
function projectProcessOptions(effective: unknown): readonly OperatorFormOption[] {
  const options: OperatorFormOption[] = []
  for (const view of treeViews(effective)) {
    if (typeof view.processId !== "string") continue
    options.push({
      title: typeof view.state === "string" ? `${view.processId} · ${view.state}` : view.processId,
      value: view.processId,
    })
  }
  return options
}

/** `task.tree` effective → task options keyed by `taskId`, de-duplicated (T011, FR6). */
function projectTaskOptions(effective: unknown): readonly OperatorFormOption[] {
  const seen = new Set<string>()
  const options: OperatorFormOption[] = []
  for (const view of treeViews(effective)) {
    if (typeof view.taskId !== "string" || seen.has(view.taskId)) continue
    seen.add(view.taskId)
    options.push({
      title: typeof view.state === "string" ? `${view.taskId} · ${view.state}` : view.taskId,
      value: view.taskId,
    })
  }
  return options
}

const JOBS_PICKER_SOURCE: OperatorPickerSource = { read: "jobs.list", project: projectJobDefinitionOptions }
const PROCESS_PICKER_SOURCE: OperatorPickerSource = { read: "process.tree", project: projectProcessOptions }
const TASK_PICKER_SOURCE: OperatorPickerSource = { read: "task.tree", project: projectTaskOptions }

type FieldSpec =
  | {
      readonly mode: "value_picker"
      readonly key: string
      readonly options: () => readonly OperatorFormOption[]
      readonly emptyText: string
      readonly source?: OperatorPickerSource
    }
  | {
      readonly mode: "text_input"
      readonly key: string
      readonly placeholder: string
      readonly label: string
      /** When true the value is a JSON object spread to the top-level payload; otherwise it is a scalar under `key`. */
      readonly json?: boolean
    }

const NO_OPTIONS: () => readonly OperatorFormOption[] = () => []

/**
 * Field spec per persisting-domain Configure verb (FR5). Keyed by canonical
 * command id; the payload key names mirror the domain's typed command schema and
 * are the only field the form collects. Entity-selection pickers (jobs/process/
 * task) resolve their candidates from a live signal that is not yet reachable, so
 * they carry `NO_OPTIONS` and render honest-empty until that source lands.
 */
const FORM_FIELDS: Readonly<Record<string, FieldSpec>> = {
  "langlock.set": { mode: "value_picker", key: "tag", options: langlockTagOptions, emptyText: "No allowlisted artifact languages" },
  "jobs.enable": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available", source: JOBS_PICKER_SOURCE },
  "jobs.disable": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available", source: JOBS_PICKER_SOURCE },
  "jobs.delete": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available", source: JOBS_PICKER_SOURCE },
  "jobs.run-now": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available", source: JOBS_PICKER_SOURCE },
  "process.cancel": { mode: "value_picker", key: "processId", options: NO_OPTIONS, emptyText: "No live processes available", source: PROCESS_PICKER_SOURCE },
  "task.cancel": { mode: "value_picker", key: "taskId", options: NO_OPTIONS, emptyText: "No cancellable tasks available", source: TASK_PICKER_SOURCE },
  "jobs.create": { mode: "text_input", key: "definition", placeholder: "Job definition (JSON)", label: "Job definition" },
  "jobs.update": { mode: "text_input", key: "definition", placeholder: "Job definition patch (JSON)", label: "Job definition patch" },
  "jobs.reschedule": { mode: "text_input", key: "schedule", placeholder: "Cron or ISO schedule", label: "Schedule" },
  "routing.configure": { mode: "text_input", key: "policy", placeholder: "Routing policy (JSON)", label: "Routing policy" },
  "process.steer": { mode: "text_input", key: "directive", placeholder: "Steering directive", label: "Directive" },
  "process.handoff": { mode: "text_input", key: "target", placeholder: "Handoff target", label: "Handoff target" },
  // Feature 014 T012 — semantic config-backed registry Configure verbs (T009). Each
  // fills the payload the domain's command schema validates on dispatch; the JSON
  // fields spread to the top level and the scalar fields carry the port's canonical
  // key (`id`/`newSecretRef`/`modelDescriptorId`) so the operator input actually
  // reaches the port — the form never builds a command id or scope from the value (FR8).
  "semantic.provider.add": { mode: "text_input", json: true, key: "provider", placeholder: '{"name":"…","baseUrl":"https://…","secretRef":"keychain:…"}', label: "Provider definition" },
  "semantic.provider.update": { mode: "text_input", json: true, key: "provider", placeholder: '{"id":"…","version":1,"patch":{…}}', label: "Provider patch" },
  "semantic.provider.disable": { mode: "text_input", key: "id", placeholder: "Provider id", label: "Provider id" },
  "semantic.provider.delete": { mode: "text_input", key: "id", placeholder: "Provider id", label: "Provider id" },
  "semantic.provider.rotate-secret": { mode: "text_input", key: "newSecretRef", placeholder: "New secret reference (keychain:…)", label: "Secret reference" },
  "semantic.model.register": { mode: "text_input", json: true, key: "model", placeholder: '{"providerProfileId":"…","modelRef":"…","displayName":"…"}', label: "Model definition" },
  "semantic.model.disable": { mode: "text_input", key: "id", placeholder: "Model id", label: "Model id" },
  "semantic.embedding.select": { mode: "text_input", key: "modelDescriptorId", placeholder: "Embedding model id", label: "Embedding model id" },
  "semantic.reranker.select": { mode: "text_input", key: "modelDescriptorId", placeholder: "Reranker model id", label: "Reranker model id" },
  // Feature 014 T012 — output config-backed policy setters (T007). JSON objects spread
  // to the top-level payload (`ttlSeconds`/`legalHold`, `quotaScope`/`maxBytes`).
  "output.retention.set": { mode: "text_input", json: true, key: "retention", placeholder: '{"ttlSeconds":86400,"legalHold":false}', label: "Retention policy" },
  "output.quota.set": { mode: "text_input", json: true, key: "quota", placeholder: '{"quotaScope":"session","maxBytes":1048576}', label: "Quota policy" },
}

/**
 * Resolve the typed field a Configure verb collects, or `undefined` for a
 * no-payload verb (`inputMode === "none"`, e.g. `langlock.reset` and every
 * honest-unavailable mutation) which dispatches directly (T012). The `#InputMode`
 * gate is core's; the field specifics are this module's.
 */
export function resolveOperatorFormField(entry: OperatorPaletteEntry): OperatorFormField | undefined {
  if (entry.inputMode === "none") return undefined
  const spec = FORM_FIELDS[entry.id]
  if (!spec) return undefined
  if (spec.mode === "value_picker") {
    return { mode: "value_picker", key: spec.key, options: spec.options, emptyText: spec.emptyText, source: spec.source }
  }
  const key = spec.key
  const validate = spec.json ? requireJsonObject(spec.label) : requireText(spec.label)
  const toPayload: (value: string) => Record<string, unknown> = spec.json
    ? (value) => JSON.parse(value)
    : (value) => ({ [key]: value })
  return { mode: "text_input", key, placeholder: spec.placeholder, validate, toPayload }
}
