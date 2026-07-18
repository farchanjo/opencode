/**
 * Feature flag operator_control_plane (T041).
 *
 * Single resolver. Precedence (highest → lowest):
 * 1. Sandbox harness explicit enable: OPENCODE_DEV_OPERATOR_=1
 * 2. Optional env override (dev/ops only): OPENCODE_OPERATOR_CONTROL_PLANE=0|1|true|false
 * 3. Native config: experimental.operator_control_plane (Config.Service)
 * 4. Default OFF (migration safety)
 *
 * OPENCODE_OPERATOR_HTTP is NOT an enable flag (removed as divergent source).
 * Live stack must pass configEnabled from Config — never hardcode featureEnabled:true.
 */
export const OPERATOR_CONTROL_PLANE_FLAG = "operator_control_plane" as const

/** Config path under experimental (ConfigV1.Info.experimental). */
export const OPERATOR_CONTROL_PLANE_CONFIG_KEY = "operator_control_plane" as const

export type OperatorFlagSource = "default_off" | "config" | "env" | "sandbox"

export type OperatorFlagState = {
  readonly id: typeof OPERATOR_CONTROL_PLANE_FLAG
  readonly enabled: boolean
  readonly source: OperatorFlagSource
  readonly migrationDefault: "off"
  readonly configKey: `experimental.${typeof OPERATOR_CONTROL_PLANE_CONFIG_KEY}`
}

export type ResolveOperatorFlagInput = {
  /**
   * Value of experimental.operator_control_plane from Config.Service.
   * undefined/null = not set in config (fall through).
   */
  readonly configEnabled?: boolean | null
  readonly env?: NodeJS.ProcessEnv
}

function envTruthy(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function envFalsy(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

function envExplicit(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] !== undefined && env[key] !== ""
}

/**
 * Single-source flag resolution for dispatcher, HTTP, CLI, worker, palette.
 */
export function resolveOperatorControlPlaneFlag(input: ResolveOperatorFlagInput = {}): OperatorFlagState {
  const env = input.env ?? process.env
  const base = {
    id: OPERATOR_CONTROL_PLANE_FLAG,
    migrationDefault: "off" as const,
    configKey: `experimental.${OPERATOR_CONTROL_PLANE_CONFIG_KEY}` as const,
  }

  // 1. Sandbox harness
  if (env["OPENCODE_DEV_OPERATOR_"] === "1") {
    return { ...base, enabled: true, source: "sandbox" }
  }

  // 2. Optional env override (dev/ops) — only when explicitly set
  if (envExplicit(env, "OPENCODE_OPERATOR_CONTROL_PLANE")) {
    if (envTruthy(env, "OPENCODE_OPERATOR_CONTROL_PLANE")) {
      return { ...base, enabled: true, source: "env" }
    }
    if (envFalsy(env, "OPENCODE_OPERATOR_CONTROL_PLANE")) {
      return { ...base, enabled: false, source: "env" }
    }
  }

  // 3. Native config
  if (input.configEnabled === true) {
    return { ...base, enabled: true, source: "config" }
  }
  if (input.configEnabled === false) {
    return { ...base, enabled: false, source: "config" }
  }

  // 4. Default off
  return { ...base, enabled: false, source: "default_off" }
}

/** Convenience boolean from resolver. */
export function isOperatorControlPlaneEnabled(
  envOrInput: NodeJS.ProcessEnv | ResolveOperatorFlagInput = process.env,
): boolean {
  // Backward-compatible: bare env object (tests pass `{}` or process.env)
  if (
    envOrInput === process.env ||
    (typeof envOrInput === "object" &&
      envOrInput !== null &&
      !("configEnabled" in envOrInput) &&
      !("env" in envOrInput))
  ) {
    return resolveOperatorControlPlaneFlag({ env: envOrInput as NodeJS.ProcessEnv }).enabled
  }
  return resolveOperatorControlPlaneFlag(envOrInput as ResolveOperatorFlagInput).enabled
}

export function getOperatorFlagState(
  envOrInput: NodeJS.ProcessEnv | ResolveOperatorFlagInput = process.env,
): OperatorFlagState {
  if (
    envOrInput === process.env ||
    (typeof envOrInput === "object" &&
      envOrInput !== null &&
      !("configEnabled" in envOrInput) &&
      !("env" in envOrInput))
  ) {
    return resolveOperatorControlPlaneFlag({ env: envOrInput as NodeJS.ProcessEnv })
  }
  return resolveOperatorControlPlaneFlag(envOrInput as ResolveOperatorFlagInput)
}

/** Extract experimental.operator_control_plane from a Config.Info-like object. */
export function readOperatorControlPlaneFromConfig(config: unknown): boolean | undefined {
  if (!config || typeof config !== "object") return undefined
  const experimental = (config as { experimental?: unknown }).experimental
  if (!experimental || typeof experimental !== "object") return undefined
  const value = (experimental as Record<string, unknown>)[OPERATOR_CONTROL_PLANE_CONFIG_KEY]
  if (typeof value === "boolean") return value
  return undefined
}

/**
 * When flag is OFF: operator adapters no-op / return unavailable.
 * Reserved /op.* still intercepts and never falls through to LLM prompt.
 */
export function operatorUnavailableWhenFlagOff(commandId: string) {
  return {
    ok: false as const,
    id: commandId,
    kind: "operator.admin_result" as const,
    outcome: "unavailable" as const,
    error: {
      code: "unavailable" as const,
      message: `operator_control_plane is disabled (enable experimental.operator_control_plane in config or set OPENCODE_OPERATOR_CONTROL_PLANE=1); ${commandId} not executed`,
      retryable: false,
      details: { flag: OPERATOR_CONTROL_PLANE_FLAG, enabled: false },
    },
  }
}

export * as OperatorFeatureFlag from "./feature-flag"
