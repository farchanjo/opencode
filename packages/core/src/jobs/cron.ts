/**
 * Feature 003 / T013 (S5) — cron parse/validate and next-occurrence domain.
 *
 * Framework-free, deterministic, zero I/O. This module owns the DOMAIN half of
 * the scheduling contract: it defines the `NextOccurrencePort` / `ClockPort`
 * seams (a thin wrapper over `Bun.cron.parse`, implemented by the wave-3 Bun
 * adapter, NEVER importing the Bun runtime here per ADR-0004 and the plan
 * "Dependency rule"), plus the pure logic layered over them — 5-field / IANA
 * validation, minimum-interval flooring, DST duplicate/skip/leap normalization
 * per a configured policy, and schedule-lag measurement from the nominal due
 * instant (FR7, C4, AC4, AC22).
 *
 * The runtime interprets a cron expression against a timezone and yields the
 * next UTC instant; the domain treats that instant as a canonical scheduling
 * key and applies the minimum-interval and DST policies deterministically.
 * Callers pass every instant explicitly (mirroring
 * `packages/core/src/lifecycle/admission/token-bucket.ts`'s `nowMs` style), so
 * the whole module is trivially testable under a fake clock and a mock port.
 */
export * as Cron from "./cron"

// =============================================================================
// Injected seams (implemented by the wave-3 Bun adapter, never here)
// =============================================================================

/**
 * The clock seam. The domain never reads the wall clock directly; the adapter
 * (or a test fake) supplies `now` in epoch milliseconds, keeping every
 * next-occurrence and lag computation deterministic (C4).
 */
export interface ClockPort {
  readonly now: () => number
}

/** A single next-occurrence query against a stored schedule. */
export interface NextOccurrenceQuery {
  /** 5-field cron expression or supported nickname (validated separately). */
  readonly expression: string
  /** Requested IANA timezone; the port resolves the wall clock against it. */
  readonly timezone: string
  /** Return the first nominal instant strictly greater than this epoch-ms anchor. */
  readonly afterMs: number
}

/**
 * The next-occurrence seam over `Bun.cron.parse` (C1, C4). Returns the next
 * nominal UTC instant strictly after `afterMs` in epoch milliseconds, or `null`
 * when the schedule has no further occurrence. The adapter — never this domain —
 * owns the actual `Bun.cron.parse` call and timezone resolution.
 */
export interface NextOccurrencePort {
  readonly next: (query: NextOccurrenceQuery) => number | null
}

// =============================================================================
// Cron expression validation (pure)
// =============================================================================

/** The supported cron nicknames, mirroring `schedule.cue`'s `#CronExpression`. */
export const CRON_NICKNAMES = ["@annually", "@yearly", "@monthly", "@weekly", "@daily", "@hourly"] as const

const nicknameSet = new Set<string>(CRON_NICKNAMES)

/** The canonical field count of a non-nickname cron expression (minute..day-of-week). */
export const CRON_FIELD_COUNT = 5 as const

/** The typed outcome of parsing a cron expression. */
export type CronParse =
  | { readonly kind: "fields"; readonly fields: readonly [string, string, string, string, string] }
  | { readonly kind: "nickname"; readonly nickname: (typeof CRON_NICKNAMES)[number] }
  | { readonly kind: "invalid"; readonly reason: string }

/**
 * Parse and structurally validate a cron expression: either one of the six
 * supported nicknames, or exactly five whitespace-separated fields (FR7, C4).
 * Pure and total — an unsupported or malformed expression yields an `invalid`
 * result with a reason rather than throwing, so the adapter surfaces a typed
 * capability/validation gap before registration (AC22).
 */
export const parseCronExpression = (expression: string): CronParse => {
  const trimmed = expression.trim()
  if (trimmed.length === 0) return { kind: "invalid", reason: "empty cron expression" }
  if (trimmed.startsWith("@")) {
    if (nicknameSet.has(trimmed)) return { kind: "nickname", nickname: trimmed as (typeof CRON_NICKNAMES)[number] }
    return { kind: "invalid", reason: `unsupported cron nickname: ${trimmed}` }
  }
  const fields = trimmed.split(/\s+/)
  if (fields.length !== CRON_FIELD_COUNT) {
    return { kind: "invalid", reason: `expected ${CRON_FIELD_COUNT} cron fields, got ${fields.length}` }
  }
  return { kind: "fields", fields: fields as unknown as readonly [string, string, string, string, string] }
}

/** True when the expression is a structurally valid nickname or 5-field form. */
export const isValidCronExpression = (expression: string): boolean =>
  parseCronExpression(expression).kind !== "invalid"

// =============================================================================
// DST normalization (pure)
// =============================================================================

/**
 * How to resolve a wall-clock instant that maps to two UTC instants during a
 * fall-back DST transition (the "duplicate" hour). `skip` drops the ambiguous
 * occurrence as an explicit no-fire outcome (C4).
 */
export type DstAmbiguityPolicy = "earliest" | "latest" | "skip"

