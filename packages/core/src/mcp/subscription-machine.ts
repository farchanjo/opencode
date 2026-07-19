/**
 * Feature 008 / T018 (S10) — the resource-subscription lifecycle machine.
 *
 * Encodes the closed `unsubscribed → subscribing → subscribed → unsubscribing`
 * machine with the `fail_closed` posture drawn in `plan.md` "Resource subscription
 * lifecycle", `subscription.cue`, and `enums-state.cue` (FR21, C10). Pure and
 * deterministic, no I/O. Leaving `unsubscribed` requires BOTH the server
 * `resources.subscribe` capability AND an operator grant — the LLM never subscribes.
 * An unauthorized subscribe or a capability lost while subscribed moves to
 * `fail_closed`, so any unauthorized subscribe/read/delivery fails closed (FR21, C10).
 */
export * as SubscriptionMachine from "./subscription-machine"

import type { SubscriptionState } from "@opencode-ai/schema/mcp/enums-state"

export type { SubscriptionState }

/** The five subscription states, in statechart order (C10). */
export const SUBSCRIPTION_STATES = [
  "unsubscribed",
  "subscribing",
  "subscribed",
  "unsubscribing",
  "fail_closed",
] as const satisfies ReadonlyArray<SubscriptionState>

/** The closed trigger vocabulary driving the subscription machine (statechart labels, C10). */
export type Trigger =
  | "subscribe"
  | "acknowledge"
  | "unsubscribe"
  | "unsubscribe_ack"
  | "capability_lost"
  | "unauthorized"
  | "clear"

/** The dual authority required to subscribe: server capability AND operator grant (FR21, C10). */
export interface Authority {
  readonly serverCapable: boolean
  readonly operatorGranted: boolean
}

/** The outcome of applying a trigger to a subscription state (never thrown). */
export type TransitionResult =
  | { readonly kind: "transition"; readonly from: SubscriptionState; readonly to: SubscriptionState; readonly trigger: Trigger }
  | { readonly kind: "fail_closed"; readonly from: SubscriptionState; readonly reason: FailClosedReason }
  | { readonly kind: "illegal"; readonly from: SubscriptionState; readonly trigger: Trigger }

/** Why a subscription failed closed (C10). */
export type FailClosedReason = "capability_absent" | "unauthorized" | "capability_lost"

const transition = (from: SubscriptionState, to: SubscriptionState, trigger: Trigger): TransitionResult =>
  Object.freeze({ kind: "transition", from, to, trigger })
const failClosed = (from: SubscriptionState, reason: FailClosedReason): TransitionResult =>
  Object.freeze({ kind: "fail_closed", from, reason })
const illegal = (from: SubscriptionState, trigger: Trigger): TransitionResult => Object.freeze({ kind: "illegal", from, trigger })

/**
 * Apply a `subscribe` from `unsubscribed`: it requires BOTH the server capability
 * and the operator grant. A missing capability or grant fails closed rather than
 * subscribing — the LLM can never satisfy this (FR21, C10).
 */
const applySubscribe = (authority: Authority): TransitionResult => {
  if (!authority.serverCapable) return failClosed("unsubscribed", "capability_absent")
  if (!authority.operatorGranted) return failClosed("unsubscribed", "unauthorized")
  return transition("unsubscribed", "subscribing", "subscribe")
}

/**
 * Apply a trigger to a subscription state and return the typed outcome. Pure and
 * total: it never throws. `subscribe` is authority-gated; `capability_lost` and
 * `unauthorized` fail closed; every other pair follows the closed statechart or is
 * `illegal` (FR21, C10). `authority` is only consulted for `subscribe`.
 */
export const apply = (
  state: SubscriptionState,
  trigger: Trigger,
  authority: Authority = { serverCapable: false, operatorGranted: false },
): TransitionResult => {
  if (trigger === "capability_lost") {
    return state === "subscribed" || state === "subscribing"
      ? failClosed(state, "capability_lost")
      : illegal(state, trigger)
  }
  switch (state) {
    case "unsubscribed":
      if (trigger === "subscribe") return applySubscribe(authority)
      return illegal(state, trigger)
    case "subscribing":
      if (trigger === "acknowledge") return transition(state, "subscribed", trigger)
      if (trigger === "unauthorized") return failClosed(state, "unauthorized")
      return illegal(state, trigger)
    case "subscribed":
      if (trigger === "unsubscribe") return transition(state, "unsubscribing", trigger)
      return illegal(state, trigger)
    case "unsubscribing":
      if (trigger === "unsubscribe_ack") return transition(state, "unsubscribed", trigger)
      return illegal(state, trigger)
    case "fail_closed":
      if (trigger === "clear") return transition(state, "unsubscribed", trigger)
      return illegal(state, trigger)
  }
}

/**
 * Whether a runtime read/delivery is authorized for the subscription state. Only a
 * live `subscribed` state permits delivery; every other state — including
 * `fail_closed` — withholds it, so an unauthorized subscribe/read/delivery fails
 * closed (FR21, C10).
 */
export const deliveryAuthorized = (state: SubscriptionState): boolean => state === "subscribed"
