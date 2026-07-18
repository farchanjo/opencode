/**
 * Feature 005 / T020 (S10) — admission and fault classification with the
 * degrade-then-fence policy.
 *
 * Framework-free and deterministic: faults are classified from an injected raw
 * signal and the fence decision is driven by an injected clock reading, so the
 * whole policy is reproducible under a fault-injecting test port (FR10, C4, AC5,
 * AC6, AC7). No fault is ever swallowed — ENOSPC, fd exhaustion, quota exceed,
 * permission denial, and sustained disk latency are all first-class observable
 * `AdmissionFault` states (FR10, C4).
 *
 * Policy (FR10, C4, AC5, AC6, AC7):
 *   - A transient fault backpressures the producer (the writer queue stops
 *     accepting appends) while committed bytes are preserved.
 *   - A fault persisting past the bounded persistence window fences the channel:
 *     to `aborted` when committed bytes are intact, to `corrupt` when committed
 *     bytes were lost.
 *   - `seal` never reports success when bytes were lost: a sealed extent shorter
 *     than the committed-length authority settles `corrupt`, never `sealed`.
 */
export * as Admission from "./admission"

import type { AdmissionFault } from "@opencode-ai/schema/outputspool/enums"
import type { SettlementOutcome } from "@opencode-ai/schema/outputspool/enums-event"

export type { AdmissionFault, SettlementOutcome }

/** A raw fault signal from the injected filesystem port, before classification. */
export type RawFault =
  | { readonly kind: "ok" }
  | { readonly kind: "syscall"; readonly code: string }
  | { readonly kind: "quota" }
  | { readonly kind: "latency"; readonly latency_ms: number; readonly threshold_ms: number }

const SYSCALL_FAULTS: Readonly<Record<string, AdmissionFault>> = Object.freeze({
  ENOSPC: "enospc",
  EMFILE: "fd_exhaustion",
  ENFILE: "fd_exhaustion",
  EACCES: "permission",
  EPERM: "permission",
  EDQUOT: "quota",
})

/**
 * Classify a raw fault into a first-class `AdmissionFault`. An unrecognized
 * syscall code or a sub-threshold latency is `none` — never a swallowed error,
 * just no observable fault (FR10, C4).
 */
export const classify = (raw: RawFault): AdmissionFault => {
  switch (raw.kind) {
    case "ok":
      return "none"
    case "syscall":
      return SYSCALL_FAULTS[raw.code] ?? "none"
    case "quota":
      return "quota"
    case "latency":
      return raw.latency_ms >= raw.threshold_ms ? "latency" : "none"
  }
}

/** The degrade tracker: the current fault and the instant it began, if any. */
export interface DegradeState {
  readonly fault: AdmissionFault
  /** The instant the current fault first began, or `null` when there is no fault. */
  readonly since_ms: number | null
}

/** The cleared tracker: no fault in progress. */
export const CLEAR: DegradeState = Object.freeze({ fault: "none", since_ms: null })

/**
 * Fold one observed fault into the degrade tracker. `none` clears it; a
 * continuation of the same fault preserves the original `since_ms` (so the
 * persistence window measures real elapsed fault time); a new or changed fault
 * begins the window at `now_ms` (FR10, C4, AC6).
 */
export const observe = (state: DegradeState, fault: AdmissionFault, now_ms: number): DegradeState => {
  if (fault === "none") return CLEAR
  if (state.fault === fault && state.since_ms !== null) return state
  return Object.freeze({ fault, since_ms: now_ms })
}

/**
 * Whether a persistent fault has crossed the bounded persistence window and must
 * now be fenced. A cleared or newly-begun fault is never fenced early (FR10, C4,
 * AC6).
 */
export const shouldFence = (state: DegradeState, now_ms: number, window_ms: number): boolean =>
  state.fault !== "none" && state.since_ms !== null && now_ms - state.since_ms >= window_ms

/** A fence outcome: a terminal state preserving committed bytes, or a corrupt loss. */
export type FenceOutcome = "aborted" | "corrupt"

/**
 * The terminal state a fenced channel settles into. Committed bytes intact →
 * `aborted` (append stops, bytes preserved); committed bytes lost → `corrupt`
 * (FR10, C4, AC6, AC7).
 */
export const fenceOutcome = (committed_lost: boolean): FenceOutcome => (committed_lost ? "corrupt" : "aborted")

/**
 * The seal outcome given the committed-length authority and the observed data
 * extent. Seal never lies: an extent shorter than the committed length settles
 * `corrupt`, never `sealed` (FR10, FR24, C4, C12, AC6, AC8).
 */
export const sealOutcome = (committed_bytes: number, observed_extent: number): SettlementOutcome =>
  observed_extent >= committed_bytes ? "sealed" : "corrupt"
