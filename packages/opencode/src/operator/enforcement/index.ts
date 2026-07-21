/**
 * Feature 046 — the enforcement-leaf operator domain barrel: the generic backend
 * over the routing Config.Service authority, the hierarchy/capability command
 * adapter, and its live wiring. The shared leaf registry lives in
 * `@opencode-ai/protocol/enforcement/leaves` — the single source both the CLI
 * backend and the TUI forms consume (FR4).
 */
export { EnforcementLeafBackend, createLiveEnforcementBackend } from "./leaf-backend"
export type { EnforcementLeafBackendApi, EnforcementError, EnforcementLeafView } from "./leaf-backend"
export { EnforcementCommandPort, createEnforcementDomainPorts } from "./leaf-command-port"
export { EnforcementStackWiring, createEnforcementDomainWiring } from "./stack-wiring"
