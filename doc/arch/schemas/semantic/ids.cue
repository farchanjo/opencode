// DDD role: ValueObject
// Package: semantic.shared
// Shared identity ValueObjects for the Feature 006 semantic retrieval projection.
// Centralised to avoid primitive obsession and duplicated constraints. Name parity
// with routing.shared / lifecycle.shared / outputspool.shared is intentional; CUE
// packages are not cross-imported here, so the identifier concepts are re-declared
// locally (FR1, FR2, C21). No identity axis is a filesystem path (FR17, C4).

package semantic.shared

// ProviderProfileId identifies one SemanticProviderProfile aggregate (FR28, C19).
#ProviderProfileId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ModelDescriptorId is the canonical model ref identifying one SemanticModelDescriptor (FR28, C3).
#ModelDescriptorId: string & =~"^[A-Za-z0-9_-]{1,160}$"

// BindingId identifies one SemanticModelBinding aggregate for a slot (FR28, C12).
#BindingId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// AgentDocId is the canonical agent id keying one AgentDoc projection (FR10, C6).
#AgentDocId: string & =~"^[A-Za-z0-9_-]{1,160}$"

// SkillDocId is the canonical skill id keying one SkillDoc projection (FR11, C9).
#SkillDocId: string & =~"^[A-Za-z0-9_-]{1,160}$"

// SkillChunkId is the canonical chunk id keying one SkillChunkDoc projection (FR11, C9).
#SkillChunkId: string & =~"^[A-Za-z0-9_-]{1,192}$"

// GenerationId identifies one blue/green IndexGeneration under a binding generation (FR12, C12).
#GenerationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CollectionAliasId identifies one CollectionAlias entity swapped at cutover (FR12, C12).
#CollectionAliasId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProjectId is the scalar project partition key filtered on every search (FR9, FR34, C6).
#ProjectId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// EventId is the EventV2 evt_ identifier assigned per published semantic.* event (C22).
#EventId: string & =~"^evt_[A-Za-z0-9_-]{1,120}$"
