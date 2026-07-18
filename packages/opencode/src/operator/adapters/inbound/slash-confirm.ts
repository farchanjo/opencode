/**
 * Slash interactive confirmation tokens (T030).
 * Bound to exact canonical command + scope + version; single-use; expires.
 * Slash never auto-yes via `--yes` / confirm=true alone.
 */
export type SlashConfirmBinding = {
  readonly commandId: string
  readonly scopeKind: string
  readonly scopeRef: string | null | undefined
  readonly version: string | undefined
}

export type SlashConfirmToken = {
  readonly token: string
  readonly binding: SlashConfirmBinding
  readonly expiresAt: number
}

export type SlashConfirmStore = {
  readonly mint: (binding: SlashConfirmBinding) => SlashConfirmToken
  readonly consume: (token: string, binding: SlashConfirmBinding) => boolean
  readonly peek: (token: string) => SlashConfirmToken | undefined
  /** Drop token without success (cancel leaves config unchanged). */
  readonly revoke: (token: string) => void
  readonly size: () => number
  readonly clear: () => void
}

function bindingKey(binding: SlashConfirmBinding): string {
  return [
    binding.commandId,
    binding.scopeKind,
    binding.scopeRef ?? "",
    binding.version ?? "",
  ].join("\u0001")
}

function bindingsEqual(a: SlashConfirmBinding, b: SlashConfirmBinding): boolean {
  return bindingKey(a) === bindingKey(b)
}

export function createSlashConfirmStore(options?: {
  readonly ttlMs?: number
  readonly nowMs?: () => number
  readonly randomToken?: () => string
}): SlashConfirmStore {
  const ttlMs = options?.ttlMs ?? 60_000
  const nowMs = options?.nowMs ?? (() => Date.now())
  const randomToken =
    options?.randomToken ??
    (() => {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    })

  const byToken = new Map<string, SlashConfirmToken>()

  function purgeExpired(now: number) {
    for (const [token, entry] of byToken) {
      if (entry.expiresAt <= now) byToken.delete(token)
    }
  }

  return {
    mint(binding) {
      const now = nowMs()
      purgeExpired(now)
      const token = randomToken()
      const entry: SlashConfirmToken = {
        token,
        binding: {
          commandId: binding.commandId,
          scopeKind: binding.scopeKind,
          scopeRef: binding.scopeRef,
          version: binding.version,
        },
        expiresAt: now + ttlMs,
      }
      byToken.set(token, entry)
      return entry
    },
    consume(token, binding) {
      const now = nowMs()
      purgeExpired(now)
      const entry = byToken.get(token)
      if (!entry) return false
      byToken.delete(token)
      if (entry.expiresAt <= now) return false
      return bindingsEqual(entry.binding, binding)
    },
    peek(token) {
      const now = nowMs()
      purgeExpired(now)
      return byToken.get(token)
    },
    revoke(token) {
      byToken.delete(token)
    },
    size() {
      purgeExpired(nowMs())
      return byToken.size
    },
    clear() {
      byToken.clear()
    },
  }
}

export * as OperatorSlashConfirm from "./slash-confirm"
