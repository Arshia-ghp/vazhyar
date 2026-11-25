import type { LearningNote, NoteFilters } from "../types/domain";
import { normalizeText, safeArray, safeString } from "./safe";

/**
 * Null-safe filtering: callers may pass stale/corrupt records or incomplete
 * filter objects from old application versions without crashing the UI.
 */
export function filterNotes(
  input: Array<LearningNote | null | undefined> | null | undefined,
  filters?: NoteFilters | null
): LearningNote[] {
  const notes = safeArray(input).filter(
    (note): note is LearningNote => Boolean(note && typeof note === "object")
  );
  const query = normalizeText(filters?.query);
  const kind = filters?.kind ?? "all";
  const starredOnly = filters?.starredOnly === true;
  const source = normalizeText(filters?.source);
  const includeDeleted = filters?.includeDeleted === true;

  return notes.filter((note) => {
    const noteKind = safeString(note.kind);
    const matchesKind = kind === "all" || noteKind === kind;
    const matchesStar = !starredOnly || note.starred === true;
    const matchesSource = source.length === 0 || normalizeText(note.source) === source;
    const matchesDeleted = includeDeleted || !note.deletedAt;
    const searchable = [
      note.term,
      note.meaning,
      note.ipa,
      note.structure,
      note.example,
      note.exampleFa,
      note.source,
      note.notes
    ]
      .map(normalizeText)
      .join(" ");
    const matchesQuery = query.length === 0 || searchable.includes(query);
    return matchesKind && matchesStar && matchesSource && matchesDeleted && matchesQuery;
  });
}
