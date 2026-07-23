import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { spawn } from "node:child_process"

if (process.argv.includes("--hang")) {
  const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
  if (!pidFile) throw new Error("MCP_LIFECYCLE_PID_FILE is required")
  await Bun.write(pidFile, String(process.pid))
  await new Promise(() => {})
}

/** Parent MCP process + one long-lived child — used to assert disconnect kills the tree. */
if (process.argv.includes("--spawn-child")) {
  const pidFile = process.env.MCP_LIFECYCLE_PID_FILE
  if (!pidFile) throw new Error("MCP_LIFECYCLE_PID_FILE is required")
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], {
    stdio: "ignore",
    detached: false,
  })
  if (!child.pid) throw new Error("failed to spawn child")
  await Bun.write(pidFile, `${process.pid}\n${child.pid}`)
}

const server = new Server({ name: "mcp-lifecycle-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, () =>
  Promise.resolve({
    tools: [
      {
        name: "current_directory",
        description: process.cwd(),
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
