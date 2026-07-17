# OutputSpool and ArtifactStore Research

Feature: [005 OutputSpool and ArtifactStore](spec.md)

This note records confirmed audit coverage from Features 001–004, current-core
evidence with path/line anchors, and explicit gaps. It is not an ADR and does not
authorize implementation. Requirements live in `spec.md`.

## Audit: Features 001–004 (what exists vs gap)

### Exists today (future-forward references only)

| Artifact                                                                                                                                       | Coverage                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001 research](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/research.md) L65–67, L109–110                                  | Bounded context; “future OutputSpool”; Managers offset/limit; definitive contracts deferred                                                            |
| [001 spec](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) L510–513                                                  | Workers write future OutputSpool; Managers read offset/limit; Architect refs/slices                                                                    |
| [ADR-0002](../../adr/0002-core-smart-agent-routing.md) L104–105, L226–227                                                                      | Same bounded-context rule; future OutputSpool owns definitive OutputRef                                                                                |
| [002 spec](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md) L348–351, L384–385, L433–435, L758–759, L774–775, L849–850 | Cursor/ref open without full load; handoff via refs; cancel seal/abort preserving bytes; definitive contract deferred; full content plane out of scope |
| [002 research](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/research.md) L11–23                                             | BackgroundJob in-memory; TaskTool entry points                                                                                                         |
| [004 spec](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md) L163, L296, L333–334                                      | SHOULD attach Lang Lock tag/provenance to textual OutputSpool channels                                                                                 |
| [004 research](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/research.md) L97–98                                            | Future feature had no reserved number (now 005)                                                                                                        |
| [ADR-0001](../../adr/0001-opentelemetry-telemetry-foundation.md)                                                                               | Content-free OTEL; no path/session as labels                                                                                                           |

### Gaps closed by Feature 005

- No file-first OutputSpool, channels, state machine, or native begin/append/read/
  follow/seal/abort/stat/release/cleanup contract.
- No offset/limit/follow/cursor/pagination API; no UTF-8 page safety rules.
- No content-plane separation from EventV2/transcript (full content/path still flow).
- No terminal ↔ seal settlement ordering or generation fencing.
- No quota/ENOSPC/fd admission signals; no encryption/legal deletion surface.
- No ref-aware retention (mtime-only cleanup deletes referenced tool output).
- PermissionV2 lacks operator principal / root-tree auth for output actions.
- Plugin/MCP/legacy tool outputs are fully materialized before bound/spill.
- BackgroundJob stores full output/error strings in process memory.

## Current-core evidence (read-only)

### BackgroundJob — full strings in memory

