# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/010-add-native-rust-ffi-layer-for-built-in-tools-and-pty/spec.md
# (FR1-FR24, NFR1-NFR6, AC1-AC18, C1-C20) and ADR-0010 (Native Rust FFI Layer
# for Built-in Tools and PTY, proposed). Prose-style scenarios describe
# intended behavior precisely enough for later automation; they do not
# require concrete step bindings.

Feature: Native Rust FFI Tools and PTY Integration
  As the OpenCode tool runtime
  I want native Rust implementations of the filesystem/text tools and a real PTY
  So that tools run faster and interactive commands get a controlling terminal, with no behavioral change when the native library is absent

  # ---------------------------------------------------------------------------
  # Per-tool native parity (FR1-FR7, C4, C16, AC1-AC7)
  # ---------------------------------------------------------------------------

  Scenario: Read windowing and truncation parity
    Given a file larger than the 50 KiB read page cap with an offset and a limit
    When native "read" pages the file through oc_read
    Then line numbering, the 2000-line and 50 KiB caps, and the 2000-char line-truncation suffix match read-filesystem.ts exactly
    And the "truncated" flag and the "next" continuation cursor match the TypeScript reference

  Scenario: Edit succeeds on exactly one occurrence
    Given a target string that occurs exactly once in a file
    When native "edit" runs through oc_edit without replace-all
    Then the replacement succeeds and the file contains the new string exactly once

  Scenario: Edit fails when the target string is absent
    Given a target string that occurs zero times in a file
    When native "edit" runs through oc_edit
    Then it fails with the typed "no_match" error code and the file is unchanged

  Scenario: Edit fails on ambiguous match without replace-all
    Given a target string that occurs more than once in a file
    When native "edit" runs through oc_edit without replace-all
    Then it fails with the typed "ambiguous_match" error code and the file is unchanged

  Scenario: Edit replace-all substitutes every occurrence
    Given a target string that occurs more than once in a file
    When native "edit" runs through oc_edit with replace-all requested
    Then every exact occurrence is substituted with the new string

  Scenario: Apply patch applies all hunks when context matches
    Given a multi-hunk patch whose context matches the target file
    When native "apply_patch" runs through oc_apply_patch
    Then every hunk applies at parity with the TypeScript apply_patch reference

  Scenario: Apply patch fails with a typed error when context does not match
    Given a multi-hunk patch whose context does not match the target file
    When native "apply_patch" runs through oc_apply_patch
    Then it fails with the typed "context_mismatch" error code and applies nothing

  Scenario: Write is atomic under an interrupted write
    Given a native "write" through oc_write that is interrupted before completion
    When the destination file is inspected afterward
    Then it holds either the full new content or the unchanged prior content and never a truncated partial file

  Scenario: Glob honors gitignore and orders by modification time
    Given the opencode repository as the corpus with its .gitignore entries
    When native "glob" runs through oc_glob
    Then ignored paths are excluded and results are ordered by modification time

  Scenario: Grep files-with-matches mode parity
    Given the opencode repository as the corpus
    When native "grep" runs through oc_grep in files-with-matches mode
    Then the set of matching files is identical to the TypeScript reference

  Scenario: Grep content mode with line numbers and context parity
    Given the opencode repository as the corpus
    When native "grep" runs through oc_grep in content mode with line numbers and context
    Then the matched lines, line numbers, and context are identical to the TypeScript reference

  Scenario: Grep count mode parity
    Given the opencode repository as the corpus
    When native "grep" runs through oc_grep in count mode
    Then the per-file match counts are identical to the TypeScript reference

  # ---------------------------------------------------------------------------
  # Repo-level equivalence ignoring ordering ties (FR7, C13, AC6, AC7)
  # ---------------------------------------------------------------------------

  Scenario: Native tool result matches the TypeScript reference
    Given the compiled opencode-tools-ffi library is loaded
    When grep runs against the repository through both the native and TypeScript backends
    Then the two results are byte-identical, ignoring undefined ordering ties

  Scenario: Repo-level glob equivalence ignoring ordering ties
    Given the compiled opencode-tools-ffi library is loaded
    When glob runs against the repository through both the native and TypeScript backends
    Then the two results are byte-identical after normalizing the mtime-desc-then-path tie order

  # ---------------------------------------------------------------------------
  # Fallback and degradation (FR18-FR19, C1, C2, C14, C19, AC13, AC14)
  # ---------------------------------------------------------------------------

  Scenario: Missing native library falls back silently
    Given the compiled native library is absent
    When any of the six filesystem/text tools runs
    Then it executes through the TypeScript implementation with identical behavior
    And a typed native_unavailable capability gap is recorded

  Scenario: ABI mismatch degrades to typed gap and fallback
    Given a compiled native library whose oc_abi_version does not match the expected major version
    When the loader performs the handshake on first use
    Then the library is treated as unloadable and a typed native_unavailable gap with reason "abi_mismatch" is recorded
    And every affected tool falls back to the TypeScript implementation

  Scenario: Load failure degrades gracefully without a hard failure
    Given a present but unloadable native library
    When dlopen fails during discovery
    Then the wrapper degrades to the TypeScript implementation without a hard failure

  # ---------------------------------------------------------------------------
  # FFI boundary safety (FR14-FR17, NFR2, NFR3, AC11, AC12)
  # ---------------------------------------------------------------------------

  Scenario: A native panic returns a typed error and the host survives
    Given a native entry point that panics internally
    When it is invoked through the FFI boundary
    Then catch_unwind converts the panic into a typed "internal_panic" error envelope
    And the Bun host process does not crash

  Scenario: Every FFI response is freed exactly once under stress
    Given a stress run issuing a high volume of oc_* calls
    When every response is freed through oc_free after being copied
    Then the allocation and free counters are equal at rest and no memory is leaked

  # ---------------------------------------------------------------------------
  # PTY terminal fidelity and lifecycle (FR8-FR11, AC8-AC10)
  # ---------------------------------------------------------------------------

  Scenario: PTY spawn provides a controlling terminal
    Given a command spawned via oc_pty_spawn
    When the command queries its standard streams
    Then isatty() is true and ANSI color output is emitted
    And oc_pty_kill terminates the full child process tree

  Scenario: PTY kill terminates the full process tree
    Given a PTY session whose child forks a subprocess tree
    When oc_pty_kill signals the child's process group
    Then the entire process tree is terminated with no orphaned children

  Scenario: PTY streaming keeps the agent event loop responsive
    Given a long-running PTY session streaming output on the master fd
    When the agent continues working while the session streams
    Then the Bun event loop never blocks and no FFI call occurs on the IO hot path

  # ---------------------------------------------------------------------------
  # Shell integration, permission gate, and platform gating (FR12-FR13, FR22, C19, AC15-AC16)
  # ---------------------------------------------------------------------------

  Scenario: Permission gate stays in TypeScript for PTY mode
    Given a bash invocation with pty set to true
    When the tool runs
    Then permission.assert is evaluated in TypeScript before any PTY allocation
    And no permission decision occurs in native code

  Scenario: PTY mode is opt-in and disabled by default
    Given a bash invocation with pty unset or set to false
    When the tool runs
    Then it uses the current ChildProcess and AppProcess path with no change to timeout, capture cap, or output semantics

  Scenario: Windows always falls back to the TypeScript path
    Given the runtime platform is win32
    When any of the six filesystem/text tools or a pty:true bash invocation runs
    Then the loader never attempts dlopen and every affected surface runs through the TypeScript implementation

  # ---------------------------------------------------------------------------
  # Configuration and observability (FR19, FR21, FR24, C2, AC13, AC17, AC18)
  # ---------------------------------------------------------------------------

  Scenario: Native execution flags default to false
    Given a fresh checkout with experimental.nativeTools and experimental.nativePty both unset
    When any of the six filesystem/text tools or a pty:true bash invocation runs
    Then execution stays on the TypeScript path regardless of whether a compiled library is present

  Scenario: Backend selection and the gap are recorded content-free
    Given a native or TypeScript backend selection or a native_unavailable capability gap
    When the event is exported as telemetry
    Then only bounded labels for tool name, backend, and gap reason appear, never file contents, paths, patch bodies, command strings, or session ids

  Scenario: Release build produces loadable artifacts
    Given cargo build --release completes on macOS and on Linux
    When the TypeScript loader discovers the resulting artifacts
    Then it loads them via dlopen and their absence triggers the TypeScript fallback rather than a build or runtime failure
