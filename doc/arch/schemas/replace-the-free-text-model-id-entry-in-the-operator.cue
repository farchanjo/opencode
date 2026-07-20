// DDD role: ValueObject
// Package: schemas
// The connected-models PICKER view-model (Feature 020). Today two Operator admin
// palette forms collect a model id as free text: pools.set '+ Add model'
// (multi-field-modal.tsx:474-478, appended to row.models[]) and
// semantic.model.disable (descriptor.ts:213, payload { id }). Feature 020 replaces
// both free-text entries with a shared, reactive, provider-grouped, searchable
// picker over the live connected catalog sync.data.provider (sync.tsx:452-453),
// resolving each choice to a `provider/model` id string (Provider.parseModel,
// provider.ts:1990). The operator payloads are UNCHANGED (TUI presentation only,
// FR5); a Custom id… escape hatch keeps a catalog-absent id enterable (FR4).

package schemas

// #ModelId is the canonical `provider/model` identifier a picker option resolves to and both seams persist unchanged — the Provider.parseModel format (FR1, FR5).
#ModelId: string & =~"^[^/]+/.+$"

// #PickerResolutionKind records how a Model id was collected: picked from the live connected list, or typed through the Custom id… raw-text escape hatch (FR1, FR4).
#PickerResolutionKind: "connected_list" | "custom_id"

// #OptionFooter is a bounded, non-empty cost/context hint shown under an option (e.g. "Free"); it carries only public catalog metadata, never a secret (FR1).
#OptionFooter: string & !=""

// #ConnectedModelOption is one entry in the shared picker, derived by a reactive memo from a connected Provider.Info.models record; it carries only public catalog fields, never a secret (FR1).
#ConnectedModelOption: {
	// modelId is the `provider/model` id this option resolves to (FR1).
	modelId: #ModelId
	// title is the human label shown for the model (model name, falling back to its id) (FR1).
	title: string & !=""
	// provider is the connected provider's display name, used as the DialogSelect group category (FR1).
	provider: string & !=""
	// category groups options by provider in the DialogSelect list, mirroring DialogModel (FR1).
	category: string & !=""
	// footer optionally surfaces bounded cost/context metadata (e.g. "Free" when cost.input == 0) (FR1).
	footer?: #OptionFooter
	// alreadySelected marks an option already present in the caller's current list so it is indicated/skippable, never silently duplicated (FR2, FR6).
	alreadySelected: bool | *false
}

// #ConnectedModelCatalog is the reactive option list the picker renders, derived from sync.data.provider; an empty list reflects no connected providers and still offers the escape hatch (FR1, FR6).
#ConnectedModelCatalog: [...#ConnectedModelOption]

// #ModelPickerResolution is the outcome of a picker interaction: a resolved id (from the list or the escape hatch), or a cancel that mutates nothing (FR2, FR3, FR4, FR6).
#ModelPickerResolution: {
	// cancelled true means esc/cancel: no modelId, no mutation of row.models[] or the descriptor value (FR6).
	cancelled: bool | *false
	// kind is present only when not cancelled: how the id was collected (FR1, FR4).
	kind?: #PickerResolutionKind
	// modelId is present only when not cancelled: the collected `provider/model` id (FR1, FR4).
	modelId?: #ModelId
	if cancelled {
		kind?:    _|_
		modelId?: _|_
	}
	if !cancelled {
		kind:    #PickerResolutionKind
		modelId: #ModelId
	}
}

// #SeamPayloadContract records the UNCHANGED operator payload each seam composes after the picker resolves — proof this is a TUI presentation change only (FR5).
#SeamPayloadContract: {
	// seam is the operator command the rewired form dispatches (FR2, FR3).
	seam: "pools.set" | "semantic.model.disable"
	// contract is the exact payload shape, unchanged from before Feature 020 (FR5).
	contract: string & !=""
}
