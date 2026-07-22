export * as OutputSpoolLive from "./output-spool-live"

import { Effect, Layer } from "effect"
import { OutputSpoolStore } from "@/semantic/output-spool-store"
import { SpoolProcessWriter } from "@/outputspool/spool-process-writer"
import { SessionSpoolWriter } from "@/session/output-spool-writer"
import { OutputSpoolBackendLive } from "@/operator/outputspool/backend-live"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

/**
 * Feature 052 (FR3) — the live `OutputSpoolStore.Service` mount for the session graph.
 * `buildAutoSkills` resolves the service SOFTLY (`Effect.serviceOption`), so a graph
 * without this node silently skips every Tier-2 `<auto_skills>` injection; this mount
 * closes that gap for both the shared `AppRuntime` graph and the server-route graph.
 *
 * Composition mirrors the operator's Feature 050 `LiveDocSource` spool seam
 * (`stack-live.ts`): the process-wide production writer + control store
 * (`ensureProcessSpoolWriter`, opened EXACTLY ONCE per process) backs a
 * `createOutputSpoolStore` over the same `operator-control.db` + spool root the
 * index-time chunk writes landed in — never a second connection path. The store is
 * resolved lazily on first use and cached; an unopenable control store degrades every
 * call to a typed `spool_unavailable` (the seam's own fail-open skip), never a crash.
 */
let cached: OutputSpoolStore.OutputSpoolStore | undefined

function resolveStore(): OutputSpoolStore.OutputSpoolStore | undefined {
  if (cached) return cached
  const shared = SpoolProcessWriter.ensureProcessSpoolWriter()
  if (shared?.store === undefined) return undefined
  cached = OutputSpoolStore.createOutputSpoolStore({
    writer: SessionSpoolWriter.createSessionSpoolWriter({ store: shared.store, spoolRoot: shared.spoolRoot }),
    reader: OutputSpoolBackendLive.createLiveOutputSpoolBackend({
      store: shared.store,
      spoolRoot: shared.spoolRoot,
    }),
  })
  return cached
}

const unavailable: OutputSpoolStore.OutputSpoolStoreError = {
  type: "spool_unavailable",
  reason: "process spool writer unbound",
}

const withStore = <A>(
  use: (store: OutputSpoolStore.OutputSpoolStore) => Effect.Effect<A, OutputSpoolStore.OutputSpoolStoreError>,
): Effect.Effect<A, OutputSpoolStore.OutputSpoolStoreError> => {
  const store = resolveStore()
  return store === undefined ? Effect.fail(unavailable) : use(store)
}

export const node = LayerNode.make({
  service: OutputSpoolStore.Service,
  layer: Layer.effect(
    OutputSpoolStore.Service,
    Effect.sync(() =>
      OutputSpoolStore.Service.of({
        put: (input) => withStore((store) => store.put(input)),
        resolve: (ref) => withStore((store) => store.resolve(ref)),
        supersede: (priorRef) => withStore((store) => store.supersede(priorRef)),
      }),
    ),
  ),
  deps: [],
})
