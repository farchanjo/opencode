# Tasks: Add An Always On Three Tier Architect Manager Worker

## Task Breakdown

- [x] T001 Add the `orchestration_mode` enum (`heuristic` | `force_manager`) to
  `RoutingConfig.Enforcement.hierarchy` as an optional field, plus the
  `orchestrationModeOf` resolver defaulting an absent value to `heuristic`
  (`packages/schema/src/routing/config.ts`), and mirror it in the CUE schema
  (`doc/arch/schemas/routing/config.cue`). Set the default config explicitly to
  `heuristic` (`config-adapter.ts` `DEFAULT_ROUTING_CONFIG`).
- [x] T002 Expose `orchestrationMode` as a hierarchy enum leaf in the shared F046
  enforcement-leaf registry (`packages/protocol/src/enforcement/leaves.ts`), so it
  is read/settable through both the `op` CLI and the TUI unchanged.
- [x] T003 Fix 1 — thread an orchestration mode into `classifyChildRole` and force
  the Architect edge to a Manager under `force_manager`, preserving the
  analyzer-derived `requestedFanout` (`session/routing-hierarchy.ts`).
- [x] T004 Fix 2 — make `reconcileDepthCeiling` `subagent_depth`-aware and
  `force_manager`-gated so an unset `subagent_depth` honors `hierarchy.max_depth`
  (the Manager -> Worker hop passes) while the heuristic and non-hierarchy paths
  keep the legacy default of 1 (`tool/task.ts`; call site updated).
- [x] T005 Fix 3 — surface an unresolved tier model under `force_manager` as a
  typed `degraded` decision the spawn seam warns on before parent inheritance;
  keep the heuristic silent `undefined` fallback (`session/routing-hierarchy.ts`,
  `session/prompt.ts`).
- [x] T006 Fix 4 — inject the Manager persona prelude on a manager-role spawn
  under `force_manager` via the pure `applyManagerPersona` helper (`tool/task.ts`);
  thread `forceManager` through the dispatch extra (`session/prompt.ts`).
- [x] T007 Fix 5 — confirm Manager/Worker tiers resolve their pool models through
  the SAME `resolveProviderForModel` the top-level F037 path uses (no divergent
  resolver); cover it with a regression test.
- [x] T008 Unit tests (`test/session/routing-hierarchy.test.ts`): force_manager
  classification, the depth-ceiling Manager -> Worker hop, the surfaced
  `model_unresolved` degrade, the Manager persona injection, explicit-model wins,
  Worker-leaf non-delegation, and byte-identical heuristic behavior.

## Dependencies

- Composes with the shipped F037 (top-level routing resolution), F042 (hierarchy
  dispatch seam), F043 (budget/fan-out admission), F044 (completion gate +
  `WORKER_MAX_WAIT_MS`), F045 (activation modes), and F046 (enforcement-leaf
  registry); all are already in the tree. No external systems or new services.
</content>
