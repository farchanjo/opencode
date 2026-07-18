/**
 * Shared operator sandbox/dev env detection (Feature 007).
 * Canonical marker: OPENCODE_DEV_OPERATOR_=1 (plan/quickstart/wrapper).
 * Used by worker, HTTP mount, and CLI so keychain sandbox cannot diverge.
 */
import { ENV_DEV_OPERATOR } from "@/dev/sandbox/constants"

export type EnvLike = {
  readonly [key: string]: string | undefined
}

/**
 * True when the process is under the operator isolation harness.
 * When true, live stack MUST disable real OS keychain (unavailable backend).
 */
export function isOperatorDevSandbox(env: EnvLike = process.env): boolean {
  return env[ENV_DEV_OPERATOR] === "1"
}

/** Re-export constant for call sites that need the env key name. */
export { ENV_DEV_OPERATOR }

export * as OperatorDevEnv from "./dev-env"
