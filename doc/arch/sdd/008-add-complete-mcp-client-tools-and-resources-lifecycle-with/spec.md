---
id: 019f7184-70b5-7f83-bd9a-ed019572f111
number: 008
slug: add-complete-mcp-client-tools-and-resources-lifecycle-with
status: planned
created_at: 2026-07-17T19:18:52.853767Z
---

# Feature Specification: Complete MCP Client Tools and Resources Lifecycle

Feature: 008-add-complete-mcp-client-tools-and-resources-lifecycle-with
Created: 2026-07-17
Scope: MCP client runtime completeness for tools, resources, progress, subscriptions,
transports, experimental capabilities, native management registration, and
file-backed large results. Domain authorities for Smart/budget/OTEL (001),
lifecycle/UI/cancel (002), wake/jobs (003), LangLock (004), OutputSpool (005),
semantic index (006), and native control plane (007) remain unchanged.

**Delivery phases.** Feature 008 owns **MCP runtime completeness** and the domain
operation schemas for the `mcp.*` catalog. Feature 007 owns the operator registry,
auth, audit, and thin adapters only. Feature 008 does **not** redefine management
authority (007), content-plane identity (005), lifecycle/Process Table (002), or
Smart routing (001). Protocol-truth constraints below apply to all phases.

## Scope and intent

Feature 008 specifies a **complete MCP client** for OpenCode: capability negotiation,
tools and resources lifecycle, progress streaming to native UI (not LLM context by
default), resource subscriptions under policy, transport/session/reconnect, OAuth via
secure refs, experimental Tasks/sampling/elicitation behind flags, and every
call/read result routed through Feature 005 OutputSpool with bounded preview +
OutputRef.

**Ownership split (no dual authority).**

| Concern                                                                  | Owner                     |
| ------------------------------------------------------------------------ | ------------------------- |
| MCP runtime behavior, wire semantics, domain op **schemas** for `mcp.*`  | Feature 008               |
| Operator command **registry**, principal/auth, CAS, audit, thin adapters | Feature 007               |
| Process Table child, cancel tree, EventBus, progress UI projection       | Feature 002               |
| OutputGroup / OutputRef / spool                                          | Feature 005               |
| Smart / budgets / OTEL labels                                            | Feature 001 / ADR-0001    |
| Optional semantic resource index                                         | Feature 006 (opt-in only) |

**Operator admin vs runtime LLM grammar (single authority model).**

| Plane                    | Namespace / path                                                                                                                             | Who                                                                           | What                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operator admin/query** | Feature 007 command IDs only: `mcp.server.*`, `mcp.auth.*`, `mcp.resource.admin.*`, `mcp.logging.*`, `mcp.experimental.*`, `mcp.extension.*` | Human operator via Settings / palette / native slash / CLI / App internal API | Setup, connect, policy, subscribe admin, capabilities, experimental flags                                                                          |
| **Runtime data plane**   | Canonical MCP adapter (Feature 008); Permission patterns e.g. `mcp:<server>:<uri\|tool>`                                                     | LLM / agent under permission                                                  | `tools/call`, runtime tools list cache, resources list/read as tool-mediated content — **never** Feature 007 command IDs, never ToolRegistry admin |

Runtime resource/tool access is **not** registered as Feature 007 commands and is
**not** management authority. Operator `mcp.resource.admin.*` is the only
human-facing resource control surface. No dual authority: LLM cannot invoke
`mcp.*` Feature 007 IDs; operator admin cannot be reached via ToolRegistry/MCP/
custom/`session.command`.

**Protocol truth (non-negotiable).**

| Stream / concept                    | What it is                                                                                             | What it is not                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Transport message stream            | JSON-RPC over stdio / Streamable HTTP / legacy SSE                                                     | Partial tool content                                                        |
| Progress (`notifications/progress`) | Metadata: progressToken, progress, optional total/message; wire progress **MUST increase** (monotonic) | Partial tool/resource content; UI coalesce does not relax wire monotonicity |
| Resource updated                    | Signal to re-read under policy                                                                         | Automatic content push or partial body                                      |
| Experimental Tasks lifecycle        | CreateTaskResult, tasks/get/result/list/cancel, notifications/tasks/status, input_required             | Partial content stream                                                      |
| Content stream extension            | **Nonstandard**, namespaced, capability-negotiated, **disabled by default**                            | Standard MCP; silent default                                                |

MCP standard `tools/call` returns **one final** `CallToolResult`. Progress is
**metadata**, not partial content. `resources/updated` causes **policy-gated
re-read**, not inline content delivery. Experimental Tasks stream **lifecycle/
polling**, not partial content. OpenCode OutputSpool offset/limit is **app-side
Feature 005**, not an MCP wire claim. True partial-content streaming is a
**nonstandard extension only**: explicit negotiation, server cooperation,
namespaced flag, disabled by default; silent use is forbidden.

**Confirmed product decisions (user-confirmed; not reopened as reverse-authority
clarifications).**

1. Experimental MCP Tasks, sampling, and elicitation are supported behind **separate**
   feature flags, **disabled by default**, individually permissioned and audited.
2. Tool progress goes to Feature 002 Process Table / UI / EventBus / OTEL; **never**
   LLM context or turns by default.
3. Resource subscribed updates notify/cache and apply native policy; main wake /
   re-read / reindex only if policy allows; **never** every update automatically.
4. Top-level MCP tools and code-mode share **one** canonical adapter, policy,
   lifecycle, permissions, and OutputSpool; presentation differs, behavior does not.

**Relationship to domain features.**

- **001** — Smart routing, budgets, OTEL; sampling cannot bypass Smart / budgets /
  LangLock / privacy.
- **002** — Process Table child for each MCP call and task-augmented execution;
  cancel tree; EventBus; UI; progress UI.
- **003** — Optional scheduled/wake for resource policy; no automatic wake per update.
- **004** — MCP content is external exemption for LangLock; model-generated artifacts
  still obey LangLock.
- **005** — OutputGroup/channels, OutputRef, bounded preview, offset/limit/follow;
  no filesystem path exposure.
- **006** — Optional semantic reindex of resources only with opt-in + classification.
- **007** — Native operator-only `mcp.*` registry/auth/audit/adapters; zero tokens/
  transcript; runtime LLM uses canonical adapter under Permission only.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Capability negotiation and recorded caps

- As an operator, I want protocol version negotiation with downgrade and recorded
  server capabilities so that OpenCode only uses negotiated features.
- As a system, I want sampling, elicitation, and tasks client capabilities off unless
  operator-enabled so experimental surfaces never activate by default.

### P1 — Tools list, call, content types, errors

