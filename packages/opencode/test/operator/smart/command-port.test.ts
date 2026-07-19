/**
 * Feature 013 / T014 — the `smart.*` inbound command adapter (DomainInvoke seam).
 *
 * Completes the T014 unit grid on top of `backend-live.test.ts` (which pins the
 * backend read/plan/unavailable posture): the command port projects the activation
 * summary on `status` (one bounded audit event), and returns the validated
 * `mutation_plan` on `on`/`off`/`auto` — the Feature 007 dispatcher owns the single
 * committed CAS write + audit, so the command port never self-commits and never
 * emits a phantom success audit. An unknown verb is `not_implemented`; a config
 * outage degrades a plan to `unavailable` (audited as a rejection). End-to-end CAS
 * commit is proved through the full dispatcher in `feature013-wire.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import { createLiveSmartBackend } from "@/operator/smart/backend-live"
import { SmartCommandPort } from "@/operator/smart/smart-command-port"
import type { SmartAuditEvent } from "@/operator/smart/smart-port"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

const CLOCK = () => 1_721_260_800_000

function dispatcher(config: ConfigPort = createMemoryConfigPort()) {
  const events: SmartAuditEvent[] = []
  const ports = SmartCommandPort.createSmartDomainPorts({
    backend: createLiveSmartBackend({ config, now: CLOCK }),
    audit: { record: (event) => Effect.sync(() => void events.push(event)) },
  })
  return { invoke: ports.smart.invoke, events, config }
}

const request = (id: string, payload: Record<string, unknown> = {}) =>
  ({
    request: {
      id,
      principal: { kind: "operator", subject: "operator:root", projectBinding: null },
      scope: { kind: "global", ref: null },
      source: "cli",
      payload,
    },
    descriptor: { id, domain: "smart" },
  }) as never

describe("T014 smart command port — status projects the activation summary", () => {
  test("smart.status dispatches to a query result and records one ok audit event", async () => {
    const d = dispatcher()
    const result = await d.invoke(request("smart.status"))
    expect(result.kind).toBe("query")
    if (result.kind === "query") {
      const effective = result.effective as { enabled: boolean; auto: boolean; configured: boolean }
      expect(effective.enabled).toBe(false)
      expect(effective.auto).toBe(false)
      expect(effective.configured).toBe(false)
    }
    expect(d.events).toEqual([{ commandId: "smart.status", principalId: "operator:root", target: "", outcome: "ok" }])
  })
})

describe("T014 smart command port — on/off/auto return a validated mutation_plan", () => {
  test("smart.on returns a routing-authority mutation_plan and emits no phantom success audit", async () => {
    const d = dispatcher()
    const result = await d.invoke(request("smart.on", { expectedVersion: INITIAL_CONFIG_VERSION }))
    expect(result.kind).toBe("mutation_plan")
    if (result.kind === "mutation_plan") {
      expect(result.authority).toBe("global:routing")
      expect((result.apply(null) as RoutingConfig.Info).activation.enabled).toBe(true)
    }
    // No self-commit → no persisted write and no success audit at this seam.
    expect(await d.config.get("global:routing")).toBeNull()
    expect(d.events).toEqual([])
  })

  test("smart.auto returns a plan whose apply sets mode=auto", async () => {
    const d = dispatcher()
    const result = await d.invoke(request("smart.auto", { expectedVersion: INITIAL_CONFIG_VERSION }))
    expect(result.kind).toBe("mutation_plan")
    if (result.kind === "mutation_plan") {
      expect((result.apply(null) as RoutingConfig.Info).activation.mode).toBe("auto")
    }
  })
})

describe("T014 smart command port — honest capability boundary", () => {
  test("an unknown smart verb is not_implemented", async () => {
    const d = dispatcher()
    const result = await d.invoke(request("smart.bogus"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })

  test("a config-store outage degrades a mutation plan to unavailable (audited as a rejection)", async () => {
    const broken: ConfigPort = { ...createMemoryConfigPort(), get: () => Promise.reject(new Error("config down")) }
    const d = dispatcher(broken)
    const result = await d.invoke(request("smart.on", { expectedVersion: INITIAL_CONFIG_VERSION }))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("unavailable")
    expect(d.events.at(-1)?.outcome).toBe("rejected")
  })
})
