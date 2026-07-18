export * as Admin from "./admin"

import { Schema } from "effect"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { Ids } from "./ids"

// Mirrors doc/arch/schemas/outputspool/admin.cue one-to-one. Share and export are
// deny-by-default across projects; an in-project export requires an operator
// principal, an action scope and a bounded content encoding, never a raw path
// (FR44, Privacy 3, C17). Migration is phased behind a feature flag with a bounded
// dual-read window over the legacy BackgroundJob/ToolOutputStore surfaces (FR31,
// C16).

// MigrationState is the C16 feature-flag state over the legacy dual-read window (FR31, C16, AC12).
export const MigrationState = Schema.Struct({
  enabled: Schema.Boolean.annotate({ identifier: "OutputSpoolAdmin.Enabled" }),
  dual_read: Schema.Boolean.annotate({ identifier: "OutputSpoolAdmin.DualRead" }),
}).annotate({ identifier: "OutputSpoolAdmin.MigrationState" })
export type MigrationState = Schema.Schema.Type<typeof MigrationState>

// ExportRequest is a deny-by-default in-project export; bounded encoding, never a raw path (FR44, C17, AC13).
export const ExportRequest = Schema.Struct({
  output_ref: Ids.OutputRef,
  scope: Enums.ActionScope,
  encoding: EnumsEvent.ExportEncoding,
  principal: Correlation.Principal,
}).annotate({ identifier: "OutputSpoolAdmin.ExportRequest" })
export type ExportRequest = Schema.Schema.Type<typeof ExportRequest>

// ShareRequest is a deny-by-default in-project share; re-evaluated per action (FR44, C17, AC15).
export const ShareRequest = Schema.Struct({
  output_ref: Ids.OutputRef,
  scope: Enums.ActionScope,
  principal: Correlation.Principal,
}).annotate({ identifier: "OutputSpoolAdmin.ShareRequest" })
export type ShareRequest = Schema.Schema.Type<typeof ShareRequest>
