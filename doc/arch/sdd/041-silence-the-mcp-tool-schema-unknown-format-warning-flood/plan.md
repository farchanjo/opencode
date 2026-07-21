# Implementation Plan: Silence The Mcp Tool Schema Unknown Format Warning Flood

## Overview

Enabling (or reconnecting) an MCP server floods the log with dozens of
`unknown format "uintN" ignored in schema at path "#/properties/..."` lines. The cause
is upstream and benign: `@modelcontextprotocol/sdk` (v1.29.0) compiles every tool's
`outputSchema` through a default Ajv (`validation/ajv-provider.ts`) that registers
`int32`/`int64` via `ajv-formats` but NOT the unsigned formats `uint`/`uint8`/`uint16`/
`uint32`/`uint64` that Rust `schemars` emits (the ssh MCP's `size_bytes`, `cols`, `port`,
…). Ajv's `format` vocabulary is annotational, so the missing registration weakens
NOTHING — it only logs. opencode builds its `Client` with `CLIENT_OPTIONS`
(`mcp/index.ts`) which sets only `capabilities`, so the SDK falls back to that noisy Ajv.
This plan injects a custom `jsonSchemaValidator` at the client-construction seam that
mirrors the SDK default Ajv and registers the `schemars` integer formats as no-op —
silencing the flood while keeping validation byte-unchanged and preserving genuine
malformed-schema warnings.

## Technical Approach

One new factory module; one construction seam changed.

- **Part 1 — the validator factory
  (`packages/opencode/src/mcp/schema-validator.ts`, new).**
  - `createAjv()` builds `new Ajv({ strict:false, validateFormats:true,
    validateSchema:false, allErrors:true })` — the EXACT options the SDK default uses —
    then `addFormats(ajv)` (which supplies `int32`/`int64`), then registers `uint`,
    `uint8`, `uint16`, `uint32`, `uint64`, `int8`, `int16` as no-op via
    `ajv.addFormat(name, true)`. `int32`/`int64` are NOT re-registered (already present).
    (FR2, FR3)
  - `create()` returns `new AjvJsonSchemaValidator(createAjv())` — the SDK's own provider
    class (`@modelcontextprotocol/sdk/validation/ajv`), which accepts a preconfigured Ajv
    and satisfies the `jsonSchemaValidator` interface (`getValidator`) the `Client`
    expects. Reusing the SDK provider means the `getValidator`/`errorsText` behavior is
    identical to the default — only the format vocabulary differs. (FR1, FR4)

- **Part 2 — inject at construction
  (`packages/opencode/src/mcp/index.ts`, `createClient`).**
  - `createClient()` builds the `Client` with `{ ...CLIENT_OPTIONS, jsonSchemaValidator:
    McpSchemaValidator.create() }`. A fresh validator (fresh Ajv) per call mirrors the SDK
    default's per-client instance, so no compiled-schema cache is shared across servers.
    `CLIENT_OPTIONS` (capabilities/roots) is otherwise unchanged. (FR1, FR6)
  - Every connect path already funnels through `createClient` (`connectTransport`,
    `startAuth`), so both the initial-connect and the reconnect/auth flows inherit the
    validator with no further change.

## Import resolution (confirmed against the installed SDK)

- `@modelcontextprotocol/sdk/validation/ajv` is a real package export
  (`package.json#exports["./validation/ajv"]`) resolving to
  `dist/esm/validation/ajv-provider.js`; it exports `class AjvJsonSchemaValidator`, whose
  constructor accepts an optional preconfigured Ajv (`this._ajv = ajv ?? default`) — so a
  custom Ajv CAN be injected without reimplementing the `jsonSchemaValidator` interface.
- `ajv` (`^8.17.1`) and `ajv-formats` (`^3.0.1`) are transitive deps of the SDK but were
  NOT directly resolvable from `packages/opencode` under Bun's isolated install. They are
  added as DIRECT deps of `packages/opencode/package.json` (matching the SDK's pinned
  ranges, already in the cache) so `import Ajv from "ajv"` / `import addFormats from
  "ajv-formats"` resolve. This is the only dependency change.
- `ClientOptions.jsonSchemaValidator?: jsonSchemaValidator` is a first-class SDK option
  (`client/index.d.ts`); the SDK stores it per-client
  (`this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator()`)
  and calls `getValidator(tool.outputSchema)` from `cacheToolMetadata` — the exact compile
  seam that emits the warnings.

## Testing (FR2–FR6)

- `packages/opencode/test/mcp/schema-validator.test.ts` (new):
  - the custom Ajv registers every `uint*` (and `int8`/`int16`) format, and still carries
    `int32`/`int64` from `ajv-formats` (FR2);
  - compiling a representative ssh-MCP `outputSchema` (integer props formatted
    `uint64`/`uint16`/`uint32`, with `required` and a `minimum`) emits NO `unknown format`
    warning — captured by temporarily intercepting Ajv's logger (FR3);
  - validation is byte-unchanged: a conforming object validates true; a `minimum`
    violation and a missing `required` field both validate false (FR4);
  - a genuinely-unknown `definitely-not-real` format STILL emits the `unknown format`
    warning (signal preserved) (FR5).
- No existing MCP test is weakened; the full `test/mcp/` suite stays green.

## Companion Artifacts

No companion files are required: this feature injects a validator at an existing client
seam and adds no new entity, external contract, or integration. The optional
`research.md` / `data-model.md` / `contracts/` / `quickstart.md` are intentionally
omitted (the Domain Model section in `spec.md` carries the flow); the `.feature` / `.cue`
scaffolds follow the 024–040 convention.
