/**
 * Plaintext secret rejection (Feature 007 / T021).
 */
import { failureResult, findPlaintextSecretFields, type CommandRequest, type CommandResult } from "@opencode-ai/core/operator"

/**
 * Reject request payloads that embed raw secrets in known secret fields.
 * SecretRef-shaped objects are allowed.
 */
export function rejectPlaintextSecrets(request: CommandRequest): CommandResult | null {
  const hits = findPlaintextSecretFields(request.payload ?? {})
  if (hits.length === 0) return null
  return failureResult({
    id: String(request.id),
    code: "invalid_argument",
    message: "plaintext secrets are forbidden in operator payloads; use SecretRef",
    details: { fields: hits.join(",") },
  })
}

export * as OperatorPlaintext from "./plaintext"
