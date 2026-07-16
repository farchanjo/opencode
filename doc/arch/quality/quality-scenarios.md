# Quality Scenarios

How opencode defines and measures its quality. Each row is an
ATAM-style quality-attribute scenario — a concrete stimulus, the environment it
arrives in, the expected response, and a measurable acceptance criterion —
mapped onto one ISO/IEC 25010:2023 product-quality characteristic. Operators own
this document: edit the scenarios as the system's quality goals evolve, keep
every cell concrete and measurable, and replace these generic starters with the
real goals for opencode.

The `Attribute` column uses the ISO/IEC 25010:2023 characteristic names exactly:
functional-suitability, performance-efficiency, compatibility,
interaction-capability, reliability, security, maintainability, flexibility, and
safety. `speckit validate` scans the table below (never the prose around it), so
keep it accurate and cover every attribute that matters for this system.

| ID | Attribute | Stimulus | Environment | Response | Measure |
|----|-----------|----------|-------------|----------|---------|
| QS-01 | functional-suitability | a user performs the primary workflow | normal operation | the system produces the specified result | every documented acceptance scenario passes |
| QS-02 | performance-efficiency | a user runs the primary workflow | expected peak load | the workflow completes within its documented budget | p95 latency stays within the documented budget |
| QS-03 | compatibility | the system exchanges data with a peer component | a supported integration environment | the exchange succeeds against the published contract | every contract-conformance check passes |
| QS-04 | interaction-capability | a first-time user attempts a core task | a supported client environment | the user completes the task without outside help | the task is completed on the first attempt in review |
| QS-05 | reliability | a dependency fails during a request | production with one dependency degraded | the system degrades gracefully and then recovers | recovery within the stated objective with no data loss |
| QS-06 | security | an unauthenticated actor requests a protected resource | production over the public boundary | the request is rejected and the attempt is audited | every protected endpoint denies unauthenticated access |
| QS-07 | maintainability | a developer changes one isolated module | the current codebase under CI | the change ships without edits to unrelated modules | the change stays within one module and CI is green |
| QS-08 | flexibility | the system is deployed to a new supported target | the supported platform matrix | it runs with only configuration changes | it deploys to each supported platform from one build |
| QS-09 | safety | an operator supplies invalid or hazardous input | production with guardrails enabled | the system refuses the unsafe operation | every hazardous input is blocked before any side effect |
