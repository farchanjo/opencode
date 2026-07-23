/**
 * Feature 058 / ops — fire-and-forget semantic index jobs at OpenCode open.
 *
 * When the operator stack mounts a live IndexPort (Milvus + LiveDocSource),
 * dispatch reconcile (or full reindex) for `skills` + `skill_chunks` so Tier-1
 * semantic ranking can leave passthrough. Fail-open: never blocks startup.
 *
 * Env:
 * - OPENCODE_SEMANTIC_STARTUP_INDEX=0 — disable
 * - OPENCODE_SEMANTIC_STARTUP_INDEX=full — full rebuild (embed every doc)
 * - default: incremental reconcile (content-hash, cheaper)
 */
export * as StartupIndex from "./startup-index"

import { Effect } from "effect"
import type { CollectionKind } from "@opencode-ai/protocol/semantic/commands"
import type { IndexPort } from "@opencode-ai/protocol/semantic/ports"

const STARTUP_COLLECTIONS: readonly CollectionKind[] = ["skills", "skill_chunks"]

const SYSTEM_PRINCIPAL = {
  id: "system:startup-index",
  kind: "system" as const,
}

let dispatched = false

export function startupIndexEnabled(): boolean {
  const v = process.env["OPENCODE_SEMANTIC_STARTUP_INDEX"]?.toLowerCase()
  if (v === "0" || v === "false" || v === "off") return false
  return true
}

export function startupIndexMode(): "reconcile" | "full" {
  const v = process.env["OPENCODE_SEMANTIC_STARTUP_INDEX"]?.toLowerCase()
  return v === "full" || v === "reindex" ? "full" : "reconcile"
}

/**
 * Dispatch background index jobs once per process. Safe to call multiple times.
 */
export function dispatchStartupSemanticIndex(index: IndexPort): void {
  if (dispatched) return
  if (!startupIndexEnabled()) return
  dispatched = true

  const mode = startupIndexMode()
  const collections = [...STARTUP_COLLECTIONS]

  void (async () => {
    for (const collection of collections) {
      try {
        const effect =
          mode === "full"
            ? index.reindex({ collection, principal: SYSTEM_PRINCIPAL })
            : index.reconcile({ collection, scheduledOccurrenceId: "startup" })
        const result = await Effect.runPromise(effect)
        // Bounded, content-free log line (no paths/secrets).
        console.error(
          `[semantic-startup-index] ${mode} ${collection}: upserted=${result.upsertedCount} tombstoned=${result.tombstonedCount}`,
        )
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[semantic-startup-index] ${mode} ${collection} failed: ${msg.slice(0, 200)}`)
      }
    }
  })()
}

/** Test-only: allow re-dispatch in unit tests. */
export function resetStartupIndexDispatchForTests(): void {
  dispatched = false
}
