/**
 * Feature 005 — OutputSpool protocol barrel (T014).
 *
 * Re-exports the shared identifiers, closed enums (sourced from
 * `@opencode-ai/schema/outputspool/*`), the 11-member `output.*` event
 * vocabulary, read models, request/response payloads and typed error unions from
 * ./commands, and the `SpoolWriterPort`/`SpoolReaderPort`/`RetentionPort`/
 * `AdminPort` interfaces from ./ports, mirroring
 * doc/arch/sdd/005-add-a-canonical-file-backed-outputspool-and-paged/contracts/ports.ts.
 */

export * from "./commands"
export type { AdminPort, RetentionPort, SpoolReaderPort, SpoolWriterPort } from "./ports"
