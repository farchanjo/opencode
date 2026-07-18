/**
 * Cross-process serialization for the fixed operator sandbox port (14096).
 * Production still uses OPERATOR_PORT=14096; tests must not contend on bind.
 * Never uses production 4096.
 */
import fs from "fs/promises"
import net from "node:net"
import os from "os"
import path from "path"
import { Flock } from "@opencode-ai/core/util/flock"

/** Same fixed sandbox port as production operator isolation harness. */
export const OPERATOR_SANDBOX_TEST_PORT = 14096 as const

const LOCK_DIR = path.join(os.tmpdir(), "opencode-operator-test-locks")
const LOCK_KEY = "operator-sandbox-port-14096"

/**
 * Run `fn` under a cross-process Flock so only one suite binds 14096 at a time.
 * Awaits port release after `fn` if a stop callback is provided via finally patterns.
 */
export async function withOperatorSandboxPortLock<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(LOCK_DIR, { recursive: true })
  return Flock.withLock(LOCK_KEY, fn, {
    dir: LOCK_DIR,
    timeoutMs: 120_000,
    staleMs: 180_000,
    baseDelayMs: 25,
    maxDelayMs: 200,
  })
}

/** True when something is already listening on host:port. */
export async function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(true))
    probe.once("listening", () => {
      probe.close(() => resolve(false))
    })
    probe.listen(port, host)
  })
}

/**
 * Poll until the port is free (after listener.stop). Fail closed after timeout.
 */
export async function waitForPortRelease(
  port: number,
  options?: { readonly host?: string; readonly timeoutMs?: number; readonly intervalMs?: number },
): Promise<void> {
  const host = options?.host ?? "127.0.0.1"
  const timeoutMs = options?.timeoutMs ?? 10_000
  const intervalMs = options?.intervalMs ?? 50
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isPortInUse(port, host))) return
    await Bun.sleep(intervalMs)
  }
  throw new Error(`port ${host}:${port} still in use after ${timeoutMs}ms`)
}

/**
 * Stop a Server.listen listener and wait until the sandbox port is free.
 */
export async function stopOperatorListener(
  listener: { stop: (close?: boolean) => Promise<void> } | undefined,
  port: number = OPERATOR_SANDBOX_TEST_PORT,
  host = "127.0.0.1",
): Promise<void> {
  if (!listener) return
  await listener.stop(true)
  await waitForPortRelease(port, { host })
}
