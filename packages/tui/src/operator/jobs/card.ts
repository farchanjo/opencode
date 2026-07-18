// Pure text-first card projection for one scheduled Job Definition (Feature
// 003 / T030, FR30, C12). No I/O, no solid-js — safe to recompute on every
// render, mirroring packages/tui/src/routes/session/process-panel/card.ts
// (Feature 002 T036).
//
// Source of truth for the row shape: the committed `@opencode-ai/protocol/
// jobs/commands` `JobDefinitionSummary` — the redacted, versioned Feature 007
// operator-surface projection (never the durable snake_case
// `packages/schema/src/jobs/definition.ts` record, which still carries
// `secret_refs`/`payload_ref`/`permissions`). This module never resolves a
// secret reference and never renders one.

import type { JobDefinitionSummary } from "@opencode-ai/protocol/jobs/commands"

export interface JobDefinitionCardView {
  readonly jobDefinitionId: string
  readonly nameText: string
  readonly descriptionText: string
  /** Textual registration state; independent of any color coding. */
  readonly registrationStateText: string
  readonly enabledText: string
  readonly scheduleText: string
  readonly nextDueText: string
  readonly lastOutcomeText: string
  readonly actionTypeText: string
  readonly overlapPolicyText: string
  readonly misfirePolicyText: string
  /** `v<version>`, the redacted CAS version surfaced to any operator query. */
  readonly versionText: string
  readonly updatedAtText: string
}

const REGISTRATION_STATE_LABEL: Record<JobDefinitionSummary["registrationState"], string> = {
  pending: "pending registration",
  registered: "registered",
  unregistered: "unregistered",
  unknown: "unknown (needs reconcile)",
  reconciled: "reconciled",
}

const ACTION_TYPE_LABEL: Record<JobDefinitionSummary["actionType"], string> = {
  native_maintenance: "native maintenance",
  operator_notification: "operator notification",
  wake_or_structured_input: "wake / structured input",
  smart_routing_dispatch: "smart routing dispatch",
  approved_workflow: "approved workflow",
}

function outcomeText(outcome: JobDefinitionSummary["lastOutcome"]): string {
  return outcome ?? "no runs yet"
}

function dueText(nextDueAt: string | null): string {
  return nextDueAt ?? "not scheduled"
}

/** Derive the bounded, redacted card view rendered for one Job Definition row. */
export function deriveDefinitionCardView(summary: JobDefinitionSummary): JobDefinitionCardView {
  return {
    jobDefinitionId: summary.jobDefinitionId,
    nameText: summary.name,
    descriptionText: summary.description,
    registrationStateText: REGISTRATION_STATE_LABEL[summary.registrationState],
    enabledText: summary.enabled ? "enabled" : "disabled",
    scheduleText: `${summary.schedule.cronExpression} (${summary.schedule.ianaTimezone})`,
    nextDueText: dueText(summary.nextDueAt),
    lastOutcomeText: outcomeText(summary.lastOutcome),
    actionTypeText: ACTION_TYPE_LABEL[summary.actionType],
    overlapPolicyText: summary.overlapPolicy,
    misfirePolicyText: summary.misfirePolicy,
    versionText: `v${summary.version}`,
    updatedAtText: summary.updatedAt,
  }
}

export * as JobsCard from "./card"
