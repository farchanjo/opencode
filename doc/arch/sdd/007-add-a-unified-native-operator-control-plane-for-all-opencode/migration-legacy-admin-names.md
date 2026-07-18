# Migration: legacy admin-like command names (T043)

**Catalog version:** `1.0.0` — always read live `RESERVED_CATALOG_VERSION` from
`@opencode-ai/core/operator` (do not hardcode a second copy in integrators).  
**Policy:** `warn_existing_reject_new` · **autoRename:** false · **autoDelete:** false  
**Parent:** [reserved-catalog-v1.md](reserved-catalog-v1.md)

## Summary

Operator reserved IDs (`/op.*`, catalog dotted IDs, aliases) and a narrow set of
legacy admin-like names must not be registered by plugins, MCP tools, or custom
slash/palette commands. Collisions fail closed with structured `reserved_name`
errors — **no silent rename**. Existing legacy admin-like names get a **one-release
warning**; new registrations of those names are rejected.

## Dry-run (native CLI)

```bash
# Versioned report only — does not rename or delete
opencode op migrate dry-run admin settings-admin my-notes langlock.status --json
```

Report fields:

| Field            | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| `catalogVersion` | `RESERVED_CATALOG_VERSION`                                |
| `reject`         | Hard collision with reserved catalog / `/op.*`            |
| `warn`           | Exact legacy admin-like (existing may remain one release) |
| `clean`          | Safe names                                                |
| `autoRename`     | always `false`                                            |
| `autoDelete`     | always `false`                                            |

## Legacy classifier (narrow)

Exact names (case-insensitive):

- `admin`, `settings-admin`, `op-admin`, `operator`, `control-plane`
- `mcp-admin`, `semantic-admin`, `operator-admin`

Plus token-boundary suffix only: `*-admin` / `*.admin`  
**Not** mid-string substring matches (e.g. `read-admin-notes` is **clean**).

## Existing vs new

| Kind                       | Existing registration | New registration |
| -------------------------- | --------------------- | ---------------- |
| Reserved catalog / `/op.*` | Reject / fail load    | Reject           |
| Legacy admin-like          | Warn one release      | Reject           |
| Clean                      | Keep                  | Allow            |

## Enable operator control plane (T041)

Native non-LLM path (writes `experimental.operator_control_plane` via Config.Service):

```bash
opencode op flag show
opencode op flag enable --yes
opencode op flag disable --yes
```

Precedence: sandbox `OPENCODE_DEV_OPERATOR_=1` → env `OPENCODE_OPERATOR_CONTROL_PLANE` → config → default off.
