import { describe, expect, it } from "vitest";
import { extractLeadingAiTags, hasLeadingAiTag, toggleLeadingAiTag } from "@/lib/composer-ai-tags";

describe("composer AI leading tags", () => {
  it("adds @chatgpt when absent", () => {
    expect(toggleLeadingAiTag("hello world", "chatgpt")).toBe("@chatgpt hello world");
  });

  it("removes leading @chatgpt on second toggle", () => {
    const toggledOn = toggleLeadingAiTag("hello world", "chatgpt");
    const toggledOff = toggleLeadingAiTag(toggledOn, "chatgpt");
    expect(toggledOff).toBe("hello world");
  });

  it("preserves in-body @chatgpt mention when toggling off leading tag", () => {
    const value = "@chatgpt foo @chatgpt bar";
    expect(toggleLeadingAiTag(value, "chatgpt")).toBe("foo @chatgpt bar");
  });

  it("toggles only selected provider in mixed leading tags", () => {
    const value = "@chatgpt @grok text";
    expect(toggleLeadingAiTag(value, "chatgpt")).toBe("@grok text");
    expect(toggleLeadingAiTag(value, "grok")).toBe("@chatgpt text");
  });

  it("normalizes spacing around leading tags", () => {
    const value = "   @chatgpt   @grok    text  with   spacing";
    expect(extractLeadingAiTags(value)).toEqual({
      tags: ["chatgpt", "grok"],
      rest: "text  with   spacing",
    });
    expect(toggleLeadingAiTag(value, "chatgpt")).toBe("@grok text  with   spacing");
  });

  it("toggles correctly for empty draft", () => {
    const toggledOn = toggleLeadingAiTag("", "chatgpt");
    expect(toggledOn).toBe("@chatgpt ");
    const toggledOff = toggleLeadingAiTag(toggledOn, "chatgpt");
    expect(toggledOff).toBe("");
  });

  it("checks only leading tags for active state", () => {
    expect(hasLeadingAiTag("@chatgpt foo", "chatgpt")).toBe(true);
    expect(hasLeadingAiTag("foo @chatgpt", "chatgpt")).toBe(false);
  });
});
