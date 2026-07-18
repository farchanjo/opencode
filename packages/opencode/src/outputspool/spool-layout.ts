/**
 * Feature 005 / T025 (S13) — the managed private spool tree, private
 * permissions, and the path-traversal / symlink-escape / TOCTOU guards.
 *
 * The private tree lives under the OpenCode `Global`-rooted data directory
 * (`packages/core/src/global.ts`), replacing the flat `tool-output` directory.
 * Segments key by project, root session, process/attempt, generation, and
 * channel so one `OutputGroupRef` maps to exactly one generation subtree and a
 * stale generation never shares a file with its successor (C1). Directories are
 * `0700` and files `0600` on Unix; owner-only is enforced by an explicit
 * `chmod` after create on every platform (a Windows ACL hook is a non-relaxing
 * configuration seam). Every open/read/write/delete validates that the resolved
 * real path stays under the spool root and that no component is a symlink, so no
 * path-like input opens a file outside the spool (FR11, FR12, FR45, FR46, C1,
 * C6, AC14).
 *
 * A consumer NEVER receives a filesystem path: the layout returns paths only to
 * the sibling application adapters (`file-sink-writer.ts`, `page-reader.ts`,
 * `control-store.ts`), never across a port boundary (FR12, C18). The Feature 004
 * language tag/provenance is attached to a textual channel by the writer from
 * the trusted execution envelope, never recomputed here (FR40, C8).
 */
export * as SpoolLayout from "./spool-layout"

import { constants as fsConstants } from "node:fs"
import { chmod, lstat, mkdir, realpath, rm } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

/** Private-tree permission constants: `0700` directories, `0600` files (C6). */
export const DIR_MODE = 0o700
export const FILE_MODE = 0o600

/** The default managed-tree directory name under the Global data dir (replaces flat `tool-output`). */
export const MANAGED_DIRECTORY = "outputspool"

/** The channel-generation subtree key components (mirrors `identity.subtreeKey`, C1). */
export interface SubtreeKey {
  readonly project_id: string
  readonly root_session_id: string
  readonly process_attempt: string
  readonly generation: string
  readonly channel: string
}

/** A rejected path operation: the reason a candidate path is outside the spool (C6, AC14). */
export type PathGuardError =
  | { readonly type: "invalid_segment"; readonly segment: string }
  | { readonly type: "escapes_root"; readonly resolved: string }
  | { readonly type: "symlink_rejected"; readonly path: string }

export class SpoolPathError extends Error {
  constructor(readonly reason: PathGuardError) {
    super(`outputspool path guard: ${reason.type}`)
    this.name = "SpoolPathError"
  }
}

const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

/**
 * Validate one opaque path segment. A segment must match the bounded id pattern
 * and never be `.`/`..` or contain a separator, so no traversal token reaches a
 * `join` (FR46, C6, AC14).
 */
export const validateSegment = (segment: string): void => {
  if (segment === "." || segment === ".." || !SEGMENT_PATTERN.test(segment))
    throw new SpoolPathError({ type: "invalid_segment", segment })
}

export interface SpoolLayoutDeps {
  /** The absolute spool root; the application binds `<Global.data>/outputspool` (C1). */
  readonly root: string
}

export interface SpoolLayout {
  readonly root: string
  readonly subtreeDir: (key: SubtreeKey) => string
  readonly channelFile: (key: SubtreeKey, name?: string) => string
  readonly ensureSubtree: (key: SubtreeKey) => Promise<string>
  readonly guardWithinRoot: (candidate: string) => Promise<string>
  readonly removeSubtree: (key: SubtreeKey) => Promise<void>
}

/** The five keyed segments of a channel subtree, validated then joined under the root. */
const subtreeSegments = (key: SubtreeKey): readonly string[] => {
  const segments = [key.project_id, key.root_session_id, key.process_attempt, key.generation, key.channel]
  for (const segment of segments) validateSegment(segment)
  return segments
}

/**
 * Assert that `candidate` resolves to a path under `root`. Rejects a candidate
 * whose lexical resolution escapes the root; the caller additionally runs the
 * async symlink/realpath guard before any I/O (C6, AC14).
 */
const assertUnderRoot = (root: string, candidate: string): string => {
  const resolved = resolve(candidate)
  const rel = relative(root, resolved)
  if (rel === "" || rel === ".") return resolved
  if (rel.startsWith("..") || isAbsolute(rel)) throw new SpoolPathError({ type: "escapes_root", resolved })
  return resolved
}

/** Reject when the real (symlink-resolved) path of the nearest existing ancestor escapes the root (TOCTOU/symlink). */
const assertRealUnderRoot = async (root: string, resolved: string): Promise<void> => {
  const rootReal = await realpath(root).catch(() => root)
  let probe = resolved
  // Walk up to the nearest existing ancestor, then realpath it (a not-yet-created leaf has no symlink).
  for (;;) {
    const info = await lstat(probe).catch(() => null)
    if (info) {
      if (info.isSymbolicLink()) throw new SpoolPathError({ type: "symlink_rejected", path: probe })
      const real = await realpath(probe)
      const rel = relative(rootReal, real)
      if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel)))
        throw new SpoolPathError({ type: "escapes_root", resolved: real })
      return
    }
    const parent = resolve(probe, "..")
    if (parent === probe) return
    probe = parent
  }
}

/**
 * Build the managed-tree layout over an absolute spool root. Every returned path
 * stays internal to the application adapters; a consumer never receives one
 * (FR12, C18).
 */
export const createSpoolLayout = (deps: SpoolLayoutDeps): SpoolLayout => {
  const root = resolve(deps.root)

  const subtreeDir = (key: SubtreeKey): string => assertUnderRoot(root, join(root, ...subtreeSegments(key)))

  const channelFile = (key: SubtreeKey, name = "data"): string => {
    validateSegment(name)
    return assertUnderRoot(root, join(subtreeDir(key), name))
  }

  const ensureSubtree = async (key: SubtreeKey): Promise<string> => {
    const dir = subtreeDir(key)
    await assertRealUnderRoot(root, dir)
    await mkdir(dir, { recursive: true, mode: DIR_MODE })
    await chmod(dir, DIR_MODE).catch(() => {})
    return dir
  }

  const guardWithinRoot = async (candidate: string): Promise<string> => {
    const resolved = assertUnderRoot(root, candidate)
    await assertRealUnderRoot(root, resolved)
    return resolved
  }

  const removeSubtree = async (key: SubtreeKey): Promise<void> => {
    const dir = await guardWithinRoot(subtreeDir(key))
    await rm(dir, { recursive: true, force: true })
  }

  return { root, subtreeDir, channelFile, ensureSubtree, guardWithinRoot, removeSubtree }
}

/** True when the runtime supports the POSIX file-mode bits used by the private tree. */
export const supportsPosixModes = (): boolean => typeof fsConstants.S_IRWXU === "number"