/** Provisional default DST ambiguity resolution (AC4); explicit, overridable data. */
export const DEFAULT_DST_AMBIGUITY_POLICY: DstAmbiguityPolicy = "earliest"

/**
 * Resolve a fall-back DST duplicate to a single canonical instant per policy.
 * `candidates` are the distinct UTC instants the port produced for one nominal
 * wall-clock time (typically two on a fall-back boundary). A spring-forward
 * "skipped" wall time never reaches here — the port already returns the next
 * existing instant — and a leap-year/leap-day boundary is ordinary calendar
 * arithmetic the port resolves, so this resolver only handles the duplicate
 * case. Pure and total; an empty candidate set or `skip` yields `null`.
 */
export const resolveDstAmbiguity = (
  candidates: readonly number[],
  policy: DstAmbiguityPolicy = DEFAULT_DST_AMBIGUITY_POLICY,
): number | null => {
  if (candidates.length === 0) return null
  if (policy === "skip") return candidates.length > 1 ? null : candidates[0]!
  const sorted = [...candidates].sort((a, b) => a - b)
  return policy === "earliest" ? sorted[0]! : sorted[sorted.length - 1]!
}

// =============================================================================
// Next-occurrence computation with minimum-interval flooring (pure)
// =============================================================================

/** Provisional minimum interval between accepted occurrences (AC4); overridable data. */
export const DEFAULT_MINIMUM_INTERVAL_MS = 60_000 as const

/** Provisional tolerance absorbing benign clock skew when measuring lag (AC4); overridable data. */
export const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 2_000 as const

/**
 * A hard ceiling on re-query iterations while enforcing the minimum interval,
 * so a pathological schedule/port can never spin unbounded (C19).
 */
export const MAX_NEXT_OCCURRENCE_ITERATIONS = 512 as const

export interface NextOccurrenceRequest {
  readonly expression: string
  readonly timezone: string
  /** Anchor: return the first occurrence strictly after this epoch-ms instant. */
  readonly afterMs: number
  /** Minimum accepted gap from `lastNominalMs`; floored non-negative. */
  readonly minimumIntervalMs?: number
  /** The previously accepted nominal instant, when enforcing the minimum interval. */
  readonly lastNominalMs?: number | null
}

/**
 * Compute the next nominal occurrence over the injected `NextOccurrencePort`,
 * flooring by the minimum interval relative to `lastNominalMs` (C4, AC4). The
 * port owns the timezone-aware cron math; this function only advances the
 * anchor and re-queries — bounded by `MAX_NEXT_OCCURRENCE_ITERATIONS` — until
 * the returned instant clears the minimum interval, or returns `null` when the
 * schedule is exhausted. Pure relative to the port; no wall-clock read.
 */
export const computeNextOccurrence = (port: NextOccurrencePort, request: NextOccurrenceRequest): number | null => {
  const minIntervalMs = clampNonNegative(request.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS)
  const lastNominalMs = request.lastNominalMs ?? null
  let anchor = request.afterMs
  if (lastNominalMs !== null && minIntervalMs > 0) {
    const floorAnchor = lastNominalMs + minIntervalMs - 1
    if (floorAnchor > anchor) anchor = floorAnchor
  }
  for (let i = 0; i < MAX_NEXT_OCCURRENCE_ITERATIONS; i++) {
    const candidate = port.next({ expression: request.expression, timezone: request.timezone, afterMs: anchor })
    if (candidate === null) return null
    if (lastNominalMs === null || minIntervalMs === 0 || candidate - lastNominalMs >= minIntervalMs) return candidate
    // Too close to the last accepted occurrence: advance the anchor past this
    // candidate and re-query. Bounded by the iteration ceiling above.
    anchor = candidate
  }
  return null
}

// =============================================================================
// Canonical keys and lag (pure)
// =============================================================================

/**
 * The canonical `NominalDueTime` string key for an epoch-ms instant: an ISO-8601
 * UTC timestamp. It is a stable identity for the idempotency tuple, never a
 * decoded `DateTime` (data-model "Schema surface conventions", C6). Returned as
 * a plain `string`; the schema layer brands it as `Jobs.NominalDueTime`.
 */
export const nominalDueKey = (epochMs: number): string => new Date(epochMs).toISOString()

/**
 * Schedule lag from the nominal due instant to the observed trigger instant
 * (FR19, AC3, AC4). Clamped non-negative: a trigger observed slightly before
 * nominal (within benign clock skew) reports zero lag rather than a negative
 * value. Pure.
 */
export const scheduleLagMs = (nominalMs: number, observedMs: number): number => {
  const lag = observedMs - nominalMs
  return lag > 0 ? lag : 0
}

/**
 * True when `observedMs` sits within `toleranceMs` of the nominal instant on
 * either side — a benign-skew check the trigger layer uses before treating a
 * gap as real lag (AC4).
 */
export const isWithinClockSkew = (
  nominalMs: number,
  observedMs: number,
  toleranceMs: number = DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
): boolean => Math.abs(observedMs - nominalMs) <= clampNonNegative(toleranceMs)

const clampNonNegative = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
