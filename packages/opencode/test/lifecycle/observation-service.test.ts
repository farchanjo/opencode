/**
 * Feature 002 / T026 + T027 — the observation service and its authorization.
 * Drives real Effect Streams over an in-memory bounded source and asserts
 * scoped delivery, sibling-leak rejection (AC3/AC4), operator-only global scope,
 * and metadata redaction (FR13). In-process fixture style: no bus, no runtime.
 */
import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import { describe, expect, test } from "bun:test"
import type { EventV2 } from "@opencode-ai/core/event"
import { createObservationService, type LifecycleSubscribe } from "@/lifecycle/observation-service"
import type { LifecycleObservation, ObservationError, ObserverPrincipal } from "@opencode-ai/protocol/lifecycle/commands"
import { payload } from "./fixtures"

const source = (payloads: ReadonlyArray<EventV2.Payload>): LifecycleSubscribe =>
  Effect.succeed(Stream.fromIterable(payloads))

/** Open a scoped observation stream and collect it within the same scope (leak-free). */
const observe = (
  open: Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>,
): Promise<ReadonlyArray<LifecycleObservation>> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stream = yield* open
      const out: LifecycleObservation[] = []
      yield* Stream.runForEach(stream, (observation) => Effect.sync(() => void out.push(observation)))
      return out as ReadonlyArray<LifecycleObservation>
    }).pipe(Effect.scoped),
  )

const observeExit = (
  open: Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>,
) => Effect.runPromiseExit(open.pipe(Effect.scoped))

const AGENT: ObserverPrincipal = { kind: "agent", sessionId: "ses_1" as never }
const OPERATOR: ObserverPrincipal = { kind: "operator", id: "op_1" }

describe("T026 observation service — scoped delivery", () => {
  test("observeSession delivers own-session events and drops siblings", async () => {
    const payloads = [
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_1", processId: "proc_1" }),
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_2", processId: "proc_2" }),
    ]
    const service = createObservationService({ subscribe: source(payloads) })
    const observations = await observe(service.observeSession({ sessionId: "ses_1" as never, principal: AGENT }))
    expect(observations).toHaveLength(1)
    expect(observations[0]?.envelope.tree.session_id as string).toBe("ses_1")
  })

  test("observeProcess filters to the requested process", async () => {
    const payloads = [
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_1", processId: "proc_1" }),
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_1", processId: "proc_9" }),
    ]
    const service = createObservationService({ subscribe: source(payloads) })
    const observations = await observe(service.observeProcess({ processId: "proc_1" as never, principal: AGENT }))
    expect(observations).toHaveLength(1)
    expect(observations[0]?.envelope.process.process_id as string).toBe("proc_1")
  })
})

describe("T027 observation authorization", () => {
  test("an agent observing a sibling session is rejected (AC3)", async () => {
    const service = createObservationService({ subscribe: source([]) })
    const exit = await observeExit(service.observeSession({ sessionId: "ses_other" as never, principal: AGENT }))
    expect(exit._tag).toBe("Failure")
  })

  test("a non-operator observing global is unauthorized", async () => {
    const service = createObservationService({ subscribe: source([]) })
    const exit = await observeExit(service.observeGlobal({ filter: { limit: 10 }, principal: AGENT as never }))
    expect(exit._tag).toBe("Failure")
  })

  test("an operator observes the global stream across sessions", async () => {
    const payloads = [
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_1" }),
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_2" }),
    ]
    const service = createObservationService({ subscribe: source(payloads) })
    const observations = await observe(service.observeGlobal({ filter: { limit: 10 }, principal: OPERATOR }))
    expect(observations).toHaveLength(2)
  })

  test("delivered observations redact sensitive metadata keys (FR13)", async () => {
    const payloads = [
      payload({ eventType: "lifecycle.tool_called", sessionId: "ses_1", metadata: { prompt: "secret text", region: "us" } }),
    ]
    const service = createObservationService({ subscribe: source(payloads) })
    const observations = await observe(service.observeSession({ sessionId: "ses_1" as never, principal: AGENT }))
    const metadata = observations[0]?.envelope.delivery.redacted_metadata as Record<string, string>
    expect(metadata.prompt).toBeUndefined()
    expect(metadata.region).toBe("us")
  })
})
