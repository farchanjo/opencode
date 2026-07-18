---
status: proposed
date: 2026-07-18
deciders: [opencode-core]
consulted: []
informed: []
---

# Semantic Tool Search Over the Shared Feature 006 Retrieval Stack

## Context and Problem Statement

OpenCode exposes tools to the model by set membership, not relevance. The
ToolRegistry hands the model the full permission-visible set filtered only by
Wildcard allow/deny rules and a few model-specific toggles
(`packages/opencode/src/tool/registry.ts` `tools()`, `Permission.visibleTools`),
MCP tools are merged the same way (`packages/opencode/src/mcp/catalog.ts`,
`packages/opencode/src/mcp/index.ts` `tools()`), and code-mode renders the entire
MCP catalog (`packages/opencode/src/tool/code-mode.ts` `describeCatalog`). No lexical
ranking or semantic retrieval for tools exists today. As the native, MCP, and
code-mode tool surfaces grow, exposing the whole set degrades tool selection quality
and inflates context. Feature 009 must add relevance-ranked tool search across every
surface. The decision is how to add it without creating a second embedding/rerank
stack, a second Milvus adapter, or a second operator control surface, and without
ever making tool availability worse than today when the semantic stack is down.

## Decision Drivers

- Single semantic stack: reuse the Feature 006 embedding/reranker models, Milvus
  backend/adapter, and operator-pinned bindings; no second stack or model-selection
  surface.
- Honest degradation: tool exposure must never hard-fail; it must fall back to
  lexical-only and then to the current permission-visible full set.
- Permission is authority: the semantic layer must never widen visibility beyond
  Permission/Policy, and must revalidate candidates against live core state.
- One retrieval seam for all three tool surfaces (native, MCP, code-mode) with a
  deterministic, bounded ranking contract.
- Content-free telemetry and Feature 007 operator-only administration, reusing the
  existing `semantic.*` reserved catalog with no new command IDs.

## Considered Options

- **Option A — Extend the Feature 006 stack with a `tools` collection.** Add a Milvus
  `tools` collection alongside `agents`/`skills`/`skill_chunks`, index the canonical
  tool corpus (id, description, sanitized parameter-schema projection, permission
  metadata, language tag, content hash), and add a tool-scoped hybrid retrieval seam
  that reuses the pinned embedding/reranker bindings, the degradation ladder, and the
  telemetry conventions. Reindex triggers on registry change and on the Feature 008
  `mcp.tools_changed` event.
- **Option B — A standalone tool-search index and its own embedder/reranker.** Build a
  dedicated retrieval service for tools independent of Feature 006, with its own model
  selection, index, and operator controls.
- **Option C — Lexical-only ranking with no embeddings.** Rank tools by name/description
  keyword or BM25 matching only, without dense retrieval or reranking.

## Decision Outcome

Chosen option: "Option A — Extend the Feature 006 stack with a `tools` collection",
because it delivers relevance-ranked tool search across all three surfaces while
reusing exactly one embedding/rerank stack, one Milvus adapter, one set of pinned
bindings, and one operator control plane. Option B duplicates the semantic
infrastructure and operator surface that Feature 006 and Feature 007 already own,
violating the single-authority posture and doubling maintenance and drift risk.
Option C cannot satisfy the multilingual and semantic-relevance requirement (a pt-BR
query against English tool descriptions) and is retained only as the middle rung of
the degradation ladder, not as the primary design.

### Consequences

- Good: One semantic stack, one operator surface (reused `semantic.*` catalog, no new
  command IDs), consistent ranking across native/MCP/code-mode, and multilingual tool
  retrieval that degrades honestly to lexical-only and then to the current full-set
  floor so tool availability is never worse than today.
- Bad: Feature 009 is coupled to Feature 006 delivery and to the operator-pinned
  bindings; tool retrieval quality tracks the shared stack's health, and a new `tools`
  collection adds index lifecycle (content-hash upsert, tombstones, blue/green on
  embedding cutover) that must stay reconciled with ToolRegistry and the Feature 008
  MCP catalog.
