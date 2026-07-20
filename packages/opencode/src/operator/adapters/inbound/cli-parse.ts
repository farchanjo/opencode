/**
 * CLI operator argv → command id / payload / scope (T032).
 * Grammar: `opencode op <domain> <operation> [qualifiers...]`
 *       or `opencode op <canonical.dotted.id>`
 * Resolve via registry only — no hardcoded divergent IDs.
 *
 * Payload bounds match HTTP operator routes (256 KiB, depth 12).
 */
import {
  failureResult,
  findPlaintextSecretFields,
  parseCommandId,
  type CommandResult,
  type OperatorCommandDescriptor,
  type OperatorScope,
  type ScopeKind,
} from "@opencode-ai/core/operator"
import type { OperatorCommandRegistry } from "../../application/registry"

/** Parity with packages/opencode/src/operator/http/handler.ts */
export const CLI_MAX_PAYLOAD_BYTES = 256 * 1024
export const CLI_MAX_JSON_DEPTH = 12
export const CLI_MAX_ARRAY_LEN = 1000
export const CLI_MAX_OBJECT_KEYS = 200

export type CliPrincipalContext = {
  readonly projectId?: string | null
  readonly subject?: string
  readonly sessionId?: string | null
  readonly rootTreeRef?: string | null
  /**
   * V1: local CLI process owner is the operator principal (always true on production path).
   * Tests may inject `false` to exercise the non-TTY `--yes` unauth branch; no principal flag exists.
   */
  readonly authenticated: boolean
}

export type CliParseFlags = {
  readonly expectedVersion?: string
  readonly idempotencyKey?: string
  readonly session?: string
  readonly project?: string
  readonly rootTree?: string
  /**
   * Explicit authority scope (Feature 034): `global | project | session | root-tree`.
   * Forces the request to that kind when the command allows it, OVERRIDING the ambient
   * project preference; an unknown value or a kind the command forbids is a clean scope
   * error. Absent → the resolver keeps its project-preferred behavior (full back-compat).
   */
  readonly scope?: string
  readonly yes?: boolean
  readonly json?: boolean
  /** Raw JSON string (bounded before parse). */
  readonly payloadJson?: string
  /** Path to JSON file, or "-" for stdin. */
  readonly payloadFile?: string
}

export type CliParseOk = {
  readonly ok: true
  readonly commandId: string
  readonly descriptor: OperatorCommandDescriptor
  readonly scope: OperatorScope
  readonly payload: Record<string, unknown>
  readonly version?: string
  readonly idempotencyKey?: string
  readonly yes: boolean
  readonly json: boolean
}

export type CliParseFail = {
  readonly ok: false
  readonly result: CommandResult
  readonly usage?: string
}

export type CliParseResult = CliParseOk | CliParseFail

/**
 * Resolve positional segments to a registry command id.
 * Accepts either dotted single token or space-separated domain/op/qualifiers.
 */
export function resolveCliCommandId(
  segments: readonly string[],
  registry: OperatorCommandRegistry,
): { ok: true; id: string; descriptor: OperatorCommandDescriptor } | { ok: false; reason: string; raw: string } {
  const cleaned = segments.map((s) => s.trim()).filter((s) => s.length > 0)
  if (cleaned.length === 0) {
    return { ok: false, reason: "missing operator command", raw: "" }
  }

  // Single dotted token: langlock.status or semantic.embedding.cutover
  if (cleaned.length === 1 && cleaned[0]!.includes(".")) {
    const parsed = parseCommandId(cleaned[0]!)
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, raw: cleaned[0]! }
    }
    const descriptor = registry.lookup(parsed.value)
    if (!descriptor) {
      return { ok: false, reason: `unknown operator command id: ${parsed.value}`, raw: parsed.value }
    }
    return { ok: true, id: descriptor.id, descriptor }
  }

  // Space-separated: domain op [qualifiers...] → domain.op.qualifiers
  const dotted = cleaned.map((s) => s.toLowerCase()).join(".")
  const parsed = parseCommandId(dotted)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, raw: cleaned.join(" ") }
  }
  const descriptor = registry.lookup(parsed.value)
  if (!descriptor) {
    // Also try alias form "op domain rest..."
    const alias = ["op", ...cleaned.map((s) => s.toLowerCase())].join(" ")
    const byAlias = registry.lookupByAlias(alias)
    if (byAlias) {
      return { ok: true, id: byAlias.id, descriptor: byAlias }
    }
    return { ok: false, reason: `unknown operator command id: ${parsed.value}`, raw: cleaned.join(" ") }
  }
  return { ok: true, id: descriptor.id, descriptor }
}

