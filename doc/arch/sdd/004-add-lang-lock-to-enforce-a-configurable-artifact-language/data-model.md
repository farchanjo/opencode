# Data Model: Lang Lock — Configurable Artifact-Language Enforcement (Feature 004)

Feature: [004 Lang Lock](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
ADR: [ADR-0005 Lang Lock Artifact-Language Policy and Progressive Enforcement](../../adr/0005-lang-lock-artifact-language-policy-and-progressive-enforcement.md) (proposed)
Status: draft (finalized in the tasks phase; confidence buckets, mid-flight
re-resolution, and advisory-UX thresholds resolved in ADR-0005 and its successors —
C5, C6, C11, C14)

Two shapes here are stores of record and nothing else is: **Lang Lock
policy/config** persists in the Feature 007 Config.Service authority (the `langlock.*`
keys, global base plus permission-gated project override), and **audit and
advisory-violation records** are projections over the single EventV2 authority
(C2, C8). No shape below is a second config store, event channel, operator bus, or
translation authority. Each `langlock.*` event registers through `EventV2.define` on
the existing `EventV2Bridge` via a new `publishLangLockEvent` boundary, mirroring the
Feature 002 lifecycle and Feature 003 jobs patterns (C8). The effective read model
surfaced to the LLM carries no content and no administrative capability (FR35).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface, matching
`packages/schema/src/schema.ts` and the existing `packages/schema/src/lifecycle/**`,
`packages/schema/src/routing/**`, and `packages/schema/src/jobs/**` modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- **Annotate-first on a plain base for every checked scalar.** Each identifier,
  version, and bounded-text ValueObject is built on the plain `Schema.String` /
  `Schema.Number` base, `.annotate({ identifier })` is applied BEFORE any
  `.check(...)`, and `Schema.brand(...)` (where the CUE definition is
  identifier-shaped) is applied last. Annotating an already-checked schema (including
  `Schema.Int`, the shared `PositiveInt` / `NonNegativeInt`) drops the root identifier
  from `.ast.annotations` in favor of the last check, so base-then-check-then-brand is
  load-bearing for contract hygiene (see `packages/schema/src/lifecycle/ids.ts`,
  `values.ts`, and `test/contract-hygiene.test.ts`).
- Integer counters fold `Schema.isInt()` into the check chain alongside the bound
  check; there are no real-valued fields in this feature (a detector confidence
  *score* is never carried — only a `ConfidenceBucket` enum, C5, AC14).
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- Epoch-millis observational timestamps decode through `DateTimeUtcFromMillis`.
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / `Schema.Number`
  (bare) forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/langlock/**` and mirrors
a CUE definition under `doc/arch/schemas/langlock/*.cue` one-to-one. The CUE packages
are `langlock.shared`, `langlock.enums`, `langlock.allowlist`, `langlock.policy`,
`langlock.effective`, `langlock.execution`, `langlock.envelope`, `langlock.detection`,
`langlock.exception`, `langlock.config`, and `langlock.events`.

---

## Shared identifiers

Name parity with `lifecycle.shared`, `routing.shared`, and `jobs.shared` is
intentional; this feature does not cross-import those modules, so the identifier
concepts are re-declared locally (C2, C8). Mirrors `doc/arch/schemas/langlock/ids.cue`.

```typescript
// packages/schema/src/langlock/ids.ts (novo)

import { Schema } from "effect"

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/
// Canonical BCP 47: language, optional script, optional region — the value is also
// validated at runtime by Intl.getCanonicalLocales plus the allowlist (FR4, C13).
const languageTagPattern = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/

// LanguageTag is a canonical BCP 47 artifact-language tag (FR1, FR4).
export const LanguageTag = Schema.String.annotate({ identifier: "LangLockIds.LanguageTag" })
  .check(Schema.isPattern(languageTagPattern))
  .pipe(Schema.brand("LangLock.LanguageTag"))
export type LanguageTag = typeof LanguageTag.Type

// PolicyId identifies a durable Lang Lock policy record in Config.Service (FR5, C2).
export const PolicyId = Schema.String.annotate({ identifier: "LangLockIds.PolicyId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.PolicyId"))
export type PolicyId = typeof PolicyId.Type

// ExceptionId identifies one operator-owned exception-manifest entry (FR14, C16).
export const ExceptionId = Schema.String.annotate({ identifier: "LangLockIds.ExceptionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.ExceptionId"))
export type ExceptionId = typeof ExceptionId.Type

// ExecutionId is the opaque execution correlation id — never a metric label (Observability, C8).
export const ExecutionId = Schema.String.annotate({ identifier: "LangLockIds.ExecutionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.ExecutionId"))
export type ExecutionId = typeof ExecutionId.Type

// EventId is the EventV2 evt_ id assigned per published langlock.* event (C8).
export const EventId = Schema.String.annotate({ identifier: "LangLockIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("LangLock.EventId"))
export type EventId = typeof EventId.Type
```

Correlation, principal, and reference ValueObjects keep opaque handles only; Feature
005 owns output bytes and Feature 002 owns Todo content (FR28, FR30, C9, C10). Mirrors
`doc/arch/schemas/langlock/correlation.cue`.

```typescript
// packages/schema/src/langlock/correlation.ts (novo)

export const CorrelationId = Schema.String.annotate({ identifier: "LangLockIds.CorrelationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("LangLock.CorrelationId"))
export const CausationId = Schema.String.annotate({ identifier: "LangLockIds.CausationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("LangLock.CausationId"))
export const RootSessionId = Schema.String.annotate({ identifier: "LangLockIds.RootSessionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("LangLock.RootSessionId"))
export const SessionId = Schema.String.annotate({ identifier: "LangLockIds.SessionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("LangLock.SessionId"))
// Principal — operator/system principal (Security 1, Security 4). ProjectRef / TodoRef
// / OutputRef / ManifestRef — opaque non-empty references (FR14, FR28, FR30, C9, C10, C16).
export const Principal = Schema.String.annotate({ identifier: "LangLockIds.Principal" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("LangLock.Principal"))
export const ProjectRef = Schema.String.annotate({ identifier: "LangLockIds.ProjectRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("LangLock.ProjectRef"))
export const TodoRef = Schema.String.annotate({ identifier: "LangLockIds.TodoRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("LangLock.TodoRef"))
export const OutputRef = Schema.String.annotate({ identifier: "LangLockIds.OutputRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("LangLock.OutputRef"))
export const ManifestRef = Schema.String.annotate({ identifier: "LangLockIds.ManifestRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("LangLock.ManifestRef"))
```

Version and bounded-count ValueObjects keep primitive obsession out of the aggregates.
Versions are carried, not re-authored — the Feature 007 Config.Service authority owns
the CAS `PolicyVersion` and EventV2 owns the durable `SchemaVersion` (C2, C8). Mirrors
`doc/arch/schemas/langlock/values.cue`.

```typescript
// packages/schema/src/langlock/values.ts (novo)

// Config.Service CAS/optimistic-concurrency version of a policy (FR5, FR7).
export const PolicyVersion = Schema.Number.annotate({ identifier: "LangLockValues.PolicyVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// Config-document version captured into the execution envelope at start (FR7, C11).
export const ConfigVersion = Schema.Number.annotate({ identifier: "LangLockValues.ConfigVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// EventV2 durable.version counter (C8).
export const SchemaVersion = Schema.Number.annotate({ identifier: "LangLockValues.SchemaVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// Per-aggregate order for a durable langlock.* event; no global order (C8).
export const Sequence = Schema.Number.annotate({ identifier: "LangLockValues.Sequence" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// Bounded advisory-violation / exception counts exported as metric values (Observability, AC14).
export const AdvisoryCount = Schema.Number.annotate({ identifier: "LangLockValues.AdvisoryCount" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const ExceptionCount = Schema.Number.annotate({ identifier: "LangLockValues.ExceptionCount" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
```

Bounded redacted text, flag, and timestamp ValueObjects exclude file text, diffs,
prompts, messages, paths, snippets, and secrets (NFR Privacy, Security 5). Mirrors
`doc/arch/schemas/langlock/text-values.cue`.

```typescript
// packages/schema/src/langlock/text-values.ts (novo)

// Human/native language name shown in pickers; never a technical tag (FR4, C13).
export const DisplayName = Schema.String.annotate({ identifier: "LangLockValues.DisplayName" }).check(Schema.isNonEmpty())
export const Reason = Schema.String.annotate({ identifier: "LangLockValues.Reason" })
export const Timestamp = Schema.String.annotate({ identifier: "LangLockValues.Timestamp" }).check(Schema.isNonEmpty())
export const TraceId = Schema.String.annotate({ identifier: "LangLockValues.TraceId" }).check(Schema.isNonEmpty())
export const SpanId = Schema.String.annotate({ identifier: "LangLockValues.SpanId" }).check(Schema.isNonEmpty())
// Flags: enabled state, override authorization, and the global hard-policy floor (FR1, FR5, FR7).
export const Enabled = Schema.Boolean.annotate({ identifier: "LangLockValues.Enabled" })
export const OverrideAuthorized = Schema.Boolean.annotate({ identifier: "LangLockValues.OverrideAuthorized" })
export const HardFloor = Schema.Boolean.annotate({ identifier: "LangLockValues.HardFloor" })
```

---

## Enumerations

Core policy/detection enums mirror `doc/arch/schemas/langlock/enums.cue`; the
event/actor enums mirror `enums-event.cue`; the closed `langlock.*` vocabulary mirrors
`event-types.cue`. Every enum is a ValueObject, never an Entity (calisthenics).

```typescript
// packages/schema/src/langlock/enums.ts (novo)

// Definition/effective scope; the langlock.* default scope is project (FR5, C2).
export const Scope = Schema.Literals(["global", "project", "root", "session"])
  .annotate({ identifier: "LangLockEnums.Scope" })

// The source that produced the effective value (FR7).
export const Origin = Schema.Literals(["default", "global", "project", "managed"])
  .annotate({ identifier: "LangLockEnums.Origin" })

// Advisory in V1; strict blocking is deferred to a separately approved policy (FR16, FR22, C5, C14).
export const EnforcementMode = Schema.Literals(["advisory", "strict_deferred"])
  .annotate({ identifier: "LangLockEnums.EnforcementMode" })

// The four independent language axes; Lang Lock governs only artifact (FR2, C1).
export const Axis = Schema.Literals(["ui_locale", "product_docs", "conversational", "artifact"])
  .annotate({ identifier: "LangLockEnums.Axis" })

// Write-target classification for advisory eligibility; generic code is never blocked (FR20, C5).
export const PathKind = Schema.Literals([
  "prose_markdown", "docs", "instruction_file", "commit_text",
  "generic_code", "exempt", "unknown",
]).annotate({ identifier: "LangLockEnums.PathKind" })

// Bounded detector-confidence bucket; no raw score is ever exported (FR21, C5, AC14).
export const ConfidenceBucket = Schema.Literals(["low", "medium", "high", "unknown"])
  .annotate({ identifier: "LangLockEnums.ConfidenceBucket" })

// The advisory detector that produced a result; content-free provenance (FR21, C5).
export const DetectorProvenance = Schema.Literals(["heuristic", "statistical", "declared", "none"])
  .annotate({ identifier: "LangLockEnums.DetectorProvenance" })

// Advisory follow-up status; it never gates the write (FR21, C6, AC8).
export const RemediationStatus = Schema.Literals(["none", "flagged", "acknowledged", "suppressed"])
  .annotate({ identifier: "LangLockEnums.RemediationStatus" })

// Operator-owned exemption kinds (FR14, C16).
export const ExceptionCategory = Schema.Literals([
  "i18n_resource", "vendor_generated", "lockfile", "legal",
  "external_contract", "golden_fixture", "exact_string",
]).annotate({ identifier: "LangLockEnums.ExceptionCategory" })
```

```typescript
// packages/schema/src/langlock/enums-event.ts (novo)

// Durable (replayable audit) vs live (advisory) langlock.* events (C8).
export const EventClass = Schema.Literals(["durable", "live"])
  .annotate({ identifier: "LangLockEnums.EventClass" })
// Origin subsystem of a langlock.* event (C8).
export const EventSource = Schema.Literals(["resolver", "injector", "stamper", "detector", "operator"])
  .annotate({ identifier: "LangLockEnums.EventSource" })
// Who acted; no LLM ever administers (FR35, AC13).
export const ActorKind = Schema.Literals(["runtime", "operator"])
  .annotate({ identifier: "LangLockEnums.ActorKind" })
// The audited mutation a durable audit event records (FR34, Security 4).
export const AuditAction = Schema.Literals([
  "set", "reset", "override_grant", "override_deny", "exception_register", "exception_revoke",
]).annotate({ identifier: "LangLockEnums.AuditAction" })
```

```typescript
// packages/schema/src/langlock/event-types.ts (novo)

// The closed 15-member langlock.* event vocabulary (C8). The langlock.* prefix is the
// Feature 004 audit/advisory event namespace on EventV2; it is DISTINCT from the
// Feature 007 langlock.* operator command domain (langlock.status|show|set|reset);
// both are reserved (C3, C8).
export const LangLockEventType = Schema.Literals([
  "langlock.policy_set", "langlock.policy_reset", "langlock.override_authorized",
  "langlock.override_denied", "langlock.exception_registered", "langlock.exception_revoked",
  "langlock.policy_injected", "langlock.policy_reapplied", "langlock.envelope_stamped",
  "langlock.advisory_flagged", "langlock.advisory_acknowledged", "langlock.advisory_suppressed",
  "langlock.detector_unknown", "langlock.resolution_retained", "langlock.unknown",
]).annotate({ identifier: "LangLockEnums.LangLockEventType" })
export type LangLockEventType = typeof LangLockEventType.Type
```

---

## Allowlist (FR3, FR4, C13)

The eight initial allowlisted tags, each paired with a human and native display name.
UI pickers show the human/native names only; the canonical BCP 47 tag is stored and
validated but never surfaced as the primary label (FR4, AC3). `en-US` is the
enabled-by-default artifact language (FR1). Mirrors
`doc/arch/schemas/langlock/allowlist.cue`.

```typescript
// packages/schema/src/langlock/allowlist.ts (novo)

export const AllowlistEntry = Schema.Struct({
  tag: LanguageTag,
  display_name: DisplayName,   // human name, e.g. "English (United States)"
  native_name: DisplayName,    // native name, e.g. "Português (Brasil)"
})
export type AllowlistEntry = Schema.Schema.Type<typeof AllowlistEntry>

export const Allowlist = Schema.Array(AllowlistEntry)   // the eight initial entries (FR3)

// Enabled-by-default artifact language (FR1). The canonical default tag, not a picker label.
export const DefaultTag = Schema.Literal("en-US")
```

The initial allowlist is `en-US`, `en-CA`, `en-GB`, `en-AU`, `pt-BR`, `es-ES`,
`es-MX`, and `es-AR` (FR3). Each stored tag is re-validated against
`Intl.getCanonicalLocales` and this allowlist before use (FR4, Security 2).

---

## LangLockPolicy aggregate (FR5, FR7, C2)

The durable policy aggregate root persisted in the Feature 007 Config.Service authority.
Global configuration is the base authority; a project override applies only when
`langlock.override` is authorized and never relaxes the global hard-policy floor (FR5,
Security 1). Mutations are atomic and idempotent within Config.Service with version/CAS
(FR34). Sub-objects each stay within the calisthenics field bound. Mirrors
`doc/arch/schemas/langlock/policy.cue` and `policy-parts.cue`.

```typescript
// packages/schema/src/langlock/policy.ts (novo)

export const PolicyIdentity = Schema.Struct({
  principal: Principal,
  version: PolicyVersion,                 // CAS version (FR5, FR7)
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
})

export const PolicyLanguage = Schema.Struct({
  enabled: Enabled,
  tag: LanguageTag,
  display_name: DisplayName,
  enforcement_mode: EnforcementMode,      // advisory in V1 (FR16, C5)
})

export const PolicyAuthority = Schema.Struct({
  scope: Scope,                           // default project (FR5, C2)
  origin: Origin,
  hard_floor: HardFloor,                  // global floor a project cannot relax (FR5)
  override_authorized: OverrideAuthorized, // langlock.override gate (Security 1)
  project_ref: Schema.NullOr(ProjectRef), // null for the global base
  manifest_ref: Schema.NullOr(ManifestRef), // bound exception manifest (C16)
})

export const LangLockPolicy = Schema.Struct({
  id: PolicyId,                           // aggregate-root identity (FR5)
  identity: PolicyIdentity,
  language: PolicyLanguage,
  authority: PolicyAuthority,
})
export type LangLockPolicy = Schema.Schema.Type<typeof LangLockPolicy>
```

### Policy resolution and override (C2)

`resolved` is the effective policy for an execution; a project override is only
`applied` when `langlock.override` is authorized and the global hard-policy floor is not
relaxed, otherwise the global value is `retained` (AC5, AC6). No user, session, LLM,
agent, plugin, MCP, or custom-command mutation is honored (FR6).

```
[*] --> global_base
global_base --> project_requested | resolved   (override present | no override)
project_requested --> authorized | retained     (langlock.override permitted | denied)
authorized --> floor_checked
floor_checked --> applied | retained             (floor satisfied | would relax floor)
applied --> resolved
retained --> resolved
resolved --> [*]
```

---

## EffectiveConfig read model (FR7, C4)

The immutable read model surfaced to the LLM inside the trusted execution envelope. It
exposes enabled state, canonical tag, display name, scope, source/origin, policy version,
enforcement mode, and authorized-override state — never file text, prompt, or path
(FR7, FR35). It is stamped into the execution envelope at start and is immutable for
that execution (C11). Sub-objects each stay within the calisthenics field bound. Mirrors
`doc/arch/schemas/langlock/effective.cue`.

```typescript
// packages/schema/src/langlock/effective.ts (novo)

export const EffectiveLanguage = Schema.Struct({
  enabled: Enabled,
  tag: LanguageTag,
  display_name: DisplayName,
  enforcement_mode: EnforcementMode,
})

export const EffectiveAuthority = Schema.Struct({
  scope: Scope,
  origin: Origin,
  policy_version: PolicyVersion,
  override_authorized: OverrideAuthorized,
})

export const EffectiveConfig = Schema.Struct({
  language: EffectiveLanguage,
  authority: EffectiveAuthority,
})
export type EffectiveConfig = Schema.Schema.Type<typeof EffectiveConfig>
```

---

## ExecutionStamp (FR18, FR19, FR26, C4, C11)

The immutable Lang Lock metadata captured into a Task/subagent/write/edit/apply_patch/
shell-commit execution envelope at start. It is native and is never a model-controlled
tool argument (FR19). The start-time tag/version is immutable for the running execution
and travels across cancel/retry/resume/handoff (C10, C11). The `todo_ref` and
`output_ref` link the Feature 002 Todo whose text follows the lock and the Feature 005
textual channel that carries the provenance (FR28, FR30, C9, C10). Mirrors
`doc/arch/schemas/langlock/execution-envelope.cue`.

```typescript
// packages/schema/src/langlock/execution-envelope.ts (novo)

export const StampLanguage = Schema.Struct({
  tag: LanguageTag,
  policy_version: PolicyVersion,
  config_version: ConfigVersion,          // captured at start; immutable (C11)
  enforcement_mode: EnforcementMode,
})

export const StampProvenance = Schema.Struct({
  origin: Origin,
  source: EventSource,
  captured_at: DateTimeUtcFromMillis,
  correlation_id: CorrelationId,
})

export const StampTree = Schema.Struct({
  root_session_id: RootSessionId,
  session_id: Schema.NullOr(SessionId),
  todo_ref: Schema.NullOr(TodoRef),       // Feature 002 Todo whose text follows the lock (C10)
  output_ref: Schema.NullOr(OutputRef),   // Feature 005 textual channel provenance (C9)
})

export const ExecutionStamp = Schema.Struct({
  language: StampLanguage,
  provenance: StampProvenance,
  tree: StampTree,
})
export type ExecutionStamp = Schema.Schema.Type<typeof ExecutionStamp>
```

---

## DetectorResult and AdvisoryRecord (FR20, FR21, C5, C6)

The content-free advisory-detection shapes. Advisory detection runs only on confidently
classified prose (Markdown, docs, instruction files, generated commit text) and NEVER
gates the write; generic source code is never blocked in V1 (FR20, C14, AC11). A record
carries no file text, diff, prompt, or path — only bounded enums plus an opaque
`execution_id` (FR21, Security 5). Detector unknown/failure is a recorded outcome that
never blocks the prompt, execution, or tool hot path (FR21, NFR Availability). Mirrors
`doc/arch/schemas/langlock/detection.cue`.

```typescript
// packages/schema/src/langlock/detection.ts (novo)

export const DetectorClassification = Schema.Struct({
  path_kind: PathKind,
  provenance: DetectorProvenance,
  confidence: ConfidenceBucket,           // bucket, never a raw score (AC14)
})

export const DetectorResult = Schema.Struct({
  classification: DetectorClassification,
  policy_version: PolicyVersion,
  remediation: RemediationStatus,
  detected_tag: Schema.NullOr(LanguageTag), // null on unknown/failure (FR21, C5)
})
export type DetectorResult = Schema.Schema.Type<typeof DetectorResult>

export const AdvisoryRecord = Schema.Struct({
  result: DetectorResult,
  expected_tag: LanguageTag,
  execution_id: ExecutionId,              // opaque correlation only (Observability)
  reason: Reason,                         // bounded; no content (Security 5)
})
export type AdvisoryRecord = Schema.Schema.Type<typeof AdvisoryRecord>
```

### Advisory validation lifecycle (C5, C6)

An artifact write produces a native immutable-metadata outcome unconditionally; advisory
detection runs only on confidently classified prose and never gates the write.
`compliant`, `advisory_flagged`, `exempt`, `not_eligible`, and `unknown` are absorbing
outcomes; `acknowledged` and `suppressed` are operator-driven follow-ups on a flagged
advisory (AC8).

```
written --> classified
classified --> exempt | not_eligible | detected
detected --> compliant | advisory_flagged | unknown
advisory_flagged --> acknowledged | suppressed
exempt | not_eligible | compliant | unknown | acknowledged | suppressed --> [*]
```

---

## ExceptionEntry and ExceptionManifest (FR14, C16)

Operator-owned, schema-validated, and allowlisted before use: bounded exception type,
authority, scope, and result — no content (Security 6). i18n resources,
vendor/generated files, lockfiles, legal text, external schemas/contracts, and
golden/exact fixtures are matched by the manifest; untrusted LLM/plugin/prompt requests
cannot create exemptions (AC9, AC10). The review/audit lifecycle rides the Feature 007
audit authority. Mirrors `doc/arch/schemas/langlock/exception.cue`.

```typescript
// packages/schema/src/langlock/exception.ts (novo)

export const ExceptionAuthority = Schema.Struct({
  principal: Principal,
  scope: Scope,
  version: PolicyVersion,
})

export const ExceptionEntry = Schema.Struct({
  id: ExceptionId,
  category: ExceptionCategory,            // bounded exemption kind (FR14, C16)
  authority: ExceptionAuthority,
  reason: Reason,                         // bounded; no content (Security 6)
  created_at: DateTimeUtcFromMillis,
})
export type ExceptionEntry = Schema.Schema.Type<typeof ExceptionEntry>

export const ExceptionEntryList = Schema.Array(ExceptionEntry)

export const ExceptionManifest = Schema.Struct({
  manifest_ref: ManifestRef,
  authority: ExceptionAuthority,
  entries: ExceptionEntryList,
  updated_at: DateTimeUtcFromMillis,
})
export type ExceptionManifest = Schema.Schema.Type<typeof ExceptionManifest>
```

---

## LangLockConfig keys (FR5, FR7, C2)

The `langlock.*` Config.Service keys. Lang Lock policy/config rides the canonical
Feature 007 Config.Service authority that already merges global and project sources; no
parallel store is introduced (C2). Global is the base authority; a project override
applies only under `langlock.override` and never relaxes the global hard-policy floor
(FR5, Security 1). Mirrors `doc/arch/schemas/langlock/config.cue`.

```typescript
// packages/schema/src/langlock/config.ts (novo)

export const ConfigLanguage = Schema.Struct({
  enabled: Enabled,                       // langlock.enabled
  tag: LanguageTag,                       // langlock.tag
  enforcement_mode: EnforcementMode,      // langlock.enforcementMode
})

export const ConfigAuthority = Schema.Struct({
  scope: Scope,                           // langlock.scope (default project)
  hard_floor: HardFloor,                  // langlock.hardFloor
  override_authorized: OverrideAuthorized, // langlock.override
  manifest_ref: Schema.NullOr(ManifestRef),
})

export const LangLockConfig = Schema.Struct({
  language: ConfigLanguage,
  authority: ConfigAuthority,
  version: ConfigVersion,
})
export type LangLockConfig = Schema.Schema.Type<typeof LangLockConfig>
```

---

## LangLockEnvelope (C8)

The common carrier on every `langlock.*` event. Kept small by composing sub-objects, each
at most seven fields. `event_id` is held as a value assigned by EventV2; the identifiable
message is the event member that carries the envelope. The envelope is content-free per
ADR-0001: only bounded enums, opaque execution ids, and redacted key/value metadata —
never file text, diff, prompt, message, path, snippet, reasoning, or tool payload
(Security 5, Observability, AC14). Mirrors `doc/arch/schemas/langlock/envelope.cue` and
`envelope-parts.cue`.

```typescript
// packages/schema/src/langlock/envelope.ts (novo)

export const EventKind = Schema.Struct({
  event_type: LangLockEventType,
  schema_version: SchemaVersion,
  event_class: EventClass,
  source: EventSource,
})

export const ActorContext = Schema.Struct({
  actor_kind: ActorKind,                  // runtime | operator; no LLM (FR35, AC13)
  principal: Principal,
  scope: Scope,
})

export const Ordering = Schema.Struct({
  sequence: Sequence,                     // per aggregate only; no global order (C8)
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
})

export const Delivery = Schema.Struct({
  execution_id: ExecutionId,              // opaque correlation only
  timestamp: DateTimeUtcFromMillis,
  // Redacted: no prompts, results, tool payloads, paths, or secrets (Security 5).
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
})

export const LangLockEnvelope = Schema.Struct({
  event_id: EventId,
  kind: EventKind,
  actor: ActorContext,
  ordering: Ordering,
  delivery: Delivery,
})
export type LangLockEnvelope = Schema.Schema.Type<typeof LangLockEnvelope>
```

---

## LangLock event vocabulary (C8)

The 15 members form a closed tagged union. Every member carries the `envelope`; a member
with a distinct payload adds one `detail` sub-object so policy-mutation, override,
exception, injection, advisory, and resolution stay distinct semantic events and are never
collapsed into a generic status update. Mirroring the Feature 002/003 pattern, each member
is registered as its own `EventV2.define` `Definition` on the `EventV2Bridge`
(`dataFields(Member.fields)`) and published through the new `publishLangLockEvent`
boundary, so no raw tagged union is wired to the bus (C8). Durable audit members carry the
EventV2 `durable {version, aggregate}` annotation and replay through `readAggregate`; live
advisory members omit it (C8). Mirrors `doc/arch/schemas/langlock/events.cue`,
`events-audit.cue`, and `events-advisory.cue`.

Detail sub-objects:

```typescript
// packages/schema/src/langlock/events.ts (novo)

export const PolicyDetail = Schema.Struct({ tag: LanguageTag, scope: Scope, policy_version: PolicyVersion })
export const OverrideDetail = Schema.Struct({
  override_authorized: OverrideAuthorized, scope: Scope, hard_floor: HardFloor,
})
export const ExceptionDetail = Schema.Struct({ category: ExceptionCategory, scope: Scope })
export const InjectionDetail = Schema.Struct({ enforcement_mode: EnforcementMode, origin: Origin })
export const AdvisoryDetail = Schema.Struct({
  path_kind: PathKind, confidence: ConfidenceBucket, remediation: RemediationStatus,
})
export const ResolutionDetail = Schema.Struct({ scope: Scope, origin: Origin })
```

Member and union shape (durable audit example carries the annotation; the envelope-only
`unknown` member omits `detail`):

```typescript
// Durable audit (C8): policy_set/reset, override_authorized/denied,
// exception_registered/revoked.
export const LangLockPolicySetEvent = Schema.Struct({
  type: Schema.Literal("langlock.policy_set"),
  envelope: LangLockEnvelope,
  detail: PolicyDetail,
})

// Live (C8): policy_injected, policy_reapplied, envelope_stamped, advisory_flagged,
// advisory_acknowledged, advisory_suppressed, detector_unknown, resolution_retained.
export const LangLockAdvisoryFlaggedEvent = Schema.Struct({
  type: Schema.Literal("langlock.advisory_flagged"),
  envelope: LangLockEnvelope,
  detail: AdvisoryDetail,
})

export const LangLockUnknownEvent = Schema.Struct({
  type: Schema.Literal("langlock.unknown"),
  envelope: LangLockEnvelope,              // envelope-only; never gates work
})
// ...one Struct per event-types.ts vocabulary entry, across events-audit.ts
// and events-advisory.ts.

export const LangLockEvent = Schema.TaggedUnion("type", [
  LangLockPolicySetEvent, LangLockAdvisoryFlaggedEvent, LangLockUnknownEvent,
  // ...the remaining 12 members.
])
export type LangLockEvent = Schema.Schema.Type<typeof LangLockEvent>
```

Durable audit definitions join the canonical inventory in
`packages/schema/src/durable-event-manifest.ts` through `Event.durable([...])` (C8), so
policy-mutation, override, and exception events are preserved across bounded-queue
overflow and restart by the durable aggregate, never by a projection. Live advisory,
injection, and resolution events are not durable and carry no sequence (C8).

The `EventV2.define` Definitions for every member live at the schema layer in
`packages/schema/src/langlock/event-definitions.ts` (mirroring the Feature 002
`lifecycle/event-definitions.ts` and Feature 003 `jobs/event-definitions.ts`
precedent), because the six durable members must be joinable into the canonical
`Durable` inventory in `durable-event-manifest.ts` and the schema package can never
depend on `packages/core`. The domain `event-bus.ts` (T021) re-exports these
Definitions; there is exactly one copy of each member's wire shape (C8). The durable
audit members carry `durable {version: 1, aggregate: "correlation_id"}`: no policy or
session id is present on the content-free `langlock.*` envelope, so the per-aggregate
`Ordering.sequence` groups by `Ordering.correlation_id` — the same key EventV2 reads
from a top-level `correlation_id` data field projected from
`envelope.ordering.correlation_id` at publish time (no duplicated authority).

---

## Parameters

Every provisional contract is declared here as a plan constant with a named acceptance
hook; ADR-0005 and the tasks phase fix final values (plan Non-goals; C5, C6, C11, C14).
No value is a hidden default: each is an explicit, overridable data constant on the domain
module, never inlined into an algorithm. IDs never appear as metric labels; over-budget
dynamic values map to `other`, reusing the Feature 001 cardinality allowlist (C8, AC14).

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `default_tag` | `en-US` (English, United States) | global | FR1, AC16 |
| `default_enabled` | `true` | global | FR1, AC16 |
| `default_scope` | `project` | per policy | (C2) |
| `default_enforcement_mode` | `advisory` (strict deferred) | per policy | AC11 |
| `allowlist` | the 8 initial tags (FR3) | global | AC3 |
| `override_authorized_default` | `false` (deny unless operator-authorized) | per project | AC5, AC6 |
| `hard_floor_default` | `false` (no floor unless operator-set) | global | FR5 |
| `advisory_path_kinds` | `prose_markdown`, `docs`, `instruction_file`, `commit_text` | detector | AC11 |
| `advisory_blocked_path_kinds` | `generic_code` never advisory-blocked | detector | AC11 |
| `confidence_buckets` | `low`, `medium`, `high`, `unknown` (no raw score) | detector | AC8, AC14 |
| `advisory_min_confidence` | `medium` to record a flag | detector | AC8 |
| `repeat_warning_suppress_window_ms` | 300_000 ms (5 min) | per path kind | AC8 |
| `midflight_reresolution` | apply at next execution start (start-time capture immutable) | execution | AC12 |
| `policy_version_capture` | at execution start into the envelope | execution | AC12, AC15 |
| `cardinality_budget` | 64 distinct dynamic ids -> `other` | metric labels | AC14, reuses Feature 001 |
| `audit_retention` | all durable (compaction deferred) | EventV2 durable aggregate | AC14 |

Feature 001 telemetry queue/cardinality-allowlist/budget-policy constants and the
Feature 007 Config.Service CAS/idempotency parameters are reused unchanged and are not
re-declared here (C2, C8).

---

## Cross-artifact traceability

| Entity | CUE mirror | TS module | Requirements |
| ------ | ---------- | --------- | ------------ |
| identifiers | `langlock/ids.cue`, `correlation.cue` | `langlock/ids.ts`, `correlation.ts` | FR1, FR4, FR26 |
| versions / counts | `langlock/values.cue` | `langlock/values.ts` | FR5, FR7, AC14 |
| bounded text / flags | `langlock/text-values.cue` | `langlock/text-values.ts` | FR4, FR5, Security 5 |
| enums | `langlock/enums.cue`, `enums-event.cue`, `event-types.cue` | `langlock/enums.ts`, `enums-event.ts`, `event-types.ts` | FR2, FR7, FR16, FR20, FR21, C1, C5 |
| Allowlist | `langlock/allowlist.cue` | `langlock/allowlist.ts` | FR3, FR4, C13 |
| LangLockPolicy | `langlock/policy.cue`, `policy-parts.cue` | `langlock/policy.ts` | FR5, FR7, C2 |
| EffectiveConfig | `langlock/effective.cue` | `langlock/effective.ts` | FR7, C4 |
| ExecutionStamp | `langlock/execution-envelope.cue` | `langlock/execution-envelope.ts` | FR18, FR19, FR26, C4, C10, C11 |
| DetectorResult / AdvisoryRecord | `langlock/detection.cue` | `langlock/detection.ts` | FR20, FR21, C5, C6 |
| ExceptionEntry / Manifest | `langlock/exception.cue` | `langlock/exception.ts` | FR14, C16 |
| LangLockConfig | `langlock/config.cue` | `langlock/config.ts` | FR5, FR7, C2 |
| LangLockEnvelope | `langlock/envelope.cue`, `envelope-parts.cue` | `langlock/envelope.ts` | C8 |
| LangLockEvent vocabulary | `langlock/events.cue`, `events-audit.cue`, `events-advisory.cue` | `langlock/events.ts` + member files | FR27, FR34, C8 |

---

## Application and enforcement seams — implementation notes (T025–T033)

Provenance notes recorded during the Phase 3 wave, per the honest-provenance
rule (an unreachable runtime seam keeps a typed gap, never a fabricated wiring):

1. **T025 persistence CAS vs domain version.** `LangLockPersistence` stores the
   `LangLockConfig` document under `langlock/global` and `langlock/project/<ref>`
   through the reused `ConfigPort`. Two version counters coexist and are NOT
   conflated: the Config.Service string CAS token (`cas_vN`) is the optimistic
   concurrency guard for the physical write, while the numeric `config.version`
   inside the document is the domain policy version the protocol port's
   `expectedVersion` compares against. `resolveEffective` defaults an unconfigured
   global base to the enabled `en-US` `defaultConfig` (a pure value, never a
   stored side effect) and runs the framework-free `PolicyResolution` over the
   optional project override (FR1, C15, AC16).

2. **T026 injection — pure module, honest live-pipeline seam.** `injection-service`
   implements the content-free block builder plus `injectIntoSystemArray` /
   `reapplyAfterTransform`, which are idempotent (a prior block is stripped and
   the canonical block re-appended, so a transform cannot strip or duplicate the
   lock, FR25/AC7) and preserve every non-lock system entry (the conversational
   axis is untouched, AC19). The live insertion into `session/prompt.ts` and the
   post-transform reapply in `session/llm/request.ts` (line 69 `experimental.chat
   .system.transform`) and `agent/agent.ts` (line 416) require plumbing the
   resolved `EffectiveConfig` through `PrepareInput`, which the session runtime
   does not carry today. That plumbing is an honest runtime seam left unwired
   rather than a risky mutation of the hot LLM-request path; the module surface it
   would call is complete and tested. The `langlock.policy_injected` /
   `policy_reapplied` audit members exist for when the seam is plumbed.

3. **T031 provenance module location.** The Feature 005 provenance seam lives at
   `packages/opencode/src/langlock/provenance.ts` (in `specScopeGlobs`) and is
   re-exported from the application barrel; the plan's illustrative
   `opencode/src/langlock/` tree did not enumerate a separate file, so this is a
   structural placement decision, not a shape change. It reads tag/version/origin
   /output_ref off the trusted `ExecutionStamp` and never recomputes or exports
   content (FR30, C9).

4. **T033 operator domain — honestly reachable; fail-closed override.** Lang Lock
   policy is a simple content-free document (no external assembler), so
   `resolve`/`set`/`reset` are all honestly backed by the reachable Config.Service
   persistence (unlike Feature 003 `jobs.create`/`update`, which needed an unbuilt
   assembler). The `langlock` `DomainInvoke` override is wired in `stack-live.ts`
   next to jobs; Feature 007 stays the sole registration authority (the reserved
   `langlock.status|show|set|reset` ids are already in the catalog). The injected
   `OverridePermissionPort` defaults to fail-closed DENY, so an unconfigured
   project override is rejected as `unauthorized` — never a fabricated grant —
   until a real Feature 007 Permission/Policy gate is bound (Security 1, AC5). The
   operator access-audit sink defaults to a bounded debug log at the command-port
   seam, mirroring the jobs wiring; the richer content-free `langlock.*` EventV2
   projection (T030) over `publishLangLockEvent` is a distinct seam whose live
   binding to the bridge from the operator `AppRuntime` follows the same boundary
   jobs left.

5. **T030 audit — single-decode envelope.** The projector builds the ENCODED
   envelope record (timestamp as epoch millis) and decodes the full member event
   ONCE, so the `DateTimeUtcFromMillis` field is never double-decoded (a decoded
   envelope re-nested in an event decode fails, since the event expects the
   encoded form). `redacted_metadata` is scrubbed of any content-bearing key
   before the event is built (Security 5, AC14).

## Settings, CLI, and TUI surfaces — implementation notes (T034–T036)

Provenance notes recorded during the Phase 4 wave, per the honest-provenance
rule (an unreachable runtime seam keeps a typed gap, never a fabricated wiring):

1. **T035 CLI verbs.** `opencode op langlock status|show|set|reset` are thin
   `Runtime.handler` leaves under `packages/cli/src/langlock/**` dispatching the
   reserved `langlock.*` ids through the same `Dispatch`/`Output` seam as
   `telemetry`/`jobs` — no divergent hardcoded verb, no direct import of the
   application services. `show` is the show-effective alias of `status` (both
   call `port.resolve`, matching the operator command port). `set` takes a
   required `tag` argument plus a required `--expected-version` CAS flag
   (mirroring the jobs mutation flags); `reset` takes only `--expected-version`.
   Renderers never present the canonical tag without its human display name
   (FR31, C13). Surface parity against the reserved catalog is pinned by
   `langlock/surface.test.ts` (mirrors `jobs/surface.test.ts`).

2. **T034/T036 TUI — display-only honest baseline; no live query seam yet.**
   `OperatorSlashPort.tryHandle` (`packages/tui/src/context/operator-slash.tsx`)
   returns only an `OperatorSlashDisplay` (title/message/variant/outcome
   strings) — there is no structured `LangLockPolicyPort.resolve`/`AdvisoryPort`
   query result, and no live `langlock.*` observation stream, reachable from the
   TUI today. Both the Settings row (`packages/tui/src/settings/langlock/**`)
   and the operator panel (`packages/tui/src/operator/langlock/**`) are built as
   pure projection modules (`row.ts` / `card.ts` / `history.ts` / `state.ts`)
   plus a display component that accepts an optional `policy`/`signal` accessor
   and renders an honest `EMPTY_LANGLOCK_SETTINGS_ROW` / `EMPTY_LANGLOCK_PANEL_
   SIGNAL` baseline when omitted — mirroring `packages/tui/src/operator/
   jobs/**`'s (Feature 003 T030) identical, already-accepted wiring-point
   pattern. This is the same class of documented gap as note 2 above (T026
   injection), not a new one.

3. **T034 mutation path — dispatch works today; live read does not.** Unlike the
   read side, the Lang Lock `set` mutation IS reachable from the TUI: the
   Settings row's `DialogLangLockPicker` looks up the registry-generated
   `langlock.set` entry via `listOperatorSettingsEntries("langlock")` (Feature
   007, never a hardcoded id) and dispatches it through
   `executeOperatorCommand`. That helper's `text` builder
   (`packages/tui/src/operator/execute.ts`) previously only supported
   argument-less commands (`/op.<id>`); it gained an optional `payload` field
   that JSON-encodes into the same `argsText` position the inbound slash
   adapters already parse (`packages/opencode/src/operator/adapters/inbound/
   slash.ts` `parseSlashPayload`, `rpc-slash-port.ts` / `http-slash-port.ts`
   `parseStrictPayload`) — a minimal, backward-compatible extension (existing
   argument-less callers are unaffected), not a new registry or a divergent
   verb. The picker's options are the fixed 8-entry
   `@opencode-ai/schema/langlock/allowlist` `INITIAL_ALLOWLIST` (a static value
   object, not a live operator query, so no port gap applies) titled by human
   display name only — the canonical tag is sent as the `tag` payload field but
   never used as a picker label (FR3, FR4, AC3).

## Tests and validation — implementation notes (T037–T042)

Decisions recorded during the Phase 5 (test/validation) wave:

1. **T038 draft `Axis` reconciliation (completes T015).** The plan-phase draft
   `contracts/ports.ts` still carried the pre-reconciliation second axis member
   `product_i18n`, while the wire-shape authority — `doc/arch/schemas/langlock/
   enums.cue` `#Axis`, this `data-model.md` (`Axis` literals above), and the
   `packages/schema/src/langlock/enums.ts` mirror the protocol sources from — all
   carry `product_docs`. T015's single-vocabulary reconciliation had missed this
   one member. The draft is now aligned to `product_docs` so the T038 parity
   suite pins full draft ↔ protocol ↔ schema agreement on the closed enums, not a
   documented divergence. No runtime code changed — the schema/protocol already
   carried `product_docs`; only the stale draft literal was corrected.

2. **T038 parity strategy mirrors Feature 003 `jobs/contract-parity.test.ts`.**
   The protocol parity suite source-scans the draft and the protocol mirror for
   the two `as const` vocabulary arrays plus the closed error unions, and compares
   the runtime `EventDefinitions` split — rather than importing the type-only
   port interfaces (they carry no runtime representation). The closed enums the
   protocol layer sources from `@opencode-ai/schema/langlock/*` (`import type`)
   are pinned against the schema runtime literals so the transport contract can
   never diverge from the wire shape.
