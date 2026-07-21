---
status: proposed
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0041 — opencode Injects A Custom MCP JSON-Schema Validator Recognizing schemars Unsigned-Int Formats

## Context and Problem Statement

Enabling an MCP server — or reconnecting one after a disable→enable — floods the log with
dozens of lines like:

```
unknown format "uint64" ignored in schema at path "#/properties/size_bytes"
```

The cause is upstream and benign. When opencode calls `McpCatalog.defs → listTools()`
(`mcp/catalog.ts:46-48,172-189`), `@modelcontextprotocol/sdk` (v1.29.0)
`Client.listTools()` runs `cacheToolMetadata()`, which compiles EVERY tool's
`outputSchema` via `ajv.compile(schema)`. The SDK's default Ajv
(`validation/ajv-provider.ts`: `new Ajv({ strict:false, validateFormats:true,
validateSchema:false, allErrors:true })` + `addFormats(ajv)`) registers `int32`/`int64`
(via `ajv-formats`) but NOT the unsigned integer formats `uint`/`uint8`/`uint16`/`uint32`/
`uint64` that Rust `schemars` emits (e.g. the ssh MCP's `size_bytes`, `bytes_transferred`,
`cols`, `rows`, `SessionEntry/port`, `SshExecuteBatchEntry/index`). Ajv's `format`
vocabulary logs an `unknown format` warning once per property — walking `$defs` too —
producing a flood on every connect.

It is PURE LOG NOISE. `format` is annotational in JSON Schema: `type: integer`,
`required`, structure, and any `minimum`/`maximum` are still compiled and enforced. The
missing format registration weakens NO validation; it only pollutes the log and buries
any real warning.

opencode constructs its MCP `Client` with `CLIENT_OPTIONS` (`mcp/index.ts:39-50`) inside
`createClient()` (`~:75-81`). `CLIENT_OPTIONS` set only `capabilities`, so the SDK falls
back to its noisy default Ajv. The question: how to silence the flood at that
construction seam without weakening validation and without suppressing genuine
malformed-schema warnings.

## Decision Drivers

- **Silence the noise, not the signal.** Remove the `unknown format "uintN"` flood while
  keeping Ajv's genuine `unknown format` warning for a truly-unknown format (a real
  malformed-schema diagnostic).
- **Validation must be byte-unchanged.** The accept/reject outcome for any tool's
  structured output must be identical before and after — `format` is annotational and must
  stay so.
- **Least invasive.** Change only the client-construction seam; touch neither the catalog
  `listTools` walk nor the MCP OAuth/transport/prompt/resource/event surfaces.
- **Reuse the SDK's own machinery.** Prefer the SDK's `AjvJsonSchemaValidator` provider
  over a hand-rolled `jsonSchemaValidator`, so `getValidator`/`errorsText` behavior stays
  identical — only the format vocabulary differs.
- **Forward-safe.** Cover the narrow signed widths (`int8`/`int16`) `schemars` may also
  emit, without double-registering `int32`/`int64`.

## Considered Options

- **Option A — inject a custom `jsonSchemaValidator` that registers the `schemars`
  unsigned-int formats as no-op (chosen).** `createClient()` builds each `Client` with a
  `jsonSchemaValidator` = the SDK's `AjvJsonSchemaValidator` over a custom Ajv. The custom
  Ajv mirrors the SDK default options EXACTLY, applies `addFormats(ajv)`, then registers
  `uint`/`uint8`/`uint16`/`uint32`/`uint64` (plus `int8`/`int16`) as no-op. The flood
  disappears; validation is unchanged; a genuinely-unknown format still warns.
- **Option B — pass `logger:false` (or otherwise blanket-suppress Ajv warnings).**
  Rejected: it silences ALL Ajv diagnostics, including the real `unknown format` /
  malformed-schema warnings that are a legitimate signal for a broken server schema. It
  trades a noise problem for a blind spot.
