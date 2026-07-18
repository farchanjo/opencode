/**
 * Offline matrix (T044).
 * Descriptors declare offlineCapable; dispatcher enforces unavailable before network handlers.
 * Live connectivity: native config experimental.offline or OPENCODE_OFFLINE / OPENCODE_CONNECTIVITY env.
 */
import type { OperatorCommandDescriptor } from "./descriptor"

export type ConnectivityMode = "online" | "offline"

export type ResolveConnectivityInput = {
  /** experimental.offline from Config (true → offline). */
  readonly configOffline?: boolean | null
  readonly env?: NodeJS.ProcessEnv
}

function envTruthy(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

/**
 * Live connectivity source for dispatcher stack.
 * Precedence: OPENCODE_CONNECTIVITY=offline|online → OPENCODE_OFFLINE → config experimental.offline → online.
 */
export function resolveConnectivity(input: ResolveConnectivityInput = {}): ConnectivityMode {
  const env = input.env ?? process.env
  const explicit = env["OPENCODE_CONNECTIVITY"]?.toLowerCase()
  if (explicit === "offline") return "offline"
  if (explicit === "online") return "online"
  if (envTruthy(env, "OPENCODE_OFFLINE")) return "offline"
  if (input.configOffline === true) return "offline"
  return "online"
}

/** Read experimental.offline from Config.Info-like object. */
export function readOfflineFromConfig(config: unknown): boolean | undefined {
  if (!config || typeof config !== "object") return undefined
  const experimental = (config as { experimental?: unknown }).experimental
  if (!experimental || typeof experimental !== "object") return undefined
  const value = (experimental as Record<string, unknown>).offline
  if (typeof value === "boolean") return value
  return undefined
}

/**
 * Ops that require network even when offlineCapable=false is set on descriptor.
 * Catalog is source of truth; this is the enforcement helper.
 */
export function isNetworkRequired(descriptor: OperatorCommandDescriptor): boolean {
  return descriptor.offlineCapable === false
}

/**
 * Enforce offline matrix. Returns unavailable result shape data when blocked.
 */
export function checkOfflineCapability(
  descriptor: OperatorCommandDescriptor,
  mode: ConnectivityMode,
): { readonly allowed: true } | { readonly allowed: false; readonly reason: string } {
  if (mode === "online") return { allowed: true }
  if (!isNetworkRequired(descriptor)) return { allowed: true }
  return {
    allowed: false,
    reason: `${descriptor.id} requires network (offlineCapable=false); unavailable offline`,
  }
}

/**
 * Status/show/list must be offlineCapable=true in catalog.
 * validate/test/connect may be false.
 */
export function assertCatalogOfflineInvariants(
  entries: readonly { id: string; offlineCapable?: boolean }[],
): readonly string[] {
  const errors: string[] = []
  for (const e of entries) {
    const leaf = e.id.split(".").pop() ?? ""
    if ((leaf === "status" || leaf === "show" || leaf === "list") && e.offlineCapable === false) {
      errors.push(`${e.id}: status/show/list must be offlineCapable`)
    }
  }
  return errors
}

export * as OperatorOffline from "./offline"
