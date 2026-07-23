Feature: Durable tool output buffers and primary agent console chat
  As an OpenCode user
  I want full tool buffers always on disk and a live console chat budget
  So that agents can recover tool results after compact and chat stays bounded

  Scenario: Full tool buffer always saved under limits
    Given a completed native tool result under tool_output max_lines and max_bytes
    When Truncate.output processes the result
    Then content equals the full text
    And outputPath points to a file containing the full text

  Scenario: Over-limit tool keeps full file with preview
    Given a tool result exceeding tool_output max_lines
    When Truncate.output processes the result
    Then content is a truncated preview with a path hint
    And the file at outputPath contains the full original text

  Scenario: Compaction preserves path not irreversible clear
    Given a completed tool part with metadata.outputPath
    And the part is marked compacted by prune
    When MessageV2 converts the session to model messages
    Then the tool result text includes the outputPath
    And the text does not equal "[Old tool result content cleared]"

  Scenario: Primary chat word budget clamps console text only
    Given chat_output.max_words is 50
    And the active agent mode is primary
    When the assistant streams console text longer than 50 words
    Then the stored text part has at most 50 words

  Scenario: Chat budget does not clamp write tool payloads
    Given chat_output.max_words is 50
    When the assistant issues a write tool with a multi-thousand-word file body
    Then the write tool arguments are not truncated by the chat budget

  Scenario: TUI sets budget for next turn
    Given the operator opens DialogChatOutput
    When they select max words 150
    Then global config chat_output.max_words is 150
    And the next primary processor create resolves that budget
