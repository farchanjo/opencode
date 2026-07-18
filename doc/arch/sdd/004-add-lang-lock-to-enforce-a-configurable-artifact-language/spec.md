---
id: 019f6d98-1380-7213-b3e5-9e742d5824a5
number: 004
slug: add-lang-lock-to-enforce-a-configurable-artifact-language
status: clarified
created_at: 2026-07-17T01:01:50.848332Z
---

# Feature Specification: Lang Lock

Feature: 004-add-lang-lock-to-enforce-a-configurable-artifact-language
Created: 2026-07-17

## Scope and intent

Lang Lock enforces a configured language for new or modified model-generated
artifacts and internal instructions while preserving the conversational language of
the main chat. It is enabled by default as **English (United States)** (`en-US`) and
uses progressive hybrid enforcement in V1.

Four independent language axes are mandatory: existing UI locale/chrome, existing
product/docs locale pipeline, conversational language for main-chat prose, and artifact
language controlled by Lang Lock. Changing Lang Lock does not change UI locale,
product localization, session title/compaction language, or conversational language.

## User Stories

### P1 — Consistent artifacts without changing conversation

- As a user speaking any language, I want code, documentation, Task prompts, Todo
  objective/item/progress/result/failure/handoff text, and other model-authored
  artifacts to follow Lang Lock while main-chat prose follows me and UI chrome remains
  on the UI locale axis.
- As a project operator, I want one effective artifact language inherited by parent,
  agent, and subagent execution so that delegation cannot silently change it.
- As a maintainer, I want explicit exemptions for i18n, legal, vendor, external, and
  exact/golden content so that language enforcement does not corrupt contracts.

### P1 — Policy integrity and native management

- As an operator, I want global policy to be the base authority and project override
  only when authorized so that users, models, plugins, MCP, and nested instructions
  cannot relax the lock.
- As an operator, I want native Settings/palette/slash/CLI management that works
  offline and outside LLM transcripts/tools.

### P1 — Progressive enforcement and audit

- As a maintainer, I want immutable prompt/envelope metadata plus bounded advisory
  validation so that V1 improves consistency without false-blocking generic code.
- As an operator, I want content-free audit and telemetry so that violations and
  configuration can be diagnosed without exporting artifacts or prompts.

## Functional Requirements

### Language model and configuration

1. The product/feature name MUST be **Lang Lock** and it MUST be enabled by default as
   **English (United States)** with canonical internal tag `en-US`.
2. Lang Lock MUST model four independent axes: UI locale/chrome, product/docs locale
   pipeline, conversational language, and artifact language. Changing artifact
   language MUST NOT alter the other three.
3. The initial allowlist MUST contain: English (United States) `en-US`, English
   (Canada) `en-CA`, English (United Kingdom) `en-GB`, English (Australia) `en-AU`,
   Português (Brasil) `pt-BR`, Español (España) `es-ES`, Español (México) `es-MX`,
   and Español (Argentina) `es-AR`.
4. Internal tags MUST be canonical BCP 47 values validated with
   `Intl.getCanonicalLocales` and the allowlist. UI pickers MUST show human/native
   names and MUST NOT expose technical tags, charset terminology, or locale slugs as
   the primary label.
5. Global configuration MUST be the base authority. Project override MAY apply only
   when native operator policy authorizes `langlock.override`. Global hard policy MUST
   not be relaxed below its configured floor.
6. Session settings, user prompts, LLMs, agents, subagents, plugins, MCP, custom
   commands, nested AGENTS, and soft repository prompts MUST NOT alter or relax the
   effective artifact language.
7. Effective configuration MUST expose enabled state, canonical tag, display name,
   scope, source/origin, policy version, enforcement mode, and authorized override
   state without content.

### Locked artifacts and exemptions

8. Lang Lock MUST apply to new or modified model-authored source-code prose, comments,
   docstrings, generated explanations, and domain/internal prose strings that are not
   i18n resources or external contracts.
