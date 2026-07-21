---
id: 019f827f-2b38-7441-b327-6febe01e1d37
number: 041
slug: silence-the-mcp-tool-schema-unknown-format-warning-flood
status: implemented
created_at: 2026-07-21T02:26:40.056528Z
---
# Feature Specification: Silence The Mcp Tool Schema Unknown Format Warning Flood

Feature: 041-silence-the-mcp-tool-schema-unknown-format-warning-flood
Created: 2026-07-21
Scope: the MCP client construction seam
(`packages/opencode/src/mcp/index.ts` — `CLIENT_OPTIONS` / `createClient`) and a new
`packages/opencode/src/mcp/schema-validator.ts` factory. Feature 008 owns the MCP
client lifecycle and the catalog `listTools` walk (`mcp/catalog.ts`). This feature
adds ONE thing: a custom JSON-schema validator injected into every MCP `Client` so the
SDK's tool-schema compile recognizes the Rust `schemars` unsigned-integer formats
instead of logging a warning per property on every connect.

## The confirmed noise

When an MCP server is enabled — or reconnected after a disable→enable — opencode calls
`McpCatalog.defs → listTools()` (`mcp/catalog.ts:46-48,172-189`). Inside
`@modelcontextprotocol/sdk` (v1.29.0) `Client.listTools()` runs `cacheToolMetadata()`,
which compiles EVERY tool's `outputSchema` via `ajv.compile(schema)`. The SDK's default
Ajv (`validation/ajv-provider.ts`: `new Ajv({ strict:false, validateFormats:true,
validateSchema:false, allErrors:true })` + `addFormats(ajv)`) registers `int32`/`int64`
(via `ajv-formats`) but NOT the unsigned formats `uint`/`uint8`/`uint16`/`uint32`/
`uint64` that Rust `schemars` emits (e.g. the ssh MCP's `size_bytes`,
`bytes_transferred`, `cols`, `rows`, `SessionEntry/port`, `SshExecuteBatchEntry/index`).
Ajv's `format` vocabulary then logs

```
unknown format "uint64" ignored in schema at path "#/properties/size_bytes"
```

once per property — walking `$defs` too — producing a flood of dozens of lines per
connect.

It is PURE LOG NOISE. `format` is annotational: `type: integer`, `required`, structure,
and any `minimum`/`maximum` are still compiled and enforced. No validation is weakened
by the missing format registration; only the log is polluted.

opencode constructs its MCP `Client` with `CLIENT_OPTIONS` (`mcp/index.ts:39-50`) inside
`createClient()` (`~:75-81`). `CLIENT_OPTIONS` set only `capabilities`, so the SDK falls
back to its noisy default Ajv. That construction seam is where the fix belongs.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A clean log on MCP connect

- As an operator, I want enabling (or reconnecting) an MCP server whose tools carry
  `uint*` output-schema formats to produce ZERO `unknown format` log lines, so the
  connect log is readable and a real warning is not buried under dozens of annotational
  no-ops.

### P1 — Validation behavior is byte-unchanged

- As an operator, I want tool-call structured-output validation to behave EXACTLY as
  before — same accepts, same rejects — so silencing the log changes nothing about what
  the SDK enforces on a tool's declared `outputSchema`.

### P2 — Genuine schema warnings still surface

- As an operator, I want a genuinely-unknown, non-integer format (a real malformed-schema
  signal) to STILL warn, so the fix silences only the known `schemars` unsigned-int noise
  and never blanket-suppresses Ajv's diagnostics.

## Functional Requirements

1. **FR1 — inject a custom MCP JSON-schema validator.** `createClient()` MUST construct
   every MCP `Client` with a `jsonSchemaValidator` in its options — the SDK's own
   `AjvJsonSchemaValidator` over a custom Ajv — instead of letting the SDK fall back to
   its default noisy Ajv.

