export * as Connection from "./connection"

import { Schema } from "effect"
import { Capability } from "./capability"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { Policy } from "./policy"
import { Refs } from "./refs"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/mcp/connection.cue and connection-parts.cue one-to-one.
// McpConnection is the Feature 008 aggregate of one server's live lifecycle (FR7, C2).
// Its id is the connection_id; it advances through the fixed sequence configure ->
// connect -> negotiate -> record -> connected with terminal branches disabled/failed/
// needs_auth/needs_client_registration, and the authoritative Status union extends
// only additively (C2, C27). It records the negotiated capability set (a capability
// the server did not advertise is never exercised) and the typed capability gap;
// mcp_unavailable never hard-fails the session (FR7, C1, C2). A Streamable HTTP drop
// reconnects under bounded exponential backoff with jitter and a capped max delay
// honoring session resume and Last-Event-ID; a stdio connection has no reconnect and
// restarts under lifecycle control (FR29, FR30, C14).

// ReconnectPosture carries the bounded backoff attempt, delay and cap for Streamable HTTP (FR29, C14).
export const ReconnectPosture = Schema.Struct({
  attempt: Values.AttemptCount,
  backoff_millis: Values.DurationMillis,
  max_attempts: Values.AttemptCount,
}).annotate({ identifier: "McpConnection.ReconnectPosture" })
export type ReconnectPosture = Schema.Schema.Type<typeof ReconnectPosture>

// SessionResume carries the Last-Event-ID and resume support honored on reconnect (FR29, C14).
export const SessionResume = Schema.Struct({
  last_event_id: Schema.NullOr(TextValues.Cursor),
  resume_supported: Policy.Supported,
  session_id: Schema.NullOr(Refs.SessionId),
}).annotate({ identifier: "McpConnection.SessionResume" })
export type SessionResume = Schema.Schema.Type<typeof SessionResume>

// McpConnection is the aggregate root of one server lifecycle; id is its connection id (FR7, C2).
export const McpConnection = Schema.Struct({
  id: Ids.ConnectionId,
  server_ref: Ids.ServerId,
  status: EnumsState.ServerStatus,
  state: EnumsState.ConnectionState,
  capabilities: Capability.NegotiatedCapabilities,
  gap: Enums.CapabilityGap,
  reconnect: ReconnectPosture,
}).annotate({ identifier: "McpConnection.McpConnection" })
export type McpConnection = Schema.Schema.Type<typeof McpConnection>
