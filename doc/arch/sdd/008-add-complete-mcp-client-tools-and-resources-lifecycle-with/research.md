# Complete MCP Client Tools and Resources Lifecycle Research

Feature: [008 Complete MCP Client Tools and Resources Lifecycle](spec.md)

This note records **baseline factual research** for Feature 008: SDK version,
protocol 2025-11-25 truth, current OpenCode MCP client gaps, and confirmed product
decisions. It is **not** an ADR and does not authorize implementation.
Requirements live in `spec.md`.

## Confirmed product decisions (user-confirmed)

These MUST NOT be reopened as clarifications that reverse the authority model.

1. **Experimental Tasks, sampling, elicitation** — separate feature flags, disabled
   by default, individually permissioned and audited.
2. **Tool progress** — Feature 002 Process Table / UI / EventBus / OTEL only; never
   LLM context or turns by default.
3. **Resource subscriptions** — notify/cache + native policy; main wake / re-read /
   reindex only if policy allows; never every update automatically.
4. **Canonical adapter** — top-level MCP tools and code-mode share one adapter,
   policy, lifecycle, permissions, and OutputSpool; presentation may differ,
   behavior must not.

## Ownership and dual-plane grammar

| Plane | IDs / path | Owner |
| ----- | ---------- | ----- |
| Operator admin | `mcp.server.*`, `mcp.auth.*`, `mcp.resource.admin.*`, `mcp.logging.*`, `mcp.experimental.*`, `mcp.extension.*` | Feature 007 registry/auth/audit; **schemas SSOT Feature 008** |
| Runtime data | Canonical adapter + Permission (`mcp:server:…`) | Feature 008 runtime; **not** Feature 007 command IDs |

No dual authority: LLM never invokes Feature 007 `mcp.*` IDs; operator admin never
via ToolRegistry/MCP/custom/`session.command`.

## Protocol truth (2025-11-25)

Official specification index:
https://modelcontextprotocol.io/specification/2025-11-25/

| Concept | Spec meaning | OpenCode rule |
| ------- | ------------ | ------------- |
| Transport message stream | JSON-RPC over stdio / Streamable HTTP / legacy SSE | Not partial tool content |
| Progress (`notifications/progress`) | progressToken + progress + optional total/message; **progress MUST increase** | Metadata only; UI/OTEL; UI coalesce does not change wire monotonicity |
| Resource updated | Server signals resource change | Policy-gated re-read; not content push |
| Experimental Tasks | CreateTaskResult; taskSupport; tasks/get/result/list/cancel; notifications/tasks/status; input_required | Map to Feature 002/005; not partial content |
| Standard call cancel | `notifications/cancelled` | Non-task-augmented tools/call |
| Task cancel | `tasks/cancel` | Task-augmented only when `mcp.tasks` on |
| Content stream extension | **Nonstandard** experimental | Namespaced, negotiated, **off by default** |
| `tools/call` result | One final `CallToolResult` | Never claim standard partial content |
| OutputSpool offset/limit | OpenCode Feature 005 app API | Not an MCP wire claim |

Key official pages:

- Lifecycle / version / capabilities:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- Transports:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Progress:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress
- Cancellation:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation
- Tasks:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- Tools:
  https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Resources:
  https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- Prompts:
  https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
- Logging:
  https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging
- Roots:
  https://modelcontextprotocol.io/specification/2025-11-25/client/roots
- Sampling:
  https://modelcontextprotocol.io/specification/2025-11-25/client/sampling
- Elicitation:
  https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation

**Never claim:** partial tool/resource content streaming as standard MCP.
**Never claim:** zero-RAM final result parse with current SDK.
**Never claim:** server guarantees for progress or subscriptions.

## SDK baseline: `@modelcontextprotocol/sdk@1.29.0`

| Fact | Evidence |
| ---- | -------- |
| Declared dependency | `packages/opencode/package.json` → `"@modelcontextprotocol/sdk": "1.29.0"` |
| Installed package version | `packages/opencode/node_modules/@modelcontextprotocol/sdk/package.json` → `1.29.0` |
| Protocol constant in client types | `dist/cjs/types.d.ts` → `LATEST_PROTOCOL_VERSION = "2025-11-25"` |
| Client sends protocolVersion on initialize | `dist/cjs/client/index.js` uses `LATEST_PROTOCOL_VERSION` |
| Transports present | `StreamableHTTPClientTransport`, `SSEClientTransport`, `StdioClientTransport` |

