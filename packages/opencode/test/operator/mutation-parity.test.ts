/**
 * T037 mutation parity: CLI / TUI / HTTP / slash share version+idempotency.
 * Real mutation_plan on test stack — create / replay / conflict.
 */
import { describe, expect, test } from "bun:test"
import {
  createDispatcher,
  createHandlerMap,
  createProcessMutexLockPort,
  createSeededOperatorCommandRegistry,
  mutateAuthority,
  type HandlerResult,
} from "@/operator/application"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createSlashInterceptor,
  createTuiOperatorSlashPort,
  createCliRunner,
} from "@/operator/adapters"
import type { CommandRequest } from "@opencode-ai/core/operator"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import { createTestOperatorStack } from "@/operator/stack-test"
import { listOperatorPaletteEntries, isOperatorSecretMutationId } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../../tui/src/operator/execute"

function telemetryOnPlan(): HandlerResult {
  return {
    kind: "mutation_plan",
    // The REAL telemetry commit authority (telemetry/backend-live AUTHORITY = "global:telemetry").
    // Feature 021 FR-A: the degraded preflight fallback resolves this same authority from the
    // domain SSOT even with no resolver threaded, so the fixture must commit where preflight reads.
    authority: "global:telemetry",
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

/**
 * Feature 021 FR-C — the optimistic-concurrency (CAS) guard is PRESERVED verbatim. The
 * fix is correct preflight authority (FR-A), NEVER a weakening of the guard: no path
 * auto-resolves a missing token or defaults an absent version to the current version at
 * mutate time. These pins fail if a future change smuggles in lost-update-losing behavior.
 */
describe("Feature 021 FR-C — the CAS guard is unchanged (no auto-resolve, no token defaulting)", () => {
  function ports() {
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock: createProcessMutexLockPort() })
    return {
      config: store.config,
      idempotency: store.idempotency,
      rollback: store.rollback,
      events: createMemoryEventPort(),
      requireAudit: false,
      outbox: store.outbox,
    }
  }
  let seq = 0
  const req = (over: Partial<CommandRequest> = {}): CommandRequest =>
    ({
      id: "telemetry.on",
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_c" },
      scope: { kind: "project", ref: "proj_c" },
      source: "cli",
      payload: {},
      idempotencyKey: `idem_frc_${seq++}`,
      ...over,
    }) as CommandRequest

  test("a mutation with NO version on an EXISTING authority is rejected 'mutations require version' (never auto-resolved)", async () => {
    const mp = ports()
    const first = await mutateAuthority(mp, { request: req({ version: undefined }), authority: "global:telemetry", apply: () => ({ enabled: true }) })
    expect(first.ok).toBe(true)

    // Second write, authority now exists, version === undefined → the guard MUST reject.
    const second = await mutateAuthority(mp, { request: req({ version: undefined }), authority: "global:telemetry", apply: () => ({ enabled: false }) })
    expect(second.ok).toBe(false)
    expect(second.outcome).toBe("invalid_argument")
    expect(JSON.stringify(second)).toContain("mutations require version (CAS token) when authority already exists")
  })

  test("a mutation with a STALE version is rejected 'CAS version conflict' (lost-update protection intact)", async () => {
    const mp = ports()
    const first = await mutateAuthority(mp, { request: req({ version: undefined }), authority: "global:telemetry", apply: () => ({ enabled: true }) })
    expect(first.ok).toBe(true)

    const stale = await mutateAuthority(mp, { request: req({ version: "cas_stale" }), authority: "global:telemetry", apply: () => ({ enabled: false }) })
    expect(stale.ok).toBe(false)
    expect(stale.outcome).toBe("conflict")
    expect(JSON.stringify(stale)).toContain("CAS version conflict")

    // The rejected writes never applied: the committed value is unchanged (no silent overwrite).
    const current = await mp.config.get("global:telemetry")
    expect(current?.version).toBe(first.version!)
  })
})