/**
 * Descriptor-aware scope selection (session-only → session, project → project, global only when allowed).
 * Never invents arbitrary cross-project scope. Explicit flags only when kind allowed.
 */
export function resolveCliScope(input: {
  readonly descriptor: OperatorCommandDescriptor
  readonly ctx: CliPrincipalContext
  readonly flags: CliParseFlags
}): { ok: true; scope: OperatorScope } | { ok: false; reason: string } {
  const allowed = input.descriptor.scopesAllowed as readonly ScopeKind[]
  const projectId = input.flags.project?.trim() || input.ctx.projectId || null
  const sessionId = input.flags.session?.trim() || input.ctx.sessionId || null
  const rootTreeRef = input.flags.rootTree?.trim() || input.ctx.rootTreeRef || null

  // Feature 034 — an explicit `--scope <kind>` selects the authority scope directly,
  // OVERRIDING the ambient-project preference (the only way to request global while a
  // project is bound to the cwd). It takes precedence over the ref-only flags; a
  // conflicting ref flag of a different kind is rejected rather than silently ignored.
  const explicitScope = input.flags.scope?.trim()
  if (explicitScope) {
    return resolveExplicitCliScope(explicitScope, { descriptor: input.descriptor, ctx: input.ctx, flags: input.flags, allowed })
  }

  // Explicit flag forces kind if allowed
  if (input.flags.session?.trim()) {
    if (!allowed.includes("session")) {
      return { ok: false, reason: `command ${input.descriptor.id} does not allow session scope` }
    }
    return { ok: true, scope: { kind: "session", ref: input.flags.session.trim() } }
  }
  if (input.flags.rootTree?.trim()) {
    if (!allowed.includes("root-tree")) {
      return { ok: false, reason: `command ${input.descriptor.id} does not allow root-tree scope` }
    }
    return { ok: true, scope: { kind: "root-tree", ref: input.flags.rootTree.trim() } }
  }
  if (input.flags.project?.trim()) {
    if (!allowed.includes("project")) {
      return { ok: false, reason: `command ${input.descriptor.id} does not allow project scope` }
    }
    // No arbitrary cross-project when principal is project-bound to cwd project
    if (
      input.ctx.projectId &&
      input.flags.project.trim() !== input.ctx.projectId &&
      input.ctx.projectId !== "local"
    ) {
      return {
        ok: false,
        reason: `cross-project scope denied (cwd=${input.ctx.projectId}, requested=${input.flags.project.trim()})`,
      }
    }
    return { ok: true, scope: { kind: "project", ref: input.flags.project.trim() } }
  }

  // Preference order: session → root-tree → project → global (only when allowed + ref available)
  if (sessionId && allowed.includes("session")) {
    return { ok: true, scope: { kind: "session", ref: sessionId } }
  }
  if (rootTreeRef && allowed.includes("root-tree")) {
    return { ok: true, scope: { kind: "root-tree", ref: rootTreeRef } }
  }
  if (projectId && allowed.includes("project")) {
    return { ok: true, scope: { kind: "project", ref: projectId } }
  }
  if (allowed.includes("global")) {
    return { ok: true, scope: { kind: "global", ref: null } }
  }
  if (allowed.includes("project")) {
    return { ok: true, scope: { kind: "project", ref: projectId ?? "local" } }
  }
  if (allowed.includes("session")) {
    return { ok: true, scope: { kind: "session", ref: sessionId ?? "local" } }
  }
  if (allowed.includes("root-tree")) {
    return { ok: true, scope: { kind: "root-tree", ref: rootTreeRef ?? "local" } }
  }
  return { ok: false, reason: `no allowed scope for ${input.descriptor.id}` }
}

