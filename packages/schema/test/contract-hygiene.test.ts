import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"
import { FileSystem } from "../src/filesystem"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { Pty } from "../src/pty"
import { Question } from "../src/question"
import { Budget } from "../src/routing/budget"
import { Capability } from "../src/routing/capability"
import { RoutingConfig } from "../src/routing/config"
import { Decision } from "../src/routing/decision"
import { Events } from "../src/routing/events"
import { Ids } from "../src/routing/ids"
import { Session } from "../src/session"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { Config as TelemetryConfig } from "../src/telemetry/config"
import { SmartState } from "../src/tui/smart-state"
import { optional } from "../src/schema"

describe("contract hygiene", () => {
  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
  })

  test("todo status and priority preserve arbitrary strings", () => {
    const decode = Schema.decodeUnknownSync(SessionTodo.Info)
    expect(decode({ content: "ship", status: "waiting", priority: "urgent" })).toEqual({
      content: "ship",
      status: "waiting",
      priority: "urgent",
    })
  })

  test("current ID constructors expose create", () => {
    expect(Question.ID.create()).toStartWith("que_")
    expect(Pty.ID.create()).toStartWith("pty_")
  })

  test("reusable public identifiers are stable and unique", () => {
    const identifiers = [
      Agent.Color,
      FileSystem.Submatch,
      Model.Ref,
      Model.Capabilities,
      Model.Cost,
      Model.Api,
      Project.Icon,
      Project.Commands,
      Project.Time,
      Project.Info,
      Pty.Info,
      Session.ListAnchor,
      Ids.Reason,
      Ids.Requirement,
      Capability.Reason,
      Capability.Requirement,
      Capability.ToolCallDimensions,
      Capability.Identity,
      Capability.Confidence,
      Capability.Assessment,
      Capability.Freshness,
      Capability.Record,
      Capability.Mismatch,
      Decision.GatePassed,
      Decision.CandidateRejected,
      Decision.TieBreakApplied,
      Decision.FallbackAttempted,
      Decision.Offline,
      Decision.GateResult,
      Decision.GateList,
      Decision.SkillList,
      Decision.CandidateIdentity,
      Decision.CandidateProfile,
      Decision.CandidateOutcome,
      Decision.CandidateRecord,
      Decision.RankedCandidate,
      Decision.RankingList,
      Decision.AuthContextSnapshot,
      Decision.ExpectedTools,
      Decision.InputStructure,
      Decision.InputRisk,
      Decision.InputConcurrency,
      Decision.DecisionInputs,
      Decision.DecisionOutput,
      Decision.DecisionContext,
      Decision.DecisionClassification,
      Decision.DecisionSelection,
      Decision.DecisionEvaluation,
      Decision.DecisionAccounting,
      Decision.DecisionLifecycle,
      Decision.RoutingDecision,
      Events.DecisionCorrelation,
      Events.EventClassification,
      Events.EventSelection,
      Events.DispatchLineage,
      Events.DispatchFanout,
      Events.TodoPointer,
      Events.EvidenceRefs,
      Events.RoutingDecisionEvent,
      Events.RoutingFallbackEvent,
      Events.HierarchyDispatchEvent,
      Events.HierarchyValidationEvent,
      Events.HierarchyEscalationEvent,
      Events.CapabilityMismatchEvent,
      Events.TodoInitializedEvent,
      Events.TodoCompletionBlockedEvent,
      Events.RoutingEvent,
      Budget.Limits,
      Budget.Concurrency,
      Budget.Retrieval,
      Budget.Cost,
      Budget.Resilience,
      Budget.Policy,
      Budget.Scope,
      Budget.PolicySnapshot,
      Budget.ConsumptionThroughput,
      Budget.ConsumptionConcurrency,
      Budget.ConsumptionRetrieval,
      Budget.ConsumptionCost,
      Budget.ConsumptionResilience,
      Budget.Consumption,
      RoutingConfig.Activation,
      RoutingConfig.Models,
      RoutingConfig.Enforcement,
      RoutingConfig.Info,
      TelemetryConfig.SecretRef,
      TelemetryConfig.ExportTarget,
      TelemetryConfig.TelemetryConfig,
      SmartState.Active,
      SmartState.Inactive,
    ].map((schema) => schema.ast.annotations?.identifier)

    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("current source avoids Any and mutable contract wrappers", async () => {
    const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
      (file) => !file.endsWith("-v1.ts"),
    )
    const source = await Promise.all(
      files.map((file) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text()),
    ).then((values) => values.join("\n"))

    expect(source).not.toContain("Schema.Any")
    expect(source).not.toContain("Schema.mutable")
  })
})
