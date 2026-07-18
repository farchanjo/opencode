/** Feature 007 operator isolation harness constants (S0 / T002). */

export const SANDBOX_ROOT_REL = ".dev/opencode-operator"
export const SANDBOX_LAYOUT = ["config", "data", "cache", "state", "tmp", "home", "managed", "logs"] as const

/** Plan/quickstart marker: sandbox is active. */
export const ENV_DEV_OPERATOR = "OPENCODE_DEV_OPERATOR_"

export const ENV_OPERATOR_PORT = "OPENCODE_OPERATOR_PORT"
export const ENV_OPERATOR_BIND = "OPENCODE_OPERATOR_BIND"
export const ENV_CONFIG_DIR = "OPENCODE_CONFIG_DIR"

/** Loopback-only sandbox listener (never production 4096). */
export const OPERATOR_PORT = 14096
export const OPERATOR_BIND = "127.0.0.1"

/** Production-ish defaults that must never be used by the harness. */
export const FORBIDDEN_PROD_PORT = 4096
/** Real MCP OAuth callback port — prohibited under sandbox unless isolated future override. */
export const FORBIDDEN_OAUTH_PORT = 19876

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

/** Safe defaults applied by the wrapper before any Bun/core import. */
export const SAFE_DEFAULT_ENV = {
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_AUTOCOMPACT: "1",
} as const

/** Relative layout under the sandbox root. */
export type SandboxLayoutDir = (typeof SANDBOX_LAYOUT)[number]

export * as SandboxConstants from "./constants"
