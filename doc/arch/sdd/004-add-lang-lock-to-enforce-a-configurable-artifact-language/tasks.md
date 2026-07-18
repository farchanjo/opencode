# Tasks: Add Lang Lock To Enforce A Configurable Artifact Language

Ordered, measurable work breakdown derived from `plan.md` slices S0–S20,
`data-model.md`, `contracts/ports.ts`, ADR-0005, and the
`doc/arch/schemas/langlock/*.cue` mirrors. Every task stays inside the
`specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1 (schema/protocol)
is additive and non-breaking; no runtime behavior changes until the Phase 3
enforcement wiring. Feature 004 adds no second config store, event channel,
operator command bus, or translation-model call (ADR-0005): Lang Lock policy/config
rides the Feature 007 Config.Service authority, effective language is injected into
V1/V2 system prompts and reapplied after `experimental.chat.system.transform`,
execution envelopes carry the tag/version, `langlock.*` audit and advisory events
register through `EventV2.define`, and management flows through the reserved
`langlock.status|show|set|reset` catalog IDs owned by Feature 007. Management
authority for every operator surface is Feature 007 (ADR-0003): Feature 004 supplies
typed `langlock.*` domain implementations and audit events only and never registers a
parallel command registry (C3). The `langlock.*` EventV2 audit/advisory prefix and the
Feature 007 `langlock.*` operator command domain are distinct reserved namespaces
(C3, C8). The canonical wire shape is the CUE corpus under
`doc/arch/schemas/langlock/*.cue` mirrored one-to-one by `data-model.md`: the closed
15-member `langlock.*` event vocabulary (`event-types.cue`), the 7-member `PathKind`,
and the 4-member `Origin` are authoritative; the `protocol/langlock` port surface
mirrors `contracts/ports.ts` interfaces while sourcing its enum members from the
schema modules so a single vocabulary is enforced (see the Traceability note).

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author `packages/schema/src/langlock/ids.ts` and
  `packages/schema/src/langlock/correlation.ts` with the branded identifiers from
  `data-model.md`: `LanguageTag` (canonical BCP 47 pattern), `PolicyId`,
  `ExceptionId`, `ExecutionId`, `EventId` (the EventV2 `evt_` id), plus
  `CorrelationId`, `CausationId`, `RootSessionId`, `SessionId`, `Principal`,
  `ProjectRef`, `TodoRef`, `OutputRef`, and `ManifestRef`; each built
  base-then-check-then-brand (`Schema.String.annotate({ identifier }).check(...)
  .pipe(Schema.brand("LangLock.*"))`), mirroring `ids.cue` and `correlation.cue`
  one-to-one with no cross-feature import; references stay opaque non-empty handles
  and secrets are never embedded (FR1, FR4, FR26, Security 5, C2, C8, C9, C10, C16).
  Acceptance: `tsgo --noEmit` on `packages/schema` and the schema contract-hygiene
  test assert annotate-before-check identity is retained on every brand.
- [x] T002 [S0] Author `packages/schema/src/langlock/values.ts` and
  `packages/schema/src/langlock/text-values.ts` with the version/order/count counters
  (`PolicyVersion`, `ConfigVersion`, `SchemaVersion`, `Sequence`, `AdvisoryCount`,
  `ExceptionCount`) folding `Schema.isInt()` into the bound check, and the bounded
  redacted text/flag value objects (`DisplayName`, `Reason`, `Timestamp`, `TraceId`,
  `SpanId`, `Enabled`, `OverrideAuthorized`, `HardFloor`) excluding file text, diffs,
  prompts, messages, paths, and secrets, mirroring `values.cue` and `text-values.cue`
  (FR4, FR5, FR7, Security 5, NFR Privacy, AC14). Acceptance: `tsgo --noEmit` green and
  the redaction test confirms no free-form content field is exported.
- [x] T003 [S0] Author `packages/schema/src/langlock/enums.ts`,
  `enums-event.ts`, and `event-types.ts` with the closed enums as
  `Schema.Literals([...])`: `Scope`, the 4-member `Origin`
  (`default|global|project|managed`), `EnforcementMode` (`advisory|strict_deferred`),
  `Axis`, the 7-member `PathKind`
  (`prose_markdown|docs|instruction_file|commit_text|generic_code|exempt|unknown`),
  `ConfidenceBucket`, `DetectorProvenance`, `RemediationStatus`, `ExceptionCategory`;
  `EventClass`, `EventSource`, `ActorKind`, `AuditAction`; and the closed 15-member
  `LangLockEventType` `langlock.*` vocabulary, mirroring `enums.cue`, `enums-event.cue`,
  and `event-types.cue` (FR2, FR7, FR16, FR20, FR21, FR22, C1, C5, C8). Acceptance:
  `tsgo --noEmit` green and the schema test asserts the 15-member vocabulary is closed
  and `generic_code` is present but never advisory-eligible.
- [x] T004 [S1] Author `packages/schema/src/langlock/allowlist.ts` with `AllowlistEntry`
  (`tag`, human `display_name`, `native_name`), the `Allowlist` array carrying the eight
  initial entries (`en-US`, `en-CA`, `en-GB`, `en-AU`, `pt-BR`, `es-ES`, `es-MX`,
  `es-AR`), and `DefaultTag` fixed to `en-US`, mirroring `allowlist.cue` (FR1, FR3, FR4,
  C13, AC3, AC16). Acceptance: `tsgo --noEmit` green and the allowlist test asserts eight
  canonical entries, each with human and native names, and `en-US` as the default.
- [x] T005 [S1] Author `packages/schema/src/langlock/policy.ts` composing
  `PolicyIdentity`, `PolicyLanguage`, and `PolicyAuthority` (each within the
  calisthenics field bound) into the durable `LangLockPolicy` aggregate root with CAS
  `version`, enabled state, tag, display name, enforcement mode, scope, origin,
  `hard_floor`, `override_authorized`, nullable `project_ref`, and nullable
  `manifest_ref`, mirroring `policy.cue` and `policy-parts.cue` (FR5, FR7, C2).
  Acceptance: `tsgo --noEmit` green and the schema test constructs a global-base and a
  project-override policy value.
- [x] T006 [S2] Author `packages/schema/src/langlock/effective.ts` composing
  `EffectiveLanguage` and `EffectiveAuthority` into the immutable `EffectiveConfig`
  read model surfaced to the LLM — enabled state, tag, display name, enforcement mode,
  scope, origin, policy version, and `override_authorized`, with no file text, prompt,
  or path — mirroring `effective.cue` (FR7, FR35, C4, C11). Acceptance: `tsgo --noEmit`
  green and the schema test confirms the read model carries no content-bearing field.
- [x] T007 [S2] Author `packages/schema/src/langlock/detection.ts` composing
  `DetectorClassification` (`path_kind`, `provenance`, `confidence` bucket),
  `DetectorResult` (classification, policy version, remediation status, nullable
  `detected_tag`), and `AdvisoryRecord` (result, expected tag, opaque `execution_id`,
  bounded `reason`), all content-free, mirroring `detection.cue` (FR20, FR21, C5, C6,
  AC8, AC11, AC14). Acceptance: `tsgo --noEmit` green and the schema test asserts
  `detected_tag` is nullable and no raw confidence score is present.
- [x] T008 [S2] Author `packages/schema/src/langlock/execution-envelope.ts` composing
  `StampLanguage` (tag, policy version, config version captured at start, enforcement
  mode), `StampProvenance` (origin, source, `captured_at`, correlation id), and
  `StampTree` (root session id, nullable session id, nullable `todo_ref`, nullable
  `output_ref`) into the `ExecutionStamp`, mirroring `execution-envelope.cue` (FR18,
  FR19, FR26, C4, C10, C11). Acceptance: `tsgo --noEmit` green and the schema test
  confirms the start-time version fields are required and never model-supplied.
- [x] T009 [S3] Author `packages/schema/src/langlock/exception.ts` composing
  `ExceptionAuthority` (principal, scope, version), `ExceptionEntry` (id, bounded
  `category`, authority, bounded `reason`, `created_at`), `ExceptionEntryList`, and the
  `ExceptionManifest` (manifest ref, authority, entries, `updated_at`), mirroring
  `exception.cue` (FR14, Security 2, Security 6, C16, AC9, AC10). Acceptance:
  `tsgo --noEmit` green and the schema test asserts the seven operator-owned exemption
  categories and no content field.
- [x] T010 [S1] Author `packages/schema/src/langlock/config.ts` composing
  `ConfigLanguage` (enabled, tag, enforcement mode), `ConfigAuthority` (scope,
  `hard_floor`, `override_authorized`, nullable `manifest_ref`), and `ConfigVersion`
  into `LangLockConfig` — the `langlock.*` Config.Service key shape that rides the
  Feature 007 authority with no parallel store — mirroring `config.cue` (FR5, FR7, C2,
  C15). Acceptance: `tsgo --noEmit` green and the schema test confirms the default scope
  is `project`.
- [x] T011 [S3] Author `packages/schema/src/langlock/envelope.ts` composing the bounded
  sub-structs `EventKind` (event type, schema version, event class, source),
  `ActorContext` (`runtime|operator` actor, principal, scope), `Ordering`
  (per-aggregate `sequence` only, correlation id, nullable causation id), and `Delivery`
  (opaque `execution_id`, timestamp, redacted key/value `redacted_metadata`) into the
  content-free `LangLockEnvelope`, mirroring `envelope.cue` and `envelope-parts.cue`
  (Security 5, Observability, C8, AC14). Acceptance: `tsgo --noEmit` green and the schema
  test asserts `redacted_metadata` carries no prompt, path, or payload key.
- [x] T012 [S3] Author `packages/schema/src/langlock/events.ts`,
  `events-audit.ts`, and `events-advisory.ts` with the detail sub-objects
  (`PolicyDetail`, `OverrideDetail`, `ExceptionDetail`, `InjectionDetail`,
  `AdvisoryDetail`, `ResolutionDetail`) and one `Schema.Struct` per closed 15-member
  vocabulary entry (each carrying `envelope`; a distinct-payload member adds one
  `detail`; the `langlock.unknown` member is envelope-only), then the closed
  `Schema.TaggedUnion("type", ...)` `LangLockEvent`, keeping the durable audit members
  (`policy_set`, `policy_reset`, `override_authorized`, `override_denied`,
  `exception_registered`, `exception_revoked`) distinct from the live advisory/injection
  members and never collapsed, mirroring `events.cue`, `events-audit.cue`, and
  `events-advisory.cue` (FR27, FR34, C8). Acceptance: `tsgo --noEmit` green and the schema
  test asserts every vocabulary member has a distinct Struct and the union is exhaustive.
- [x] T013 [S0–S3] Author the barrel `packages/schema/src/langlock/index.ts`
  re-exporting every langlock schema module and register the barrel in
  `packages/schema/src/index.ts`. Acceptance: `tsgo --noEmit` on `packages/schema` green
  and `bun test packages/schema` imports the barrel without a duplicate-export error.
- [x] T014 [S3] Extend `packages/schema/src/durable-event-manifest.ts` to join the six
  durable `langlock.*` audit definitions into the canonical `Durable` inventory through
  `Event.durable([...])`, leaving the live advisory/injection/resolution members out of
  the durable set, so no second event authority is introduced (C8). Acceptance:
  `bun test packages/schema` durable-manifest test green with the six langlock audit
  members present and the live members absent.
- [x] T015 [S4] Author `packages/protocol/src/langlock/ports.ts`,
  `packages/protocol/src/langlock/commands.ts`, and
  `packages/protocol/src/langlock/index.ts` mirroring `contracts/ports.ts`: the
  `LangLockPolicyPort` (`resolve`/`set`/`reset`), `DetectionPort` (`classify`),
  and `AdvisoryPort` (`record`/`list`/`ack`) interfaces, the `LangLockPolicySummary`
  read model, the `OperatorPrincipal` shape, the `langlock.*` command/query
  request/response payloads, and the typed `LangLockPolicyError`/`DetectionError`/
  `AdvisoryError` unions (including `unauthorized`, `floor_violation`, `invalid_tag`,
  `version_conflict`, and `reserved_name`), sourcing the enum members from the
  `packages/schema/src/langlock/*` modules (the 7-member `PathKind`, 4-member `Origin`,
  15-member vocabulary) so the transport contract never diverges from the wire shape,
  and never redefining the event payload schemas (FR7, FR21, FR34, FR35, C2, C3, C6, C8).
  Acceptance: `tsgo --noEmit` on `packages/protocol` green and the protocol parity test
  asserts each interface member matches `contracts/ports.ts`.

### Domain policy and detection engine (Phase 2)

- [x] T016 [S5] Author `packages/core/src/langlock/tag-validation.ts` validating a
  candidate tag through `Intl.getCanonicalLocales` plus the allowlist over the injected
  `AllowlistPort`, rejecting a non-canonical or non-allowlisted tag, and mapping a
  canonical tag to its human/native `DisplayName` without ever surfacing the tag as the
  primary picker label, mirroring `allowlist.cue`/`tag-validation` semantics (FR4,
  Security 2, C13, AC3, AC16). Acceptance: `bun test packages/core` covers canonical
  accept, non-allowlisted reject, and display-name mapping with no I/O.
- [x] T017 [S6] Author `packages/core/src/langlock/policy-resolution.ts` resolving the
  global base then a project override over the injected policy port, applying the
  hard-policy-floor guard so a project override is `applied` only when authorized and
  the floor is not relaxed and otherwise the global value is `retained`, and emitting a
  typed `floor_violation`/`unauthorized` decision rather than a silent relax, mirroring
  the `policy.cue` resolution statechart (FR5, FR24, C2, AC5, AC6). Acceptance:
  `bun test packages/core` covers authorized-apply, unauthorized-retain, and
  floor-violation-retain with a deterministic port.
- [x] T018 [S7] Author `packages/core/src/langlock/path-kind.ts` classifying a write
  target as prose (`prose_markdown`/`docs`/`instruction_file`/`commit_text`),
  `generic_code`, or `exempt`, exposing the advisory-eligibility rule so generic code
  and identifiers/filenames/quoted content are never advisory targets and only
  model-created or modified portions are classified, mirroring `enums.cue` `PathKind`
  semantics (FR8, FR10, FR13, FR20, C5, C12, AC11, AC20). Acceptance:
  `bun test packages/core` asserts prose kinds are eligible, `generic_code` is never
  eligible, and exempt paths are excluded.
- [x] T019 [S8] Author `packages/core/src/langlock/advisory-detector.ts` implementing the
  deterministic language-signal contract over the injected `DetectorPort`: it produces a
  `ConfidenceBucket` plus `DetectorProvenance` for an eligible prose kind, records an
  `unknown` outcome on detector failure that never blocks the prompt/execution/tool hot
  path, and never issues a translation-model call, mirroring `detection.cue` (FR16, FR21,
  C5, C6, AC8, AC11). Acceptance: `bun test packages/core` covers flag-on-mismatch,
  compliant-on-match, and unknown-on-failure without blocking.
- [x] T020 [S9] Author `packages/core/src/langlock/exception-matcher.ts` matching a write
  target against the operator-owned `ExceptionManifest`
  (i18n/vendor/lockfile/legal/external-contract/golden/exact) over the injected manifest
  port, returning a bounded `matched`/`denied` result, and rejecting any untrusted
  LLM/plugin/prompt attempt to create an exemption, mirroring `exception.cue` (FR14, FR15,
  Security 6, C16, AC9, AC10, AC18). Acceptance: `bun test packages/core` covers a manifest
  match, a non-match deny, and an untrusted-create rejection.
- [x] T021 [S15] Author `packages/core/src/langlock/event-bus.ts` registering one
  `EventV2.define` `Definition` per `langlock.*` member via `dataFields(Member.fields)`
  with `durable {version, aggregate}` on the six durable audit members and no `durable`
  annotation on the live advisory/injection/resolution members, exposing no raw tagged
  union to the bus, and an idempotent projector keyed on event id plus `(aggregate,
  sequence)` reusing the Feature 002 dedupe posture so audit and advisory events are
  never coalesced or dropped (FR27, C8, AC14). Acceptance: `bun test packages/core`
  asserts the durable-versus-live split and idempotent projection.
- [x] T022 [S15] Extend `packages/opencode/src/event-v2-bridge.ts` with
  `publishLangLockEvent` mirroring `publishLifecycleEvent`/`publishJobEvent` (location
  attach, single publish boundary) so `langlock.*` events ride the existing bridge and
  no second channel exists (C8). Acceptance: `bun test packages/opencode` asserts a
  published langlock audit event reaches the bridge boundary once.
- [x] T023 [S17] Author `packages/core/src/langlock/langlock-instruments.ts` adding the
  `langlock.resolve|inject|stamp|detect|audit` spans linked to the Feature 001
  session-execution/LLM/tool spans, the enabled-state / effective-tag (allowlisted enum)
  / scope / origin / enforcement-mode / path-kind / advisory-count / confidence-bucket /
  exception-category / override-authorized metrics with bounded-enum labels, reusing the
  Feature 001 cardinality allowlist (session/execution/file/path ids in traces/logs only;
  over-budget values map to `other`; async bounded export never blocks the hot path)
  (Observability, FR27, C8, AC14). Acceptance: `bun test packages/core` cardinality audit
  asserts no id appears as a metric label.
- [x] T024 [S5–S17] Author the barrel `packages/core/src/langlock/index.ts` re-exporting
  the tag-validation, policy-resolution, path-kind, advisory-detector, exception-matcher,
  event-bus, and instruments modules. Acceptance: `tsgo --noEmit` on `packages/core` green
  and the barrel imports without a duplicate-export error.

### Application and enforcement seams (Phase 3)

- [x] T025 [S10] Author `packages/opencode/src/langlock/persistence.ts` persisting
  `LangLockPolicy`/`LangLockConfig` under the `langlock.*` keys in the Feature 007
  Config.Service authority (global base plus permission-gated project override), atomic
  with version/CAS and idempotency, resolving an unconfigured project to the enabled
  `en-US` default without translating untouched content, and never opening a parallel
  store (FR5, FR7, C2, C15, AC5, AC16). Acceptance: `bun test packages/opencode` under the
  Feature 007 sandbox asserts CAS persistence and the en-US default resolution.
- [x] T026 [S11] Author `packages/opencode/src/langlock/injection-service.ts` injecting the
  effective-language block (conversational/artifact boundary plus exemptions) into the
  V1/V2 system array in `packages/opencode/src/session/prompt.ts` and reapplying it after
  `experimental.chat.system.transform` in `packages/opencode/src/session/llm/request.ts`
  and `packages/opencode/src/agent/agent.ts`, so a user/nested-AGENTS/system-transform
  plugin cannot strip the lock and main-chat prose stays conversational while code fences
  follow the lock (FR11, FR12, FR15, FR17, FR24, FR25, C4, C7, AC1, AC2, AC7, AC15, AC17,
  AC19). Acceptance: `bun test packages/opencode` asserts the block survives a mutating
  transform and the conversational axis is unchanged.
- [x] T027 [S12] Author `packages/opencode/src/langlock/envelope-stamper.ts` stamping the
  `ExecutionStamp` (tag/version/config-version/source/mode plus nullable `todo_ref` and
  `output_ref`) onto Task/subagent/write/edit/apply_patch/shell-commit contexts as native
  immutable metadata that is never a model-controlled tool argument, capturing the
  start-time tag/version so background/resumed/replayed/parent-child/scheduled executions
  preserve it across cancel/retry/resume/handoff, carrying the Feature 002 Todo text under
  the lock while Todo UI chrome stays on the UI-locale axis, and declaring explicit
  capability boundaries for shell heredoc/redirect, non-streaming tools, and MCP output
  (FR9, FR18, FR19, FR23, FR26, FR28, FR29, C4, C10, C11, AC4, AC12, AC18, AC21, AC22).
  Acceptance: `bun test packages/opencode` asserts the stamp is immutable for a running
  execution and Todo text inherits the tag while chrome does not.
- [x] T028 [S13] Author `packages/opencode/src/langlock/advisory-validator.ts` running
  post-write advisory detection only on confidently classified prose over the domain
  detector, recording provenance/bucket/path-kind/version/remediation content-free, never
  gating the write, and never rewriting an entire mixed-language file or retrotranslating
  untouched content (FR8, FR10, FR20, FR21, C5, C6, C12, AC8, AC11, AC20). Acceptance:
  `bun test packages/opencode` asserts a flagged advisory is recorded without blocking and
  generic code is not flagged.
- [x] T029 [S14] Author `packages/opencode/src/langlock/authorization.ts` applying the
  canonical Feature 007 Permission/Policy gate to `langlock.override`, denying a project
  override unless native operator policy allows it and never relaxing the global
  hard-policy floor, and rejecting any session/user/LLM/agent/plugin/MCP/custom-command
  mutation as a typed `unauthorized` failure (FR5, FR6, Security 1, C2, AC5, AC6).
  Acceptance: `bun test packages/opencode` covers authorized override, unauthorized deny,
  and floor-relax rejection.
- [x] T030 [S15] Author `packages/opencode/src/langlock/audit.ts` projecting content-free
  `langlock.*` audit and advisory-violation events over `publishLangLockEvent` per
  ADR-0001, carrying bounded enums/buckets/counts and opaque execution ids only and never
  file text/diff/prompt/message/path/snippet/reasoning/tool payload/secret (FR27,
  Security 5, C8, AC14). Acceptance: `bun test packages/opencode` asserts every projected
  field is bounded and content-free.
- [x] T031 [S19] Author the Feature 005 provenance seam attaching the Feature-005-owned
  Lang Lock tag/version/provenance to the textual OutputRef metadata read from the trusted
  execution envelope, not recomputed by Lang Lock and never exporting raw content (FR30,
  C9, AC14). Acceptance: `bun test packages/opencode` asserts the provenance is read from
  the envelope and no content is exported.
- [x] T032 [S11–S14] Author the barrel `packages/opencode/src/langlock/index.ts`
  re-exporting the persistence, injection-service, envelope-stamper, advisory-validator,
  authorization, and audit modules. Acceptance: `tsgo --noEmit` on `packages/opencode`
  green and the barrel imports without a duplicate-export error.
- [x] T033 [S16] Author `packages/opencode/src/operator/langlock/**` with the typed
  `LangLockPolicyPort`/`AdvisoryPort` domain implementations for the reserved
  `langlock.status`, `langlock.show` (show-effective alias), `langlock.set`, and
  `langlock.reset` operations, each emitting audit events and registered through the
  Feature 007 registry with zero provider/model calls, tokens, or cost, redacted/versioned
  human and JSON output, operator principal plus explicit scope plus version/CAS plus
  idempotency on `set`/`reset`, offline operation with no configured provider, and the LLM
  reading only effective policy and never invoking admin; the existing reserved catalog
  `packages/core/src/operator/catalog.ts` already declares the `langlock` domain and all
  four IDs at `RESERVED_CATALOG_VERSION`, so no catalog bump is performed and
  plugin/MCP/custom registration of these IDs is rejected with a structured `reserved_name`
  error (FR31, FR32, FR33, FR34, FR35, Security 4, C3, AC13). Acceptance:
  `bun test packages/opencode` under the sandbox asserts the four operations dispatch with
  zero model calls and a reserved-ID collision is rejected.

### Settings, CLI, and TUI surfaces (Phase 4)

- [x] T034 [S18] Author the Settings **Lang Lock** row under
  `packages/tui/src/**/settings/` presenting **Artifact language** with human/native
  language names, separate from the UI Language row, wired through the Feature 007
  adapters, and never surfacing the canonical tag as the primary label (FR31, C13, AC3).
  Acceptance: `bun test packages/tui` asserts the row renders native names and stores the
  canonical tag.
- [x] T035 [S18] Author `packages/cli/src/**/langlock/**` for `opencode op langlock
  status|show|set|reset`, each dispatching through the Feature 007 registry to the
  `LangLockPolicyPort` with registry-generated names (no divergent hardcoded verbs),
  emitting redacted/versioned human and JSON output, working offline, and making zero
  provider/model calls (FR32, FR33, C3, AC13). Acceptance: `bun test packages/cli` asserts
  human and JSON output with no model call.
- [x] T036 [S18] Author `packages/tui/src/**/operator/langlock/**` rendering the Lang Lock
  panel (effective policy, scope/origin, redacted/versioned advisory history) as a thin
  adapter over the Feature 007 registry with registry-generated names, live `langlock.*`
  watch over the observation seam, and screen-reader text independent of color (FR31, FR32,
  C3, C13). Acceptance: `bun test packages/tui` asserts the panel renders effective policy
  and advisory history redacted.

### Tests and validation (Phase 5)

- [x] T037 [S20] Add pure deterministic unit tests under `packages/core/test/langlock/**`
  for tag validation (canonical/allowlist/reject/display-name), policy resolution with the
  hard-policy-floor guard (authorized-apply/unauthorized-retain/floor-violation), path-kind
  classification (prose eligible, generic code never eligible, exempt excluded), the
  advisory detector buckets (flag/compliant/unknown), and exception matching (match/deny/
  untrusted-reject), with deterministic ports and no I/O (AC3, AC5, AC6, AC9, AC10, AC11).
  Acceptance: `bun test packages/core` green.
- [x] T038 [S20] Add schema and protocol tests under `packages/schema/test/langlock/**`
  and `packages/protocol/test/langlock/**` asserting contract hygiene
  (annotate-before-check identifiers), the closed 15-member `langlock.*` vocabulary and the
  durable-versus-live split, envelope and record redaction (no prompt/result/payload/path/
  secret), the allowlist eight-entry shape, and `protocol/langlock` parity against
  `contracts/ports.ts` (FR3, FR21, FR27, Security 5, C8, AC14). Acceptance:
  `bun test packages/schema` and `bun test packages/protocol` green.
- [x] T039 [S20] Add integration tests under `packages/opencode/test/langlock/**` through
  the Feature 007 sandbox stores under `.dev/` for Config.Service policy persistence plus
  CAS and the en-US default, immutable injection with post-transform reapplication,
  envelope stamping with start-time version capture preserved across resume/replay/
  scheduled and Todo-text inheritance, advisory detection on classified prose, and
  content-free `langlock.*` audit projection over the EventV2 authority (AC4, AC7, AC12,
  AC15, AC16, AC18, AC20, AC21, AC22). Acceptance: `bun test packages/opencode` green under
  the sandbox wrapper.
- [x] T040 [S20] Add contract and end-to-end tests through the Feature 007 sandbox wrapper
  covering the `langlock.*` IDs versus the existing reserved catalog (already carrying the
  domain and four IDs) with reserved-ID collision rejection, the CLI human plus JSON `op
  langlock` output with zero admin-time model calls, the TUI Lang Lock panel and Settings
  row, pt-BR chat with en-US artifacts and en-US chat with pt-BR artifacts, an es-MX i18n
  exception under en-US lock, and override denied/allowed (AC1, AC2, AC3, AC5, AC6, AC9,
  AC13, AC17). Acceptance: `bun test packages/opencode`/`packages/cli`/`packages/tui` green
  under the sandbox.
- [x] T041 [S20] Run per-package `tsgo --noEmit` typecheck and `bun test` for
  `packages/schema`, `packages/protocol`, `packages/core`, `packages/opencode`,
  `packages/cli`, and `packages/tui`, plus a telemetry cardinality audit under
  `packages/core/test/langlock/**` asserting `session_id`/`execution_id`/file/path never
  appear as metric labels, over-budget dynamic values map to `other`, and `langlock.*`
  spans correlate with the Feature 001 spans; every package must typecheck and test green
  (Observability, FR27, C8, AC14). Acceptance: all six packages typecheck and test green.
- [x] T042 [S0–S20] Close-out: tick every checkbox above once its task is complete and
  verified, confirm `speckit validate` is green with only the four pre-existing waived
  hygiene findings, and mark the Feature 004 workflow phase complete (every FR1–FR35 and
  AC1–AC22 mapped to a task per the Traceability section). Acceptance: `speckit validate`
  green and the Traceability tables fully mapped.

## Traceability

Requirements-to-task and acceptance-to-task coverage. The closed 15-member
`langlock.*` event vocabulary, the 7-member `PathKind`, and the 4-member `Origin` are
the CUE/`data-model.md` authority; `contracts/ports.ts` originally presented a divergent
provisional surface (18 event names, 3-member `PathKind`, 3-member `Origin`). T015
reconciled it to the CUE authority (15 event names, 7-member `PathKind`, 4-member
`Origin`, plus the `DetectorProvenance`/`RemediationStatus`/`ExceptionCategory`
member sets) and sourced the `protocol/langlock` enums directly from the
`packages/schema/src/langlock/*` modules so the transport contract cannot drift;
T038 pins that parity across the draft, the protocol mirror, and the schema modules.

| Requirement | Tasks |
| ----------- | ----- |
| FR1 default en-US / name | T003, T004, T005, T025 |
| FR2 four independent axes | T003, T026 |
| FR3 eight-tag allowlist | T004, T038 |
| FR4 canonical BCP 47 / native picker labels | T001, T016, T034 |
| FR5 global base / project override / floor | T005, T010, T017, T025, T029 |
| FR6 no session/user/LLM/plugin relax | T029 |
| FR7 effective config surface | T005, T006, T010, T025 |
| FR8 prose/comment/docstring enforcement | T018, T028 |
| FR9 docs/Todo/commit artifact kinds | T018, T027, T028 |
| FR10 only modified portions | T018, T028 |
| FR11 main prose conversational | T026 |
| FR12 chat code fences follow lock | T026 |
| FR13 identifiers/quoted exempt | T018, T020 |
| FR14 i18n/vendor exemptions | T009, T020 |
| FR15 legacy skill/MCP read no translate | T020, T026 |
| FR16 progressive hybrid | T003, T019 |
| FR17 inject V1/V2 prompts | T026 |
| FR18 envelope carries tag/version/source/mode | T008, T027 |
| FR19 native metadata, not a tool argument | T027 |
| FR20 advisory limited to prose | T018, T028 |
| FR21 content-free advisory record | T007, T019, T028, T030 |
| FR22 strict blocking deferred | T003 |
| FR23 heredoc/redirect/non-streaming/MCP boundaries | T027 |
| FR24 authorized policy outranks soft conventions | T017, T026 |
| FR25 ignore-instruction no effect / reapply after transform | T026 |
| FR26 background/resume/replay version capture | T008, T027 |
| FR27 Feature 001 inherit / content-free telemetry | T021, T023, T030 |
| FR28 Feature 002 Todo/envelope | T008, T027 |
| FR29 Feature 003 scheduled inherit | T027, T039 |
| FR30 Feature 005 provenance | T031 |
| FR31 Settings Lang Lock row | T033, T034, T036 |
| FR32 palette/slash/CLI operations | T033, T035, T036 |
| FR33 local dispatch / zero LLM / offline | T033, T035 |
| FR34 mutations scope/CAS/audit | T012, T025, T033 |
| FR35 LLM read-only, no admin | T006, T033 |

| Acceptance | Tasks |
| ---------- | ----- |
| AC1 pt chat / en artifacts | T026, T040 |
| AC2 en chat / pt artifacts | T026, T040 |
| AC3 initial variants by native name | T004, T016, T034, T037, T040 |
| AC4 subagent inheritance | T027, T039 |
| AC5 project override denied | T017, T025, T029, T037, T040 |
| AC6 project override allowed | T017, T029, T037, T040 |
| AC7 prompt/plugin resistance | T026, T039 |
| AC8 docs/comments/commit advisory | T019, T028, T038 |
| AC9 i18n exception | T009, T020, T040 |
| AC10 literal preservation | T020, T037 |
| AC11 mixed source advisory no block | T018, T019, T037 |
| AC12 background/replay/scheduled version | T027, T039 |
| AC13 offline commands | T033, T035, T040 |
| AC14 content-free telemetry | T007, T021, T023, T030, T038, T041 |
| AC15 V1/V2 parity | T026, T039 |
| AC16 existing project migration | T004, T016, T025 |
| AC17 nested AGENTS conflict | T026, T040 |
| AC18 legacy skill/MCP boundary | T020, T027 |
| AC19 conversational metadata | T026 |
| AC20 untouched content | T018, T028, T039 |
| AC21 Todo text under lock | T027, T039 |
| AC22 Todo handoff summary | T027, T039 |

## Dependencies

**Sequencing (internal):**

- Schema and protocol (T001–T015) precede every domain, application, and surface
  task. Within Phase 1: T001 and T002 precede T003–T012 (identifiers and value objects
  are referenced by every enum and struct); T003 (enums + vocabulary) precedes T005–T012;
  T004 (allowlist) depends on T001–T002; T005 (policy) depends on T002–T004; T006
  (effective) depends on T002–T003; T007 (detection) depends on T002–T003; T008
  (execution envelope) depends on T001–T003; T009 (exception) depends on T002–T003; T010
  (config) depends on T002–T003; T011 (envelope) depends on T001–T003; T012 (events)
  depends on T003 and T011; T013 (schema barrel) depends on T001–T012; T014 (durable
  manifest) depends on T012; T015 (protocol) depends on T003–T012.
- Domain engine (T016–T024) depends on the schemas (T001–T013). T016 (tag validation)
  depends on T004; T017 (policy resolution) depends on T005 and T016; T018 (path-kind)
  depends on T003; T019 (advisory detector) depends on T007 and T018; T020 (exception
  matcher) depends on T009; T021 (event bus) depends on T012 and T014; T022 (bridge)
  depends on T021; T023 (instruments) depends on T007 and T021; T024 (core barrel)
  depends on T016–T023.
- Application and enforcement seams (T025–T033) depend on the domain engine and schemas.
  T025 (persistence) depends on T005, T010, and T017; T026 (injection) depends on T006
  and T025; T027 (envelope stamper) depends on T008 and T026; T028 (advisory validator)
  depends on T019 and T027; T029 (authorization) depends on T025; T030 (audit) depends on
  T021 and T022; T031 (Feature 005 provenance) depends on T027; T032 (application barrel)
  depends on T025–T031; T033 (operator commands) depends on T015, T025, T029, and T030.
- Settings/CLI/TUI surfaces (T034–T036) depend on the operator commands (T033); T036
  additionally depends on T030 for the live advisory watch.
- Tests and validation (T037–T042) depend on their corresponding implementation tasks;
  T039–T040 run only through the Feature 007 sandbox wrapper; T041 (typecheck + test)
  depends on T001–T040; T042 (close-out) depends on every prior task and a green
  `speckit validate`.

**External dependencies (must be available or accepted first):**

- **ADR-0005 (Lang Lock Artifact-Language Policy and Progressive Enforcement, proposed)**
  is the required decision record; its provisional constants — confidence buckets, the
  `advisory_min_confidence` threshold, the repeat-warning suppress window, the mid-flight
  re-resolution rule, and the strict-mode roadmap — are plan constants in `data-model.md`
  fixed by acceptance testing (AC8, AC11, AC12) and deferred to the ADR and its successors
  (C5, C6, C11, C14). Strict language blocking is never shipped in V1 (FR22, C14).
- **EventV2 remains the single event authority**: `packages/schema/src/event.ts`
  (`EventV2.define`), `packages/core/src/event.ts` (`Service`, `readAggregate`), the
  `packages/schema/src/durable-event-manifest.ts` inventory, and the existing
  `packages/opencode/src/event-v2-bridge.ts` publish boundary are reused, not replaced.
  The `langlock.*` audit/advisory events register through `EventV2.define`; no second bus
  or channel is introduced (C8).
- **Feature 001 (Smart Agent Routing and Telemetry)** supplies the immutable execution
  envelope, the routing hard gates every dispatched agent/subagent inherits, and the
  telemetry instruments plus cardinality allowlist reused by T023 and T041 (FR27, C4, C8).
- **Feature 002 (Task Lifecycle Event Bus and Process Table)** supplies the EventV2
  projection precedent, the session-owned Todo model whose objective/item/progress/result/
  failure/handoff text follows the lock, and the Task/subagent envelopes that carry the
  tag/version across cancel/retry/resume/handoff (FR28, C8, C10).
- **Feature 003 (Scheduled Jobs and Async Notification)** supplies the scheduled
  definitions/occurrences that inherit the effective policy and whose occurrence Todo text
  follows the lock; scheduled administration stays operator-only (FR29, C11).
- **Feature 005 (OutputSpool/ArtifactStore)** owns the textual OutputRef metadata; T031
  attaches the Feature-005-owned tag/version/provenance read from the trusted envelope and
  never recomputes or exports content (FR30, C9).
- **Feature 007 (Operator Control Plane, ADR-0003 accepted)** is the sole management
  authority: its Config.Service persistence, Permission/Policy authorization, the reserved
  `langlock.status|show|set|reset` catalog already present at `RESERVED_CATALOG_VERSION`
  (no bump required), the registry, CAS, idempotency, audit, and the
  `.dev/opencode-operator/` sandbox wrapper (env prefix `OPENCODE_DEV_OPERATOR_=1`,
  loopback port 14096) are the only path for `langlock.*` registration (T033, T035–T036)
  and for integration/e2e tests (T039–T040). Feature 004 registers no parallel command
  registry (C2, C3, C16).

**Shared seams already in `specScopeGlobs` and NOT duplicated:**
`packages/opencode/src/event-v2-bridge.ts` (Feature 001) for `publishLangLockEvent`;
`packages/schema/src/durable-event-manifest.ts` and `packages/core/src/event.ts` and
`packages/core/src/operator/**` and `packages/opencode/src/operator/**` (Feature 007) for
the durable manifest, the EventV2 authority, the reserved `langlock.*` catalog, and the
operator command impls; `packages/opencode/src/agent/agent.ts` (Feature 001) and
`packages/opencode/src/session/llm/request.ts` for the post-transform injection reapply;
`packages/tui/src/**/operator/**` and `packages/tui/src/**/settings/**` (Feature 007) for
the Lang Lock panel and Settings row; `packages/schema/src/index.ts` and
`packages/schema/test/**` and `packages/protocol/test/**` (Feature 001) for the schema
barrel and schema/protocol tests.
</content>
</invoke>
