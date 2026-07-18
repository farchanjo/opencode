/**
 * Registration hooks for plugin/MCP/custom commands (T042–T043).
 * Fail-closed reserved_name; no silent rename. Uses RESERVED_CATALOG_VERSION.
 */
import {
  checkReservedRegistrationName,
  classifyLegacyAdminName,
  dryRunLegacyMigration,
  RESERVED_CATALOG_VERSION,
  type RegistrationSource,
  type ReservedNameCheck,
} from "@opencode-ai/core/operator"

export type GuardRegisterInput = {
  readonly name: string
  readonly source: RegistrationSource
  /** When true, legacy_admin_like existing names warn but allow (migration window). */
  readonly allowLegacyExisting?: boolean
}

export type GuardRegisterResult =
  | { readonly ok: true; readonly warning?: string }
  | {
      readonly ok: false
      readonly code: "reserved_name"
      readonly reason: string
      readonly check: ReservedNameCheck
      readonly catalogVersion: string
    }

/**
 * Call before plugin/MCP/custom/slash/palette registration.
 * New registrations: reject reserved + legacy admin-like.
 * Existing (allowLegacyExisting): warn only for legacy_admin_like, still reject hard reserved.
 */
export function guardOperatorRegistrationName(input: GuardRegisterInput): GuardRegisterResult {
  const reserved = checkReservedRegistrationName(input.name, input.source)
  if (!reserved.ok) {
    return {
      ok: false,
      code: "reserved_name",
      reason: reserved.reason,
      check: reserved,
      catalogVersion: reserved.catalogVersion,
    }
  }

  const legacy = classifyLegacyAdminName(input.name)
  if (legacy.kind === "legacy_admin_like") {
    if (input.allowLegacyExisting) {
      return {
        ok: true,
        warning: `legacy admin-like name "${input.name}" is deprecated; new registrations will be rejected (catalog ${RESERVED_CATALOG_VERSION})`,
      }
    }
    return {
      ok: false,
      code: "reserved_name",
      reason: `legacy admin-like name "${input.name}" rejected for new registration`,
      catalogVersion: RESERVED_CATALOG_VERSION,
      check: {
        ok: false,
        code: "reserved_name",
        reason: `legacy admin-like name "${input.name}"`,
        catalogVersion: RESERVED_CATALOG_VERSION,
        matched: input.name,
        source: input.source,
      },
    }
  }

  return { ok: true }
}

/** Wrap a register function with reserved-name guard. */
export function withReservedNameGuard<T>(
  source: RegistrationSource,
  register: (name: string) => T,
  options?: { allowLegacyExisting?: boolean },
): (name: string) => T | GuardRegisterResult {
  return (name: string) => {
    const g = guardOperatorRegistrationName({
      name,
      source,
      allowLegacyExisting: options?.allowLegacyExisting,
    })
    if (!g.ok) return g
    return register(name)
  }
}

export { dryRunLegacyMigration, classifyLegacyAdminName, checkReservedRegistrationName, RESERVED_CATALOG_VERSION }

export * as OperatorRegistrationGuard from "./registration-guard"