/** The closed set of explicit `--scope` kinds accepted by the CLI (Feature 034). */
const CLI_SCOPE_KINDS: readonly ScopeKind[] = ["global", "project", "session", "root-tree"]

/**
 * Resolve an explicit `--scope <kind>` selection (Feature 034). Validates the kind
 * against the closed `ScopeKind` set, rejects a conflicting explicit ref flag of a
 * different kind, enforces the descriptor's `scopesAllowed`, and binds the ref the kind
 * needs (`global` carries none). Returns a clean `{ok:false, reason}` — surfaced as the
 * SAME `forbidden_scope` envelope the ambient path produces — on any violation.
 */
function resolveExplicitCliScope(
  raw: string,
  input: {
    readonly descriptor: OperatorCommandDescriptor
    readonly ctx: CliPrincipalContext
    readonly flags: CliParseFlags
    readonly allowed: readonly ScopeKind[]
  },
): { ok: true; scope: OperatorScope } | { ok: false; reason: string } {
  const kind = raw.toLowerCase() as ScopeKind
  if (!CLI_SCOPE_KINDS.includes(kind)) {
    return { ok: false, reason: `unknown scope kind: ${raw} (expected global|project|session|root-tree)` }
  }
  // Reject a conflicting explicit ref flag of a DIFFERENT kind (least-surprising: the two
  // selectors must agree, so a mistaken `--scope global --project p` is an error not a silent win).
  if (input.flags.session?.trim() && kind !== "session")
    return { ok: false, reason: `--scope ${kind} conflicts with --session` }
  if (input.flags.project?.trim() && kind !== "project")
    return { ok: false, reason: `--scope ${kind} conflicts with --project` }
  if (input.flags.rootTree?.trim() && kind !== "root-tree")
    return { ok: false, reason: `--scope ${kind} conflicts with --root-tree` }
  if (!input.allowed.includes(kind)) {
    return { ok: false, reason: `command ${input.descriptor.id} does not allow ${kind} scope` }
  }
  switch (kind) {
    case "global":
      return { ok: true, scope: { kind: "global", ref: null } }
    case "project": {
      const ref = input.flags.project?.trim() || input.ctx.projectId || null
      if (!ref) return { ok: false, reason: `command ${input.descriptor.id} project scope requires a project ref` }
      if (input.ctx.projectId && ref !== input.ctx.projectId && input.ctx.projectId !== "local") {
        return { ok: false, reason: `cross-project scope denied (cwd=${input.ctx.projectId}, requested=${ref})` }
      }
      return { ok: true, scope: { kind: "project", ref } }
    }
    case "session": {
      const ref = input.flags.session?.trim() || input.ctx.sessionId || null
      if (!ref) return { ok: false, reason: `command ${input.descriptor.id} session scope requires a session ref` }
      return { ok: true, scope: { kind: "session", ref } }
    }
    case "root-tree": {
      const ref = input.flags.rootTree?.trim() || input.ctx.rootTreeRef || null
      if (!ref) return { ok: false, reason: `command ${input.descriptor.id} root-tree scope requires a root-tree ref` }
      return { ok: true, scope: { kind: "root-tree", ref } }
    }
  }
}

/** HTTP-parity JSON depth/size bound (arrays ≤1000, keys ≤200, depth ≤12). */
export function isBoundedCliJson(value: unknown, depth = 0, maxDepth = CLI_MAX_JSON_DEPTH): boolean {
  if (depth > maxDepth) return false
  if (value === null || typeof value !== "object") return true
  if (Array.isArray(value)) {
    if (value.length > CLI_MAX_ARRAY_LEN) return false
    return value.every((v) => isBoundedCliJson(v, depth + 1, maxDepth))
  }
  const keys = Object.keys(value as object)
  if (keys.length > CLI_MAX_OBJECT_KEYS) return false
  return keys.every((k) => isBoundedCliJson((value as Record<string, unknown>)[k], depth + 1, maxDepth))
}

