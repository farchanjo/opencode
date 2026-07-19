Feature: Native Rust FFI Tools and PTY Integration
  As the OpenCode tool runtime
  I want native Rust implementations of the filesystem/text tools and a real PTY
  So that tools run faster and interactive commands get a controlling terminal, with no behavioral change when the native library is absent

  Scenario: Native tool result matches the TypeScript reference
    Given the compiled opencode-tools-ffi library is loaded
    When grep runs against the repository through both the native and TypeScript backends
    Then the two results are byte-identical, ignoring undefined ordering ties

  Scenario: Missing native library falls back silently
    Given the compiled native library is absent
    When any of the six filesystem/text tools runs
    Then it executes through the TypeScript implementation with identical behavior
    And a typed native_unavailable capability gap is recorded

  Scenario: PTY spawn provides a controlling terminal
    Given a command spawned via oc_pty_spawn
    When the command queries its standard streams
    Then isatty() is true and ANSI color output is emitted
    And oc_pty_kill terminates the full child process tree

  Scenario: Permission gate stays in TypeScript for PTY mode
    Given a bash invocation with pty set to true
    When the tool runs
    Then permission.assert is evaluated in TypeScript before any PTY allocation
    And no permission decision occurs in native code
