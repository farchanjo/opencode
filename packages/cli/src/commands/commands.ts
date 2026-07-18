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

// -- output (Feature 005) closed choice sets, declared before first use ------

const QUOTA_SCOPES = ["global", "root", "session", "process", "channel"] as const

// -- semantic (Feature 006) closed choice sets, declared before first use ----

const SEMANTIC_RESIDENCY = ["local-offline", "local", "remote"] as const
const SEMANTIC_CAPABILITY_KINDS = ["embedding", "reranker", "embedding-similarity", "multilingual"] as const
const SEMANTIC_ENDPOINT_MODES = ["embeddings", "rerank", "chat-completions"] as const
const SEMANTIC_RERANK_PROFILES = ["native-rerank", "structured-chat", "embedding-similarity"] as const
const SEMANTIC_COLLECTIONS = ["agents", "skills", "skill_chunks", "tools"] as const
const SEMANTIC_SLOTS = ["embedding", "reranker"] as const

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
    Spec.make("langlock", {
      description:
        "Manage the configurable artifact language lock (Feature 004; native operator-only, zero model calls, redacted/versioned output)",
      commands: [
        Spec.make("status", {
          description: "Show the effective Lang Lock policy: tag, scope, origin, enforcement mode",
          params: { scope: scope(), json: json() },
        }),
        Spec.make("show", {
          description: "Show the effective Lang Lock policy (show-effective alias of status)",
          params: { scope: scope(), json: json() },
        }),
        Spec.make("set", {
          description: "Set the Lang Lock artifact language tag (canonical BCP 47, CAS, scope, audit)",
          params: {
            tag: Argument.string("tag").pipe(
              Argument.withDescription("canonical BCP 47 allowlisted artifact language tag"),
            ),
            expectedVersion: langLockExpectedVersionFlag(),
            scope: scope(),
            json: json(),
          },
        }),
        Spec.make("reset", {
          description: "Reset the Lang Lock policy to the global default (CAS, scope, audit)",
          params: { expectedVersion: langLockExpectedVersionFlag(), scope: scope(), json: json() },
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
    Spec.make("output", {
      description:
        "Inspect and manage the canonical OutputSpool paged content plane (Feature 005; native operator-only, zero model calls, no path exposure)",
      commands: [
        Spec.make("stat", {
          description: "Show the content-free read model for one OutputRef: state, committed bytes, provenance",
          params: { outputRef: outputRefArg(), json: json() },
        }),
        Spec.make("read", {
          description: "Read a UTF-8-safe bounded page at a byte offset (server-capped limit)",
          params: {
            outputRef: outputRefArg(),
            offset: outputOffsetFlag(),
            limit: outputLimitFlag(),
            json: json(),
          },
        }),
        Spec.make("follow", {
          description: "Resume a bounded, fencing-aware follow from an opaque cursor (stable expired/invalid_cursor on a stale token)",
          params: {
            cursor: outputCursorArg(),
            interval: pollIntervalFlag(),
            maxPolls: maxPollsFlag(),
            json: json(),
          },
        }),
        Spec.make("release", {
          description: "Drop one holder reference edge for an OutputRef (admin, audit)",
          params: { outputRef: outputRefArg(), json: json() },
        }),
        Spec.make("delete", {
          description: "Explicitly delete one OutputRef's group (admin, CAS, audit)",
          params: { outputRef: outputRefArg(), expectedVersion: outputExpectedVersionFlag(), json: json() },
        }),
        Spec.make("purge", {
          description: "Explicit legal-hold-aware purge of one OutputRef's group (admin, CAS, audit)",
          params: { outputRef: outputRefArg(), expectedVersion: outputExpectedVersionFlag(), json: json() },
        }),
        Spec.make("export", {
          description: "In-project, content-bounded export of one OutputRef; cross-project is deny-by-default",
          params: { outputRef: outputRefArg(), expectedVersion: outputExpectedVersionFlag(), json: json() },
        }),
        Spec.make("share", {
          description: "In-project share grant for one OutputRef; cross-project is deny-by-default",
          params: { outputRef: outputRefArg(), expectedVersion: outputExpectedVersionFlag(), json: json() },
        }),
        Spec.make("retention", {
          description: "Manage OutputSpool retention policy",
          commands: [
            Spec.make("set", {
              description: "Set the reference-aware retention TTL and legal-hold flag for a scope (CAS, audit)",
              params: {
                ttlSeconds: outputTtlSecondsFlag(),
                legalHold: outputLegalHoldFlag(),
                expectedVersion: outputExpectedVersionFlag(),
                scope: scope(),
                json: json(),
              },
            }),
          ],
        }),
        Spec.make("quota", {
          description: "Manage OutputSpool per-scope byte and queue-depth caps",
          commands: [
            Spec.make("set", {
              description: "Set the byte and queue-depth caps for a quota scope (CAS, audit)",
              params: {
                quotaScope: outputQuotaScopeFlag(),
                maxBytes: outputMaxBytesFlag(),
                maxQueueDepthBytes: outputMaxQueueDepthBytesFlag(),
                expectedVersion: outputExpectedVersionFlag(),
                scope: scope(),
                json: json(),
              },
            }),
          ],
        }),
      ],
    }),
    Spec.make("semantic", {
      description:
        "Manage the Milvus-backed multilingual semantic retrieval registry (Feature 006; registry-generated verbs, zero management-path model calls, redacted/versioned output)",
      commands: [
        Spec.make("provider", {
          description: "Manage semantic embedding/rerank provider profiles",
          commands: [
            Spec.make("list", {
              description: "List redacted provider profiles",
              params: { scope: scope(), json: json() },
            }),
            Spec.make("add", {
              description: "Add a provider profile (SecretRef-only credential, CAS, audit)",
              params: {
                name: Argument.string("name").pipe(Argument.withDescription("provider profile name")),
                baseUrl: Flag.string("base-url").pipe(Flag.withDescription("provider base URL")),
                secretRef: semanticSecretRefFlag().pipe(Flag.optional),
                residency: Flag.choice("residency", SEMANTIC_RESIDENCY).pipe(
                  Flag.withDescription("data-residency posture"),
                  Flag.optional,
                ),
                allowInsecureLocalProfile: Flag.boolean("allow-insecure-local").pipe(
                  Flag.withDescription("allow a non-TLS local-loopback endpoint"),
                  Flag.withDefault(false),
                ),
                scope: scope(),
                json: json(),
              },
            }),
            Spec.make("update", {
              description: "Update a provider profile (version/CAS)",
              params: {
                id: semanticIdArg("provider profile"),
                expectedVersion: semanticExpectedVersionFlag(),
                name: Flag.string("name").pipe(Flag.withDescription("new provider profile name"), Flag.optional),
                baseUrl: Flag.string("base-url").pipe(Flag.withDescription("new provider base URL"), Flag.optional),
                json: json(),
              },
            }),
            Spec.make("test", {
              description: "Probe a provider profile's reachability (explicit operator action; not admission-time)",
              params: { id: semanticIdArg("provider profile"), json: json() },
            }),
            Spec.make("disable", {
              description: "Disable a provider profile (version/CAS)",
              params: { id: semanticIdArg("provider profile"), expectedVersion: semanticExpectedVersionFlag(), json: json() },
            }),
            Spec.make("delete", {
              description: "Delete a provider profile (version/CAS, interactive confirmation)",
              params: {
                id: semanticIdArg("provider profile"),
                expectedVersion: semanticExpectedVersionFlag(),
                confirm: semanticConfirmFlag(),
                json: json(),
              },
            }),
            Spec.make("rotate-secret", {
              description: "Rotate a provider profile's SecretRef (version/CAS, interactive confirmation)",
              params: {
                id: semanticIdArg("provider profile"),
                expectedVersion: semanticExpectedVersionFlag(),
                newSecretRef: semanticSecretRefFlag(),
                confirm: semanticConfirmFlag(),
                json: json(),
              },
            }),
          ],
        }),
        Spec.make("model", {
          description: "Manage semantic model descriptors",
          commands: [
            Spec.make("list", {
              description: "List redacted model descriptors",
              params: {
                scope: scope(),
                providerProfileId: Flag.string("provider-profile-id").pipe(
                  Flag.withDescription("filter to one provider profile"),
                  Flag.optional,
                ),
                json: json(),
              },
            }),
            Spec.make("discover", {
              description: "Discover models exposed by a provider profile (explicit operator action)",
              params: { providerProfileId: semanticIdArg("provider profile"), json: json() },
            }),
            Spec.make("register", {
              description: "Register a model descriptor with declared (untrusted-until-validated) capabilities",
              params: {
                providerProfileId: semanticIdArg("provider profile"),
                modelRef: Flag.string("model-ref").pipe(Flag.withDescription("provider-side model reference")),
                displayName: Flag.string("display-name").pipe(Flag.withDescription("human display name")),
                endpointMode: Flag.choice("endpoint-mode", SEMANTIC_ENDPOINT_MODES).pipe(
                  Flag.withDescription("invoked endpoint shape"),
                  Flag.withDefault("embeddings"),
                ),
                capability: Flag.choice("capability", SEMANTIC_CAPABILITY_KINDS).pipe(
                  Flag.withDescription("declared capability kind (repeatable)"),
                  Flag.atLeast(1),
                ),
                json: json(),
              },
            }),
            Spec.make("validate", {
              description: "Validate a model descriptor's declared capabilities against a live probe",
              params: { id: semanticIdArg("model descriptor"), json: json() },
            }),
            Spec.make("disable", {
              description: "Disable a model descriptor (version/CAS)",
              params: { id: semanticIdArg("model descriptor"), expectedVersion: semanticExpectedVersionFlag(), json: json() },
            }),
          ],
        }),
        Spec.make("embedding", {
          description: "Manage the operator-pinned embedding model binding",
          commands: [
            Spec.make("show", {
              description: "Show the current embedding binding",
              params: { scope: scope(), json: json() },
            }),
            Spec.make("select", {
              description: "Select a validated model descriptor into a draft embedding binding",
              params: { modelDescriptorId: semanticIdArg("model descriptor"), json: json() },
            }),
            Spec.make("validate", {
              description: "Validate a draft embedding binding against a live probe",
              params: { id: semanticIdArg("binding"), json: json() },
            }),
            Spec.make("reindex", {
              description: "Build a blue/green index generation for a staged embedding binding",
              params: { id: semanticIdArg("binding"), json: json() },
            }),
            Spec.make("cutover", {
              description: "Cut over the embedding binding and index generation (CAS, interactive confirmation)",
              params: {
                id: semanticIdArg("binding"),
                generationId: Flag.string("generation-id").pipe(Flag.withDescription("validated index generation id")),
                casToken: semanticCasTokenFlag(),
                confirm: semanticConfirmFlag(),
                json: json(),
              },
            }),
            Spec.make("rollback", {
              description: "Roll back the embedding binding to a prior version (CAS, interactive confirmation)",
              params: {
                targetBindingVersion: semanticTargetBindingVersionFlag(),
                casToken: semanticCasTokenFlag(),
                confirm: semanticConfirmFlag(),
                json: json(),
              },
            }),
          ],
        }),
        Spec.make("reranker", {
          description: "Manage the operator-pinned reranker model binding",
          commands: [
            Spec.make("show", {
              description: "Show the current reranker binding",
              params: { scope: scope(), json: json() },
            }),
            Spec.make("select", {
              description: "Select a validated model descriptor into a draft reranker binding",
              params: {
                modelDescriptorId: semanticIdArg("model descriptor"),
                compatibilityMode: Flag.choice("compatibility-mode", SEMANTIC_RERANK_PROFILES).pipe(
                  Flag.withDescription("rerank compatibility profile (profile C is never reranker-eligible)"),
                  Flag.withDefault("native-rerank"),
                ),
                json: json(),
              },
            }),
            Spec.make("validate", {
              description: "Validate a draft reranker binding against a live probe",
              params: { id: semanticIdArg("binding"), json: json() },
            }),
            Spec.make("cutover", {
              description: "Cut over the reranker binding (CAS, interactive confirmation)",
              params: {
                id: semanticIdArg("binding"),
                casToken: semanticCasTokenFlag(),
                confirm: semanticConfirmFlag(),
                json: json(),
              },
            }),
            Spec.make("rollback", {
              description: "Roll back the reranker binding to a prior version (CAS, interactive confirmation)",
              params: {
                targetBindingVersion: semanticTargetBindingVersionFlag(),
                casToken: semanticCasTokenFlag(),
                confirm: semanticConfirmFlag(),
                json: json(),
              },
            }),
          ],
        }),
        Spec.make("binding", {
          description: "Inspect embedding/reranker binding status and history (read-only; select via embedding/reranker)",
          commands: [
            Spec.make("status", {
              description: "Show the effective embedding + reranker binding and degradation rung",
              params: { scope: scope(), json: json() },
            }),
            Spec.make("history", {
              description: "Show bounded binding version history for one slot",
              params: {
                slot: Flag.choice("slot", SEMANTIC_SLOTS).pipe(Flag.withDescription("binding slot"), Flag.withDefault("embedding")),
                scope: scope(),
                limit: Flag.integer("limit").pipe(Flag.withDescription("maximum versions to return"), Flag.withDefault(20)),
                json: json(),
              },
            }),
          ],
        }),
        Spec.make("index", {
          description: "Inspect and manage the Milvus-backed collection index",
          commands: [
            Spec.make("status", {
              description: "Show one collection's index generation, document count, and freshness bucket",
              params: { collection: semanticCollectionFlag(), scope: scope(), json: json() },
            }),
            Spec.make("test", {
              description: "Probe Milvus reachability (explicit operator action)",
              params: { json: json() },
            }),
            Spec.make("reindex", {
              description: "Trigger a full reindex of one collection (Feature 005 job log ref)",
              params: { collection: semanticCollectionFlag(), json: json() },
            }),
            Spec.make("reconcile", {
              description: "Reconcile one collection's content-hash drift against live core",
              params: {
                collection: semanticCollectionFlag(),
                scheduledOccurrenceId: Flag.string("scheduled-occurrence-id").pipe(
                  Flag.withDescription("Feature 003 occurrence id, when triggered by schedule"),
                  Flag.optional,
                ),
                json: json(),
              },
            }),
            Spec.make("show-collections", {
              description: "Show every collection's alias state",
              params: { scope: scope(), json: json() },
            }),
          ],
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

// -- langlock (Feature 004) command params ------------------------------------

function langLockExpectedVersionFlag() {
  return Flag.integer("expected-version").pipe(Flag.withDescription("expected Lang Lock policy version (CAS)"))
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

// -- output (Feature 005) command params ---------------------------------------

function outputRefArg() {
  return Argument.string("outputRef").pipe(Argument.withDescription("opaque bounded OutputRef; never a filesystem path"))
}

function outputCursorArg() {
  return Argument.string("cursor").pipe(Argument.withDescription("opaque follow cursor from a prior stat/follow response"))
}

function outputOffsetFlag() {
  return Flag.integer("offset").pipe(Flag.withDescription("byte offset to read from"), Flag.withDefault(0))
}

function outputLimitFlag() {
  return Flag.integer("limit").pipe(Flag.withDescription("server-capped maximum bytes to return"))
}

function outputExpectedVersionFlag() {
  return Flag.integer("expected-version").pipe(Flag.withDescription("expected version (CAS)"))
}

function outputTtlSecondsFlag() {
  return Flag.integer("ttl-seconds").pipe(Flag.withDescription("retention TTL in seconds"))
}

function outputLegalHoldFlag() {
  return Flag.boolean("legal-hold").pipe(Flag.withDescription("hold the scope's groups against reclaim"), Flag.withDefault(false))
}

function outputQuotaScopeFlag() {
  return Flag.choice("quota-scope", QUOTA_SCOPES).pipe(
    Flag.withDescription("quota scope"),
    Flag.withDefault("global"),
  )
}

function outputMaxBytesFlag() {
  return Flag.integer("max-bytes").pipe(Flag.withDescription("byte cap for the quota scope"))
}

function outputMaxQueueDepthBytesFlag() {
  return Flag.integer("max-queue-depth-bytes").pipe(Flag.withDescription("bounded-queue depth cap in bytes"))
}

// -- semantic (Feature 006) command params ------------------------------------

function semanticIdArg(label: string) {
  return Argument.string("id").pipe(Argument.withDescription(`${label} id`))
}

function semanticExpectedVersionFlag() {
  return Flag.integer("expected-version").pipe(Flag.withDescription("expected version (CAS)"))
}

function semanticConfirmFlag() {
  return Flag.boolean("confirm").pipe(
    Flag.withDescription("interactive confirmation required for this mutating verb"),
    Flag.withDefault(false),
  )
}

function semanticSecretRefFlag() {
  return Flag.string("secret-ref").pipe(Flag.withDescription("opaque Feature 007 SecretRef; never a raw secret"))
}

function semanticCasTokenFlag() {
  return Flag.string("cas-token").pipe(Flag.withDescription("compare-and-swap token from the current binding/generation"))
}

function semanticTargetBindingVersionFlag() {
  return Flag.integer("target-version").pipe(Flag.withDescription("prior binding version to restore"))
}

function semanticCollectionFlag() {
  return Flag.choice("collection", SEMANTIC_COLLECTIONS).pipe(
    Flag.withDescription("Milvus collection"),
    Flag.withDefault("agents"),
  )
}
