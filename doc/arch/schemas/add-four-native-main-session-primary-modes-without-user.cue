// DDD role: ValueObject
// Package: schemas
// Feature 057 — Four native main-session primary modes (plan/build/solo/speckit)
// without user profile agent MD. Wire ids and mode flags only; permissions live
// in harness TypeScript.

package schemas

// PrimaryModeWireId is the closed set of user-visible native primary wire ids.
// UI label Agent maps to wire id build. There is no ask primary.
// DDD role: ValueObject
#PrimaryModeWireId: "plan" | "build" | "solo" | "speckit"

// PrimaryModeUiLabel is the closed set of TUI labels for the four modes.
// DDD role: ValueObject
#PrimaryModeUiLabel: "Plan" | "Agent" | "Solo" | "Speckit"

// TaskSpawnAllowed wraps whether the primary may invoke the task tool.
// DDD role: ValueObject
#TaskSpawnAllowed: bool

// FreeCodeEditAllowed wraps whether free product-code edit tools are allowed.
// DDD role: ValueObject
#FreeCodeEditAllowed: bool

// PrimaryModeMapping binds a UI label to a wire id and capability flags.
// DDD role: ValueObject
#PrimaryModeMapping: {
	uiLabel:       #PrimaryModeUiLabel
	wireId:        #PrimaryModeWireId
	taskSpawn:     #TaskSpawnAllowed
	freeCodeEdit:  #FreeCodeEditAllowed
}

// SpeckitBinaryPath is one canonical Speckit binary path form.
// DDD role: ValueObject
#SpeckitBinaryPath: string & !=""

// SpeckitBinaryPathList is the closed-ish list of allowed Speckit binary path forms.
// DDD role: ValueObject
#SpeckitBinaryPathList: [...#SpeckitBinaryPath]

// SpeckitModeBashPolicy documents the deny-by-default bash surface for wire id
// speckit. Concrete pattern lists are enforced in harness code.
// DDD role: ValueObject
#SpeckitModeBashPolicy: {
	defaultAction:        "deny"
	allowSpeckitCli:      true
	denyImplement:        true
	canonicalBinaryPaths: #SpeckitBinaryPathList
}

// SystemPromptDefaultPath is the shipped markdown body path under the opencode
// package agent tree for one primary wire id.
// DDD role: ValueObject
#SystemPromptDefaultPath: {
	wireId:   #PrimaryModeWireId
	relative: "packages/opencode/src/agent/defaults/" + wireId + ".md"
}

// FourPrimaryModesInvariant is the product invariant for Feature 057.
// DDD role: ValueObject
#FourPrimaryModesInvariant: {
	primaryCount:            4
	wireIds:                 #PrimaryModeWireId
	noAskPrimary:            true
	onlyBuildMayTask:        true
	speckitNeverImplements:  true
	promptsFromPackageMd:    true
	profileMdNotRequired:    true
}
