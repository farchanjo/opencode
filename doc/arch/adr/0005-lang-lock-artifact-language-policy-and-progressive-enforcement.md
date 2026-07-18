---
status: proposed
date: 2026-07-18
deciders: [project maintainers]
---

# 0005 — Lang Lock Artifact-Language Policy and Progressive Enforcement

## Context and Problem Statement

Feature 004 (Lang Lock) enforces a configured language for new or modified
model-authored artifacts and internal instructions while preserving the
conversational language of the main chat, the UI locale/chrome axis, and the
product/docs i18n pipeline. It is enabled by default as English (United States)
(`en-US`) and uses progressive hybrid enforcement in V1. The feature `spec.md`
names this ADR — **Lang Lock Artifact-Language Policy and Progressive
Enforcement** — as the required decision record that formalizes the clarify
package (Session 2026-07-18, C1–C16) before `plan` completion and any
implementation.

The research base (`research.md`) confirms that OpenCode already carries four
independent language axes with no shared authority: the App UI locale
(`packages/app/src/context/language.tsx`), a separate Desktop locale path
(`packages/desktop/src/renderer/i18n/index.ts`), a product/docs translation
pipeline (`script/translate-app.md`), and soft English artifact conventions in
`CLAUDE.md`/`GROK.md` that are instructions, not a hard config authority. No
`artifactLanguage` schema field exists today. The mutable
`experimental.chat.system.transform` hook (`request.ts`, `agent.ts`) can strip
any system-array content, and TaskTool accepts model-authored prompt text — so a
naive prompt string cannot be a durable policy.

Without one decision record, Feature 004 risks a second config authority beside
the Feature 007 Config.Service, a model-controlled enforcement tool argument, a
second event/telemetry channel beside EventV2/ADR-0001, a strict language
detector that false-blocks generic source code, translation-model calls made
solely to satisfy the lock, or a picker that surfaces raw BCP 47 tags. This ADR
fixes those decisions so `plan` and `tasks` proceed against a stable
policy/enforcement/detection contract without reopening Feature 001
immutable-envelope gates, Feature 002 lifecycle/Todo authority, Feature 005
content-plane ownership, or Feature 007 native-only operator authority and the
reserved catalog.

## Decision Drivers

- One config/policy authority (Feature 007 Config.Service) that already merges
  global and project sources; no parallel store.
- Global base authority with permission-gated project override; a project
  override never relaxes the global hard-policy floor.
- Effective language immutable for a model execution and resistant to
  user/plugin/MCP/nested-instruction prompt injection.
- Enforcement reapplied after `experimental.chat.system.transform` so a plugin
  transform cannot remove it; never a model-controlled tool argument.
- Progressive hybrid: hard immutable policy/config plus prompt/envelope metadata;
  advisory-only post-write detection confined to confidently classified prose.
- Generic source code is never blocked by a language detector in V1; strict
  blocking is deferred to a separately approved policy.
- No translation-model call made solely to enforce the lock; V1 never
  autotranslates and never retrotranslates untouched content.
- One event authority (EventV2) and content-free telemetry per ADR-0001.
- Native-only operator management through the Feature 007 reserved catalog; the
  LLM reads effective policy but never invokes administration.
- Four independent language axes preserved; changing artifact language never
  alters UI locale, product i18n, or conversational prose.

## Considered Options

- **Feature 007 Config.Service policy with permission-gated override, immutable
  post-transform injection, advisory-only progressive detection, EventV2 audit,
  and native-only Feature 007 operator management** — selected: one config
  authority, one event authority, injection that survives the mutable transform,
  no generic-code blocking, and no translation call.
- **A dedicated Lang Lock config store/schema beside Config.Service** — rejected:
  splits config authority and the global/project merge; Config.Service already
  merges global and project sources and supports managed-preference overrides.
- **Lang Lock as a system-prompt string appended before the transform** — rejected:
  the mutable `experimental.chat.system.transform` and the plugin system-array
  contract can strip it; policy must be reapplied after the hook or enforced in
  an immutable request layer.
- **Lang Lock as a model-controlled tool argument on write/edit/apply_patch** —
  rejected: an LLM could relax or omit it; enforcement metadata must be native
  and immutable, never a model-controlled argument.
- **Strict language detection that blocks generic source code in V1** — rejected:
  false-positive risk on mixed and generic code is unbounded until path
  classification, detection, and false-positive benchmarks satisfy an approved
  policy; V1 detection is advisory only.
