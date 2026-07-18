/**
 * Native non-LLM enable/disable path for operator_control_plane (T041).
 * Writes Config.Service experimental.operator_control_plane only — no prompt/ToolRegistry.
 */
import {
  getOperatorFlagState,
  operatorUnavailableWhenFlagOff,
  readOperatorControlPlaneFromConfig,
  resolveOperatorControlPlaneFlag,
  type OperatorFlagState,
} from "@opencode-ai/core/operator"
import type { ConfigServiceLike } from "./adapters/outbound/config-service"

export type FlagBootstrapAction = "show" | "enable" | "disable"

export function isFlagBootstrapSegments(segments: readonly string[]): boolean {
  if (segments.length < 2) return false
  if (segments[0] !== "flag") return false
  const action = segments[1]
  return action === "show" || action === "enable" || action === "disable"
}

export function parseFlagBootstrapAction(segments: readonly string[]): FlagBootstrapAction | null {
  if (!isFlagBootstrapSegments(segments)) return null
  return segments[1] as FlagBootstrapAction
}

export type FlagBootstrapResult = {
  readonly ok: boolean
  readonly action: FlagBootstrapAction
  readonly state: OperatorFlagState
  readonly persisted: boolean
  readonly message: string
  readonly requiresConfirm?: boolean
}

/**
 * Read-only show: resolve flag from config + env + sandbox.
 */
export async function flagShow(config: ConfigServiceLike): Promise<FlagBootstrapResult> {
  const cfg = await config.get()
  const configEnabled = readOperatorControlPlaneFromConfig(cfg)
  const state = resolveOperatorControlPlaneFlag({ configEnabled })
  return {
    ok: true,
    action: "show",
    state,
    persisted: false,
    message: `operator_control_plane enabled=${state.enabled} source=${state.source} configKey=${state.configKey}`,
  }
}

/**
 * Persist experimental.operator_control_plane via Config.Service (global when possible).
 * Requires confirm=true for enable/disable (destructive ops surface).
 */
export async function flagSet(
  config: ConfigServiceLike,
  enabled: boolean,
  options: { readonly confirm: boolean },
): Promise<FlagBootstrapResult> {
  const action: FlagBootstrapAction = enabled ? "enable" : "disable"
  if (!options.confirm) {
    const cfg = await config.get()
    const state = resolveOperatorControlPlaneFlag({
      configEnabled: readOperatorControlPlaneFromConfig(cfg),
    })
    return {
      ok: false,
      action,
      state,
      persisted: false,
      requiresConfirm: true,
      message: `confirmation required to ${action} operator_control_plane (pass --yes on non-TTY or confirm interactively)`,
    }
  }

  const patch = {
    experimental: {
      operator_control_plane: enabled,
    },
  } as Record<string, unknown>

  // Prefer global so restart persists for the operator principal
  try {
    await config.updateGlobal(patch)
  } catch {
    await config.update(patch)
  }

  const cfg = await config.get()
  const configEnabled = readOperatorControlPlaneFromConfig(cfg)
  // After write, treat config as the written value even if merge is delayed
  const state = resolveOperatorControlPlaneFlag({
    configEnabled: configEnabled ?? enabled,
  })

  return {
    ok: true,
    action,
    state: { ...state, enabled, source: "config" },
    persisted: true,
    message: `operator_control_plane ${enabled ? "enabled" : "disabled"} in config (restart surfaces pick up config; env override still wins when set)`,
  }
}

export function flagBootstrapUnavailableEnvelope(commandId: string) {
  return operatorUnavailableWhenFlagOff(commandId)
}

export { getOperatorFlagState, resolveOperatorControlPlaneFlag, readOperatorControlPlaneFromConfig }

export * as OperatorFlagBootstrap from "./flag-bootstrap"
