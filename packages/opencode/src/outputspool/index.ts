/**
 * Feature 005 — OutputSpool application + adapters barrel (T036).
 *
 * Re-exports every `packages/opencode/src/outputspool/*` application module under
 * its own namespace, one line per module, mirroring each module's own
 * `export * as X from "./x"` self-export and the Feature 002/003/004 application
 * barrels. This file defines no logic of its own.
 *
 * The application layer owns the real Bun `FileSink`/`FileHandle` I/O
 * (`file-sink-writer.ts`, `page-reader.ts`), the SQLite control store
 * (`control-store.ts`), the managed private tree + guards (`spool-layout.ts`),
 * the startup reconciler (`reconciler.ts`), the ref-aware retention sweeper
 * (`retention-sweeper.ts`), the durable-event projection on the EventV2 bridge
 * (`durable-events.ts`), per-action authorization (`authorization.ts`), the
 * streaming/compatibility boundary (`compat-boundary.ts`), the budgeted
 * context-slice materializer (`context-slice.ts`), and the C16 migration bridge
 * (`migration-bridge.ts`); the framework-free domain engine lives in
 * `packages/core/src/outputspool/**` and the Feature 007 `output.*` operator
 * domain impls in `packages/opencode/src/operator/outputspool/**`.
 */

export * as SpoolLayout from "./spool-layout"
export * as FileSinkWriter from "./file-sink-writer"
export * as PageReader from "./page-reader"
export * as ControlStore from "./control-store"
export * as Reconciler from "./reconciler"
export * as RetentionSweeper from "./retention-sweeper"
export * as DurableEvents from "./durable-events"
export * as Authorization from "./authorization"
export * as CompatBoundary from "./compat-boundary"
export * as ContextSlice from "./context-slice"
export * as MigrationBridge from "./migration-bridge"
