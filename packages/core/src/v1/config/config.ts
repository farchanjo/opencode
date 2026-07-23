export * as ConfigV1 from "./config"

import { NarrowingConfig } from "@opencode-ai/schema/semantic/narrowing-config"
import { ToolConfig } from "@opencode-ai/schema/semantic/tool-config"
import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, type DeepMutable } from "../../schema"
import { ConfigExperimental } from "../../config/experimental"
import { ConfigReference } from "../../config/reference"
import { ConfigAgentV1 } from "./agent"
import { ConfigAttachmentV1 } from "./attachment"
import { ConfigCommandV1 } from "./command"
import { ConfigFormatterV1 } from "./formatter"
import { ConfigLayoutV1 } from "./layout"
import { ConfigLSPV1 } from "./lsp"
import { ConfigMCPV1 } from "./mcp"
import { ConfigPermissionV1 } from "./permission"
import { ConfigPluginV1 } from "./plugin"
import { ConfigProviderV1 } from "./provider"
import { ConfigServerV1 } from "./server"
import { ConfigSkillsV1 } from "./skills"

export type Layout = ConfigLayoutV1.Layout

export const WellKnown = Schema.Struct({
  config: Schema.optional(Schema.Json),
  remote_config: Schema.optional(Schema.Json),
})

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})

/**
 * Feature 014 (FR1): the persisted operator control-plane namespace.
 *
 * The durable operator store (Feature 007) writes a single `operator` document
 * into the config file it round-trips through — the CAS-versioned per-authority
 * records plus the idempotency, rollback, and audit-outbox bookkeeping. Before
 * this key existed, `ConfigParse.schema` rejected a persisted operator document
 * as an unrecognized top-level key (`ConfigInvalidError`), so no operator
 * mutation could ever be read back.
 *
 * The sub-schema is typed at the envelope (the four bookkeeping sections) but
 * permissive at the leaves: each authority payload and audit row is opaque
 * (`Schema.Unknown`), so an arbitrary config-backed domain document round-trips
 * without loss and NO plaintext-secret field is ever declared here — secret
 * values stay `SecretRef` references produced by the domain backends (FR11).
 */
export const Operator = Schema.Struct({
  authorities: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Per-authority CAS records (version + opaque payload + snapshots) keyed by Config.Service authority",
  }),
  idempotency: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Operator idempotency ledger (opaque bookkeeping)",
  }),
  rollback: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Operator cutover rollback slots (opaque bookkeeping)",
  }),
  auditOutbox: Schema.optional(Schema.mutable(Schema.Array(Schema.Unknown))).annotate({
    description: "Durable operator audit outbox rows pending delivery (opaque bookkeeping)",
  }),
}).annotate({
  identifier: "OperatorNamespace",
  description:
    "Feature 007/014 native operator control-plane persisted state. Written and read by the operator store only; secret values are SecretRef references, never plaintext.",
})

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.optional(Schema.String).annotate({ description: "Default shell to use for terminal and bash tool" }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServerV1.Server).annotate({
    description: "Server configuration for opencode serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommandV1.Info)).annotate({
    description: "Command configuration, see https://opencode.ai/docs/commands",
  }),
  skills: Schema.optional(ConfigSkillsV1.Info).annotate({ description: "Additional skill folder paths" }),
  references: Schema.optional(ConfigReference.Info).annotate({
    description: "Named git or local directory references",
  }),
  reference: Schema.optional(ConfigReference.Info).annotate({
    description: "@deprecated Use 'references' field instead. Named git or local directory references",
  }),
  watcher: Schema.optional(Schema.Struct({ ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))) })),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPluginV1.Spec))),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(Schema.String).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  subagent_depth: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1, which prevents subagents from launching subagents.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({ build: Schema.optional(ConfigAgentV1.Info), plan: Schema.optional(ConfigAgentV1.Info) }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        plan: Schema.optional(ConfigAgentV1.Info),
        build: Schema.optional(ConfigAgentV1.Info),
        general: Schema.optional(ConfigAgentV1.Info),
        explore: Schema.optional(ConfigAgentV1.Info),
        title: Schema.optional(ConfigAgentV1.Info),
        summary: Schema.optional(ConfigAgentV1.Info),
        compaction: Schema.optional(ConfigAgentV1.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "Agent configuration, see https://opencode.ai/docs/agents" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProviderV1.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([ConfigMCPV1.Info, Schema.Struct({ enabled: Schema.Boolean })])),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  formatter: Schema.optional(ConfigFormatterV1.Info).annotate({
    description:
      "Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  lsp: Schema.optional(ConfigLSPV1.Info).annotate({
    description:
      "Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayoutV1.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(ConfigPermissionV1.Info),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  attachment: Schema.optional(ConfigAttachmentV1.Info).annotate({
    description: "Attachment processing configuration, including image size limits and resizing behavior",
  }),
  enterprise: Schema.optional(
    Schema.Struct({ url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }) }),
  ),
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: false)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  operator: Schema.optional(Operator).annotate({
    description:
      "Feature 007/014 native operator control-plane persisted state. Managed by the operator store; not hand-edited.",
  }),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: Schema.optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      policies: Schema.optional(Schema.mutable(Schema.Array(ConfigExperimental.Policy))).annotate({
        description: "Policy statements applied to supported resources, such as provider access",
      }),
      operator_control_plane: Schema.optional(Schema.Boolean).annotate({
        description:
          "Enable Feature 007 native operator control plane (default false). Enable via config or OPENCODE_OPERATOR_CONTROL_PLANE for dev/ops.",
      }),
      offline: Schema.optional(Schema.Boolean).annotate({
        description:
          "When true, operator treats connectivity as offline (network ops → unavailable). Override with OPENCODE_CONNECTIVITY/OPENCODE_OFFLINE.",
      }),
      tool_search: Schema.optional(ToolConfig.ToolSearchConfig).annotate({
        description:
          "Feature 009 per-surface semantic tool-search config. Absent, or a surface absent from 'surfaces', keeps the full-set passthrough floor (no narrowing, identical to today).",
      }),
      semantic_narrowing: Schema.optional(NarrowingConfig.SemanticNarrowingConfig).annotate({
        description:
          "Feature 051 live per-turn narrowing config for the agents/skills surfaces (tools reuse 'tool_search'). Absent, or every gate false, keeps the full-set passthrough floor (identical to today).",
      }),
      skill_autoprime: Schema.optional(NarrowingConfig.AutoSkillConfig).annotate({
        description:
          "Feature 052 fourth retrieval pass gate over skill_chunks (Tier-2 <auto_skills> auto-priming), a SEPARATE surface from semantic_narrowing that composes with (never replaces) its 'skills' gate. Absent, or enabled false, keeps the Tier-1-only floor (identical to today).",
      }),
      skill_list: Schema.optional(NarrowingConfig.SkillListConfig).annotate({
        description:
          "Feature 058 Tier-1 skill listing cap/format (max_listed, format verbose|compact|names, hard_cap). Prevents large catalogs from flooding the system prompt even when semantic ranking is passthrough.",
      }),
    }),
  ),
}).annotate({ identifier: "Config" })

export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
