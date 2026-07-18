/**
 * Filesystem-backed `DecisionStorePort` (Feature 001 — composition root).
 *
 * The concrete durable backing for the domain atomic-commit protocol
 * (domain/routing-decision.ts): committed pages, temp pages, journal markers
 * and the by-id pointer files all live under a single base directory. The
 * domain protocol owns the temp -> journal -> atomic-rename ordering and crash
 * recovery; this adapter only supplies the four primitive fs operations it
 * needs, with two production guarantees:
 *
 *   - `writeText` creates the parent directory on demand, so the domain's
 *     `<baseDir>/by-id/<id>.ptr` layout works without pre-seeding subdirs.
 *   - `rename` uses `fs.rename`, which is atomic within a single filesystem
 *     (the domain protocol's linearization point).
 *
 * Missing files read as `null` (never throw), matching the domain port
 * contract; `remove` tolerates an already-absent path.
 */
export * as RoutingDecisionStoreFs from "./decision-store-fs"

import { access, mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import type { DecisionStorePort } from "@/routing/domain/routing-decision"

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT"
}

/** Build a node:fs-backed DecisionStorePort. All writes mkdir their parent dir. */
export function createFsDecisionStorePort(): DecisionStorePort {
  return {
    async exists(filePath: string): Promise<boolean> {
      try {
        await access(filePath)
        return true
      } catch {
        return false
      }
    },

    async readText(filePath: string): Promise<string | null> {
      try {
        return await readFile(filePath, "utf8")
      } catch (error) {
        if (isEnoent(error)) return null
        throw error
      }
    },

    async writeText(filePath: string, contents: string): Promise<void> {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, contents, "utf8")
    },

    async rename(from: string, to: string): Promise<void> {
      await mkdir(path.dirname(to), { recursive: true })
      await rename(from, to)
    },

    async remove(filePath: string): Promise<void> {
      await rm(filePath, { force: true })
    },
  }
}
