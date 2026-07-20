/**
 * Feature 017 fix-round (ADR-0017 superseding decision) — the process-wide
 * OutputSpool production-writer bootstrap.
 *
 * The Feature 017 writer subscription previously lived ONLY inside
 * `createLiveOperatorStack` (lazy, first operator command). A session that never
 * opened the operator produced output that was never spooled, and output emitted
 * before the first operator access was lost. This module hoists the subscription to
 * a process-wide singleton the SERVER/SESSION startup path arms eagerly — so a
 * session spools from process start whether or not the operator is ever opened. The
 * operator stack REUSES this one store + subscription (never a second connection to
 * `operator-control.db`, never a duplicate GlobalBus listener).
 *
 * FAILS OPEN. If the control store cannot be opened, it returns `undefined` and the
 * operator reads degrade to the typed capability gap — a spool bootstrap never
 * breaks server or session startup.
 */
import path from "path"
import { mkdirSync } from "node:fs"
import { Database as BunDatabase } from "bun:sqlite"
import { Global } from "@opencode-ai/core/global"
import { ControlStore } from "./control-store"
import { SessionSpoolWriter } from "@/session/output-spool-writer"

export interface ProcessSpoolWriter {
  readonly store: ControlStore.ControlStore
  readonly spoolRoot: string
}

let singleton: (ProcessSpoolWriter & { readonly unsubscribe: () => void }) | undefined
let attempted = false

/**
 * Ensure the process-wide production writer is subscribed EXACTLY ONCE (idempotent).
 * Returns the shared `{ store, spoolRoot }` the operator reuses for its reads/admin
 * edge, or `undefined` when the control store cannot be opened (fail-open). A test
 * `override` injects an in-memory store + root instead of opening the managed DB.
 */
export function ensureProcessSpoolWriter(override?: ProcessSpoolWriter): ProcessSpoolWriter | undefined {
  if (singleton) return { store: singleton.store, spoolRoot: singleton.spoolRoot }
  if (attempted && !override) return undefined
  attempted = true
  try {
    const spoolRoot = override?.spoolRoot ?? path.join(Global.Path.data, "outputspool")
    let store = override?.store
    if (!store) {
      mkdirSync(spoolRoot, { recursive: true })
      store = ControlStore.createControlStore(new BunDatabase(path.join(spoolRoot, "operator-control.db")))
    }
    const unsubscribe = SessionSpoolWriter.subscribeSessionSpoolWriter({ store, spoolRoot })
    singleton = { store, spoolRoot, unsubscribe }
    return { store, spoolRoot }
  } catch {
    return undefined
  }
}

/** The current shared writer without arming one; used by callers that must not open the DB themselves. */
export function currentProcessSpoolWriter(): ProcessSpoolWriter | undefined {
  return singleton ? { store: singleton.store, spoolRoot: singleton.spoolRoot } : undefined
}

/** TEST-ONLY: dispose + reset the process singleton so a fresh store/subscription can be armed. */
export function __resetProcessSpoolWriterForTests(): void {
  singleton?.unsubscribe()
  singleton = undefined
  attempted = false
}

export * as SpoolProcessWriter from "./spool-process-writer"
