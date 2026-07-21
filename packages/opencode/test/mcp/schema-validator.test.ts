import { describe, expect, test } from "bun:test"
import { McpSchemaValidator } from "@/mcp/schema-validator"

// The schemars unsigned/narrow integer formats the ssh MCP (and any Rust
// schemars server) stamps on tool output-schema properties. The SDK's default
// Ajv logs `unknown format "uintN" ignored ...` once per property on every
// connect; the custom validator registers them as no-op to silence that flood.
const SCHEMARS_FORMATS = ["uint", "uint8", "uint16", "uint32", "uint64", "int8", "int16"]

// A representative ssh-MCP tool output schema: integer properties carry uint*
// formats and enforce bounds/required that MUST survive the format no-op.
const SCHEMARS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    size_bytes: { type: "integer", format: "uint64" },
    cols: { type: "integer", format: "uint16", minimum: 1 },
    index: { type: "integer", format: "uint32" },
  },
  required: ["size_bytes", "cols"],
} as const

/** Capture Ajv's logger.warn output while running `fn`, restoring it after. */
function captureAjvWarnings(ajv: { logger?: { warn: (...a: unknown[]) => void } }, fn: () => void) {
  const warnings: string[] = []
  const logger = ajv.logger ?? console
  const original = logger.warn
  logger.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "))
  }
  try {
    fn()
  } finally {
    logger.warn = original
  }
  return warnings
}

describe("McpSchemaValidator", () => {
  test("registers every schemars unsigned-int format (the SDK default does not)", () => {
    const custom = McpSchemaValidator.createAjv()
    for (const format of SCHEMARS_FORMATS) {
      expect(Boolean(custom.formats[format])).toBe(true)
    }
    // int32/int64 come from ajv-formats and must remain present (not double-registered).
    expect(Boolean(custom.formats.int32)).toBe(true)
    expect(Boolean(custom.formats.int64)).toBe(true)
  })

  test("compiling a schemars output schema emits NO unknown-format warning", () => {
    const ajv = McpSchemaValidator.createAjv()
    const warnings = captureAjvWarnings(ajv, () => {
      ajv.compile(SCHEMARS_OUTPUT_SCHEMA)
    })
    expect(warnings.filter((line) => /unknown format/i.test(line))).toEqual([])
  })

  test("validation is byte-unchanged: bounds/required still compile and enforce", () => {
    const validate = McpSchemaValidator.create().getValidator(SCHEMARS_OUTPUT_SCHEMA)
    expect(validate({ size_bytes: 4096, cols: 80, index: 0 }).valid).toBe(true)
    // `minimum: 1` on cols still rejects; a missing required field still rejects.
    expect(validate({ size_bytes: 4096, cols: 0 }).valid).toBe(false)
    expect(validate({ cols: 80 }).valid).toBe(false)
  })

  test("a genuinely-unknown non-integer format still warns (signal preserved)", () => {
    const ajv = McpSchemaValidator.createAjv()
    const warnings = captureAjvWarnings(ajv, () => {
      ajv.compile({ type: "object", properties: { x: { type: "string", format: "definitely-not-real" } } })
    })
    expect(warnings.some((line) => /unknown format "definitely-not-real"/i.test(line))).toBe(true)
  })
})