- **A separate translation-model call to enforce the lock** — rejected: out of
  scope; the effective language is injected so the authoring model produces
  lock-language artifacts directly, and untouched content is never
  retrotranslated.
- **A second Lang Lock event/telemetry channel** — rejected: splits event
  authority; audit and advisory-violation events register through `EventV2.define`
  and export content-free per ADR-0001.
- **A second operator command bus or SDK list for langlock IDs** — rejected: the
  reserved `langlock.*` IDs already live in the Feature 007 reserved catalog
  (`RESERVED_CATALOG_VERSION`); management flows exclusively through Feature 007.

## Decision Outcome

Chosen option: **Feature 007 Config.Service-backed Lang Lock policy with
permission-gated project override, native immutable post-transform prompt and
envelope injection, progressive hybrid enforcement that is advisory-only in V1,
EventV2 content-free audit/telemetry, and native-only Feature 007 operator
management**.

- **Language model and axes.** Lang Lock models four independent axes — UI
  locale/chrome, product/docs i18n pipeline, conversational language, and
  artifact language — and governs only the artifact axis. Changing artifact
  language never alters the other three. The product/feature name is **Lang Lock**,
  enabled by default as English (United States) with canonical internal tag
  `en-US`. Internal tags are canonical BCP 47 values validated via
  `Intl.getCanonicalLocales` plus the allowlist; UI pickers show human/native
  language names and never surface a technical tag as the primary label (C1, C13).
- **Config authority and scope.** Lang Lock policy/config rides the canonical
  Feature 007 Config.Service authority that already merges global and project
  sources; no parallel store is introduced. The `langlock.*` default scope is
  `project`, global is a copy-on-write template, and a project override cannot
  relax the global hard-policy floor. Override is gated by the `langlock.override`
  Permission/Policy authorization and denied unless native operator policy allows
  it. Session, user, LLM, agent, plugin, MCP, and custom-command mutation is
  prohibited (C2).
- **Reserved operator surface.** All Lang Lock management flows exclusively
  through the Feature 007 reserved catalog dotted IDs `langlock.status`,
  `langlock.show`, `langlock.set`, and `langlock.reset`, with the version read
  live from `RESERVED_CATALOG_VERSION` in `@opencode-ai/core/operator`. The
  descriptive **show-effective** label denotes the reserved `langlock.show`
  operation. Adding IDs requires an additive catalog bump, never a second SDK
  list; plugin/MCP/custom registries must not register these reserved IDs, and no
  new operator bus is created (C3).
- **Enforcement points and immutable injection.** Enforcement is native and
  immutable at the seams named in `research.md`: the effective language is
  injected into V1/V2 system prompts and reapplied after
  `experimental.chat.system.transform` (`request.ts`, `agent.ts`) so a plugin
  transform cannot strip it; the injection states the conversational/artifact
  boundary and exemptions. Task/subagent envelopes carry tag/version/source/mode;
  write/edit/apply_patch/shell-commit contexts receive immutable metadata that is
  never a model-controlled tool argument. Shell heredoc/redirect, non-streaming
  tools, legacy plugin output, and MCP output have explicit capability
  boundaries; no enforcement is promised before generated bytes cross an
  OpenCode-observable boundary (C4).
- **Detection mechanics — progressive hybrid, advisory-only in V1.** V1 splits
  hard from advisory: immutable policy/config and prompt/envelope metadata are
  hard requirements; post-write language detection is advisory and confined to
  confidently classified prose kinds (Markdown, docs, instruction files,
  generated commit text). The path-kind classifier, confidence buckets, detector
  provenance, and fallback rules are a plan-owned contract; generic source code
  is never blocked by a detector in V1, and detector unknown/failure never blocks
  prompt, execution, or tool hot paths (C5).
- **Violation handling — advisory record, never block or autotranslate.** V1
  never auto-blocks and never issues a separate translation-model call to enforce
  the lock; advisory detection records only detector provenance, confidence
  bucket, path kind, policy version, and remediation status without content. The
  TUI/App/CLI advisory surfacing, acknowledgement, and repeat-warning-suppression
  flow is a plan-owned bounded, content-free contract that never gates the write.
  Strict blocking is deferred (C6, C14).
- **Repository en-US mandate interplay.** Existing AGENTS/CLAUDE/GROK English
  rules become soft guidance under Lang Lock policy — readable and never
  auto-rewritten. Lang Lock is the hard authority; a nested AGENTS may add style
  but must not replace the effective tag. An unconfigured project resolves to the
  enabled en-US default without translating untouched content (C7).
