import { Argument, Flag } from "effect/unstable/cli"
import { Spec } from "../framework/spec"

declare const OPENCODE_CLI_NAME: string | undefined

// -- jobs (Feature 003) closed choice sets, declared before first use --------

const ACTION_TYPES = [
  "native_maintenance",
  "operator_notification",
  "wake_or_structured_input",
  "smart_routing_dispatch",
  "approved_workflow",
] as const

const OVERLAP_POLICIES = ["allow", "forbid", "queue", "replace"] as const

const MISFIRE_POLICIES = ["skip", "fire_once", "bounded_catch_up", "coalesce"] as const

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
    Spec.make("jobs", {
      description:
        "Manage persistent Bun-native scheduled jobs (Feature 003; native operator-only, zero model calls, redacted/versioned output)",
      commands: [
        Spec.make("list", {
          description: "List redacted Job Definitions with enabled and registration state",
          params: {
            scope: scope(),
            enabledOnly: Flag.boolean("enabled-only").pipe(
              Flag.withDescription("show only enabled definitions"),
              Flag.withDefault(false),
            ),
            limit: jobsLimitFlag(),
            cursor: jobsCursorFlag(),
            json: json(),
          },
        }),
        Spec.make("status", {
          description: "Show Job Definition status: next due, last outcome, registration state",
          params: { jobDefinitionId: jobDefinitionIdArg(), json: json() },
        }),
        Spec.make("show", {
          description: "Show the full redacted Job Definition plus occurrence history",
          params: {
            jobDefinitionId: jobDefinitionIdArg(),
            occurrenceLimit: Flag.integer("occurrence-limit").pipe(
              Flag.withDescription("maximum occurrences to return"),
              Flag.optional,
            ),
            json: json(),
          },
        }),
        Spec.make("create", {
          description: "Create a Job Definition (CAS, scope, audit)",
          params: {
            name: Argument.string("name").pipe(Argument.withDescription("Job Definition name")),
            description: Flag.string("description").pipe(
              Flag.withDescription("Job Definition description"),
              Flag.optional,
            ),
            cron: cronFlag(),
            timezone: timezoneFlag(),
            actionType: actionTypeFlag(),
            overlapPolicy: overlapPolicyFlag(),
            misfirePolicy: misfirePolicyFlag(),
            payloadRef: payloadRefFlag(),
            scope: scope(),
            json: json(),
          },
        }),
        Spec.make("update", {
          description: "Update a Job Definition (version/CAS)",
          params: {
            jobDefinitionId: jobDefinitionIdArg(),
            expectedVersion: expectedVersionFlag(),
            name: Flag.string("name").pipe(Flag.withDescription("new Job Definition name"), Flag.optional),
            description: Flag.string("description").pipe(
              Flag.withDescription("new Job Definition description"),
              Flag.optional,
            ),
            cron: cronFlag().pipe(Flag.optional),
            timezone: timezoneFlag().pipe(Flag.optional),
            actionType: actionTypeFlag().pipe(Flag.optional),
            overlapPolicy: Flag.choice("overlap-policy", OVERLAP_POLICIES).pipe(
              Flag.withDescription("overlap policy"),
              Flag.optional,
            ),
            misfirePolicy: Flag.choice("misfire-policy", MISFIRE_POLICIES).pipe(
              Flag.withDescription("misfire policy"),
              Flag.optional,
            ),
            payloadRef: payloadRefFlag().pipe(Flag.optional),
            scope: scope(),
            json: json(),
          },
        }),
        Spec.make("enable", {
          description: "Enable a Job Definition and register it (idempotent)",
          params: { jobDefinitionId: jobDefinitionIdArg(), expectedVersion: expectedVersionFlag(), json: json() },
        }),
        Spec.make("disable", {
          description: "Disable a Job Definition and unregister it; never a silent kill of mutating work",
          params: { jobDefinitionId: jobDefinitionIdArg(), expectedVersion: expectedVersionFlag(), json: json() },
        }),
        Spec.make("delete", {
          description: "Delete a Job Definition plus compensating unregister",
          params: { jobDefinitionId: jobDefinitionIdArg(), expectedVersion: expectedVersionFlag(), json: json() },
        }),
        Spec.make("reschedule", {
          description: "Change a Job Definition's schedule; re-register intent",
          params: {
            jobDefinitionId: jobDefinitionIdArg(),
            expectedVersion: expectedVersionFlag(),
            cron: cronFlag(),
            timezone: timezoneFlag(),
            json: json(),
          },
        }),
        Spec.make("run-now", {
          description: "Create a normal occurrence through admission, routing, and permissions; starts no LLM turn",
          params: { jobDefinitionId: jobDefinitionIdArg(), json: json() },
        }),
        Spec.make("history", {
          description: "Show redacted occurrence and notification history for one Job Definition",
          params: {
            jobDefinitionId: jobDefinitionIdArg(),
            limit: jobsLimitFlag(),
            cursor: jobsCursorFlag(),
            json: json(),
          },
        }),
        Spec.make("watch", {
          description:
            "Show the current Job Definition frame over the observation surface (bounded snapshot; live streaming is a TUI surface)",
          params: { jobDefinitionId: jobDefinitionIdArg(), json: json() },
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

// -- jobs (Feature 003) command params ---------------------------------------

function jobDefinitionIdArg() {
  return Argument.string("jobDefinitionId").pipe(Argument.withDescription("durable Job Definition id"))
}

function expectedVersionFlag() {
  return Flag.integer("expected-version").pipe(Flag.withDescription("expected Job Definition version (CAS)"))
}

function cronFlag() {
  return Flag.string("cron").pipe(Flag.withDescription("5-field cron expression"))
}

function timezoneFlag() {
  return Flag.string("timezone").pipe(Flag.withDescription("IANA timezone"))
}

function actionTypeFlag() {
  return Flag.choice("action-type", ACTION_TYPES).pipe(Flag.withDescription("target/action category"))
}

function overlapPolicyFlag() {
  return Flag.choice("overlap-policy", OVERLAP_POLICIES).pipe(
    Flag.withDescription("overlap policy"),
    Flag.withDefault("forbid"),
  )
}

function misfirePolicyFlag() {
  return Flag.choice("misfire-policy", MISFIRE_POLICIES).pipe(
    Flag.withDescription("misfire policy"),
    Flag.withDefault("skip"),
  )
}

function payloadRefFlag() {
  return Flag.string("payload-ref").pipe(Flag.withDescription("secure payload reference (never a raw secret)"))
}

function jobsLimitFlag() {
  return Flag.integer("limit").pipe(Flag.withDescription("maximum rows to return"), Flag.optional)
}

function jobsCursorFlag() {
  return Flag.string("cursor").pipe(Flag.withDescription("pagination cursor from a prior page"), Flag.optional)
}
