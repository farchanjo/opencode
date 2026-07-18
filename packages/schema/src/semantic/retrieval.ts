export * as Retrieval from "./retrieval"

import { Schema } from "effect"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { Profile } from "./profile"
import { Refs } from "./refs"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/retrieval.cue and retrieval-result.cue
// one-to-one. RetrievalRequest, Candidate and SemanticScore are the request and
// result value objects of the immutable nine-stage pipeline (FR3, C2). Hybrid recall
// uses retrieval_top_k and rerank runs only on the reduced rerank_top_k set (FR19).
// Ties break by the stable total order rerank -> dense -> sparse -> canonical id
// (FR19, C2). A candidate carries a ranking pointer into live core state, never an
// embedded Entity, and is revalidated after retrieval (FR20, C11). The rerank
// component is null on reranker outage and ranking proceeds without it (FR24, AC8).
// RetrievalResult carries the typed degradation ladder rung; a degraded outcome is
// never a silent model substitution (FR24, C14, C20, AC29).

// RetrievalRequest carries the profile, target collection, top_k windows and consistency (FR3, FR19, C8).
export const RetrievalRequest = Schema.Struct({
  profile: Profile.TaskProfile,
  collection: EnumsState.Collection,
  retrieval_top_k: Values.TopK,
  rerank_top_k: Values.TopK,
  consistency: Enums.Consistency,
  mode: EnumsState.RetrievalMode,
}).annotate({ identifier: "SemanticRetrieval.RetrievalRequest" })
export type RetrievalRequest = Schema.Schema.Type<typeof RetrievalRequest>

// ScoreComponents carries the rerank (nullable on outage), dense and sparse components (FR19, C2, AC8).
export const ScoreComponents = Schema.Struct({
  rerank: Schema.NullOr(Values.RerankScore),
  dense: Values.DenseScore,
  sparse: Values.SparseScore,
}).annotate({ identifier: "SemanticRetrieval.ScoreComponents" })
export type ScoreComponents = Schema.Schema.Type<typeof ScoreComponents>

// ScoreProvenance carries the degradation mode, gap and effective binding/generation (FR22, C20).
export const ScoreProvenance = Schema.Struct({
  mode: EnumsState.RetrievalMode,
  gap: EnumsState.DegradationGap,
  binding_version: Values.BindingVersion,
  generation_id: Ids.GenerationId,
}).annotate({ identifier: "SemanticRetrieval.ScoreProvenance" })
export type ScoreProvenance = Schema.Schema.Type<typeof ScoreProvenance>

// SemanticScore carries the composite score, components, confidence and provenance (FR22).
export const SemanticScore = Schema.Struct({
  composite: Values.Score,
  components: ScoreComponents,
  confidence: Values.Confidence,
  provenance: ScoreProvenance,
}).annotate({ identifier: "SemanticRetrieval.SemanticScore" })
export type SemanticScore = Schema.Schema.Type<typeof SemanticScore>

// Candidate carries a ranking pointer, collection, score, rank and freshness bucket (FR20, FR22, C11).
export const Candidate = Schema.Struct({
  candidate_ref: Schema.Union([Refs.AgentRef, Refs.SkillRef]),
  collection: EnumsState.Collection,
  score: SemanticScore,
  rank: Values.TopK,
  freshness: EnumsEvent.FreshnessBucket,
}).annotate({ identifier: "SemanticRetrieval.Candidate" })
export type Candidate = Schema.Schema.Type<typeof Candidate>

// CandidateList is the first-class collection of ranked candidates bounded by top_k (FR19, NFR3, C8).
export const CandidateList = Schema.Array(Candidate).annotate({ identifier: "SemanticRetrieval.CandidateList" })
export type CandidateList = typeof CandidateList.Type

// DegradationOutcome carries the ladder mode, typed capability gap and an explicit reason (FR24, C20, AC29).
export const DegradationOutcome = Schema.Struct({
  mode: EnumsState.RetrievalMode,
  gap: EnumsState.DegradationGap,
  degraded_reason: Schema.NullOr(TextValues.DegradedReason),
}).annotate({ identifier: "SemanticRetrieval.DegradationOutcome" })
export type DegradationOutcome = Schema.Schema.Type<typeof DegradationOutcome>

// RetrievalResult carries the ranked candidates, effective mode, degradation outcome and fingerprint (FR3, FR24, C20).
export const RetrievalResult = Schema.Struct({
  candidates: CandidateList,
  mode: EnumsState.RetrievalMode,
  outcome: DegradationOutcome,
  fingerprint: TextValues.Fingerprint,
}).annotate({ identifier: "SemanticRetrieval.RetrievalResult" })
export type RetrievalResult = Schema.Schema.Type<typeof RetrievalResult>
