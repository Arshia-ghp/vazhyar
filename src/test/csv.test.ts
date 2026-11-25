import { describe, expect, it } from "vitest";
import { createAnkiCsvBlob, parseCsvText, parseDelimitedText } from "../services/csv";
import type { LearningNote } from "../types/domain";

const sample: LearningNote = {
  id: "1", kind: "word", term: "look after", meaning: "مراقبت کردن، رسیدگی کردن", ipa: "/lʊk ˈæftər/",
  structure: "look after + object", example: "She looks after her brother.", exampleFa: "او از برادرش مراقبت می‌کند.",
  source: "جلسه ۱", notes: "عبارت کاربردی", starred: true, normalizedTerm: "look after",
  createdAt: "2026-11-25T10:00:00.000Z", updatedAt: "2026-11-25T10:00:00.000Z", deletedAt: null
};

describe("CSV import/export helpers", () => {
  it("parses quoted commas, escaped quotes and embedded line breaks", () => {
    const rows = parseDelimitedText('term,meaning,example\r\n"look after","مراقبت، رسیدگی","She said ""hello"".\nThen left."');
    expect(rows[1]?.[0]).toBe("look after");
    expect(rows[1]?.[1]).toBe("مراقبت، رسیدگی");
    expect(rows[1]?.[2]).toContain('"hello"');
    expect(rows[1]?.[2]).toContain("Then left.");
  });

  it("detects Google Sheets tab-separated exports and maps Persian headers", () => {
    const parsed = parseCsvText("انگلیسی\tمعنی\tمثال\r\nlook after\tمراقبت کردن\tShe looks after her brother.");
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.hasHeader).toBe(true);
    expect(parsed.suggestedMapping.term).toBe(0);
    expect(parsed.suggestedMapping.meaning).toBe(1);
    expect(parsed.rows).toHaveLength(1);
  });

  it("detects delimiters outside quoted cell content", () => {
    const parsed = parseCsvText('term,meaning,example\r\n"word, phrase",عبارت,"A short example, with comma."');
    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows[0]?.[0]).toBe("word, phrase");
    expect(parsed.rows[0]?.[2]).toBe("A short example, with comma.");
  });

  it("keeps the first row of headerless legacy sheets even when they have three columns", () => {
    const parsed = parseCsvText("look after,مراقبت کردن,She looks after her brother.\r\nget along,کنار آمدن,We get along well.");
    expect(parsed.hasHeader).toBe(false);
    expect(parsed.rows[0]?.[0]).toBe("look after");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.suggestedMapping.term).toBe(0);
  });

  it("exports Anki Front/Back/Tags with UTF-8 BOM and quoted Persian content", async () => {
    const blob = createAnkiCsvBlob([sample]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder strips a leading BOM by default; decode after the BOM bytes.
    const text = new TextDecoder("utf-8").decode(bytes.slice(3));
    expect(text).toContain("Front,Back,Tags");
    expect(text).toContain("look after");
    expect(text).toContain("word starred");
    expect(text).toContain("مراقبت کردن، رسیدگی کردن");
  });
});
