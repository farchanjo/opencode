/**
 * Feature 008 / T024 (S15) — early SDK + transport validation with an honest
 * outcome.
 *
 * Empirically validates that the pinned `@modelcontextprotocol/sdk@1.29.0` and its
 * applied 629-line forward patch expose, under the Bun runtime, the client surface
 * Feature 008 relies on. Each surface yields a typed present/gap finding: a present
 * surface routes through the SDK; a MISSING surface records a typed capability gap
 * (routed through the Feature 008 degradation classifier, C1/C2) and NEVER a hard
 * failure — no path hard-fails routing on a missing optional wire feature (FR7).
 * A major SDK jump is an explicit ADR/plan migration, not a silent bump (C1).
 *
 * The probe is content-free and side-effect-free: it introspects method/schema
 * presence only and calls nothing on the wire.
 */
export * as McpSdkProbe from "./sdk-probe"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import * as SdkTypes from "@modelcontextprotocol/sdk/types.js"
import { Degradation } from "@opencode-ai/core/mcp/degradation"

/** The client methods Feature 008 requires (C7, C10, C23). */
export const REQUIRED_CLIENT_METHODS = [
  "subscribeResource", // C10
  "unsubscribeResource", // C10
  "setLoggingLevel", // C23
  "callTool", // FR2, FR12
  "readResource", // FR19
  "listTools", // FR10
  "getServerCapabilities", // FR7
] as const

/** The notification/request schemas Feature 008 relies on (C3, C7, C8, C9). */
export const REQUIRED_SCHEMAS = [
  "CancelledNotificationSchema", // C8
  "ResourceUpdatedNotificationSchema", // C9
  "SubscribeRequestSchema", // C10
  "ResourceListChangedNotificationSchema", // C9
  "ProgressNotificationSchema", // C7
] as const

export type ProbeSurface = (typeof REQUIRED_CLIENT_METHODS)[number] | (typeof REQUIRED_SCHEMAS)[number]

/** One typed present/gap finding; a gap is routed through the degradation classifier, never a hard fail (C1). */
export interface ProbeFinding {
  readonly surface: ProbeSurface
  readonly present: boolean
  /** For a missing surface, the typed capability gap the router degrades to (C1, C2). */
  readonly gap: Degradation.CapabilityGap | null
}

export interface ProbeReport {
  readonly findings: ReadonlyArray<ProbeFinding>
  /** True when a required surface is missing; the session still continues on a typed gap (FR7). */
  readonly degraded: boolean
  /** True when every required surface is present and routing goes through the SDK. */
  readonly complete: boolean
}

function findingFor(surface: ProbeSurface, present: boolean): ProbeFinding {
  if (present) return { surface, present, gap: null }
  // A missing wire feature degrades to a typed gap; the session continues (C1, C2).
  const outcome = Degradation.classify({ ...Degradation.HEALTHY_CONDITIONS, featureUnsupported: true })
  return { surface, present: false, gap: outcome.gap }
}

/** Probe an explicit method/schema presence map (deterministic; used by tests and the installed probe). */
export function probeSurface(presence: Readonly<Record<string, boolean>>): ProbeReport {
  const findings: ProbeFinding[] = []
  for (const m of REQUIRED_CLIENT_METHODS) findings.push(findingFor(m, presence[m] === true))
  for (const s of REQUIRED_SCHEMAS) findings.push(findingFor(s, presence[s] === true))
  const degraded = findings.some((f) => !f.present)
  return { findings, degraded, complete: !degraded }
}

/** Probe the actually-installed SDK: instantiate a Client and introspect its surface (no wire I/O). */
export function probeInstalledSdk(): ProbeReport {
  const client = new Client({ name: "opencode-probe", version: "0.0.0" }, { capabilities: {} })
  const presence: Record<string, boolean> = {}
  for (const m of REQUIRED_CLIENT_METHODS) presence[m] = typeof (client as unknown as Record<string, unknown>)[m] === "function"
  const types = SdkTypes as unknown as Record<string, unknown>
  for (const s of REQUIRED_SCHEMAS) presence[s] = types[s] !== undefined
  return probeSurface(presence)
}
