---
status: accepted
date: 2026-07-22
deciders: [farchanjo]
consulted: []
informed: []
---

# Surface Subagent Provider Model Effort And Tokens In Task

## Context and Problem Statement

The completed subagent task line in the TUI shows only toolcall count and
duration. The user needs the executor coordinates (provider/model), the
reasoning effort, and the token usage of the delegated work at a glance.
Where should that data come from — the OTel telemetry backend the routing
plane already exports to, or the in-process session state?

## Decision Drivers

- The displayed values must be authoritative and available at completion time
  with no extra latency or network dependency in the render path.
- The telemetry export is redacted and outbound-only by policy (closed key
  allow-list, content-free); reading it back for UI display would invert that
  design and add an auth surface.

## Considered Options

- Query the OTel backend (vm.services) at render time for the child span's
  attributes.
- Stamp the values into the task part's metadata envelope at completion, from
  the in-process session record and effective config, and render from there.

## Decision Outcome

Chosen option: metadata-envelope stamping, because the task tool already
stamps `model: {providerID, modelID}` at spawn and the TUI already renders
exclusively from part metadata; the child session row already accumulates the
authoritative token counters; and a telemetry read-back would add a network
dependency, an auth surface, and a redaction conflict for data that is local.

### Consequences

- Good: zero new I/O in the render path; the line degrades field-by-field to
  the current shape when keys are absent (byte-identical floor).
- Good: effort resolution is config-derived at spawn (the same source the LLM
  request path consumes) — no fabricated values.
- Neutral: in-flight (running) task lines keep today's shape; only the
  completed line is enriched.
- Bad: cost (USD) stays out of scope — token counters only.
