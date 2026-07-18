/**
 * Operator catalog parity (T027).
 * Canonical IDs: `@opencode-ai/core/operator` (`listReservedIds`, `RESERVED_CATALOG_VERSION`).
 * No hand-duplicated ID strings in the SDK package.
 */
export const OPERATOR_CATALOG_MODULE = "@opencode-ai/core/operator" as const

export const OPERATOR_SDK_CATALOG_NOTE =
  "Import listReservedIds and RESERVED_CATALOG_VERSION from @opencode-ai/core/operator for CLI/registry parity."

export * as OperatorSdkCatalog from "./catalog.js"
