/**
 * Feature 019 / T017 — env-gated LIVE OTLP export validation.
 *
 * Skips cleanly unless `OPENCODE_TELEMETRY_LIVE=1` is set, so CI never requires the
 * live collector. When enabled it drives the REAL `createHttpOtlpTransport` against a
 * live OTLP collector (`OPENCODE_TELEMETRY_ENDPOINT`, default the operator's persisted
 * collector), emits a uniquely-named, content-free test metric tagged with a run id,
 * then verifies ingestion by querying the downstream Mimir Prometheus API
 * (`OPENCODE_TELEMETRY_MIMIR_QUERY`). The metric carries only a numeric point + a
 * bounded run-id label — never a prompt, secret, path, or payload.
 */
import { describe, expect, test } from "bun:test"
import { createHttpOtlpTransport } from "@/routing/adapters/outbound/otlp-transport"
import type { TelemetrySignal } from "@/routing/adapters/outbound/otlp-adapter"

const LIVE = process.env.OPENCODE_TELEMETRY_LIVE === "1"
const ENDPOINT = process.env.OPENCODE_TELEMETRY_ENDPOINT ?? "http://vm.services:4318"
const MIMIR_QUERY = process.env.OPENCODE_TELEMETRY_MIMIR_QUERY ?? "http://vm.services:9009/prometheus/api/v1/query"
const METRIC = "opencode_telemetry_live_check"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function queryMimir(promql: string): Promise<any> {
  const url = `${MIMIR_QUERY}?query=${encodeURIComponent(promql)}`
  const res = await fetch(url, { headers: { "X-Scope-OrgID": process.env.OPENCODE_TELEMETRY_TENANT ?? "anonymous" } })
  const body = await res.json()
  return { status: res.status, body }
}

describe("T017 live OTLP export → Mimir ingestion", () => {
  test.skipIf(!LIVE)(
    "emits a unique metric to the live collector and confirms downstream ingestion",
    async () => {
      const runId = `t017_${Math.random().toString(16).slice(2, 10)}`
      const transport = createHttpOtlpTransport({
        endpoint: ENDPOINT,
        retryBudget: 3,
        timeoutMs: 5000,
        resource: { serviceName: "opencode", serviceVersion: "0.0.0-t017", attributes: { "telemetry.test": "t017" } },
      })

      const signal: TelemetrySignal = { kind: "metrics", name: METRIC, attributes: { value: 1, run_id: runId }, timestamp: Date.now() }
      const sent = await transport.send([signal])
      console.log("[T017] send:", JSON.stringify(sent))
      expect(sent.ok).toBe(true)

      // Alloy forwards to Mimir within seconds — poll briefly, bounded.
      const promql = `${METRIC}{run_id="${runId}"}`
      let found = false
      let lastRaw = ""
      for (let attempt = 0; attempt < 15 && !found; attempt++) {
        await sleep(2000)
        const { status, body } = await queryMimir(promql)
        lastRaw = JSON.stringify(body)
        const results = body?.data?.result ?? []
        if (status === 200 && Array.isArray(results) && results.length > 0) {
          found = true
          console.log(`[T017] ingested after ${(attempt + 1) * 2}s:`, lastRaw)
        }
      }
      console.log("[T017] final Mimir response:", lastRaw)
      expect(found).toBe(true)
    },
    120_000,
  )
})
