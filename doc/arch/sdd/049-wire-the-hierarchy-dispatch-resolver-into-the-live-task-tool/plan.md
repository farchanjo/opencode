# Implementation Plan: Wire The Hierarchy Dispatch Resolver Into The Live Task Tool

## Overview

Wire the existing hierarchy dispatch resolver into the live LLM `task`-tool
execution path (`SessionTools.resolve` → `TaskTool.execute`) so Features 042 and
048 actually run on real delegations, not only the mention/`handleSubtask`
path. Requirements, precedence, blocked/degraded behavior, and the
command-subtask fix are in [spec.md](spec.md) for feature
`049-wire-the-hierarchy-dispatch-resolver-into-the-live-task-tool`.

## Technical Approach

Inject a per-spawn resolver closure (parent role, depth, main-context model)
into `ctx.extra` at tool-build time; call `resolveHierarchyDispatch` with the
actual spawn prompt inside `TaskTool.execute`. Reuse the same engine, consult
guard, and route→dispatch mapping as `handleSubtask` — no second resolver.
Child model precedence: explicit `task.model` / agent pin → routed model →
parent inheritance. Blocked decisions fail the spawn; force-manager degraded
tier resolution warns then inherits. Fix command-subtask so an unpinned
command does not stamp a parent model that skips hierarchy consult.