SDK behavior relevant to Feature 008 phases:

- Final `tools/call` / request responses are parsed as complete JSON-RPC messages in
  process memory. Phases: (1) spill after final parse into Feature 005 OutputSpool;
  (2) future bounded transport/parser or negotiated **nonstandard** extension.
  **No zero-RAM promise.**
- Progress requires an `onprogress` (or equivalent) hook for the SDK to attach a
  `progressToken` and optionally reset timeouts.
- OAuth client auth helpers exist and are used by OpenCode OAuth modules.

## Current OpenCode MCP client (read-only evidence)

Primary modules:

- [`packages/opencode/src/mcp/index.ts`](../../../../packages/opencode/src/mcp/index.ts)
- [`packages/opencode/src/mcp/catalog.ts`](../../../../packages/opencode/src/mcp/catalog.ts)
- [`packages/opencode/src/mcp/auth.ts`](../../../../packages/opencode/src/mcp/auth.ts)
- [`packages/opencode/src/session/tools.ts`](../../../../packages/opencode/src/session/tools.ts)
- [`packages/opencode/src/tool/truncate.ts`](../../../../packages/opencode/src/tool/truncate.ts)

### Capability flags commented / limited

At `mcp/index.ts` CLIENT_OPTIONS: sampling, elicitation, tasks commented; roots on.

**Gap:** flag-gated, permissioned enablement (default off) per Feature 008.

### Progress callback discarded

`catalog.ts` `convertTool` → `onprogress: () => {}` (token only for timeout reset).

**Gap:** progress → Process Table / UI / EventBus / OTEL; preserve wire monotonic
progress; never LLM context by default.

### Tools list_changed only

`watch()` handles logging + `ToolListChangedNotificationSchema` only.

**Gap:** resource subscribe/list_changed/updated; full Tasks lifecycle.

### Full CallToolResult in RAM then truncate path leak

Truncate embeds absolute path in preview hint (`Full output saved to: ${file}`).

**Gap:** Feature 005 OutputRef + bounded preview; post-parse spill.

### Resources list/templates/read; no subscribe; dual-path risk

Session tools expose list/read under Permission. No `mcp.resource.admin.*` operator
catalog yet; risk of conflating runtime and admin.

**Gap:** operator `mcp.resource.admin.*` vs runtime Permission adapter split.

## Gap summary closed by Feature 008

| Area | Today | Target |
| ---- | ----- | ------ |
| Progress | Discarded no-op | UI/Process Table/EventBus/OTEL; wire monotonic |
| Cancel | AbortSignal partial | Standard → `notifications/cancelled`; task → `tasks/cancel` |
| Resource subscribe | Absent | Capability + `mcp.resource.admin.*` + policy |
| Large results | Truncate + path | Feature 005 OutputRef |
| Experimental Tasks | Commented off | Full 2025-11-25 Tasks behind `mcp.tasks` |
| Native admin | Ad hoc | Feature 007 `mcp.*` + 008 schemas |
| Canonical adapter | Dual paths | One behavior plane |

## Alignment with Features 001–007

| Feature | Integration |
| ------- | ----------- |
| 001 | Sampling cannot bypass Smart/budget/LangLock; OTEL content-free |
| 002 | MCP call/task = Process Table child; progress UI; cancel tree |
| 003 | Optional scheduled/wake only under resource policy |
| 004 | MCP content external LangLock exemption |
| 005 | Every call/read OutputGroup; preview + OutputRef |
| 006 | Semantic reindex of resources only opt-in + classification |
| 007 | Operator-only `mcp.*` registry/auth/audit; schemas owned by 008 |
| ADR-0001 | No URI/content/call/session metric labels |
| ADR-0002 | Smart routing authority unchanged |
| ADR-0003 | Native command authority; MCP never admin path (proposed) |

## Out of research scope

Implementation code, accepting a new ADR, clarify/plan/tasks phases, enabling
experimental features by default, claiming standard partial content streams, and
promising zero-RAM MCP parsing.

## Related evidence

- [Feature 008 specification](spec.md)
- [Feature 001](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 002](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 003](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- [Feature 004](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- [Feature 005](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [Feature 006](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- [ADR-0001](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)
