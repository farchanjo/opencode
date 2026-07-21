---
status: accepted
date: 2026-07-21
deciders: [opencode-maintainers]
consulted: []
informed: []
---

# Always-mode Smart Routing activation

## Context and Problem Statement

The routing activation enum `#RoutingMode` has three values —
`never | auto | always` — but only `never` and `auto` have distinct behavior.
Under `auto`, the routing engine resolves an implicit default model ONCE per
session: the first turn routes (the session has no model), the chosen model is
persisted onto the first user message, and every later turn's
`selectedModel(sessionID)` returns that persisted model — short-circuiting
routing (`prompt.ts`, the `selected` guard) — a deliberate drift guard so a long
conversation never flips models mid-stream. The three downstream routing seams
gate on `mode === "auto"`: implicit-default model resolution
(`routing-resolve.ts:372`), per-subagent hierarchy delegation
(`routing-hierarchy.ts:369`), and the Manager completion gate
(`processor.ts:569`). Budget enforcement alone already gates on
`mode !== "never"` (`processor.ts:53`), an intentional Feature 043 divergence.

The consequence: an operator who changes a role pool, a budget, or any routing
config mid-session sees no effect until a NEW session. The `always` enum value —
already selectable in the operator Auto/Always/Never picker
(`configure-backend.ts:50`) — exists for exactly this "re-evaluate every turn"
intent but is INERT: it behaves identically to `auto`, a silent no-op that makes
the feature a lie. We must give `always` real semantics without regressing
`auto`, `never`, or the explicit-model invariant.

## Decision Drivers

- **`always` must not be a no-op.** Selecting it must change behavior — routing
  re-evaluates every turn so a config change takes effect on the next turn without
  a new session.
- **The explicit-model invariant is inviolable.** An explicit `--model` or an
  agent-pinned model must ALWAYS win, in every mode — routing never overrides it.
- **`never` / disabled must not run routing** — no re-evaluation and no routing
  work of any kind; the ONLY per-turn cost is the shared, bounded, TTL-cached
  in-memory mode read on a persisted-model turn (see the decision outcome), so
  there is no filesystem I/O and no material added latency.
- **No partial activation.** `always` must be a coherent SUPERSET of `auto` across
  every routing subsystem (resolution, hierarchy, orchestration, budget), never a
  mode that silently drops a gate.
- **Hang/crash-safety (Feature 037 contract).** The per-turn re-evaluation and any
  added config read must be bounded and degrade to the static-default / no-op path;
  no new deadlock or per-turn hang.

## Considered Options

- **Option A — behavioral `always`: converge the mode gates on `mode !== "never"`
  and re-evaluate per turn.** Give `always` its own semantics: the session
  model-selection seam consults routing every turn (bypassing the persisted-model
  short-circuit) under `always`; the resolver bypasses its drift cache under
  `always`; and the three `mode === "auto"` gates move to `mode !== "never"`,
  joining budget so all four subsystems admit `always`.
- **Option B — decode-time alias: rewrite `always → auto` in the config adapter.**
  Treat `always` as a synonym for `auto` at decode time, so the picker "works"
  without any seam change.
- **Option C — a separate `reevaluate_every_turn` boolean alongside `mode`.** Leave
  `mode` as `auto`/`never` and add a new config flag for per-turn re-evaluation.

## Decision Outcome

Chosen option: **Option A — behavioral `always` with converged mode gates**,
because it is the only option that delivers the operator-visible value (a config
change takes effect next turn) while keeping the existing enum, one config SSOT,
and the safety contract.

The mechanism:

1. **Re-evaluation seam (`prompt.ts`).** A pure `shouldConsultRouting({explicitModel,
   hasPersistedModel, mode})` decides whether to consult the resolver:
   `!explicitModel && (!hasPersistedModel || mode === "always")`. The mode is read
   (hang-safe, `createRoutingActivationReader`) only when a persisted model would
   otherwise short-circuit routing AND no explicit model is present (msg2+). The
   mode is unknowable without reading it, so this read fires on every such
   persisted-model turn in ALL modes (never/auto/always) — not only `always`; msg1
   (no persisted model) skips it and is byte-identical to pre-045. The read is
   cheap and hang-proof: `config.get`/`getGlobal` are TTL-cached in memory (no
   filesystem I/O per turn) and it is triple-guarded (`.catch`→"never",
   `timeoutOrElse` 1.5s→"never", `catchCause`→"never"). Model precedence becomes
   `--model / agent-pinned ▶ routed ▶ persisted (selected) ▶ static default`
   (`routed ?? selected`), which is unchanged for `auto` (at most one of the two is
   set) and orders re-evaluation ahead of the stale persisted model only under
   `always`.
