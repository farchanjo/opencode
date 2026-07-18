export * as Profile from "./profile"

import { Schema } from "effect"
import { Collections } from "./collections"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/profile.cue one-to-one. TaskProfile and
// QueryFingerprint are the structured, content-free task representation driving
// retrieval (FR18). The original query text is preserved for embedding without a
// mandatory translation LLM call (FR15); the profile carries only bounded hints and
// a fingerprint, never the raw prompt (FR17, C4). The fingerprint keys the query
// embedding cache derived once per logical Task and reused across the agent and
// skill passes while valid (FR18, C10, AC16).

// QueryFingerprint keys the query-embedding cache by fingerprint, binding version and config hash (FR18, FR25, C10).
export const QueryFingerprint = Schema.Struct({
  fingerprint: TextValues.Fingerprint,
  binding_version: Values.BindingVersion,
  config_hash: TextValues.ConfigHash,
}).annotate({ identifier: "SemanticProfile.QueryFingerprint" })
export type QueryFingerprint = Schema.Schema.Type<typeof QueryFingerprint>

// TaskProfile is the structured content-free task profile with bounded routing hints (FR18, C4).
export const TaskProfile = Schema.Struct({
  fingerprint: QueryFingerprint,
  role_hint: EnumsState.RoleKind,
  domains: Collections.TagSet,
  languages: Collections.LanguageSet,
  project_id: Ids.ProjectId,
}).annotate({ identifier: "SemanticProfile.TaskProfile" })
export type TaskProfile = Schema.Schema.Type<typeof TaskProfile>
