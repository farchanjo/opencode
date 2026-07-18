#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Daemon } from "./services/daemon"

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
  api: () => import("./commands/handlers/api"),
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
  },
  migrate: () => import("./commands/handlers/migrate"),
  service: {
    start: () => import("./commands/handlers/service/start"),
    restart: () => import("./commands/handlers/service/restart"),
    status: () => import("./commands/handlers/service/status"),
    stop: () => import("./commands/handlers/service/stop"),
    password: () => import("./commands/handlers/service/password"),
  },
  serve: () => import("./commands/handlers/serve"),
  telemetry: {
    status: () => import("./telemetry/status"),
    show: () => import("./telemetry/show"),
    on: () => import("./telemetry/on"),
    off: () => import("./telemetry/off"),
    test: () => import("./telemetry/test"),
    configure: () => import("./telemetry/configure"),
  },
  smart: {
    status: () => import("./smart/status"),
    on: () => import("./smart/on"),
    off: () => import("./smart/off"),
    auto: () => import("./smart/auto"),
  },
  routing: {
    status: () => import("./routing/status"),
    explain: () => import("./routing/explain"),
    test: () => import("./routing/test"),
    capability: {
      inspect: () => import("./routing/capability/inspect"),
    },
  },
})

Runtime.run(Commands, Handlers, { version: "local" }).pipe(
  Effect.provide(Daemon.layer),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
)