2. **Resolver drift-cache bypass (`routing-resolve.ts`).** The resolver reads the
   mode first; it memoizes (reads/writes the drift cache) ONLY under `auto`. Under
   `always` it re-evaluates fresh every turn. Reading mode first closes the
   `auto → always` mid-session flip: an entry can only ever be memoized in `auto`.
3. **Gate convergence.** `routing-resolve.ts:372`, `routing-hierarchy.ts:369`, and
   `processor.ts:569` move from `mode === "auto"` to `mode !== "never"`, joining
   `processor.ts:53`. `always` is thereby a strict superset of `auto`. Because
   hierarchy dispatch now fires under `always`, the orchestration aggregate is
   populated under `always`, so the completion gate MUST fire too — otherwise a
   Manager could report complete with a foreground delegated Worker still pending;
   moving `processor.ts:569` keeps the ADR-0044 foreground/background reconciliation
   intact.
4. **Safety.** The mode read is bounded (`Effect.timeout → "never"`) and degrades on
   any crash/rejection to `"never"` (no-op); the resolver's `RESOLVE_TIMEOUT_MS` and
   degrade-to-`undefined` are unchanged. No deadlock, no per-turn hang.

### Rejected alternatives

- **Option B (decode-time alias `always → auto`)** was rejected because it makes
  `always` LITERALLY equal to `auto` — the exact no-op this feature exists to fix.
  It re-evaluates NOTHING per turn (the persisted-model short-circuit still fires),
  so an operator's mid-session config change still takes no effect until a new
  session. It also destroys the operator's ability to distinguish the two levels
  and silently discards the persisted `always` value.
- **Option C (a separate `reevaluate_every_turn` flag)** was rejected because it
  introduces a second, redundant activation axis parallel to a three-value enum
  that already carries the exact intent (`always`), widening the config surface and
  the test matrix (mode × flag) for no gain, and leaving `always` still a no-op.

### Consequences

- Good: `always` becomes a real, operator-visible activation level — a role / pool
  / config change takes effect on the next turn without a new session; the mode
  gates converge (one predicate, `mode !== "never"`, across resolution / hierarchy
  / orchestration / budget), removing the pre-045 divergence.
- Good: every first turn (no persisted model) is byte-identical to pre-045 in all
  modes; `auto`/`never` routing BEHAVIOR is unchanged (auto still short-circuits on
  the persisted model; never still runs no routing); the explicit-model invariant
  holds in every mode; the safety contract is inherited, not weakened.
- Bad / trade-off: on a persisted-model turn with no explicit model (msg2+), ALL
  modes (never/auto/always) now incur ONE shared, bounded, TTL-cached in-memory
  mode read — because `always` cannot be distinguished from `auto`/`never` without
  reading the mode. It is not filesystem I/O and is triple-guarded (degrades to
  "never"), so the cost is negligible and cannot hang; it is the price of a single
  activation enum carrying the re-evaluation intent (versus a separate flag, Option
  C). Beyond that read, only `always` pays the actual routing re-evaluation on each
  such turn (bounded by `RESOLVE_TIMEOUT_MS`, degrading to the static default);
  under `always` the resolver additionally performs redundant-but-harmless mode
  resolves at its own `boundMode` gate and the `resolveOnce` gate. An operator who
  wants stable per-session model choice should keep `auto`.
- Bad / trade-off: the operator status indicator (`backend-live.ts:107`
  `auto: mode === "auto"`) reports `auto: false` under `always`; a generic
  "routing active" indicator is deferred (out of scope), so the status strip does
  not yet distinguish `always` from `never` on that one field.
