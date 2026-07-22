# Implementation Plan: Add Always Mode Smart Routing Activation So Routing Engages

## Overview

Give `mode: "always"` real semantics so Smart Routing re-evaluates on every
turn (bypassing the persisted-model short-circuit under `auto`), while keeping
`never` byte-identical to no routing and never overriding an explicit
`--model` / agent pin. Full requirements, activation gates, and acceptance
criteria live in [spec.md](spec.md) for feature
`045-add-always-mode-smart-routing-activation-so-routing-engages`.

## Technical Approach

Touch only the live session model-selection and hierarchy/orchestration gates
already wired by Features 037/042/043/044: `session/prompt.ts` (selected-model
short-circuit), `session/routing-resolve.ts` (activation + drift cache),
`session/routing-hierarchy.ts` (F042 gate), and `session/processor.ts` (F044
completion gate). Treat `always` as a strict superset of `auto` aggressiveness —
admit the same subsystems, plus per-turn re-evaluation when config/pools change
mid-session. No new authority, catalog bump, or parallel routing engine.
