/**
 * sdk-next operator client (T027).
 * Thin re-export of the monorepo JS SDK operator client via relative path
 * (sdk-next does not declare @opencode-ai/sdk dependency).
 */
export {
  OperatorClient,
  createOperatorClient,
  type OperatorClientOptions,
  type OperatorCommandBody,
  type OperatorClientResult,
} from "../../../sdk/js/src/operator/client"

export * as OperatorSdkNext from "."
