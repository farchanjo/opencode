/**
 * Operator command descriptor types (Feature 007 / T005–T008).
 */
import { Schema } from "effect"
import { CommandId } from "./command-id"
import { ScopeKind } from "./scope"

export const CommandAuthority = Schema.Literals(["native", "plugin", "mcp", "custom"]).annotate({
  identifier: "Operator.CommandAuthority",
})
export type CommandAuthority = typeof CommandAuthority.Type

export const OperatorCommandDescriptor = Schema.Struct({
  id: CommandId,
  /** Registry-generated surface aliases (slash/CLI/palette). */
  aliases: Schema.Array(Schema.String),
  /** True for mutations (commands); false for queries. */
  mutates: Schema.Boolean,
  scopesAllowed: Schema.Array(ScopeKind),
  confirmRequired: Schema.Boolean,
  offlineCapable: Schema.Boolean,
  schemaVersion: Schema.String,
  authority: CommandAuthority,
  title: Schema.optional(Schema.String),
  domain: Schema.String,
}).annotate({ identifier: "Operator.CommandDescriptor" })
export type OperatorCommandDescriptor = typeof OperatorCommandDescriptor.Type

export type DescriptorDraft = {
  readonly id: string
  readonly mutates: boolean
  readonly scopesAllowed: readonly (typeof ScopeKind.Type)[]
  readonly confirmRequired?: boolean
  readonly offlineCapable?: boolean
  readonly schemaVersion?: string
  readonly authority?: CommandAuthority
  readonly title?: string
}

export * as OperatorDescriptor from "./descriptor"
