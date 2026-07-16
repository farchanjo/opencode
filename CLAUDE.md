# opencode — Claude Code Guide

Guidance for Claude Code (claude.ai/code) when working in this repository.
`AGENTS.md` is the canonical, tool-agnostic project map; this file adds
Claude-specific notes. When the two overlap, `AGENTS.md` wins.

Prune as you go: when the code moves on, refresh what drifted and delete dead
sections and stale path references — keep this file lean, do not only append to
it.

## Project

opencode is a spec-driven project managed with speckit. On `fcustom`,
`AGENTS.md` and the constitution are canonical; treat `doc/arch` as the source
of truth, and preserve all local package rules below the root.
The constitution is `doc/arch/memory/constitution.md`; this generated guide
must not diverge from `AGENTS.md`.

## Architecture

Authoritative layout (see `AGENTS.md` for the annotated tree):

```
doc/arch/
├── adr/              # decision records — read these first
├── schemas/          # CUE schemas
├── specs/features/   # Gherkin behavior specs
├── architecture/     # C4 model + diagrams
└── sdd/              # active-feature working dirs (NNN-slug)
```

## Commands

```
speckit status      # active feature + current workflow phase
speckit next        # the recommended next command
speckit validate    # validate the doc/arch corpus before committing
<build-command>     # project build — fill in the real command
<test-command>      # project tests — fill in the real command
```

## Conventions

- Respect the guard policy (`[guard]` in `doc/arch/speckit.toml`). If a write is
  denied, the target is outside the active spec scope — do not disable the
  guard; adjust the scope or revise the plan.
- Follow the spec-driven workflow: specify → clarify (when needed) → plan →
  tasks → analyze → implement → validate, after checking status/next and the
  active-feature guard.
- Use incremental validation and the repository hook. Record changed
  decisions in the applicable artifact.
- Do not implement Smart Routing while alternatives remain open or without
  explicit authorization.
- Keep `AGENTS.md`, `README.md`, and the `doc/arch` corpus in sync with code;
  persist all artifacts in English.

## Spec-first protocol

The deterministic loop — never skip a step, never guess:

- Before any work, run `speckit status`, then `speckit next`; execute exactly
  the phase it points to — no more, no less.
- `speckit validate` must be green before every commit.
- The source of truth is `doc/arch`: spec > code > assumption. Never guess —
  read the spec.
- The guard denies writes outside the active scope; never bypass it and never
  edit `doc/.specify/` state by hand.
- A red `validate`/`check` blocks everything: fix the artifact, never the rule.

### Git workflow

- Commit after every logical change; never batch unrelated edits into a single
  commit. The git history is part of the spec corpus — keep it legible.
- Write Angular Conventional Commit headers: `<type>(<scope>): <subject>`, with
  a short, objective subject (keep the header line at most 72 characters).
- Never bypass speckit gates (guard, `validate`, `verify`) to force a commit
  through — fix the spec or adjust the scope instead.
- Never add AI attribution — AI co-author trailers, "generated with" notices, or
  assistant session links — to code, docs, or commit messages; this is a
  compliance mandate (ADR-0026).
- If such attribution slips in, strip it with an interactive rebase before you
  push the branch.
