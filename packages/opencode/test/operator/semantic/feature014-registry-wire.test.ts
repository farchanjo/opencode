/**
 * Feature 014 / T009 (FR8) + T011 (FR9) — the config-backed half of the semantic
 * registry, and the executor-gated `jobs.run-now` capability gap, wired into the
 * Feature 007 runtime exactly as `stack-live.ts` composes them (the domain override
 * spread into `wireDomainPorts` over ONE shared `store.config` seam) behind the real
 * dispatcher + slash interceptor. Proves:
 *
 *   - `semantic.provider.add` dispatched through the FULL pipeline (dispatchRequest →
 *     confirm → contract → plan → `mutateAuthority`) commits under CAS, and a
 *     `provider.list` re-read reflects the persisted profile — the registry
 *     round-trips through the SAME seam the reads use (FR8);
 *   - `provider.update` bumps the profile version under CAS and re-reads;
 *   - a rejected mutation (unknown id, stale version, plaintext secret) persists
 *     NOTHING — no phantom write, the caller is honestly told it failed (FR14, FR11);
 *   - `model.register` → `embedding.select` stages a draft binding that re-reads;
 *   - the Milvus-gated `semantic.index.*` ops stay the typed `milvus_unavailable`
 *     capability gap — never fabricated (FR8, FR14);
 *   - `jobs.run-now` rides the `mutation_plan` path and honestly degrades to the typed
 *     `unavailable` executor gap (the Feature 002 executor seam is not reachable from
 *     the operator runtime; the lifecycle process/task cancel edge is the sibling gap
 *     at `lifecycle/stack-wiring.ts` and is covered by `test/lifecycle/cancel.test.ts`).
 */
