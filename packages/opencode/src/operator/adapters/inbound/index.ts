export {
  createSlashInterceptor,
  type SlashInterceptor,
  type SlashInterceptInput,
  type SlashInterceptResult,
  type SlashInterceptHandled,
  type SlashPrincipalContext,
  type CreateSlashInterceptorOptions,
} from "./slash"

export {
  createSlashConfirmStore,
  type SlashConfirmStore,
  type SlashConfirmBinding,
  type SlashConfirmToken,
} from "./slash-confirm"

export {
  mapOperatorResultToDisplay,
  displayToToast,
  type OperatorSlashDisplay,
  type OperatorSlashDisplayVariant,
} from "./slash-display"

export {
  admitPrompt,
  createPromptPipelineCounters,
  type PromptPipelineHooks,
  type PromptPipelineCounters,
  type PromptAdmitResult,
} from "./prompt-pipeline"

export { createTuiOperatorSlashPort, type TuiOperatorSlashPort } from "./tui-port"

export { createHttpOperatorSlashPort, type HttpSlashPortOptions } from "./http-slash-port"

export { createWorkerRpcSlashPort, type RpcOperatorSlashPortOptions } from "./rpc-slash-port"

export { parseSlashPayload, resolveSlashScope } from "./slash"

export {
  createCliRunner,
  evaluateCliYesPolicy,
  type CliRunInput,
  type CliRunOutput,
  type CliConfirmFn,
  type CliConfirmBinding,
  type CreateCliRunnerOptions,
} from "./cli"

export {
  resolveCliCommandId,
  resolveCliScope,
  parseCliPayload,
  parseCliInvocation,
  isSecretDomainCommand,
  normalizeExpectedVersion,
  isBoundedCliJson,
  assertPayloadByteLimit,
  readBoundedPayloadSource,
  CLI_MAX_PAYLOAD_BYTES,
  CLI_MAX_JSON_DEPTH,
  type CliPrincipalContext,
  type CliParseFlags,
  type CliParseResult,
} from "./cli-parse"

export {
  formatOperatorCli,
  formatPreRunnerInvalidArgument,
  formatHuman,
  exitCodeForResult,
  redactCommandResult,
  CLI_EXIT_BY_OUTCOME,
  CLI_EXIT_CANCELLED,
  CLI_EXIT_USAGE,
  type CliRenderMode,
  type CliRenderOutput,
} from "./cli-output"

export * as OperatorInbound from "."
