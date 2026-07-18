/**
 * Safety: T005–T012 suite must not mutate real prod XDG opencode metadata.
 * Metadata-only snapshot (names/size/mtime) — never reads secrets/contents.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const realHome = os.homedir()

type EntryMeta = {
  name: string
  mtimeMs: number
  size: number
  isDir: boolean
}

async function snapshotDir(dir: string): Promise<EntryMeta[] | null> {
  try {
    const names = await fs.readdir(dir)
    const entries: EntryMeta[] = []
    for (const name of names.sort()) {
      const st = await fs.stat(path.join(dir, name))
      entries.push({
        name,
        mtimeMs: Math.trunc(st.mtimeMs),
        size: st.size,
        isDir: st.isDirectory(),
      })
    }
    return entries
  } catch {
    return null
  }
}

function xdgRoots() {
  return [
    path.join(realHome, ".config", "opencode"),
    path.join(realHome, ".local", "share", "opencode"),
    path.join(realHome, ".cache", "opencode"),
    path.join(realHome, ".local", "state", "opencode"),
  ]
}

describe("operator T005-T012 prod path safety", () => {
  test("prod XDG opencode metadata unchanged after pure unit imports", async () => {
    const before = await Promise.all(xdgRoots().map(snapshotDir))

    // Exercise pure modules only (no CLI/server)
    const { createSeededOperatorCommandRegistry, createDispatcher, fixtureStatusHandler, createHandlerMap } =
      await import("@/operator/application")
    const registry = createSeededOperatorCommandRegistry()
    const dispatcher = createDispatcher({
      registry,
      handlers: createHandlerMap([["langlock.status", fixtureStatusHandler]]),
    })
    await dispatcher.dispatchRequest({
      id: "langlock.status" as never,
      principal: { kind: "operator", subject: "local", projectBinding: null },
      scope: { kind: "project", ref: "p1" },
      source: "cli",
      isTty: false,
    })

    const after = await Promise.all(xdgRoots().map(snapshotDir))
    expect(after).toEqual(before)
  })
})
