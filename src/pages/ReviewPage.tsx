import { ArrowLeftRight, BookOpen, Check, ChevronLeft, Eye, Filter, GraduationCap, RefreshCw, Shuffle, Sparkles } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../services/database";
import { previewFsrsRatings, type RatingPreview } from "../services/fsrs";
import { reviewNote } from "../services/notes";
import { NOTE_KINDS, type LearningNote, type NoteKind, type ReviewRating } from "../types/domain";

interface ReviewPageProps {
  onNotify: (message: string, error?: boolean) => void;
}

type ReviewMode = "classic" | "cloze" | "reverse";
type ReviewDomain = "due" | "free";

const RATINGS: Array<{ value: ReviewRating; label: string; className: string }> = [
  { value: "again", label: "دوباره", className: "rating-again" },
  { value: "hard", label: "سخت", className: "rating-hard" },
  { value: "good", label: "خوب", className: "rating-good" },
  { value: "easy", label: "آسان", className: "rating-easy" }
];

function validDueAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? date : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ClozeSegment { text: string; hidden: boolean; }

/** Find the full expression first; if absent, hide the longest matching token. */
export function buildClozeSegments(sentence: string, answer: string): ClozeSegment[] {
  const source = sentence ?? "";
  const target = (answer ?? "").trim();
  if (!source || !target) return [{ text: source, hidden: false }];

  const candidates = [target, ...target.split(/[\s-]+/).filter((word) => word.length >= 3).sort((a, b) => b.length - a.length)];
  for (const candidate of candidates) {
    const candidatePattern = candidate.split(/\s+/).map(escapeRegExp).join("\\s+");
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])(${candidatePattern})(?=$|[^\\p{L}\\p{N}_])`, "iu");
    const match = expression.exec(source);
    if (!match || match.index === undefined) continue;
    const leading = match[1] ?? "";
    const hiddenText = match[2] ?? "";
    const start = match.index;
    const hiddenStart = start + leading.length;
    const hiddenEnd = hiddenStart + hiddenText.length;
    return [
      { text: source.slice(0, hiddenStart), hidden: false },
      { text: hiddenText, hidden: true },
      { text: source.slice(hiddenEnd), hidden: false }
    ].filter((part) => part.text.length > 0);
  }
  return [{ text: source, hidden: false }];
}

function formatInterval(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 60_000) return "کمتر از ۱ دقیقه";
  if (milliseconds < 3_600_000) return `${Math.max(1, Math.round(milliseconds / 60_000))} دقیقه`;
  if (milliseconds < 86_400_000) return `${Math.max(1, Math.round(milliseconds / 3_600_000))} ساعت`;
  return `${Math.max(1, Math.round(milliseconds / 86_400_000))} روز`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "نامشخص";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function ReviewPage({ onNotify }: ReviewPageProps) {
  const notes = useLiveQuery(() => db.notes.toArray(), [], [] as LearningNote[]);
  const cards = useLiveQuery(() => db.reviewCards.toArray(), [], []);
  const [mode, setMode] = useState<ReviewMode>("classic");
  const [domain, setDomain] = useState<ReviewDomain>("due");
  const [kind, setKind] = useState<NoteKind | "all">("all");
  const [source, setSource] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [previews, setPreviews] = useState<RatingPreview[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  const cardByNote = useMemo(() => new Map<string, (typeof cards)[number]>(cards.map((record) => [record.noteId, record] as const)), [cards]);
  const sources = useMemo(() => [...new Set(notes.filter((note) => !note.deletedAt).map((note) => typeof note.source === "string" ? note.source.trim() : "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "fa")), [notes]);
  const queue = useMemo(() => {
    const now = Date.now();
    return notes.filter((note) => {
      if (note.deletedAt) return false;
      if (kind !== "all" && note.kind !== kind) return false;
      if (source !== "all" && note.source !== source) return false;
      if (starredOnly && !note.starred) return false;
      if (domain === "free") return true;
      const due = validDueAt(cardByNote.get(note.id)?.card?.dueAt);
      return due !== null && due <= now;
    }).sort((a, b) => {
      if (domain === "due") return (validDueAt(cardByNote.get(a.id)?.card?.dueAt) ?? 0) - (validDueAt(cardByNote.get(b.id)?.card?.dueAt) ?? 0);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [notes, cardByNote, kind, source, starredOnly, domain]);

  const activeNote = queue.find((note) => note.id === selectedId) ?? queue[0] ?? null;
  const activeCardRecord = activeNote ? cardByNote.get(activeNote.id) : undefined;
  const activeCardSignature = activeCardRecord ? JSON.stringify(activeCardRecord.card) : "";
  const clozeSegments = useMemo(
    () => buildClozeSegments(activeNote?.example ?? "", activeNote?.term ?? ""),
    [activeNote?.example, activeNote?.term]
  );
  const hasClozeTarget = clozeSegments.some((segment) => segment.hidden);

  useEffect(() => {
    setRevealed(false);
  }, [activeNote?.id, mode, domain]);

  useEffect(() => {
    let mounted = true;
    if (domain !== "due" || !activeCardRecord) {
      setPreviews([]);
      setPreviewError(null);
      setPreviewLoading(false);
      return () => { mounted = false; };
    }
    setPreviewLoading(true);
    setPreviewError(null);
    void previewFsrsRatings(activeCardRecord.card).then((result) => {
      if (mounted) { setPreviews(result); setPreviewError(null); }
    }).catch((error: unknown) => {
      if (mounted) {
        setPreviews([]);
        setPreviewError(error instanceof Error ? error.message : "پیش‌نمایش زمان‌بندی در دسترس نیست.");
      }
    }).finally(() => { if (mounted) setPreviewLoading(false); });
    return () => { mounted = false; };
  }, [domain, activeCardRecord?.id, activeCardRecord?.updatedAt, activeCardSignature, previewAttempt]);

  async function submitRating(rating: ReviewRating): Promise<void> {
    if (!activeNote || domain !== "due" || busyRef.current || !revealed || !activeCardRecord) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await reviewNote(activeNote.id, rating);
      const label = RATINGS.find((item) => item.value === rating)?.label ?? "مرور";
      setSelectedId(null);
      setRevealed(false);
      onNotify(`${label} ثبت شد؛ کارت بعدی در صف قرار گرفت.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "ثبت مرور انجام نشد. دوباره تلاش کن.", true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function goNext(): void {
    if (busyRef.current || queue.length === 0) return;
    const currentIndex = activeNote ? queue.findIndex((note) => note.id === activeNote.id) : -1;
    const next = queue[(currentIndex + 1) % queue.length];
    setSelectedId(next?.id ?? null);
    setRevealed(false);
  }

  function changeDomain(value: ReviewDomain): void {
    setDomain(value);
    setSelectedId(null);
    setRevealed(false);
  }

  function changeFilter<T extends string>(setter: (value: T) => void, value: T): void {
    setter(value);
    setSelectedId(null);
    setRevealed(false);
  }

  return (
    <div className="phase-page review-page" dir="rtl">
      <section className="welcome-row">
        <div><p className="eyebrow">تمرین و تثبیت</p><h1>مرور هوشمند</h1><p className="welcome-subtitle">روش تمرین و دامنه مرور را انتخاب کن؛ ثبت مرور FSRS فقط در حالت زمان‌بندی‌شده انجام می‌شود.</p></div>
        <div className="privacy-chip"><GraduationCap size={16} /> {domain === "due" ? "FSRS-7" : "تمرین آزاد"}</div>
      </section>

      <section className="panel review-controls">
        <div className="review-control-group">
          <span className="control-label">شیوه تمرین</span>
          <div className="segmented-control" role="group" aria-label="شیوه تمرین">
            <button className={mode === "classic" ? "selected" : ""} type="button" onClick={() => setMode("classic")}><BookOpen size={15} /> کلاسیک</button>
            <button className={mode === "cloze" ? "selected" : ""} type="button" onClick={() => setMode("cloze")}><Sparkles size={15} /> Cloze</button>
            <button className={mode === "reverse" ? "selected" : ""} type="button" onClick={() => setMode("reverse")}><ArrowLeftRight size={15} /> معکوس</button>
          </div>
        </div>
        <div className="review-control-group">
          <span className="control-label">دامنه تمرین</span>
          <div className="segmented-control" role="group" aria-label="دامنه تمرین">
            <button className={domain === "due" ? "selected" : ""} type="button" onClick={() => changeDomain("due")}>مرور امروز FSRS</button>
            <button className={domain === "free" ? "selected" : ""} type="button" onClick={() => changeDomain("free")}>تمرین آزاد</button>
          </div>
        </div>
        <div className="review-filters">
          <label className="field"><span><Filter size={13} /> دسته‌بندی</span><select value={kind} onChange={(event) => changeFilter(setKind, event.target.value as NoteKind | "all")}><option value="all">همه دسته‌ها</option>{NOTE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="field"><span>جلسه / منبع</span><select value={source} onChange={(event) => changeFilter(setSource, event.target.value)}><option value="all">همه جلسات</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className={`filter-star ${starredOnly ? "active" : ""}`}><input type="checkbox" checked={starredOnly} onChange={(event) => { setStarredOnly(event.target.checked); setSelectedId(null); setRevealed(false); }} /> فقط نشان‌دارها</label>
          <span className="review-queue-count">{queue.length.toLocaleString("fa-IR")} کارت در صف</span>
        </div>
      </section>

      <section className="review-workspace">
        <article className="panel review-stage">
          {activeNote ? (
            <>
              <div className="review-stage-top"><span className="kind-chip">{NOTE_KINDS.find((item) => item.value === activeNote.kind)?.label ?? "یادداشت"}</span><span className="review-counter">{queue.findIndex((item) => item.id === activeNote.id) + 1} از {queue.length}</span></div>
              <div className="review-question">
                {mode === "classic" && <>
                  <p className="review-hint">معنی فارسی این عبارت را به خاطر بیاور</p>
                  <h2 dir="auto">{activeNote.term}</h2>
                  {activeNote.ipa && <span className="review-ipa" dir="ltr">{activeNote.ipa}</span>}
                </>}
                {mode === "reverse" && <>
                  <p className="review-hint">معادل انگلیسی را از روی معنی تولید کن</p>
                  <h2 className="review-persian">{activeNote.meaning || "برای این یادداشت هنوز معنی ثبت نشده است."}</h2>
                </>}
                {mode === "cloze" && <>
                  <p className="review-hint">جای خالی جمله را با عبارت مناسب کامل کن</p>
                  {activeNote.example ? (
                    <div className="cloze-sentence" dir="ltr" lang="en">
                      {clozeSegments.map((segment, index) => segment.hidden
                        ? <span key={index} className={revealed ? "cloze-revealed" : "cloze-blank"}>{revealed ? segment.text : "＿＿＿＿"}</span>
                        : <span key={index}>{segment.text}</span>)}
                    </div>
                  ) : <div className="cloze-missing">برای این یادداشت مثال انگلیسی ثبت نشده است.</div>}
                  {activeNote.exampleFa && revealed && <p className="cloze-translation">{activeNote.exampleFa}</p>}
                  {activeNote.example && !hasClozeTarget && <p className="cloze-warning">عبارت اصلی عیناً در جمله پیدا نشد؛ جمله برای تمرین بافت نمایش داده شده است.</p>}
                </>}
              </div>

              {revealed && (
                <div className="review-answer" aria-live="polite">
                  {mode !== "reverse" && <strong className="answer-term" dir="auto">{activeNote.term}</strong>}
                  {mode !== "classic" && <p className="answer-meaning">{activeNote.meaning || "معنی ثبت نشده است."}</p>}
                  {mode === "classic" && <p className="answer-meaning">{activeNote.meaning || "معنی ثبت نشده است."}</p>}
                  {activeNote.structure && <p><b>ساختار:</b> {activeNote.structure}</p>}
                  {activeNote.ipa && <p dir="ltr" className="review-ipa">{activeNote.ipa}</p>}
                  {mode !== "cloze" && activeNote.example && <blockquote dir="ltr">{activeNote.example}</blockquote>}
                  {activeNote.exampleFa && mode !== "cloze" && <p>{activeNote.exampleFa}</p>}
                  {activeNote.notes && <p className="answer-notes">{activeNote.notes}</p>}
                </div>
              )}

              <div className="review-actions">
                {!revealed ? (
                  <button type="button" className="button button-primary button-reveal" onClick={() => setRevealed(true)}><Eye size={16} /> نمایش پاسخ</button>
                ) : domain === "free" ? (
                  <button type="button" className="button button-primary button-reveal" onClick={goNext}><ChevronLeft size={16} /> کارت بعدی</button>
                ) : null}
                {domain === "free" && <button type="button" className="button button-secondary" onClick={goNext} disabled={busy}><Shuffle size={15} /> رد شدن</button>}
                {domain === "due" && revealed && (
                  <div className="review-rating-block">
                    <p className="review-instruction">میزان یادآوری خودت را صادقانه ارزیابی کن.</p>
                    {previewError && <div className="inline-message message-error preview-error-row"><span>{previewError}</span><button type="button" className="text-button" disabled={previewLoading || busy} onClick={() => setPreviewAttempt((value) => value + 1)}>تلاش دوباره</button></div>}
                    {!previewLoading && !previewError && previews.length === 0 && <p className="inline-message message-error">پیش‌نمایش امتیازها ساخته نشد. دوباره تلاش کن.</p>}
                    <div className="rating-grid">
                      {RATINGS.map((rating) => {
                        const preview = previews.find((item) => item.rating === rating.value);
                        return <button key={rating.value} type="button" className={`rating-button ${rating.className}`} onClick={() => void submitRating(rating.value)} disabled={busy || previewLoading || !preview || Boolean(previewError)}>
                          <strong>{rating.label}</strong><span>{preview ? formatInterval(preview.intervalMs) : previewLoading ? "محاسبه…" : "—"}</span>
                        </button>;
                      })}
                    </div>
                    {busy && <p className="busy-inline"><span className="mini-loader" /> در حال ثبت مرور…</p>}
                  </div>
                )}
              </div>
              {domain === "due" && activeCardRecord && <div className="due-line"><span>موعد فعلی</span><b>{formatDate(activeCardRecord.card.dueAt)}</b></div>}
            </>
          ) : (
            <div className="empty-review">
              <GraduationCap size={34} />
              <strong>{domain === "due" ? "مرور سررسیدشده‌ای وجود ندارد" : "موردی برای تمرین پیدا نشد"}</strong>
              <span>{domain === "due" ? "کارت‌های جدید یا موعدهای آینده در تمرین آزاد در دسترس‌اند." : "فیلترها را تغییر بده یا ابتدا یادداشت جدید ثبت کن."}</span>
              <button type="button" className="button button-secondary" onClick={() => { setKind("all"); setSource("all"); setStarredOnly(false); if (domain === "due") setDomain("free"); }}>پاک‌کردن فیلترها</button>
            </div>
          )}
        </article>

        <aside className="panel review-side-panel">
          <div className="section-heading"><div><p className="eyebrow">راهنمای تمرین</p><h2><GraduationCap size={18} /> روش فعلی</h2></div></div>
          <div className="review-mode-explain">
            {mode === "classic" && <><h3>کلاسیک · انگلیسی به فارسی</h3><p>ابتدا معنی واژه را در ذهن بازیابی کن، سپس پاسخ را ببین و میزان یادآوری را ارزیابی کن.</p></>}
            {mode === "cloze" && <><h3>Cloze · یادگیری در بافت</h3><p>برنامه ابتدا خود عبارت را در جمله پیدا می‌کند و سپس آن را پنهان می‌کند. در نبود تطبیق، جمله بدون حذف اشتباه نمایش داده می‌شود.</p></>}
            {mode === "reverse" && <><h3>معکوس · فارسی به انگلیسی</h3><p>از روی معنی فارسی، عبارت انگلیسی را فعالانه تولید کن. این حالت برای تقویت بازیابی و تولید زبان است.</p></>}
          </div>
          <div className="review-domain-note"><Check size={15} /><span>{domain === "due" ? "امتیازدهی در این حالت وضعیت FSRS را به‌روزرسانی و تاریخچه مرور را ثبت می‌کند." : "تمرین آزاد هیچ تغییری در زمان‌بندی یا تاریخچه FSRS ایجاد نمی‌کند."}</span></div>
          {queue.length > 1 && <button type="button" className="button button-secondary button-full" onClick={goNext}><ChevronLeft size={15} /> رفتن به کارت بعدی</button>}
          {activeNote?.source && <p className="review-source">جلسه / منبع: <b>{activeNote.source}</b></p>}
          {busy && <p className="busy-inline"><RefreshCw size={14} className="spin" /> عملیات در حال انجام است؛ لطفاً دوباره کلیک نکن.</p>}
        </aside>
      </section>
    </div>
  );
}
