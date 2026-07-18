/**
 * TEST-ONLY HTTP bootstrap (memory stack).
 * Production: tryCreateOperatorHttpFetch (live) or worker trusted adapter.
 */
import { createOperatorHttpHandler, resolveAuthFromHeaders } from "./handler"
import type { AuthContext } from "../auth/principal"
import { createTestOperatorStack } from "../stack-test"

export type BootstrapOperatorHttpInput = {
  readonly expectedPassword?: string
  readonly expectedUsername?: string
  readonly sandboxToken?: string
  readonly forceRole?: AuthContext["role"]
  readonly requireAudit?: boolean
  readonly serverBind?: string
  readonly clientIp?: string | null
  readonly projectId?: string | null
  readonly injectProjectScopeWhenOmitted?: boolean
}

export function bootstrapOperatorHttp(input: BootstrapOperatorHttpInput = {}) {
  const stack = createTestOperatorStack({
    nowMs: undefined,
  })
  // If requireAudit requested, flip on test stack ports
  if (input.requireAudit) {
    ;(stack.mutationPorts as { requireAudit?: boolean }).requireAudit = true
  }

  const serverBind = input.serverBind ?? "127.0.0.1"
  const clientIp = input.clientIp === undefined ? "127.0.0.1" : input.clientIp
  const projectId = input.projectId ?? null

  const fetch = createOperatorHttpHandler({
    dispatcher: stack.dispatcher,
    registry: stack.registry,
    serverBind,
    getClientIp: () => clientIp,
    getProjectId: () => projectId,
    injectProjectScopeWhenOmitted: input.injectProjectScopeWhenOmitted ?? false,
    resolveAuth(request) {
      if (input.forceRole === "llm" || input.forceRole === "anonymous") {
        return {
          authenticated: input.forceRole !== "anonymous",
          role: input.forceRole,
          subject: "spoof",
          projectBinding: projectId,
        }
      }
      if (input.forceRole === "manager-view") {
        const base = resolveAuthFromHeaders({
          authorization: request.headers.get("authorization"),
          expectedPassword: input.expectedPassword,
          expectedUsername: input.expectedUsername,
          sandboxToken: input.sandboxToken,
          sandboxTokenHeader: request.headers.get("x-opencode-operator-token"),
        })
        if (!base.authenticated) return base
        return { ...base, role: "manager-view", projectBinding: projectId }
      }
      const base = resolveAuthFromHeaders({
        authorization: request.headers.get("authorization"),
        expectedPassword: input.expectedPassword,
        expectedUsername: input.expectedUsername,
        sandboxToken: input.sandboxToken,
        sandboxTokenHeader: request.headers.get("x-opencode-operator-token"),
      })
      return { ...base, projectBinding: projectId }
    },
  })

  return {
    fetch,
    registry: stack.registry,
    dispatcher: stack.dispatcher,
    mutationPorts: stack.mutationPorts,
    serverBind,
    stack,
  }
}

export * as OperatorHttpBootstrap from "./bootstrap"
