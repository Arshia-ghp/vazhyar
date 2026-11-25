import type { LearningNote, NoteKind } from "../types/domain";
import { createId, normalizeText } from "../lib/safe";
import { db } from "./database";
import { afterDatabaseWrite } from "./mirror";
import { createInitialFsrsCard } from "./fsrs";

export type CsvField = "term" | "meaning" | "ipa" | "structure" | "example" | "exampleFa" | "source" | "notes";
export type CsvColumnMapping = Partial<Record<CsvField, number>>;

export interface CsvDocument {
  delimiter: "," | ";" | "\t";
  columns: string[];
  rows: string[][];
  hasHeader: boolean;
  suggestedMapping: CsvColumnMapping;
}

export interface CsvImportResult {
  added: number;
  duplicates: number;
  invalidRows: number;
  totalRows: number;
}

const MAX_CSV_BYTES = 30 * 1024 * 1024;
const MAX_CSV_ROWS = 20_000;
const FIELDS: CsvField[] = ["term", "meaning", "ipa", "structure", "example", "exampleFa", "source", "notes"];

const HEADER_ALIASES: Record<CsvField, string[]> = {
  term: ["term", "word", "english", "english word", "front", "vocabulary", "vocabulary item", "expression", "word phrase", "کلمه", "کلمه انگلیسی", "واژه", "واژه انگلیسی", "عبارت", "انگلیسی", "لغت", "متن انگلیسی"],
  meaning: ["meaning", "translation", "persian", "farsi", "back", "definition", "meaning fa", "معنی", "ترجمه", "فارسی", "مفهوم", "معنی فارسی"],
  ipa: ["ipa", "phonetic", "pronunciation", "phonetics", "تلفظ", "آوانگاری", "فونتیک"],
  structure: ["structure", "grammar", "pattern", "ساختار", "الگو", "گرامر"],
  example: ["example", "sentence", "example en", "مثال", "جمله", "مثال انگلیسی"],
  exampleFa: ["example fa", "example translation", "translation example", "ترجمه مثال", "معنی مثال", "مثال فارسی"],
  source: ["source", "session", "lesson", "unit", "جلسه", "منبع", "درس"],
  notes: ["notes", "comment", "description", "extra", "نکات", "یادداشت", "توضیحات"]
};

