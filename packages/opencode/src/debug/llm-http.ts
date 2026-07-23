/**
 * Opt-in LLM HTTP transport intercept.
 *
 * Enable: OPENCODE_DEBUG_LLM_HTTP=1
 * Output: OPENCODE_DEBUG_LLM_HTTP_DIR (default: $OPENCODE_CONFIG_DIR/debug/llm-http or /tmp/opencode-llm-http)
 *
 * Writes one JSON summary per request (URL, method, skill markers in body).
 * Never logs Authorization / API keys. Bodies are scanned, not fully dumped unless
 * OPENCODE_DEBUG_LLM_HTTP_BODY=1 (still redacts bearer/api-key-like strings).
 */
import fs from "fs"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"

const SKILL_MARKERS = [
  "skill_content",
  "available_skills",
  "<auto_skills>",
  "</auto_skills>",
  "# Skill:",
  "Base directory for this skill",
] as const

export function llmHttpDebugEnabled(): boolean {
  const v = process.env["OPENCODE_DEBUG_LLM_HTTP"]?.toLowerCase()
  return v === "1" || v === "true"
}

function outDir(): string {
  const explicit = process.env["OPENCODE_DEBUG_LLM_HTTP_DIR"]
  if (explicit) return explicit
  const configDir = Flag.OPENCODE_CONFIG_DIR
  if (configDir) return path.join(configDir, "debug", "llm-http")
  return path.join("/tmp", "opencode-llm-http")
}

function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  const h = new Headers(headers as HeadersInit)
  h.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k === "authorization" || k === "api-key" || k === "x-api-key" || k.includes("secret")) {
      out[key] = "[redacted]"
      return
    }
    out[key] = value.length > 200 ? value.slice(0, 200) + "…" : value
  })
  return out
}

async function bodyText(init?: RequestInit): Promise<string | undefined> {
  if (!init?.body) return undefined
  const body = init.body
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  // ReadableStream / FormData — skip deep clone to avoid consuming stream
  return undefined
}

function scanSkillMarkers(text: string): {
  markers: string[]
  skillContentNames: string[]
  hasAvailableSkills: boolean
  hasAutoSkills: boolean
  hasSkillContent: boolean
  bodyBytes: number
} {
  const markers = SKILL_MARKERS.filter((m) => text.includes(m))
  const skillContentNames: string[] = []
  for (const m of text.matchAll(/<skill_content\s+name="([^"]+)"/g)) {
    if (m[1]) skillContentNames.push(m[1])
  }
  for (const m of text.matchAll(/# Skill:\s*(\S+)/g)) {
    if (m[1] && !skillContentNames.includes(m[1])) skillContentNames.push(m[1])
  }
  return {
    markers,
    skillContentNames,
    hasAvailableSkills: text.includes("available_skills"),
    hasAutoSkills: text.includes("<auto_skills>"),
    hasSkillContent: text.includes("skill_content") || text.includes("# Skill:"),
    bodyBytes: Buffer.byteLength(text, "utf8"),
  }
}

let seq = 0

export function wrapFetchForLlmHttpDebug(fetchFn: typeof globalThis.fetch): typeof globalThis.fetch {
  if (!llmHttpDebugEnabled()) return fetchFn

  const dir = outDir()
  fs.mkdirSync(dir, { recursive: true })
  const indexPath = path.join(dir, "index.ndjson")

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const n = ++seq
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url
    const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")
    const started = Date.now()
    let body: string | undefined
    try {
      body = await bodyText(init)
    } catch {
      body = undefined
    }

    const skill = body ? scanSkillMarkers(body) : null
    const record = {
      id: n,
      ts: new Date().toISOString(),
      method,
      url: url.replace(/([?&](api[_-]?key|key|token)=)[^&]+/gi, "$1[redacted]"),
      headers: redactHeaders(init?.headers),
      skill,
      dumpBody: process.env["OPENCODE_DEBUG_LLM_HTTP_BODY"] === "1",
    }

    // Optional full body dump (redact common secret patterns)
    if (record.dumpBody && body) {
      const safe = body
        .replace(/("api[_-]?key"\s*:\s*")[^"]+/gi, "$1[redacted]")
        .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
      const bodyPath = path.join(dir, `req-${String(n).padStart(4, "0")}-body.txt`)
      fs.writeFileSync(bodyPath, safe)
      ;(record as { bodyPath?: string }).bodyPath = bodyPath
    }

    const summaryPath = path.join(dir, `req-${String(n).padStart(4, "0")}.json`)
    fs.writeFileSync(summaryPath, JSON.stringify(record, null, 2))
    fs.appendFileSync(indexPath, JSON.stringify({ ...record, path: summaryPath }) + "\n")

    try {
      const res = await fetchFn(input, init)
      const done = {
        id: n,
        status: res.status,
        ms: Date.now() - started,
        ok: res.ok,
      }
      fs.appendFileSync(indexPath, JSON.stringify({ type: "response", ...done }) + "\n")
      return res
    } catch (error) {
      fs.appendFileSync(
        indexPath,
        JSON.stringify({
          type: "error",
          id: n,
          ms: Date.now() - started,
          message: error instanceof Error ? error.message : String(error),
        }) + "\n",
      )
      throw error
    }
  }

  return wrapped as typeof globalThis.fetch
}
