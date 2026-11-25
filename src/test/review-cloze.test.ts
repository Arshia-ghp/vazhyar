import { describe, expect, it } from "vitest";
import { buildClozeSegments } from "../pages/ReviewPage";

describe("smart cloze generation", () => {
  it("hides the full phrase with flexible whitespace and preserves punctuation", () => {
    const result = buildClozeSegments("Please look   after your sister!", "look after");
    expect(result.find((segment) => segment.hidden)?.text).toBe("look   after");
    expect(result[0]?.text).toBe("Please ");
    expect(result.at(-1)?.text).toBe(" your sister!");
  });

  it("falls back to the longest matching word when the full phrase is absent", () => {
    const result = buildClozeSegments("She looks after her brother.", "look after");
    expect(result.some((segment) => segment.hidden)).toBe(true);
  });

  it("does not delete a different token when no safe match exists", () => {
    const result = buildClozeSegments("This is an unrelated sentence.", "resilient");
    expect(result).toEqual([{ text: "This is an unrelated sentence.", hidden: false }]);
  });
});
