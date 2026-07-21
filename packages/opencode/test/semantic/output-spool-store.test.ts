import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { OutputSpoolStore } from "@/semantic/output-spool-store"
import type { ChannelKey, IngestOutcome } from "@/session/output-spool-writer"
import type { OutputSpoolBackend } from "@/operator/outputspool/outputspool-port"

// Feature 050 / T014 — the OutputSpoolStore chunk-body façade against fake
// SessionSpoolWriter/OutputSpoolBackend seams: put -> resolve round-trip
// returns the same sanitized body + contentHash; supersede marks the prior ref
// reclaimable (sealed) and a new put yields a distinct ref; a missing ref
// resolves `{type:"not_found"}` rather than throwing.

interface FakeRecord {
  bytes: Buffer
  sealed: boolean
}

/** An in-memory writer + reader pair standing in for the real Feature 005 subsystem. */
const createFakeSpool = () => {
  const store = new Map<string, FakeRecord>()

  const writer = {
    ingest: async (key: ChannelKey, text: string): Promise<IngestOutcome> => {
      const bytes = Buffer.from(text, "utf8")
      store.set(key.outputRef, { bytes, sealed: false })
      return { kind: "appended", committedBytes: bytes.length }
    },
    seal: async (outputRef: string): Promise<void> => {
      const record = store.get(outputRef)
      if (record) record.sealed = true
    },
  }

  const reader: Pick<OutputSpoolBackend, "stat" | "read"> = {
    stat: (input) => {
      const record = store.get(input.outputRef)
      if (!record) return Effect.fail({ type: "not_found", outputRef: input.outputRef })
      return Effect.succeed({
        stat: {
          outputRef: input.outputRef,
          channel: "artifact",
          state: record.sealed ? "sealed" : "open",
          committedBytes: record.bytes.length,
          fsyncTier: "durable",
          updatedAt: new Date(0).toISOString(),
        },
      })
    },
    read: (input) => {
      const record = store.get(input.outputRef)
      if (!record) return Effect.fail({ type: "not_found", outputRef: input.outputRef })
      const bytes = record.bytes.subarray(input.offset, input.offset + input.limit)
      return Effect.succeed({
        page: {
          bytes,
          nextOffset: input.offset + bytes.length,
          committedBytes: record.bytes.length,
          caughtUp: true,
          eof: true,
        },
      })
    },
  }

  return { writer, reader, store }
}

describe("OutputSpoolStore — put/resolve round-trip (T013, FR8)", () => {
  test("resolve returns the SAME sanitized body written by put", async () => {
    const { writer, reader } = createFakeSpool()
    const store = OutputSpoolStore.createOutputSpoolStore({ writer, reader })

    const putResult = await Effect.runPromise(
      store.put({ parentSkillId: "deploy-helper", chunkIndex: 0, contentHash: "hash-1", sanitizedBody: "sanitized chunk body" }),
    )
    expect(putResult.offset).toBe(0)
    expect(putResult.limit).toBe(Buffer.byteLength("sanitized chunk body", "utf8"))

    const resolved = await Effect.runPromise(store.resolve(putResult.outputRef))
    expect(resolved.body).toBe("sanitized chunk body")
    expect(resolved.contentHash).toBe(putResult.outputRef)
  })

  test("two chunks (different parentSkillId/chunkIndex) resolve independently", async () => {
    const { writer, reader } = createFakeSpool()
    const store = OutputSpoolStore.createOutputSpoolStore({ writer, reader })

    const first = await Effect.runPromise(
      store.put({ parentSkillId: "skill-a", chunkIndex: 0, contentHash: "hash-a0", sanitizedBody: "body a0" }),
    )
    const second = await Effect.runPromise(
      store.put({ parentSkillId: "skill-a", chunkIndex: 1, contentHash: "hash-a1", sanitizedBody: "body a1" }),
    )
    expect(first.outputRef).not.toBe(second.outputRef)
    expect((await Effect.runPromise(store.resolve(first.outputRef))).body).toBe("body a0")
    expect((await Effect.runPromise(store.resolve(second.outputRef))).body).toBe("body a1")
  })
})

describe("OutputSpoolStore — dangling ref (T013)", () => {
  test("resolve of a ref that was never put fails typed 'not_found', never throws", async () => {
    const { writer, reader } = createFakeSpool()
    const store = OutputSpoolStore.createOutputSpoolStore({ writer, reader })

    const exit = await Effect.runPromiseExit(store.resolve("never-put-ref"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toEqual({ type: "not_found" })
  })
})

describe("OutputSpoolStore — supersede (T013)", () => {
  test("supersede seals the prior entry; a new put for edited content yields a distinct ref", async () => {
    const { writer, reader, store: backing } = createFakeSpool()
    const store = OutputSpoolStore.createOutputSpoolStore({ writer, reader })

    const original = await Effect.runPromise(
      store.put({ parentSkillId: "deploy-helper", chunkIndex: 0, contentHash: "hash-v1", sanitizedBody: "version one" }),
    )
    await Effect.runPromise(store.supersede(original.outputRef))
    expect(backing.get(original.outputRef)?.sealed).toBe(true)

    const edited = await Effect.runPromise(
      store.put({ parentSkillId: "deploy-helper", chunkIndex: 0, contentHash: "hash-v2", sanitizedBody: "version two" }),
    )
    expect(edited.outputRef).not.toBe(original.outputRef)
    expect((await Effect.runPromise(store.resolve(edited.outputRef))).body).toBe("version two")
    // The prior entry's bytes are preserved (sealed, not mutated in place) until Feature 005's retention sweep.
    expect((await Effect.runPromise(store.resolve(original.outputRef))).body).toBe("version one")
  })

  test("supersede on an already-superseded ref is idempotent (no throw)", async () => {
    const { writer, reader } = createFakeSpool()
    const store = OutputSpoolStore.createOutputSpoolStore({ writer, reader })

    const original = await Effect.runPromise(
      store.put({ parentSkillId: "deploy-helper", chunkIndex: 0, contentHash: "hash-v1", sanitizedBody: "version one" }),
    )
    await Effect.runPromise(store.supersede(original.outputRef))
    await Effect.runPromise(store.supersede(original.outputRef))
  })
})
