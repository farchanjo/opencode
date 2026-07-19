# Data Model: Complete MCP Client Tools and Resources Lifecycle (Feature 008)

Feature: [008 Complete MCP Client Tools and Resources Lifecycle](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
ADR: [ADR-0009 Complete MCP Client Lifecycle and Content Plane](../../adr/0009-mcp-client-lifecycle-and-content-plane.md) (proposed)
Status: draft (finalized in the tasks phase; SDK version, recorded-capability struct
fields, page/queue/backoff bounds, preview/spill/MIME caps, the content-stream capability
string, permission grammar, redaction rules, and metric buckets are provisional plan
constants resolved in ADR-0009 and the tasks phase — C1–C27)

Two record families here are the single source of truth and nothing else is: the
**`McpServerProfile`** aggregate owns the operator-pinned per-server configuration
(transport, auth ref, trust profile, default resource-update policy, outputSchema mode,
and experimental flags) (FR48), and the **`McpConnection`** aggregate owns the recorded
per-server negotiated capability set and the lifecycle state (FR7, FR8, C2). Feature 007
references these schemas and exposes the 30 operator-only `mcp.*` commands without
redefining or diverging the field sets (FR48, C25). Every other shape below is a
**derived runtime projection or a transient value object** — never a second management
authority beside Feature 007, a second content-plane identity beside Feature 005, a
second lifecycle/Process Table beside Feature 002, or a Smart-routing decider beside
Feature 001 (FR13, C13, C16, C25, C27). Tool-catalog entries, resource descriptors, and
prompt descriptors are projections revalidated against the live `MCP.Service` seams
before delivery; the cached `defs[server]` shape, the `Status` union, and the
`mcp:server:*` Permission grammar extend additively (C4, C27). No record embeds a secret,
a full tool/resource body, a data URL, a filesystem path, or a raw token; credentials are
Feature 007 SecretPort refs only, and every call/read body is reached through a Feature
005 OutputRef (FR32, FR34, C15, C16, C17).

Durable `mcp.*` control-plane events register through EventV2/EventBus for reindex and
audit correlation; live `mcp.*` UI/OTEL events are coalesced and never required to
persist (FR38, C3). The canonical event id is `mcp.tools_changed`; the existing schema
literal `mcp.tools.changed` in `packages/schema/src/mcp-event.ts` is renamed to it at
implementation so the wire id, FR38, and the Feature 009 reindex trigger agree — no dual
spelling survives (C3). Telemetry is content-free per ADR-0001: labels never carry URIs,
content, call IDs, or session IDs; Process Table child IDs correlate on traces, not labels
(FR56, C26).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface, matching
`packages/schema/src/schema.ts` and the existing `packages/schema/src/lifecycle/**`,
`jobs/**`, `langlock/**`, `outputspool/**`, and `semantic/**` modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- **Annotate-first on a plain base for every checked scalar.** Each identifier, counter,
  bound, and bounded-text ValueObject is built on the plain `Schema.String` /
  `Schema.Number` base, `.annotate({ identifier })` is applied BEFORE any `.check(...)`,
  and `Schema.brand(...)` (where the CUE definition is identifier-shaped) is applied last.
  Annotating an already-checked schema drops the root identifier from `.ast.annotations`
  in favor of the last check, so base-then-check-then-brand is load-bearing for contract
  hygiene (see `packages/schema/src/lifecycle/ids.ts` and `test/contract-hygiene.test.ts`).
- Counters, page bounds, and byte windows fold `Schema.isInt()` into the check chain
  alongside the bound check. Wire `progress` and `total` are **deliberately real-valued**
  (`Schema.Number`, no `isInt`) because the MCP progress value is fractional; they are
  enforced monotonic per token at the boundary, not by the schema (FR15, C7).
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- Epoch-millis observational timestamps decode through `DateTimeUtcFromMillis`; the CUE
  mirror carries the ISO-8601 `#Timestamp` string form.
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / `Schema.Number` (bare)
  forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/mcp/**` and mirrors a CUE
definition under `doc/arch/schemas/mcp/*.cue` one-to-one. The CUE packages are
`mcp.shared`, `mcp.enums`, `mcp.capability`, `mcp.server`, `mcp.connection`, `mcp.tools`,
`mcp.resources`, `mcp.prompts`, `mcp.content`, `mcp.runtime`, `mcp.tasks`, and
`mcp.events`.

---

## Shared identifiers

Name parity with `lifecycle.shared`, `outputspool.shared`, and `semantic.shared` is
intentional; this feature does not cross-import those modules, so the identifier concepts
are re-declared locally (FR7, FR48, C2, C25). Mirrors `doc/arch/schemas/mcp/ids.cue`.

```typescript
// packages/schema/src/mcp/ids.ts (new)

import { Schema } from "effect"

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const namePattern = /^[A-Za-z0-9_.:-]{1,160}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// ServerId identifies one McpServerProfile aggregate — one configured MCP server (FR48, C2).
export const ServerId = Schema.String.annotate({ identifier: "McpIds.ServerId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.ServerId"))
export type ServerId = typeof ServerId.Type

// ConnectionId identifies one McpConnection aggregate — one live lifecycle attempt (FR7, C2).
export const ConnectionId = Schema.String.annotate({ identifier: "McpIds.ConnectionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.ConnectionId"))

// ToolName keys one McpToolCatalogEntry entity; stable across paginated refresh (FR10, C4).
export const ToolName = Schema.String.annotate({ identifier: "McpIds.ToolName" })
  .check(Schema.isPattern(namePattern)).pipe(Schema.brand("Mcp.ToolName"))

// PromptName keys one McpPromptDescriptor entity (FR27, C24).
export const PromptName = Schema.String.annotate({ identifier: "McpIds.PromptName" })
  .check(Schema.isPattern(namePattern)).pipe(Schema.brand("Mcp.PromptName"))

// RequestId is the opaque JSON-RPC request id correlating a call to its settlement (FR2, FR17, C8).
export const RequestId = Schema.String.annotate({ identifier: "McpIds.RequestId" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.RequestId"))

// TaskId identifies one McpTask entity in the experimental Tasks lifecycle (FR41, C18).
export const TaskId = Schema.String.annotate({ identifier: "McpIds.TaskId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.TaskId"))

// ProgressToken is the opaque per-call progress token (FR14, C7).
export const ProgressToken = Schema.String.annotate({ identifier: "McpIds.ProgressToken" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.ProgressToken"))

// SubscriptionId identifies one operator-granted ResourceSubscription entity (FR21, C10).
export const SubscriptionId = Schema.String.annotate({ identifier: "McpIds.SubscriptionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.SubscriptionId"))

// EventId is the EventV2 evt_ id assigned per published mcp.* event (FR38, C3).
export const EventId = Schema.String.annotate({ identifier: "McpIds.EventId" })
  .check(Schema.isPattern(eventIdPattern)).pipe(Schema.brand("Mcp.EventId"))
```

Cross-reference, secret, principal, and scope ValueObjects keep opaque handles only; a
credential is a Feature 007 SecretPort ref, a content handle is a Feature 005 OutputRef,
and a process ref is a Feature 002 Process Table child — never raw material, a filesystem
path, or an OS PID (FR32, FR34, FR39, C8, C15, C16). Mirrors `refs.cue` and
`correlation.cue`.

```typescript
// packages/schema/src/mcp/refs.ts (new)

// SecretRef / HeaderRef are Feature 007 SecretPort secure references — never raw material (FR32, C15).
export const SecretRef = Schema.String.annotate({ identifier: "McpRefs.SecretRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.SecretRef"))
export const HeaderRef = Schema.String.annotate({ identifier: "McpRefs.HeaderRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.HeaderRef"))

// OperatorRef is the operator principal re-evaluated per action; never the LLM (FR48, C25).
export const OperatorRef = Schema.String.annotate({ identifier: "McpRefs.OperatorRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.OperatorRef"))

// PermissionRef gates a runtime call/read under the mcp:server:* Permission model (FR50, C10).
export const PermissionRef = Schema.String.annotate({ identifier: "McpRefs.PermissionRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.PermissionRef"))

// OutputRef is a Feature 005 OutputSpool content handle — never a filesystem path (FR34, C16).
export const OutputRef = Schema.String.annotate({ identifier: "McpRefs.OutputRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Mcp.OutputRef"))

// GroupId references the Feature 005 OutputGroup created per call/read (FR33, C16).
export const GroupId = Schema.String.annotate({ identifier: "McpRefs.GroupId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.GroupId"))

// ProcessId references the Feature 002 Process Table child — never an OS PID (FR39, C8).
export const ProcessId = Schema.String.annotate({ identifier: "McpRefs.ProcessId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.ProcessId"))

// Scope and correlation handles; project/session confine every URI and root (FR25, C12).
export const ProjectId = Schema.String.annotate({ identifier: "McpRefs.ProjectId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.ProjectId"))
export const SessionId = Schema.String.annotate({ identifier: "McpRefs.SessionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.SessionId"))
export const CorrelationId = Schema.String.annotate({ identifier: "McpRefs.CorrelationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.CorrelationId"))
export const CausationId = Schema.String.annotate({ identifier: "McpRefs.CausationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Mcp.CausationId"))
```

---

## Numeric, text, and URI values

Page index/size and max-page are the cursor-pagination guard bounds (FR10, C4); byte
length is a spooled byte count, never inline content (FR34, C16); attempt count and
duration parametrise the bounded reconnect backoff curve (FR29, C14). Wire `progress` and
`total` are real-valued and enforced monotonic per token at the boundary (FR15, C7).
Mirrors `values.cue`.

```typescript
// packages/schema/src/mcp/values.ts (new)

export const SchemaVersion = Schema.Number.annotate({ identifier: "McpValues.SchemaVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // EventV2 durable.version mirror (FR38, C3)
export const Sequence = Schema.Number.annotate({ identifier: "McpValues.Sequence" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // per-aggregate coalesced order (FR23, C9)
export const PageIndex = Schema.Number.annotate({ identifier: "McpValues.PageIndex" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // paginated-walk page counter (FR10, C4)
export const PageSize = Schema.Number.annotate({ identifier: "McpValues.PageSize" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // bounded per-page count (FR10, C4)
export const MaxPages = Schema.Number.annotate({ identifier: "McpValues.MaxPages" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))          // max-page fail-closed bound (FR10, C4)
export const ByteLength = Schema.Number.annotate({ identifier: "McpValues.ByteLength" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // spooled byte count (FR34, C16)
export const AttemptCount = Schema.Number.annotate({ identifier: "McpValues.AttemptCount" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // reconnect attempt under the cap (FR29, C14)
export const DurationMillis = Schema.Number.annotate({ identifier: "McpValues.DurationMillis" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) // backoff/debounce delay (FR29, C14)

// Real-valued wire progress (deliberately not isInt); monotonic per token at boundary (FR15, C7).
export const Progress = Schema.Number.annotate({ identifier: "McpValues.Progress" })
  .check(Schema.isGreaterThanOrEqualTo(0))
export const Total = Schema.Number.annotate({ identifier: "McpValues.Total" })
  .check(Schema.isGreaterThanOrEqualTo(0))
```

Bounded content-classified text is sanitized metadata, classification, or a bounded label
— never a secret, full body, prompt, reasoning trace, or filesystem path (FR34, FR56, C16,
C26). A provenance label marks untrusted external content at the context boundary (FR27,
C24); redacted text is a bounded, secret-stripped log/metadata slice (FR28, C23); a cursor
is an opaque pagination token (FR10, C4). Mirrors `text-values.cue`.

```typescript
// packages/schema/src/mcp/text-values.ts (new)

export const ServerName = Schema.String.annotate({ identifier: "McpText.ServerName" }).check(Schema.isNonEmpty())
export const ProtocolVersion = Schema.String.annotate({ identifier: "McpText.ProtocolVersion" }).check(Schema.isNonEmpty()) // 2025-11-25 (FR7, C2)
export const Reason = Schema.String.annotate({ identifier: "McpText.Reason" })                   // bounded typed reason (FR7)
export const DisplayLabel = Schema.String.annotate({ identifier: "McpText.DisplayLabel" }).check(Schema.isNonEmpty())
export const Cursor = Schema.String.annotate({ identifier: "McpText.Cursor" }).check(Schema.isNonEmpty())  // opaque page token (FR10, C4)
export const ProvenanceLabel = Schema.String.annotate({ identifier: "McpText.ProvenanceLabel" }).check(Schema.isNonEmpty()) // untrusted label (FR27, C24)
export const Title = Schema.String.annotate({ identifier: "McpText.Title" })                     // bounded human title (FR12, FR57)
export const RedactedText = Schema.String.annotate({ identifier: "McpText.RedactedText" })       // secret-stripped slice (FR28, C23)

// A resource URI is scoped to negotiated roots; a MIME type gates decode-to-spool (FR25, FR36, C12, C17).
export const ResourceUri = Schema.String.annotate({ identifier: "McpUri.ResourceUri" }).check(Schema.isNonEmpty())
export const ResourceTemplateUri = Schema.String.annotate({ identifier: "McpUri.ResourceTemplateUri" }).check(Schema.isNonEmpty())
export const UriScheme = Schema.String.annotate({ identifier: "McpUri.UriScheme" })
  .check(Schema.isPattern(/^[a-z][a-z0-9+.-]*$/))          // https default; file within roots (FR25, C12)
export const RootUri = Schema.String.annotate({ identifier: "McpUri.RootUri" }).check(Schema.isNonEmpty())
export const MimeType = Schema.String.annotate({ identifier: "McpUri.MimeType" })
  .check(Schema.isPattern(/^[a-zA-Z0-9!#$&^_.+-]{1,127}\/[a-zA-Z0-9!#$&^_.+-]{1,127}$/)) // MIME allowlist (FR36, C17)
```

Boolean posture ValueObjects keep bare booleans out of the aggregates; a capability flag
records only what the server advertised and is never exercised unless set (FR7, C2), and a
policy opt-in gates re-read/reindex/wake off by default (FR23, C9). First-class collections
replace bare arrays; each wraps a shared ValueObject element. Mirrors `flags.cue` and
`collections.cue`.

```typescript
// packages/schema/src/mcp/flags.ts (new)

export const Enabled = Schema.Boolean.annotate({ identifier: "McpFlags.Enabled" })
export const Capable = Schema.Boolean.annotate({ identifier: "McpFlags.Capable" })          // negotiated cap; never run unless true (FR7, C2)
export const Hint = Schema.Boolean.annotate({ identifier: "McpFlags.Hint" })                // untrusted annotation hint (FR13a, C6)
export const Supported = Schema.Boolean.annotate({ identifier: "McpFlags.Supported" })
export const OperatorSurfaced = Schema.Boolean.annotate({ identifier: "McpFlags.OperatorSurfaced" }) // elicitation reaches operator (FR47, C20)
export const SensitiveBlocked = Schema.Boolean.annotate({ identifier: "McpFlags.SensitiveBlocked" })
export const PolicyOptin = Schema.Boolean.annotate({ identifier: "McpFlags.PolicyOptin" })  // off-by-default opt-in (FR23, C9)
export const RateLimited = Schema.Boolean.annotate({ identifier: "McpFlags.RateLimited" })
export const Active = Schema.Boolean.annotate({ identifier: "McpFlags.Active" })
export const Coalesced = Schema.Boolean.annotate({ identifier: "McpFlags.Coalesced" })

// First-class collections (collections.cue).
export const HeaderRefSet = Schema.Array(HeaderRef)   // secure outbound header refs (FR32, C15)
export const SchemeSet = Schema.Array(UriScheme)      // URI allowlist; https default (FR25, C12)
export const RootUriList = Schema.Array(RootUri)      // negotiated roots (FR9, C12)
export const MimeTypeSet = Schema.Array(MimeType)     // MIME allowlist (FR36, C17)
export const ToolNameList = Schema.Array(ToolName)    // one catalog page (FR10, C4)
export const SecretRefList = Schema.Array(SecretRef)  // redacted out of a preview (FR32, C15)
```

---

## Enumerations

Core, state, event, and event-type enums mirror `enums.cue`, `enums-state.cue`,
`enums-event.cue`, and `event-types.cue`. Every enum is a ValueObject, never an Entity
(calisthenics). The `ServerStatus` union is authoritative and extends only additively (C2,
C27); the typed `CapabilityGap` never hard-fails a session (FR7, C1, C2).

```typescript
// packages/schema/src/mcp/enums.ts (new)

export const TransportKind = Schema.Literals(["stdio", "streamable-http", "sse"]).annotate({ identifier: "McpEnums.TransportKind" })
export const TrustProfile = Schema.Literals(["untrusted", "elevated"]).annotate({ identifier: "McpEnums.TrustProfile" }) // untrusted default (FR13a, C6)
export const OutputSchemaMode = Schema.Literals(["tolerant", "strict"]).annotate({ identifier: "McpEnums.OutputSchemaMode" }) // tolerant default (FR12, C5)
export const ContentKind = Schema.Literals(["text", "image", "audio", "resource", "resource_link", "structured"]).annotate({ identifier: "McpEnums.ContentKind" })
export const CancelWirePath = Schema.Literals(["notifications_cancelled", "tasks_cancel"]).annotate({ identifier: "McpEnums.CancelWirePath" }) // standard vs task (FR17, FR18, C8)
export const CapabilityGap = Schema.Literals(["none", "mcp_unavailable", "feature_unsupported", "needs_auth", "needs_client_registration"])
  .annotate({ identifier: "McpEnums.CapabilityGap" })     // typed gap; session continues (FR7, C1, C2)
export const TaskSupport = Schema.Literals(["required", "optional", "forbidden"]).annotate({ identifier: "McpEnums.TaskSupport" })
export const LogLevel = Schema.Literals(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]).annotate({ identifier: "McpEnums.LogLevel" })
export const ProvenanceClass = Schema.Literals(["trusted", "external", "untrusted"]).annotate({ identifier: "McpEnums.ProvenanceClass" }) // external is untrusted (FR27, C24)

// packages/schema/src/mcp/enums-state.ts (new)

export const ServerStatus = Schema.Literals(["pending", "connecting", "connected", "disconnected", "failed", "disabled", "needs_auth", "needs_client_registration"])
  .annotate({ identifier: "McpEnums.ServerStatus" })      // authoritative; additive only (FR7, C2, C27)
export const ConnectionState = Schema.Literals(["configured", "connecting", "negotiating", "recording", "connected", "reconnecting"])
  .annotate({ identifier: "McpEnums.ConnectionState" })   // internal lifecycle machine (FR7, C2)
export const TerminalBranch = Schema.Literals(["disabled", "failed", "needs_auth", "needs_client_registration"]).annotate({ identifier: "McpEnums.TerminalBranch" })
export const CatalogState = Schema.Literals(["stale", "walking", "fresh", "guard_tripped"]).annotate({ identifier: "McpEnums.CatalogState" }) // duplicate-cursor guard (FR10, C4)
export const SubscriptionState = Schema.Literals(["unsubscribed", "subscribing", "subscribed", "unsubscribing", "fail_closed"])
  .annotate({ identifier: "McpEnums.SubscriptionState" }) // fail-closed on lost authority (FR21, C10)
export const TaskStatus = Schema.Literals(["working", "input_required", "completed", "failed", "cancelled"]).annotate({ identifier: "McpEnums.TaskStatus" })
export const ResourceUpdatePolicy = Schema.Literals(["notify_cache", "conditional_reread", "reindex", "wake"])
  .annotate({ identifier: "McpEnums.ResourceUpdatePolicy" }) // notify_cache default (FR23, FR24, C9)
export const CallOutcome = Schema.Literals(["completed", "tool_error", "protocol_error", "cancelled"]).annotate({ identifier: "McpEnums.CallOutcome" }) // isError vs protocol (FR12, C5)
export const CancelOutcome = Schema.Literals(["acknowledged", "cancel_requested", "unknown_remote"]).annotate({ identifier: "McpEnums.CancelOutcome" }) // unacknowledged remote (FR17, C8)

// packages/schema/src/mcp/enums-event.ts (new)

export const EventClass = Schema.Literals(["durable", "live"]).annotate({ identifier: "McpEnums.EventClass" })          // durable/live split (FR38, C3)
export const EventSource = Schema.Literals(["operator", "runtime", "server", "reconnector"]).annotate({ identifier: "McpEnums.EventSource" })
export const ActorKind = Schema.Literals(["runtime", "operator"]).annotate({ identifier: "McpEnums.ActorKind" })       // never the LLM (FR48, C25)
export const Visibility = Schema.Literals(["project", "global", "session"]).annotate({ identifier: "McpEnums.Visibility" })
export const CatalogKind = Schema.Literals(["tools", "resources", "prompts"]).annotate({ identifier: "McpEnums.CatalogKind" })

// packages/schema/src/mcp/experimental.ts (new)

export const ExperimentalFlag = Schema.Literals(["tasks", "sampling", "elicitation", "content-stream"]).annotate({ identifier: "McpEnums.ExperimentalFlag" }) // per-server, off default (FR41, C18)
export const FlagState = Schema.Literals(["disabled", "enabled"]).annotate({ identifier: "McpEnums.FlagState" })
export const ContentStreamCapability = Schema.Literal("experimental/opencode.contentStream")     // reserved namespaced string, never silent (FR6, C18)
export const FlagSet = Schema.Array(ExperimentalFlag)
```

The closed `mcp.*` event vocabulary mirrors `event-types.cue`. The canonical id
`mcp.tools_changed` has exactly one spelling shared by FR38, the renamed schema literal,
and the Feature 009 reindex trigger (C3). Ten durable members persist; five live members
are coalesced (C3).

```typescript
// packages/schema/src/mcp/event-types.ts (new)

// The closed 15-member mcp.* vocabulary — 10 durable, 5 live (FR38, C3).
export const McpEventType = Schema.Literals([
  "mcp.server.status", "mcp.server.capabilities_changed", "mcp.tools_changed",
  "mcp.resources_changed", "mcp.resource_updated", "mcp.call.settled",
  "mcp.call.cancelled", "mcp.task.settled", "mcp.subscription.subscribed",
  "mcp.subscription.unsubscribed", "mcp.call.started", "mcp.call.progress",
  "mcp.call.cancel_requested", "mcp.task.status", "mcp.log",
]).annotate({ identifier: "McpEnums.McpEventType" })
export type McpEventType = typeof McpEventType.Type
```

---

## NegotiatedCapabilities record (FR7, FR8, C2)

The per-server capability set recorded at connect for operator query
(`mcp.server.capabilities`) and runtime gating. A capability the server did not advertise
is never exercised; reconnect re-runs negotiation and emits
`mcp.server.capabilities_changed` on a diff (C2). Experimental client capabilities stay off
unless the matching per-server flag is enabled (FR8, C18). Mirrors `capability.cue`.

```typescript
// packages/schema/src/mcp/capability.ts (new)

export const ToolsCapability = Schema.Struct({ list_changed: Capable })
export const ResourcesCapability = Schema.Struct({ subscribe: Capable, list_changed: Capable })
export const PromptsCapability = Schema.Struct({ list_changed: Capable })
export const LoggingCapability = Schema.Struct({ set_level: Capable })
export const ExperimentalCapability = Schema.Struct({
  tasks: Capable, sampling: Capable, elicitation: Capable, content_stream: Capable, // each off unless flag-enabled (FR8, C18)
})

export const NegotiatedCapabilities = Schema.Struct({
  protocol_version: ProtocolVersion,
  tools: ToolsCapability,
  resources: ResourcesCapability,
  prompts: PromptsCapability,
  logging: LoggingCapability,
  experimental: ExperimentalCapability,
  recorded_at: DateTimeUtcFromMillis,     // recorded per server for gating (FR7, C2)
})
export type NegotiatedCapabilities = Schema.Schema.Type<typeof NegotiatedCapabilities>
```

---

## McpServerProfile aggregate (FR48, C2, C15, C18)

The SSOT aggregate root of one configured MCP server. Its identity is `id`; no
LLM/ToolRegistry/MCP/custom/`session.command` path sets, updates, or deletes it —
management is exclusively the operator-only Feature 007 `mcp.*` IDs (FR48, FR50, C25). Its
auth carries Feature 007 SecretRefs only, never plaintext (FR32, C15); its trust profile is
untrusted by default (FR13a, C6); its experimental flags are disabled by default (FR41,
C18). Mirrors `server-profile.cue` and `server-parts.cue`.

```typescript
// packages/schema/src/mcp/server.ts (new)

export const ServerIdentity = Schema.Struct({ name: ServerName, transport: TransportKind })

// Optional secret ref and secure header refs — never raw material (FR32, C15).
export const ServerAuth = Schema.Struct({ secret_ref: Schema.NullOr(SecretRef), headers: HeaderRefSet })

// Trust profile, default update policy, and outputSchema mode (FR13a, FR23, C5, C6, C9).
export const ServerPolicy = Schema.Struct({
  trust_profile: TrustProfile,
  update_policy: ResourceUpdatePolicy,
  output_schema_mode: OutputSchemaMode,
})

export const ServerExperimental = Schema.Struct({ flags: FlagSet }) // disabled by default (FR41, C18)

export const ServerAudit = Schema.Struct({
  enabled: Enabled,
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  selected_by: OperatorRef,               // operator principal; never the LLM (FR48, C25)
})

export const McpServerProfile = Schema.Struct({
  id: ServerId,                           // aggregate-root identity (FR48)
  identity: ServerIdentity,
  auth: ServerAuth,
  policy: ServerPolicy,
  experimental: ServerExperimental,
  audit: ServerAudit,
})
export type McpServerProfile = Schema.Schema.Type<typeof McpServerProfile>
```

---

## McpConnection aggregate + ReconnectPosture (FR7, FR29, C2, C14)

The SSOT aggregate root of one server's live lifecycle. Its identity is `id`; it advances
through `configured → connecting → negotiating → recording → connected` with terminal
branches `disabled`/`failed`/`needs_auth`/`needs_client_registration`, and the
authoritative `Status` union extends only additively (C2, C27). It records the negotiated
capability set and the typed capability gap; `mcp_unavailable` never hard-fails the session
(FR7, C1, C2). A Streamable HTTP drop reconnects under bounded exponential backoff with
jitter and a capped max delay honoring session resume and `Last-Event-ID`; a stdio
connection has no reconnect and restarts under lifecycle control (FR29, FR30, C14). Mirrors
`connection.cue` and `connection-parts.cue`.

```typescript
// packages/schema/src/mcp/connection.ts (new)

// Bounded backoff attempt, delay, and cap for Streamable HTTP reconnect (FR29, C14).
export const ReconnectPosture = Schema.Struct({
  attempt: AttemptCount,
  backoff_millis: DurationMillis,
  max_attempts: AttemptCount,
})

// Last-Event-ID and resume support honored on reconnect where SDK/spec support them (FR29, C14).
export const SessionResume = Schema.Struct({
  last_event_id: Schema.NullOr(Cursor),
  resume_supported: Supported,
  session_id: Schema.NullOr(SessionId),
})

export const McpConnection = Schema.Struct({
  id: ConnectionId,                       // aggregate-root identity (FR7, C2)
  server_ref: ServerId,
  status: ServerStatus,                   // authoritative additive union (FR7, C2, C27)
  state: ConnectionState,
  capabilities: NegotiatedCapabilities,   // recorded per server (FR7, FR8, C2)
  gap: CapabilityGap,                     // typed gap; never hard-fails (FR7, C1, C2)
  reconnect: ReconnectPosture,
})
export type McpConnection = Schema.Schema.Type<typeof McpConnection>
```

---

## McpToolCatalogEntry entity + pagination (FR10, FR13a, C4, C6)

`McpToolCatalogEntry` is one entry in a server's tool catalog; its identity is the tool
name, stable across paginated refreshes, and the cached `defs[server]` shape consumers read
is preserved as the paginated walk supersedes the single-shot path (FR10, FR11, C4, C27).
Its annotations are untrusted unless the server trust profile elevates them (FR13a, C6); a
runtime registration colliding with a reserved `mcp.*` id fails closed with no silent
rename (FR48, C25). The pagination value objects carry the duplicate-cursor guard and the
max-page fail-closed bound (FR10, C4). Mirrors `tool-entry.cue`, `tool-parts.cue`, and
`pagination.cue`.

```typescript
// packages/schema/src/mcp/tools.ts (new)

export const ToolContract = Schema.Struct({
  title: Title,
  output_schema_mode: OutputSchemaMode,
  task_support: TaskSupport,
})

// Untrusted annotation hints; ignored for gating unless the trust profile elevates them (FR13a, C6).
export const ToolAnnotations = Schema.Struct({
  read_only: Hint, destructive: Hint, idempotent: Hint, open_world: Hint,
})

export const McpToolCatalogEntry = Schema.Struct({
  id: ToolName,                           // entity identity — canonical tool name (FR10)
  server_ref: ServerId,
  contract: ToolContract,
  annotations: ToolAnnotations,
  trust_profile: TrustProfile,
})
export type McpToolCatalogEntry = Schema.Schema.Type<typeof McpToolCatalogEntry>

// Cursor pagination — duplicate/non-advancing cursor terminates; max-page fails closed (FR10, C4).
export const CatalogCursor = Schema.Struct({ cursor: Schema.NullOr(Cursor), page_index: PageIndex })
export const PaginationGuard = Schema.Struct({ max_pages: MaxPages, page_size: PageSize, seen_cursor: Schema.NullOr(Cursor) })
export const CatalogPage = Schema.Struct({ tools: ToolNameList, next_cursor: Schema.NullOr(Cursor), page_index: PageIndex })
export type CatalogPage = Schema.Schema.Type<typeof CatalogPage>
```

---

## Resource descriptors, subscription, and update policy (FR19, FR21, FR23, C9, C10, C12)

`McpResourceDescriptor` and `McpResourceTemplate` are runtime projections reachable through
the canonical adapter under `mcp:server:*` Permission — never Feature 007 admin IDs (FR19,
C10, C25). Each identity is a URI scoped to the negotiated roots; a `file` URI is confined
to authorized project/session roots and every non-allowlisted scheme is deny-by-default
(FR25, C12). `ResourceSubscription` is the operator-granted subscription entity; subscribe
requires the server capability plus operator `mcp.resource.admin.subscribe` and the LLM
never subscribes (FR21, C10). The default per-server policy is notify + cache only with
off-by-default re-read/reindex/wake opt-ins (FR23, FR24, C9, C21, C22). Mirrors
`resource-descriptor.cue`, `resource-template.cue`, `subscription.cue`, and
`resource-parts.cue`.

```typescript
// packages/schema/src/mcp/resources.ts (new)

export const ResourceScope = Schema.Struct({
  project_id: ProjectId,
  session_id: Schema.NullOr(SessionId),
  permission_ref: PermissionRef,          // runtime mcp:server:* gate (FR25, C10, C12)
})
export const ResourceProvenance = Schema.Struct({ provenance: ProvenanceClass, label: ProvenanceLabel })

// Notify-cache default with off-by-default opt-ins (FR23, FR24, C9, C21, C22).
export const UpdatePolicyRule = Schema.Struct({
  policy: ResourceUpdatePolicy,
  reread_optin: PolicyOptin, reindex_optin: PolicyOptin, wake_optin: PolicyOptin,
})
export const UpdateCoalescing = Schema.Struct({ sequence: Sequence, debounce_millis: DurationMillis, coalesced: Coalesced })

export const McpResourceDescriptor = Schema.Struct({
  id: ResourceUri,                        // entity identity — scoped URI (FR19, C12)
  server_ref: ServerId,
  title: Title,
  mime_type: Schema.NullOr(MimeType),
  scope: ResourceScope,
  provenance: ResourceProvenance,
  subscription_state: SubscriptionState,  // the LLM never subscribes (FR21, C10)
})
export type McpResourceDescriptor = Schema.Schema.Type<typeof McpResourceDescriptor>

export const McpResourceTemplate = Schema.Struct({
  id: ResourceTemplateUri,                // entity identity — scoped template URI (FR19, C12)
  server_ref: ServerId,
  title: Title,
  mime_type: Schema.NullOr(MimeType),
  scope: ResourceScope,
})
export type McpResourceTemplate = Schema.Schema.Type<typeof McpResourceTemplate>

export const ResourceSubscription = Schema.Struct({
  id: SubscriptionId,                     // entity identity (FR21, C10)
  resource_uri: ResourceUri,
  server_ref: ServerId,
  state: SubscriptionState,
  granted_by: OperatorRef,                // operator grant; never the LLM (FR21, C10, C25)
  correlation_id: CorrelationId,
})
export type ResourceSubscription = Schema.Schema.Type<typeof ResourceSubscription>
```

---

## McpPromptDescriptor entity (FR27, C24)

One runtime prompt reachable through the canonical adapter under Permission; prompts
list/get/list_changed are runtime content, never admin setup and never Feature 007
management IDs (FR27, C25). Untrusted prompt content carries a provenance label so
injection text is never treated as a trusted system instruction (FR27, C24). Mirrors
`prompt-descriptor.cue` and `prompt-parts.cue`.

```typescript
// packages/schema/src/mcp/prompts.ts (new)

export const PromptArgument = Schema.Struct({ name: Title, description: Title, required: Enabled })
export const PromptArgumentList = Schema.Array(PromptArgument)

export const McpPromptDescriptor = Schema.Struct({
  id: PromptName,                         // entity identity (FR27, C24)
  server_ref: ServerId,
  title: Title,
  arguments: PromptArgumentList,
  provenance: ProvenanceLabel,            // untrusted-content label (FR27, C24)
})
export type McpPromptDescriptor = Schema.Schema.Type<typeof McpPromptDescriptor>
```

---

## Content plane: preview, items, spool descriptors, allowlists (FR33, FR34, FR36, C16, C17)

Every `tools/call` and `resources/read` delivers a bounded preview plus an OutputRef only —
never a filesystem path — and base64/data-URL content is decoded to a Feature 005 spool
under the MIME allowlist and size caps (FR34, FR36, C16, C17). A `resource_link` stays lazy
and is auto-fetched only under policy/Permission/budget (FR26, C11). Because the SDK parses
the final result in RAM, the spill is post-parse; zero-RAM is never promised (FR35, C16).
Mirrors `content.cue`.

```typescript
// packages/schema/src/mcp/content.ts (new)

export const BoundedPreview = Schema.Struct({
  content_kind: ContentKind,
  mime_type: Schema.NullOr(MimeType),
  byte_cap: ByteLength,
  head: RedactedText,                     // redacted head slice; never a path (FR34, C16)
  secrets: SecretRefList,                 // redacted-out secret refs (FR32, C15)
})
export const ContentItem = Schema.Struct({ kind: ContentKind, mime_type: Schema.NullOr(MimeType), output_ref: OutputRef, byte_length: ByteLength })
export const ResourceLink = Schema.Struct({ resource_uri: ResourceUri, mime_type: Schema.NullOr(MimeType), title: Title }) // lazy (FR26, C11)
export const ContentItemList = Schema.Array(ContentItem)
export const ContentEnvelope = Schema.Struct({ items: ContentItemList, preview: BoundedPreview, output_ref: OutputRef, provenance: ProvenanceClass })

// OutputGroup descriptors — preview plus OutputRef only, never a path (FR33, FR34, C16).
export const McpCallOutput = Schema.Struct({
  group_id: GroupId, request_id: RequestId, outcome: CallOutcome,
  preview: BoundedPreview, output_ref: OutputRef, byte_length: ByteLength,
})
export type McpCallOutput = Schema.Schema.Type<typeof McpCallOutput>
export const McpReadOutput = Schema.Struct({
  group_id: GroupId, resource_uri: ResourceUri, mime_type: Schema.NullOr(MimeType),
  preview: BoundedPreview, output_ref: OutputRef, byte_length: ByteLength,
})
export type McpReadOutput = Schema.Schema.Type<typeof McpReadOutput>

// Allowlists — https plus roots-scoped URIs; file within roots; MIME + byte caps (FR25, FR36, C12, C17).
export const UriAllowlist = Schema.Struct({ schemes: SchemeSet, roots: RootUriList, allow_file_in_roots: Enabled })
export const MimeAllowlist = Schema.Struct({ types: MimeTypeSet, max_bytes: ByteLength })
```

---

## Runtime control: progress, cancellation, sampling, elicitation, logging (FR14, FR17, FR46, FR47, C7, C8, C19, C20, C23)

Content-free runtime control value objects. Progress is metadata only — wire progress is
monotonic per token, updates the Process Table child and OTEL, and never enters LLM turns
(FR14, C7). Cancellation carries the standard vs task wire path and its typed outcome (FR17,
C8). Sampling carries only the per-agent permission gate — it passes through Smart/budget/
LangLock unchanged and never bypasses them (FR46, C19). Elicitation always surfaces to the
operator and the model never silently answers (FR47, C20). A log record is redacted under
rate limits (FR28, C23). Mirrors `runtime.cue`.

```typescript
// packages/schema/src/mcp/runtime.ts (new)

export const ProgressReport = Schema.Struct({
  progress_token: ProgressToken, request_ref: RequestId,
  progress: Progress, total: Schema.NullOr(Total), message: Schema.NullOr(RedactedText),
})
export type ProgressReport = Schema.Schema.Type<typeof ProgressReport>

export const CancellationRequest = Schema.Struct({ request_id: RequestId, wire_path: CancelWirePath, reason: Reason })
export const CancellationOutcome = Schema.Struct({ request_id: RequestId, outcome: CancelOutcome })

export const SamplingRequest = Schema.Struct({ server_ref: ServerId, permission_ref: PermissionRef, correlation_id: CorrelationId }) // never bypasses Smart/budget (FR46, C19)
export const SamplingGate = Schema.Struct({ permission_ref: PermissionRef, approved_by: OperatorRef })

export const ElicitationRequest = Schema.Struct({ server_ref: ServerId, correlation_id: CorrelationId, operator_surfaced: OperatorSurfaced }) // always operator-surfaced (FR47, C20)
export const ElicitationGate = Schema.Struct({ operator_ref: OperatorRef, sensitive_blocked: SensitiveBlocked })

export const LogRecord = Schema.Struct({ server_ref: ServerId, level: LogLevel, redacted: RedactedText, rate_limited: RateLimited })
export const LoggingPolicy = Schema.Struct({ level: LogLevel, rate_window_millis: DurationMillis })
```

---

## McpTask entity (FR41, FR42, C8, C18)

One experimental task-augmented execution under the off-by-default `mcp.tasks` flag. Its
identity is `id`; a task-augmented call returns a `CreateTaskResult` (never a final
`CallToolResult` body as partial content), appears as a Feature 002 Process Table child, and
spills its final content to a Feature 005 OutputRef (FR42, FR43, C16, C18). Cancellation uses
`tasks/cancel`, distinct from the standard `notifications/cancelled` path (FR18, C8). A tool
with `execution.taskSupport: forbidden` rejects a task-augmented call even when `mcp.tasks`
is enabled (FR42, C18). Mirrors `task.cue` and `task-parts.cue`.

```typescript
// packages/schema/src/mcp/tasks.ts (new)

export const TaskBinding = Schema.Struct({ tool_ref: ToolName, task_support: TaskSupport })
export const TaskLifecycle = Schema.Struct({ status: TaskStatus, input_required: OperatorSurfaced }) // input_required surfaces to operator (FR42, FR47, C20)

export const McpTask = Schema.Struct({
  id: TaskId,                             // entity identity (FR42, C18)
  server_ref: ServerId,
  binding: TaskBinding,
  lifecycle: TaskLifecycle,
  process_ref: ProcessId,                 // Feature 002 child (FR43, C8)
  output_ref: Schema.NullOr(OutputRef),   // Feature 005 final content (FR43, C16)
  created_at: DateTimeUtcFromMillis,
})
export type McpTask = Schema.Schema.Type<typeof McpTask>
```

---

## Event envelope and vocabulary (FR38, C3, C26)

The common carrier on every `mcp.*` event is the content-free `McpEventEnvelope` (bounded
enums, opaque ids, and redacted key/value metadata only — never a body, URI-as-content,
prompt, or path per ADR-0001) (FR38, FR56, C26). Ten durable members persist to
EventV2/EventBus for reindex and audit correlation; five live members are coalesced and
never required to persist (C3). Mirrors `envelope.cue`, `events-server.cue`,
`events-resource.cue`, `events-call.cue`, `events-live.cue`, and `events-log.cue`.

```typescript
// packages/schema/src/mcp/events.ts (new)

export const EventKind = Schema.Struct({
  event_type: McpEventType, schema_version: SchemaVersion, event_class: EventClass,
  source: EventSource, actor_kind: ActorKind, visibility: Visibility, // no LLM actor (FR48, C25)
})
export const EventSubject = Schema.Struct({
  server_id: ServerId, connection_id: Schema.NullOr(ConnectionId),
  request_id: Schema.NullOr(RequestId), resource_uri: Schema.NullOr(ResourceUri), // no path (FR38, FR56)
})
export const Ordering = Schema.Struct({ sequence: Sequence, correlation_id: CorrelationId, causation_id: Schema.NullOr(CausationId) })
export const Delivery = Schema.Struct({
  visibility: Visibility, timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String), // no content/secrets/paths (FR56, C26)
})
export const McpEventEnvelope = Schema.Struct({ event_id: EventId, kind: EventKind, subject: EventSubject, ordering: Ordering, delivery: Delivery })
export type McpEventEnvelope = Schema.Schema.Type<typeof McpEventEnvelope>
```

The 15 members form a closed tagged union; each member carries the `envelope` and a
cohesive `detail` sub-object so server status, capabilities change, tools/resources
refresh, resource update, subscription, call settlement/cancellation, task settlement,
call start/progress, cancel request, task status, and log stay distinct. Mirroring Feature
002/003/004/005/006, each member is registered as its own `EventV2.define` `Definition` on
the `EventV2Bridge`, and durable members join the canonical inventory through
`Event.durable([...])`; no raw tagged union is wired to the bus (C3).

```typescript
export const CatalogChangedDetail = Schema.Struct({ kind: CatalogKind })
export const CallSettledDetail = Schema.Struct({ request_id: RequestId, outcome: CallOutcome, output_ref: OutputRef, byte_length: ByteLength })
export const CallProgressDetail = Schema.Struct({ request_id: RequestId, progress: Progress, total: Schema.NullOr(Total) })

// Durable member (10 total registered with durable {version, aggregate}).
export const McpToolsChangedEvent = Schema.Struct({
  type: Schema.Literal("mcp.tools_changed"),
  envelope: McpEventEnvelope,
  detail: CatalogChangedDetail,
})

// Live member (5 total): coalesced, no durable annotation, droppable under load.
export const McpCallProgressEvent = Schema.Struct({
  type: Schema.Literal("mcp.call.progress"),
  envelope: McpEventEnvelope,
  detail: CallProgressDetail,
})
// ...one Struct per event-types.ts vocabulary entry, across the events-*.ts member files.

export const McpEvent = Schema.TaggedUnion("type", [
  McpToolsChangedEvent, McpCallProgressEvent,
  // ...the remaining 13 members.
])
export type McpEvent = Schema.Schema.Type<typeof McpEvent>
```

**Durable / live split.**

| Split | Members | EventV2 posture |
| ----- | ------- | --------------- |
| Durable (10) | `mcp.server.status`, `mcp.server.capabilities_changed`, `mcp.tools_changed`, `mcp.resources_changed`, `mcp.resource_updated`, `mcp.call.settled`, `mcp.call.cancelled`, `mcp.task.settled`, `mcp.subscription.subscribed`, `mcp.subscription.unsubscribed` | `durable {version, aggregate}`; persist for reindex and audit correlation (FR38, C3) |
| Live (5) | `mcp.call.started`, `mcp.call.progress`, `mcp.call.cancel_requested`, `mcp.task.status`, `mcp.log` | bounded live channel; coalesced and droppable under load; never required to persist (FR14, FR38, C3, C7) |

**Reconciliation resolution (`mcp.call.cancel_requested` durable/live; C8 audit).** The
CUE corpus (`event-types.cue` + `events-live.cue`) is the wire-shape authority and classes
`mcp.call.cancel_requested` **live** — this data-model mirrors it (10 durable / 5 live, 15
members). An earlier `contracts/ports.ts` draft classed the request signal **durable** (and
carried an extra `mcp.subscription.fail_closed` durable member) with an inline comment
flagging the gap. That draft is reconciled to CUE: `mcp.call.cancel_requested` stays a
**live pre-settlement signal**, and the C8 audit requirement — an unacknowledged-remote
cancel outcome must be **recorded** — is satisfied by the **durable** `mcp.call.cancelled`
settlement member, whose `CancelOutcome` (`acknowledged` / `cancel_requested` /
`unknown_remote`) is the persisted audit record. `mcp.subscription.*` is exactly the two
durable transitions `subscribed` / `unsubscribed`; the subscription `fail_closed` posture is
a `SubscriptionState` value, not a persisted event. No audit trail is lost and no dual
spelling or dual authority survives (FR17, FR38, C3, C8). T012 re-derives the protocol port
members from the schema enums; T041 pins the parity across CUE, the schema modules, the
protocol mirror, and this data-model.

---

## Parameters

Every provisional contract is declared here as a plan constant with a named acceptance hook
(AC = Acceptance Scenario in `spec.md`); ADR-0009 and the tasks phase fix final values (plan
Non-goals; C1–C27). No value is a hidden default: each is an explicit, overridable data
constant on the domain module, never inlined into an algorithm. IDs never appear as metric
labels; over-budget dynamic values map to `other`, reusing the Feature 001 cardinality
allowlist (FR56, C26, AC22). Budgets and admission thresholds are owned by Features
001/002/003 and consumed here, not redefined (FR24, C22).

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `sdk_version` | `@modelcontextprotocol/sdk@1.29.0`, protocol 2025-11-25; forward patch, no fork | per client | FR7, C1, AC1, AC12 |
| `recorded_capability_fields` | tools/resources/prompts/logging/experimental flags plus protocol version | per server | FR7, FR8, C2, AC1, AC16 |
| `page_size` / `max_pages` | bounded per-page count and max-page fail-closed bound | per tools/list walk | FR10, C4, AC4 |
| `duplicate_cursor_guard` | a repeated or non-advancing cursor terminates the walk | per walk | FR10, C4, AC4 |
| `output_schema_mode` | tolerant default; strict per-server opt-in fails closed | per server | FR12, C5, AC8 |
| `trust_profile_default` | untrusted; annotations inform hints/policy only when elevated | per server | FR13a, C6, AC26 |
| `progress_coalesce_window` | UI/EventBus coalesce window; wire progress stays monotonic | per token | FR15, C7, AC5 |
| `cancel_wire_path` | `notifications/cancelled` standard; `tasks/cancel` task-augmented | per child | FR17, FR18, C8, AC7, AC31 |
| `update_queue_depth` / `debounce_interval` | bounded coalesce/dedupe/debounce queue | per server | FR23, C9, AC9 |
| `wake_ceiling` | at most one wake per qualifying event under Feature 001/002/003 admission | per server | FR24, C22, AC10, AC11 |
| `uri_allowlist` | `https` plus roots-scoped server URIs; `file` within authorized roots; else deny | per server | FR25, C12, AC20, AC21, AC25 |
| `resource_link_budget` | auto-fetch only under policy/Permission/Feature 001 budget | per link | FR26, C11, AC8 |
| `reconnect_backoff` | bounded exponential backoff with jitter and a capped max delay | per Streamable HTTP connection | FR29, C14, AC2, AC3, AC12 |
| `sse_deprecation_window` | SSE kept with a deprecation label; removed no earlier than the ADR window | per connection | FR31, C14, AC3 |
| `secret_migration_mapping` | one-time `McpAuth` token entries to Feature 007 secure refs | per server | FR32, C15, AC13 |
| `preview_byte_bound` / `spill_threshold` | bounded preview plus OutputRef; post-parse spill | per call/read | FR33, FR34, C16, AC6 |
| `mime_allowlist` / `max_blob_bytes` | decode-to-spool MIME allowlist and size cap; 10MB migration baseline | per call/read | FR36, C17, AC8, AC20 |
| `experimental_rollout_order` | tasks then sampling then elicitation then content-stream; per-server, off default | per server | FR41, FR45, C18, AC16, AC19 |
| `content_stream_capability` | `experimental/opencode.contentStream`; absence falls back to final result | per server | FR6, C18, AC19 |
| `sampling_permission` | `mcp:<server>:sampling` per-agent; passes through Smart/budget/LangLock | per agent | FR46, C19, AC17 |
| `elicitation_surfacing` | every elicitation and `input_required` surfaces to the operator | per request | FR47, C20, AC18, AC32 |
| `logging_redaction` / `rate_bound` | strip secrets, tokens, and path-shaped fields; native retention | per notification | FR28, C23, AC24 |
| `decompression_bomb_limit` | reject oversized prompt/resource payloads before delivery | per payload | FR51, C24, AC20, AC23 |
| `reserved_catalog` | exactly 30 `mcp.*` IDs at `RESERVED_CATALOG_VERSION = 1.3.0`; no bump | per registry | FR48, C25, AC15, AC29 |
| `metric_buckets` | bounded-enum latency/progress/bytes/reconnect/coalesce/failure metrics | per metric | FR55, C26, AC22 |

Feature 001 telemetry queue/cardinality-allowlist/budget-policy constants and the Feature
007 Config.Service CAS/idempotency and reserved-catalog parameters are reused unchanged and
are not re-declared here (C22, C25).

---

## Cross-artifact traceability

| Entity | CUE mirror | TS module | Requirements |
| ------ | ---------- | --------- | ------------ |
| identifiers / refs / correlation | `ids.cue`, `refs.cue`, `correlation.cue` | `ids.ts`, `refs.ts` | FR7, FR32, FR34, FR39, FR48, C2, C15, C16 |
| numeric / text / URI values | `values.cue`, `text-values.cue`, `uri.cue` | `values.ts`, `text-values.ts` | FR10, FR15, FR25, FR36, C4, C7, C12, C17 |
| flags / first-class collections | `flags.cue`, `collections.cue` | `flags.ts` | FR7, FR13a, FR23, FR32, C2, C6, C9, C15 |
| core / state / event / event-type enums | `enums.cue`, `enums-state.cue`, `enums-event.cue`, `event-types.cue`, `experimental.cue` | `enums.ts`, `enums-state.ts`, `enums-event.ts`, `event-types.ts`, `experimental.ts` | FR7, FR12, FR38, FR41, C2, C3, C5, C18 |
| NegotiatedCapabilities | `capability.cue` | `capability.ts` | FR7, FR8, C2 |
| McpServerProfile | `server-profile.cue`, `server-parts.cue` | `server.ts` | FR48, FR32, FR13a, FR41, C6, C15, C18, C25 |
| McpConnection / ReconnectPosture | `connection.cue`, `connection-parts.cue` | `connection.ts` | FR7, FR29, FR30, C1, C2, C14 |
| McpToolCatalogEntry / pagination | `tool-entry.cue`, `tool-parts.cue`, `pagination.cue` | `tools.ts` | FR10, FR11, FR12, FR13a, C4, C5, C6 |
| McpResourceDescriptor / Template / Subscription / policy | `resource-descriptor.cue`, `resource-template.cue`, `subscription.cue`, `resource-parts.cue` | `resources.ts` | FR19, FR21, FR23, FR24, FR25, C9, C10, C12 |
| McpPromptDescriptor | `prompt-descriptor.cue`, `prompt-parts.cue` | `prompts.ts` | FR27, C24 |
| content plane / spool descriptors / allowlists | `content.cue` | `content.ts` | FR33, FR34, FR35, FR36, C11, C16, C17 |
| runtime control (progress/cancel/sampling/elicitation/logging) | `runtime.cue` | `runtime.ts` | FR14, FR17, FR28, FR46, FR47, C7, C8, C19, C20, C23 |
| McpTask | `task.cue`, `task-parts.cue` | `tasks.ts` | FR41, FR42, FR43, C8, C16, C18 |
| McpEventEnvelope | `envelope.cue` | `events.ts` | FR38, FR56, C3, C26 |
| McpEvent vocabulary | `event-types.cue`, `events-server.cue`, `events-resource.cue`, `events-call.cue`, `events-live.cue`, `events-log.cue` | `event-types.ts`, `events.ts` + member files | FR14, FR17, FR23, FR38, FR42, C3, C7, C8, C9 |

---

## Notes on authority and reuse

- No shape here is a second store of record: Feature 007 owns the operator registry, auth,
  CAS, and audit; Feature 005 owns the content plane; Feature 002 owns the Process Table
  and cancel tree; Feature 001 owns Smart routing, budgets, and telemetry. The MCP
  projections are revalidated against the live `MCP.Service` seams before delivery (FR13,
  C13, C16, C25, C27).
- The two SSOT aggregates (`McpServerProfile`, `McpConnection`) own the per-server
  configuration and the recorded capability set; Feature 007 references them and exposes the
  30 reserved `mcp.*` operator commands (`RESERVED_CATALOG_VERSION = 1.3.0`) without
  redefining or bumping the catalog (FR48, C25).
- Budgets (`retrieval`/wake admission) and telemetry come from Features 001/002/003; the
  content plane and previews come from Feature 005; secrets come from the Feature 007
  SecretPort. No new exporter, SDK, content store, or catalog authority is added (FR24,
  FR32, FR33, FR56, C15, C16, C22, C25, C26).
```

