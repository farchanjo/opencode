import { describe, expect, test } from "bun:test"
import { SubscriptionMachine } from "@opencode-ai/core/mcp/subscription-machine"

// Feature 008 / T018 (S10) — the subscription machine: a subscribe requires
// capability + operator grant, an unauthorized attempt and a lost capability fail
// closed, and unsubscribe returns to unsubscribed (FR21, C10).

const authorized: SubscriptionMachine.Authority = { serverCapable: true, operatorGranted: true }

describe("SubscriptionMachine — authority-gated subscribe (FR21, C10)", () => {
  test("a subscribe with capability + operator grant moves to subscribing", () => {
    const result = SubscriptionMachine.apply("unsubscribed", "subscribe", authorized)
    expect(result).toMatchObject({ kind: "transition", to: "subscribing" })
  })

  test("a subscribe without the server capability fails closed", () => {
    const result = SubscriptionMachine.apply("unsubscribed", "subscribe", { serverCapable: false, operatorGranted: true })
    expect(result).toMatchObject({ kind: "fail_closed", reason: "capability_absent" })
  })

  test("a subscribe without an operator grant fails closed (the LLM can never subscribe)", () => {
    const result = SubscriptionMachine.apply("unsubscribed", "subscribe", { serverCapable: true, operatorGranted: false })
    expect(result).toMatchObject({ kind: "fail_closed", reason: "unauthorized" })
  })
})

describe("SubscriptionMachine — lifecycle and fail-closed (C10)", () => {
  test("subscribing → subscribed → unsubscribing → unsubscribed", () => {
    expect(SubscriptionMachine.apply("subscribing", "acknowledge")).toMatchObject({ to: "subscribed" })
    expect(SubscriptionMachine.apply("subscribed", "unsubscribe")).toMatchObject({ to: "unsubscribing" })
    expect(SubscriptionMachine.apply("unsubscribing", "unsubscribe_ack")).toMatchObject({ to: "unsubscribed" })
  })

  test("a capability lost while subscribed fails closed", () => {
    const result = SubscriptionMachine.apply("subscribed", "capability_lost")
    expect(result).toMatchObject({ kind: "fail_closed", reason: "capability_lost" })
  })

  test("an unauthorized ack while subscribing fails closed and clear returns to unsubscribed", () => {
    expect(SubscriptionMachine.apply("subscribing", "unauthorized")).toMatchObject({ kind: "fail_closed" })
    expect(SubscriptionMachine.apply("fail_closed", "clear")).toMatchObject({ to: "unsubscribed" })
  })

  test("delivery is authorized only in the subscribed state", () => {
    expect(SubscriptionMachine.deliveryAuthorized("subscribed")).toBe(true)
    for (const state of ["unsubscribed", "subscribing", "unsubscribing", "fail_closed"] as const) {
      expect(SubscriptionMachine.deliveryAuthorized(state)).toBe(false)
    }
  })

  test("an out-of-order trigger is illegal, never thrown", () => {
    expect(SubscriptionMachine.apply("unsubscribed", "acknowledge").kind).toBe("illegal")
  })
})
