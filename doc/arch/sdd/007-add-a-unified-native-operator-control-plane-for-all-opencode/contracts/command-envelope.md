# Contract: Operator Command Envelope (Feature 007)

## Request

```json
{
  "id": "langlock.status",
  "principal": { "kind": "operator", "subject": "local", "projectBinding": "proj_1" },
  "scope": { "kind": "project", "ref": "proj_1" },
  "version": "cas_optional_for_queries",
  "idempotencyKey": "uuid-for-mutations",
  "confirm": false,
  "source": "cli",
  "payload": {}
}
```

## Success response

```json
{
  "ok": true,
  "id": "langlock.status",
  "version": "cas_v12",
  "effective": { "language": "en-US", "origin": "project" },
  "outcome": "success",
  "auditId": "evt_…"
}
```

## Error response

```json
{
  "ok": false,
  "id": "semantic.embedding.cutover",
  "outcome": "confirmation_required",
  "error": {
    "code": "confirmation_required",
    "message": "cutover requires confirm=true",
    "retryable": false
  }
}
```

## Error taxonomy (closed)

| Code                    | HTTP (API) | Meaning                                                                      |
| ----------------------- | ---------- | ---------------------------------------------------------------------------- |
| `unauthorized`          | 401        | Missing/invalid operator principal                                           |
| `forbidden_scope`       | 403        | Scope not allowed or cross-project                                           |
| `conflict`              | 409        | CAS version mismatch                                                         |
| `idempotent_replay`     | 200        | Same key returns prior success body                                          |
| `invalid_argument`      | 400        | Schema/payload failure                                                       |
| `reserved_name`         | 409        | Collision with reserved operator ID                                          |
| `confirmation_required` | 400        | Listed mutation without confirm                                              |
| `unavailable`           | 503        | Flag off, offline matrix, backend missing, or bounded audit scan fail-closed |
| `secret_backend`        | 503        | Keychain/env-ref failure                                                     |
| `transport_error`       | 502        | Transport failure distinct from unavailable                                  |
| `not_implemented`       | 501        | Domain port stub only                                                        |

### Outcomes (not all are error codes)

| Outcome             | HTTP | Meaning                                              |
| ------------------- | ---- | ---------------------------------------------------- |
| `success`           | 200  | Completed                                            |
| `idempotent_replay` | 200  | Prior success for same key                           |
| `audit_pending`     | 202  | CAS committed; audit outbox not yet published (T024) |

Integrator catalog: [../reserved-catalog-v1.md](../reserved-catalog-v1.md).

## Sources (audit enum)

`palette` | `slash` | `cli` | `settings` | `app` | `desktop` | `api` | `system`

## Loopback API sketch (V1)

- Bind: `127.0.0.1:14096` (sandbox) / production loopback per server policy
- `POST /operator/v1/commands` — execute command/query
- `GET /operator/v1/registry` — command descriptors + reserved catalog version
- `GET /operator/v1/health` — process health (no secrets)

No public remote routes in V1. CSRF/Origin required only if non-loopback is later added.

## CLI mapping

```
opencode op <domain> <operation> [flags]
opencode op langlock status --json
opencode op semantic embedding cutover --yes   # non-TTY + authenticated only
```

## Slash mapping

```
/op.langlock.status
/op.semantic.embedding.cutover
```

Registry is SSOT for aliases; clients MUST NOT hardcode divergent names.
