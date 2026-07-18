/**
 * Feature 002 / T020 — Admission controller.
 *
 * Grants `granted`/`partial`/`queued`/`rejected` admission decisions per
 * `AdmissionScope` (global/root/session/child/provider/agent/tool/
 * event_queue/otel_queue/sqlite/token/cost), composed from the per-scope
 * token bucket (./token-bucket.ts) and the measured capacity signals
 * (./capacity.ts). Requested-versus-granted fanout is always projected on the
 * result (FR31); no branch ever silently drops or inflates it.
 *
 * Ownership boundary (C11): this module IS the admission authority. It never
 * calls execution APIs, never mutates a Process Table row, and never acts as
 * a scheduler — it only answers "how much of this request is admitted right
 * now" for a single scope+key pair, deterministically, with no unbounded
 * internal queue (FR30, FR33): every call returns a decision immediately from
 * the bucket's present state, there is no retained backlog that grows across
 * calls.
 *
 * Fairness (FR32, AC21): `requestBatch` composes the same min(requested,
 * available) admission the single-request path uses, but when several
 * requests contend for one scope+key's bucket at once it distributes the
 * available tokens by parent/child fairness weight instead of granting
 * strictly in call order, so starvation under saturation stays observable
 * rather than silently favoring whichever request happened to run first.
 *
 * Root-fence quarantine (C17): `fence` marks a scope+key as fenced after a
 * root cancel; every subsequent request against it is rejected until an
 * explicit `unfence`, so cancelled descendants can never re-admit new work
 * through the same bucket.
 *
 * Zero framework deps: no I/O. Time only ever enters through the injected
 * `nowMs` clock (defaults to `Date.now`), mirroring
 * `packages/opencode/src/operator/adapters/inbound/slash-confirm.ts`'s
 * `createSlashConfirmStore` factory shape.
 */
export * as AdmissionController from "./admission-controller"

import type { Admission } from "@opencode-ai/schema/lifecycle/admission"
import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import { isSaturated, UNMEASURED_CAPACITY_SIGNALS } from "./capacity"
import { createBucket, refill, tryAcquire } from "./token-bucket"

// =============================================================================
// Provisional plan constants (data-model.md "Parameters"; the future ADR
// "Task Process Lifecycle and Operational Observation" fixes final values).
// Every default is a named, overridable constant — never inlined into the
// algorithm below (FR34).
// =============================================================================

/** Per-scope hard ceilings. `global`/`root`/`session`/`child` mirror
 *  data-model.md's `admission_ceiling.*` defaults; the remaining scopes have
 *  no numeric default in the spec yet, so they share the `global` ceiling
 *  until the future ADR fixes a dedicated value per scope. */
export const DEFAULT_CEILINGS: Readonly<Record<EnumsObservation.AdmissionScope, number>> = {
  global: 64,
  root: 16,
  session: 8,
  child: 6,
  provider: 64,
  agent: 64,
  tool: 64,
  event_queue: 64,
  otel_queue: 64,
  sqlite: 64,
  token: 64,
  cost: 64,
}

/** `token_bucket_refill_per_second` default (data-model.md, AC1/AC21). */
export const DEFAULT_REFILL_PER_SECOND = 8

/** `fairness_weight.parent` / `fairness_weight.child` defaults (data-model.md, AC21). */
export const DEFAULT_FAIRNESS_WEIGHTS: Readonly<Record<"parent" | "child", number>> = {
  parent: 2,
  child: 1,
}

// =============================================================================
// Requests and results
// =============================================================================

export interface AdmissionRequest {
  readonly scope: EnumsObservation.AdmissionScope
  /** Disambiguates the specific instance within `scope` (a session id, a
   *  provider name, `"global"` for the singleton global scope, ...). */
  readonly key: string
  readonly requestedFanout: number
  /** Defaults to `UNMEASURED_CAPACITY_SIGNALS` when omitted (never fabricated). */
  readonly capacitySignals?: Admission.CapacitySignals
}

export interface BatchAdmissionRequest {
  readonly id: string
  readonly role: "parent" | "child"
  readonly requestedFanout: number
}

