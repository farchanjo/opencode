import { describe, expect, test } from "bun:test"
import { applyChatBudget, chatOutputSystemBlock, resolveChatBudget, wordCount } from "../../src/session/chat-output"

describe("chat-output budget", () => {
  test("resolveChatBudget ignores empty config", () => {
    expect(resolveChatBudget(undefined)).toBeUndefined()
    expect(resolveChatBudget({})).toBeUndefined()
    expect(resolveChatBudget({ max_words: 0 })).toBeUndefined()
  })

  test("resolveChatBudget accepts words and/or tokens", () => {
    expect(resolveChatBudget({ max_words: 50 })).toMatchObject({ maxWords: 50, exhausted: false })
    expect(resolveChatBudget({ max_tokens: 100 })).toMatchObject({ maxTokens: 100, exhausted: false })
  })

  test("applyChatBudget clamps words", () => {
    const text = "one two three four five six"
    const result = applyChatBudget(text, { maxWords: 3 })
    expect(result.exhausted).toBe(true)
    expect(wordCount(result.text)).toBe(3)
    expect(result.text).toContain("one")
    expect(result.text).toContain("three")
    expect(result.text).not.toContain("four")
  })

  test("applyChatBudget leaves short text alone", () => {
    const result = applyChatBudget("hello world", { maxWords: 10, maxTokens: 100 })
    expect(result.exhausted).toBe(false)
    expect(result.text).toBe("hello world")
  })

  test("chatOutputSystemBlock mentions words and tool exemption", () => {
    const block = chatOutputSystemBlock({ max_words: 120 })
    expect(block).toContain("120 words")
    expect(block).toContain("write/edit")
    expect(block).toContain("Console chat")
  })
})
