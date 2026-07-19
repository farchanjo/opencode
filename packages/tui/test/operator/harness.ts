/**
 * Feature 011 T015/T016 — deterministic spy harness for the operator dispatch
 * seam. A fake `OperatorSlashPort` records every `tryHandle`/`preflightMutation`
 * input so tests can assert the canonical command id + payload actually put on
 * the wire (the SAME loopback slash/CLI use, FR8) without a live control plane.
 * A minimal fake `DialogContext`/toast lets `executeOperatorCommand` run headless
 * for the non-interactive (no confirm-dialog) verbs the tests exercise.
 */
import type { DialogContext } from "../../src/ui/dialog"
import type { OperatorSlashPort, OperatorSlashDisplay } from "../../src/context/operator-slash"
import type { OperatorToast } from "../../src/operator/execute"

export type TryHandleInput = Parameters<OperatorSlashPort["tryHandle"]>[0]
export type PreflightInput = Parameters<NonNullable<OperatorSlashPort["preflightMutation"]>>[0]

export type SpyPort = {
  readonly port: OperatorSlashPort
  readonly tryHandleCalls: TryHandleInput[]
  readonly preflightCalls: PreflightInput[]
}

function display(over: Partial<OperatorSlashDisplay> = {}): OperatorSlashDisplay {
  return {
    title: "Operator",
    message: "ok",
    variant: "success",
    outcome: "success",
    auditPending: false,
    injectTranscript: false,
    ...over,
  }
}

/**
 * A spy port. `respond` shapes the `tryHandle` display so a test can model the
 * backend outcome (success, or the typed honest-unavailable envelope). Preflight
 * always succeeds with no existing authority so a plain persisting mutation is
 * not gated by a version conflict.
 */
export function createSpyPort(respond: (input: TryHandleInput) => OperatorSlashDisplay = () => display()): SpyPort {
  const tryHandleCalls: TryHandleInput[] = []
  const preflightCalls: PreflightInput[] = []
  return {
    tryHandleCalls,
    preflightCalls,
    port: {
      async tryHandle(input) {
        tryHandleCalls.push(input)
        return { handled: true, display: respond(input) }
      },
      async preflightMutation(input) {
        preflightCalls.push(input)
        return {
          ok: true,
          currentVersion: null,
          configured: false,
          scopeKind: "global",
          scopeRef: null,
          authority: "test",
        }
      },
    },
  }
}

export { display as spyDisplay }

export type CapturedToast = { title: string; message: string; variant?: string }

export function createFakeToast(): { toast: OperatorToast; calls: CapturedToast[] } {
  const calls: CapturedToast[] = []
  return {
    calls,
    toast: {
      show: (input: CapturedToast) => {
        calls.push(input)
      },
    },
  }
}

/** A no-op dialog: the tested verbs never reach a confirm/replace interaction. */
export function createFakeDialog(): DialogContext {
  return {
    clear() {},
    replace(_input: unknown, _onClose?: () => void) {},
    get stack() {
      return []
    },
    get size() {
      return "medium" as const
    },
    setSize(_size: "medium" | "large" | "xlarge") {},
  }
}
