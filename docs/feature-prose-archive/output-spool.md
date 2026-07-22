# Prose feature scenarios (not executed by speckit verify)
#
# Executable coverage lives in package unit/integration tests.
# Spec Acceptance Scenarios remain the scored scenarioCoverage source.
#
# Source: doc/arch/sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md
# (FR1-FR50, AC1-AC22, C1-C23) and ADR-0006 (OutputSpool Content Plane and
# Paged ArtifactStore, proposed). Prose-style scenarios describe intended
# behavior precisely enough for later automation; they do not require
# concrete step bindings.

Feature: OutputSpool and ArtifactStore — Canonical File-Backed Content Plane
  As an operator
  I want every observed output file-backed from its first chunk with paged, authorized access
  So that huge outputs stay bounded in memory and no consumer ever sees a raw filesystem path

  # ---------------------------------------------------------------------------
  # Write/seal happy path (FR8, FR9, FR18, FR24, C2, C20, AC1)
  # ---------------------------------------------------------------------------

  Scenario: A producer opens a channel, appends at the expected offset, and seals
    Given a producer that owns its Feature 002 process opens an "assistant-text" channel generation
    When it appends chunks at the expected byte offset through the bounded queue and requests seal
    Then the channel settles to "sealed" with committed bytes finalized
    And process memory attributable to the write stays bounded independent of total committed bytes

  # ---------------------------------------------------------------------------
  # Crash recovery to each C12 state (FR25, C12, AC8, AC9)
  # ---------------------------------------------------------------------------

  Scenario Outline: Crash recovery reconciles the filesystem extent against committed length
    Given a channel generation with a filesystem data extent and a control-store committed length in "<extent-relation>"
    When startup reconciliation runs the committed-length authority
    Then the group recovers to "<recovered-state>" without silent empty-success

    Examples:
      | extent-relation                          | recovered-state |
      | extent at least the committed length     | sealed          |
      | extent at least the committed length     | open            |
      | extent shorter than the committed length | corrupt         |
      | seal record absent after committed append | unknown        |

  # ---------------------------------------------------------------------------
  # Paged read + cursor expiry (FR20-FR22, C14, AC2, AC3, AC4)
  # ---------------------------------------------------------------------------

  Scenario: A byte-offset page never splits a UTF-8 codepoint
    Given a multi-byte codepoint straddling a page boundary in a sealed channel
    When a reader issues read(offset, limit)
    Then the returned page does not split the codepoint
    And next_offset advances past the complete codepoint

  Scenario: A follow cursor resumes within validity and reports a stable code once invalidated
    Given a follow cursor bound to a live generation and byte offset
    When the client disconnects and reconnects within the cursor's validity
    Then reading resumes at the generation-consistent offset without a full re-read

  Scenario: A superseded cursor is rejected with a stable code
    Given a follow cursor whose generation was superseded by fencing or whose group was released, cleaned up, or expired
    When the client reconnects with that cursor
    Then the reconnect is rejected with a stable "expired" or "invalid_cursor" code
    And no content from a later generation is leaked

  # ---------------------------------------------------------------------------
  # Follow/tail with eof-only-when-sealed (C20, AC2)
  # ---------------------------------------------------------------------------

  Scenario: An open stream reports caught_up without reporting eof
    Given an open channel being actively appended
    When a follower reads through all currently committed bytes
    Then caught_up is true
    And eof remains false because the channel has not sealed

  Scenario: eof is reported only after the channel is sealed and fully consumed
    Given a channel that has settled to "sealed" or "aborted" with no further append
    When a reader consumes through the committed end
    Then eof is true
    And no further bytes are returned for that generation

  # ---------------------------------------------------------------------------
  # Quota/ENOSPC degrade-then-fence (FR10, C4, AC6, AC7)
  # ---------------------------------------------------------------------------

  Scenario Outline: An admission fault degrades the channel and never reports lost bytes as sealed
    Given append encounters a "<fault>" admission fault
    When the fault persists past the bounded degrade window
    Then the channel backpressures the producer and then transitions to "aborted" or "corrupt"
    And already-committed bytes remain preserved and seal never reports success over lost bytes

    Examples:
      | fault              |
      | enospc             |
      | fd exhaustion      |
      | quota exceeded     |
      | permission denial  |
      | sustained latency  |

  # ---------------------------------------------------------------------------
  # Retention lease blocking GC then release (FR28-FR30, C5, AC16, AC17)
  # ---------------------------------------------------------------------------

  Scenario: A referenced output survives cleanup despite an elapsed TTL
    Given a group whose TTL has elapsed but still holds a live lease, an active reader or writer, or a reference-graph edge
    When bounded-batch cleanup runs
    Then the group is not reclaimed
    And cleanup considers TTL, lease, reference graph, and legal hold together, never mtime alone

  Scenario: Dropping the last holder edge allows a subsequent cleanup cycle to reclaim the group
    Given a group whose TTL has elapsed and whose only holder edge is released
    When release drops that one holder reference edge and a later bounded-batch cleanup runs
    Then the group is reclaimed within a bounded batch
    And still-referenced sibling groups in the same batch remain untouched

  # ---------------------------------------------------------------------------
  # Redacted preview + content-free events (FR4, FR33, C8, C22)
  # ---------------------------------------------------------------------------

  Scenario: A bounded redacted preview never carries a path or inline secret material
    Given a channel with secret-classified content near its head
    When a bounded preview is attached to an EventV2 payload, a UI card, or a NotificationEnvelope summary
    Then the preview is a byte-and-line-capped redacted head slice
    And secret material is represented only as a Feature 007 SecretRef, never inline plaintext, and no path appears

  Scenario: Durable and live output.* events carry no content
    Given a seal, abort, settlement, or reconciliation outcome
    When the corresponding "output.*" event projects through the single EventV2 authority
    Then only OutputRef, bounded metadata, and enum-valued fields are present
    And no file text, diff, prompt, message, path, snippet, reasoning, or tool payload is present

  # ---------------------------------------------------------------------------
  # Reasoning channel restrictions (FR16, Privacy 2, C9, AC22)
  # ---------------------------------------------------------------------------

  Scenario: The reasoning channel is never emitted to OTEL or an unauthorized preview
    Given content spooled on the "reasoning" channel
    When telemetry export or preview generation runs
    Then no reasoning content reaches OTEL
    And no preview is surfaced without an explicit authorized principal

  Scenario: The reasoning channel carries a shorter default retention TTL than assistant-text
    Given a "reasoning" channel and an "assistant-text" channel sealed at the same time
    When their retention TTLs are compared
    Then the reasoning channel's TTL is the stricter of the two

  # ---------------------------------------------------------------------------
  # Export/share deny-by-default + authorized grant (FR44, C7, C17)
  # ---------------------------------------------------------------------------

  Scenario: Cross-project export or share is denied by default
    Given an OutputRef that belongs to project A
    When an "output.export" or "output.share" request targets project B
    Then the request is denied by default
    And no raw path or cross-project content transfer occurs

  Scenario: An authorized in-project export is content-bounded and audited
    Given an operator principal with "project" scope, explicit version/CAS, and idempotency
    When "output.export" is issued within the same project
    Then the export returns a content-bounded preview, never a raw path
    And the export is recorded with an audit ID

  # ---------------------------------------------------------------------------
  # Producer-owns-its-OutputGroup / no second executor (FR2, FR38, C21)
  # ---------------------------------------------------------------------------

  Scenario: Only the process that owns the OutputGroup may write to it
    Given a Feature 002 process that owns OutputGroup G
    When any other producer attempts to append or seal channels under G
    Then the attempt is rejected as a non-owning writer
    And Feature 002 remains execution authority while supplying pages only, never bytes

  # ---------------------------------------------------------------------------
  # Legacy migration flag dual-read (FR31, C16)
  # ---------------------------------------------------------------------------

  Scenario: BackgroundJob dual-reads legacy strings and OutputRef during the migration window
    Given the C16 migration flag enabled and a BackgroundJob written before the migration
    When the job's output is read during the bounded dual-read window
    Then legacy "output"/"error" strings remain readable
    And new writes store OutputRef/stat/status instead of proportional in-memory strings

  Scenario: After cutover, BackgroundJob reads exclusively through OutputRef
    Given the C16 migration flag fully cut over and the dual-read window closed
    When a BackgroundJob's output is read
    Then only OutputRef/stat/status is used
    And legacy "output"/"error" string fields are retired

  # ---------------------------------------------------------------------------
  # Reserved output.* catalog authority (FR41-FR44, C19, AC13, AC15)
  # ---------------------------------------------------------------------------

  Scenario Outline: Reserved output.* command IDs are native-only and served from the existing catalog
    Given the reserved "<command>" command ID already declared at RESERVED_CATALOG_VERSION "1.3.0"
    When an authorized principal issues it through Settings, palette, native-slash, or CLI
    Then it is served with zero provider/model calls, tokens, or cost
    And it is served outside the transcript, ToolRegistry, and MCP surfaces

    Examples:
      | command                |
      | output.stat            |
      | output.read            |
      | output.follow          |
      | output.export          |
      | output.share           |
      | output.release         |
      | output.delete          |
      | output.purge           |
      | output.retention.set   |
      | output.quota.set       |

  Scenario: Plugin, MCP, and custom registries cannot register reserved output.* names
    Given a plugin, MCP server, or custom command registry attempting to register "output.release"
    When registration is attempted
    Then the attempt is rejected with a structured "reserved_name" error
    And the canonical Feature 005/Feature 007 implementation remains the sole owner
