// DDD role: ValueObject
// Package: schemas
// Feature 046 — the operator-surface projection of the RoutingConfig Enforcement
// budget/hierarchy/capability leaves. A SINGLE leaf registry drives BOTH operator
// surfaces (the op CLI backend and the TUI forms) so they never drift out of
// parity (FR4): each leaf names one enforcement field, its operator key, its
// display label, and its typed constraint. Reads project the effective leaves;
// writes validate + persist ONLY the leaves the operator set, CAS-versioned over
// the SAME routing Config.Service authority smart/budget/pools bind (FR6, FR7).
// No leaf carries a secret — every value is a bounded numeric, a small enum, a
// boolean, or the escalation-signal name.

package schemas

// #EnforcementDomain is the closed set of three operator-tunable enforcement blocks (FR1-FR3).
#EnforcementDomain: "budget" | "hierarchy" | "capability"

// #EnforcementVerb is the reserved per-domain verb surface: status/show read, set/configure write (FR1).
#EnforcementVerb: "status" | "show" | "set" | "configure"

// #LeafKey is the operator-facing camelCase key naming one enforcement leaf (FR4).
#LeafKey: string & =~"^[a-z][A-Za-z0-9]*$"

// #LeafKind is the typed constraint class a leaf value is validated against at the write boundary (FR9).
#LeafKind: "int" | "float" | "bool" | "enum" | "text"

// #LeafValue is one bounded operator value: a numeric, an enum/text string, or a boolean (FR4, FR9).
#LeafValue: number | string | bool

// #Configured is true when the requested scope carries an explicit routing document (FR5).
#Configured: bool

// #Available is true only when the live enforcement port is reachable; never fabricated (FR8).
#Available: bool

// #EnforcementLeaf is one registry entry: its domain, key, label, and typed constraint (FR4).
#EnforcementLeaf: {
	domain: #EnforcementDomain
	key:    #LeafKey
	label:  string & !=""
	kind:   #LeafKind
}

// #EnforcementLeafView is the read model surfaced by <domain>.status/show: the effective
// leaves of a domain plus the scope's CAS token and configured flag (FR5).
#EnforcementLeafView: {
	configured: #Configured
	available:  #Available
	leaves: {[#LeafKey]: #LeafValue}
	updatedAt: string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}T"
	version:   string & !=""
}

// #EnforcementConfigure is a partial CAS-guarded write: only the leaves the operator set,
// validated against the registry, over the routing authority (FR7, FR9). At least one leaf.
#EnforcementConfigure: {
	domain: #EnforcementDomain
	values: {[#LeafKey]: #LeafValue}
	expectedVersion: string & !=""
}