- As a user/agent, I want paginated tools list with cursor guards, list_changed,
  tools/call, structuredContent, text/image/audio/resource/resource_link,
  outputSchema validation under tolerant/strict policy, and clear errors.
- As a security reviewer, I want tool annotations treated as untrusted unless the
  server trust profile says otherwise.

### P1 — Progress to UI, not LLM

- As an operator, I want progressToken-backed progress events with total/message
  provenance, wire-monotonic progress, UI coalescing that does not alter protocol
  semantics, Process Table status, and OTEL metrics — without polluting model context.
- As a security reviewer, I want progress never persisted as tool output or injected
  into turns by default.

### P1 — Resources under dual-plane grammar

- As a user/agent, I want runtime list/templates/read through the canonical adapter
  under Permission (not Feature 007 IDs).
- As an operator, I want `mcp.resource.admin.*` for human list/templates/read/
  subscribe/policy without LLM authority.

### P1 — Cancellation distinction

- As a user, I want standard in-flight `tools/call` cancel to use MCP
  `notifications/cancelled`, and task-augmented work to use `tasks/cancel`, both
  integrated with Feature 002 Ctrl+C root tree.

### P1 — File-backed large results and native admin

- As an operator, I want every MCP call/read to create Feature 005 OutputGroup;
  UI/LLM receive bounded preview + OutputRef, never path; SDK RAM parse limit
  acknowledged with post-parse spill (no zero-RAM promise).
- As an operator, I want `mcp.server.*` / `mcp.auth.*` / `mcp.resource.admin.*` /
  `mcp.logging.*` / `mcp.experimental.*` / `mcp.extension.*` with zero tokens and
  no transcript.

### P2 — Prompts, roots, logging

- As a runtime, I want prompts list/get/list_changed as runtime content under
  permission (not admin setup).
- As an operator, I want roots scoped to project/session without path overexposure
  and logging notifications plus operator `mcp.logging.level.*`.

### P2 — Canonical adapter parity

- As a maintainer, I want top-level and code-mode to share one canonical adapter so
  presentation may differ but behavior does not.

### P3 — Experimental Tasks / sampling / elicitation / nonstandard content-stream

- As an operator, I want full MCP Tasks (2025-11-25) behind `mcp.tasks` off by
  default, mapped to Feature 002/005 lifecycle only; sampling under Smart/budgets/
  LangLock; elicitation always operator-surfaced; content-stream extension
  nonstandard and off by default.

## Functional Requirements

### Protocol truth and non-claims

1. The system MUST distinguish transport message streams, progress notifications,
   resource updated notifications, experimental Tasks lifecycle, and any content
   stream extension. It MUST NOT claim standard partial tool/resource content
   streaming.
2. Standard `tools/call` MUST be modeled as one final `CallToolResult`. Progress
   MUST be treated as metadata only and MUST NOT be persisted as tool output.
3. `resources/updated` MUST trigger notify/cache and policy evaluation; content
   delivery requires authorized re-read. Automatic wake/reindex on every update is
   forbidden.
4. Experimental Tasks MUST map lifecycle/polling to Feature 002/005 only; MUST NOT
   claim partial content streaming.
5. OpenCode OutputSpool offset/limit/cursor/follow MUST be app-side Feature 005 APIs,
   not MCP wire claims.
6. True partial-content streaming is a **nonstandard extension only**. It MUST remain
   disabled by default, require explicit namespaced capability negotiation and server
   cooperation, and MUST NOT be used silently. Absence of the extension MUST fall back
   to final CallToolResult + progress metadata only.

### Capability negotiation

7. On connect, the client MUST negotiate protocol version (prefer 2025-11-25 and
   support downgrade), exchange capabilities, and **record** negotiated server
   capabilities for operator query and runtime gating.
8. Client capability advertisement for sampling, elicitation, and tasks MUST remain
   off unless the corresponding experimental flag is operator-enabled and per-server
   policy allows.
9. Roots capability, when enabled, MUST be scoped to project/session and MUST NOT
   overexpose filesystem paths beyond authorized roots.

### Tools

10. The client MUST support paginated `tools/list` with cursor duplicate/guard and
    max-page protection.
11. When the server declares `tools.listChanged`, the client MUST handle
    `notifications/tools/list_changed` and refresh the tool catalog.
12. `tools/call` MUST support content types text, image, audio, resource, and
    resource_link; structuredContent; isError tool-execution errors vs protocol
    errors; and outputSchema validation under configurable tolerant/strict policy.
13. Top-level tools and code-mode MUST share one canonical adapter for policy,
    lifecycle, permissions, and OutputSpool. Presentation adapters may differ;
    behavior MUST NOT.
    13a. Tool annotations MUST be treated as untrusted unless the server trust profile
    explicitly elevates them.

### Progress

14. When requesting progress, the client MUST supply a progressToken (via SDK
    onprogress or equivalent) so the server can emit `notifications/progress`.
15. On the wire, `progress` values MUST increase for a given progressToken (MCP
    monotonic rule). OpenCode UI/EventBus MAY coalesce/rate-limit display updates;
    coalescing MUST NOT rewrite, invent, or decrease protocol progress values and
    MUST NOT change wire semantics.
16. Progress events MUST be bounded, carry optional total and message with
    provenance, and update Feature 002 Process Table child status. They MUST NOT
    enter LLM context/turns by default and MUST NOT be persisted as tool output.
    16a. Progress MUST be observable via UI, EventBus, and OTEL metrics without high-
    cardinality content labels.

### Cancellation

17. **Standard call cancel.** AbortSignal or Feature 002 root-tree cancel of a
    standard (non-task-augmented) in-flight `tools/call` MUST map to MCP
    `notifications/cancelled` for that request id (cancellation utility). Local
    settlement MUST seal/abort OutputSpool writers per Feature 005. If the remote
    does not acknowledge, outcome MUST be recorded as cancel-requested /
    unknown-remote as applicable.
18. **Task-augmented cancel.** When `mcp.tasks` is enabled and the call is
    task-augmented, cancel MUST use `tasks/cancel` (not only
    `notifications/cancelled`). Feature 002 Ctrl+C root tree MUST cancel both
    standard and task-augmented MCP children in the tree with the correct wire path
    per this distinction.

### Resources

19. Runtime resources list, templates, and read MUST be available through the
    **canonical adapter under Permission** (runtime data plane). They MUST NOT be
    Feature 007 command IDs and MUST NOT be ToolRegistry admin surfaces.
20. Operator human list/templates/read/subscribe/unsubscribe/policy MUST use
    Feature 007 IDs under `mcp.resource.admin.*` only (operator plane).
21. Subscribe/unsubscribe MUST require server `resources.subscribe` capability and
    operator permission via `mcp.resource.admin.subscribe|unsubscribe` (or policy).
    Unauthorized subscribe/read/delivery MUST fail closed.
