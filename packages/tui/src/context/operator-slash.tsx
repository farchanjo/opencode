/**
 * Optional native operator slash port for TUI (Feature 007 / T029–T036).
 * Host injects worker RPC or remote HTTP port.
 */
import { createContext, useContext, type ParentProps } from "solid-js"

export type OperatorSlashDisplay = {
  readonly title: string
  readonly message: string
  readonly variant: "info" | "success" | "warning" | "error"
  readonly outcome: string
  readonly auditPending: boolean
  readonly injectTranscript: false
}

export type OperatorSlashNeedsConfirm = {
  readonly token: string
  readonly commandId: string
  readonly message: string
}

/**
 * Operator outcome carried on the structured handled result (Feature 012 FR2).
 * Mirrors the Feature 007 `Operator.Outcome` and the CUE `#ResultOutcome`
 * (`doc/arch/schemas/operator-result-signal/enums.cue`).
 */
export type OperatorResultOutcome =
  | "success"
  | "idempotent_replay"
  | "conflict"
  | "unauthorized"
  | "forbidden_scope"
  | "invalid_argument"
  | "reserved_name"
  | "confirmation_required"
  | "unavailable"
  | "secret_backend"
  | "transport_error"
  | "not_implemented"
  | "audit_pending"

/**
 * Structured half of the handled result (Feature 012 FR2), kept structurally
 * separate from the human `display`. Mirrors `#StructuredHandledResult`
 * (`doc/arch/schemas/operator-result-signal/handled-result.cue`): the typed
 * `outcome`, an optional `effective` payload (opaque, projected downstream), and
 * the version. Absence of `effective` is representable and is not an error.
 */
export type OperatorStructuredResult = {
  readonly outcome: OperatorResultOutcome
  readonly effective?: unknown
  readonly version?: string | null
}

export type OperatorSlashHandled = {
  readonly handled: true
  readonly display: OperatorSlashDisplay
  readonly needsConfirmation?: OperatorSlashNeedsConfirm
  readonly cancelled?: boolean
  readonly currentVersion?: string | null
  readonly result?: OperatorStructuredResult
}

export type OperatorSlashPass = { readonly handled: false }

export type OperatorSlashResult = OperatorSlashHandled | OperatorSlashPass

export type OperatorPreflightResult =
  | {
      readonly ok: true
      readonly currentVersion: string | null
      readonly configured: boolean
      readonly scopeKind: string
      readonly scopeRef: string | null
      readonly authority: string
    }
  | { readonly ok: false; readonly code: string; readonly message: string }

export type OperatorSlashPort = {
  readonly tryHandle: (input: {
    text: string
    projectId?: string | null
    sessionId?: string | null
    rootTreeRef?: string | null
    version?: string
    confirmToken?: string
    idempotencyKey?: string
  }) => Promise<OperatorSlashResult>
  readonly cancelConfirmation?: (token: string) => void
  /** Required for mutations — absent → executeOperatorCommand refuses blind mutate */
  readonly preflightMutation?: (input: {
    commandId: string
    projectId?: string | null
    sessionId?: string | null
    rootTreeRef?: string | null
  }) => Promise<OperatorPreflightResult>
}

function init(port: OperatorSlashPort | undefined) {
  return {
    port,
    async tryHandle(input: {
      text: string
      projectId?: string | null
      sessionId?: string | null
      rootTreeRef?: string | null
      version?: string
      confirmToken?: string
      idempotencyKey?: string
    }): Promise<OperatorSlashResult | null> {
      if (!port) return null
      return port.tryHandle(input)
    },
  }
}

export type OperatorSlashContext = ReturnType<typeof init>

const ctx = createContext<OperatorSlashContext>()

export function OperatorSlashProvider(props: ParentProps & { port?: OperatorSlashPort }) {
  const value = init(props.port)
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useOperatorSlash(): OperatorSlashContext {
  const value = useContext(ctx)
  if (!value) {
    return init(undefined)
  }
  return value
}
