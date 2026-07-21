/**
 * Feature 050 / T009-T010 (FR5, FR12) — the production `EmbeddingsHttpPort`.
 *
 * Asserts the OpenAI-compatible request/response mapping, that a `null`/empty
 * `secretRef` sends NO Authorization header while a resolved ref sends one, that
 * a server 5xx retries within the bounded data-plane policy, and that a client
 * 4xx surfaces a typed failure with NO retry (never a silent empty vector).
 */
import { describe, expect, test } from "bun:test"
import { createFetchEmbeddingsHttpClient } from "@/semantic/embeddings-http-client"

interface Capture {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

function okResponse(vectors: number[][]): Response {
  return new Response(JSON.stringify({ data: vectors.map((embedding) => ({ embedding })) }), { status: 200 })
}

function fakeFetch(handler: (capture: Capture, callIndex: number) => Response): { impl: typeof fetch; calls: Capture[] } {
  const calls: Capture[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const capture: Capture = {
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    }
    calls.push(capture)
    return handler(capture, calls.length - 1)
  }) as unknown as typeof fetch
  return { impl, calls }
}

const REQUEST = { baseUrl: "https://emb.local/", model: "qwen3-embedding-4b", inputs: ["hello"] }

describe("createFetchEmbeddingsHttpClient", () => {
  test("maps the OpenAI-compatible request/response shape", async () => {
    const { impl, calls } = fakeFetch(() => okResponse([[0.1, 0.2, 0.3]]))
    const client = createFetchEmbeddingsHttpClient({ fetchImpl: impl })
    const response = await client.postEmbeddings(REQUEST)
    expect(response.vectors).toEqual([[0.1, 0.2, 0.3]])
    expect(calls[0].url).toBe("https://emb.local/v1/embeddings")
    expect(calls[0].body).toEqual({ model: "qwen3-embedding-4b", input: ["hello"] })
  })

  test("sends no Authorization header when secretRef is empty/null", async () => {
    const { impl, calls } = fakeFetch(() => okResponse([[1]]))
    await createFetchEmbeddingsHttpClient({ fetchImpl: impl, secretRef: null }).postEmbeddings(REQUEST)
    await createFetchEmbeddingsHttpClient({ fetchImpl: impl, secretRef: "" }).postEmbeddings(REQUEST)
    expect(calls[0].headers["authorization"]).toBeUndefined()
    expect(calls[1].headers["authorization"]).toBeUndefined()
  })

  test("sends a resolved Authorization header when a secretRef is bound", async () => {
    const { impl, calls } = fakeFetch(() => okResponse([[1]]))
    const client = createFetchEmbeddingsHttpClient({
      fetchImpl: impl,
      secretRef: "keychain:emb@v1",
      resolveAuthHeader: async () => "Bearer resolved",
    })
    await client.postEmbeddings(REQUEST)
    expect(calls[0].headers["authorization"]).toBe("Bearer resolved")
  })

  test("retries a server 5xx within the bounded data-plane policy", async () => {
    const { impl, calls } = fakeFetch((_capture, index) => (index < 2 ? new Response("nope", { status: 503 }) : okResponse([[9]])))
    const response = await createFetchEmbeddingsHttpClient({ fetchImpl: impl }).postEmbeddings(REQUEST)
    expect(response.vectors).toEqual([[9]])
    expect(calls.length).toBe(3) // 1 + 2 retries then success
  })

  test("never retries a client 4xx and surfaces a typed failure", async () => {
    const { impl, calls } = fakeFetch(() => new Response("bad request", { status: 400 }))
    await expect(createFetchEmbeddingsHttpClient({ fetchImpl: impl }).postEmbeddings(REQUEST)).rejects.toBeDefined()
    expect(calls.length).toBe(1)
  })
})
