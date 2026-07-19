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

| Plane          | IDs / path                                                                                                     | Owner                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Operator admin | `mcp.server.*`, `mcp.auth.*`, `mcp.resource.admin.*`, `mcp.logging.*`, `mcp.experimental.*`, `mcp.extension.*` | Feature 007 registry/auth/audit; **schemas SSOT Feature 008** |
| Runtime data   | Canonical adapter + Permission (`mcp:server:…`)                                                                | Feature 008 runtime; **not** Feature 007 command IDs          |

No dual authority: LLM never invokes Feature 007 `mcp.*` IDs; operator admin never
via ToolRegistry/MCP/custom/`session.command`.

## Protocol truth (2025-11-25)

Official specification index:
https://modelcontextprotocol.io/specification/2025-11-25/

| Concept                             | Spec meaning                                                                                            | OpenCode rule                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Transport message stream            | JSON-RPC over stdio / Streamable HTTP / legacy SSE                                                      | Not partial tool content                                              |
| Progress (`notifications/progress`) | progressToken + progress + optional total/message; **progress MUST increase**                           | Metadata only; UI/OTEL; UI coalesce does not change wire monotonicity |
| Resource updated                    | Server signals resource change                                                                          | Policy-gated re-read; not content push                                |
| Experimental Tasks                  | CreateTaskResult; taskSupport; tasks/get/result/list/cancel; notifications/tasks/status; input_required | Map to Feature 002/005; not partial content                           |
| Standard call cancel                | `notifications/cancelled`                                                                               | Non-task-augmented tools/call                                         |
| Task cancel                         | `tasks/cancel`                                                                                          | Task-augmented only when `mcp.tasks` on                               |
| Content stream extension            | **Nonstandard** experimental                                                                            | Namespaced, negotiated, **off by default**                            |
| `tools/call` result                 | One final `CallToolResult`                                                                              | Never claim standard partial content                                  |
| OutputSpool offset/limit            | OpenCode Feature 005 app API                                                                            | Not an MCP wire claim                                                 |

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

| Fact                                       | Evidence                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Declared dependency                        | `packages/opencode/package.json` → `"@modelcontextprotocol/sdk": "1.29.0"`         |
| Installed package version                  | `packages/opencode/node_modules/@modelcontextprotocol/sdk/package.json` → `1.29.0` |
| Protocol constant in client types          | `dist/cjs/types.d.ts` → `LATEST_PROTOCOL_VERSION = "2025-11-25"`                   |
| Client sends protocolVersion on initialize | `dist/cjs/client/index.js` uses `LATEST_PROTOCOL_VERSION`                          |
| Transports present                         | `StreamableHTTPClientTransport`, `SSEClientTransport`, `StdioClientTransport`      |

SDK behavior relevant to Feature 008 phases:

- Final `tools/call` / request responses are parsed as complete JSON-RPC messages in
  process memory. Phases: (1) spill after final parse into Feature 005 OutputSpool;
  (2) future bounded transport/parser or negotiated **nonstandard** extension.
  **No zero-RAM promise.**
- Progress requires an `onprogress` (or equivalent) hook for the SDK to attach a
  `progressToken` and optionally reset timeouts.
- OAuth client auth helpers exist and are used by OpenCode OAuth modules.

### Installed version vs the C1 baseline (no delta) and the applied forward patch

| Fact | Evidence |
| ---- | -------- |
| Declared dependency | `packages/opencode/package.json` → `"@modelcontextprotocol/sdk": "1.29.0"` |
| Locked version | `bun.lock` → `"@modelcontextprotocol/sdk@1.29.0"` |
| Delta vs C1 baseline | **none** — installed 1.29.0 equals the C1 pinned baseline 1.29.0 |
| Forward patch already applied | `bun.lock` maps the package to `patches/@modelcontextprotocol%2Fsdk@1.29.0.patch` |

