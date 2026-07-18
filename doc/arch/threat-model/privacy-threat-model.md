# Privacy Threat Model (LINDDUN)

How OpenCode reasons about privacy threats to people whose data it touches.
LINDDUN is data-subject focused. Feature 007 operator audit, secrets, and
telemetry constraints are the primary Phase 1 mitigations documented here.

Operators own this document. `speckit validate` scans the table below. The
`Category` column uses the seven lowercase LINDDUN tokens exactly: linking,
identifying, non-repudiation, detecting, data-disclosure, unawareness, and
non-compliance.

| ID    | Category        | Threat                                                                                         | Affected Data                                | Mitigation                                                                                                              |
| ----- | --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PT-01 | linking         | operator audit records correlated across projects re-identify a person                         | EventV2 operator.audit actorRef + scope refs | project-bound principals fail-closed; audit fields are content-free versions/outcomes only; no payload/body in audit    |
| PT-02 | identifying     | local operator subject or committer identity appears in shared exports                         | principal subject, config export/share       | export/share require confirmation; redacted outputs; multi-user identity directory deferred (T092)                      |
| PT-03 | non-repudiation | operator cannot show or bound who performed a management mutation                              | audit stream retention                       | every mutation projects secret-free audit; 90-day retention; `audit_pending` preserves CAS while reconcile completes    |
| PT-04 | detecting       | presence of private provider endpoints inferred from error side channels                       | SSRF denials, connectivity errors            | structured `unavailable`/`ssrf_denied` without leaking internal network maps; DNS fail-closed                           |
| PT-05 | data-disclosure | API keys or OAuth material leak via config JSON, logs, slash output, or OTEL labels            | secrets, tokens, headers                     | SecretRef only (keychain/env-ref); plaintext scanner; redacted slash/CLI; OTEL allowlist excludes secrets/paths/content |
| PT-06 | unawareness     | user unaware that management actions are audited or that telemetry test signals leave the host | audit + telemetry.test                       | native operator surfaces show outcomes; telemetry off by default until operator enables; test signal clearly marked     |
| PT-07 | non-compliance  | audit/config retention drifts past stated policy or dual stores diverge                        | snapshots, audit rows, config authorities    | single Config.Service + EventV2; snapshot ≤10/30d; audit 90d prune; no parallel admin stores                            |

## Phase 2 privacy deferrals

Multi-user vault backends, remote non-loopback API CSRF/origin, and App/Desktop
shared identity surfaces are **not** Phase 1 claims (T090–T092). Do not treat
their absence as a Phase 1 privacy defect; document residual risk until Phase 2 ADR.
