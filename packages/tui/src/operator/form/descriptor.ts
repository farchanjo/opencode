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
    }

/** Non-empty guard for a text_input; the typed command schema does the real validation on dispatch. */
function requireText(label: string): (raw: string) => OperatorFormValidation {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, message: `${label} is required` }
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
  | { readonly mode: "text_input"; readonly key: string; readonly placeholder: string; readonly label: string }

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
  return { mode: "text_input", key: spec.key, placeholder: spec.placeholder, validate: requireText(spec.label) }
}
