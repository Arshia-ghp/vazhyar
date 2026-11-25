import { isPersianText } from "./enrichment";

export type EnglishAccent = "us" | "uk";

interface DictionaryAudioEntry {
  phonetics?: Array<{ audio?: string }>;
}

const audioCache = new Map<string, string>();

function normalizedAudioUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

async function findDictionaryAudio(term: string, accent: EnglishAccent): Promise<string | null> {
  const cacheKey = `${accent}:${term.toLocaleLowerCase("en-US")}`;
  if (audioCache.has(cacheKey)) return audioCache.get(cacheKey) ?? null;
  if (!term.trim() || /\s/.test(term.trim())) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.trim())}`,
      { signal: controller.signal, cache: "force-cache" }
    );
    if (!response.ok) return null;
    const data = await response.json() as DictionaryAudioEntry[];
    const phonetics = data[0]?.phonetics ?? [];
    const audioUrls = phonetics.map((item) => item.audio).filter((url): url is string => Boolean(url));
    const preferred = audioUrls.find((url) => accent === "us" ? /-us\d*\./i.test(url) : /-uk\d*\./i.test(url));
    const selected = preferred ?? audioUrls[0] ?? null;
    if (selected) audioCache.set(cacheKey, normalizedAudioUrl(selected));
    return selected ? normalizedAudioUrl(selected) : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function speakWithSynthesis(text: string, accent: EnglishAccent): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return false;
  }
  const synthesis = window.speechSynthesis;
  synthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = accent === "us" ? "en-US" : "en-GB";
  const voices = synthesis.getVoices();
  const locale = accent === "us" ? "en-US" : "en-GB";
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase())
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase()))
    ?? null;
  utterance.rate = 0.92;
  utterance.pitch = 1;
  synthesis.speak(utterance);
  return true;
}

export interface PronunciationResult {
  method: "dictionary-audio" | "speech-synthesis";
  message: string;
}

export async function playPronunciation(term: string, accent: EnglishAccent = "us"): Promise<PronunciationResult> {
  const clean = term.trim();
  if (!clean || isPersianText(clean)) throw new Error("برای پخش تلفظ، متن انگلیسی لازم است.");

  const audioUrl = await findDictionaryAudio(clean, accent);
  if (audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      audio.preload = "none";
      await audio.play();
      return { method: "dictionary-audio", message: `صدای دیکشنری با اولویت لهجه ${accent.toUpperCase()} پخش شد.` };
    } catch {
      // Autoplay restrictions, missing codec or unavailable audio -> system TTS.
    }
  }

  if (speakWithSynthesis(clean, accent)) {
    return { method: "speech-synthesis", message: `تلفظ با صدای سیستم (${accent.toUpperCase()} در صورت وجود) پخش شد.` };
  }
  throw new Error("مرورگر از پخش تلفظ یا Speech Synthesis پشتیبانی نمی‌کند.");
}
