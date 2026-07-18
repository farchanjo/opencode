/**
 * Feature 005 — OutputSpool domain engine barrel (T024).
 *
 * Re-exports every framework-free `packages/core/src/outputspool/*` domain module
 * under its own namespace, one line per module, mirroring
 * `packages/core/src/jobs/index.ts`, `packages/core/src/lifecycle/index.ts`, and
 * `packages/core/src/langlock/index.ts`, and each module's own
 * `export * as X from "./x"` self-export. This file defines no domain logic of
 * its own.
 *
 * The domain engine is pure and deterministic over injected filesystem, clock,
 * entropy, and MAC ports (C2, C12, C18); the real Bun `FileSink`/`FileHandle`
 * I/O, the SQLite control store, and the durable-event projection live in the
 * `packages/opencode/src/outputspool/**` application layer.
 */

export * as Admission from "./admission"
export * as CursorCodec from "./cursor-codec"
export * as GroupState from "./group-state"
export * as Identity from "./identity"
export * as Paging from "./paging"
export * as Reconcile from "./reconcile"
export * as RetentionGraph from "./retention-graph"
export * as SpoolInstruments from "./spool-instruments"
export * as WriterQueue from "./writer-queue"