function countSeparatorsOutsideQuotes(line: string, delimiter: CsvDocument["delimiter"]): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    const next = line[index + 1] ?? "";
    if (character === '"') {
      if (quoted && next === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(text: string): CsvDocument["delimiter"] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiters: CsvDocument["delimiter"][] = [",", ";", "\t"];
  const options = delimiters.map((delimiter) => ({
    delimiter,
    count: countSeparatorsOutsideQuotes(firstLine, delimiter)
  }));
  return options.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

/** RFC-4180-style parser supporting quoted commas, newlines and escaped quotes. */
export function parseDelimitedText(input: string, delimiter?: CsvDocument["delimiter"]): string[][] {
  const text = input.replace(/^\uFEFF/, "").replace(/\0/g, "");
  const separator = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (character === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === separator) {
      row.push(cell); cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("فایل CSV دارای کوتیشن باز و بسته‌نشده است.");
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  if (rows.length > MAX_CSV_ROWS + 1) throw new Error("تعداد ردیف‌های CSV از سقف ۲۰ هزار ردیف بیشتر است.");
  return rows;
}

function normalizeHeader(value: string): string {
  return normalizeText(value).replace(/[_-]+/g, " ").replace(/[؟?:：]/g, "").trim();
}

function guessHeaderMapping(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {};
  for (const field of FIELDS) {
    const aliases = HEADER_ALIASES[field].map(normalizeHeader);
    const index = headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export function parseCsvText(text: string): CsvDocument {
  const delimiter = detectDelimiter(text.replace(/^\uFEFF/, ""));
  const rawRows = parseDelimitedText(text, delimiter);
  if (rawRows.length === 0) throw new Error("فایل CSV خالی است.");

  const firstRow = rawRows[0] ?? [];
  const autoMap = guessHeaderMapping(firstRow);
  // Only remove the first row when a known header label was actually detected.
  // Older Google Sheets exports often have 3+ columns but no header row.
  const hasHeader = autoMap.term !== undefined;
  const columns = hasHeader
    ? firstRow.map((value) => value.trim() || "بدون عنوان")
    : Array.from({ length: Math.max(...rawRows.map((row) => row.length)) }, (_, index) => `ستون ${index + 1}`);
  const rows = hasHeader ? rawRows.slice(1) : rawRows;
  const suggestedMapping = hasHeader
    ? autoMap
    : ({ term: 0, meaning: 1, example: 2, exampleFa: 3, source: 4 } satisfies CsvColumnMapping);

  if (suggestedMapping.term === undefined) {
    throw new Error("ستون کلمه/عبارت انگلیسی تشخیص داده نشد. فایل باید حداقل یک ستون متن انگلیسی داشته باشد.");
  }

  return { delimiter, columns, rows, hasHeader, suggestedMapping };
}

export async function parseCsvFile(file: File): Promise<CsvDocument> {
  if (file.size > MAX_CSV_BYTES) throw new Error("حجم CSV نباید بیشتر از ۳۰ مگابایت باشد.");
  const text = await file.text();
  return parseCsvText(text);
}

function getCell(row: string[], index: number | undefined): string {
  if (index === undefined || !Number.isInteger(index) || index < 0) return "";
  return (row[index] ?? "").trim();
}

export async function importCsvRows(
  document: CsvDocument,
  mapping: CsvColumnMapping,
  kind: NoteKind
): Promise<CsvImportResult> {
  if (mapping.term === undefined) throw new Error("ستون کلمه انگلیسی را انتخاب کن.");

  const existingNotes = await db.notes.toArray();
  const knownTerms = new Set(existingNotes.filter((note) => !note.deletedAt).map((note) => note.normalizedTerm));
  const candidates: LearningNote[] = [];
  let duplicates = 0;
  let invalidRows = 0;

  for (const row of document.rows) {
    const term = getCell(row, mapping.term);
    if (!term) { invalidRows += 1; continue; }
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) { invalidRows += 1; continue; }
    if (knownTerms.has(normalizedTerm)) { duplicates += 1; continue; }
    knownTerms.add(normalizedTerm);
    const now = new Date().toISOString();
    candidates.push({
      id: createId(), kind, term, normalizedTerm,
      meaning: getCell(row, mapping.meaning),
      ipa: getCell(row, mapping.ipa),
      structure: getCell(row, mapping.structure),
      example: getCell(row, mapping.example),
      exampleFa: getCell(row, mapping.exampleFa),
      source: getCell(row, mapping.source),
      notes: getCell(row, mapping.notes),
      starred: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    });
  }

  const cards = await Promise.all(candidates.map(async (note) => ({
    id: note.id,
    noteId: note.id,
    card: await createInitialFsrsCard(note.id),
    updatedAt: note.createdAt,
    modelVersion: "FSRS-7" as const
  })));
  const cardByNote = new Map<string, (typeof cards)[number]>(cards.map((card) => [card.noteId, card] as const));
  let added = 0;

  await afterDatabaseWrite(async () => {
    await db.transaction("rw", db.notes, db.reviewCards, async () => {
      // Re-check inside the write transaction to avoid duplicate imports from a second tab.
      const active = await db.notes.toArray();
      const existing = new Set(active.filter((note) => !note.deletedAt).map((note) => note.normalizedTerm));
      const toAdd = candidates.filter((note) => {
        if (existing.has(note.normalizedTerm)) { duplicates += 1; return false; }
        existing.add(note.normalizedTerm);
        return true;
      });
      if (toAdd.length) {
        await db.notes.bulkAdd(toAdd);
        await db.reviewCards.bulkAdd(toAdd.flatMap((note) => {
          const card = cardByNote.get(note.id);
          return card ? [card] : [];
        }));
      }
      added = toAdd.length;
    });
  });

  return { added, duplicates, invalidRows, totalRows: document.rows.length };
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function htmlEscape(value: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

export function createAnkiCsvBlob(notes: LearningNote[]): Blob {
  const rows: string[][] = [["Front", "Back", "Tags"]];
  for (const note of notes.filter((item) => !item.deletedAt)) {
    const backParts = [
      note.meaning && `<b>معنی:</b> ${htmlEscape(note.meaning)}`,
      note.ipa && `<b>IPA:</b> ${htmlEscape(note.ipa)}`,
      note.structure && `<b>ساختار:</b> ${htmlEscape(note.structure)}`,
      note.example && `<b>Example:</b> ${htmlEscape(note.example)}`,
      note.exampleFa && `<b>ترجمه مثال:</b> ${htmlEscape(note.exampleFa)}`,
      note.notes && `<b>نکات:</b> ${htmlEscape(note.notes)}`
    ].filter((part): part is string => Boolean(part));
    const tags = [note.kind, note.starred ? "starred" : "", note.source ? `source_${normalizeText(note.source).replace(/\s+/g, "_")}` : ""]
      .filter(Boolean).join(" ");
    rows.push([note.term, backParts.join("<br>"), tags]);
  }
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  return new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
}

export async function downloadAnkiCsv(): Promise<number> {
  const notes = await db.notes.toArray();
  const active = notes.filter((note) => !note.deletedAt);
  const blob = createAnkiCsvBlob(active);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `vazhyar-anki-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return active.length;
}
