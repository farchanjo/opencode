# Statechart: Smart Routing Decision Lifecycle

This statechart models the lifecycle of a single smart-routing decision, from
task admission through classification, hard gates, ranking, persistence,
hierarchical dispatch, and fallback. It is the state-machine view of the
pipeline in `../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/plan.md`
(section "State machines") and the flow diagrams in
`../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/hierarchy-flow.md`.

Hard gates are authoritative over any decision-model recommendation. Ranking
selects only from the authorized candidate set. A decision commits atomically
before dispatch, and fallback classifies the execution boundary so a
mutation-risky candidate is never blindly retried.

```mermaid
stateDiagram-v2
    [*] --> Classifying: task admitted

    Classifying --> HardGates: taskClass and routingProfile resolved
    Classifying --> Blocked: routing disabled or unavailable

    HardGates --> Ranking: authorized candidate set non empty
    HardGates --> NoCandidate: every candidate rejected

    Ranking --> DecisionModel: decision model policy required
    Ranking --> Selecting: bypass policy met

    DecisionModel --> Selecting: candidate chosen from authorized pool

    Selecting --> Persisting: top ranked candidate selected

    Persisting --> Dispatching: atomic commit succeeded
    Persisting --> NoCandidate: commit failed before journal flag

    Dispatching --> DirectWorker: routingProfile direct_worker
    Dispatching --> ManagerPath: routingProfile manager

    DirectWorker --> Validating: worker result returned
    ManagerPath --> Validating: manager synthesis returned

    Validating --> Completed: validation passed and Todo completed
    Validating --> Fallback: execution failure or low confidence

    Fallback --> ClassifyBoundary: classify execution boundary
    ClassifyBoundary --> MutationRisky: boundary mutation_risky
    ClassifyBoundary --> Retryable: boundary retryable

    MutationRisky --> Failed: explicit error no blind retry
    Retryable --> Ranking: retry authorized compatible candidate
    Retryable --> NoCandidate: no authorized candidate remains

    NoCandidate --> Failed: explicit no_authorized_candidate error

    Completed --> [*]
    Failed --> [*]
    Blocked --> [*]
```