- **Event and telemetry authority.** Lang Lock introduces no new channel: audit
  and advisory-violation events register via `EventV2.define` in a
  Feature-004-owned schema module and project over the single EventV2 authority,
  mirroring Feature 002 and Feature 003. Audit projects to EventV2 only and is
  secret-free. Telemetry is content-free per ADR-0001 — bounded enums/buckets/
  counts and opaque execution IDs only, never file text, diff, prompt, message,
  path, snippet, reasoning, or tool payload (C8).
- **Feature 005 provenance contract.** Textual OutputSpool/ArtifactStore channels
  attach the Lang Lock tag/version/provenance defined by Feature 005 without
  exporting raw content; the metadata is Feature-005-owned and read from the
  trusted execution envelope, not recomputed by Lang Lock (C9).
- **Feature 002 Todo and envelope inheritance.** Session-owned Todo objective,
  item, progress, result, failure, and handoff summary text follow Lang Lock
  while Todo UI chrome stays on the UI-locale axis. TodoRef/version and Task
  envelopes carry the Lang Lock tag/version, preserved across
  cancel/retry/resume/handoff without a translation call (C10).
- **Long-running policy-change capture.** A lock change captures the effective
  tag and policy version into the execution envelope at start; background,
  resumed, replayed, parent/child, and scheduled executions preserve the
  start-time version so effective policy is immutable for a running execution,
  and the change applies to subsequent executions. The precise mid-flight
  re-resolution policy is deferred to `plan` (C11).
- **Mixed-language file remediation.** Enforcement applies only to model-created
  or modified portions; there is no retrotranslation and no whole-file rewrite to
  satisfy the lock. File-by-file classification and remediation of mixed content
  is advisory-only in V1; deferred strict handling follows the strict-mode
  roadmap (C12).
- **Strict-mode roadmap.** Strict language blocking, path coverage, rollback, and
  false-positive thresholds are deferred to a separately approved policy and a
  future ADR revision, never shipped in V1. V1 delivers immutable metadata plus
  advisory detection only, keeping generic code unblocked (C14).
- **Rollout and legacy migration.** Staged enablement, rollout/feature flags,
  legacy config migration, and compatibility rollback are plan-owned and
  introduce no parallel config or permission authority beyond Feature 007.
  Existing installations resolve to enabled en-US without translating untouched
  files or changing UI/product/conversational settings (C15).
- **Exception manifest.** The exemptions manifest and allowlist (i18n resources,
  vendor/generated files, lockfiles, legal text, external schemas/contracts,
  golden/exact fixtures) are operator-owned, schema-validated, and allowlisted
  before use. Untrusted LLM, plugin, or prompt requests cannot create exemptions;
  exception use records bounded type, authority, scope, and result without
  content, and the review/audit lifecycle rides the Feature 007 audit authority
  (C16).

### V1 decisions accepted with this ADR (Feature 004 clarify package C1–C16)

Declarative clarify resolutions (Session 2026-07-18); full matrices live in
Feature 004 `spec.md` Clarifications. Numeric thresholds, classifier internals,
and UX details this feature defers are provisional plan constants with named
acceptance hooks, never open placeholders:

1. **Artifact-language scope boundary.** Governs only model-authored prose
   surfaces (FR8–FR9, FR12); never identifiers, filenames, API names, syntax,
   symbols, or quoted user content, and never the other three axes. Hooks AC1–AC2,
   AC12 (C1).
2. **Config authority and scope.** Feature 007 Config.Service; `langlock.*`
   default scope `project`; global copy-on-write template; project override
   cannot relax the hard-policy floor; `langlock.override` permission-gated. Hooks
   AC5–AC6 (C2).
3. **Reserved operator surface.** Reserved catalog IDs `langlock.status|show|set|
   reset`; version live from `RESERVED_CATALOG_VERSION`; additive bump only; no
   second SDK list. Hook AC13 (C3).
4. **Enforcement points and immutable injection.** V1/V2 system-prompt injection
   reapplied after `experimental.chat.system.transform`; envelope tag/version/
   source/mode; native immutable write/edit/apply_patch/shell-commit metadata;
   explicit capability boundaries. Hooks AC4, AC7, AC18 (C4).
5. **Detection mechanics.** Progressive hybrid; advisory-only; confined to
   confidently classified prose; generic code never blocked; unknown/failure
   never blocks hot paths. Hook AC11 (C5).
