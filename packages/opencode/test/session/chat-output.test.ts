import { describe, expect, test } from "bun:test"
import { chatOutputSystemBlock, hasChatOutputBudget, wordCount } from "../../src/session/chat-output"

describe("chat-output budget (soft / LLM self-size)", () => {
  test("hasChatOutputBudget ignores empty and zero", () => {
    expect(hasChatOutputBudget(undefined)).toBe(false)
    expect(hasChatOutputBudget({})).toBe(false)
    expect(hasChatOutputBudget({ max_words: 0 })).toBe(false)
    expect(hasChatOutputBudget({ max_words: 50 })).toBe(true)
    expect(hasChatOutputBudget({ max_tokens: 100 })).toBe(true)
  })

  test("wordCount", () => {
    expect(wordCount("one two three")).toBe(3)
    expect(wordCount("  ")).toBe(0)
  })

  test("chatOutputSystemBlock asks model to self-size, not hard-filter language", () => {
    const block = chatOutputSystemBlock({ max_words: 120 })
    expect(block).toContain("120 words")
    expect(block).toContain("self-edit")
    expect(block).toContain("console chat")
    expect(block).toContain("write/edit")
    expect(block.toLowerCase()).not.toContain("stream")
    expect(block.toLowerCase()).not.toContain("truncat")
  })
})
