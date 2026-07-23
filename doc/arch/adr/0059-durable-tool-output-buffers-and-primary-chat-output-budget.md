---
status: superseded
date: 2026-07-23
deciders: [opencode-operator]
consulted: []
informed: []
---

# Durable Tool Output Buffers And Primary Chat Output Budget (stub)

## Context and Problem Statement

A draft Feature 059 was created as an empty scaffold. The real specify/plan/tasks
loop landed on Feature 060 with a fuller slug.

## Decision Drivers

- Avoid shipping placeholder tokens in the corpus
- Keep permanent searchability of the 059 number as a supersession pointer

## Considered Options

- **A — Supersede 059 by 060 and implement only 060.** Chosen.
- **B — Manually renumber 060 down to 059.** Rejected for this pass; compact later if desired.

## Decision Outcome

Chosen option: **A**. See ADR-0060 and Feature 060 for the accepted design.

### Consequences

- Good: no empty draft placeholders remain under 059.
- Good: Feature 060 carries the full accepted design and implementation tasks.
- Neutral: numbering gap 059→060 remains until a future compact; archive retains 059 permanently.

## Related

- Superseded by: [ADR-0060](./0060-durable-tool-output-buffers-and-primary-agent-console-chat.md)
- Feature: [060 spec](../sdd/060-durable-tool-output-buffers-and-primary-agent-console-chat/spec.md)
