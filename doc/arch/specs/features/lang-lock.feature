# Source: doc/arch/sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md
# (FR1-FR35, AC1-AC22, C1-C16) and ADR-0005 (Lang Lock Artifact-Language
# Policy and Progressive Enforcement, proposed). Prose-style scenarios
# describe intended behavior precisely enough for later automation; they do
# not require concrete step bindings.

Feature: Lang Lock — Configurable Artifact-Language Enforcement
  As a maintainer
  I want a configured artifact language enforced on model-authored prose without changing conversation
  So that code, docs, and Task/Todo text stay consistent while chat and UI locale remain independent

  # ---------------------------------------------------------------------------
  # Policy resolution precedence (FR5, C2, AC5-AC6)
  # ---------------------------------------------------------------------------

  Scenario: Global hard policy is the base authority when no project override is authorized
    Given a global Lang Lock policy set to "en-US" with no project override authorized
    When effective policy resolves for that project scope
    Then the resolved tag is the global "en-US" value
    And the origin is recorded as "global"

  Scenario: An authorized project override applies without relaxing the global hard-policy floor
    Given a global hard-policy floor of "en-US" and an operator-authorized "langlock.override" grant
    When a project override sets the tag to "pt-BR" within the authorized floor
    Then the resolved policy applies the "pt-BR" project override
    And the effective scope, origin, and policy version are audited

  Scenario: An unauthorized project override is rejected and the global value remains
    Given a global hard policy and no "langlock.override" authorization for the project
    When a project override attempt is submitted
    Then the override is rejected
    And the effective policy remains the global value

  # ---------------------------------------------------------------------------
  # Permission-gated override authorization (Security 1, FR6, C2, AC5-AC6)
  # ---------------------------------------------------------------------------

  Scenario Outline: Only native operator policy may authorize a project override
    Given a "<surface>" attempts to relax or mutate the effective artifact language
    When the mutation attempt reaches the Lang Lock policy authority
    Then the attempt is prohibited
    And the effective artifact language is unchanged

    Examples:
      | surface                |
      | a session setting      |
      | a user prompt          |
      | an LLM instruction     |
      | an agent or subagent   |
      | a plugin               |
      | an MCP server          |
      | a custom command       |
      | a nested AGENTS file   |
      | a soft repository prompt |

  # ---------------------------------------------------------------------------
  # Advisory-never-blocks (FR16, FR20-FR22, C5, C6, C14, AC8, AC11)
  # ---------------------------------------------------------------------------

  Scenario: Advisory detection records a mismatch without blocking the write
    Given confidently classified prose written by a model under an effective "en-US" lock
    When post-write advisory detection observes a language mismatch
    Then the write completes unconditionally
    And "langlock.advisory_flagged" is recorded with detector provenance, confidence bucket, path kind, and policy version

  Scenario: Detector unknown or failure never blocks the prompt, execution, or tool hot path
    Given an advisory-eligible artifact write
    When the detector returns an unknown or failed outcome
    Then the write, prompt, and execution proceed unaffected
    And the outcome is recorded as "unknown" without blocking

  # ---------------------------------------------------------------------------
  # Generic-code-never-flagged (FR20, C5, C14, Out of Scope, AC11)
  # ---------------------------------------------------------------------------

  Scenario: Generic source code is never blocked or advisory-flagged by a language detector in V1
    Given a generic source-code path kind under mixed-language content
    When post-write advisory validation runs
    Then the path-kind classification resolves to "generic_code" or "not_eligible"
    And no advisory-blocked or false strict failure is asserted

  # ---------------------------------------------------------------------------
  # Quoted user text exempt (FR13, C1, AC10)
  # ---------------------------------------------------------------------------

  Scenario: Quoted user content, identifiers, and syntax remain exempt from artifact-language enforcement
    Given a model-authored artifact that quotes user content and references identifiers, filenames, and API names
    When Lang Lock scope boundaries are evaluated
    Then the quoted user content remains literal
    And the identifiers, filenames, symbols, API names, and proper nouns are exempt

  # ---------------------------------------------------------------------------
  # Immutable injection survives system.transform (FR17, FR25, C4, AC7)
  # ---------------------------------------------------------------------------

  Scenario: A system-transform plugin attempting to remove the lock cannot weaken it
    Given effective Lang Lock language injected into the V1/V2 system prompt
    When "experimental.chat.system.transform" runs and attempts to remove or alter the injected block
    Then the effective-language block is reapplied immutably after the transform
    And the request assembly result carries the unmodified effective language

  # ---------------------------------------------------------------------------
  # Content-free event emission (FR27, C8, Security 5, AC14)
  # ---------------------------------------------------------------------------

  Scenario: Audit and advisory events export only bounded content-free metadata
    Given a policy mutation and an advisory-flagged outcome
    When "langlock.*" events project on the single EventV2 authority and OTEL exports
    Then only enabled state, allowlisted tag, scope, origin, policy version, path-kind enum, confidence bucket, and bounded IDs are present
    And no file text, diff, prompt, message, path, snippet, reasoning, or tool payload is present

  # ---------------------------------------------------------------------------
  # Reserved langlock.status|show|set|reset command authority (FR31-FR35, C3, AC13)
  # ---------------------------------------------------------------------------

  Scenario Outline: Reserved langlock command IDs are native-only and make zero LLM calls
    Given the reserved "<command>" command ID from the Feature 007 reserved catalog v1
    When an authorized operator principal issues it through Settings, palette, native-slash, or CLI
    Then it is served with zero provider/model calls, tokens, or cost
    And it is served outside the transcript, ToolRegistry, and MCP surfaces

    Examples:
      | command          |
      | langlock.status  |
      | langlock.show    |
      | langlock.set     |
      | langlock.reset   |

  Scenario: Plugin, MCP, and custom registries cannot register reserved langlock.* names
    Given a plugin, MCP server, or custom command registry attempting to register "langlock.set"
    When registration is attempted
    Then the attempt is rejected with a structured "reserved_name" error
    And the canonical Feature 004/Feature 007 implementation remains the sole owner

  Scenario: An LLM reads effective language but never invokes administrative commands
    Given effective read-only Lang Lock metadata in the trusted execution envelope
    When the model attempts to call an administrative "langlock.*" command
    Then the attempt is rejected
    And the model's execution envelope still carries the unchanged effective language

  # ---------------------------------------------------------------------------
  # Exception manifest application (FR14, Security 2, Security 6, C16, AC9-AC10)
  # ---------------------------------------------------------------------------

  Scenario: An operator-owned exception exempts vendor, legal, and golden-fixture content
    Given an operator-owned, schema-validated exception manifest entry for a vendor-generated file
    When Lang Lock evaluates that path against the manifest
    Then the exception matches and the content is preserved literally
    And the match is recorded with bounded type, authority, scope, and result without content

  Scenario: An untrusted LLM or plugin request cannot create a new exemption
    Given an LLM or plugin attempts to register a new exception manifest entry
    When the request reaches the exception-matcher authority
    Then the request is denied
    And no new exemption is created

  # ---------------------------------------------------------------------------
  # Mixed-file no-retrotranslation (FR10, C12, AC20)
  # ---------------------------------------------------------------------------

  Scenario: Editing one section of a mixed-language file enforces only the modified portion
    Given an existing mixed-language file with untouched non-lock-language content
    When a model edits one section of that file under the effective lock
    Then only the newly written or modified prose is subject to Lang Lock
    And the untouched repository content is not retrotranslated or rewritten

  # ---------------------------------------------------------------------------
  # Mid-flight policy-version immutability (FR26, C11, AC12)
  # ---------------------------------------------------------------------------

  Scenario: A policy change during a running execution does not alter its captured version
    Given an execution envelope that captured effective tag and policy version at start
    When the Lang Lock policy changes while that execution is still running
    Then the running execution preserves its start-time tag and policy version
    And the changed policy applies only to subsequent executions

  Scenario Outline: Background, resumed, replayed, and scheduled executions preserve captured policy version
    Given a "<execution-kind>" execution that captured effective tag and policy version at start
    When it resumes, replays, or begins under the "<execution-kind>" flow
    Then the captured tag and policy version are preserved without permission elevation
    And no translation-model call is issued solely to enforce the lock

    Examples:
      | execution-kind |
      | background     |
      | resumed        |
      | replayed       |
      | parent-child handoff |
      | scheduled      |
