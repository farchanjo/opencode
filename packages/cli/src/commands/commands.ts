import { Argument, Flag } from "effect/unstable/cli"
import { Spec } from "../framework/spec"

declare const OPENCODE_CLI_NAME: string | undefined

export const Commands = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode", {
  description: "OpenCode 2.0 preview command line interface",
  commands: [
    Spec.make("api", {
      description: "Make a request to the running server",
      params: {
        request: Argument.string("operation | method path").pipe(
          Argument.withDescription("OpenAPI operation ID, or an HTTP method followed by a path"),
          Argument.variadic({ min: 1, max: 2 }),
        ),
        data: Flag.string("data").pipe(Flag.withAlias("d"), Flag.withDescription("Request body"), Flag.optional),
        header: Flag.string("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription("Request header in name:value form"),
          Flag.atMost(100),
        ),
        param: Flag.keyValuePair("param").pipe(Flag.withDescription("OpenAPI path or query parameter"), Flag.optional),
      },
    }),
    Spec.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [Spec.make("agents", { description: "List all agents" })],
    }),
    Spec.make("migrate", { description: "Migrate v1 data to v2" }),
    Spec.make("service", {
      description: "Manage the background server",
      commands: [
        Spec.make("start", { description: "Start the background server" }),
        Spec.make("restart", { description: "Restart the background server" }),
        Spec.make("status", { description: "Show background server status" }),
        Spec.make("stop", { description: "Stop the background server" }),
        Spec.make("password", {
          description: "Get or set the server password",
          params: { value: Argument.string("value").pipe(Argument.optional) },
        }),
      ],
    }),
    Spec.make("serve", {
      description: "Start the v2 API server",
      params: {
        hostname: Flag.string("hostname").pipe(Flag.withDefault("127.0.0.1")),
        port: Flag.integer("port").pipe(Flag.optional),
        register: Flag.boolean("register").pipe(Flag.withDefault(false)),
      },
    }),
    Spec.make("telemetry", {
      description: "Manage OpenTelemetry export (zero model calls; secrets stay redacted)",
      commands: [
        Spec.make("status", { description: "Show telemetry export status", params: { json: json() } }),
        Spec.make("show", {
          description: "Show the effective, redacted telemetry configuration",
          params: { json: json() },
        }),
        Spec.make("on", { description: "Enable telemetry export", params: { scope: scope(), json: json() } }),
        Spec.make("off", { description: "Disable telemetry export", params: { scope: scope(), json: json() } }),
        Spec.make("test", {
          description: "Emit a redacted test signal or check exporter connectivity",
          params: {
            mode: Flag.choice("mode", ["signal", "connectivity"]).pipe(
              Flag.withDescription("test mode: emit a signal or check connectivity"),
              Flag.withDefault("signal"),
            ),
            json: json(),
          },
        }),
        Spec.make("configure", {
          description: "Open the persistent telemetry configuration flow",
          params: { scope: scope(), json: json() },
        }),
      ],
    }),
    Spec.make("smart", {
      description: "Manage Smart Agent Routing activation",
      commands: [
        Spec.make("status", { description: "Show the Smart Routing indicator state", params: { json: json() } }),
        Spec.make("on", { description: "Enable Smart Routing", params: { scope: scope(), json: json() } }),
        Spec.make("off", { description: "Disable Smart Routing", params: { scope: scope(), json: json() } }),
        Spec.make("auto", {
          description: "Set Smart Routing to policy-driven auto",
          params: { scope: scope(), json: json() },
        }),
      ],
    }),
    Spec.make("routing", {
      description: "Inspect the deterministic routing engine (zero model calls)",
      commands: [
        Spec.make("status", {
          description: "Show effective routing configuration and health",
          params: { json: json() },
        }),
        Spec.make("explain", {
          description: "Explain a persisted routing decision by id",
          params: {
            decisionId: Argument.string("decisionId").pipe(Argument.withDescription("persisted routing decision id")),
            json: json(),
          },
        }),
        Spec.make("test", {
          description: "Run a deterministic local routing simulation (no external model call)",
          params: {
            task: Argument.string("task").pipe(Argument.withDescription("task description to simulate")),
            scope: scope(),
            json: json(),
          },
        }),
        Spec.make("capability", {
          description: "Inspect tool-call capability metadata",
          commands: [
            Spec.make("inspect", {
              description: "Inspect redacted capability records for one or all candidates",
              params: {
                modelId: Argument.string("modelId").pipe(
                  Argument.withDescription("model id to inspect; omit for all candidates"),
                  Argument.optional,
                ),
                json: json(),
              },
            }),
          ],
        }),
      ],
    }),
    Spec.make("process", {
      description:
        "Observe and control lifecycle processes (Feature 002 Task Lifecycle Engine; zero model calls, redacted rows)",
      commands: [
        Spec.make("status", {
          description: "Show redacted single-process status: attempt, owner, model, timing, cost",
          params: { processId: processIdArg(), json: json() },
        }),
        Spec.make("tree", {
          description: "Show the authorized process tree for a root process (direct children per level)",
          params: {
            rootProcessId: Argument.string("rootProcessId").pipe(Argument.withDescription("root process id")),
            session: Flag.string("session").pipe(
              Flag.withDescription("scope the tree to one session's direct-child view"),
              Flag.optional,
            ),
            json: json(),
          },
        }),
        Spec.make("watch", {
          description: "Watch one process until it reaches a terminal state (bounded polling)",
          params: {
            processId: processIdArg(),
            interval: pollIntervalFlag(),
            maxPolls: maxPollsFlag(),
            json: json(),
          },
        }),
        Spec.make("cancel", {
          description: "Request native cancellation of one process",
          params: { processId: processIdArg(), reason: reasonFlag(), json: json() },
        }),
        Spec.make("steer", {
          description: "Send a steering instruction to a running process",
          params: {
            processId: processIdArg(),
            instruction: Argument.string("instruction").pipe(
              Argument.withDescription("bounded steering instruction text"),
            ),
            json: json(),
          },
        }),
        Spec.make("handoff", {
          description: "Hand off one process to another session (single-owner durable handoff)",
          params: {
            processId: processIdArg(),
            targetSessionId: Argument.string("targetSessionId").pipe(
              Argument.withDescription("destination session id"),
            ),
            reason: reasonFlag(),
            json: json(),
          },
        }),
      ],
    }),
    Spec.make("task", {
      description:
        "Observe and control logical Tasks (Feature 002 Task Lifecycle Engine; resolves to process_id/attempt/generation set; zero model calls)",
      commands: [
        Spec.make("status", {
          description: "Show redacted status for the current attempt of one Task",
          params: { taskId: taskIdArg(), json: json() },
        }),
        Spec.make("tree", {
          description: "Show the authorized process tree rooted at one Task's current attempt",
          params: {
            taskId: taskIdArg(),
            session: Flag.string("session").pipe(
              Flag.withDescription("scope the tree to one session's direct-child view"),
              Flag.optional,
            ),
            json: json(),
          },
        }),
        Spec.make("watch", {
          description: "Watch one Task until its current attempt reaches a terminal state (bounded polling)",
          params: {
            taskId: taskIdArg(),
            interval: pollIntervalFlag(),
            maxPolls: maxPollsFlag(),
            json: json(),
          },
        }),
        Spec.make("cancel", {
          description: "Request native cancellation of one Task's current attempt",
          params: { taskId: taskIdArg(), reason: reasonFlag(), json: json() },
        }),
      ],
    }),
  ],
})

function json() {
  return Flag.boolean("json").pipe(
    Flag.withDescription("emit the typed operator envelope as JSON on stdout only"),
    Flag.withDefault(false),
  )
}

function scope() {
  return Flag.choice("scope", ["global", "project"]).pipe(
    Flag.withDescription("configuration scope: global or the current project"),
    Flag.withDefault("global"),
  )
}

function processIdArg() {
  return Argument.string("processId").pipe(Argument.withDescription("process attempt id (never an OS PID)"))
}

function taskIdArg() {
  return Argument.string("taskId").pipe(Argument.withDescription("logical Task id"))
}

function reasonFlag() {
  return Flag.string("reason").pipe(Flag.withDescription("bounded operator-supplied reason"), Flag.optional)
}

function pollIntervalFlag() {
  return Flag.integer("interval").pipe(
    Flag.withDescription("poll interval in milliseconds (bounded, degrade path pending a push-stream transport)"),
    Flag.optional,
  )
}

function maxPollsFlag() {
  return Flag.integer("max-polls").pipe(Flag.withDescription("maximum number of polls before giving up"), Flag.optional)
}
