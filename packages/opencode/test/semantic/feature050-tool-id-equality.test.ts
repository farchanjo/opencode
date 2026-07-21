/**
 * Feature 050 / T027 (FR11, AC6) — the tool-id equality invariant.
 *
 * Index-time `ToolDoc.id` (`ToolProjection.project`, `tool-projection.ts:140-160`,
 * which stamps `doc.id = input.toolId` verbatim) MUST equal the runtime tool
 * record key for all three tool classes:
 *
 *   - native/custom file tools — `registry.ts:191`'s
 *     `id === "default" ? namespace : `${namespace}_${id}`` composition over a
 *     `tool/tools/*.ts` module's named exports (the pattern `registry.tools()`
 *     items carry as their `Tool.Def.id`);
 *   - plugin tools — `plugin.list()` entries register under their OWN raw id
 *     (`registry.ts` `custom.push(fromPlugin(id, def))`, no namespace prefix);
 *   - MCP tools — `mcp.tools()`'s record key, `McpCatalog.toolName(clientName,
 *     name)` (`mcp/catalog.ts:127`), imported directly here (not reimplemented)
 *     so a future change to the sanitize/compose rule fails this test instead
 *     of silently drifting from the index side.
 *
 * A mismatch here would make the enabled tool surface drop everything once
 * Feature 051 wires narrowing (FR11's stated failure mode) — this test is the
 * structural guard against that regression.
 */
import { describe, expect, test } from "bun:test"
import type { ToolProjectionInput } from "@opencode-ai/protocol/semantic/commands"
import { ToolProjection } from "@/semantic/tool-projection"
import { McpCatalog } from "@/mcp/catalog"

const scope = (projectId: string): ToolProjectionInput["scope"] =>
  ({
    project_id: projectId,
    scope: "project" as const,
    visibility: "project" as const,
    permission_ref: `perm:${projectId}`,
  }) as unknown as ToolProjectionInput["scope"]

/** `registry.ts:191`'s custom-file id composition — a NAMED export composes `${namespace}_${id}`; a `default` export IS the namespace. */
const customFileToolId = (namespace: string, exportName: string): string =>
  exportName === "default" ? namespace : `${namespace}_${exportName}`

const projectTool = (input: Pick<ToolProjectionInput, "source" | "toolId" | "mcpServerRef">) =>
  ToolProjection.project({
    displayName: input.toolId,
    rawDescription: `description for ${input.toolId}`,
    rawParameterSchema: { properties: { path: { type: "string", description: "the path" } } },
    scope: scope("proj-1"),
    languageTag: "en-US",
    ...input,
  })

describe("Feature 050 tool-id equality — native/custom file tools (FR11, AC6)", () => {
  test("a named export's composed id matches the index-time ToolDoc.id", () => {
    const namespace = "billing"
    const exportName = "createInvoice"
    const runtimeId = customFileToolId(namespace, exportName) // registry.ts:191 composition
    expect(runtimeId).toBe("billing_createInvoice")

    const doc = projectTool({ source: "native", toolId: runtimeId }).doc
    expect(String(doc.id)).toBe(runtimeId)
  })

  test("a `default` export's id IS the bare namespace (no `_default` suffix) and matches ToolDoc.id", () => {
    const namespace = "weather"
    const runtimeId = customFileToolId(namespace, "default")
    expect(runtimeId).toBe("weather")

    const doc = projectTool({ source: "custom", toolId: runtimeId }).doc
    expect(String(doc.id)).toBe(runtimeId)
  })
})

describe("Feature 050 tool-id equality — plugin tools (FR11, AC6)", () => {
  test("a plugin tool's raw registration id (no namespace prefix) matches the index-time ToolDoc.id", () => {
    // registry.ts: `for (const [id, def] of Object.entries(p.tool ?? {})) { ... custom.push(fromPlugin(id, def)) }`
    // — the plugin-declared key IS the runtime id, verbatim, never namespaced.
    const runtimeId = "review_pull_request"
    const doc = projectTool({ source: "plugin", toolId: runtimeId }).doc
    expect(String(doc.id)).toBe(runtimeId)
  })
})

describe("Feature 050 tool-id equality — MCP tools (FR11, AC6)", () => {
  test("mcp.tools()'s record key (McpCatalog.toolName, server-prefixed) matches the index-time ToolDoc.id", () => {
    const clientName = "github"
    const toolName = "create_issue"
    // The SAME function `mcp/index.ts`'s `tools()` calls (via `toolNameIfAllowed`)
    // to key its record — imported directly, never reimplemented, so a future
    // sanitize-rule change fails THIS test rather than silently drifting.
    const runtimeKey = McpCatalog.toolName(clientName, toolName)
    expect(runtimeKey).toBe("github_create_issue")

    const doc = projectTool({ source: "mcp", toolId: runtimeKey, mcpServerRef: clientName }).doc
    expect(String(doc.id)).toBe(runtimeKey)
  })

  test("a client name carrying reserved characters is sanitized identically on both sides", () => {
    const clientName = "acme:prod.server"
    const toolName = "list items!"
    const runtimeKey = McpCatalog.toolName(clientName, toolName)
    expect(runtimeKey).toBe("acme_prod_server_list_items_")

    const doc = projectTool({ source: "mcp", toolId: runtimeKey, mcpServerRef: clientName }).doc
    expect(String(doc.id)).toBe(runtimeKey)
  })
})

describe("Feature 050 tool-id equality — cross-class collisions never conflate distinct tools (FR11)", () => {
  test("three distinct classes with distinct composed ids never collapse to the same ToolDoc.id", () => {
    const nativeDoc = projectTool({ source: "native", toolId: customFileToolId("billing", "createInvoice") }).doc
    const pluginDoc = projectTool({ source: "plugin", toolId: "review_pull_request" }).doc
    const mcpDoc = projectTool({ source: "mcp", toolId: McpCatalog.toolName("github", "create_issue"), mcpServerRef: "github" }).doc

    const ids = [nativeDoc.id, pluginDoc.id, mcpDoc.id]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
