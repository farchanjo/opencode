// DDD role: ValueObject
// Package: semantic.shared
// Cross-reference, secret and principal ValueObjects. Every axis carries an opaque
// handle only; a credential is a Feature 007 SecretPort secret ref, never raw
// material (FR35, C19), and a candidate ref is a ranking pointer into live core
// state, never an embedded Entity (FR20, FR34, C11). No axis is a filesystem path
// (FR17, C4). A skill body is reached only through a Feature 005 OutputRef (FR40, C9).

package semantic.shared

// ProviderRef references a SemanticProviderProfile from a descriptor or binding (FR28).
#ProviderRef: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ModelRef references a SemanticModelDescriptor from a binding or candidate (FR28, C3).
#ModelRef: string & =~"^[A-Za-z0-9_-]{1,160}$"

// ParentSkillId references the SkillDoc a SkillChunkDoc was chunked from (FR11, C9).
#ParentSkillId: string & =~"^[A-Za-z0-9_-]{1,160}$"

// AgentRef is a ranking pointer to a canonical agent revalidated against AgentV2 (FR20, C11).
#AgentRef: string & =~"^[A-Za-z0-9_-]{1,160}$"

// SkillRef is a ranking pointer to a canonical skill revalidated against SkillV2 (FR20, C11).
#SkillRef: string & =~"^[A-Za-z0-9_-]{1,160}$"

// PermissionRef references the PermissionV2 profile evaluated before and after search (FR34, C11).
#PermissionRef: string & !~"^$"

// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR35, C19).
#SecretRef: string & !~"^$"

// HeaderRef is a secure reference to an outbound auth header value — never inline (FR35, C19).
#HeaderRef: string & !~"^$"

// OperatorRef is the operator principal that pinned a binding; re-evaluated per action (FR35, C15).
#OperatorRef: string & !~"^$"

// OutputRef is a Feature 005 OutputSpool content handle for a sanitized chunk body (FR40, C9).
#OutputRef: string & !~"^$"
