/**
 * Feature 019 / T013 — the REAL production seams the eager telemetry export
 * pipeline wires onto, resolved lazily by `TelemetryExport.ensureTelemetryExport()`
 * at server start and by `rearmTelemetryExport()` on a `telemetry.*` commit.
 *
 * Kept in its own module (required lazily, never statically imported) so importing
 * `telemetry-export.ts` never dereferences the Bun global or the AppRuntime — the
 * pipeline core stays importable under a non-Bun test runner that injects fakes.
 * It builds the SAME live `ConfigPort` + `SecretPort` seams the operator stack binds
 * (`createLiveConfigServiceLike` → `createDurableOperatorStore` → `store.config`), so
 * the effective telemetry config resolved here is identical to what `telemetry.status`
 * reports — no parallel store, no divergent source of truth.
 */
export * as TelemetryExportLive from "./telemetry-export-live"

import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { Config } from "@/config/config"
import { InstanceRuntime } from "@/project/instance-runtime"
import { createLiveConfigServiceLike } from "@/operator/adapters/outbound/config-live"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { createFlockLockPort } from "@/operator/application/ports/lock-port"
import {
  createKeychainSecretPort,
  createEnvRefSecretPort,
  createCompositeSecretPort,
} from "@/operator/adapters/outbound/secret-memory"
import { createDarwinNativeKeychainBackend } from "@/operator/adapters/outbound/keychain-darwin"
import { Global } from "@opencode-ai/core/global"
import { Otlp } from "@opencode-ai/core/observability/otlp"
import path from "path"
import { mkdir } from "fs/promises"
import type { TelemetryExportDeps } from "./telemetry-export"

/**
 * Build the live pipeline deps over the real durable store. Async because the
 * InstanceRuntime + lock dir must be resolved; the caller (`ensureTelemetryExport`)
 * runs it inside a fail-open `buildPipeline`, so a throw here degrades the pipeline to
 * disarmed rather than crashing server start.
 */
export async function createLiveTelemetryExportDeps(): Promise<TelemetryExportDeps> {
  const instance = await InstanceRuntime.load({ directory: process.cwd() })
  const config = createLiveConfigServiceLike({
    useConfig: (fn) =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* Config.Service
          return yield* fn({
            get: () => svc.get() as Effect.Effect<Record<string, unknown>>,
            getGlobal: () => svc.getGlobal() as Effect.Effect<Record<string, unknown>>,
            update: (patch, options) => svc.update(patch as never, options),
            updateGlobal: (patch) => svc.updateGlobal(patch as never),
          })
        }).pipe(Effect.provideService(InstanceRef, instance)),
      ),
  })
  const lockDir = path.join(Global.Path.state, "operator-locks")
  await mkdir(lockDir, { recursive: true })
  const lock = await createFlockLockPort({ dir: lockDir })
  const store = createDurableOperatorStore({ config, lock, projectKey: "project" })
  const secret = createCompositeSecretPort({
    keychain: createKeychainSecretPort({
      backend: createDarwinNativeKeychainBackend({ sandbox: false }),
      sandbox: false,
      config: store.config,
      projectKey: "project",
    }),
    envRef: createEnvRefSecretPort(),
  })
  const resource = Otlp.resource()
  return {
    config: store.config,
    secret,
    resource: {
      serviceName: resource.serviceName,
      serviceVersion: resource.serviceVersion,
      attributes: resource.attributes,
    },
  }
}