export interface BatchAdmissionEntry {
  readonly id: string
  readonly result: Admission.AdmissionResult
}

export interface AdmissionControllerOptions {
  readonly ceilings?: Partial<Record<EnumsObservation.AdmissionScope, number>>
  readonly refillPerSecond?: number
  readonly fairnessWeights?: Partial<Record<"parent" | "child", number>>
  readonly nowMs?: () => number
}

export interface AdmissionController {
  /** Single-request admission for one `AdmissionScope` instance (C11, FR30, FR31). */
  readonly request: (input: AdmissionRequest) => Admission.AdmissionResult
  /** Fairness-weighted admission across several contending requests for one
   *  scope+key bucket (FR32, AC21). */
  readonly requestBatch: (
    scope: EnumsObservation.AdmissionScope,
    key: string,
    requests: ReadonlyArray<BatchAdmissionRequest>,
    capacitySignals?: Admission.CapacitySignals,
  ) => ReadonlyArray<BatchAdmissionEntry>
  /** Quarantine a scope+key after a root cancel; every later request is rejected (C17). */
  readonly fence: (scope: EnumsObservation.AdmissionScope, key: string) => void
  /** Lift a prior `fence` (explicit only — never automatic). */
  readonly unfence: (scope: EnumsObservation.AdmissionScope, key: string) => void
  readonly isFenced: (scope: EnumsObservation.AdmissionScope, key: string) => boolean
  /** Present bucket + fence state for one scope+key, refilled to `now` (observability). */
  readonly bucketState: (scope: EnumsObservation.AdmissionScope, key: string) => Admission.AdmissionBucket
}