/**
 * Byte-size gate before parse (argv string / file / stdin).
 * Rejects oversized without JSON.parse of huge material.
 */
export function assertPayloadByteLimit(
  raw: string | undefined,
  maxBytes = CLI_MAX_PAYLOAD_BYTES,
): { ok: true } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true }
  const bytes = Buffer.byteLength(raw, "utf8")
  if (bytes > maxBytes) {
    return { ok: false, reason: `payload exceeds ${maxBytes} bytes` }
  }
  return { ok: true }
}

/**
 * Bounded read for payload-file / stdin.
 * Files: stat size first; stdin: stream until limit+1 then reject.
 */
export async function readBoundedPayloadSource(input: {
  readonly payload?: string
  readonly payloadFile?: string
  readonly maxBytes?: number
  readonly readStdin?: () => Promise<string>
}): Promise<{ ok: true; raw?: string } | { ok: false; reason: string }> {
  const maxBytes = input.maxBytes ?? CLI_MAX_PAYLOAD_BYTES

  if (input.payloadFile) {
    if (input.payloadFile === "-") {
      const readStdin =
        input.readStdin ??
        (async () => {
          // Stream-bounded: stop after maxBytes+1 without buffering unbounded.
          const chunks: Uint8Array[] = []
          let total = 0
          const reader = Bun.stdin.stream().getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            total += value.byteLength
            if (total > maxBytes) {
              await reader.cancel()
              throw new Error(`payload exceeds ${maxBytes} bytes`)
            }
            chunks.push(value)
          }
          const out = new Uint8Array(total)
          let offset = 0
          for (const c of chunks) {
            out.set(c, offset)
            offset += c.byteLength
          }
          return new TextDecoder().decode(out)
        })
      try {
        const raw = await readStdin()
        const gate = assertPayloadByteLimit(raw, maxBytes)
        if (!gate.ok) return gate
        return { ok: true, raw }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return { ok: false, reason: message }
      }
    }

    const file = Bun.file(input.payloadFile)
    if (!(await file.exists())) {
      return { ok: false, reason: `payload file not found: ${input.payloadFile}` }
    }
    if (typeof file.size === "number" && file.size > maxBytes) {
      return { ok: false, reason: `payload exceeds ${maxBytes} bytes` }
    }
    // Defensive: even if size is unknown, slice first maxBytes+1
    const buf = await file.arrayBuffer()
    if (buf.byteLength > maxBytes) {
      return { ok: false, reason: `payload exceeds ${maxBytes} bytes` }
    }
    return { ok: true, raw: new TextDecoder().decode(buf) }
  }

  if (input.payload !== undefined) {
    const gate = assertPayloadByteLimit(input.payload, maxBytes)
    if (!gate.ok) return gate
    return { ok: true, raw: input.payload }
  }

  return { ok: true }
}

/**
 * Strict JSON payload from string.
 * Strips principal/scope/confirm/source. Extracts version/idempotencyKey.
  * Always runs recursive bounded plaintext/SecretRef scan (SecretRef only; no plaintext).
 */
export function parseCliPayload(
  raw: string | undefined,
): {
  readonly ok: true
  readonly payload: Record<string, unknown>
  readonly expectedVersion?: string
  readonly idempotencyKey?: string
} | {
  readonly ok: false
  readonly reason: string
} {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, payload: {} }
  }

  const byteGate = assertPayloadByteLimit(raw)
  if (!byteGate.ok) return byteGate

  const trimmed = raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, reason: "payload must be strict JSON" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "payload must be a JSON object" }
  }
  if (!isBoundedCliJson(parsed)) {
    return { ok: false, reason: "JSON depth/size bound exceeded" }
  }

  const record = { ...(parsed as Record<string, unknown>) }
  delete record.principal
  delete record.confirm
  delete record.source
  delete record.scope

  const expectedVersion =
    typeof record.expectedVersion === "string"
      ? record.expectedVersion
      : typeof record.version === "string"
        ? record.version
        : undefined
  const idempotencyKey = typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined
  delete record.expectedVersion
  delete record.version
  delete record.idempotencyKey

  // Recursive SecretRef-exact validator (same core scanner as HTTP/dispatcher).
  const hits = findPlaintextSecretFields(record)
  if (hits.length > 0) {
    return {
      ok: false,
      reason: `plaintext secrets are forbidden in operator payloads; use SecretRef only (keychain backend): ${hits.join(",")}`,
    }
  }

  return { ok: true, payload: record, expectedVersion, idempotencyKey }
}

