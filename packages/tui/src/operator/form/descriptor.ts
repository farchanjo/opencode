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
// process, a task) have no reachable option source until their `OperatorSlashPort`
// signal lands — exactly the honest-empty seam the five read panels document — so
// their `options()` returns `[]` and the picker renders its honest empty view.
// Only `langlock.set` has a static option source today (the fixed allowlist).
import { deriveAllowlistOptions } from "../../settings/langlock/row"
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

/** The single typed field a Configure verb collects (navigation.cue #InputMode `value_picker` | `text_input`). */
export type OperatorFormField =
  | {
      readonly mode: "value_picker"
      readonly key: string
      readonly options: () => readonly OperatorFormOption[]
      readonly emptyText: string
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

type FieldSpec =
  | { readonly mode: "value_picker"; readonly key: string; readonly options: () => readonly OperatorFormOption[]; readonly emptyText: string }
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
  "jobs.enable": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available" },
  "jobs.disable": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available" },
  "jobs.delete": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available" },
  "jobs.run-now": { mode: "value_picker", key: "jobDefinitionId", options: NO_OPTIONS, emptyText: "No job definitions available" },
  "process.cancel": { mode: "value_picker", key: "processId", options: NO_OPTIONS, emptyText: "No live processes available" },
  "task.cancel": { mode: "value_picker", key: "taskId", options: NO_OPTIONS, emptyText: "No cancellable tasks available" },
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
    return { mode: "value_picker", key: spec.key, options: spec.options, emptyText: spec.emptyText }
  }
  return { mode: "text_input", key: spec.key, placeholder: spec.placeholder, validate: requireText(spec.label) }
}
