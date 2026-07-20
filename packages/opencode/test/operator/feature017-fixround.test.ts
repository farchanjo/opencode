/**
 * Feature 017 fix-round (ADR-0017 superseding decision) — the adversarial-review defects.
 *
 * DEFECT 1 (phantom write): the store-scoped / live-service mutating verbs ran their
 * irreversible op at plan-BUILD time, BEFORE `mutateAuthority`'s contract/idempotency/CAS
 * checks. This suite proves the op is now DEFERRED into the plan `effect` that
 * `mutateAuthority` runs only AFTER every check passes:
 *   - a 2nd op on a shared authority WITHOUT the CAS token fails BEFORE the op runs
 *     (no phantom write), and succeeds once the correct version is threaded;
 *   - an idempotent replay does NOT re-run the destructive op (op-count spy).
 *
 * ROOT MECHANISM (preflight authority): the preflight resolved `commandId.split(".")[0]`,
 * which never equals the shared global authority a plan commits to — so the client threaded
 * the wrong `expectedVersion` and every 2nd mutation failed `mutations require version`. This
 * suite proves the authority registry resolves the SAME authority the plan uses, so two
 * consecutive telemetry.configure / output.retention.set / mcp.server.add succeed end-to-end.
 *
 * DEFECT 2 (writer unreachable): the production spool writer was subscribed only inside the
 * lazy operator stack. This suite proves the eager process bootstrap captures session output
 * with the operator NEVER opened.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createDispatcher,
  createHandlerMap,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type Dispatcher,
  type HandlerResult,
  type MutationPorts,
} from "@/operator/application"
import { createFakeConfigService, createMemoryEventPort, createMemoryOutboxPort } from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { handlersFromDomainPorts, domainHandlerFor, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import { createOperatorAuthorityResolver } from "@/operator/application/command-authority"
import { createOperatorHttpHandler } from "@/operator/http/handler"
import { ControlStore } from "@/outputspool/control-store"
import { OutputSpoolBackendLive } from "@/operator/outputspool/backend-live"
import { OutputSpoolStackWiring } from "@/operator/outputspool/stack-wiring"
import { McpBackendLive } from "@/operator/mcp/backend-live"
import { McpStackWiring } from "@/operator/mcp/stack-wiring"
import type { McpHostReader, McpLiveActions } from "@/operator/mcp/backend-live"
import { AUTHORITY as TELEMETRY_AUTHORITY } from "@/operator/telemetry/backend-live"
import { SpoolProcessWriter } from "@/outputspool/spool-process-writer"
import { GlobalBus } from "@/bus/global"
import type { CommandResult } from "@opencode-ai/core/operator"

// =============================================================================
// Shared harness
// =============================================================================
const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "spool-fix-"))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function freshStore(): ControlStore.ControlStore {
  return ControlStore.createControlStore(new Database(":memory:"))
}

function mutationPorts(): MutationPorts {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  return {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
}

let idemSeq = 0
function dispatch(
  dispatcher: Dispatcher,
  id: string,
  payload: Record<string, unknown>,
  opts?: { version?: string; key?: string; scope?: { kind: string; ref: string | null } },
): Promise<CommandResult> {
  return dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_17" },
      scope: opts?.scope ?? { kind: "project", ref: "proj_17" },
      source: "cli",
      payload,
      version: opts?.version,
      idempotencyKey: opts?.key ?? `idem_${id}_${idemSeq++}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )
}

// =============================================================================
// DEFECT 1 — effectful apply: op runs AFTER checks, never on the phantom/replay path
// =============================================================================
function outputAdminHarness(store: ControlStore.ControlStore, spoolRoot: string) {
  const backend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({
    store,
    spoolRoot,
    adminAuthority: OutputSpoolBackendLive.OUTPUT_ADMIN_AUTHORITY,
  })
  const mp = mutationPorts()
  const domainPorts = wireDomainPorts({ ...OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend }).ports })
  const dispatcher = createDispatcher({
    registry: createSeededOperatorCommandRegistry(),
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher, config: mp.config }
}

describe("DEFECT 1 — output admin op is deferred behind CAS (no phantom write)", () => {
  test("a 2nd output.delete without the CAS token does NOT run the destructive store op", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    for (const ref of ["prt_1", "prt_2"]) {
      store.openGeneration({ output_ref: ref, group_id: ref, generation: 3, channel: "assistant-text", durability_tier: "durable", correlation_id: "c", now: 1 })
      store.recordCommitted(ref, 9, 2)
    }
    // op-count spy over the real control-store delete.
    let deletes = 0
    const spied: ControlStore.ControlStore = {
      ...store,
      deleteGeneration: (ref: string) => {
        deletes++
        return store.deleteGeneration(ref)
      },
    }
    const { dispatcher } = outputAdminHarness(spied, spoolRoot)

    const first = await dispatch(dispatcher, "output.delete", { outputRef: "prt_1" })
    expect(first.ok).toBe(true)
    expect(deletes).toBe(1)
    expect(store.get("prt_1")).toBeNull()

    // 2nd op on the SAME shared authority without a CAS token — the deterministic failure must
    // fire BEFORE the destructive op, so prt_2 survives and delete was NOT called again.
    const second = await dispatch(dispatcher, "output.delete", { outputRef: "prt_2" })
    expect(second.ok).toBe(false)
    expect(second.outcome).toBe("invalid_argument")
    expect(deletes).toBe(1)
    expect(store.get("prt_2")).not.toBeNull()

    // Thread the right version → the op now runs and prt_2 is gone.
    const third = await dispatch(dispatcher, "output.delete", { outputRef: "prt_2" }, { version: first.version })
    expect(third.ok).toBe(true)
    expect(deletes).toBe(2)
    expect(store.get("prt_2")).toBeNull()
  })
})

function fakeReader(): McpHostReader {
  return {
    authStatus: async () => "not_authenticated",
    listResources: async () => [],
    listResourceTemplates: async () => [],
  }
}

function mcpHarness(actions: McpLiveActions) {
  const mp = mutationPorts()
  const backend = McpBackendLive.createLiveMcpBackend({
    override: McpBackendLive.createMcpServiceOverride(fakeReader(), {
      mutations: { config: mp.config, actions },
    }),
  })
  const domainPorts = wireDomainPorts({ ...McpStackWiring.createMcpDomainWiring({ backend }).ports })
  const dispatcher = createDispatcher({
    registry: createSeededOperatorCommandRegistry(),
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher, config: mp.config }
}

describe("DEFECT 1 — mcp live connect is deferred behind CAS + idempotency", () => {
  test("an idempotent replay does NOT re-run the live connect (op-count spy)", async () => {
    let connects = 0
    const actions: McpLiveActions = {
      connect: async () => {
        connects++
        return { kind: "ok", status: "connected" }
      },
      disconnect: async () => ({ kind: "ok", status: "disabled" }),
      reconnect: async () => ({ kind: "ok", status: "connected" }),
    }
    const { dispatcher } = mcpHarness(actions)

    const first = await dispatch(dispatcher, "mcp.server.connect", { id: "srv_1" }, { key: "idem_conn" })
    expect(first.ok).toBe(true)
    expect(connects).toBe(1)

    // Same idempotency key → replay returns the stored result and the live op is NOT re-run.
    const replay = await dispatch(dispatcher, "mcp.server.connect", { id: "srv_1" }, { key: "idem_conn", version: first.version })
    expect(replay.ok).toBe(true)
    expect(replay.outcome).toBe("idempotent_replay")
    expect(connects).toBe(1)
  })

  test("a 2nd connect on the shared connections authority without the CAS token does NOT run the op", async () => {
    let connects = 0
    const actions: McpLiveActions = {
      connect: async () => {
        connects++
        return { kind: "ok", status: "connected" }
      },
      disconnect: async () => ({ kind: "ok", status: "disabled" }),
      reconnect: async () => ({ kind: "ok", status: "connected" }),
    }
    const { dispatcher } = mcpHarness(actions)

    const first = await dispatch(dispatcher, "mcp.server.connect", { id: "srv_a" })
    expect(first.ok).toBe(true)
    expect(connects).toBe(1)

    const second = await dispatch(dispatcher, "mcp.server.connect", { id: "srv_b" })
    expect(second.ok).toBe(false)
    expect(second.outcome).toBe("invalid_argument")
    // The live connect for srv_b never ran — the CAS-token failure fired first.
    expect(connects).toBe(1)

    const third = await dispatch(dispatcher, "mcp.server.connect", { id: "srv_b" }, { version: first.version })
    expect(third.ok).toBe(true)
    expect(connects).toBe(2)
  })
})

// =============================================================================
// ROOT MECHANISM — preflight authority resolution
// =============================================================================
const retentionAuthorityFor = (scope: "global" | "project", scopeId: string) =>
  scope === "global" ? "global:output.retention" : `output.retention/${scopeId || "project"}`
const quotaAuthorityFor = (scope: "global" | "project", scopeId: string) =>
  scope === "global" ? "global:output.quota" : `output.quota/${scopeId || "project"}`

const resolver = createOperatorAuthorityResolver({ retentionAuthorityFor, quotaAuthorityFor })

describe("ROOT MECHANISM — the authority registry resolves the plan authority, not the id prefix", () => {
  test("shared globals + scope-dependent authorities resolve correctly", () => {
    expect(resolver("telemetry.configure", { scopeKind: "global", scopeRef: null })).toBe("global:telemetry")
    expect(resolver("mcp.server.add", { scopeKind: "project", scopeRef: "p" })).toBe("global:mcp")
    expect(resolver("mcp.server.connect", { scopeKind: "project", scopeRef: "p" })).toBe("global:mcp-connections")
    expect(resolver("mcp.auth.remove", { scopeKind: "project", scopeRef: "p" })).toBe("global:mcp-auth")
    expect(resolver("output.delete", { scopeKind: "project", scopeRef: "p" })).toBe("global:output-admin")
    expect(resolver("output.retention.set", { scopeKind: "project", scopeRef: "proj_17" })).toBe("output.retention/proj_17")
    expect(resolver("output.retention.set", { scopeKind: "global", scopeRef: null })).toBe("global:output.retention")
    // An unknown / non-mutating id resolves to null so the caller falls back to the prefix.
    expect(resolver("unknown.command", { scopeKind: "project", scopeRef: "p" })).toBeNull()
  })
})

function httpHandler(dispatcher: unknown, config: MutationPorts["config"], resolveAuthority?: typeof resolver) {
  return createOperatorHttpHandler({
    dispatcher: dispatcher as never,
    registry: createSeededOperatorCommandRegistry(),
    serverBind: "127.0.0.1",
    getClientIp: () => "127.0.0.1",
    getProjectId: () => "proj_17",
    injectProjectScopeWhenOmitted: true,
    config,
    resolveAuthority,
    resolveAuth: async () => ({ authenticated: true, subject: "op_1", role: "operator", projectBinding: "proj_17" }),
  })
}

async function preflight(handler: (r: Request) => Promise<Response>, commandId: string, scope?: { kind: string; ref: string | null }) {
  const res = await handler(
    new Request("http://127.0.0.1/operator/v1/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scope ? { commandId, scope } : { commandId }),
    }),
  )
  return (await res.json()) as { ok: boolean; configured: boolean; currentVersion: string | null; authority: string }
}

describe("ROOT MECHANISM — end-to-end second mutation threads the resolved CAS token", () => {
  test("telemetry.configure (pre-existing 014 verb): preflight without the resolver mis-resolves; with it, the 2nd mutation succeeds", async () => {
    const mp = mutationPorts()
    const telemetryPlan = (): HandlerResult => ({
      kind: "mutation_plan",
      authority: TELEMETRY_AUTHORITY,
      apply: (c) => ({ ...(typeof c === "object" && c ? c : {}), enabled: true }),
    })
    const dispatcher = createDispatcher({
      registry: createSeededOperatorCommandRegistry(),
      mutationPorts: mp,
      handlers: createHandlerMap([["telemetry.configure", telemetryPlan]]),
      featureEnabled: () => true,
    })

    const first = await dispatch(dispatcher, "telemetry.configure", {})
    expect(first.ok).toBe(true)

    // Bug reproduction: the prefix fallback reads authority "telemetry" (never written) → null.
    const buggy = await preflight(httpHandler(dispatcher, mp.config), "telemetry.configure")
    expect(buggy.authority).toBe("telemetry")
    expect(buggy.currentVersion).toBeNull()

    // Fix: the resolver reads the REAL "global:telemetry" authority → the committed version.
    const fixed = await preflight(httpHandler(dispatcher, mp.config, resolver), "telemetry.configure")
    expect(fixed.authority).toBe("global:telemetry")
    expect(fixed.currentVersion).toBe(first.version!)

    const second = await dispatch(dispatcher, "telemetry.configure", {}, { version: fixed.currentVersion! })
    expect(second.ok).toBe(true)
    expect(second.outcome).toBe("success")
  })

  test("output.retention.set: two consecutive sets succeed with the scope-dependent authority threaded", async () => {
    const backend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({ retentionAuthorityFor })
    const mp = mutationPorts()
    const domainPorts = wireDomainPorts({ ...OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend }).ports })
    const dispatcher = createDispatcher({
      registry: createSeededOperatorCommandRegistry(),
      mutationPorts: mp,
      handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
      defaultHandler: domainHandlerFor(domainPorts),
      featureEnabled: () => true,
    })

    const first = await dispatch(dispatcher, "output.retention.set", { ttlSeconds: 60 })
    expect(first.ok).toBe(true)

    const pre = await preflight(httpHandler(dispatcher, mp.config, resolver), "output.retention.set", { kind: "project", ref: "proj_17" })
    expect(pre.authority).toBe("output.retention/proj_17")
    expect(pre.currentVersion).toBe(first.version!)

    const second = await dispatch(dispatcher, "output.retention.set", { ttlSeconds: 120 }, { version: pre.currentVersion! })
    expect(second.ok).toBe(true)
    expect(second.outcome).toBe("success")
  })

  test("mcp.server.add: two consecutive adds succeed with the global:mcp authority threaded", async () => {
    const actions: McpLiveActions = {
      connect: async () => ({ kind: "ok", status: "connected" }),
      disconnect: async () => ({ kind: "ok", status: "disabled" }),
      reconnect: async () => ({ kind: "ok", status: "connected" }),
    }
    const { dispatcher, config } = mcpHarness(actions)

    const first = await dispatch(dispatcher, "mcp.server.add", { name: "s1", endpoint: "http://e1", transportKind: "streamable-http" })
    expect(first.ok).toBe(true)

    const pre = await preflight(httpHandler(dispatcher, config, resolver), "mcp.server.add", { kind: "project", ref: "proj_17" })
    expect(pre.authority).toBe("global:mcp")
    expect(pre.currentVersion).toBe(first.version!)

    const second = await dispatch(dispatcher, "mcp.server.add", { name: "s2", endpoint: "http://e2", transportKind: "streamable-http" }, { version: pre.currentVersion! })
    expect(second.ok).toBe(true)
    expect(second.outcome).toBe("success")
  })
})

// =============================================================================
// DEFECT 2 — eager process writer captures output with the operator never opened
// =============================================================================
describe("DEFECT 2 — the eager process spool writer captures output independent of the operator", () => {
  beforeEach(() => SpoolProcessWriter.__resetProcessSpoolWriterForTests())
  afterEach(() => SpoolProcessWriter.__resetProcessSpoolWriterForTests())

  test("a session part event is spooled with NO operator stack ever created", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    // Arm the process-wide writer via the bootstrap seam (no operator stack in sight). Reset in
    // beforeEach guarantees a clean singleton regardless of what an earlier suite armed.
    const armed = SpoolProcessWriter.ensureProcessSpoolWriter({ store, spoolRoot })
    expect(armed?.store).toBe(store)
    // Idempotent: a second call reuses the SAME store (no duplicate connection/subscription).
    expect(SpoolProcessWriter.ensureProcessSpoolWriter()?.store).toBe(store)

    GlobalBus.emit("event", {
      payload: { type: "message.part.updated", properties: { part: { id: "prt_eager", type: "text", text: "hello" } } },
    })
    // The writer ingest is fire-and-forget; let the microtask/settle run.
    await new Promise((r) => setTimeout(r, 30))

    const record = store.get("prt_eager")
    expect(record).not.toBeNull()
    expect(record!.committed_bytes).toBe(5)
    expect(record!.channel).toBe("assistant-text")
  })
})