- **Option C — sanitize/rewrite the server's advertised schema at the transport layer
  (strip the `format` keyword before compile).** Rejected: it mutates the server's
  declared contract, is far broader than the problem, and risks changing validation
  semantics for schemas we did not intend to touch. The fix belongs at the client's schema
  compiler, not on the wire.

## Decision Outcome

Chosen option: **Option A**. opencode injects a custom MCP JSON-schema validator — the
SDK's `AjvJsonSchemaValidator` over an Ajv that mirrors the SDK default and additionally
recognizes the `schemars` unsigned-integer formats as no-op — at the `createClient()`
construction seam. The `unknown format "uintN"` flood disappears; tool-output validation
is byte-unchanged; genuinely-unknown formats still warn.

Key decisions recorded:

1. **A new factory, injected per client.** `mcp/schema-validator.ts` exposes `create()`
   (`new AjvJsonSchemaValidator(createAjv())`) and `createAjv()`. `createClient()` builds
   the `Client` with `{ ...CLIENT_OPTIONS, jsonSchemaValidator: McpSchemaValidator.create()
   }` — a fresh validator per call, mirroring the SDK default's per-client instance, so no
   compiled-schema cache crosses servers.
2. **The custom Ajv mirrors the SDK default exactly, plus the missing formats.**
   `new Ajv({ strict:false, validateFormats:true, validateSchema:false, allErrors:true })`
   → `addFormats(ajv)` (supplies `int32`/`int64`) → register `uint`, `uint8`, `uint16`,
   `uint32`, `uint64`, `int8`, `int16` as no-op via `addFormat(name, true)`. `int32`/`int64`
   are NOT re-registered.
3. **Validation is preserved.** Because `format` is annotational and the SDK provider's
   `getValidator`/`errorsText` are reused verbatim, `type`/`required`/bounds compile and
   enforce exactly as before; the accept/reject outcome is unchanged.
4. **The genuine-warning signal is kept.** A format that is not one of the registered
   no-ops still triggers Ajv's `unknown format` warning — blanket suppression was
   explicitly rejected.
5. **`ajv`/`ajv-formats` become direct deps of `packages/opencode`.** They are transitive
   deps of the SDK but not directly resolvable under Bun's isolated install; they are added
   at the SDK-pinned ranges (`ajv ^8.17.1`, `ajv-formats ^3.0.1`, both cache-resident). No
   other dependency changes.
6. **Everything else is untouched.** The catalog `listTools` walk and its
   `TolerantListToolsResultSchema` / `isOutputSchemaValidationError` $ref fallback, the MCP
   OAuth/transport/prompt/resource/event surfaces, and `CLIENT_OPTIONS`' capabilities are
   unchanged.

### Consequences

- Good: enabling or reconnecting an MCP server whose tools carry `uint*` output-schema
  formats no longer floods the log; the connect log is readable and real warnings are no
  longer buried.
- Good: tool-output structured-content validation is byte-for-byte identical — the change
  is annotational only.
- Good: a genuinely-unknown or malformed-schema format still warns, so the diagnostic
  signal survives.
- Neutral: `ajv`/`ajv-formats` become direct `packages/opencode` deps (at the SDK's pinned
  ranges); they were already present transitively, so the install footprint is unchanged.
- Residual: `int8`/`int16` are registered no-op for forward-safety even though the current
  ssh MCP emits only unsigned widths; if a future `ajv-formats` adds the unsigned formats
  natively the no-op registrations become redundant but remain harmless. End-to-end
  connect-log cleanliness is validated on the binary against a live schemars server; the
  unit test proves the validator contract.

## Related

- Feature specification: [041 Silence the MCP tool-schema unknown-format warning flood](../sdd/041-silence-the-mcp-tool-schema-unknown-format-warning-flood/spec.md)
- The MCP client lifecycle and the catalog `listTools` walk whose SDK compile emits the warnings: [008 Add complete MCP client tools and resources lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- The client-construction and catalog seams this fix injects the validator into: [ADR-0009 MCP client lifecycle and content plane](0009-mcp-client-lifecycle-and-content-plane.md)
