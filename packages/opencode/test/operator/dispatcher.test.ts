import { describe, expect, test } from "bun:test"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  fixtureStatusHandler,
  notImplementedHandler,
} from "@/operator/application"
import type { CommandRequest } from "@opencode-ai/core/operator"

function baseRequest(overrides: Partial<CommandRequest> & Pick<CommandRequest, "id">): CommandRequest {
  return {
    principal: { kind: "operator", subject: "local", projectBinding: null },
    scope: { kind: "project", ref: "proj_1" },
    source: "cli",
    confirm: false,
    isTty: false,
    payload: {},
    ...overrides,
  }
}

describe("dispatcher pipeline (T010)", () => {
  test("unknown id → invalid_argument", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({ registry })
    const result = await dispatcher.dispatch(
      baseRequest({ id: "no.such.command" as CommandRequest["id"] }),
    )
    // parse may fail or lookup fails
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("invalid_argument")
    expect(result.kind).toBe("operator.admin_result")
  })

  test("invalid envelope → invalid_argument", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({ registry })
    const result = await dispatcher.dispatch({ id: "langlock.status" })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("invalid_argument")
  })

  test("manager-view mutation → unauthorized", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.set", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "langlock.set" as CommandRequest["id"],
        principal: { kind: "manager-view", subject: "viewer", projectBinding: null },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("unauthorized")
    expect(result.error?.code).toBe("unauthorized")
  })

  test("manager-view query allowed", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "langlock.status" as CommandRequest["id"],
        principal: { kind: "manager-view", subject: "viewer", projectBinding: null },
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
  })

  test("wrong scope → forbidden_scope", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "langlock.status" as CommandRequest["id"],
        scope: { kind: "session", ref: "ses_1" },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("forbidden_scope")
  })

  test("cross-project principal binding → forbidden_scope", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "langlock.status" as CommandRequest["id"],
        principal: { kind: "operator", subject: "local", projectBinding: "proj_a" },
        scope: { kind: "project", ref: "proj_b" },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("forbidden_scope")
  })

  test("query vs mutation: default stub returns not_implemented", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({ registry, defaultHandler: notImplementedHandler })
    const result = await dispatcher.dispatchRequest(
      baseRequest({ id: "langlock.status" as CommandRequest["id"] }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("not_implemented")
  })

  test("successful query via port handler", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["routing.test", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({ id: "routing.test" as CommandRequest["id"] }),
    )
    expect(result.ok).toBe(true)
    expect(result.kind).toBe("operator.admin_result")
    expect(result.effective).toMatchObject({ status: "ok" })
  })

  test("no global singleton: separate dispatchers isolated", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const d1 = createDispatcher({
      registry,
      handlers: createHandlerMap([["telemetry.status", fixtureStatusHandler]]),
    })
    const d2 = createDispatcher({
      registry,
      defaultHandler: notImplementedHandler,
    })
    const r1 = await d1.dispatchRequest(baseRequest({ id: "telemetry.status" as CommandRequest["id"] }))
    const r2 = await d2.dispatchRequest(baseRequest({ id: "telemetry.status" as CommandRequest["id"] }))
    expect(r1.ok).toBe(true)
    expect(r2.outcome).toBe("not_implemented")
  })
})

describe("confirmation gate (T011)", () => {
  test("missing confirm → confirmation_required", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["semantic.embedding.cutover", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        confirm: false,
        source: "api",
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("confirmation_required")
  })

  test("slash never auto-yes even with confirm=true", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["semantic.embedding.cutover", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        confirm: true,
        source: "slash",
        isTty: true,
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("confirmation_required")
    expect(result.error?.details?.reason).toBe("slash_never_auto_yes")
  })

  test("CLI TTY + confirm rejected; non-TTY + confirm allowed", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["output.purge", fixtureStatusHandler]]),
    })
    const tty = await dispatcher.dispatchRequest(
      baseRequest({
        id: "output.purge" as CommandRequest["id"],
        confirm: true,
        source: "cli",
        isTty: true,
      }),
    )
    expect(tty.ok).toBe(false)
    expect(tty.outcome).toBe("confirmation_required")

    const nonTty = await dispatcher.dispatchRequest(
      baseRequest({
        id: "output.purge" as CommandRequest["id"],
        confirm: true,
        source: "cli",
        isTty: false,
        idempotencyKey: "purge-1",
      }),
    )
    // Without mutationPorts, handler may succeed after confirm
    expect(nonTty.outcome === "success" || nonTty.outcome === "not_implemented").toBe(true)
    expect(nonTty.outcome).not.toBe("confirmation_required")
  })

  test("API confirm=true allows destructive op", async () => {
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["mcp.experimental.enable", fixtureStatusHandler]]),
    })
    const result = await dispatcher.dispatchRequest(
      baseRequest({
        id: "mcp.experimental.enable" as CommandRequest["id"],
        confirm: true,
        source: "api",
        idempotencyKey: "exp-1",
      }),
    )
    expect(result.outcome).not.toBe("confirmation_required")
    expect(result.outcome === "success" || result.outcome === "not_implemented").toBe(true)
  })

  test("confirmation metadata includes source/TTY/operator", async () => {
    const { confirmationMetadata } = await import("@/operator/application")
    const meta = confirmationMetadata(
      baseRequest({
        id: "langlock.status" as CommandRequest["id"],
        source: "cli",
        isTty: false,
        confirm: true,
      }),
    )
    expect(meta).toEqual({
      source: "cli",
      isTty: false,
      confirm: true,
      principalKind: "operator",
      subject: "local",
    })
  })
})