- `Info` includes optional `output?: string` and `error?: string` at
  [`packages/core/src/background-job.ts:9-18`](../../../../packages/core/src/background-job.ts#L9-L18).
- Active job may hold `output?: { sequence: number; text: string }` at
  [`packages/core/src/background-job.ts:21-32`](../../../../packages/core/src/background-job.ts#L21-L32).
- Registry is process-local and intentionally non-durable at
  [`packages/core/src/background-job.ts:113-118`](../../../../packages/core/src/background-job.ts#L113-L118)
  and map storage at
  [`packages/core/src/background-job.ts:190-200`](../../../../packages/core/src/background-job.ts#L190-L200).
- Settlement copies `output.text` into `Info` at
  [`packages/core/src/background-job.ts:160-162`](../../../../packages/core/src/background-job.ts#L160-L162).
- Fork runs `Effect.Effect<string, unknown>` success as full string output at
  [`packages/core/src/background-job.ts:173-187`](../../../../packages/core/src/background-job.ts#L173-L187).

**Gap:** Feature 005 requires BackgroundJob to store OutputRef/stat/status, not
content-proportional strings.

### ToolOutputStore — post-materialization spill + path in preview + mtime retention

- Limits and 7-day retention constants at
  [`packages/core/src/tool-output-store.ts:14-18`](../../../../packages/core/src/tool-output-store.ts#L14-L18).
- Managed directory name `tool-output` under global data at
  [`packages/core/src/tool-output-store.ts:18`](../../../../packages/core/src/tool-output-store.ts#L18)
  and [`:118`](../../../../packages/core/src/tool-output-store.ts#L118).
- `bound` fully materializes contextual text, then optionally writes a file and embeds
  the absolute path in the truncation marker at
  [`packages/core/src/tool-output-store.ts:138-173`](../../../../packages/core/src/tool-output-store.ts#L138-L173)
  (`... full content saved to ${outputPath} ...`).
- Cleanup deletes by mtime older than RETENTION at
  [`packages/core/src/tool-output-store.ts:176-188`](../../../../packages/core/src/tool-output-store.ts#L176-L188).
- Global tmp path construction at
  [`packages/core/src/global.ts:15-39`](../../../../packages/core/src/global.ts#L15-L39).

**Gap:** Not first-chunk file-backed streaming; path exposure; mtime-only retention;
not multi-channel OutputGroup identity.

### TaskTool and runner publication

- TaskTool enters BackgroundJob at
  [`packages/opencode/src/tool/task.ts:81-92`](../../../../packages/opencode/src/tool/task.ts#L81-L92)
  (also cited in Feature 002/003 research).
- V2 runner publishes LLM events with optional `outputPaths` at
  [`packages/core/src/session/runner/llm.ts:229-267`](../../../../packages/core/src/session/runner/llm.ts#L229-L267).
- Tool registry settles via ToolOutputStore and may return `outputPaths` at
  [`packages/core/src/tool/registry.ts:46-80`](../../../../packages/core/src/tool/registry.ts#L46-L80).
- Message updater stores tool `result`, `error`, and `outputPaths` on parts at
  [`packages/core/src/session/message-updater.ts:309-337`](../../../../packages/core/src/session/message-updater.ts#L309-L337).

**Gap:** Paths and full results remain first-class in projection; need OutputRef +
bounded preview only.

### EventV2 and observability baselines

- EventV2 durable/live APIs at
  [`packages/core/src/event.ts:63-108`](../../../../packages/core/src/event.ts#L63-L108);
  `allBounded` dropping queue at
  [`packages/core/src/event.ts:152-164`](../../../../packages/core/src/event.ts#L152-L164);
  unbounded global PubSub at
  [`packages/core/src/event.ts:170-180`](../../../../packages/core/src/event.ts#L170-L180).
- Partial OTLP setup at
  [`packages/core/src/observability/otlp.ts:7-71`](../../../../packages/core/src/observability/otlp.ts#L7-L71).

**Gap:** No versioned EventV2 schemas that carry only OutputRef + bounded preview;
terminal events may still imply full content elsewhere in message projection.

### Secure storage / permission (policy gaps from audit)

- No current-core OutputSpool authorization principal model was found that maps
  operator/system/manager + project/root/session/tree scopes for output actions.
- Feature 002 clarification already notes operator/manager principal gap for expanding
  OutputRef/cursors (002 spec clarification #22).
- Existing ToolOutputStore is not a secure multi-tenant content plane (path embedding,
  no generation fencing, no concurrent paged API).

## Policies and gaps to carry into specify (confirmed)

1. **PermissionV2** lacks principal/root-tree auth for output actions — dependency/gap.
2. **Secure storage** current core (ToolOutputStore) is incompatible with 005 target.
3. **EventV2/transcript** currently allow full content/path — must migrate to refs.
4. **Terminal↔seal ownership** — Feature 005 owns content-plane seal/abort/settlement;
   Feature 002 owns lifecycle terminal; shared clarify is ordering/reconciliation only.
5. **mtime retention** deletes referenced tool output — replace with ref-aware graph.
6. **plugin/MCP/tool** outputs materialized — need streaming sink + compatibility spill.
7. **No quota/ENOSPC/encryption/legal deletion** surfaces — require explicit hooks.

## Evidence boundaries

- Path/line anchors are read-only observations as of research authoring; they may
  drift and do not authorize implementation.
- Numeric quotas, fsync policy, encryption defaults, ENOSPC fail/degrade/cancel, and
  cursor TTL remain clarification (see `spec.md`).
- This research does not select storage layout or SQLite schema; those are plan/ADR
  concerns after clarify.

## Related evidence

- [Feature 005 specification](spec.md)
- [Feature 001 specification](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 001 research](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/research.md)
- [Feature 002 specification](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 002 research](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/research.md)
- [Feature 003 specification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- [Feature 003 research](../003-add-persistent-bun-native-scheduled-jobs-with-event/research.md)
- [Feature 004 specification](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- [Feature 004 research](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/research.md)
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
