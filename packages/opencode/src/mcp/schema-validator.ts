import Ajv from "ajv"
import addFormats from "ajv-formats"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"

/**
 * Unsigned/narrow integer `format`s that Rust `schemars` stamps on tool output
 * schemas (e.g. the ssh MCP's `size_bytes`, `cols`, `port`) but that `ajv-formats`
 * does NOT register. `int32`/`int64` already ship with `ajv-formats`, so only the
 * missing widths are added here.
 */
const SCHEMARS_INTEGER_FORMATS = ["uint", "uint8", "uint16", "uint32", "uint64", "int8", "int16"] as const

/**
 * Build an Ajv mirroring the MCP SDK default instance
 * (`@modelcontextprotocol/sdk/validation/ajv`) plus the schemars integer formats
 * registered as no-op. `format` is annotational: registering these silences the
 * per-property `unknown format "uintN" ignored` warning the SDK floods on every MCP
 * connect WITHOUT weakening validation — `type`, `required`, and `minimum`/`maximum`
 * still compile and enforce. Any genuinely-unknown format still warns (signal kept).
 */
export function createAjv(): Ajv {
  const ajv = new Ajv({ strict: false, validateFormats: true, validateSchema: false, allErrors: true })
  addFormats(ajv)
  for (const format of SCHEMARS_INTEGER_FORMATS) ajv.addFormat(format, true)
  return ajv
}

/**
 * The JSON-schema validator opencode injects into every MCP `Client` so the SDK
 * compiles tool output schemas over the format-aware Ajv above. A fresh instance is
 * built per client, mirroring the SDK default's per-client validator.
 */
export function create(): AjvJsonSchemaValidator {
  return new AjvJsonSchemaValidator(createAjv())
}

export * as McpSchemaValidator from "./schema-validator"