9. Lang Lock MUST apply to documentation, README, plans, specs, ADRs,
   AGENTS/CLAUDE/GROK/CONTEXT, runbooks, model-created skills, agent/system
   instructions, Task/subagent prompts and internal returns, **Todo objective, item
   content, progress summaries, result/failure text, and handoff Todo summaries**,
   commit messages, PR titles/descriptions, release notes, config prose, test
   descriptions, non-exact fixture prose, artifact summaries, code fences/patch
   previews, and model-authored scheduled-job/workflow templates. UI chrome labels,
   buttons, and locale chrome remain on the UI locale axis and MUST NOT be forced to
   the artifact language by Lang Lock.
10. Enforcement MUST apply only to model-created or modified portions. It MUST NOT
    retrotranslate untouched repository content or rewrite an entire mixed-language
    file solely to satisfy the lock.
11. Main assistant prose outside artifact content/code fences MUST follow the
    conversational language. Session title, compaction, context summary, and chat
    metadata remain conversational and MUST NOT weaken artifact enforcement.
12. Code, patch previews, and artifact summaries displayed inside chat MUST follow
    Lang Lock even when surrounding conversational prose uses another language.
13. Quoted user content MUST remain literal. Syntax, keywords, identifiers, filenames,
    symbols, API names, and proper nouns are exempt.
14. i18n locale resources and explicit translation tasks MUST use their target locale
    under an explicit audited special mode. Vendor/generated files, lockfiles,
    licenses/legal text, external schemas/contracts, golden fixtures/snapshots, and
    exact strings MUST be preserved.
15. Existing custom skill and MCP instructions MUST be read without automatic
    translation. New content written by a model into a skill/instruction follows Lang
    Lock. User-facing product copy uses the product/i18n target when one exists and
    otherwise uses Lang Lock.

### Progressive hybrid enforcement V1

16. V1 enforcement MUST be progressive hybrid: immutable policy/config and prompt/
    execution metadata are hard requirements; post-write language detection is
    advisory for reliable prose/path kinds.
17. Effective artifact language MUST be injected into V1 and V2 system prompts for
    every primary agent, agent, and subagent after plugin/system transforms so the
    transform cannot remove it. The injection MUST state the conversational/artifact
    boundary and exemptions.
18. Task wrappers and structured execution envelopes MUST carry effective language,
    policy version, source, and enforcement mode. Parent-created Task/subagent prompts
    and subagent internal returns MUST use the lock language without a separate
    translation-model call.
19. Write/edit/apply_patch/shell commit/custom generation contexts MUST receive native
    immutable Lang Lock metadata; it MUST NOT be a model-controlled tool argument.
20. Advisory post-write validation MUST be limited to confidently classified prose
    artifacts such as Markdown, docs, instruction files, and generated commit text.
    Generic source code MUST NOT be blocked by a language detector in V1.
21. Advisory detection MUST record detector provenance, confidence bucket, path kind,
    policy version, and remediation status without content. Unknown/failure MUST not
    block prompt, execution, or tool hot paths.
22. Strict blocking MUST remain future/clarification until path classification,
    language detection, and false-positive benchmarks satisfy an approved policy.
23. Shell heredoc/redirect, non-streaming tools, legacy plugin output, and MCP output
    MUST have explicit capability boundaries. The system MUST NOT promise enforcement
    before generated bytes cross an OpenCode-observable boundary.

### Precedence, replay, and integration

24. Authorized Lang Lock policy MUST outrank soft repository language conventions.
    Hard external/legal/i18n exact contracts remain exempt. Nested AGENTS MAY add style
    but MUST NOT replace effective artifact language.
25. A user/model instruction to ignore Lang Lock MUST have no configuration effect.
    `experimental.chat.system.transform` MUST not remove enforcement; policy MUST be
    reapplied after the hook or enforced in an immutable request layer.
26. Background, resumed, replayed, parent/child, and scheduled executions MUST capture
    effective tag and policy version in their execution envelope. Handoff MUST preserve
    them without permission elevation.
27. Feature 001 manager/agents and native management MUST inherit Lang Lock; telemetry
    follows ADR-0001 content-free constraints.
28. Feature 002 Task/process envelopes MUST carry language tag/version; Process Table
    MAY show only allowlisted tag/display name and provenance. Cancel/retry/resume and
    handoff MUST preserve the lock. Feature 002 session-owned Todo objective/item/
    progress/result/failure/handoff text MUST follow Lang Lock; Todo UI chrome MUST
    not. TodoRef/version envelopes MUST carry Lang Lock tag/version with the Todo
    summary.