2. **FR2 — mirror the SDK default Ajv exactly, plus the unsigned formats.** The custom
   Ajv MUST be constructed with the SAME options as the SDK default (`strict:false`,
   `validateFormats:true`, `validateSchema:false`, `allErrors:true`), MUST apply
   `addFormats(ajv)`, and MUST additionally register `uint`, `uint8`, `uint16`, `uint32`,
   `uint64` (plus `int8`/`int16` for forward-safety) as no-op formats. `int32`/`int64`
   are already provided by `ajv-formats` and MUST NOT be double-registered.

3. **FR3 — zero `unknown format` lines for schemars unsigned-int schemas.** Compiling a
   tool `outputSchema` whose integer properties carry `uint*` formats MUST emit no
   `unknown format` warning.

4. **FR4 — validation is preserved.** The injected validator MUST compile and enforce
   the schema's `type`, `required`, and numeric bounds exactly as the SDK default did;
   the accept/reject outcome for any structured tool result MUST be unchanged.

5. **FR5 — genuine unknown formats still warn.** A format that is NOT one of the
   registered no-ops (e.g. a truly-unknown `definitely-not-real` string format) MUST
   still trigger Ajv's `unknown format` warning — the diagnostic signal is preserved, not
   suppressed. `logger:false` / blanket warning suppression is explicitly rejected.

6. **FR6 — per-client validator, no shared mutable cache across servers.** A fresh
   validator (fresh Ajv) MUST be built per `createClient` call, mirroring the SDK
   default's per-client instance, so one server's compiled-schema cache never bleeds into
   another's.

## Security Requirements

- **Data sensitivity/classification.** This feature reads only the JSON `outputSchema`
  each MCP server already advertises for its tools — public tool metadata, never a
  payload, credential, or secret. It writes nothing and exposes nothing new across any
  boundary.
- **Authentication/authorization.** None. No new authenticated surface, credential, or
  permission boundary; the MCP OAuth/transport machinery (Feature 008) is untouched. The
  validator only changes how a schema is compiled, not who may connect or what a client
  may call.
- **Input validation.** The untrusted input is the server-supplied tool `outputSchema`.
  The custom Ajv compiles it with the SAME strictness knobs as the SDK default and still
  enforces `type`/`required`/bounds; registering the `schemars` integer formats as no-op
  matches how `ajv-formats` already treats `int32`/`int64` (annotational), so the change
  neither widens nor narrows what a malformed schema is allowed to be. Genuinely-unknown
  formats still warn, so a suspicious schema is still surfaced.
- **Cryptography in transit/at rest.** Not applicable — this feature moves and persists
  no data and adds no network or storage I/O; it only reconfigures an in-process schema
  compiler.
- **Logging/audit.** This feature REMOVES noise: it eliminates the per-property
  `unknown format "uintN"` warnings the SDK's Ajv emitted on every connect. It adds no
  new log line and records no sensitive material; a genuinely-unknown format still logs
  its existing, secret-free warning.
- **Error-handling information exposure.** The validator's compile/validate paths are the
  SDK's own; error text (`ajv.errorsText`) is unchanged and carries only schema-path and
  type detail, no credential or internal path. Silencing the known-format warnings
  removes log lines rather than adding any new error surface.

## Acceptance Scenarios

Given opencode constructs every MCP `Client` through `createClient()` with the injected
`jsonSchemaValidator`

- **A schemars output schema compiles silently (FR2, FR3).**
  Given a tool `outputSchema` with integer properties formatted `uint64`/`uint16`/
  `uint32`,
  When the injected validator compiles it,
  Then no `unknown format` warning is emitted and every `uint*` format is a registered
  no-op (while `int32`/`int64` remain present from `ajv-formats`).

- **Validation is byte-unchanged (FR4).**
  Given the same schema with `required` fields and a `minimum` bound,
  When structured content is validated,
  Then a conforming object is accepted and one violating `required` or the bound is
  rejected — identical to the SDK default's behavior.

