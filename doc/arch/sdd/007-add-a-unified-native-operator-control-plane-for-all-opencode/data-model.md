# Data Model: Operator Control Plane (Feature 007)

## Authorities (reuse)

| Authority        | Owner module                     | Feature 007 role                           |
| ---------------- | -------------------------------- | ------------------------------------------ |
| Config           | Config.Service                   | Sole config persistence; no parallel store |
| Events / audit   | EventV2                          | Sole audit stream; no parallel event store |
| Secrets material | OS keychain (SecretPort adapter) | Material never in Config JSON              |
| Domain state     | Domain features 001–006 / 008    | Via ports; stubs until implemented         |

## Entities

### OperatorPrincipal

| Field          | Type                                     | Notes                         |
| -------------- | ---------------------------------------- | ----------------------------- |
| kind           | `operator` \| `system` \| `manager-view` | Closed set V1                 |
| subject        | string (local identity ref)              | No multi-user directory in V1 |
| projectBinding | project id \| null                       | Fail closed cross-project     |

### OperatorScope

| Field | Type                                              |
| ----- | ------------------------------------------------- |
| kind  | `global` \| `project` \| `session` \| `root-tree` |
| ref   | id string when kind ≠ global                      |

### OperatorCommandDescriptor

| Field           | Type          | Notes                                |
| --------------- | ------------- | ------------------------------------ |
| id              | dotted string | Canonical `domain.operation`         |
| aliases         | list          | Registry-generated slash/CLI/palette |
| mutates         | bool          | Query vs command                     |
| scopesAllowed   | list          | From scope matrix                    |
| confirmRequired | bool          | From confirmation matrix             |
| offlineCapable  | bool          | From offline matrix                  |
| schemaVersion   | semver        | Payload schema                       |

### CommandRequest

| Field          | Type                                                                                   | Required             |
| -------------- | -------------------------------------------------------------------------------------- | -------------------- |
| id             | command id                                                                             | yes                  |
| principal      | OperatorPrincipal                                                                      | yes                  |
| scope          | OperatorScope                                                                          | yes                  |
| version        | cas token                                                                              | mutations yes        |
| idempotencyKey | string                                                                                 | mutations yes        |
| confirm        | bool                                                                                   | when confirmRequired |
| payload        | schema                                                                                 | per command          |
| source         | `palette` \| `slash` \| `cli` \| `settings` \| `app` \| `desktop` \| `api` \| `system` | yes                  |

### CommandResult

| Field     | Type                                                         |
| --------- | ------------------------------------------------------------ |
| ok        | bool                                                         |
| id        | command id                                                   |
| version   | new cas token if mutated                                     |
| effective | redacted effective state                                     |
| outcome   | `success` \| `idempotent_replay` \| `conflict` \| error code |
| auditId   | EventV2 id when audited                                      |
| error     | structured error optional                                    |

### ConfigSnapshot

| Field       | Type                      |
| ----------- | ------------------------- |
| id          | uuid                      |
| authority   | config authority key      |
| version     | cas version               |
| createdAt   | timestamp                 |
| payloadHash | content-free hash         |
| payloadRef  | storage ref (not secrets) |

Retention: **max 10 snapshots or 30 days**, whichever first.

### IdempotencyRecord

| Field          | Type                 |
| -------------- | -------------------- |
| principalRef   | string               |
| commandId      | string               |
| idempotencyKey | string               |
| resultRef      | stored CommandResult |
| createdAt      | timestamp            |

### AuditRecord (EventV2 fields)

| Field         | Type          | Secret? |
| ------------- | ------------- | ------- |
| source        | enum          | no      |
| actorRef      | string        | no      |
| scope         | OperatorScope | no      |
| commandId     | string        | no      |
| beforeVersion | string        | no      |
| afterVersion  | string        | no      |
| outcome       | enum          | no      |

Retention: **90 days**. No secret material.

### SecretRef

| Field   | Type                    |
| ------- | ----------------------- |
| backend | `keychain` \| `env-ref` |
| name    | opaque ref              |
| version | monotonic               |

Plaintext values MUST NOT appear in Config, audit, args, history, or output.

### RollbackSlot (cutover)

| Field           | Type                                                                 |
| --------------- | -------------------------------------------------------------------- |
| domain          | `semantic.embedding` \| `semantic.reranker` \| other cutover domains |
| previousBinding | version ref                                                          |
| activatedAt     | timestamp                                                            |
| available       | bool                                                                 |

One active rollback slot per cutover domain after successful cutover.

## Relationships

```
OperatorPrincipal --authorizes--> CommandRequest
CommandRequest --targets--> OperatorScope
CommandRequest --invokes--> OperatorCommandDescriptor
CommandRequest --may_write--> Config (via Config.Service)
CommandRequest --emits--> AuditRecord (EventV2)
CommandRequest --uses--> SecretRef (never secret material)
ConfigSnapshot --captures--> Config version
IdempotencyRecord --replays--> CommandResult
RollbackSlot --restores--> prior binding version
```

## Migration strategy

1. Prefer encoding new metadata in existing Config/Event shapes.
2. If a table is required (idempotency, snapshot index), add Drizzle schema under
   `packages/core` with additive migration.
3. Reserved operator ID catalog is versioned code + docs, not a user migration.
4. Feature flag `operator_control_plane` gates runtime enablement.
5. Legacy custom admin-like names: reject/reserve on register; no silent rename of
   non-admin customs.

## Out of model scope

- Multi-user identity directory.
- Vault secret backend entities.
- App/Desktop-only entities.
- Domain business entities owned by Features 001–006/008 (referenced by id only).