export function createAdmissionController(options?: AdmissionControllerOptions): AdmissionController {
  const ceilings = { ...DEFAULT_CEILINGS, ...options?.ceilings }
  const refillPerSecond = options?.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND
  const fairnessWeights = { ...DEFAULT_FAIRNESS_WEIGHTS, ...options?.fairnessWeights }
  const nowMs = options?.nowMs ?? (() => Date.now())

  const buckets = new Map<string, Admission.TokenBucketState>()
  const lastTouchedMs = new Map<string, number>()
  const fenced = new Set<string>()

  function bucketKey(scope: EnumsObservation.AdmissionScope, key: string): string {
    return `${scope}${key}`
  }

  function ceilingFor(scope: EnumsObservation.AdmissionScope): number {
    return ceilings[scope] ?? 0
  }

  function ensureBucket(scope: EnumsObservation.AdmissionScope, key: string): Admission.TokenBucketState {
    const bkey = bucketKey(scope, key)
    const now = nowMs()
    const existing = buckets.get(bkey)
    if (!existing) {
      const created = createBucket(ceilingFor(scope), refillPerSecond)
      buckets.set(bkey, created)
      lastTouchedMs.set(bkey, now)
      return created
    }
    const elapsed = now - (lastTouchedMs.get(bkey) ?? now)
    const refilled = refill(existing, elapsed)
    buckets.set(bkey, refilled)
    lastTouchedMs.set(bkey, now)
    return refilled
  }

  function outcome(
    scope: EnumsObservation.AdmissionScope,
    decision: EnumsObservation.AdmissionDecision,
    requested: number,
    granted: number,
    reason: string,
  ): Admission.AdmissionResult {
    return { scope, decision, fanout: { requested, granted }, reason }
  }

  function request(input: AdmissionRequest): Admission.AdmissionResult {
    const { scope, key } = input
    const requested = clampNonNegativeInt(input.requestedFanout)
    const signals = input.capacitySignals ?? UNMEASURED_CAPACITY_SIGNALS
    const bkey = bucketKey(scope, key)

    if (fenced.has(bkey)) return outcome(scope, "rejected", requested, 0, "fenced_after_root_cancel")
    if (requested === 0) return outcome(scope, "granted", 0, 0, "no fanout requested")
    if (ceilingFor(scope) <= 0) return outcome(scope, "rejected", requested, 0, `admission scope "${scope}" has a zero capacity ceiling`)
    if (isSaturated(scope, signals)) return outcome(scope, "queued", requested, 0, `admission scope "${scope}" saturated at/above reject threshold`)

    const bucket = ensureBucket(scope, key)
    const acquired = tryAcquire(bucket, requested)
    buckets.set(bkey, acquired.bucket)

    if (acquired.granted === requested) return outcome(scope, "granted", requested, acquired.granted, "fully admitted within token-bucket capacity")
    if (acquired.granted > 0) return outcome(scope, "partial", requested, acquired.granted, "partially admitted; token bucket exhausted before full grant")
    return outcome(scope, "queued", requested, 0, "token bucket exhausted; retry once refilled")
  }

  function requestBatch(
    scope: EnumsObservation.AdmissionScope,
    key: string,
    requests: ReadonlyArray<BatchAdmissionRequest>,
    capacitySignals?: Admission.CapacitySignals,
  ): ReadonlyArray<BatchAdmissionEntry> {
    const signals = capacitySignals ?? UNMEASURED_CAPACITY_SIGNALS
    const bkey = bucketKey(scope, key)
    const wants = requests.map((r) => clampNonNegativeInt(r.requestedFanout))

    if (fenced.has(bkey)) {
      return requests.map((r, i) => ({ id: r.id, result: outcome(scope, "rejected", wants[i]!, 0, "fenced_after_root_cancel") }))
    }
    if (ceilingFor(scope) <= 0) {
      return requests.map((r, i) => ({
        id: r.id,
        result: outcome(scope, "rejected", wants[i]!, 0, `admission scope "${scope}" has a zero capacity ceiling`),
      }))
    }
    if (isSaturated(scope, signals)) {
      return requests.map((r, i) => ({
        id: r.id,
        result: outcome(scope, "queued", wants[i]!, 0, `admission scope "${scope}" saturated at/above reject threshold`),
      }))
    }

    const bucket = ensureBucket(scope, key)
    const totalWanted = wants.reduce((sum, w) => sum + w, 0)

    let grantedCounts: number[]
    if (totalWanted <= bucket.available) {
      // No contention: every request is admitted in full.
      grantedCounts = wants
    } else {
      // Contention: distribute the available tokens by parent/child fairness
      // weight rather than call order (FR32, AC21).
      const weights = requests.map((r) => fairnessWeights[r.role])
      const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1
      const shares = weights.map((w) => Math.floor((bucket.available * w) / totalWeight))
      let remaining = bucket.available - shares.reduce((sum, s) => sum + s, 0)
      const byWeightDesc = requests.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]!)
      for (const i of byWeightDesc) {
        if (remaining <= 0) break
        const room = wants[i]! - shares[i]!
        if (room <= 0) continue
        const take = Math.min(room, remaining)
        shares[i]! += take
        remaining -= take
      }
      grantedCounts = requests.map((_, i) => Math.min(wants[i]!, shares[i]!))
    }

    const totalGranted = grantedCounts.reduce((sum, g) => sum + g, 0)
    const acquired = tryAcquire(bucket, totalGranted)
    buckets.set(bkey, acquired.bucket)

    return requests.map((r, i) => {
      const requested = wants[i]!
      const granted = grantedCounts[i]!
      if (requested === 0) return { id: r.id, result: outcome(scope, "granted", 0, 0, "no fanout requested") }
      if (granted === requested) return { id: r.id, result: outcome(scope, "granted", requested, granted, `fully admitted under ${r.role} fairness weight`) }
      if (granted > 0) return { id: r.id, result: outcome(scope, "partial", requested, granted, `partially admitted under ${r.role} fairness weight`) }
      return { id: r.id, result: outcome(scope, "queued", requested, 0, `starved under contention; ${r.role} fairness weight yielded zero this round`) }
    })
  }

  return {
    request,
    requestBatch,
    fence(scope, key) {
      fenced.add(bucketKey(scope, key))
    },
    unfence(scope, key) {
      fenced.delete(bucketKey(scope, key))
    },
    isFenced(scope, key) {
      return fenced.has(bucketKey(scope, key))
    },
    bucketState(scope, key) {
      const bucket = ensureBucket(scope, key)
      return { scope, bucket, fenced: fenced.has(bucketKey(scope, key)) }
    },
  }
}

function clampNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}
