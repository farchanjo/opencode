// DDD role: ValueObject
//
// Feature 022 — Restore the production compiled build by loading the lazy live
// modules via dynamic import (ADR-0022). Models the compile-safe lazy-load
// contract for a process-singleton live seam: a lazy module load that transitively
// reaches a top-level await MUST use a dynamic `await import(...)` (which
// `bun build --compile` accepts), never a synchronous `require(...)` (which the
// compiler rejects), while preserving deferred arming, fail-open, and exactly-once.

package schemas

// #LazyLiveModuleLoad is the compile-safe lazy-load ValueObject for one live seam.
// DDD role: ValueObject
#LazyLiveModuleLoad: {
	// The composition module that lazily loads the live seam (importing it must
	// never dereference the Bun global / AppRuntime).
	seam: string & !=""
	// The sibling live module fetched on first arm (e.g. "./telemetry-export-live").
	liveModule: string & =~"^\\./.*-live$"
	// The load mechanism. `bun build --compile` REJECTS "require" when the target
	// transitively reaches a top-level await; "import" (dynamic) is ACCEPTED.
	loadMechanism: "import" | "require"
	// True when the live module's transitive import graph reaches a top-level await
	// (e.g. @opencode-ai/core/global). When true, loadMechanism MUST be "import".
	reachesTopLevelAwait: bool | *true
	// The accessor that fetches the seam is async (returns a Promise).
	accessorAsync: bool | *true
	// Deferred-arming invariants that MUST hold regardless of load mechanism.
	deferredArming: {
		// The singleton arms eagerly only at server.listen() (or lazily for CLI op),
		// never at module import.
		armAtListen: bool | *true
		// A construction/arming fault degrades to a disarmed seam; the server still
		// starts (fail-open).
		failOpen: bool | *true
		// Concurrent ensure() calls share one in-flight arming (exactly-once).
		exactlyOnce: bool | *true
	}
}

// Compile-safety constraint: a seam that reaches a top-level await MUST load via a
// dynamic import — the single rule that restores and locks the compiled build.
#LazyLiveModuleLoad & {reachesTopLevelAwait: true} & {loadMechanism: "import"}

// The two live seams this feature makes compile-safe (both reach core/global's TLA).
#CompileSafeSeams: [...#LazyLiveModuleLoad] & [
	{
		seam:                 "packages/opencode/src/routing/telemetry-export.ts"
		liveModule:           "./telemetry-export-live"
		loadMechanism:        "import"
		reachesTopLevelAwait: true
		accessorAsync:        true
		deferredArming: {armAtListen: true, failOpen: true, exactlyOnce: true}
	},
	{
		seam:                 "packages/opencode/src/jobs/executor-composition.ts"
		liveModule:           "./executor-composition-live"
		loadMechanism:        "import"
		reachesTopLevelAwait: true
		accessorAsync:        true
		deferredArming: {armAtListen: true, failOpen: true, exactlyOnce: true}
	},
]
