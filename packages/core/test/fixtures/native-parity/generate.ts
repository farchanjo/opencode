#!/usr/bin/env bun
/**
 * Feature 010 — regenerate the shared native-parity fixtures (T008).
 *
 * Deterministic generator for the byte-exact fixtures the `read`/`grep` parity
 * harness runs through both backends: CRLF vs LF, non-ASCII UTF-8 (including an
 * astral emoji), a NUL-bearing binary buffer, a >2000-char line, and a >50 KiB file
 * that forces the paged-by-size read branch. Run with `bun run generate.ts` from
 * this directory when the fixtures need to be rebuilt.
 */
import { statSync, writeFileSync } from "node:fs"

const dir = import.meta.dir
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

writeFileSync(`${dir}/crlf.txt`, `line1${CR}${LF}line2${CR}${LF}line3${CR}${LF}`)
writeFileSync(`${dir}/lf.txt`, `alpha${LF}beta${LF}gamma${LF}`)
writeFileSync(`${dir}/utf8.txt`, `café${LF}naïve${LF}Ωmega${LF}emoji-😀-tail${LF}`)
writeFileSync(`${dir}/nul.txt`, Buffer.from([0x61, 0x62, 0x00, 0x63, 0x0a, 0x6d, 0x6f, 0x72, 0x65]))
writeFileSync(`${dir}/longline.txt`, `${"x".repeat(2500)}${LF}short tail${LF}`)

let big = ""
for (let index = 1; index <= 4000; index++) big += `line number ${index} with some filler text${LF}`
writeFileSync(`${dir}/big.txt`, big)

console.log("big.txt", statSync(`${dir}/big.txt`).size, "bytes; nul.txt", statSync(`${dir}/nul.txt`).size, "bytes")
