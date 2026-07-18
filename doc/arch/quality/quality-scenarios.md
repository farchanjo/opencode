# Quality Scenarios

How OpenCode defines and measures quality. Each row is an ATAM-style
quality-attribute scenario mapped onto one ISO/IEC 25010:2023 product-quality
characteristic. Feature 007 (operator control plane) and isolation harness
constraints are first-class acceptance drivers for Phase 1.

The `Attribute` column uses the ISO/IEC 25010:2023 characteristic names exactly:
functional-suitability, performance-efficiency, compatibility,
interaction-capability, reliability, security, maintainability, flexibility, and
safety. `speckit validate` scans the table below (never the prose around it).

| ID    | Attribute              | Stimulus                                                                           | Environment                                               | Response                                                                      | Measure                                                         |
| ----- | ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| QS-01 | functional-suitability | operator runs a reserved catalog command on CLI, slash, or loopback API            | Phase 1 native surfaces; flag `operator_control_plane` on | same command id yields same effective state/version/audit outcome             | surface-parity tests green for representative domains           |
| QS-02 | performance-efficiency | operator dispatches a local offline-capable query (e.g. `langlock.status`)         | sandbox or local single-user; no network domain           | completes without provider/model calls                                        | zero LLM tokens/transcript for admin path                       |
| QS-03 | compatibility          | client imports reserved catalog version and IDs                                    | SDK + core monorepo packages                              | IDs match `listReservedIds()` from `@opencode-ai/core/operator`               | no hand-duplicated ID lists; registry HTTP exports same version |
| QS-04 | interaction-capability | first-time operator enables the control plane and runs `op flag show` + one status | documented quickstart/sandbox                             | completes without inventing LLM admin tools                                   | quickstart steps succeed under sandbox wrapper                  |
| QS-05 | reliability            | EventV2 audit publish fails after Config CAS                                       | production or test with failing EventPort                 | mutation returns `audit_pending` with afterVersion; reconcile publishes later | CAS durable; not silent success; exit/HTTP 202                  |
| QS-06 | security               | unauthenticated or non-operator principal calls `POST /operator/v1/commands`       | loopback API                                              | request rejected; reserved `/op.*` never falls to LLM                         | unauthorized/forbidden cases in security suite green            |
| QS-07 | maintainability        | domain feature adds a real adapter for an existing port                            | operator composition root                                 | only port wiring + domain package change; catalog bump if new IDs             | change stays within port/adapter + catalog tests; CI green      |
| QS-08 | flexibility            | operator runs under isolation harness with XDG/HOME/TMPDIR overrides               | Feature 007 sandbox (port 14096)                          | no writes to `~/.config/opencode`; prod path constants unchanged              | isolation proof tests (T001–T004) green                         |
| QS-09 | safety                 | plugin/MCP/custom tries to register a reserved operator id or plaintext secret     | registration path + secret scanner                        | fail-closed `reserved_name` / plaintext reject; no silent rename              | security suite T041–T047 green; keychain tests mock-only        |