22. On `notifications/resources/list_changed`, refresh catalogs under the same
    permission model as list.
23. On `notifications/resources/updated`, the client MUST coalesce/dedupe/debounce
    with sequence/correlation and a bounded queue; then apply policy: notify UI,
    refresh cache, conditional re-read, optional Feature 006 semantic reindex
    (opt-in + classification), optional Feature 003 scheduled/wake.
24. Main/agent wake MUST occur only for semantic policy events under budget/
    admission/safe boundary. No turn per update.
25. URI scheme policy and project/root scope MUST prevent sibling/cross-project leak.
26. `resource_link` MUST remain lazy; auto-fetch only under policy, permission, and
    budget; arbitrary large linked resources MUST NOT be inlined automatically.

### Prompts and logging

27. Prompts list/get/list_changed MUST be supported as **runtime content under
    permission**, not admin setup and not Feature 007 management IDs.
28. Logging notifications MUST integrate with native logging with redaction and rate
    limits. Operator `logging/setLevel` MUST be Feature 007
    `mcp.logging.level.show|set` only.

### Transports and session

29. Streamable HTTP MUST support session, reconnect, resume, backoff, and
    Last-Event-ID where SDK/spec supports them, under operator reconnect policy.
30. Stdio lifecycle MUST manage process start/stop/signal cleanup without leaking
    child processes.
31. Legacy SSE MUST remain compatible with an explicit deprecation path; new defaults
    prefer Streamable HTTP.
32. OAuth, headers, and secrets MUST use Feature 007 secure references; secrets MUST
    NOT appear in args, history, output, config JSON, or plain audit.

### OutputSpool and large results

33. Every MCP tools/call and resources/read MUST create a Feature 005 OutputGroup
    with typed channels. Progress/log metadata remain bounded control-plane events.
34. Final tool/resource content MUST be spooled. UI and LLM MUST receive bounded
    preview + OutputRef only; filesystem paths MUST NEVER be exposed.
35. Explicit limitation: current `@modelcontextprotocol/sdk` parses the final
    JSON-RPC result in RAM. Phases MUST document: (a) compatibility spill after
    final parse, then (b) future bounded transport/parser or negotiated nonstandard
    extension. Zero-RAM MUST NOT be promised.
36. Base64 blobs MUST be decoded/streamed to spool when possible, with size and MIME
    limits; full data URLs MUST NOT enter model context.
37. Offset/limit/cursor/follow for large results MUST use OpenCode/Feature 005 APIs,
    not MCP wire claims.

### Events and Process Table

38. Bounded EventV2/EventBus events MUST include at least: `mcp.server.status`,
    `mcp.server.capabilities_changed`, `mcp.tools_changed`, `mcp.resources_changed`,
    `mcp.resource_updated`, `mcp.call.started`, `mcp.call.progress`,
    `mcp.call.settled`, `mcp.call.cancel_requested`, `mcp.call.cancelled`,
    `mcp.task.status`, `mcp.task.settled`, `mcp.log`, `mcp.subscription.*`. Events
    MUST NOT carry full content or paths.
39. Each MCP call (and each task-augmented execution when enabled) MUST appear as a
    Process Table execution child with server, tool/task id, role, status, progress,
    bytes, elapsed, and OutputRef; UI follows direct-child hierarchy rules
    (Feature 002).
40. Todo item/evidence may reference call OutputRef; completion gates MUST wait for
    settlement or handle cancel-unknown explicitly.

### Experimental Tasks (`mcp.tasks`, default off)

41. When `mcp.tasks` is disabled (default), the client MUST NOT advertise tasks
    capability and MUST NOT accept task-augmented tool calls.
42. When `mcp.tasks` is operator-enabled for a server with capability negotiation and
    per-server policy, the client MUST support MCP 2025-11-25 Tasks:
    - tool `execution.taskSupport`: `required` | `optional` | `forbidden`;
    - task-augmented call returns `CreateTaskResult` (not a final CallToolResult body
      as partial content);
    - `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`;
    - `notifications/tasks/status` including terminal and `input_required`;
    - related-task metadata where the protocol provides it.
43. Tasks lifecycle MUST map to Feature 002 Process Table children and Feature 005
    OutputSpool for final result content. Progress for tasks continues to use the
    original progressToken until terminal status. Tasks MUST NOT be claimed as
    partial content streaming.
44. Task cancel MUST use `tasks/cancel` (see FR18). Standard non-task call cancel
    MUST use `notifications/cancelled` (see FR17).

### Experimental sampling / elicitation / content-stream extension

45. Flags `mcp.sampling`, `mcp.elicitation`, and any namespaced nonstandard
    content-stream extension MUST be separate from `mcp.tasks`, disabled by default,
    require capability negotiation + operator opt-in + per-server policy, and be
    individually permissioned/audited.
46. Sampling requests MUST NOT bypass Smart routing, budgets, LangLock, or privacy;
    they require explicit agent/model permission.
47. Elicitation MUST surface to operator UI and MUST NEVER be silently answered by
    the model; sensitive mode restrictions apply.

### Native management (Feature 007 registration; schemas owned by 008)

48. Feature 008 owns domain schemas for the following **operator-only** canonical
    operation IDs. Feature 007 registers them, enforces principal/auth/CAS/audit, and
    provides adapters. Never LLM / ToolRegistry / MCP / custom / `session.command`:
    - `mcp.server.list|add|update|test|connect|disconnect|reconnect|disable|delete|status|capabilities`
    - `mcp.auth.start|finish|remove|status`
    - `mcp.resource.admin.list|templates|read|subscribe|unsubscribe|policy.show|policy.set`
    - `mcp.logging.level.show|set`
    - `mcp.experimental.status|enable|disable` (per capability: tasks, sampling,
      elicitation, content-stream extension)
    - `mcp.extension.status|enable|disable` (per server)
49. Native slash for these ops MUST be pre-prompt, zero tokens, zero transcript.
    Setup surfaces: Settings, palette, CLI, App internal API.
50. Runtime LLM MUST call allowed MCP tools and read allowed resources only through
    the canonical adapter under Permission. Runtime paths MUST NOT use Feature 007
    command IDs and MUST NOT manage setup.

### Security

51. The system MUST enforce server trust profile, operator principal, project/root
    scope, OAuth secure storage, header refs, TLS/redirect/SSRF controls, stdio
    command allowlist and env redaction, URI scheme policy, prompt-injection labels,
    resource provenance/untrusted boundary, size/decompression bomb limits, rate
    limits, approval for server-initiated sampling/elicitation, and multi-tenant
    isolation.