The lockfile pins exactly the C1 baseline, so there is **no version bump to perform** at
plan time; the upgrade posture is C1's forward-patch path, not a jump. The 629-line
workspace patch already demonstrates that posture: it adds typed `callTool` result
overloads (`callTool(params, resultSchema?, options?)`) to the client `.d.ts` and, in the
client runtime, installs `transport.onsessionexpired = async () => { await
this._initialize(transport) }` so a session-expired transport re-initializes rather than
failing. This is direct evidence for C1 (forward-patch a patch/minor of the same major
line, never fork wire logic). A future session-resume / `Last-Event-ID` / Tasks gap follows
the same channel — extend this patch or take a patch/minor bump — and a major SDK jump is an
explicit plan/ADR migration note, never a silent bump.

### SDK client APIs for subscriptions, progress, cancellation, and tasks (installed type declarations)

Inspected in the installed package
(`node_modules/.bun/@modelcontextprotocol+sdk@1.29.0+.../dist/esm/**`):

| Feature 008 need | SDK surface (present) | Location |
| ---------------- | --------------------- | -------- |
| Resource subscribe (C10) | `Client.subscribeResource(params, options?)`, `Client.unsubscribeResource(params, options?)` | `client/index.d.ts` |
| Subscribe capability wire (C10) | `SubscribeRequestSchema`, `UnsubscribeRequestSchema` | `types.d.ts` |
| Resource updated / list-changed (C9) | `ResourceUpdatedNotificationSchema`, `ResourceListChangedNotificationSchema` | `types.d.ts` |
| Progress plumbing (C7) | `ProgressCallback`, `RequestOptions.onprogress`, `RequestOptions.resetTimeoutOnProgress`, `ProgressNotificationSchema` | `shared/protocol.d.ts`, `types.d.ts` |
| Standard cancel (C8) | `CancelledNotificationSchema` (request-id scoped); driven via `RequestOptions` `AbortSignal` | `types.d.ts`, `shared/protocol.d.ts` |
| Task cancel + lifecycle (C8, C18) | `experimental/tasks/**` (`interfaces.d.ts`, `types.d.ts`, `CreateTaskResult`, `GetTaskResult`, task cancel/get/result); `client.experimental.tasks.callToolStream()` referenced in the patched `callTool` doc | `experimental/tasks/**`, patched `client/index.d.ts` |
| Logging level (C23) | `Client.setLoggingLevel(level, options?)` | `client/index.d.ts` |
| Typed tool call (C16) | patched `callTool` overloads returning `SchemaOutput<CallToolResult>`; final result parsed in RAM (no zero-RAM) | patched `client/index.d.ts` |

Every wire feature Feature 008 phases require exists in the pinned SDK; the Tasks surface is
under the `experimental/` namespace and is `@experimental`-annotated, matching the C18
per-server, off-by-default rollout posture. The final `tools/call` result is a complete
JSON-RPC parse in process memory, confirming the C16 post-parse spill (no zero-RAM promise).

### `MCP.Service` consumer inventory (grep, read-only)

The C27 compatibility surface — consumers that keep their interface shape while Feature 008
reworks lifecycle behind the seams:

| Consumer | Location | Uses |
| -------- | -------- | ---- |
| Effect runtime layer | `packages/opencode/src/effect/app-runtime.ts:94` | `MCP.node` |
| HTTP server wiring | `packages/opencode/src/server/routes/instance/httpapi/server.ts:250` | `MCP.node` |
| HTTP MCP handlers | `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts` | `yield* MCP.Service`; `MCP.NotFoundError` |
| HTTP experimental handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts:31` | `yield* MCP.Service` |
| HTTP MCP group / status | `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts` | `MCP.Status`, `StatusMap` |
| CLI MCP command | `packages/opencode/src/cli/cmd/mcp.ts` | `MCP.Service.use`, `MCP.AuthStatus`, `getAuthStatus`, `removeAuth` |
| Command index | `packages/opencode/src/command/index.ts:62,175` | `yield* MCP.Service`; `MCP.node` dep |
| Code-mode tool catalog | `packages/opencode/src/tool/code-mode.ts:36,210` | `MCP.McpTool`; `mcp.tools()` |
| Session tools (runtime resources) | `packages/opencode/src/session/tools.ts` | `MCP.Service`; `list_mcp_resources` / `read_mcp_resource`; `MAX_MCP_RESOURCE_BLOB_BYTES` (10MB) |
| Config schema | `packages/core/src/config/mcp.ts` | `ConfigV2.MCP.Timeout/Local/OAuth/Remote` |
| Lifecycle tests | `packages/opencode/test/mcp/lifecycle.test.ts` | `mcp.tools()` catalog assertions |

These seams (`tools()`, `resources()`, `readResource()`, the `Status` union, `MCP.node`,
`mcp:server:*` Permission, and the cached `defs[server]` shape) are the additive-only
compatibility contract of C27.

### `mcp-event.ts` schema shape and the rename blast radius (C3)

`packages/schema/src/mcp-event.ts` today defines two events via `Event.define` and an
`Event.inventory`:

- `ToolsChanged` — `type: "mcp.tools.changed"`, `schema: { server: Schema.String }`.
- `BrowserOpenFailed` — `type: "mcp.browser.open.failed"`, `schema: { mcpName, url }`.
- `Definitions = Event.inventory(ToolsChanged, BrowserOpenFailed)`.

The `mcp.tools.changed` literal that C3 renames to the canonical `mcp.tools_changed` reaches
three files: the schema source `packages/schema/src/mcp-event.ts:7`; the re-export and two
publishers in `packages/opencode/src/mcp/index.ts` (`ToolsChanged = McpEvent.ToolsChanged`,
`events.publish(ToolsChanged, { server })` at lines 451 and 470); and three occurrences in
the generated SDK types `packages/sdk/js/src/v2/gen/types.gen.ts` (`type: "mcp.tools.changed"`
in `McpToolsChanged`, `EventMcpToolsChanged`, and the union). The rename updates the schema
literal and regenerates the SDK types in one migration so no dual spelling survives and the
Feature 009 reindex-trigger consumer reads the single id.

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

| Area               | Today               | Target                                                      |
| ------------------ | ------------------- | ----------------------------------------------------------- |
| Progress           | Discarded no-op     | UI/Process Table/EventBus/OTEL; wire monotonic              |
| Cancel             | AbortSignal partial | Standard → `notifications/cancelled`; task → `tasks/cancel` |
| Resource subscribe | Absent              | Capability + `mcp.resource.admin.*` + policy                |
| Large results      | Truncate + path     | Feature 005 OutputRef                                       |
| Experimental Tasks | Commented off       | Full 2025-11-25 Tasks behind `mcp.tasks`                    |
| Native admin       | Ad hoc              | Feature 007 `mcp.*` + 008 schemas                           |
| Canonical adapter  | Dual paths          | One behavior plane                                          |

## Alignment with Features 001–007

| Feature  | Integration                                                     |
| -------- | --------------------------------------------------------------- |
| 001      | Sampling cannot bypass Smart/budget/LangLock; OTEL content-free |
| 002      | MCP call/task = Process Table child; progress UI; cancel tree   |
| 003      | Optional scheduled/wake only under resource policy              |
| 004      | MCP content external LangLock exemption                         |
| 005      | Every call/read OutputGroup; preview + OutputRef                |
| 006      | Semantic reindex of resources only opt-in + classification      |
| 007      | Operator-only `mcp.*` registry/auth/audit; schemas owned by 008 |
| ADR-0001 | No URI/content/call/session metric labels                       |
| ADR-0002 | Smart routing authority unchanged                               |
| ADR-0003 | Native command authority; MCP never admin path (proposed)       |

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
