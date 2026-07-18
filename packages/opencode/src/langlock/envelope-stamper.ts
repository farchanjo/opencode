/**
 * Feature 004 / T027 (S12) — execution-envelope Lang Lock stamping.
 *
 * Stamps the immutable `ExecutionStamp` (tag / policy version / config version /
 * source / enforcement mode plus nullable `todo_ref` and `output_ref`) onto
 * Task / subagent / write / edit / apply_patch / shell-commit contexts as NATIVE
 * immutable metadata that is never a model-controlled tool argument (FR9, FR18,
 * FR19, FR23, FR26, FR28, FR29, C4, C10, C11, AC4, AC12, AC18, AC21, AC22). The
 * stamp captures the start-time tag/version so background / resumed / replayed /
 * parent-child / scheduled executions preserve it across cancel / retry / resume
 * / handoff. The Feature 002 Todo text travels under the lock via `todo_ref`
 * while Todo UI chrome stays on the UI-locale axis.
 *
 * Pure and framework-free: the stamp is built from the trusted `EffectiveConfig`
 * and a content-free context descriptor, then DEEP-FROZEN, so it is immutable for
 * the running execution and cannot be mutated by a later tool call (FR19). The
 * module never reads a model-controlled tool argument. Capability boundaries for
 * shell heredoc/redirect, non-streaming tools, and MCP output are declared
 * explicitly (FR23, AC18): those contexts carry the stamp as ambient envelope
 * metadata but Lang Lock never promises enforcement before the bytes cross an
 * OpenCode-observable boundary.
 */
export * as LangLockEnvelopeStamper from "./envelope-stamper"

import { Schema } from "effect"
import { ExecutionEnvelope } from "@opencode-ai/schema/langlock/execution-envelope"
import type { Effective } from "@opencode-ai/schema/langlock/effective"

/**
 * The enforcement contexts a stamp is attached to (FR9, FR18, FR19). Every value
 * maps to a seam in plan.md "Packages and modules"; none is a model-controlled
 * tool argument.
 */
export type ArtifactContext =
  | "task_prompt"
  | "subagent_internal_return"
  | "write_tool"
  | "edit_tool"
  | "apply_patch_tool"
  | "shell_commit"
  | "todo_text"
  | "commit_message"

/**
 * Whether a context carries the stamp as enforced native metadata or only as
 * ambient envelope metadata past a capability boundary (FR23, C4, AC18). Shell
 * heredoc/redirect, non-streaming tools, and MCP output cross an
 * OpenCode-unobservable boundary — the stamp still travels, but enforcement is
 * not promised before the bytes leave.
 */
export type StampCapability = "native" | "boundary"

/** Contexts whose bytes cross an OpenCode-unobservable boundary (FR23, AC18). */
const BOUNDARY_CONTEXTS: ReadonlySet<ArtifactContext> = new Set<ArtifactContext>(["shell_commit"])

/** Classify a context's enforcement capability (FR23, AC18). */
export function capabilityFor(context: ArtifactContext): StampCapability {
  return BOUNDARY_CONTEXTS.has(context) ? "boundary" : "native"
}

/** The content-free tree references the stamp travels with (FR26, FR28, C9, C10). */
export interface StampTreeInput {
  readonly rootSessionId: string
  readonly sessionId: string | null
  /** Feature 002 Todo whose text follows the lock; UI chrome does not (C10, AC21). */
  readonly todoRef: string | null
  /** Feature 005 textual-channel provenance reference (C9). */
  readonly outputRef: string | null
}

/** The content-free inputs to a stamp; the effective config is the trusted start-time source (FR18, C11). */
export interface StampInput {
  readonly effective: Effective.EffectiveConfig
  readonly context: ArtifactContext
  /** The Config.Service document version captured at start; immutable (C11). */
  readonly configVersion: number
  readonly correlationId: string
  readonly tree: StampTreeInput
  /** Start-time capture instant in epoch millis (default `Date.now`). */
  readonly capturedAtMs?: number
}

/** A frozen `ExecutionStamp` plus its declared capability boundary (FR19, FR23). */
export interface StampResult {
  readonly stamp: ExecutionEnvelope.ExecutionStamp
  readonly capability: StampCapability
  readonly context: ArtifactContext
}

/** Deep-freeze the stamp so it is immutable for the running execution (FR19, C11). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

/**
 * Build the immutable `ExecutionStamp` for one execution context (FR18, FR19,
 * FR26, C4, C11). Captures the start-time tag/policy-version/config-version from
 * the trusted effective config; the result is deep-frozen and never a
 * model-controlled tool argument. The `source` is always `stamper` — the stamp
 * is emitted by this seam, not by a model.
 */
export function stampExecution(input: StampInput): StampResult {
  const capturedAtMs = input.capturedAtMs ?? Date.now()
  const stamp = Schema.decodeUnknownSync(ExecutionEnvelope.ExecutionStamp)({
    language: {
      tag: input.effective.language.tag,
      policy_version: input.effective.authority.policy_version,
      config_version: input.configVersion,
      enforcement_mode: input.effective.language.enforcement_mode,
    },
    provenance: {
      origin: input.effective.authority.origin,
      source: "stamper",
      captured_at: capturedAtMs,
      correlation_id: input.correlationId,
    },
    tree: {
      root_session_id: input.tree.rootSessionId,
      session_id: input.tree.sessionId,
      todo_ref: input.tree.todoRef,
      output_ref: input.tree.outputRef,
    },
  })
  return {
    stamp: deepFreeze(stamp),
    capability: capabilityFor(input.context),
    context: input.context,
  }
}