52. MCP content is an external exemption for LangLock (Feature 004); model-generated
    artifacts still obey LangLock.
53. Semantic indexing of resources MUST NOT run without operator opt-in and
    classification (Feature 006).

### Observability (OTEL)

54. Spans MUST cover connect, capability negotiation, list, call, progress, read,
    subscribe, reconnect, cancel, and task status/result when tasks enabled.
55. Metrics MUST include bounded latency, progress count, bytes spooled, reconnect
    count, update coalesce count, and failures.
56. Labels MUST NOT include URI, content, call IDs, or session IDs (ADR-0001).

### UI

57. UI MUST provide server cards; tool/resource/task call cards; status, progress,
    total, message, bytes, elapsed, provider/server; direct-child hierarchy; expand
    via OutputRef offset-limit; reconnect and subscription states; keyboard/
    accessibility; no path or raw unbounded content.

## Acceptance Scenarios

1. **Streamable HTTP connect.** Given a remote MCP server supporting Streamable HTTP
   and protocol 2025-11-25, when the operator connects, then capabilities are
   negotiated and recorded and status is connected.
2. **stdio connect.** Given a stdio server on the allowlist, when connected, then
   tools/resources work and process cleanup runs on disconnect.
3. **Legacy SSE fallback.** Given a server that only supports legacy SSE, when
   Streamable HTTP fails and SSE succeeds, then connection works with deprecation
   visibility to the operator.
4. **Tools list_changed.** Given a connected server with `tools.listChanged`, when
   the server emits `notifications/tools/list_changed`, then the catalog refreshes
   and `mcp.tools_changed` is emitted without content.
5. **Progress UI not LLM; wire monotonic.** Given a long `tools/call` with progress
   notifications where wire progress increases, when progress arrives, then Process
   Table/UI/OTEL update, UI may coalesce display without decreasing or inventing
   progress values, and the LLM context/transcript do not receive progress payloads
   by default.
6. **50MB result bounded preview.** Given a tool result approximately 50MB, when the
   call settles, then UI/LLM see bounded preview + OutputRef, path is never exposed,
   and the phase acknowledges SDK final-parse RAM limitation with post-parse spill.
7. **Standard call cancel (`notifications/cancelled`).** Given an in-flight standard
   (non-task-augmented) `tools/call`, when the user cancels via AbortSignal or
   Ctrl+C root tree, then OpenCode sends `notifications/cancelled` for that request,
   OutputSpool is sealed/aborted per 005, and remote outcome is settled or marked
   unknown if no ack.
8. **structuredContent / resource_link / audio.** Given tools returning
   structuredContent, resource_link, and audio content, when called through the
   canonical adapter, then types are handled, resource_link stays lazy unless policy
   fetches, and audio is size/MIME limited and spooled.
9. **Resources subscribe/update/list_changed.** Given server capability and operator
   `mcp.resource.admin.subscribe`, when updated/list_changed fire, then events are
   coalesced and policy applies; no automatic turn per update.
10. **Policy no wake.** Given resource update policy = notify/cache only, when
    updates arrive, then UI/cache update and main/agent do not wake.
11. **Policy conditional wake.** Given policy allowing wake under budget, when a
    qualifying update arrives, then at most one admission-controlled wake occurs and
    audit records the decision.
12. **Reconnect.** Given Streamable HTTP disconnect with session resume support, when
    reconnect policy runs, then backoff/Last-Event-ID/resume behave per SDK/spec and
    status events fire without content labels.
13. **OAuth secure refs.** Given OAuth MCP server, when auth start/finish completes,
    then tokens use secure storage/refs and never appear in history/output/config
    JSON/audit plaintext.
14. **Canonical adapter parity.** Given the same tool invoked top-level and via
    code-mode, when both complete, then policy, permissions, lifecycle child,
    OutputSpool, and settlement behavior match.
15. **Native admin zero tokens.** Given `mcp.server.status` (or peer) via slash/
    Settings/CLI, when executed, then zero provider calls, zero tokens, no
    Message/Part/transcript injection.
16. **Experimental flags default off.** Given a fresh install, when capabilities are
    advertised, then tasks/sampling/elicitation client caps are off and server
    requests for them are not accepted.
17. **Experimental sampling with permissions.** Given operator enables `mcp.sampling`
    for a server with policy, when the server requests sampling, then Smart/budget/
    LangLock/privacy gates apply and audit records approval path.
18. **Elicitation operator.** Given elicitation request with flag on, when received,
    then operator UI is required; model silent answer is impossible.
19. **Nonstandard content-stream extension absent.** Given no content-stream
    extension negotiated (default), when tools/call runs, then only final
    CallToolResult + progress metadata path is used.
20. **Malicious resource / prompt injection.** Given untrusted resource or prompt
    content, when delivered, then provenance/untrusted labels apply, size bombs are
    rejected, and injection is not treated as trusted system instruction.
21. **Cross-project isolation.** Given two projects, when a principal from project A
    attempts resource/tool of project B without scope, then access fails closed.
22. **OTEL content-free.** Given call/progress/read/subscribe activity, when metrics
    and spans export, then no URI/content/call/session IDs appear as metric labels.
23. **Prompts list/get/list_changed.** Given a server with prompts capability, when
    runtime lists/gets prompts and list_changed fires, then prompts are available as
    runtime content under permission only (not Feature 007 admin IDs) and catalogs
    refresh.
24. **Logging notification + setLevel.** Given a server emitting logging notifications,
    when received, then native logging applies redaction/rate limits; when operator
    runs `mcp.logging.level.set`, then level changes via Feature 007 only with audit.
25. **Roots scope / no path overexposure.** Given roots capability enabled, when the
    server requests roots, then only project/session-authorized roots are returned and
    unauthorized filesystem paths are not exposed.
26. **Tool annotations untrusted.** Given a tool with annotations from an untrusted
    server profile, when listed/called, then annotations are not treated as trusted
    safety guarantees.
27. **LangLock external content.** Given MCP tool/resource text content, when admitted
    to context, then Feature 004 treats it as external exemption; model-generated
    artifacts written afterward still obey LangLock.
28. **Feature 006 semantic resource index opt-in.** Given resource updates, when
    operator has not opted in with classification, then no semantic reindex runs;
    when opt-in policy allows, then reindex uses Feature 006 under admission only.
29. **Operator vs runtime resource plane.** Given an LLM turn, when the model attempts
    `mcp.resource.admin.*` or any Feature 007 `mcp.*` ID, then it is denied; when the
    model reads an allowed resource via the canonical adapter under Permission, then
    read succeeds without creating an admin audit as management authority.
