# Implementation Plan: Expose The Hierarchy Capability And Budget Operator Config

## Overview

Expose every `RoutingConfig.Enforcement` leaf under `budget`, `hierarchy`, and
`capability` for read and write on both the `op` CLI and the operator TUI,
driven by one shared leaf registry so the surfaces cannot drift. Requirements,
leaf inventory, CAS/scope rules, and acceptance criteria are in
[spec.md](spec.md) for feature
`046-expose-the-hierarchy-capability-and-budget-operator-config`.

## Technical Approach

Extend the existing budget/smart/pools operator path (Config.Service authority,
Feature 034 scope flag, CAS via `mutateAuthority`) rather than inventing a new
admin store. A single leaf registry (path, label, kind, bounds, enums) drives CLI
parse/validation and TUI field declarations; reads project effective layered
config; writes persist only the leaves the operator set, merged onto fresh
on-disk routing config. No parallel command registry, no catalog bump.
