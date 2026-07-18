/**
 * Live OTEL recorder for operator dispatches (T046).
 * Content-free allowlisted attributes only; one record per dispatch via dispatcher.
 * Wires to process @opentelemetry/api tracer when available; fails harmlessly if disabled.
 */
import {
  createOperatorSpanRecorder,
  sanitizeOperatorOtelAttributes,
  type OperatorOtelAttributes,
  type OperatorSpanRecorder,
} from "@opencode-ai/core/operator"

export type LiveOperatorOtel = OperatorSpanRecorder & {
  readonly kind: "live"
  readonly tracerWired: boolean
}

export type OtelTracerLike = {
  readonly startActiveSpan: (
    name: string,
    options: { attributes?: Record<string, string | number | boolean> },
    fn: (span: { end: () => void; setAttribute: (k: string, v: string | number | boolean) => void }) => void,
  ) => void
}

export type CreateLiveOperatorOtelInput = {
  /** Injected tracer for tests; production attempts @opentelemetry/api. */
  readonly tracer?: OtelTracerLike | null
  /** Force no tracer (tests). */
  readonly disableTracer?: boolean
}

function tryGetProcessTracer(): OtelTracerLike | null {
  try {
    // Optional peer — fail harmlessly when telemetry SDK not loaded
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("@opentelemetry/api") as {
      trace?: { getTracer?: (name: string) => OtelTracerLike }
    }
    const tracer = api.trace?.getTracer?.("opencode.operator")
    if (!tracer || typeof tracer.startActiveSpan !== "function") return null
    return tracer
  } catch {
    return null
  }
}

/**
 * Wire content-free OTEL into live stack.
 * Snapshots for tests; real tracer spans when process OTEL is present.
 */
export function createLiveOperatorOtelRecorder(input: CreateLiveOperatorOtelInput = {}): LiveOperatorOtel {
  const inner = createOperatorSpanRecorder()
  const tracer =
    input.disableTracer === true
      ? null
      : input.tracer !== undefined
        ? input.tracer
        : tryGetProcessTracer()

  return {
    kind: "live",
    tracerWired: tracer !== null,
    record(attrs: OperatorOtelAttributes) {
      const sanitized = sanitizeOperatorOtelAttributes(attrs as unknown as Record<string, unknown>)
      if (!sanitized.ok) return
      const clean = sanitized.attributes
      inner.record(clean)
      if (!tracer) return
      try {
        const otelAttrs: Record<string, string | number | boolean> = {
          command_id: clean.command_id,
          domain: clean.domain,
          surface: clean.surface,
          scope_kind: clean.scope_kind,
          outcome: clean.outcome,
          duration_ms: clean.duration_ms,
          retry: clean.retry,
        }
        if (clean.error_code !== undefined) otelAttrs.error_code = clean.error_code
        tracer.startActiveSpan("operator.dispatch", { attributes: otelAttrs }, (span) => {
          for (const [k, v] of Object.entries(otelAttrs)) {
            span.setAttribute(k, v)
          }
          span.end()
        })
      } catch {
        // Telemetry must never break operator dispatch
      }
    },
    snapshots: () => inner.snapshots(),
  }
}

export * as OperatorOtelLive from "./otel-live"
