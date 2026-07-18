// DDD role: ValueObject
// Package: semantic.shared
// First-class collection ValueObjects replacing bare arrays across the projection
// documents, bindings and profiles (calisthenics). Each wraps a shared ValueObject
// element so a taxonomy, language set, or ref set carries one named type rather than
// an anonymous list. A ref set holds ranking pointers into live core state, never
// embedded Entities (FR20, C11); no element is a secret or a path (FR17, C4).

package semantic.shared

// TagSet is a taxonomy collection of domain/capability/trigger/tool/role tokens (FR10, FR11).
#TagSet: [...#Tag]

// LanguageSet is a first-class collection of BCP 47 provenance tags (FR14, FR16).
#LanguageSet: [...#LanguageTag]

// AgentRefSet is a first-class collection of canonical agent ranking pointers (FR20, C11).
#AgentRefSet: [...#AgentRef]

// SkillRefSet is a first-class collection of canonical skill ranking pointers (FR20, C11).
#SkillRefSet: [...#SkillRef]

// HeaderRefSet is a first-class collection of secure outbound header refs (FR35, C19).
#HeaderRefSet: [...#HeaderRef]

// AliasRefSet is a first-class collection of collection-alias ids swapped together at cutover (FR12, C12).
#AliasRefSet: [...#CollectionAliasId]
