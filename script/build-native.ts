#!/usr/bin/env bun
/**
 * Feature 010 — native build pipeline (T021, S16).
 *
 * Explicit, never install-time (C17): runs `cargo build --release` at the workspace
 * root, then copies the two `cdylib` artifacts into the gitignored bundled landing
 * dir `packages/core/native/<platform>-<arch>/` (`<arch>` = `arm64` | `x64`) where
 * the loader's discovery ladder finds them. Bun `postinstall` does NOT build Rust:
 * a fresh checkout runs the TypeScript path unchanged, and an absent artifact
 * triggers the FR19 fallback rather than a build/runtime failure.
 *
 * Honest provenance (C17): if `cargo` is unavailable, this script reports the typed
 * consequence (native stays absent, the TypeScript fallback serves every tool) and
 * exits non-zero without faking a green build.
 *
 * CI note (T021, AC18). CI builds both `cdylib` crates on macOS AND Linux runners and:
 *   - runs `cargo fmt --all --check` + `cargo clippy --workspace --all-targets
 *     --all-features -D warnings` (Rust hygiene gates);
 *   - enforces the toolchain pin from `rust-toolchain.toml` (channel 1.83.0) — the
 *     build fails on channel drift or on a resolved dependency raising the MSRV above
 *     the pinned floor;
 *   - runs the parity suite, the fallback byte-identity suite, and the leak/panic
 *     stress suite (the stress + panic-containment probes build the debug-featured
 *     dylib via `--features alloc-stats,panic-probe`);
 *   - copies the release artifacts into the gitignored bundled dir via this script.
 * This is never wired into install: Bun `postinstall` does not build Rust. On a runner
 * that cannot build Rust, the honest consequence is recorded — the exercised platforms
 * ship the native artifact, every other platform (and win32 always) takes the
 * byte-identical TypeScript fallback (FR19). Artifact absence is a fallback, never a
 * failure; a green build is never faked (C17).
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"

const CRATES = ["libopencode_tools_ffi", "libopencode_pty_ffi"] as const

function libExtension(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "dylib"
  if (platform === "win32") return "dll"
  return "so"
}

function main(): number {
  const platform = process.platform
  if (platform === "win32") {
    console.error("build:native — win32 always takes the TypeScript path; nothing to build.")
    return 0
  }

  const root = path.resolve(import.meta.dir, "..")
  const cargo = spawnSync("cargo", ["build", "--release"], { cwd: root, stdio: "inherit" })
  if (cargo.error) {
    console.error(`build:native — cargo unavailable (${cargo.error.message}).`)
    console.error("Native libraries stay absent; the TypeScript fallback serves every tool (FR19).")
    return 1
  }
  if (cargo.status !== 0) {
    console.error(`build:native — cargo build failed with status ${cargo.status}.`)
    return cargo.status ?? 1
  }

  const ext = libExtension(platform)
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch
  const destDir = path.join(root, "packages/core/native", `${platform}-${arch}`)
  mkdirSync(destDir, { recursive: true })

  let copied = 0
  for (const stem of CRATES) {
    const source = path.join(root, "target/release", `${stem}.${ext}`)
    if (!existsSync(source)) {
      console.error(`build:native — expected artifact missing: ${source}`)
      continue
    }
    const dest = path.join(destDir, `${stem}.${ext}`)
    copyFileSync(source, dest)
    console.log(`build:native — ${path.relative(root, dest)}`)
    copied++
  }

  if (copied === 0) {
    console.error("build:native — no artifacts copied.")
    return 1
  }
  return 0
}

process.exit(main())
