// Native Semantic Search / Models panel — Feature 007 operator surface for
// Feature 006's Milvus-backed multilingual semantic retrieval (T039, FR29,
// FR30, C16). Renders capability badges per known model descriptor
// (embedding, reranker, multilingual, dimensions, limits, validation state),
// the current pinned embedding/reranker binding with effective
// state/origin/version/degraded status, and embedding/reranker selector
// candidate lists restricted to enabled+validated+capability-eligible
// descriptors, as a thin adapter over the Feature 007 registry's
// `semantic.model.*`/`semantic.binding.*`/`semantic.embedding.*`/
// `semantic.reranker.*` commands (never a divergent hardcoded verb set,
// never a second command registry). `embedding-similarity` (profile C) is
// always its own badge and is excluded from the reranker selector (FR30,
// C16, AC34). Text states are always present alongside any color, never
// color-only, mirroring packages/tui/src/operator/langlock/index.tsx
// conventions. Secret material (a provider's `secretRef`) is never part of
// this panel's signal, so it can never be rendered here (FR35, C19).
//
// Live signal: `dialog-settings.tsx` dual-reads `semantic.model.list` +
// `semantic.binding.status`, merges via `mergeSemanticEffective`, and
// projects through `projectSemanticSignal`. The domain-screen status strip
// uses `compact` (binding cards only) so the full models/selectors view
// does not overflow the DialogSelect header. With `signal` omitted the
// component renders `EMPTY_SEMANTIC_PANEL_SIGNAL` — an honest empty state.
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import {
  deriveEmbeddingBindingView,
  deriveEmbeddingSelectorCandidates,
  deriveRerankerBindingView,
  deriveRerankerSelectorCandidates,
  deriveVisibleModelBadges,
  EMPTY_SEMANTIC_PANEL_SIGNAL,
  isEmbeddingEligible,
  isRerankerEligible,
  type SemanticPanelSignal,
} from "./state"
import type { BindingCardView } from "./card"
import type { ModelBadgeRowView } from "./badges"

export {
  deriveEmbeddingBindingView,
  deriveEmbeddingSelectorCandidates,
  deriveRerankerBindingView,
  deriveRerankerSelectorCandidates,
  deriveVisibleModelBadges,
  EMPTY_SEMANTIC_PANEL_SIGNAL,
  isEmbeddingEligible,
  isRerankerEligible,
  MAX_VISIBLE_MODELS,
  mergeSemanticEffective,
  projectSemanticSignal,
  type SemanticPanelSignal,
} from "./state"
export { deriveBindingCardView, type BindingCardView } from "./card"
export { deriveModelBadgeRowView, type ModelBadgeRowView } from "./badges"

function BindingCard(props: { title: string; view: BindingCardView | null }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.text}>
        <b>{props.title}</b>
      </text>
      <Show
        when={props.view}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no binding pinned
          </text>
        }
      >
        {(view) => (
          <>
            <text fg={view().degradedText === "nominal" ? theme.text : theme.warning} wrapMode="none">
              {"  "}state: {view().stateText} · {view().degradedText}
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              {"  "}model: {view().modelDescriptorIdText} · mode: {view().modeText}
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              {"  "}{view().versionText} · origin: {view().originText}
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

function ModelBadgeRow(props: { view: ModelBadgeRowView }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={theme.text} wrapMode="none">
        {props.view.displayNameText} · probe: {props.view.probeStateText} · {props.view.enabledText}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        [{props.view.capabilityBadgesText.join(", ")}] · dims: {props.view.dimensionsText} · {props.view.limitsText}
      </text>
    </box>
  )
}

function SelectorList(props: { title: string; candidates: readonly ModelBadgeRowView[] }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.text}>
        <b>{props.title}</b>
      </text>
      <Show
        when={props.candidates.length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no eligible candidates
          </text>
        }
      >
        <For each={props.candidates}>{(view) => <ModelBadgeRow view={view} />}</For>
      </Show>
    </box>
  )
}

export function SemanticPanel(props: {
  /** Live dual-read projection (`model.list` ∪ `binding.status`); omit → honest empty baseline. */
  signal?: () => SemanticPanelSignal
  /**
   * `compact` — domain-screen status strip: binding cards only (no models /
   * selectors), so the DialogSelect header stays bounded. Default `full` is
   * the View panel with badges + selector candidates.
   */
  variant?: "compact" | "full"
}) {
  const { theme } = useTheme()
  const signal = createMemo<SemanticPanelSignal>(() => props.signal?.() ?? EMPTY_SEMANTIC_PANEL_SIGNAL)
  const badges = createMemo(() => deriveVisibleModelBadges(signal()))
  const embeddingBinding = createMemo(() => deriveEmbeddingBindingView(signal()))
  const rerankerBinding = createMemo(() => deriveRerankerBindingView(signal()))
  const embeddingCandidates = createMemo(() => deriveEmbeddingSelectorCandidates(signal()))
  const rerankerCandidates = createMemo(() => deriveRerankerSelectorCandidates(signal()))
  const compact = () => props.variant === "compact"

  return (
    <box flexDirection="column" flexShrink={0}>
      <BindingCard title="embedding binding" view={embeddingBinding()} />
      <BindingCard title="reranker binding" view={rerankerBinding()} />
      <Show when={!compact()}>
        <Show
          when={badges().length > 0}
          fallback={
            <text fg={theme.textMuted} wrapMode="none">
              {"  "}no model descriptors
            </text>
          }
        >
          <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
            <text fg={theme.text} paddingLeft={1}>
              <b>models</b>
            </text>
            <For each={badges()}>{(view) => <ModelBadgeRow view={view} />}</For>
          </box>
        </Show>
        <SelectorList title="embedding selector" candidates={embeddingCandidates()} />
        <SelectorList title="reranker selector" candidates={rerankerCandidates()} />
      </Show>
    </box>
  )
}