6. **Violation handling.** Advisory record only; never block; never autotranslate;
   content-free acknowledgement/repeat-warning flow. Hook AC8 (C6).
7. **Repository en-US mandate.** Soft AGENTS/CLAUDE/GROK guidance; Lang Lock is
   the hard authority; unconfigured project resolves to en-US default. Hooks AC16,
   AC17 (C7).
8. **Event and telemetry authority.** Single EventV2 authority; content-free per
   ADR-0001; bounded enums/buckets/counts and opaque IDs only. Hook AC14 (C8).
9. **Feature 005 provenance.** Feature-005-owned tag/version/provenance on textual
   channels; read from the envelope, not recomputed. Hook AC14 (C9).
10. **Feature 002 Todo and envelope inheritance.** Todo text follows Lang Lock;
    Todo UI chrome does not; TodoRef/Task envelopes carry tag/version across
    cancel/retry/resume/handoff without a translation call. Hooks AC21–AC22 (C10).
11. **Long-running policy-change capture.** Start-time tag/version captured into
    the envelope; immutable for a running execution; mid-flight re-resolution
    deferred to `plan`. Hook AC12 (C11).
12. **Mixed-language file remediation.** Only model-created/modified portions;
    no retrotranslation; advisory-only classification in V1. Hooks AC11, AC20 (C12).
13. **Picker label localization.** Human/native names only; canonical BCP 47 tags
    validated and stored, never surfaced as the primary label. Hook AC3 (C13).
14. **Strict-mode roadmap.** Strict blocking, path coverage, rollback, and
    false-positive thresholds deferred to a separately approved policy; V1 is
    metadata plus advisory only. Hook AC11 (C14).
15. **Rollout flags and legacy migration.** Staged enablement, rollout flags,
    legacy migration, and rollback plan-owned; no parallel authority; en-US
    default without translating untouched files. Hook AC16 (C15).
16. **Exception manifest ownership and lifecycle.** Operator-owned,
    schema-validated, allowlisted; untrusted requests cannot create exemptions;
    content-free exception records; audit rides Feature 007. Hooks AC9–AC10 (C16).

This ADR is **proposed**; it is the required decision record that unblocks
Feature 004 `plan`/`tasks`. ADR-0001 and ADR-0002 remain proposed; ADR-0003 is
accepted; ADR-0004 is proposed.

### Consequences

#### Positive

- One config/policy authority, one event authority, and one operator management
  surface; no parallel config store, event channel, or command bus.
- Enforcement survives the mutable `experimental.chat.system.transform` and is
  never a model-controlled tool argument, resisting prompt injection.
- V1 improves artifact-language consistency without false-blocking generic source
  code and without any translation-model call.
- The four language axes stay independent; conversational, UI-locale, and product
  i18n behavior are unchanged.
- Audit and telemetry are content-free per ADR-0001; the reserved `langlock.*`
  surface closes LLM/plugin/MCP/prompt administration paths.

#### Trade-offs

- Strict language blocking, path coverage, rollback, and false-positive
  thresholds are deferred to a separately approved policy; V1 delivers immutable
  metadata plus advisory detection only.
- Enforcement is only promised where generated bytes cross an OpenCode-observable
  boundary; shell heredoc/redirect, non-streaming tools, legacy plugin output,
  and MCP output have explicit capability gaps.
- Confidence thresholds, path-kind classifier internals, advisory-UX details, and
  the mid-flight re-resolution policy remain provisional plan constants with named
  acceptance hooks, fixed in the tasks phase.
- Advisory-only detection means a mislabeled artifact may pass V1 without a hard
  failure until strict mode is separately approved.

#### Follow-ups

- Feature 004 `plan`/`tasks` implement the schema/protocol modules, the
  framework-free detection/policy domain, the immutable injection seams, the
  advisory detection surface, and the Feature 007 `langlock.*` domain impls.
- Strict-mode blocking requires a separate policy decision and an ADR revision
  before any generic-code enforcement.
- The mid-flight policy-change re-resolution rule and the advisory-UX
  acknowledgement flow require plan-phase contracts with named acceptance hooks.

## Related

- Feature specification: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Feature research: [004 research](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/research.md)
- Feature plan: [004 plan](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/plan.md)
- Routing/telemetry dependency: [001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Lifecycle/Todo dependency: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Scheduled-execution dependency: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Content-plane feature: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0004 — Scheduled Job Runtime and Async Notification Channel](0004-scheduled-job-runtime-and-async-notification-channel.md)
</content>
</invoke>
