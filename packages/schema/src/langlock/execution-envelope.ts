export * as ExecutionEnvelope from "./execution-envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/execution-envelope.cue one-to-one.
// ExecutionStamp is the immutable Lang Lock metadata captured into a
// Task/subagent/write/edit/apply_patch/shell-commit execution envelope at start
// (FR18, FR19, FR26, C4, C11). It is native and is never a model-controlled tool
// argument (FR19). The start-time tag/version is immutable for the running
// execution and travels across cancel/retry/resume/handoff (C10, C11).

// StampLanguage carries the effective tag, policy/config version and enforcement mode (FR18, C11).
export const StampLanguage = Schema.Struct({
  tag: Ids.LanguageTag,
  policy_version: Values.PolicyVersion,
  config_version: Values.ConfigVersion, // captured at start; immutable (C11)
  enforcement_mode: Enums.EnforcementMode,
}).annotate({ identifier: "LangLockExecution.StampLanguage" })
export type StampLanguage = Schema.Schema.Type<typeof StampLanguage>

// StampProvenance carries the origin, emitting source, capture instant and correlation (FR18, FR26).
export const StampProvenance = Schema.Struct({
  origin: Enums.Origin,
  source: EnumsEvent.EventSource,
  captured_at: DateTimeUtcFromMillis,
  correlation_id: Correlation.CorrelationId,
}).annotate({ identifier: "LangLockExecution.StampProvenance" })
export type StampProvenance = Schema.Schema.Type<typeof StampProvenance>

// StampTree carries the root-session/session/todo/output references the stamp travels with (FR26, FR28, C9, C10).
export const StampTree = Schema.Struct({
  root_session_id: Correlation.RootSessionId,
  session_id: Schema.NullOr(Correlation.SessionId),
  todo_ref: Schema.NullOr(Correlation.TodoRef), // Feature 002 Todo whose text follows the lock (C10)
  output_ref: Schema.NullOr(Correlation.OutputRef), // Feature 005 textual channel provenance (C9)
}).annotate({ identifier: "LangLockExecution.StampTree" })
export type StampTree = Schema.Schema.Type<typeof StampTree>

// ExecutionStamp is the immutable per-execution Lang Lock envelope metadata (FR18, C4, C11).
export const ExecutionStamp = Schema.Struct({
  language: StampLanguage,
  provenance: StampProvenance,
  tree: StampTree,
}).annotate({ identifier: "LangLockExecution.ExecutionStamp" })
export type ExecutionStamp = Schema.Schema.Type<typeof ExecutionStamp>