30. **Tasks CreateTaskResult and lifecycle.** Given `mcp.tasks` enabled and a tool with
    `execution.taskSupport` optional or required, when a task-augmented call runs,
    then CreateTaskResult is accepted, Process Table shows a task child, tasks/get/
    result/list work, and final content is spooled via Feature 005 without partial
    content claims.
31. **Task cancel (`tasks/cancel`).** Given an in-flight task-augmented call, when the
    user cancels via AbortSignal or Ctrl+C root tree, then OpenCode uses `tasks/cancel`
    (not only `notifications/cancelled`), status reaches cancelled/failed terminal,
    and OutputSpool settles per 005.
32. **tasks/status input_required.** Given `notifications/tasks/status` with
    `input_required`, when received, then operator/runtime policy surfaces the need
    without treating it as partial tool content and without silent model auto-answer
    of elicitation-like input.
33. **taskSupport forbidden.** Given a tool with `execution.taskSupport: forbidden`,
    when a task-augmented call is attempted, then it is rejected even if `mcp.tasks`
    is enabled.

## Security Requirements

- **Data sensitivity/classification.** MCP tools/resources carry untrusted third-party
  content, secrets in headers/OAuth, filesystem-adjacent URIs, and large blobs.
  Classify external content as untrusted; secrets as high sensitivity; OutputRefs as
  authorized metadata only.
- **Authentication/authorization.** Operator principal for all Feature 007 `mcp.*`
  management IDs. Runtime tool/resource access under Permission patterns only
  (`mcp:server:…`). Server-initiated sampling/elicitation require explicit approval.
  Cross-project fail closed.
- **Input validation.** Cursor guards, page limits, URI scheme allow/deny, MIME/size
  limits, decompression bomb limits, outputSchema validation policy, stdio command
  allowlist, env redaction, SSRF/TLS/redirect checks for remote transports.
- **Cryptography in transit/at rest.** TLS for remote MCP where required; OAuth
  tokens and header secrets in Feature 007 secure backends; no secret material in
  spool previews exposed to LLM by default.
- **Logging/audit.** EventV2/OTEL content-free; redacted logging notifications; audit
  for experimental enable, auth, policy set, admin subscribe, and admin mutations.
- **Error-handling information exposure.** Structured errors without path, token, or
  full content leakage; remote cancel-unknown explicitly represented.

## Privacy Requirements

1. MCP external content is not auto-indexed for semantic search without opt-in and
   classification (Feature 006).
2. Progress, logs, and admin outputs are not auto-injected into transcript/context.
3. Roots and resource URIs are scoped; no sibling session or cross-project delivery.
4. OAuth and header secrets never appear in plain audit, history, or config JSON.

## Observability

- Spans: connect, capability, list, call, progress, read, subscribe, reconnect,
  cancel, task status/result (Feature 001 / ADR-0001 conventions).
- Metrics: latency histograms, progress event counts, bytes spooled, reconnects,
  coalesce drops, failures — bounded enums only.
- Correlation with Feature 002 Process Table child IDs on traces (not metric labels).
- No URI/content/call/session IDs as metric labels.

## Compatibility and Migration

- SDK baseline: `@modelcontextprotocol/sdk@1.29.0` (see research.md); protocol target
  2025-11-25 with negotiated downgrade.
- Existing MCP connect/OAuth/tools/resources list-read remain compatibility surfaces;
  Feature 008 completes lifecycle without breaking operator configs.
- Truncate path-in-preview behavior migrates to Feature 005 OutputRef (no path).
- Progress no-op callback migrates to real UI/EventBus/OTEL sink with wire-monotonic
  progress preserved.
- Capability flags currently commented (sampling/elicitation/tasks) remain off until
  experimental enable path exists.
- OAuth/headers migrate to Feature 007 secure refs.
- Code-mode and top-level converge on one canonical adapter.
- Operator resource surfaces rename to `mcp.resource.admin.*` (schemas owned by 008;
  registry by 007).
- Feature flags gate experimental and nonstandard extension rollout; specify status
  alone does not enable them.

## Out of Scope

- Claiming standard partial tool/resource content streaming.
- Guaranteeing that servers emit progress or support subscriptions.
- Idempotent business-level replay of tool side effects.
- Zero-RAM parsing of final MCP JSON results.
- Bypassing permissions or operator authority.
- Automatic wake or reindex on every resource update.
- Experimental features or nonstandard content-stream extension enabled by default.
- MCP admin via LLM, ToolRegistry, MCP tools, custom commands, or `session.command`.
- Dual authority (runtime IDs that are also Feature 007 management commands).
- Replacing domain authorities of Features 001–007.
- Accepting a new ADR in this specify phase (no final ADR for 008 here).

## Clarification Questions

1. SDK patch vs upgrade path beyond 1.29.0 for session resume/Last-Event-ID gaps?
2. Code-mode presentation differences that must remain after canonical adapter merge?
3. Default resource update policy matrix (notify-only vs conditional re-read vs wake)?
4. Operator reconnect/resume defaults and max backoff for Streamable HTTP?
5. Experimental rollout order and per-server vs global defaults?
6. Exact namespaced capability string for the nonstandard content-stream extension?
7. Full-RAM compatibility limit thresholds and spill strategy after final parse?
8. outputSchema default: tolerant vs strict, and fail-open/fail-closed UX?
9. Logging retention and redaction depth for logging notifications?
10. OAuth migration cutover from current storage to Feature 007 secure refs?
11. URI scheme allowlist defaults (file, https, custom)?
12. Prompt/resource trust UX: labels, badges, confirmations?
13. Sampling and elicitation permission shapes and sensitive-mode rules?
14. Semantic indexing opt-in defaults and classification taxonomy (Feature 006)?
15. Wake budgets and admission limits for resource policy (Features 002/003)?
16. SSE deprecation timeline and operator messaging?
17. Task `input_required` operator UX vs agent-mediated input policy?

## Related Features and Decisions

- [Feature 008 research](research.md) — SDK/protocol baseline and current-core gaps;
  not a decision authority.
- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
  — Smart/budget/OTEL; sampling cannot bypass.
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
  — lifecycle child, UI, cancel, EventBus; maps standard and task-augmented MCP work.
