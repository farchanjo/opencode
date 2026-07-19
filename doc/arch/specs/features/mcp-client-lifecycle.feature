# Source: doc/arch/sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md
# (FR1-FR57, AC1-AC33, C1-C27) and ADR-0009 (Complete MCP Client Lifecycle and
# Content Plane, proposed). Prose-style scenarios describe intended behavior
# precisely enough for later automation; they do not require concrete step
# bindings.

Feature: Complete MCP Client Tools and Resources Lifecycle
  As an operator and a permitted agent
  I want a complete 2025-11-25 MCP client with a native lifecycle, content, and management plane
  So that tools and resources work end-to-end without a second authority, a content leak, or a silent auto-loop

  # ---------------------------------------------------------------------------
  # Capability negotiation and recorded capabilities (FR7-FR9, C1, C2, AC1)
  # ---------------------------------------------------------------------------

  Scenario: A Streamable HTTP connect negotiates protocol version and records server capabilities
    Given a remote MCP server supporting Streamable HTTP and protocol "2025-11-25"
    When the operator issues "mcp.server.connect"
    Then the client negotiates the protocol version with downgrade support
    And the negotiated capabilities are recorded per server for the "mcp.server.capabilities" query

  Scenario: An unadvertised server capability is never exercised
    Given a connected server whose recorded capabilities omit "resources.subscribe"
    When a runtime or operator path attempts a subscribe
    Then the attempt is rejected because the capability was never advertised

  Scenario: Server unavailability degrades to the typed mcp_unavailable gap
    Given a configured MCP server that cannot be reached
    When the client attempts to connect
    Then the connection records a typed "mcp_unavailable" capability gap
    And the session continues rather than a hard failure

  # ---------------------------------------------------------------------------
  # Reconnect with backoff, resume, and Last-Event-ID (C14, AC2, AC3, AC12)
  # ---------------------------------------------------------------------------

  Scenario: A Streamable HTTP drop reconnects under bounded backoff with resume
    Given a connected Streamable HTTP server with session resume and Last-Event-ID support
    When the transport drops
    Then the client enters "reconnecting" under bounded exponential backoff with jitter and a capped max delay
    And reconnect resumes using session resume and the last "Last-Event-ID" where supported

  Scenario: Reconnect emits capabilities_changed only when the recorded set differs
    Given a reconnect that re-runs capability negotiation
    When the freshly negotiated capability set differs from the previously recorded set
    Then "mcp.server.capabilities_changed" is emitted
    And an identical re-negotiated set emits no event

  Scenario: A stdio server restarts under lifecycle control instead of backoff
    Given a stdio MCP server process that exits unexpectedly
    When lifecycle control restarts it
    Then the restart runs without a backoff curve
    And the SIGTERM child-cleanup finalizer runs before the restart

  # ---------------------------------------------------------------------------
  # Tools pagination and duplicate-cursor guard (C4, AC4)
  # ---------------------------------------------------------------------------

  Scenario: A cursor-paginated tools/list walk completes without a guard trip
    Given a server tools/list catalog spanning multiple pages
    When the catalog walker performs the paginated walk
    Then every page is consumed in order
    And the cached "defs[server]" shape is replaced only once the walk completes

  Scenario: A duplicate or non-advancing cursor trips the guard and fails closed
    Given a tools/list page response that repeats the previous cursor
    When the catalog walker observes the repeated cursor
    Then the walk fails closed with a typed "cursor_guard_tripped" error
    And the prior "defs[server]" catalog is retained

  Scenario: A max-page breach fails closed rather than looping forever
    Given a tools/list walk that exceeds the configured max-page bound
    When the bound is reached
    Then the walk fails closed with a typed "max_page_exceeded" error

  # ---------------------------------------------------------------------------
  # list_changed -> mcp.tools_changed and the Feature 009 reindex seam (C3, AC4, AC9)
  # ---------------------------------------------------------------------------

  Scenario: tools/list_changed refreshes the catalog and emits the single canonical event
    Given a connected server declaring "tools.listChanged"
    When the server emits "notifications/tools/list_changed"
    Then the client refreshes the tool catalog for that server
    And "mcp.tools_changed" is emitted without tool content, never the retired "mcp.tools.changed" spelling

  Scenario: Feature 009 consumes mcp.tools_changed as its incremental reindex trigger
    Given the durable "mcp.tools_changed" event for a server
    When Feature 009 subscribes to the durable event stream
    Then it receives exactly one canonical spelling as its reindex trigger
    And no dual-spelling event survives to confuse the consumer

  # ---------------------------------------------------------------------------
  # outputSchema tolerant vs strict (C5, AC8)
  # ---------------------------------------------------------------------------

  Scenario: The tolerant default surfaces a schema mismatch as a non-fatal warning
    Given a server tool with an "outputSchema" and a default tolerant validation policy
    When "structuredContent" fails to validate against "outputSchema"
    Then a typed non-fatal validation warning attaches to the call child
    And the result is still spooled and delivered

  Scenario: Strict opt-in converts a schema mismatch into an isError failure
    Given a server whose operator selected strict outputSchema validation
    When "structuredContent" fails to validate against "outputSchema"
    Then the call settles as an "isError" tool-execution failure
    And the failure remains distinct from a protocol-level error

  # ---------------------------------------------------------------------------
  # Resource update policy: notify+cache-only default (C9, AC9, AC10)
  # ---------------------------------------------------------------------------

  Scenario: The default resource-update policy notifies and caches without a re-read
    Given a subscribed resource under the fixed "notify_cache_only" default policy
    When "notifications/resources/updated" arrives
    Then the update coalesces into the bounded queue and updates UI and cache
    And no re-read, reindex, or main/agent wake occurs

  Scenario: Conditional re-read is a separate per-server opt-in never implied by the default
    Given a server whose operator opted into conditional re-read
    When a qualifying "resources/updated" arrives
    Then an authorized re-read occurs under that explicit opt-in
    And a server without the opt-in never re-reads automatically

  # ---------------------------------------------------------------------------
  # Subscribe permission gate + LLM never subscribes (C10, AC9, AC21, AC29)
  # ---------------------------------------------------------------------------

  Scenario: Subscribe requires both the server capability and the operator grant
    Given a server declaring "resources.subscribe" and an operator holding "mcp.resource.admin.subscribe"
    When the operator issues subscribe for a resource URI
    Then the subscription moves from "unsubscribed" to "subscribing" to "subscribed"

  Scenario: The LLM cannot reach the subscribe operator command
    Given an LLM turn attempting "mcp.resource.admin.subscribe"
    When the attempt is dispatched
    Then it is denied because runtime paths never reach Feature 007 mcp.* command IDs

  Scenario: An unauthorized subscribe fails closed
    Given a subscribe request missing the operator grant or the server capability
    When the request is evaluated
    Then it fails closed with a typed error
    And the subscription state remains "unsubscribed" or moves to "fail_closed"

  # ---------------------------------------------------------------------------
  # Lazy resource_link (C11, AC8)
  # ---------------------------------------------------------------------------

  Scenario: A resource_link is surfaced as a reference and never auto-inlined
    Given a tool result containing a "resource_link" content item
    When the result is delivered to the canonical adapter
    Then the link stays a lazy reference
    And no automatic fetch occurs without explicit policy, Permission, and budget

  Scenario: A policy-permitted resource_link fetch still routes through OutputSpool
    Given a resource_link fetch authorized under policy, Permission, and the Feature 001 budget
    When the fetch executes
    Then the fetched content routes through the same OutputSpool bridge as any read
    And the LLM receives only a bounded preview and an OutputRef

  # ---------------------------------------------------------------------------
  # URI allowlist rejection (C12, AC20, AC21, AC25)
  # ---------------------------------------------------------------------------

  Scenario Outline: The default URI allowlist accepts or rejects a scheme by policy
    Given a resource URI with scheme "<scheme>" and root scope "<root-scope>"
    When the URI allowlist evaluates the request
    Then the outcome is "<outcome>"

    Examples:
      | scheme | root-scope               | outcome         |
      | https  | server-declared          | allow           |
      | file   | within authorized root   | allow           |
      | file   | outside authorized root  | deny_by_default |
      | http   | non-loopback             | deny_by_default |

  Scenario: A cross-project resource URI is denied even with a valid scheme
    Given a resource URI scoped to project B and a principal authorized only for project A
    When the resource is requested
    Then access fails closed
    And no sibling-session or cross-project content is delivered

  # ---------------------------------------------------------------------------
  # OAuth via SecretRef, no plaintext (C15, AC13)
  # ---------------------------------------------------------------------------

  Scenario: OAuth start/finish stores tokens as Feature 007 secure references only
    Given an OAuth MCP server and an operator running "mcp.auth.start" then "mcp.auth.finish"
    When the flow completes
    Then the resulting token is stored as a SecretRef
    And no plaintext token appears in args, history, output, config JSON, or plain audit

  Scenario: Existing McpAuth token entries migrate to secure refs without breaking config
    Given a pre-migration McpAuth token entry
    When the one-time OAuth cutover migration runs
    Then the entry resolves through a Feature 007 SecretRef
    And the existing config surface remains backward-compatible

  # ---------------------------------------------------------------------------
  # Spooled content, bounded preview, decompression-bomb rejection (C16, C17, C24, AC6, AC8, AC20)
  # ---------------------------------------------------------------------------

  Scenario: A large tool result is delivered as a bounded preview and OutputRef, never a path
    Given a tool result approximately 50MB in size
    When the call settles
    Then the UI and LLM receive a bounded preview plus an OutputRef only
    And no filesystem path is ever exposed

  Scenario: The SDK's in-RAM final parse is honestly documented with a post-parse spill
    Given the pinned @modelcontextprotocol/sdk parses the final JSON-RPC result in RAM
    When the OutputSpool bridge processes that result
    Then it performs a compatibility post-parse spill
    And zero-RAM parsing is never promised

  Scenario: Base64/data-URL content decodes to spool under MIME and size caps
    Given a tool result containing a base64-encoded blob
    When the blob exceeds the MIME allowlist or the size cap
    Then the blob is rejected or truncated before it reaches model context
    And no full data URL enters model context

  Scenario: An oversized or decompression-bomb payload is rejected before delivery
    Given an untrusted resource or prompt payload that would decompress far beyond its declared size
    When the payload is evaluated before delivery
    Then it is rejected under the size and decompression-bomb limits
    And the injection text is never treated as trusted system instruction

  # ---------------------------------------------------------------------------
  # Sampling deny-by-default + permission grant (C19, AC16, AC17)
  # ---------------------------------------------------------------------------

  Scenario: Sampling is off by default and a bare server request is not accepted
    Given a fresh install with "mcp.sampling" disabled
    When a server requests sampling
    Then the request is not accepted
    And no client sampling capability was advertised

  Scenario: An enabled sampling request still requires per-agent permission and passes through Smart/budget/LangLock
    Given an operator enabled "mcp.sampling" for a server
    When the server requests sampling
    Then the request requires the "mcp:<server>:sampling" per-agent Permission
    And approval passes through Feature 001 Smart routing, budgets, LangLock, and privacy unchanged

  # ---------------------------------------------------------------------------
  # Elicitation operator-surfaced (C20, AC18, AC32)
  # ---------------------------------------------------------------------------

  Scenario: Every elicitation request surfaces to the operator UI, never a silent model answer
    Given "mcp.elicitation" enabled for a server
    When the server sends an elicitation request
    Then the request surfaces to the operator UI
    And the model cannot silently auto-answer it

  Scenario: tasks/status input_required is treated as a lifecycle prompt, not partial content
    Given a task-augmented call reporting "notifications/tasks/status" with "input_required"
    When the notification is received
    Then it surfaces as a lifecycle prompt to the operator or an explicitly permitted agent policy
    And it is never treated as partial tool content

  # ---------------------------------------------------------------------------
  # Semantic-index opt-in trigger (C21, AC28)
  # ---------------------------------------------------------------------------

  Scenario: No semantic reindex runs without operator opt-in and Feature 006 classification
    Given a resource update on a server without semantic-reindex opt-in
    When the update arrives
    Then no Feature 006 reindex runs

  Scenario: An opted-in qualifying update emits exactly one reindex trigger
    Given a server with semantic-reindex opt-in and a Feature 006 classification decision
    When a qualifying "resources/updated" arrives under the C9 policy
    Then exactly one reindex trigger is emitted
    And Feature 008 never embeds, ranks, or stores vectors itself

  # ---------------------------------------------------------------------------
  # Reserved catalog authority: 30 mcp.* IDs (C25, AC15, AC29)
  # ---------------------------------------------------------------------------

  Scenario Outline: Reserved mcp.* command IDs are native-only and served from the existing catalog
    Given the reserved "<command>" command ID already declared at RESERVED_CATALOG_VERSION "1.3.0"
    When an authorized operator principal issues it through Settings, palette, native-slash, or CLI
    Then it is served with zero provider/model calls, tokens, or cost
    And it is served outside the transcript, ToolRegistry, and MCP surfaces

    Examples:
      | command                      |
      | mcp.server.status            |
      | mcp.server.capabilities      |
      | mcp.auth.status              |
      | mcp.resource.admin.subscribe |
      | mcp.logging.level.set        |
      | mcp.experimental.enable      |
      | mcp.extension.enable         |

  Scenario: A plugin, MCP server, or custom registry cannot register a reserved mcp.* name
    Given a plugin, MCP server, or custom command registry attempting to register "mcp.server.status"
    When registration is attempted
    Then the attempt is rejected with a structured "reserved_name" error
    And the canonical Feature 007/008 implementation remains the sole owner

  Scenario: The reserved mcp.* catalog stays at exactly 30 IDs with no bump for this feature
    Given RESERVED_CATALOG_VERSION "1.3.0" declaring the mcp.* groups server(11), auth(4), resource.admin(7), logging.level(2), experimental(3), extension(3)
    When Feature 008 ships its runtime completeness
    Then the total remains exactly 30 reserved mcp.* IDs
    And any future id is a coordinated Feature 007/008 catalog bump, never a unilateral add

  # ---------------------------------------------------------------------------
  # Content-free telemetry (C26, AC22)
  # ---------------------------------------------------------------------------

  Scenario: mcp.* spans and metrics never carry URI, content, call, or session identifiers as labels
    Given connect, call, progress, read, subscribe, reconnect, cancel, and task activity across a session
    When spans and metrics export
    Then labels are bounded-enum only
    And no URI, content, call ID, or session ID appears as a metric label

  # ---------------------------------------------------------------------------
  # Consumer compatibility: tools()/describeCatalog (C27, AC14, AC29)
  # ---------------------------------------------------------------------------

  Scenario: The tool registry and code-mode share one canonical adapter with matching behavior
    Given the same tool invoked once through the top-level tool registry "tools()" and once through code-mode "describeCatalog"
    When both calls complete
    Then policy, permissions, lifecycle child, OutputSpool, and settlement behavior match
    And only the presentation differs between the two surfaces

  Scenario: Existing MCP.Service consumers keep their current interface shape
    Given the existing "tools()", "describeCatalog", "list_mcp_resources", and "read_mcp_resource" consumers
    When Feature 008 completes MCP lifecycle behind these seams
    Then each consumer keeps its current interface shape
    And the "defs[server]" structure, the Status union, and the "mcp:server:*" Permission grammar extend only additively

  # ---------------------------------------------------------------------------
  # Cancellation wire-path split (FR17, FR18, C8, AC7, AC31)
  # ---------------------------------------------------------------------------

  Scenario: A standard in-flight call cancels via notifications/cancelled
    Given an in-flight standard non-task-augmented "tools/call"
    When the user cancels via AbortSignal or the Feature 002 Ctrl+C root tree
    Then the client sends "notifications/cancelled" for that request id
    And the OutputSpool writer is sealed or aborted per Feature 005

  Scenario: A task-augmented call cancels via tasks/cancel instead
    Given "mcp.tasks" enabled and an in-flight task-augmented call
    When the user cancels via AbortSignal or the Feature 002 Ctrl+C root tree
    Then the client uses "tasks/cancel" rather than only "notifications/cancelled"
    And the task reaches a cancelled or failed terminal status

  Scenario: An unacknowledged remote cancel is recorded, never silently dropped
    Given a cancel request the remote never acknowledges
    When local settlement completes
    Then the outcome is recorded as "cancel-requested" or "unknown-remote"
    And it is never silently treated as a clean success
