import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichNote, type EnrichmentSettings } from "../services/enrichment";

const noAi: EnrichmentSettings = {
  provider: "gemini",
  apiKey: "",
  model: "gemini-4-hydrogen",
  proxyUrl: "",
  timeoutMs: 900
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hybrid enrichment", () => {
  it("keeps the quick result when public APIs are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await enrichNote({ term: "resilient", meaning: "", kind: "word" }, noAi);

    expect(result.quality).toBe("partial");
    expect(result.patch.term).toBe("resilient");
    expect(result.patch.meaning).toBeUndefined();
    expect(result.message).toContain("پاسخی نداد");
  });

  it("turns a Persian input into an English term and preserves the Persian meaning", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mymemory.translated.net")) {
        return new Response(JSON.stringify({
          responseStatus: 200,
          responseData: { translatedText: "resilient" }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([{
        word: "resilient",
        phonetic: "/rɪˈzɪliənt/",
        phonetics: [],
        meanings: [{ partOfSpeech: "adjective", definitions: [{ example: "She is resilient." }] }]
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await enrichNote({ term: "مقاوم", meaning: "", kind: "word" }, noAi);

    expect(result.quality).toBe("quick");
    expect(result.patch.term).toBe("resilient");
    expect(result.patch.meaning).toBe("مقاوم");
    expect(result.patch.ipa).toBe("/rɪˈzɪliənt/");
    expect(result.patch.example).toBe("She is resilient.");
  });

  it("falls back quietly when an optional AI provider responds with a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage.googleapis.com")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response("unavailable", { status: 503 });
    }));

    const result = await enrichNote(
      { term: "resilient", meaning: "مقاوم", kind: "word" },
      { ...noAi, apiKey: "test-key", timeoutMs: 700 }
    );

    expect(result.quality).toBe("quick");
    expect(result.patch.term).toBe("resilient");
    expect(result.patch.meaning).toBeUndefined();
    expect(result.message).not.toContain("429");
  });
});