- **A genuinely-unknown format still warns (FR5).**
  Given a schema property carrying a `definitely-not-real` string format,
  When the validator compiles it,
  Then Ajv still emits its `unknown format` warning — the signal is preserved.

- **A fresh validator per client (FR6).**
  Given two MCP servers connecting,
  When each `createClient` runs,
  Then each receives its own validator instance, so compiled-schema caches do not cross
  servers.

## Observability

This feature adds no new metrics, log events, or trace spans; it REMOVES the SDK's
per-property `unknown format` warnings from the MCP connect log. The MCP lifecycle events
(Feature 008) and the server-log bridge (`serverLog`, `mcp/index.ts`) are unchanged.
Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

```
createClient(directory)                                            (mcp/index.ts)
  new Client({ name, version }, { ...CLIENT_OPTIONS,
                                  jsonSchemaValidator: McpSchemaValidator.create() })
        |
        v
McpSchemaValidator.create()                             (mcp/schema-validator.ts)
  new AjvJsonSchemaValidator( createAjv() )             SDK provider over custom Ajv
  createAjv():
     new Ajv({ strict:false, validateFormats:true, validateSchema:false, allErrors:true })
     addFormats(ajv)                                    int32/int64 (unchanged)
     addFormat uint|uint8|uint16|uint32|uint64|int8|int16 -> no-op   (silence flood)
        |
        v
Client.listTools() -> cacheToolMetadata()                            (SDK, unchanged)
  jsonSchemaValidator.getValidator(tool.outputSchema)   compiles WITHOUT unknown-format spam
```

## Out of Scope

- **The catalog `listTools` walk and its output-schema-validation fallback**
  (`mcp/catalog.ts` `TolerantListToolsResultSchema`, `isOutputSchemaValidationError`) —
  that guards a DIFFERENT failure ($ref resolution) and is untouched.
- **Blanket log suppression** (`logger:false` or dropping Ajv warnings wholesale) —
  rejected; it would swallow the genuine malformed-schema signal.
- **Transport-layer schema rewriting / sanitizing** the server's advertised schema —
  rejected; the fix is confined to the client's schema compiler.
- **The MCP OAuth, transport, prompt/resource, and event surfaces** (Feature 008) — all
  untouched.

## Related Features and Decisions

- [ADR-0041 — Silence the MCP tool-schema unknown-format warning flood](../../adr/0041-silence-the-mcp-tool-schema-unknown-format-warning-flood.md)
- [Feature 008 — Add complete MCP client tools and resources lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — the MCP client lifecycle and the catalog `listTools` walk whose SDK compile emits the warnings.
- [ADR-0009 — MCP client lifecycle and content plane](../../adr/0009-mcp-client-lifecycle-and-content-plane.md) — the client-construction and catalog seams this fix injects the validator into.

## Clarifications

### Session 2026-07-21

- **The fix is a custom validator, not log suppression (FR1, FR5).** opencode injects a
  `jsonSchemaValidator` that mirrors the SDK default Ajv and adds the `schemars`
  unsigned-int formats as no-op. Blanket `logger:false` was rejected because it would hide
  genuine malformed-schema warnings; registering the specific formats silences only the
  known noise.
- **Validation is unchanged (FR4).** `format` is annotational in JSON Schema; the SDK
  already treated `int32`/`int64` as no-op via `ajv-formats`. Registering the unsigned
  widths the same way changes only the log, never what a tool's `outputSchema` accepts or
  rejects.
- **Per-client instance (FR6).** A fresh validator is built per `createClient`, matching
  the SDK default's per-client validator, so no compiled-schema cache is shared across
  distinct MCP servers.
- **`int8`/`int16` added for forward-safety (FR2).** `ajv-formats` ships `int32`/`int64`
  but not the narrower signed widths; `schemars` can emit them, so they are registered
  no-op alongside the unsigned formats. `int32`/`int64` are NOT re-registered.
