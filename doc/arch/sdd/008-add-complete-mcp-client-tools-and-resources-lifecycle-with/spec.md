---
id: 019f7184-70b5-7f83-bd9a-ed019572f111
number: 008
slug: add-complete-mcp-client-tools-and-resources-lifecycle-with
status: specified
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
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003 Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
  (proposed)

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
