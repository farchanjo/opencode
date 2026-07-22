# opencode — Grok Build Guide

Guidance for Grok Build / Grok Code when working in this repository.
`AGENTS.md` is the canonical, tool-agnostic project map; this file adds
Grok-specific notes. When the two overlap, `AGENTS.md` wins.

Prune as you go: when the code moves on, refresh what drifted and delete dead
sections and stale path references — keep this file lean, do not only append to
it.

## Project

opencode is a spec-driven project managed with speckit. On `fcustom`,
`AGENTS.md` and the constitution are canonical; `doc/arch` is the source of
truth. Drive the protocol with the installed `speckit` binary and preserve
local package rules (never invent control-plane state).
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
speckit context score   # score AGENTS.md / CLAUDE.md / GROK.md / llms.txt
```

## Speckit CLI surface

Contract terms: exit code, `--json`, guard, validate. Config families: project,
git, guard, context, dedupe, adr, stats, semantic, gitlab, hygiene, compliance,
workflow, privacy (`speckit config list|get|set|unset|drift`).

- `speckit init` · `speckit constitution` · `speckit specify` · `speckit clarify`
- `speckit plan` · `speckit plan setup` · `speckit tasks` · `speckit tasks setup`
- `speckit analyze` · `speckit implement`
- `speckit feature` · `speckit feature new` · `speckit feature list` · `speckit feature select`
- `speckit feature renumber` · `speckit feature reorder` · `speckit feature insert`
- `speckit feature compact` · `speckit feature archive` · `speckit feature restore`
- `speckit status` · `speckit next` · `speckit validate` · `speckit explain` · `speckit verify`
- `speckit search` · `speckit diagram` · `speckit diagram render`
- `speckit workflow` · `speckit workflow render`
- `speckit guard` · `speckit guard check` · `speckit guard hook`
- `speckit hook` · `speckit hook session-start` · `speckit hook user-prompt`
- `speckit hook post-edit` · `speckit hook pre-commit`
- `speckit config` · `speckit config list` · `speckit config get` · `speckit config set`
- `speckit config unset` · `speckit config drift`
- `speckit on` · `speckit off` · `speckit check` · `speckit reindex` · `speckit migrate`
- `speckit version` · `speckit completions` · `speckit guide` · `speckit generate` · `speckit manual`
- `speckit context` · `speckit context score` · `speckit context pack`
- `speckit spec` · `speckit spec score` · `speckit dedupe`
- `speckit stats` · `speckit stats findings` · `speckit stats guard` · `speckit stats profile`
- `speckit stats attributes` · `speckit stats compliance` · `speckit stats corpus`
- `speckit stats recommendations`
- `speckit semantic` · `speckit semantic enable` · `speckit semantic off`
- `speckit semantic status` · `speckit semantic deep-status` · `speckit semantic eval`
- `speckit model` · `speckit model list` · `speckit model add` · `speckit model fetch`
- `speckit model check` · `speckit model select` · `speckit model remove` · `speckit model api`
- `speckit pack` · `speckit pack add` · `speckit pack list` · `speckit pack update`
- `speckit pack remove` · `speckit pack export` · `speckit pack import`
- `speckit library` · `speckit library add` · `speckit library list` · `speckit library show`
- `speckit library validate` · `speckit library update` · `speckit library remove`
- `speckit library ask` · `speckit library search` · `speckit library open`
- `speckit library extract` · `speckit library export` · `speckit library import`
- `speckit library serve` · `speckit library browse`
- `speckit mermaid` · `speckit mermaid render`
- `speckit gitlab` · `speckit gitlab sync` · `speckit gitlab status`
- `speckit missing` · `speckit brief` · `speckit ask`
- `speckit commit` · `speckit commit check` · `speckit commit suggest` · `speckit dismiss`
- `speckit license` · `speckit license list` · `speckit license show`
- `speckit license set` · `speckit license check`

## Grok Build integration

- Always invoke the **installed `speckit` binary** for status, next, validate,
  guard, and scoring — do not approximate the control plane by reading or
  writing `doc/.specify/` databases by hand.
- Prefer project-local facts from `AGENTS.md` over generic training knowledge
  when they conflict.
- Use Grok Build tools for local edits and shell; keep network, secrets, and
  remote hosts behind the project's declared ports and policies.
- Root docs `README.md`, `AGENTS.md`, `CLAUDE.md`, and `GROK.md` are in derived
  guard scope so maintenance edits are allowed without opening the whole tree.

## Conventions

- Respect the guard policy (`[guard]` in `doc/arch/speckit.toml`). If a write is
  denied, the target is outside the active spec scope — do not disable the
  guard; adjust the scope or revise the plan.
- Follow `specify → clarify` (when needed) `→ plan → tasks → analyze →
  implement → validate`, after checking status/next, active feature, and guard.
- Use incremental validation and the repository hook; record changed decisions
  in the applicable artifact.
- Do not implement Smart Routing while alternatives remain open or without
  explicit authorization.
- Keep `AGENTS.md`, `GROK.md`, `README.md`, and the `doc/arch` corpus in sync
  with code; persist all artifacts in English.

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
