// TUI Smart-state surface: wires the pure routing-state projection into a
// solid-js createMemo so the prompt component can re-evaluate the Smart
// indicator on every render without re-deriving by hand.

import { createMemo, type Accessor } from "solid-js"
import type { SmartIndicatorState } from "@opencode-ai/schema/tui/smart-state"
import { deriveSmartIndicatorState, INACTIVE_SMART_ROUTING_SIGNAL, type SmartRoutingSignal } from "../routing-state"
import { deriveSmartLabel, type SmartLabelView } from "./label"

export { INACTIVE_SMART_ROUTING_SIGNAL, deriveSmartIndicatorState } from "../routing-state"
export type { SmartRoutingSignal } from "../routing-state"
export { deriveSmartLabel } from "./label"
export type { SmartLabelTone, SmartLabelView } from "./label"

/**
 * Re-derives the Smart indicator label from the raw routing signal and the
 * current fallback text on every dependency change. Pure, no I/O — safe on
 * the hot render path.
 */
export function useSmartIndicator(
  signal: Accessor<SmartRoutingSignal>,
  fallbackText: Accessor<string>,
): Accessor<SmartLabelView> {
  const state = createMemo<SmartIndicatorState>(() => deriveSmartIndicatorState(signal(), fallbackText()))
  return createMemo(() => deriveSmartLabel(state()))
}
