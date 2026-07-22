# Implementation Plan: Add An Always On Three Tier Architect Manager Worker

## Overview

Add an opt-in `hierarchy.orchestration_mode` (`heuristic` default |
`force_manager`) so every Architect task can flow Architect → Manager →
Worker(s) → Manager → Architect on per-tier role-pool models, while leaving the
heuristic path byte-identical. Requirements, five force-manager wiring fixes,
and acceptance criteria are in [spec.md](spec.md) for feature
`048-add-an-always-on-three-tier-architect-manager-worker`.

## Technical Approach

Gate `force_manager` on Smart Routing activation (`enabled` and `mode != never`)
and on the new enforcement field. On that path only: unconditional Manager
classification on Architect edges, honor `hierarchy.max_depth` for the
Architect→Manager→Worker depth guard, surface (not silently inherit) unresolved
tier pool models, inject a Manager persona for decomposition, and keep the
engine `MAX_DELEGATION_DEPTH` leaf rule. Heuristic thresholds, silent fallback,
and plain-subagent depth default of 1 stay untouched.
