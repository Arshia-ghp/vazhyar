import {
  Archive, BookOpen, Edit3, Headphones, RotateCcw, Search, Star, Trash2, Volume2, X
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { filterNotes } from "../lib/filters";
import { safeArray } from "../lib/safe";
import { db } from "../services/database";
import { deleteNote, restoreNote, updateNoteStar } from "../services/notes";
import { playPronunciation, type EnglishAccent } from "../services/speech";
import { NOTE_KINDS, type LearningNote, type NoteKind } from "../types/domain";

interface MyBankPageProps {
  onEdit: (noteId: string) => void;
  onNotify: (message: string, error?: boolean) => void;
}

function kindLabel(kind: string): string {
  return NOTE_KINDS.find((item) => item.value === kind)?.label ?? "یادداشت";
}
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(date) : "—";
}

export function MyBankPage({ onEdit, onNotify }: MyBankPageProps) {
  const notes = useLiveQuery(() => db.notes.orderBy("updatedAt").reverse().toArray(), [], [] as LearningNote[]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<NoteKind | "all">("all");
  const [source, setSource] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [accent, setAccent] = useState<EnglishAccent>("us");
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const sources = useMemo(() => [...new Set(safeArray(notes)
    .filter((note) => showTrash ? Boolean(note?.deletedAt) : !note?.deletedAt)
    .map((note) => note?.source?.trim() ?? "")
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "fa")), [notes, showTrash]);

  const filtered = useMemo(() => filterNotes(notes, {
    query,
    kind,
    source: source === "all" ? null : source,
    starredOnly,
    includeDeleted: true
  }).filter((note) => showTrash ? Boolean(note.deletedAt) : !note.deletedAt),
  [notes, query, kind, source, starredOnly, showTrash]);

  async function handleStar(note: LearningNote): Promise<void> {
    try {
      await updateNoteStar(note.id, !note.starred);
      onNotify(note.starred ? "نشان علاقه‌مندی برداشته شد." : "به علاقه‌مندی‌ها اضافه شد.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "تغییر علاقه‌مندی ناموفق بود.", true); }
  }

  async function handleDelete(note: LearningNote): Promise<void> {
    if (!window.confirm(`«${note.term}» به سطل زباله منتقل شود؟ تاریخچه مرور حفظ خواهد شد.`)) return;
    try {
      await deleteNote(note.id);
      onNotify("یادداشت به سطل زباله منتقل شد؛ تاریخچه مرور حذف نشد.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "حذف یادداشت ناموفق بود.", true); }
  }

  async function handleRestore(note: LearningNote): Promise<void> {
    try {
      await restoreNote(note.id);
      onNotify("یادداشت بازیابی شد.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "بازیابی یادداشت ناموفق بود.", true); }
  }

  async function handleSpeak(note: LearningNote): Promise<void> {
    setSpeakingId(note.id);
    try {
      const result = await playPronunciation(note.term, accent);
      onNotify(result.message);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "پخش تلفظ ناموفق بود.", true);
    } finally { setSpeakingId(null); }
  }

  const activeCount = safeArray(notes).filter((note) => !note?.deletedAt).length;
  const trashCount = safeArray(notes).filter((note) => Boolean(note?.deletedAt)).length;

  return (
    <div className="page-stack">
      <section className="welcome-row page-welcome">
        <div><p className="eyebrow">کتابخانه شخصی</p><h1>بانک من</h1><p className="welcome-subtitle">همه واژه‌ها، عبارت‌ها، گرامرها و جمله‌های ثبت‌شده را یکجا پیدا کن.</p></div>
        <div className="bank-total"><BookOpen size={18} /><strong>{activeCount.toLocaleString("fa-IR")}</strong><span>یادداشت فعال</span></div>
      </section>

      <section className="panel bank-panel">
        <div className="bank-toolbar">
          <label className="search-field bank-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجو در انگلیسی، معنی فارسی، IPA، مثال و نکات…" />{query && <button type="button" aria-label="پاک‌کردن جست‌وجو" onClick={() => setQuery("")}><X size={14} /></button>}</label>
          <select className="kind-filter" value={kind} onChange={(event) => setKind(event.target.value as NoteKind | "all")} aria-label="فیلتر دسته‌بندی"><option value="all">همه دسته‌ها</option>{NOTE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select className="kind-filter source-filter" value={source} onChange={(event) => setSource(event.target.value)} aria-label="فیلتر جلسه یا منبع"><option value="all">همه جلسه‌ها / منابع</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </div>
        <div className="bank-filter-row">
          <button className={`filter-star ${starredOnly ? "active" : ""}`} type="button" onClick={() => setStarredOnly((value) => !value)}><Star size={15} fill={starredOnly ? "currentColor" : "none"} /> علاقه‌مندی‌ها</button>
          <button className={`filter-star ${showTrash ? "active" : ""}`} type="button" onClick={() => { setShowTrash((value) => !value); setStarredOnly(false); }}><Archive size={15} /> {showTrash ? "بازگشت به بانک" : `سطل زباله (${trashCount.toLocaleString("fa-IR")})`}</button>
          <div className="accent-select"><Headphones size={15} /><span>لهجه تلفظ</span><select value={accent} onChange={(event) => setAccent(event.target.value as EnglishAccent)} aria-label="انتخاب لهجه تلفظ"><option value="us">آمریکایی US</option><option value="uk">بریتانیایی UK</option></select></div>
          <span className="bank-result-count">{filtered.length.toLocaleString("fa-IR")} نتیجه</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state bank-empty"><BookOpen size={34} /><strong>{showTrash ? "سطل زباله خالی است" : "یادداشتی پیدا نشد"}</strong><span>{showTrash ? "یادداشت‌های حذف‌شده اینجا نمایش داده می‌شوند." : "عبارت جست‌وجو یا فیلترها را تغییر بده."}</span></div>
        ) : (
          <div className="bank-list">
            {filtered.map((note) => (
              <article className={`bank-card ${note.deletedAt ? "bank-card-deleted" : ""}`} key={note.id}>
                <div className="bank-card-main">
                  <div className="bank-title-row"><h2 dir="auto">{note.term}</h2><span className="kind-chip">{kindLabel(note.kind)}</span>{note.starred && <Star className="star-inline" size={14} fill="currentColor" />}</div>
                  <p className="bank-meaning">{note.meaning || "معنی ثبت نشده است."}</p>
                  <div className="bank-details">
                    {note.ipa && <span dir="ltr" className="ipa-chip">{note.ipa}</span>}
                    {note.structure && <span>ساختار: <b dir="auto">{note.structure}</b></span>}
                    {note.source && <span>منبع: {note.source}</span>}
                  </div>
                  {note.example && <blockquote className="bank-example" dir="ltr">{note.example}</blockquote>}
                  {note.exampleFa && <p className="bank-example-fa">{note.exampleFa}</p>}
                  {note.notes && <details className="bank-notes"><summary>نکات تکمیلی</summary><p>{note.notes}</p></details>}
                  <small className="bank-date">آخرین ویرایش: {formatDate(note.updatedAt)}{note.deletedAt ? ` · حذف‌شده: ${formatDate(note.deletedAt)}` : ""}</small>
                </div>
                <div className="bank-card-actions">
                  {!note.deletedAt && <>
                    <button className="row-icon" type="button" onClick={() => void handleSpeak(note)} aria-label={`پخش تلفظ ${note.term}`} title={`پخش تلفظ ${accent.toUpperCase()}`} disabled={speakingId === note.id}>{speakingId === note.id ? <span className="mini-loader" /> : <Volume2 size={17} />}</button>
                    <button className={`row-icon ${note.starred ? "is-starred" : ""}`} type="button" onClick={() => void handleStar(note)} aria-label="تغییر علاقه‌مندی" title="علاقه‌مندی"><Star size={17} fill={note.starred ? "currentColor" : "none"} /></button>
                    <button className="row-icon" type="button" onClick={() => onEdit(note.id)} aria-label="ویرایش" title="ویرایش"><Edit3 size={16} /></button>
                    <button className="row-icon danger-icon" type="button" onClick={() => void handleDelete(note)} aria-label="حذف نرم" title="انتقال به سطل زباله"><Trash2 size={16} /></button>
                  </>}
                  {note.deletedAt && <button className="row-icon restore-icon" type="button" onClick={() => void handleRestore(note)} aria-label="بازیابی" title="بازیابی"><RotateCcw size={17} /></button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="bank-footnote">جست‌وجو با یکسان‌سازی «ی/ي» و «ک/ك»، حذف اعراب و نرمال‌سازی فاصله‌ها انجام می‌شود. حذف نرم، یادداشت را از بانک فعال پنهان می‌کند اما تاریخچه مرور را نگه می‌دارد.</p>
    </div>
  );
}