29. Feature 003 scheduled definitions/occurrences MUST inherit effective policy, and
    model-authored prompts/workflows and occurrence Todo text MUST follow it.
    Scheduled administration remains operator-only.
30. [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) SHOULD attach language tag/provenance
    to textual output metadata without exporting raw content to telemetry.

### Native operator management

**Normative transversal rule (Feature 007 Operator Control Plane).** All setup,
configuration, and management for Lang Lock MUST use
[Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
unified Operator Control Plane and native Settings/menu/palette/native-slash/CLI/App/
Desktop adapters calling typed core domain commands/queries directly. MUST NOT use
Config.command/custom templates, `session.command` prompt path, ToolRegistry, MCP
tools/prompts, plugins, skills, shell commands issued by an LLM, or free-form model
instructions as management authority. Native slash is intercepted before prompt
admission/transcript; zero provider/model calls/tokens/cost by default; output not
added to Message/Part/context by default. Mutations require operator principal,
explicit scope, version/CAS, idempotency, and audit; secret refs only. Canonical
reserved dotted IDs are `langlock.status`, `langlock.show`, `langlock.set`, and
`langlock.reset` from Feature 007 reserved catalog v1 (`RESERVED_CATALOG_VERSION`,
`@opencode-ai/core/operator`); the descriptive **show-effective** label denotes the
reserved `langlock.show` operation (C3). Plugin/MCP/custom registries MUST
NOT register reserved operator IDs. LLM receives effective read-only Lang Lock in the
trusted execution envelope; it MUST NOT call admin commands to query or set.

31. Settings MUST expose a row separate from UI Language, labeled **Lang Lock** with
    **Artifact language**, using human/native language names, wired through Feature 007
    adapters.
32. Native palette/slash/CLI operations MUST provide the Feature 007 reserved catalog v1
    langlock operations `langlock.status`, `langlock.show`, `langlock.set`, and
    `langlock.reset`; the **show-effective** display alias maps to `langlock.show`, and
    the reserved dotted IDs and catalog version are the Feature 007 authority (C3).
33. Administrative operations MUST parse/dispatch locally via the Feature 007 operator
    command registry, remain outside transcript, ToolRegistry, MCP, tools, and prompts,
    make zero LLM calls, and work offline without a configured provider.
34. Mutations MUST require explicit authorized scope, be atomic/idempotent within the
    canonical config authority (CAS/idempotency per Feature 007), publish audit events,
    and return effective value, scope, origin, and policy version.
35. LLMs/agents MAY read only effective immutable language metadata in their execution
    context. They MUST NOT invoke administrative commands or mutate configuration.

## Non-Functional Requirements

- **Policy integrity:** effective language and version MUST be immutable for a model
  execution and resistant to user/plugin/MCP/nested-instruction prompt injection.
- **Parity:** V1/V2, primary/agent/subagent, foreground/background/resume/scheduled,
  and native management surfaces MUST resolve the same effective policy.
- **Availability:** enforcement metadata and native commands MUST work offline; detector
  failure MUST not break model/tool hot paths.
- **Precision:** advisory detection MUST expose confidence/provenance and avoid generic
  source-code blocking until strict mode is separately approved.
- **Privacy:** audit/telemetry MUST never include file text, diffs, prompts, messages,
  paths, snippets, reasoning, tool payloads, or translated content.
- **Compatibility:** existing UI/product locales, conversational behavior, i18n
  pipeline, external contracts, exact fixtures, and repository content remain intact.

## Acceptance Criteria

1. **Portuguese chat, English artifacts.** Given pt-BR conversation and en-US lock,
   when the main assistant responds and delegates, then chat prose is Portuguese while
   code/docs/code fences/Task prompt/internal return are English.
2. **English chat, Portuguese artifacts.** Given English conversation and pt-BR lock,
   when artifacts are generated, then chat prose is English and artifacts are
   Portuguese.
3. **Initial variants.** Given each of the eight initial choices, when selected by its
   human/native name, then the canonical internal tag is stored and no technical tag is
   used as the primary picker label.
4. **Subagent inheritance.** Given parent effective policy, when a child Task is
   created, then prompt, execution envelope, artifact, and internal return inherit tag
   and version without a translation call.
5. **Project override denied.** Given global hard policy and unauthorized project
   override, when config resolves, then override is rejected and global value remains.
6. **Project override allowed.** Given operator policy permits project override, when
   it changes, then effective scope/origin/version are audited and sessions/prompts
   cannot relax it.
7. **Prompt/plugin resistance.** Given user, nested AGENTS, or system-transform plugin
   attempts to remove the lock, when request assembly completes, then immutable Lang
   Lock remains effective after transforms.
8. **Docs/comments/commit.** Given a model writes docs, comments, or commit prose, when
   output is produced, then modified prose follows the lock and advisory validation is
   recorded where supported.
9. **i18n exception.** Given an explicit es-MX translation task under en-US lock, when
   target locale resources are written, then es-MX prevails under audited special mode.
10. **Literal preservation.** Given quoted user content, external schema, license, or
    exact/golden fixture, when surrounding artifacts change, then exempt content is
    preserved literally.
11. **Mixed source advisory.** Given mixed-language source code, when V1 validates it,
    then generic code is not blocked and no false strict failure is asserted.
12. **Background/replay/scheduled.** Given policy version captured at start, when a
    Task resumes, replays, runs in background, or is scheduled, then tag/version are
    preserved according to the unresolved long-running-change policy.
13. **Offline commands.** Given no provider/network, when native status/set/reset/
    show-effective runs, then it uses local config, makes zero LLM calls, and stays out
    of the transcript/tool catalog.
14. **Content-free telemetry.** Given enforcement and advisory violations, when OTEL
    exports, then only bounded policy metadata/counts/confidence buckets are present.
15. **V1/V2 parity.** Given equivalent primary/agent/subagent requests in V1 and V2,
    when system prompts/envelopes are built, then both carry the same effective lock.
16. **Existing project migration.** Given an existing project with no Lang Lock config,
    when the feature activates, then effective default is enabled en-US without
    translating untouched content.
17. **Nested AGENTS conflict.** Given nested instructions request another artifact
    language, when they are loaded, then style guidance applies but language does not
    override effective policy.
18. **Legacy skill/MCP boundary.** Given existing custom skill or MCP instructions in
    another language, when loaded, then they remain literal; new model-authored content
    follows the lock where OpenCode observes the write boundary.
19. **Conversational metadata.** Given artifact language differs from conversation,
    when title or compaction is generated, then it remains conversational and cannot
    weaken subsequent artifact policy.
20. **Untouched content.** Given a model edits one section of a mixed-language file,
    when the patch applies, then only new/modified prose is subject to Lang Lock.
21. **Todo text under Lang Lock.** Given a goal-bearing Session with a non-en-US
    conversational language and en-US Lang Lock, when Todo objective, item content,
    progress, result, failure, or handoff summary text is written, then those texts
    follow Lang Lock while UI chrome labels remain on the UI locale axis.
22. **Todo handoff summary language.** Given a parent/child handoff envelope, when
    the bounded authorized Todo summary is attached, then summary text follows Lang
    Lock and tag/version travel with the envelope without translating UI chrome.

## Security Requirements

1. `langlock.override` MUST use canonical Permission/Policy authorization. Project
   override is denied unless native operator policy explicitly allows it; session,
   user, LLM, agent, plugin, MCP, and custom-command mutation is prohibited.
2. Canonical BCP 47 tags, scopes, origins, path kinds, detector results, and exception
   modes MUST be schema-validated and allowlisted before use.
3. Effective lock metadata MUST be immutable in model/tool execution contexts and
   reapplied after mutable plugin system transforms.
4. Native administration MUST be operator-only, local, audited, transcript-isolated,
   and absent from ToolRegistry/MCP/model tools.
5. Audit and telemetry MUST exclude content, diffs, prompts, user messages, paths,
   snippets, reasoning, tool payloads, secrets, and exact exception data.
6. Exception use MUST record bounded type, authority, scope, and result without content;
   untrusted LLM/plugin requests cannot create exemptions.

## Observability

Lang Lock integrates with Feature 001 and ADR-0001 without exporting content.
Telemetry MAY record enabled state, allowlisted canonical tag, scope/source,
policy/config version, path-kind enum, enforcement mode, advisory violation count,
confidence bucket, exception category, and bounded agent/model IDs when permitted.

Metrics use bounded enums/buckets and MUST NOT use session, task, process, file, or
path IDs as labels. Logs/spans may correlate opaque execution IDs but never include
file text, diff, prompt, message, path, snippet, reasoning, or tool payload. Detector
failure/unknown and policy-reapply outcomes are observable without blocking hot paths.

## Compatibility and Migration

- Existing installations with no Lang Lock config resolve to enabled en-US.
- Migration MUST add policy/config metadata without translating untouched files or
  changing UI/product locale and conversational settings.
- Existing AGENTS/CLAUDE/GROK English conventions become soft guidance under Lang
  Lock policy; they remain readable and are not automatically rewritten.
- V1/V2 request assembly, Task/subagent, AgentV2/SkillV2, Feature 001/002/003,
  write/edit/apply_patch/shell, MCP/plugin, and [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) seams
  require phased integration without parallel config or permission authorities.
- Rollout/feature flags, legacy config handling, long-running policy changes, and
  strict-mode migration remain clarification items.

## Out of Scope

- Translating main-chat prose to artifact language.
- Translating untouched existing repositories wholesale.
- Strict language detection/blocking for generic source code in V1.
- Automatically changing identifiers, filenames, APIs, syntax, or symbols.
- Translating vendor/generated/lockfile/legal/external/golden/exact content.
- Exposing administration to LLMs, tools, MCP, plugins, or custom prompt commands.
- Inferring artifact language implicitly from UI locale.
- Supporting every BCP 47 locale in V1.
- Separate translation-model calls solely to enforce Lang Lock.

## Clarification Questions

1. What path-kind classifier, confidence thresholds, provenance, and fallback rules
   determine advisory eligibility?
2. What advisory UX, remediation flow, acknowledgement, and repeat-warning policy
   applies in TUI/App/CLI?
3. What exact product-string policy applies outside an explicit i18n target?
4. How does a lock change affect running Task/session/background/replay/scheduled
   execution and policy-version capture?
5. What enforcement boundary applies to shell heredoc/redirect, non-streaming tools,
   legacy plugin output, and MCP output?
6. What project authorization/role model owns `langlock.override`, including operator
   principal and managed/global policy?
7. What benchmarks, path coverage, rollback, and false-positive requirements define
   the strict-mode roadmap?
8. How are picker labels localized while preserving agreed native/human language-name
   policy details?
9. How is file-by-file mixed-language content classified and remediated without
   retrotranslation?
10. Who owns the exceptions manifest/allowlist, and what review/audit lifecycle applies?
11. What language metadata/provenance contract integrates with
    [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)?
12. What rollout flags, legacy config migration, staged enablement, and compatibility
    rollback apply?

## Related Features and Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 003 Scheduled Jobs and Async Main-Context Notification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — multilingual query vs Lang Lock artifact language
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — langlock command IDs, auth, audit; sole management authority
- [Feature 008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP content external LangLock exemption; model-generated artifacts still obey LangLock
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003 Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed
- [Feature 004 research](research.md) — evidence only, not a decision.

## Initial Traceability Matrix

| Outcome                                | Requirements                  | Acceptance scenarios | Phase |
| -------------------------------------- | ----------------------------- | -------------------- | ----- |
| Independent language axes and variants | FR1–FR7                       | 1–3, 5–6, 16, 19     | 1     |
| Locked artifacts and exemptions        | FR8–FR15                      | 1–2, 8–11, 17–22     | 1     |
| Todo text under Lang Lock              | FR9, FR28–FR29                | 21–22                | 1–2   |
| Progressive hybrid enforcement         | FR16–FR23                     | 4, 7–8, 11, 15, 18   | 1     |
| Replay and feature inheritance         | FR24–FR30                     | 4, 7, 12, 15, 17–19  | 1–2   |
| Native operator management             | FR31–FR35                     | 3, 5–6, 13           | 1–2   |
| Security/privacy/observability         | NFRs, security, observability | 7, 9–10, 13–14, 18   | 1–2   |

## Clarifications

### Session 2026-07-18

Declarative resolutions for the Feature 004 clarify phase. Each decision closes one or
more Clarification Questions (CQ) or brief scope items above without reopening confirmed
Feature 001 immutable-envelope gates, Feature 002 lifecycle/Todo authority, Feature 005
content-plane ownership, or Feature 007 native-only operator authority and reserved
catalog. Numeric thresholds, classifier internals, and UX details that this feature
intentionally defers are resolved here as explicit deferrals to `plan` and to the future
ADR **Lang Lock Artifact-Language Policy and Progressive Enforcement**, each with a
provisional stance and a named acceptance-test hook — never as open placeholders. This
section fixes the decisions the ADR will formalize; it does not author the ADR.

**C1 — Artifact-language scope boundary (CQ3).** "Artifact language" governs only
model-created or modified prose surfaces enumerated in FR8–FR9: source-code prose,
comments, docstrings, generated explanations, docs, instruction files, Task/subagent
prompts and internal returns, Todo objective/item/progress/result/failure/handoff text,
commit/PR/release prose, and code fences/patch previews shown in chat (FR12). It NEVER
governs identifiers, filenames, API names, syntax, symbols, or quoted user content
(FR13), and NEVER the other three axes — UI locale/chrome, product/docs i18n pipeline,
or conversational main-chat prose (FR2, FR11). Exact product strings outside an explicit
i18n target follow Lang Lock; strings owned by the i18n pipeline use the product target
(FR15). Acceptance hooks AC1–AC2, AC12.

**C2 — Config authority and scope model (CQ6, part CQ12).** Lang Lock policy/config rides
the canonical Feature 007 Config.Service authority that already merges global and
project sources (research.md `config.ts`); no parallel store is introduced. Per the
Feature 007 scope matrix the `langlock.*` default scope is `project`, global is a
copy-on-write template, and a project override cannot relax the global hard-policy floor
(FR5). Override is gated by the `langlock.override` Permission/Policy authorization and is
denied unless native operator policy allows it (Security 1, AC5–AC6). Session, user, LLM,
agent, plugin, MCP, and custom-command mutation is prohibited (FR6).

**C3 — Reserved operator command surface and catalog version.** All Lang Lock management
flows exclusively through Feature 007 reserved catalog v1 dotted IDs `langlock.status`,
`langlock.show`, `langlock.set`, and `langlock.reset`, with the version read live from
`RESERVED_CATALOG_VERSION` (`1.0.0`) in `@opencode-ai/core/operator`; adding IDs requires
an additive catalog bump, never a second SDK list. The spec's descriptive
**show-effective** label denotes the reserved `langlock.show` operation. Plugin/MCP/custom
registries MUST NOT register these reserved IDs, and no new operator bus or registry is
created (FR31–FR35, AC13).

**C4 — Enforcement points and immutable injection (CQ5).** Enforcement is native and
immutable at the seams named in research.md: effective language is injected into V1/V2
system prompts and reapplied after `experimental.chat.system.transform`
(`request.ts`, `agent.ts`) so a plugin transform cannot strip it (FR17, FR25, AC7);
Task/subagent envelopes carry tag/version/source/mode (FR18, AC4); write/edit/apply_patch/
shell-commit contexts receive immutable metadata that is never a model-controlled tool
argument (FR19). Shell heredoc/redirect, non-streaming tools, legacy plugin output, and
MCP output have explicit capability boundaries; no enforcement is promised before
generated bytes cross an OpenCode-observable boundary (FR23, AC18).

**C5 — Detection mechanics: progressive hybrid, advisory-only in V1 (CQ1, part CQ7).**
V1 splits hard from advisory: immutable policy/config and prompt/envelope metadata are
hard requirements; post-write language detection is advisory and confined to confidently
classified prose kinds (Markdown, docs, instruction files, generated commit text)
(FR16, FR20). The path-kind classifier, confidence buckets, detector provenance, and
fallback rules are a plan-owned contract with acceptance hook AC11; generic source code
is never blocked by a detector in V1 (FR20, Out of Scope). Detector unknown/failure never
blocks prompt, execution, or tool hot paths (FR21, NFR Availability).

**C6 — Violation handling: advisory record, never block or autotranslate (CQ2).** V1 never
auto-blocks and never issues a separate translation-model call to enforce the lock (Out of
Scope); advisory detection records only detector provenance, confidence bucket, path kind,
policy version, and remediation status without content (FR21). The TUI/App/CLI advisory
surfacing, acknowledgement, and repeat-warning-suppression flow is a plan-owned bounded,
content-free contract with acceptance hook AC8; it never gates the write. Strict blocking
is deferred (C14).

**C7 — Interplay with the repository en-US mandate.** Existing AGENTS/CLAUDE/GROK English
rules (research.md) become soft guidance under Lang Lock policy — readable and never
auto-rewritten (Compatibility). Lang Lock is the hard authority; a nested AGENTS MAY add
style but MUST NOT replace the effective tag (FR24, AC17). An unconfigured project resolves
to the enabled en-US default, matching the repository mandate, without translating
untouched content (FR1, AC16).

**C8 — Event and telemetry emission over the single EventV2 authority (CQ10, part CQ11).**
Lang Lock introduces no new channel: audit and advisory-violation events register via
`EventV2.define` in a Feature-004-owned schema module and project over the single EventV2
authority, mirroring Feature 002 C2 and Feature 003. Audit projects to EventV2 only and is
secret-free (Feature 007). Telemetry is content-free per ADR-0001 — bounded enums/buckets/
counts and opaque execution IDs only, never file text, diff, prompt, message, path,
snippet, reasoning, or tool payload (NFR Privacy, Observability, AC14).

**C9 — Feature 005 provenance contract (CQ11).** Textual OutputSpool/ArtifactStore channels
SHOULD attach the Lang Lock tag/version/provenance defined by Feature 005 FR40 without
exporting raw content; the metadata is Feature-005-owned and read from the trusted
execution envelope, not recomputed by Lang Lock (FR30, AC14).

**C10 — Feature 002 Todo and envelope inheritance.** Session-owned Todo objective, item,
progress, result, failure, and handoff summary text follow Lang Lock while Todo UI chrome
stays on the UI-locale axis (FR28, AC21–AC22). TodoRef/version and Task envelopes carry
the Lang Lock tag/version, preserved across cancel/retry/resume/handoff without a
translation call (FR26, FR28, AC4, AC22).

**C11 — Long-running policy-change capture (CQ4).** A lock change captures the effective
tag and policy version into the execution envelope at start; background, resumed, replayed,
parent/child, and scheduled executions preserve the start-time version so effective policy
is immutable for a running execution, and the change applies to subsequent executions
(FR26, NFR Policy integrity). The precise mid-flight re-resolution policy is deferred to
`plan` with acceptance hook AC12.

**C12 — Mixed-language file remediation (CQ9).** Enforcement applies only to model-created
or modified portions; there is no retrotranslation and no whole-file rewrite to satisfy
the lock (FR10, AC20). File-by-file classification and remediation of mixed content is
advisory-only in V1 under C5; deferred strict handling follows the strict-mode roadmap
(C14). Acceptance hook AC11.

**C13 — Picker label localization (CQ8).** UI pickers show human/native language names
only; canonical BCP 47 tags validated via `Intl.getCanonicalLocales` plus the allowlist
are stored and never surfaced as the primary label (FR4, AC3). Label-localization details
that preserve the native/human-name policy are a plan/UX contract with acceptance hook
AC3.

**C14 — Strict-mode roadmap ownership (part CQ7).** Strict language blocking, path
coverage, rollback, and false-positive thresholds are deferred to a separately approved
policy and the future ADR, never shipped in V1 (FR22, Out of Scope). V1 delivers immutable
metadata plus advisory detection only (C5), keeping generic code unblocked (AC11).

**C15 — Rollout flags and legacy migration (part CQ12).** Staged enablement, rollout/
feature flags, legacy config migration, and compatibility rollback are plan-owned with
acceptance hook AC16, introducing no parallel config or permission authority beyond
Feature 007. Existing installations resolve to enabled en-US without translating untouched
files or changing UI/product/conversational settings (Compatibility).

**C16 — Exception manifest ownership and lifecycle (CQ10).** The exemptions manifest and
allowlist (i18n resources, vendor/generated files, lockfiles, legal text, external
schemas/contracts, golden/exact fixtures) are operator-owned and schema-validated and
allowlisted before use (FR14, Security 2, Security 6). Untrusted LLM, plugin, or prompt
requests cannot create exemptions; exception use records bounded type, authority, scope,
and result without content (Security 6, AC9–AC10). The review/audit lifecycle rides the
Feature 007 audit authority.

