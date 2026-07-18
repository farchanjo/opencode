/**
 * Pre-prompt admission pipeline with operator slash intercept (T029).
 * Ordering: operator reserved slash → (stop) else custom/MCP/plugin/prompt/LLM.
 * Instrumentable hooks for zero-LLM tests.
 */
import { isOperatorSlash } from "@opencode-ai/core/operator"
import type { SlashInterceptInput, SlashInterceptResult, SlashInterceptor } from "./slash"

export type PromptPipelineHooks = {
  readonly onProvider?: () => void
  readonly onModelSelect?: () => void
  readonly onPromptAdmit?: () => void
  readonly onMessageCreate?: () => void
  readonly onPartCreate?: () => void
  readonly onTokenAccount?: () => void
  readonly onCustomCommand?: () => void
  readonly onMcp?: () => void
  readonly onPlugin?: () => void
  readonly onLlm?: () => void
}

export type PromptPipelineCounters = {
  provider: number
  modelSelect: number
  promptAdmit: number
  messageCreate: number
  partCreate: number
  tokenAccount: number
  customCommand: number
  mcp: number
  plugin: number
  llm: number
}

export function createPromptPipelineCounters(): {
  readonly counters: PromptPipelineCounters
  readonly hooks: PromptPipelineHooks
} {
  const counters: PromptPipelineCounters = {
    provider: 0,
    modelSelect: 0,
    promptAdmit: 0,
    messageCreate: 0,
    partCreate: 0,
    tokenAccount: 0,
    customCommand: 0,
    mcp: 0,
    plugin: 0,
    llm: 0,
  }
  return {
    counters,
    hooks: {
      onProvider: () => {
        counters.provider += 1
      },
      onModelSelect: () => {
        counters.modelSelect += 1
      },
      onPromptAdmit: () => {
        counters.promptAdmit += 1
      },
      onMessageCreate: () => {
        counters.messageCreate += 1
      },
      onPartCreate: () => {
        counters.partCreate += 1
      },
      onTokenAccount: () => {
        counters.tokenAccount += 1
      },
      onCustomCommand: () => {
        counters.customCommand += 1
      },
      onMcp: () => {
        counters.mcp += 1
      },
      onPlugin: () => {
        counters.plugin += 1
      },
      onLlm: () => {
        counters.llm += 1
      },
    },
  }
}

export type PromptAdmitResult =
  | {
      readonly path: "operator"
      readonly intercept: Extract<SlashInterceptResult, { handled: true }>
    }
  | {
      readonly path: "custom_command" | "prompt" | "shell"
      readonly text: string
    }

/**
 * Admit user input through pre-prompt pipeline.
 * Operator reserved slashes are intercepted BEFORE custom command expansion,
 * Message/Part creation, provider/model selection, and token accounting.
 */
export async function admitPrompt(input: {
  readonly text: string
  readonly mode?: "normal" | "shell"
  readonly interceptor: SlashInterceptor
  readonly principalContext: SlashInterceptInput["principalContext"]
  readonly version?: string
  readonly confirmToken?: string
  readonly scope?: SlashInterceptInput["scope"]
  readonly hooks?: PromptPipelineHooks
  /** Custom command names known to the session (without leading `/`). */
  readonly customCommands?: readonly string[]
}): Promise<PromptAdmitResult> {
  const hooks = input.hooks
  const text = input.text
  const mode = input.mode ?? "normal"

  // T029: reserved operator slash BEFORE shell/custom/MCP/plugin/LLM in ALL modes.
  if (isOperatorSlash(text)) {
    const intercept = await input.interceptor.tryHandle({
      text,
      principalContext: input.principalContext,
      version: input.version,
      confirmToken: input.confirmToken,
      scope: input.scope,
    })
    if (intercept.handled) {
      // Zero LLM / transcript / shell side effects — do not invoke hooks.
      return { path: "operator", intercept }
    }
  }

  // Shell mode (non-operator only).
  if (mode === "shell") {
    hooks?.onPromptAdmit?.()
    hooks?.onMessageCreate?.()
    hooks?.onPartCreate?.()
    return { path: "shell", text }
  }

  // Non-operator path: existing custom command / prompt behavior.
  const firstToken = text.trim().split(/\s+/)[0] ?? ""
  const customName = firstToken.startsWith("/") ? firstToken.slice(1) : ""
  if (customName && input.customCommands?.includes(customName)) {
    hooks?.onCustomCommand?.()
    hooks?.onPromptAdmit?.()
    hooks?.onMessageCreate?.()
    hooks?.onPartCreate?.()
    hooks?.onMcp?.()
    hooks?.onPlugin?.()
    return { path: "custom_command", text }
  }

  hooks?.onModelSelect?.()
  hooks?.onProvider?.()
  hooks?.onPromptAdmit?.()
  hooks?.onMessageCreate?.()
  hooks?.onPartCreate?.()
  hooks?.onTokenAccount?.()
  hooks?.onLlm?.()
  return { path: "prompt", text }
}

export * as OperatorPromptPipeline from "./prompt-pipeline"