import { describe, expect, test } from "bun:test"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import {
  createFakeConfigService,
  createMemoryEventPort,
  createMemoryOutboxPort,
  createSlashConfirmStore,
  createSlashInterceptor,
} from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { handlersFromDomainPorts, domainHandlerFor, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import { SemanticStackWiring } from "@/operator/semantic/stack-wiring"
import { SemanticBackendLive } from "@/operator/semantic/backend-live"
import { JobsStackWiring } from "@/operator/jobs/stack-wiring"
import { createLiveJobsBackend } from "@/operator/jobs/backend-live"
import { createOperatorJobPersistence } from "@/operator/jobs/persistence"

const SEMANTIC_AUTHORITY = "semantic"

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

/** Compose the Feature 014 semantic + jobs overrides exactly as `stack-live.ts` does. */
function wireFeature014(mp: MutationPorts): DomainPorts {
  const config = mp.config
  const semantic = SemanticBackendLive.createLiveSemanticBackend({ config })
  const jobs = createLiveJobsBackend({ persistence: createOperatorJobPersistence({ config }) })
  return wireDomainPorts({
    ...SemanticStackWiring.createSemanticDomainWiring({ backend: semantic }).ports,
    ...JobsStackWiring.createJobsDomainWiring({ backend: jobs }).ports,
  })
}

function harness() {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const domainPorts = wireFeature014(mp)
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  const interceptor = createSlashInterceptor({ registry, dispatcher, confirmStore: createSlashConfirmStore() })
  return { interceptor, dispatcher, config: mp.config }
}

const read = async (interceptor: ReturnType<typeof harness>["interceptor"], id: string) => {
  const r = await interceptor.tryHandle({ text: `/op.${id}`, principalContext: { projectId: "proj_14", subject: "op_1" } })
  if (!r.handled) throw new Error(`unhandled ${id}`)
  return r.result
}

/** Dispatch a mutating verb through the FULL Feature 007 pipeline (project scope). */
const mutate = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  opts: { version?: string } = {},
) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_14" },
      scope: { kind: "project", ref: "proj_14" },
      source: "cli",
      payload,
      version: opts.version,
      idempotencyKey: `idem_${id}_${opts.version ?? "create"}_${Math.random().toString(36).slice(2)}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

const listProfiles = async (interceptor: ReturnType<typeof harness>["interceptor"]) =>
  ((await read(interceptor, "semantic.provider.list")).effective as { profiles: ReadonlyArray<{ id: string; version: number; identity: { name: string } }> }).profiles

describe("T009 — semantic registry round-trips through the config seam under CAS (FR8)", () => {
  test("provider.add commits and provider.list re-reads the persisted profile", async () => {
    const { interceptor, dispatcher } = harness()
    expect(await listProfiles(interceptor)).toHaveLength(0)

    const add = await mutate(dispatcher, "semantic.provider.add", {
      name: "openai-compatible",
      baseUrl: "https://vectors.example.com",
      secretRef: "keychain:openai-key@v1",
    })
    expect(add.ok).toBe(true)
    expect(add.outcome).toBe("success")

    const profiles = await listProfiles(interceptor)
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.identity.name).toBe("openai-compatible")
    expect(profiles[0]!.version).toBe(1)
  })

  test("provider.update bumps the profile version under the domain version gate and re-reads", async () => {
    const { interceptor, dispatcher } = harness()
    const add = await mutate(dispatcher, "semantic.provider.add", { name: "p1", baseUrl: "https://a.example.com" })
    const id = (await listProfiles(interceptor))[0]!.id

    // The shared `semantic` authority already exists, so the update chains the committed CAS token.
    const update = await mutate(dispatcher, "semantic.provider.update", { id, expectedVersion: 1, patch: { name: "p1-renamed" } }, { version: add.version })
    expect(update.ok).toBe(true)

    const after = (await listProfiles(interceptor))[0]!
    expect(after.identity.name).toBe("p1-renamed")
    expect(after.version).toBe(2)
  })

  test("a stale provider version is rejected with no phantom write", async () => {
    const { interceptor, dispatcher } = harness()
    const add = await mutate(dispatcher, "semantic.provider.add", { name: "p1", baseUrl: "https://a.example.com" })
    const id = (await listProfiles(interceptor))[0]!.id
    const v2 = await mutate(dispatcher, "semantic.provider.update", { id, expectedVersion: 1, patch: { name: "v2" } }, { version: add.version })

    // CAS token is fresh, but the domain provider version is stale (expected 1, actual 2).
    const stale = await mutate(dispatcher, "semantic.provider.update", { id, expectedVersion: 1, patch: { name: "v3" } }, { version: v2.version })
    expect(stale.ok).toBe(false)
    expect((await listProfiles(interceptor))[0]!.identity.name).toBe("v2")
  })
})

describe("T009 — SecretRef-only, never a plaintext secret persisted (FR11)", () => {
  test("a provider add carrying a plaintext-looking credential is rejected before any write", async () => {
    const { interceptor, dispatcher, config } = harness()
    const rejected = await mutate(dispatcher, "semantic.provider.add", {
      name: "leaky",
      baseUrl: "https://a.example.com",
      secretRef: "super-secret-plaintext-value",
    })
    expect(rejected.ok).toBe(false)
    expect(await config.get(SEMANTIC_AUTHORITY)).toBeNull()
    expect(await listProfiles(interceptor)).toHaveLength(0)
  })

  test("a committed provider persists only the SecretRef coordinate, never a plaintext value", async () => {
    const { dispatcher, config } = harness()
    await mutate(dispatcher, "semantic.provider.add", { name: "p1", baseUrl: "https://a.example.com", secretRef: "keychain:k@v2" })
    const entry = await config.get(SEMANTIC_AUTHORITY)
    const payload = JSON.stringify(entry?.payload ?? {})
    expect(payload).toContain("keychain:k@v2")
    expect(payload).not.toContain("plaintext")
  })
})

describe("T009 — an unsafe endpoint is rejected at plan time (FR8, C17)", () => {
  test("an http endpoint without a local-insecure profile is rejected with no write", async () => {
    const { dispatcher, config } = harness()
    const rejected = await mutate(dispatcher, "semantic.provider.add", { name: "insecure", baseUrl: "http://a.example.com" })
    expect(rejected.ok).toBe(false)
    expect(await config.get(SEMANTIC_AUTHORITY)).toBeNull()
  })
})

describe("T009 — model.register + embedding.select stage a draft binding (FR32)", () => {
  test("embedding.select on an unregistered model is rejected; after register it stages and re-reads", async () => {
    const { interceptor, dispatcher } = harness()
    const denied = await mutate(dispatcher, "semantic.embedding.select", { modelDescriptorId: "ghost" })
    expect(denied.ok).toBe(false)

    const add = await mutate(dispatcher, "semantic.provider.add", { name: "p1", baseUrl: "https://a.example.com" })
    const providerId = (await listProfiles(interceptor))[0]!.id
    const reg = await mutate(dispatcher, "semantic.model.register", { providerProfileId: providerId, modelRef: "text-embed", displayName: "Embed", endpointMode: "embeddings" }, { version: add.version })
    const models = ((await read(interceptor, "semantic.model.list")).effective as { descriptors: ReadonlyArray<{ id: string }> }).descriptors
    expect(models).toHaveLength(1)

    const select = await mutate(dispatcher, "semantic.embedding.select", { modelDescriptorId: models[0]!.id }, { version: reg.version })
    expect(select.ok).toBe(true)
    // `binding.history` is served by the registry (embedding.show/binding.status are the
    // Feature 007 config-status honesty ids); it re-reads the persisted draft binding.
    const history = (await read(interceptor, "semantic.binding.history")).effective as { versions: ReadonlyArray<{ modelDescriptorId: string; state: string }> }
    expect(history.versions).toHaveLength(1)
    expect(history.versions[0]!.modelDescriptorId).toBe(models[0]!.id)
    expect(history.versions[0]!.state).toBe("draft")
  })
})

describe("T009 — the Milvus-gated index ops stay a typed capability gap (FR8, FR14)", () => {
  // `index.status` is a Feature 007 config-status id; the genuinely Milvus-gated ops
  // (show-collections/test/reindex/reconcile) ride the domain port and stay the typed gap.
  test("semantic.index.show-collections returns the typed milvus_unavailable gap, never fabricated data", async () => {
    const { interceptor } = harness()
    const result = await read(interceptor, "semantic.index.show-collections")
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
    expect(result.error?.message).toContain("milvus_unavailable")
  })
})

describe("T011 — jobs.run-now stays a typed executor capability gap (FR9, FR14)", () => {
  test("jobs.run-now rides the mutation_plan path and degrades to a typed unavailable gap", async () => {
    const { dispatcher } = harness()
    const result = await mutate(dispatcher, "jobs.run-now", { jobDefinitionId: "job_x" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})
