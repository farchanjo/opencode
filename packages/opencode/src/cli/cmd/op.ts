/**
 * `opencode op` — native operator control plane CLI (Feature 007 / T032–T034).
 * Human default; `--json` machine envelope. Same live stack as slash/HTTP.
 * Never LLM / ToolRegistry / MCP / plugin / custom command.
 *
 * Auth (V1 clarify): the local CLI process owner is the operator principal.
 * Production always authenticates as operator subject `local` (no principal flags).
 * Tests may inject `authenticated: false` into the runner only — never from argv.
 */
import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"

type OpArgs = {
  segments?: string[]
  json?: boolean
  yes?: boolean
  expectedVersion?: string
  idempotencyKey?: string
  session?: string
  project?: string
  rootTree?: string
  payload?: string
  payloadFile?: string
  directory?: string
}

export const OpCommand = effectCmd({
  command: "op [segments..]",
  describe: "operator control plane (registry commands; zero-LLM)",
  builder: (yargs: Argv) =>
    yargs
      .positional("segments", {
        describe: "domain operation [qualifiers...] or canonical.dotted.id",
        type: "string",
        array: true,
      })
      .option("json", {
        describe: "emit typed operator envelope JSON on stdout only",
        type: "boolean",
        default: false,
      })
      .option("yes", {
        alias: "y",
        describe: "confirm destructive mutation (non-TTY + local operator only)",
        type: "boolean",
        default: false,
      })
      .option("expected-version", {
        describe: "CAS expected version for mutations; use --expected-version=- for create",
        type: "string",
      })
      .option("idempotency-key", {
        describe: "idempotency key for mutations",
        type: "string",
      })
      .option("session", {
        describe: "session scope ref (descriptor-allowed only)",
        type: "string",
      })
      .option("project", {
        describe: "project scope ref (no arbitrary cross-project)",
        type: "string",
      })
      .option("root-tree", {
        describe: "root-tree scope ref",
        type: "string",
      })
      .option("payload", {
        describe: "strict JSON payload object (≤256KiB; SecretRef only for secret fields)",
        type: "string",
      })
      .option("payload-file", {
        describe: 'JSON payload file path (≤256KiB), or "-" for stdin',
        type: "string",
      })
      .option("directory", {
        describe: "project directory (default: cwd)",
        type: "string",
      })
      .example("opencode op langlock status", "query langlock status (human)")
      .example("opencode op langlock status --json", "query with machine envelope")
      .example(
        "opencode op semantic embedding cutover --expected-version=- --idempotency-key k1 --yes",
        "non-TTY create-path mutation (local operator)",
      ),
  directory: (args) => (args as OpArgs).directory ?? process.cwd(),
  handler: Effect.fn("Cli.op")(function* (raw) {
    const args = raw as OpArgs
    const segments = (args.segments ?? []).filter((s) => typeof s === "string" && s.length > 0)
    if (segments.length === 0) {
      return yield* fail(
        "usage: opencode op <domain> <operation> [qualifiers...] | opencode op <canonical.dotted.id>",
        64,
      )
    }

    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")

    const directory = args.directory ?? ctx.directory ?? process.cwd()
    const projectId = ctx.project?.id ?? null

    const mode = args.json === true ? ("json" as const) : ("human" as const)
    const commandHint = segments.join(".")

    const { readBoundedPayloadSource } = yield* Effect.promise(
      () => import("@/operator/adapters/inbound/cli-parse"),
    )
    const { formatPreRunnerInvalidArgument } = yield* Effect.promise(
      () => import("@/operator/adapters/inbound/cli-output"),
    )
    const payloadLoad = yield* Effect.promise(() =>
      readBoundedPayloadSource({
        payload: args.payload,
        payloadFile: args.payloadFile,
      }),
    )
    // Pre-runner bound/depth/file failures: same typed envelope as runner invalid_argument.
    // Never generic Error stack; --json → envelope on stdout, exit 40.
    if (!payloadLoad.ok) {
      const rendered = formatPreRunnerInvalidArgument({
        id: commandHint || "operator.cli",
        message: payloadLoad.reason,
        mode,
      })
      if (rendered.stdout) process.stdout.write(rendered.stdout)
      if (rendered.stderr) process.stderr.write(rendered.stderr)
      process.exitCode = rendered.exitCode
      return
    }

    const { getOrCreateLiveOperatorStack } = yield* Effect.promise(() => import("@/operator/stack"))
    const { createCliRunner } = yield* Effect.promise(() => import("@/operator/adapters/inbound/cli"))
    const { isOperatorDevSandbox } = yield* Effect.promise(() => import("@/operator/dev-env"))
    const { isFlagBootstrapSegments, parseFlagBootstrapAction, flagShow, flagSet } = yield* Effect.promise(
      () => import("@/operator/flag-bootstrap"),
    )
    const { dryRunLegacyMigration } = yield* Effect.promise(() => import("@opencode-ai/core/operator"))

    // Canonical harness marker only — never OPENCODE_OPERATOR_SANDBOX divergence.
    const sandboxKeychain = isOperatorDevSandbox()
    const stack = yield* Effect.promise(() =>
      getOrCreateLiveOperatorStack({
        directory,
        projectKey: projectId ?? "project",
        sandboxKeychain,
      }),
    )

    const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY)
    const jsonMode = args.json === true

    // T041 bootstrap: op flag show|enable|disable — Config.Service only, zero-LLM
    if (isFlagBootstrapSegments(segments)) {
      const action = parseFlagBootstrapAction(segments)!
      if (action === "show") {
        const shown = yield* Effect.promise(() => flagShow(stack.config))
        const body = jsonMode
          ? JSON.stringify({
              ok: true,
              kind: "operator.admin_result",
              id: "flag.show",
              outcome: "success",
              data: { state: shown.state, message: shown.message },
            }) + "\n"
          : shown.message + "\n"
        process.stdout.write(body)
        process.exitCode = 0
        return
      }
      // enable/disable require --yes (confirmation; no silent config write)
      if (args.yes !== true) {
        const blocked = yield* Effect.promise(() =>
          flagSet(stack.config, action === "enable", { confirm: false }),
        )
        const body = jsonMode
          ? JSON.stringify({
              ok: false,
              kind: "operator.admin_result",
              id: `flag.${action}`,
              outcome: "confirmation_required",
              error: { code: "confirmation_required", message: blocked.message },
              state: blocked.state,
            }) + "\n"
          : blocked.message + "\n"
        if (jsonMode) process.stdout.write(body)
        else process.stderr.write(body)
        process.exitCode = jsonMode ? 40 : 1
        return
      }
      const final = yield* Effect.promise(() =>
        flagSet(stack.config, action === "enable", { confirm: true }),
      )
      const body = jsonMode
        ? JSON.stringify({
            ok: final.ok,
            kind: "operator.admin_result",
            id: `flag.${action}`,
            outcome: final.ok ? "success" : "failed",
            data: { state: final.state, persisted: final.persisted, message: final.message },
          }) + "\n"
        : final.message + "\n"
      process.stdout.write(body)
      process.exitCode = final.ok ? 0 : 1
      return
    }

    // T043: op migrate dry-run [names...] — versioned report, no rename/delete
    if (segments[0] === "migrate" && segments[1] === "dry-run") {
      const names = segments.slice(2)
      const report = dryRunLegacyMigration(names)
      const body = jsonMode
        ? JSON.stringify({ ok: true, kind: "operator.migrate_dry_run", ...report }) + "\n"
        : `catalogVersion=${report.catalogVersion} reject=${report.reject.length} warn=${report.warn.length} clean=${report.clean.length} autoRename=false autoDelete=false\n` +
          (report.reject.length ? `reject: ${report.reject.join(", ")}\n` : "") +
          (report.warn.length ? `warn: ${report.warn.join(", ")}\n` : "") +
          (report.clean.length ? `clean: ${report.clean.join(", ")}\n` : "")
      process.stdout.write(body)
      process.exitCode = 0
      return
    }

    const runner = createCliRunner({
      registry: stack.registry,
      dispatcher: stack.dispatcher,
    })

    // V1: local process owner is the operator principal (clarify). No principal argv.
    const out = yield* Effect.promise(() =>
      runner.run({
        segments,
        flags: {
          json: args.json === true,
          yes: args.yes === true,
          expectedVersion: args.expectedVersion,
          idempotencyKey: args.idempotencyKey,
          session: args.session,
          project: args.project,
          rootTree: args.rootTree,
        },
        ctx: {
          projectId,
          subject: "local",
          authenticated: true,
          sessionId: args.session ?? null,
          rootTreeRef: args.rootTree ?? null,
        },
        payloadRaw: payloadLoad.raw,
        isTty,
      }),
    )

    // Envelope/human on stdout; diagnostics only on stderr (JSON purity).
    if (out.stdout) process.stdout.write(out.stdout)
    if (out.stderr) process.stderr.write(out.stderr)
    process.exitCode = out.exitCode
  }),
})
