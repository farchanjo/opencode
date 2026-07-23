// DDD role: ValueObject
// Package: schemas
// Feature 058 — skill listing policy + matcher + startup index (structured only).

package schemas

// SkillMetaName is the skill directory / frontmatter name.
// DDD role: ValueObject
#SkillMetaName: string & !=""

// SkillUserInvocable wraps whether the skill is top-level invocable.
// DDD role: ValueObject
#SkillUserInvocable: bool

// SkillListFlag wraps hardCap / showStatus booleans.
// DDD role: ValueObject
#SkillListFlag: bool

// SkillMatchReason classifies path/trigger/variant match reasons.
// DDD role: ValueObject
#SkillMatchReason: "path" | "trigger" | "variant"

// SkillListMode is the Tier-1 listing order mode.
// DDD role: ValueObject
#SkillListMode: "ranked" | "matched" | "lexical" | "passthrough"

// SkillListFormat is the Tier-1 listing density.
// DDD role: ValueObject
#SkillListFormat: "verbose" | "compact" | "names"

// SkillStringList is paths/triggers/variants string lists.
// DDD role: ValueObject
#SkillStringList: [...(string & !="")]

// SkillMeta is the matcher view — no body.
// DDD role: ValueObject
#SkillMeta: {
	name:          #SkillMetaName
	paths:         #SkillStringList
	triggers:      #SkillStringList
	variants:      #SkillStringList
	userInvocable: #SkillUserInvocable
}

// SkillListConfig is experimental.skill_list (Tier-1 cap/format).
// DDD role: ValueObject
#SkillListConfig: {
	maxListed:  int & >=1 & <=256
	format:     #SkillListFormat
	hardCap:    #SkillListFlag
	showStatus: #SkillListFlag
}

// SkillPathPrimeInvariant product constraints.
// DDD role: ValueObject
#SkillPathPrimeInvariant: {
	defaultMaxListed:         24
	defaultFormat:            "compact"
	defaultHardCap:           true
	skillToolRemainsBodyPath: true
	noFappRuntimeDependency:  true
	preserveRankedOrder:      true
	startupCollections:       "skills+skill_chunks"
}