export function isSecretDomainCommand(id: string): boolean {
  return id.startsWith("secret.") || id.includes(".secret.") || id.endsWith(".rotate-secret")
}

export function parseCliInvocation(input: {
  readonly segments: readonly string[]
  readonly flags: CliParseFlags
  readonly registry: OperatorCommandRegistry
  readonly ctx: CliPrincipalContext
  readonly payloadRaw?: string
}): CliParseResult {
  const resolved = resolveCliCommandId(input.segments, input.registry)
  if (!resolved.ok) {
    return {
      ok: false,
      result: failureResult({
        id: resolved.raw || "unknown",
        code: "invalid_argument",
        message: resolved.reason,
        details: { source: "cli", reason: "unknown_or_invalid_command" },
      }),
      usage: "opencode op <domain> <operation> [qualifiers...] | opencode op <canonical.dotted.id>",
    }
  }

  const scopeRes = resolveCliScope({
    descriptor: resolved.descriptor,
    ctx: input.ctx,
    flags: input.flags,
  })
  if (!scopeRes.ok) {
    return {
      ok: false,
      result: failureResult({
        id: resolved.id,
        code: "forbidden_scope",
        message: scopeRes.reason,
        details: { source: "cli" },
      }),
    }
  }

  const payloadRes = parseCliPayload(input.payloadRaw)
  if (!payloadRes.ok) {
    return {
      ok: false,
      result: failureResult({
        id: resolved.id,
        code: "invalid_argument",
        message: payloadRes.reason,
        details: { source: "cli" },
      }),
    }
  }

  const versionRaw = input.flags.expectedVersion ?? payloadRes.expectedVersion
  const idempotencyKey = input.flags.idempotencyKey ?? payloadRes.idempotencyKey
  // Create sentinels: documented form `--expected-version=-` or `null` / `none` → omit CAS token.
  const version = normalizeExpectedVersion(versionRaw)

  if (resolved.descriptor.mutates) {
    if (!idempotencyKey || idempotencyKey.trim() === "") {
      return {
        ok: false,
        result: failureResult({
          id: resolved.id,
          code: "invalid_argument",
          message: "mutations require --idempotency-key (or payload.idempotencyKey)",
          details: { source: "cli", field: "idempotencyKey" },
        }),
      }
    }
    if (versionRaw === undefined) {
      return {
        ok: false,
        result: failureResult({
          id: resolved.id,
          code: "invalid_argument",
          message: "mutations require --expected-version (CAS token, or --expected-version=- / null / none for create)",
          details: { source: "cli", field: "expectedVersion" },
        }),
      }
    }
    if (versionRaw.trim() === "") {
      return {
        ok: false,
        result: failureResult({
          id: resolved.id,
          code: "invalid_argument",
          message: "mutations require a non-empty --expected-version (use --expected-version=- for create)",
          details: { source: "cli", field: "expectedVersion" },
        }),
      }
    }
  }

  return {
    ok: true,
    commandId: resolved.id,
    descriptor: resolved.descriptor,
    scope: scopeRes.scope,
    payload: payloadRes.payload,
    ...(version !== undefined ? { version } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    yes: input.flags.yes === true,
    json: input.flags.json === true,
  }
}

/**
 * Map CLI create sentinels to omitted version (CAS create-if-absent).
 * Canonical documented form: `--expected-version=-` (also `null`, `none`).
 */
export function normalizeExpectedVersion(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const t = raw.trim().toLowerCase()
  if (t === "null" || t === "-" || t === "none") return undefined
  return raw.trim()
}

export * as OperatorCliParse from "./cli-parse"
