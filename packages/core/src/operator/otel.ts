/**
 * Content-free OTEL labels for operator control plane (T046).
 * Allowed: command_id, domain, surface, scope_kind, outcome, error_code, duration_ms, retry.
 * Forbidden: args, payload, path, secret, project ids, user text.
 */
export const OPERATOR_OTEL_ALLOWED_KEYS = [
  "command_id",
  "domain",
  "surface",
  "scope_kind",
  "outcome",
  "error_code",
  "duration_ms",
  "retry",
] as const

export type OperatorOtelKey = (typeof OPERATOR_OTEL_ALLOWED_KEYS)[number]

export type OperatorOtelAttributes = {
  readonly command_id: string
  readonly domain: string
  readonly surface: string
  readonly scope_kind: string
  readonly outcome: string
  readonly error_code?: string
  readonly duration_ms: number
  readonly retry: boolean
}

const ALLOWED = new Set<string>(OPERATOR_OTEL_ALLOWED_KEYS)

const FORBIDDEN_SUBSTRINGS = [
  "secret",
  "password",
  "token",
  "payload",
  "arg",
  "path",
  "project",
  "user",
  "content",
  "body",
  "message",
  "prompt",
]

export function buildOperatorOtelAttributes(input: {
  commandId: string
  domain: string
  surface: string
  scopeKind: string
  outcome: string
  errorCode?: string
  durationMs: number
  retry?: boolean
}): OperatorOtelAttributes {
  return {
    command_id: input.commandId,
    domain: input.domain,
    surface: input.surface,
    scope_kind: input.scopeKind,
    outcome: input.outcome,
    ...(input.errorCode !== undefined ? { error_code: input.errorCode } : {}),
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    retry: input.retry === true,
  }
}

/** Strip any non-allowlisted keys; fail if forbidden content sneaks in values. */
export function sanitizeOperatorOtelAttributes(
  attrs: Record<string, unknown>,
): { readonly ok: true; readonly attributes: OperatorOtelAttributes } | { readonly ok: false; readonly reason: string } {
  for (const key of Object.keys(attrs)) {
    if (!ALLOWED.has(key)) {
      return { ok: false, reason: `forbidden otel key: ${key}` }
    }
    if (FORBIDDEN_SUBSTRINGS.some((f) => key.includes(f) && key !== "error_code")) {
      // error_code is allowlisted
    }
  }
  const command_id = String(attrs.command_id ?? "")
  const domain = String(attrs.domain ?? "")
  const surface = String(attrs.surface ?? "")
  const scope_kind = String(attrs.scope_kind ?? "")
  const outcome = String(attrs.outcome ?? "")
  if (!command_id || !domain || !surface || !scope_kind || !outcome) {
    return { ok: false, reason: "missing required otel attributes" }
  }
  // Values must not look like secrets/paths
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "string" && (v.includes("/") || v.includes("sk_") || v.includes("Bearer "))) {
      return { ok: false, reason: `otel value for ${k} looks like path/secret` }
    }
  }
  return {
    ok: true,
    attributes: buildOperatorOtelAttributes({
      commandId: command_id,
      domain,
      surface,
      scopeKind: scope_kind,
      outcome,
      errorCode: attrs.error_code !== undefined ? String(attrs.error_code) : undefined,
      durationMs: Number(attrs.duration_ms ?? 0),
      retry: attrs.retry === true,
    }),
  }
}

export type OperatorSpanRecorder = {
  readonly record: (attrs: OperatorOtelAttributes) => void
  readonly snapshots: () => readonly OperatorOtelAttributes[]
}

/** Test/prod-light recorder (no double-count if used once per dispatch). */
export function createOperatorSpanRecorder(): OperatorSpanRecorder {
  const log: OperatorOtelAttributes[] = []
  return {
    record(attrs) {
      const s = sanitizeOperatorOtelAttributes(attrs as unknown as Record<string, unknown>)
      if (s.ok) log.push(s.attributes)
    },
    snapshots: () => [...log],
  }
}

export * as OperatorOtel from "./otel"
