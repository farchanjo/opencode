# Lang Lock Research

Feature: [004 Lang Lock](spec.md)

This note records current-core evidence separately from requirements and confirmed
product decisions. It is not an ADR and does not authorize implementation.

## Existing language and localization axes

- App UI locale has its own closed locale type, dictionaries, BCP-like Intl mapping,
  detection, and persistence at
  [`packages/app/src/context/language.tsx:9-30`](../../../../packages/app/src/context/language.tsx#L9-L30),
  [`packages/app/src/context/language.tsx:37-77`](../../../../packages/app/src/context/language.tsx#L37-L77),
  and [`packages/app/src/context/language.tsx:165-180`](../../../../packages/app/src/context/language.tsx#L165-L180).
- Desktop has a separate locale detection/persistence path at
  [`packages/desktop/src/renderer/i18n/index.ts:80-105`](../../../../packages/desktop/src/renderer/i18n/index.ts#L80-L105)
  and [`packages/desktop/src/renderer/i18n/index.ts:140-187`](../../../../packages/desktop/src/renderer/i18n/index.ts#L140-L187).
- Product/docs translation is a separate pipeline. The translation script declares
  English source dictionaries and target-locale behavior at
  [`script/translate-app.md:1-14`](../../../../script/translate-app.md#L1-L14).
- CLAUDE and GROK currently contain soft repository guidance to persist artifacts in
  English at [`CLAUDE.md:52-55`](../../../../CLAUDE.md#L52-L55) and
  [`GROK.md:65-68`](../../../../GROK.md#L65-L68). These are instructions, not a hard
  artifact-language config authority.

## Config, prompt, agent, and instruction evidence

- Config loading merges global and local/project sources in sequence and supports
  managed-preference overrides at
  [`packages/opencode/src/config/config.ts:248-270`](../../../../packages/opencode/src/config/config.ts#L248-L270),
  [`packages/opencode/src/config/config.ts:398-429`](../../../../packages/opencode/src/config/config.ts#L398-L429),
  and [`packages/opencode/src/config/config.ts:524-563`](../../../../packages/opencode/src/config/config.ts#L524-L563).
  No `artifactLanguage`/`artifact_language` schema field was found in the current
  packages search.
- V2 prompt assembly combines environment, instruction files, MCP instructions, and
  skills before model processing at
  [`packages/opencode/src/session/prompt.ts:1255-1286`](../../../../packages/opencode/src/session/prompt.ts#L1255-L1286).
- Instruction discovery reads global/project AGENTS, CLAUDE, CONTEXT, configured files,
  and URLs at
  [`packages/opencode/src/session/instruction.ts:60-68`](../../../../packages/opencode/src/session/instruction.ts#L60-L68)
  and [`packages/opencode/src/session/instruction.ts:110-168`](../../../../packages/opencode/src/session/instruction.ts#L110-L168).
- Request preparation invokes mutable `experimental.chat.system.transform` after
  building the system array at
  [`packages/opencode/src/session/llm/request.ts:56-78`](../../../../packages/opencode/src/session/llm/request.ts#L56-L78).
  Agent generation also invokes that hook at
  [`packages/opencode/src/agent/agent.ts:368-382`](../../../../packages/opencode/src/agent/agent.ts#L368-L382).
- The plugin contract permits modification of system arrays and message arrays at
  [`packages/plugin/src/index.ts:282-296`](../../../../packages/plugin/src/index.ts#L282-L296).
- TaskTool accepts model-authored description/prompt/subagent type and creates child/
  background work at
  [`packages/opencode/src/tool/task.ts:44-60`](../../../../packages/opencode/src/tool/task.ts#L44-L60)
  and [`packages/opencode/src/tool/task.ts:197-235`](../../../../packages/opencode/src/tool/task.ts#L197-L235).
- SkillV2 discovers Markdown/SKILL.md content and applies canonical skill permissions
  at [`packages/core/src/skill.ts:30-38`](../../../../packages/core/src/skill.ts#L30-L38)
  and [`packages/core/src/skill.ts:73-100`](../../../../packages/core/src/skill.ts#L73-L100).
- Compaction constructs a dedicated conversational summary request and may replay the
  original user input at
  [`packages/opencode/src/session/compaction.ts:360-402`](../../../../packages/opencode/src/session/compaction.ts#L360-L402)
  and [`packages/opencode/src/session/compaction.ts:422-448`](../../../../packages/opencode/src/session/compaction.ts#L422-L448).

## Artifact-write and enforcement-boundary evidence

- WriteTool receives model-controlled content/filePath, asks canonical edit permission,
  writes/formats, and publishes file events at
  [`packages/opencode/src/tool/write.ts:20-38`](../../../../packages/opencode/src/tool/write.ts#L20-L38)
  and [`packages/opencode/src/tool/write.ts:40-72`](../../../../packages/opencode/src/tool/write.ts#L40-L72).
- ApplyPatch parses model-supplied patch text and materializes file changes at
  [`packages/opencode/src/tool/apply_patch.ts:22-52`](../../../../packages/opencode/src/tool/apply_patch.ts#L22-L52)
  and [`packages/opencode/src/tool/apply_patch.ts:55-68`](../../../../packages/opencode/src/tool/apply_patch.ts#L55-L68).
- ShellTool owns command parsing/execution, including opaque shell constructs, at
  [`packages/opencode/src/tool/shell.ts:257-263`](../../../../packages/opencode/src/tool/shell.ts#L257-L263)
  and [`packages/opencode/src/tool/shell.ts:416-428`](../../../../packages/opencode/src/tool/shell.ts#L416-L428).
  This supports an explicit heredoc/redirect enforcement-boundary question rather than
  a claim that all bytes are observable before execution.
- MCP instructions are loaded into system context at
  [`packages/opencode/src/session/system.ts:104-126`](../../../../packages/opencode/src/session/system.ts#L104-L126),
  while plugin post-tool output can be transformed at
  [`packages/plugin/src/index.ts:270-281`](../../../../packages/plugin/src/index.ts#L270-L281).

## Telemetry evidence and boundaries

- Current OTLP setup derives endpoint/headers/resource attributes and exports logs/
  traces at [`packages/core/src/observability/otlp.ts:7-52`](../../../../packages/core/src/observability/otlp.ts#L7-L52)
  and [`packages/core/src/observability/otlp.ts:55-76`](../../../../packages/core/src/observability/otlp.ts#L55-L76).
- Agent generation currently enables AI SDK telemetry with bounded metadata at
  [`packages/opencode/src/agent/agent.ts:372-394`](../../../../packages/opencode/src/agent/agent.ts#L372-L394).
- These mechanisms do not establish Lang Lock. They are candidate seams for content-free
  policy metadata and must continue to exclude artifact content, paths, prompts,
  snippets, and reasoning.

## Evidence boundaries

- Existing locale systems and English instruction rules do not provide an immutable
  artifact-language policy or separate conversational/artifact axes.
- Existing custom skill/MCP/plugin content is evidence of input boundaries, not a
  decision to translate legacy content.
- OutputSpool/ArtifactStore is now [Feature 005](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md).
  This feature references it for language tag/provenance on textual channels only.

## Related evidence

- [Feature 001 specification](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 002 specification](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 003 specification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [ADR-0001 Telemetry Foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
