/**
 * Feature 003 — Jobs application + adapters barrel (T026).
 *
 * Re-exports every `packages/opencode/src/jobs/*` application module under its
 * own namespace, one line per module, mirroring
 * `packages/opencode/src/lifecycle/index.ts` and each module's own
 * `export * as X from "./x"` self-export. This file defines no logic of its own:
 * the trigger service (T023), notification service (T024), and authorization
 * (T025) are the composition surface the operator/CLI/TUI layers wire against
 * (C12, C16).
 *
 * The Bun.cron adapter (`bun-cron-adapter.ts`, T021) and the Config.Service
 * persistence (`persistence.ts`, T022) are the wave-3 adapter worker's modules;
 * their `BunCronAdapter` / `JobPersistence` namespaces are re-exported below
 * alongside the service modules (T023–T025).
 */

export * as Authorization from "./authorization"
export * as BunCronAdapter from "./bun-cron-adapter"
export * as JobPersistence from "./persistence"
export * as NotificationService from "./notification-service"
export * as TriggerService from "./trigger-service"