- [Feature 003 Scheduled Jobs](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
  — optional scheduled/wake for resource policy.
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
  — MCP external exemption; model artifacts still locked.
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
  — OutputGroup, OutputRef, bounded preview, offset/limit.
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
  — opt-in resource index only.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
  — `mcp.*` registry/auth/audit/adapters; schemas owned by Feature 008.
- [ADR-0009 Complete MCP Client Lifecycle and Content Plane](../../adr/0009-mcp-client-lifecycle-and-content-plane.md)
  (proposed) — required decision record formalizing C1–C27.
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
  (accepted)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
  (accepted)
- [ADR-0003 Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
  (accepted)

### Official MCP specification (2025-11-25)

- Lifecycle / capability negotiation:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- Transports:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Progress:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress
- Cancellation:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation
- Tasks (experimental utility):
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

## Initial Traceability Matrix

| Outcome                                      | Requirements    | Acceptance scenarios | Phase |
| -------------------------------------------- | --------------- | -------------------- | ----- |
| Protocol truth / non-claims                  | FR1–FR6         | 5, 6, 19             | 1     |
| Capability negotiation                       | FR7–FR9         | 1, 16, 25            | 1     |
| Tools list/call/content / annotations        | FR10–FR13a      | 4, 8, 14, 26         | 1     |
| Progress UI-only + wire monotonic            | FR14–FR16a      | 5, 22                | 1     |
| Standard cancel (`notifications/cancelled`)  | FR17            | 7                    | 1     |
| Task cancel (`tasks/cancel`) + Process Table | FR18, FR38–FR40 | 30–33                | 2–3   |
| Resources + policy + dual plane              | FR19–FR26       | 9–11, 20–21, 29      | 1–2   |
| Prompts / logging                            | FR27–FR28       | 23–24                | 2     |
| Roots scope                                  | FR9             | 25                   | 1     |
| Transports / OAuth                           | FR29–FR32       | 1–3, 12–13           | 1–2   |
| OutputSpool large results                    | FR33–FR37       | 6, 8                 | 1     |
| Experimental Tasks full                      | FR41–FR44       | 16, 30–33            | 2–3   |
| Sampling / elicitation / content-stream      | FR45–FR47       | 16–19                | 2–3   |
| Native `mcp.*` management                    | FR48–FR50       | 15, 29               | 1     |
| LangLock external + semantic opt-in          | FR52–FR53       | 27–28                | 1–2   |
| Security / privacy / OTEL / UI               | FR51–FR57, NFRs | 20–22                | 1–2   |

## Clarifications

### Session 2026-07-18

Declarative resolutions for the Feature 008 clarify phase. Each decision closes one or
more Clarification Questions (CQ1–CQ17 above) or an inline ambiguity in the body without
reopening the confirmed product decisions, the ownership split, or the domain authority
of Features 001–007: Feature 001 Smart/budget/OTEL and privacy, Feature 002 lifecycle /
Process Table / cancel-tree / EventBus, Feature 003 scheduled/wake occurrence, Feature
004 LangLock provenance, Feature 005 OutputSpool content plane, Feature 006 semantic
stack, and Feature 007 native-only operator authority and reserved catalog. SDK
constants, numeric limits, backoff curves, protocol strings, and index internals this
feature intentionally defers are resolved here as explicit deferrals to `plan` and to
the future ADR **Complete MCP Client Lifecycle**, each with a fixed stance and a named
acceptance hook (AC = Acceptance Scenario above), never as open placeholders. This
section fixes the decisions the ADR will formalize; it does not author the ADR (Out of
Scope). Feature 008 owns the MCP runtime and the `mcp.*` domain operation schemas;
Feature 007 owns the registry/auth/audit/adapters and Feature 006 owns the semantic
stack — this session does not move those boundaries.

**C1 — SDK baseline and version/patch path (CQ1).** The pinned baseline is
`@modelcontextprotocol/sdk@1.29.0` targeting protocol **2025-11-25** with negotiated
downgrade (FR7). When session resume, `Last-Event-ID`, or Tasks surface gaps against the
baseline, Feature 008 pins a forward patch/minor of the same major line rather than
forking wire logic; a major SDK jump is a plan/ADR decision with a migration note, never
a silent bump. Missing SDK support for an optional wire feature degrades to a typed
capability gap (FR7, C2), never a hard failure. The exact resolved SDK version is a
provisional plan constant with acceptance hooks AC1, AC12.

**C2 — Connection lifecycle state machine and recorded capabilities (FR7–FR8).** The
client lifecycle is a fixed sequence: `configure → connect(transport) → initialize /
protocol-version negotiate → capability exchange → record → connected`, with terminal
branches `disabled`, `failed`, `needs_auth`, `needs_client_registration` (the existing
`Status` union is authoritative and extends only additively). Negotiated protocol
version and full server capabilities are **recorded per server** for operator query
(`mcp.server.capabilities`) and runtime gating; a capability the server did not advertise
is never exercised. Reconnect re-runs negotiation and emits
`mcp.server.capabilities_changed` when the recorded set differs. Server unavailability is
a typed gap (`mcp_unavailable`) and the session continues (FR7). Exact recorded-capability
struct fields are provisional plan constants with acceptance hooks AC1, AC12, AC16.

**C3 — Event vocabulary and durable/live split; `mcp.tools_changed` naming (FR38; 009
seam).** The FR38 event set is normative. Events divide into a **durable** control-plane
class persisted to EventV2/EventBus for reindex and audit correlation
(`mcp.server.status`, `mcp.server.capabilities_changed`, `mcp.tools_changed`,
`mcp.resources_changed`, `mcp.resource_updated`, `mcp.call.settled`,
`mcp.call.cancelled`, `mcp.task.settled`, `mcp.subscription.*`) and a **live** UI/OTEL
class that is coalesced and never required to persist (`mcp.call.started`,
`mcp.call.progress`, `mcp.task.status`, `mcp.log`). Feature 009 subscribes to the durable
`mcp.tools_changed` and `mcp.resources_changed` as its incremental reindex triggers. The
canonical event **id** is `mcp.tools_changed`; the existing schema literal
`mcp.tools.changed` is renamed to `mcp.tools_changed` at implementation so the wire id,
FR38, and the Feature 009 contract agree — no dual spelling survives. No event carries
full content, URIs, or paths (FR38, FR56). Exact EventV2 payload enums are provisional
plan constants with acceptance hooks AC4, AC9, AC22.

**C4 — Tools pagination and list_changed refresh (FR10–FR11).** `tools/list` is
cursor-paginated with a **duplicate-cursor guard** (a repeated or non-advancing cursor
terminates the walk) and a **max-page bound** that fails closed with a typed error rather
than looping. `notifications/tools/list_changed` refreshes the whole catalog for that
server under the current guard and emits `mcp.tools_changed`; the existing single-shot
`McpCatalog.defs` path is superseded by the paginated walk without changing the cached
`defs[server]` shape consumers read. Exact max-page and per-page bounds are provisional
plan constants with acceptance hooks AC4.

**C5 — outputSchema validation default and error UX (CQ8).** The default validation
policy is **tolerant**: `structuredContent` is validated against `outputSchema` and a
mismatch is surfaced as a typed non-fatal validation warning on the call child while the
result is still spooled and delivered. **Strict** is an operator opt-in per server that
converts a schema mismatch into an `isError`-class tool-execution failure (fail-closed).
Protocol errors remain distinct from tool-execution `isError` in both modes (FR12). Exact
policy config key is a provisional plan constant with acceptance hooks AC8.

**C6 — Tool annotation trust (FR13a).** Tool annotations (`readOnlyHint`,
`destructiveHint`, and peers) are treated as **untrusted** by default and never relied
upon as safety guarantees. Only a server trust profile explicitly elevated by the
operator lets annotations inform UI hints or policy; an unelevated or unknown server
profile ignores them for gating. Trust-profile shape is a provisional plan constant with
acceptance hooks AC26.

**C7 — Progress plumbing and no-op migration (FR14–FR16a).** The client always supplies a
progressToken (the current `onprogress: () => {}` no-op in `convertTool` migrates to a
real sink) so servers emit `notifications/progress`; `resetTimeoutOnProgress` behavior is
preserved. Wire `progress` is enforced **monotonic** per token; UI/EventBus coalescing and
rate-limiting MAY drop or merge display frames but MUST NOT rewrite, invent, or decrease
protocol values. Progress updates the Feature 002 Process Table child and OTEL counters
and **never** enters LLM context/turns or is persisted as tool output by default. Coalesce
window and OTEL bucket bounds are provisional plan constants with acceptance hooks AC5,
AC22.

**C8 — Cancellation wire-path split (FR17–FR18, FR44).** A standard (non-task-augmented)
in-flight `tools/call` cancels via `notifications/cancelled` for that request id, driven
by `AbortSignal` (the existing `signal: options.abortSignal`) or the Feature 002 Ctrl+C
root tree. A task-augmented call cancels via `tasks/cancel`. The Feature 002 root tree
cancels both classes with the correct wire path per child. Local settlement seals/aborts
OutputSpool writers per Feature 005; a remote that does not acknowledge is recorded as
`cancel-requested` / `unknown-remote` (FR17). Acceptance hooks AC7, AC31.

**C9 — Default resource-update policy matrix (CQ3, FR23–FR24).** The default per-server
policy is **notify + cache only**: `resources/updated` coalesces/dedupes/debounces into a
bounded queue with sequence/correlation, updates UI and cache, and emits
`mcp.resource_updated` — **no** re-read, reindex, or main/agent wake. Conditional re-read
and semantic reindex are per-server operator opt-ins; wake is a further opt-in gated by
Feature 002/003 admission (C22). No configuration produces an automatic turn per update
(FR3, FR24; Out of Scope). Queue depth and debounce interval are provisional plan
constants with acceptance hooks AC9, AC10, AC11.

**C10 — Subscribe/unsubscribe authority and fail-closed (FR21).** Runtime resource
list/templates/read reach the LLM only through the canonical adapter under `mcp:server:*`
Permission (the existing `list_mcp_resources` / `list_mcp_resource_templates` /
`read_mcp_resource` tools). Subscribe/unsubscribe require the server `resources.subscribe`
capability **and** operator `mcp.resource.admin.subscribe|unsubscribe`; the LLM never
subscribes. Any unauthorized subscribe/read/delivery fails closed with a typed error.
Acceptance hooks AC9, AC21, AC29.

**C11 — resource_link laziness and auto-fetch budget (FR26).** `resource_link` content
stays lazy: it is surfaced as a reference and auto-fetched only under explicit policy,
Permission, and Feature 001 budget/admission. Arbitrary large linked resources are never
inlined automatically; a fetched link routes through OutputSpool (C16) like any read.
Auto-fetch budget bounds are provisional plan constants with acceptance hooks AC8.

**C12 — URI scheme allowlist defaults (CQ11, FR25).** The default resource URI allowlist
is **`https` and server-declared MCP resource URIs scoped to the negotiated roots**;
`file` is allowed only within authorized project/session roots; every other scheme
(including bare `http` to non-loopback) is deny-by-default and operator-added per server.
Scheme policy prevents sibling-session and cross-project leakage (FR25, Privacy 3). The
concrete allow/deny set is a provisional plan constant with acceptance hooks AC20, AC21,
AC25.

**C13 — Canonical adapter merge and residual presentation (CQ2, FR13).** Top-level tools
and code-mode converge on **one** canonical adapter for policy, permissions, lifecycle
child, OutputSpool, and settlement. The **only** permitted differences after merge are
presentation: code-mode renders the catalog as an API/type surface and may batch or
name-scope calls, while top-level renders individual tool cards; both invoke the same
adapter path with identical behavior (FR13, confirmed decision 4). Acceptance hooks AC14.

**C14 — Transport defaults, SSE deprecation, and reconnect curve (CQ4, CQ16, FR29–FR31).**
New connections **prefer Streamable HTTP**; the existing StreamableHTTP→SSE fallback stays
for compatibility with an explicit operator-visible **deprecation label** on SSE
connections, and legacy SSE is removed no earlier than the ADR-defined deprecation
window (a named future milestone, not this feature). Streamable HTTP reconnect uses
**bounded exponential backoff with jitter and a capped max delay**, honoring session
resume and `Last-Event-ID` where the SDK/spec supports them, under operator reconnect
policy; stdio has no reconnect and instead restarts under lifecycle control with child
cleanup (FR30, the existing `pgrep -P` SIGTERM finalizer). Base delay, cap, jitter, and
max attempts are provisional plan constants with acceptance hooks AC2, AC3, AC12.

**C15 — OAuth and secret cutover to Feature 007 refs (CQ10, FR32).** OAuth tokens,
headers, and secrets move from current storage to **Feature 007 secure references**;
secrets never appear in args, history, output, config JSON, or plain audit. Cutover is a
one-time migration that reads existing `McpAuth` token entries into secure refs and leaves
config surfaces backward-compatible (Compatibility section). No plaintext secret enters a
spool preview shown to the LLM (Security, Privacy 4). Migration mapping is a provisional
plan constant with acceptance hooks AC13.

**C16 — OutputSpool integration and RAM spill honesty (CQ7, FR33–FR35).** Every
`tools/call` and `resources/read` creates a Feature 005 OutputGroup with typed channels;
UI and LLM receive a **bounded preview + OutputRef only**, never a filesystem path (the
current path-in-preview and 10MB inline blob behavior migrate to OutputRef). Because
`@modelcontextprotocol/sdk@1.29.0` parses the final JSON-RPC result in RAM, phases
document (a) a **compatibility post-parse spill** now and (b) a future bounded
transport/parser or negotiated nonstandard extension later; **zero-RAM is never promised**
(Out of Scope). Preview byte bound and spill threshold are provisional plan constants with
acceptance hooks AC6.

**C17 — Base64 blobs, MIME/size limits (FR36).** Base64/data-URL content is decoded and
streamed to spool when possible under **MIME allowlist and size caps**; full data URLs
never enter model context. Audio/image/resource content is size- and MIME-limited before
spooling (FR12, AC8). The existing `MAX_MCP_RESOURCE_BLOB_BYTES` (10MB) and MIME allowlist
are the migration baseline; final caps are provisional plan constants with acceptance
hooks AC8, AC20.

**C18 — Experimental rollout order, scope, and content-stream string (CQ5, CQ6, FR41,
FR45).** `mcp.tasks`, `mcp.sampling`, `mcp.elicitation`, and the nonstandard
content-stream extension are **separate flags, disabled by default, per-server** (global
default off; a server enable never implies another server or another flag). Rollout order
is **tasks → sampling → elicitation → content-stream extension**, each requiring
capability negotiation + operator `mcp.experimental.enable` + per-server policy. The
content-stream extension advertises under a reserved namespaced capability string
`experimental/opencode.contentStream` (namespaced, capability-negotiated, never silent);
absence falls back to final `CallToolResult` + progress metadata (FR6, AC19). The exact
capability string is confirmed here and re-validated at plan against SDK experimental
conventions with acceptance hooks AC16, AC19.

**C19 — Sampling permission shape and gates (CQ13, FR46).** When `mcp.sampling` is enabled
for a server, a server-initiated sampling request requires **explicit per-agent/per-model
Permission** and passes through Feature 001 Smart routing, budgets, LangLock, and privacy
unchanged — sampling never bypasses them. The permission pattern is
`mcp:<server>:sampling` under the runtime Permission model, distinct from the operator
`mcp.experimental.*` enable authority. Audit records the approval path (Security). Exact
permission grammar is a provisional plan constant with acceptance hooks AC17.

**C20 — Elicitation and `input_required` operator surfacing (CQ13, CQ17, FR47).** With
`mcp.elicitation` enabled, every elicitation request and every Tasks
`notifications/tasks/status: input_required` surfaces to the **operator UI**; the model
never silently auto-answers, and sensitive-mode restrictions block model-mediated answers
outright. `input_required` is treated as a lifecycle prompt, never as partial tool content
(FR47, FR32-Tasks). Agent-mediated input, when permitted, is an explicit per-server
operator policy, not a default. Acceptance hooks AC18, AC32.

**C21 — Resource semantic-index opt-in seam (CQ14, FR23, FR53; honors 006 C21).** Feature
008 owns the **opt-in trigger** for MCP resource semantic indexing; Feature 006 owns the
stack, the binding generation, and the classification taxonomy. No reindex runs without
operator opt-in **and** a Feature 006 classification decision; when enabled, a qualifying
`resources/updated` (per C9 policy) emits a single reindex trigger consumed by Feature 006
under its admission ladder — Feature 008 never embeds, ranks, or stores vectors. This is
the single MCP-resource reindex trigger Feature 009 CQ10 references. Acceptance hooks
AC28.

**C22 — Wake budgets and admission for resource policy (CQ15, FR24; Features 002/003).**
Conditional wake from a resource update is **admission-controlled**: at most one wake per
qualifying semantic-policy event, gated by Feature 001 budget and a Feature 002/003
admission/safe-boundary check, with the decision audited. No update path produces an
unbounded or per-update wake. Budget and admission thresholds are owned by Features
001/002/003 and consumed here, not redefined; the provisional per-server wake ceiling is
a plan constant with acceptance hooks AC10, AC11.

**C23 — Logging retention and redaction depth (CQ9, FR28).** MCP `notifications/message`
logging integrates with native logging under **redaction (secrets, tokens, and
path-shaped fields stripped) and rate limits**; retention follows the native logging
retention policy, not a separate MCP store. Operator `logging/setLevel` is Feature 007
`mcp.logging.level.set` only, audited. Redaction rule set and rate bound are provisional
plan constants with acceptance hooks AC24.

**C24 — Prompt/resource trust UX (CQ12, FR27, Security).** Untrusted MCP prompt/resource
content carries **provenance and untrusted-content labels** in UI and in the context
boundary so injection text is never treated as trusted system instruction; size and
decompression-bomb limits reject oversized payloads before delivery. Confirmation is
required for auto-fetch of linked or elevated-risk content (C11). Prompts remain runtime
content under Permission, never Feature 007 admin IDs (FR27). Label/badge vocabulary is a
provisional plan constant with acceptance hooks AC20, AC23.

**C25 — Reserved catalog relationship and schema ownership (FR48–FR50).** Feature 008 owns
the **domain schemas** for the operator-only `mcp.*` operation IDs; Feature 007 owns the
**registry** and enforces principal/auth/CAS/audit/adapters. The reserved set is fixed at
`RESERVED_CATALOG_VERSION` **1.3.0** and comprises exactly the 30 IDs across
`mcp.server.*` (11), `mcp.auth.*` (4), `mcp.resource.admin.*` (7), `mcp.logging.level.*`
(2), `mcp.experimental.*` (3), and `mcp.extension.*` (3); the runtime data plane never
registers these and the LLM/ToolRegistry/MCP/custom/`session.command` paths never reach
them (no dual authority). Runtime MCP tool registration that would collide with a reserved
id fails closed with no silent rename (the existing `checkReservedRegistrationName` /
`toolNameIfAllowed` guard). Any future `mcp.*` id is a coordinated 007/008 catalog bump,
not a unilateral add. Acceptance hooks AC15, AC29.

**C26 — Content-free observability set (FR54–FR56, ADR-0001).** Spans cover connect,
capability negotiation, list, call, progress, read, subscribe, reconnect, cancel, and task
status/result. Metrics are **bounded-enum only**: latency histograms, progress count,
bytes spooled, reconnect count, update-coalesce count, and failures. URIs, content, call
IDs, and session IDs never appear as metric labels; Process Table child IDs correlate on
traces, not labels (FR56, Privacy). Exact metric names and bucket boundaries are
provisional plan constants with acceptance hooks AC22.

**C27 — Migration and consumer compatibility (Compatibility section).** Existing
`MCP.Service` consumers (the tool registry via `tools()`, code-mode `describeCatalog`, and
the `list_mcp_resources` / `read_mcp_resource` runtime tools) keep their current interface
shape; Feature 008 completes lifecycle behind these seams without breaking operator
configs. The cached `defs[server]` structure, the `Status` union, and the `mcp:server:*`
Permission grammar are compatibility surfaces that extend additively. Operator resource
surfaces rename to `mcp.resource.admin.*` (schemas owned by 008, registry by 007) with the
prior behavior preserved. Consumer-migration inventory is a provisional plan constant with
acceptance hooks AC14, AC29.
