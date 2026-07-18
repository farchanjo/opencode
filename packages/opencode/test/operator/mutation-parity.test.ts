/**
 * T037 mutation parity: CLI / TUI / HTTP / slash share version+idempotency.
 * Real mutation_plan on test stack — create / replay / conflict.
 */
import { describe, expect, test } from "bun:test"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  type HandlerResult,
} from "@/operator/application"
import {
  createSlashInterceptor,
  createTuiOperatorSlashPort,
  createCliRunner,
} from "@/operator/adapters"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import { createTestOperatorStack } from "@/operator/stack-test"
import { listOperatorPaletteEntries, isOperatorSecretMutationId } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../../tui/src/operator/execute"

function telemetryOnPlan(): HandlerResult {
  return {
    kind: "mutation_plan",
    authority: "telemetry",
    apply: (current) => ({
      ...(typeof current === "object" && current ? current : {}),
      enabled: true,
    }),
    snapshotBefore: true,
  }
}

describe("T037 mutation parity", () => {
  test("create + idempotent replay + conflict with same key/version contract", async () => {
    const base = createTestOperatorStack()
    const registry = createSeededOperatorCommandRegistry()
    const ports = base.mutationPorts
    const dispatcher = createDispatcher({
      registry,
      mutationPorts: ports,
      handlers: createHandlerMap([["telemetry.on", telemetryOnPlan]]),
    })
    const interceptor = createSlashInterceptor({ registry, dispatcher })
    const tuiPort = createTuiOperatorSlashPort(interceptor, { config: ports.config })

    const pre = await tuiPort.preflightMutation({
      commandId: "telemetry.on",
      projectId: "proj_m",
    })
    expect(pre.ok).toBe(true)
    if (!pre.ok) return
    expect(pre.configured).toBe(false)
    expect(pre.currentVersion).toBeNull()

    const key1 = "idem_parity_create_1"
    async function confirmAndRun(opts: {
      version?: string
      idempotencyKey: string
    }) {
      const first = await interceptor.tryHandle({
        text: "/op.telemetry.on",
        principalContext: { projectId: "proj_m", subject: "local" },
        version: opts.version,
        idempotencyKey: opts.idempotencyKey,
      })
      expect(first.handled).toBe(true)
      if (!first.handled) throw new Error("not handled")
      if (first.needsConfirmation) {
        return interceptor.tryHandle({
          text: "/op.telemetry.on",
          principalContext: { projectId: "proj_m", subject: "local" },
          version: opts.version,
          idempotencyKey: opts.idempotencyKey,
          confirmToken: first.needsConfirmation.token,
        })
      }
      return first
    }

    const createResult = await confirmAndRun({ idempotencyKey: key1 })
    expect(createResult.handled).toBe(true)
    if (!createResult.handled) return
    expect(createResult.result.ok).toBe(true)
    expect(["success", "idempotent_replay"].includes(createResult.result.outcome)).toBe(true)
    const versionAfter = createResult.result.version
    expect(typeof versionAfter).toBe("string")

    // Replay same key
    const replay = await confirmAndRun({
      version: versionAfter,
      idempotencyKey: key1,
    })
    expect(replay.handled).toBe(true)
    if (!replay.handled) return
    expect(["idempotent_replay", "success"].includes(replay.result.outcome)).toBe(true)

    // Conflict wrong version
    const conflict = await confirmAndRun({
      version: "wrong_version_token",
      idempotencyKey: "idem_parity_conflict",
    })
    expect(conflict.handled).toBe(true)
    if (!conflict.handled) return
    expect(conflict.result.outcome).toBe("conflict")
    expect(conflict.display.injectTranscript).toBe(false)

    // HTTP preflight
    const handle = createOperatorHttpHandler({
      dispatcher,
      registry,
      serverBind: "127.0.0.1",
      getClientIp: () => "127.0.0.1",
      getProjectId: () => "proj_m",
      injectProjectScopeWhenOmitted: true,
      config: ports.config,
      resolveAuth: async () => ({
        authenticated: true,
        subject: "local",
        role: "operator",
        projectBinding: "proj_m",
      }),
    })
    const preHttp = await handle(
      new Request("http://127.0.0.1/operator/v1/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "telemetry.on" }),
      }),
    )
    expect(preHttp.status).toBe(200)
    const preJson = (await preHttp.json()) as {
      ok: boolean
      configured: boolean
      currentVersion: string | null
    }
    expect(preJson.ok).toBe(true)
    expect(preJson.configured).toBe(true)
    expect(preJson.currentVersion === versionAfter).toBe(true)

    // CLI
    const cli = createCliRunner({ registry, dispatcher })
    const cliOut = await cli.run({
      segments: ["telemetry", "on"],
      flags: {
        json: true,
        yes: true,
        expectedVersion: versionAfter,
        idempotencyKey: "idem_cli_1",
      },
      isTty: false,
      ctx: { authenticated: true, projectId: "proj_m", subject: "cli" },
    })
    expect(cliOut.result.id).toBe("telemetry.on")
    expect(["success", "idempotent_replay", "conflict"].includes(cliOut.result.outcome)).toBe(true)

    // Secret predicate
    expect(isOperatorSecretMutationId("mcp.auth.start")).toBe(true)
    expect(isOperatorSecretMutationId("mcp.auth.status")).toBe(false)
    expect(isOperatorSecretMutationId("semantic.provider.rotate-secret")).toBe(true)
  })

  test("executeOperatorCommand refuses mutation without preflightMutation", async () => {
    const entry = listOperatorPaletteEntries().find((e) => e.id === "telemetry.on")
    expect(entry).toBeDefined()
    if (!entry) return
    const port = {
      tryHandle: async () =>
        ({
          handled: true as const,
          display: {
            title: "x",
            message: "x",
            variant: "info" as const,
            outcome: "success",
            auditPending: false,
            injectTranscript: false as const,
          },
        }),
      cancelConfirmation: () => {},
    }
    const toasts: string[] = []
    const result = await executeOperatorCommand({
      entry,
      port,
      projectId: "p1",
      dialog: { clear: () => {}, replace: () => {} } as never,
      toast: { show: (o: { message: string }) => toasts.push(o.message) },
    })
    expect(result.outcome).toBe("unavailable")
    expect(toasts.some((t) => t.toLowerCase().includes("preflight"))).toBe(true)
  })
})
