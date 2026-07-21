# Tasks: Silence The Mcp Tool Schema Unknown Format Warning Flood

## Task Breakdown

- [x] T001 Confirm the root cause by reading the code and the installed SDK:
  `McpCatalog.defs → listTools()` (`mcp/catalog.ts:46-48,172-189`) triggers the SDK's
  `cacheToolMetadata()`, which compiles every tool `outputSchema` via the default Ajv
  (`@modelcontextprotocol/sdk` v1.29.0 `validation/ajv-provider.ts`: `strict:false,
  validateFormats:true, validateSchema:false, allErrors:true` + `addFormats`). That Ajv
  registers `int32`/`int64` but NOT `schemars`' `uint`/`uint8`/`uint16`/`uint32`/`uint64`,
  so Ajv logs `unknown format "uintN" ignored ...` once per property. `CLIENT_OPTIONS`
  (`mcp/index.ts:39-50`) sets only `capabilities`, so the SDK falls back to that Ajv.
- [x] T002 Confirm the import surface: `@modelcontextprotocol/sdk/validation/ajv` exports
  `AjvJsonSchemaValidator` whose constructor accepts a preconfigured Ajv;
  `ClientOptions.jsonSchemaValidator` is a first-class SDK option consumed per-client by
  `cacheToolMetadata`. Add `ajv` (`^8.17.1`) + `ajv-formats` (`^3.0.1`) as DIRECT deps of
  `packages/opencode/package.json` (SDK-pinned, cache-resident) so they resolve under
  Bun's isolated install; `bun install`. (FR1)
- [x] T003 Part 1 — add `packages/opencode/src/mcp/schema-validator.ts`: `createAjv()`
  mirrors the SDK default Ajv options, runs `addFormats(ajv)`, then registers `uint`,
  `uint8`, `uint16`, `uint32`, `uint64`, `int8`, `int16` as no-op (`addFormat(name,
  true)`); `int32`/`int64` are NOT re-registered. `create()` returns
  `new AjvJsonSchemaValidator(createAjv())`. (FR2, FR3, FR4)
- [x] T004 Part 2 — inject at construction in `mcp/index.ts` `createClient()`: build the
  `Client` with `{ ...CLIENT_OPTIONS, jsonSchemaValidator: McpSchemaValidator.create() }`,
  a fresh validator per call (per-client, mirroring the SDK default). `CLIENT_OPTIONS` is
  otherwise unchanged; every connect/reconnect/auth path funnels through `createClient`.
  (FR1, FR6)
- [x] T005 Confirm the untouched invariants: the catalog `listTools` walk and its
  `TolerantListToolsResultSchema` / `isOutputSchemaValidationError` $ref fallback
  (`mcp/catalog.ts`) are unchanged; no `logger:false` / blanket suppression; the MCP
  OAuth/transport/prompt/resource/event surfaces (Feature 008) are untouched. (FR5)
- [x] T006 Add the test `packages/opencode/test/mcp/schema-validator.test.ts`: uint*
  (and int8/int16) formats registered while int32/int64 remain (FR2); compiling a
  schemars-style `outputSchema` emits NO `unknown format` warning via a captured Ajv
  logger (FR3); a conforming object validates true and a `minimum`/`required` violation
  validates false (FR4); a genuinely-unknown `definitely-not-real` format STILL warns
  (FR5). No existing MCP test weakened.
- [x] T007 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0041-silence-the-mcp-tool-schema-unknown-format-warning-flood.md`; add the Feature
  041 scope block to `doc/arch/speckit.toml` (only new glob:
  `packages/opencode/package.json`; the `mcp/**` + `test/mcp/**` seams are already in
  scope from Feature 008). Leave the gates green (`bun test test/mcp/`, `bunx tsgo
  --noEmit`, `speckit validate`, `speckit analyze`).

## Dependencies

- Feature 008 (the MCP client lifecycle + the catalog `listTools` walk) — the seams this
  feature injects the validator into; already shipped.
- `@modelcontextprotocol/sdk` v1.29.0 — the `AjvJsonSchemaValidator` provider and the
  `ClientOptions.jsonSchemaValidator` option this feature reuses; already a direct dep.

## Residuals

- The end-to-end connect-log cleanliness (enable the ssh MCP → zero `unknown format`
  lines) is validated against a live schemars server on the binary; the unit test proves
  the validator contract (format registration, silent compile, unchanged validation,
  preserved genuine-warning signal) that guarantees it.
- `int8`/`int16` are registered no-op for forward-safety even though the current ssh MCP
  emits only unsigned widths; if a future `ajv-formats` release adds the unsigned formats
  natively, the no-op registrations become redundant but remain harmless.
