import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Definition } from "../../src/jobs/definition"

// Feature 003 / T032 — packages/schema/src/jobs/definition.ts mirrors
// doc/arch/schemas/jobs/definition.cue and definition-parts.cue one-to-one
// (FR2, FR6, FR28, FR29, FR32, C5, C10). JobDefinition is the durable
// scheduled-job aggregate persisted in the Feature 007 Config.Service
// authority; secrets are secure references only (Security 3, C10).

// The raw (pre-decode) fixture uses epoch millis for the DateTimeUtcFromMillis
// timestamp fields, mirroring packages/schema/test/lifecycle-process-row.test.ts.
const rawDefinition = {
  id: "jdf_1",
  identity: {
    name: "nightly-backup",
    description: "runs the nightly backup job",
    owner: "operator_1",
    version: 1,
    created_at: 1_721_260_800_000,
    updated_at: 1_721_260_800_000,
  },
  schedule: {
    schedule_id: "sch_1",
    schedule: { expression: "0 3 * * *", timezone: "UTC" },
    minimum_interval_ms: 60_000,
    enabled: true,
  },
  policy: {
    misfire: "skip",
    overlap: "forbid",
    capability_surface: "in_process",
  },
  execution: {
    action_type: "native_maintenance",
    target: "action_ref_1",
    deadline_ms: 900_000,
    timeout_ms: 600_000,
    retry_budget: 0,
    priority: 0,
  },
  authorization: {
    scope: "project",
    project_ref: "proj_1",
    root_session_id: null,
    principal: "operator_1",
    permissions: ["read"],
    secret_refs: [],
    payload_ref: null,
  },
}

describe("Definition.JobDefinition", () => {
  test("round-trips a valid definition through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Definition.JobDefinition)(rawDefinition)
    expect(Schema.encodeSync(Definition.JobDefinition)(decoded) as unknown).toEqual(rawDefinition)
  })

  test("round-trips a definition carrying secret references and a payload_ref (Security 3, C10)", () => {
    const withSecrets = {
      ...rawDefinition,
      authorization: {
        ...rawDefinition.authorization,
        secret_refs: ["secret_ref_1", "secret_ref_2"],
        payload_ref: "payload_ref_1",
      },
    }
    const decoded = Schema.decodeUnknownSync(Definition.JobDefinition)(withSecrets)
    expect(Schema.encodeSync(Definition.JobDefinition)(decoded) as unknown).toEqual(withSecrets)
  })

  test("rejects a version below one (CAS is 1-based)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Definition.JobDefinition)({
        ...rawDefinition,
        identity: { ...rawDefinition.identity, version: 0 },
      }),
    ).toThrow()
  })

  test("rejects an out-of-vocabulary overlap policy", () => {
    expect(() =>
      Schema.decodeUnknownSync(Definition.JobDefinition)({
        ...rawDefinition,
        policy: { ...rawDefinition.policy, overlap: "kill" },
      }),
    ).toThrow()
  })

  test("rejects an empty job name", () => {
    expect(() =>
      Schema.decodeUnknownSync(Definition.JobDefinition)({
        ...rawDefinition,
        identity: { ...rawDefinition.identity, name: "" },
      }),
    ).toThrow()
  })

  test("rejects a missing required authorization sub-object", () => {
    const { authorization: _authorization, ...incomplete } = rawDefinition
    expect(() => Schema.decodeUnknownSync(Definition.JobDefinition)(incomplete)).toThrow()
  })
})

describe("Definition.SecretRefList — secure references only, never a raw secret (Security 3, C10)", () => {
  test("round-trips a list of opaque secret handles", () => {
    const decoded = Schema.decodeUnknownSync(Definition.SecretRefList)(["ref_1", "ref_2"])
    expect(Schema.encodeSync(Definition.SecretRefList)(decoded)).toEqual(["ref_1", "ref_2"])
  })

  test("rejects an empty-string member (opaque handles are non-empty)", () => {
    expect(() => Schema.decodeUnknownSync(Definition.SecretRefList)(["ref_1", ""])).toThrow()
  })
})
