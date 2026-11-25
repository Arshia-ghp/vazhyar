import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  CloudLightning,
  LoaderCircle,
  Save,
  Settings2,
  Sparkles,
  X
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { normalizeText } from "../lib/safe";
import { db } from "../services/database";
import {
  DEFAULT_ENRICHMENT_SETTINGS,
  enrichNote,
  loadEnrichmentSettings,
  saveEnrichmentSettings,
  type EnrichmentProvider,
  type EnrichmentSettings
} from "../services/enrichment";
import { createNote, updateNote, type CreateNoteInput } from "../services/notes";
import { NOTE_KINDS, type LearningNote, type NoteKind } from "../types/domain";

const SOURCE_KEY = "vazhyar.editor.last-source.v1";
const KEEP_SOURCE_KEY = "vazhyar.editor.keep-source.v1";

interface NoteEditorPageProps {
  noteId: string | null;
  onSaved: (note: LearningNote) => void;
  onCancelEdit: () => void;
  onOpenDuplicate: (noteId: string) => void;
}

interface EditorValues {
  kind: NoteKind;
  term: string;
  meaning: string;
  ipa: string;
  structure: string;
  example: string;
  exampleFa: string;
  source: string;
  notes: string;
}

const EMPTY_VALUES: EditorValues = {
  kind: "word", term: "", meaning: "", ipa: "", structure: "",
  example: "", exampleFa: "", source: "", notes: ""
};

const KIND_GUIDANCE: Record<NoteKind, {
  termLabel: string; termPlaceholder: string; meaningLabel: string; meaningPlaceholder: string;
  structureLabel: string; structurePlaceholder: string; exampleLabel: string; examplePlaceholder: string;
  notesPlaceholder: string; helper: string;
}> = {
  word: {
    termLabel: "کلمه انگلیسی", termPlaceholder: "مثلاً: reluctant", meaningLabel: "معنی فارسی",
    meaningPlaceholder: "بی‌میل، بی‌رغبت", structureLabel: "نقش یا ساختار واژه",
    structurePlaceholder: "adjective · reluctant to do something", exampleLabel: "مثال انگلیسی",
    examplePlaceholder: "She was reluctant to accept the offer.", notesPlaceholder: "مترادف، متضاد، کاربرد و نکات مهم…",
    helper: "برای کلمه، معنی رایج، نقش دستوری، تلفظ و یک مثال طبیعی را ثبت کن."
  },
  phrase: {
    termLabel: "عبارت یا اصطلاح انگلیسی", termPlaceholder: "مثلاً: once in a blue moon", meaningLabel: "مفهوم و معادل فارسی",
    meaningPlaceholder: "خیلی به‌ندرت، هر از گاهی", structureLabel: "الگوی کاربرد",
    structurePlaceholder: "used as an adverbial phrase", exampleLabel: "مثال در بافت واقعی",
    examplePlaceholder: "We only see each other once in a blue moon.", notesPlaceholder: "رسمی/غیررسمی بودن، موقعیت استفاده و نکات فرهنگی…",
    helper: "عبارت را به شکل کامل بنویس؛ معنی تحت‌اللفظی را از مفهوم اصطلاحی جدا کن."
  },
  grammar: {
    termLabel: "موضوع یا عنوان گرامری", termPlaceholder: "مثلاً: Present Perfect", meaningLabel: "کاربرد و توضیح فارسی",
    meaningPlaceholder: "برای بیان تجربه یا نتیجه‌ای مرتبط با زمان حال…", structureLabel: "فرمول / ساختار",
    structurePlaceholder: "Subject + have/has + past participle", exampleLabel: "مثال انگلیسی",
    examplePlaceholder: "I have finished my homework.", notesPlaceholder: "استثناها، تفاوت با زمان‌های مشابه و اشتباهات رایج…",
    helper: "در گرامر، ساختار را دقیق و با ترتیب اجزای جمله ثبت کن."
  },
  sentence: {
    termLabel: "جمله کاربردی انگلیسی", termPlaceholder: "مثلاً: Could you give me a hand?", meaningLabel: "معنی طبیعی فارسی",
    meaningPlaceholder: "می‌تونی یه کم کمکم کنی؟", structureLabel: "موقعیت / الگوی جمله",
    structurePlaceholder: "درخواست مؤدبانه · Could you + base verb…", exampleLabel: "جمله جایگزین یا پاسخ",
    examplePlaceholder: "Sure, what do you need?", notesPlaceholder: "لحن، میزان ادب و موقعیت استفاده…",
    helper: "جمله را با توجه به موقعیت واقعی و لحن آن یادداشت کن."
  },
  "phrasal-verb": {
    termLabel: "فعل عبارتی انگلیسی", termPlaceholder: "مثلاً: look after", meaningLabel: "معنی فارسی",
    meaningPlaceholder: "مراقبت کردن از", structureLabel: "ساختار و جداشدنی بودن",
    structurePlaceholder: "look after + object (inseparable)", exampleLabel: "مثال انگلیسی",
    examplePlaceholder: "She looks after her younger brother.", notesPlaceholder: "معانی دیگر، جداشدنی/جدانشدنی و کاربردها…",
    helper: "مشخص کن فعل جداشدنی است یا نه و جایگاه مفعول کجاست."
  },
  pronunciation: {
    termLabel: "کلمه یا عبارت هدف", termPlaceholder: "مثلاً: comfortable", meaningLabel: "معنی فارسی",
    meaningPlaceholder: "راحت، آسوده", structureLabel: "IPA و نکته آوایی",
    structurePlaceholder: "سه‌هجایی · تکیه روی هجای اول", exampleLabel: "مثال برای تمرین تلفظ",
    examplePlaceholder: "This chair is comfortable.", notesPlaceholder: "تفاوت US/UK، تکیه، اتصال صداها و خطاهای رایج…",
    helper: "IPA را در فیلد تلفظ وارد کن و نکته تکیه یا صدای دشوار را در ساختار بنویس."
  },
  speaking: {
    termLabel: "عبارت / الگوی مکالمه", termPlaceholder: "مثلاً: What I mean is…", meaningLabel: "مفهوم و معادل فارسی",
    meaningPlaceholder: "منظورم اینه که…", structureLabel: "الگوی گفتاری",
    structurePlaceholder: "What I mean is + clause", exampleLabel: "نمونه پاسخ یا دیالوگ",
    examplePlaceholder: "What I mean is, we need more time.", notesPlaceholder: "روانی گفتار، مکث، لحن و موقعیت مکالمه…",
    helper: "عبارت‌های آماده و طبیعی مکالمه را همراه با موقعیت استفاده ثبت کن."
  }
};

function readKeepSource(): boolean {
  try { return localStorage.getItem(KEEP_SOURCE_KEY) !== "false"; } catch { return true; }
}
function readLastSource(): string {
  try {
    // Do not revive an old source after the user explicitly disabled retention.
    if (localStorage.getItem(KEEP_SOURCE_KEY) === "false") return "";
    return localStorage.getItem(SOURCE_KEY) ?? "";
  } catch { return ""; }
}

function toValues(note?: LearningNote): EditorValues {
  if (!note) return { ...EMPTY_VALUES, source: readLastSource() };
  return {
    kind: note.kind, term: note.term, meaning: note.meaning ?? "", ipa: note.ipa ?? "",
    structure: note.structure ?? "", example: note.example ?? "", exampleFa: note.exampleFa ?? "",
    source: note.source ?? "", notes: note.notes ?? ""
  };
}

export function NoteEditorPage({ noteId, onSaved, onCancelEdit, onOpenDuplicate }: NoteEditorPageProps) {
  const editingRecord = useLiveQuery(
    async () => ({ note: noteId ? await db.notes.get(noteId) ?? null : null }),
    [noteId],
    undefined
  );
  const editingNote = editingRecord?.note ?? undefined;
  const [values, setValues] = useState<EditorValues>(() => toValues());
  const [rememberSource, setRememberSource] = useState(readKeepSource);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentMessage, setEnrichmentMessage] = useState<string | null>(null);
  const [enrichmentQuality, setEnrichmentQuality] = useState<"ai" | "quick" | "partial" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<EnrichmentSettings>(() => loadEnrichmentSettings());
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (noteId && editingNote) setValues(toValues(editingNote));
    else if (!noteId) setValues(toValues());
  }, [noteId, editingNote?.id]);

  useEffect(() => {
    try { localStorage.setItem(KEEP_SOURCE_KEY, String(rememberSource)); } catch { /* non-critical preference */ }
  }, [rememberSource]);

  const normalizedTerm = normalizeText(values.term);
  const duplicate = useLiveQuery(async () => {
    if (!normalizedTerm) return undefined;
    const candidates = await db.notes.where("normalizedTerm").equals(normalizedTerm).toArray();
    return candidates.find((candidate) => !candidate.deletedAt && candidate.id !== noteId);
  }, [normalizedTerm, noteId], undefined);

  const guidance = KIND_GUIDANCE[values.kind];
  const canEnrich = Boolean(values.term.trim() || values.meaning.trim());
  const fieldCount = useMemo(() => [values.meaning, values.ipa, values.structure, values.example, values.exampleFa, values.notes].filter((item) => item.trim()).length, [values]);

  function setField<K extends keyof EditorValues>(key: K, value: EditorValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function persistSettings(next: EnrichmentSettings): void {
    setSettings(next);
    saveEnrichmentSettings(next);
  }

  async function handleEnrich(): Promise<void> {
    if (!canEnrich || isEnriching) return;
    setIsEnriching(true);
    setEnrichmentMessage("در حال دریافت اطلاعات سریع و بررسی سرویس هوشمند…");
    setEnrichmentQuality(null);
    try {
      const result = await enrichNote({ term: values.term, meaning: values.meaning, kind: values.kind }, settings);
      setValues((current) => {
        const typedIsPersian = /[\u0600-\u06FF]/u.test(current.term.trim());
        return {
          ...current,
          term: typedIsPersian ? (result.patch.term || current.term) : (current.term.trim() ? current.term : result.patch.term ?? ""),
          meaning: current.meaning.trim() ? current.meaning : result.patch.meaning ?? "",
          ipa: current.ipa.trim() ? current.ipa : result.patch.ipa ?? "",
          structure: current.structure.trim() ? current.structure : result.patch.structure ?? "",
          example: current.example.trim() ? current.example : result.patch.example ?? "",
          exampleFa: current.exampleFa.trim() ? current.exampleFa : result.patch.exampleFa ?? "",
          notes: current.notes.trim() ? current.notes : result.patch.notes ?? ""
        };
      });
      setEnrichmentQuality(result.quality);
      setEnrichmentMessage(`${result.message}${result.sources.length ? ` منابع: ${result.sources.join("، ")}.` : ""}`);
    } catch (error) {
      setEnrichmentQuality("partial");
      setEnrichmentMessage(error instanceof Error ? error.message : "تکمیل اطلاعات انجام نشد.");
    } finally {
      setIsEnriching(false);
    }
  }

  async function handleSave(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (isSaving) return;
    setFormError(null);
    if (!values.term.trim()) {
      setFormError("کلمه، عبارت یا عنوان انگلیسی را وارد کن.");
      return;
    }
    if (duplicate) {
      setFormError(`«${duplicate.term}» قبلاً در بانک فعال وجود دارد. مورد قبلی را باز کن یا عبارت را اصلاح کن.`);
      return;
    }

    const payload: CreateNoteInput = { ...values };
    setIsSaving(true);
    try {
      if (noteId) {
        const result = await updateNote(noteId, payload);
        if (!result.updated) {
          setFormError(`عبارت «${result.duplicate.term}» تکراری است.`);
          return;
        }
        try {
          if (rememberSource) localStorage.setItem(SOURCE_KEY, values.source);
          else localStorage.removeItem(SOURCE_KEY);
        } catch { /* preference only */ }
        onSaved(result.note);
      } else {
        const result = await createNote(payload);
        if (!result.created) {
          setFormError(`«${result.duplicate.term}» قبلاً ثبت شده است.`);
          return;
        }
        try {
          if (rememberSource) localStorage.setItem(SOURCE_KEY, values.source);
          else localStorage.removeItem(SOURCE_KEY);
        } catch { /* preference only */ }
        const nextSource = rememberSource ? values.source : "";
        setValues({ ...EMPTY_VALUES, source: nextSource, kind: values.kind });
        setEnrichmentMessage(null);
        onSaved(result.note);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "ذخیره یادداشت ناموفق بود.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  if (noteId && editingRecord === undefined) {
    return <section className="panel page-panel"><p className="muted">در حال بارگذاری یادداشت برای ویرایش…</p></section>;
  }
  if (noteId && (!editingNote || editingNote.deletedAt)) {
    return <section className="panel page-panel"><p>این یادداشت وجود ندارد یا حذف شده است.</p><button className="button button-secondary" onClick={onCancelEdit} type="button"><ArrowLeft size={15} /> بازگشت به بانک</button></section>;
  }

  return (
    <div className="page-stack">
      <section className="welcome-row page-welcome">
        <div>
          <p className="eyebrow">{noteId ? "ویرایش اطلاعات" : "ثبت سریع"}</p>
          <h1>{noteId ? "ویرایش یادداشت زبانی" : "افزودن آیتم جدید به بانک"}</h1>
          <p className="welcome-subtitle">{guidance.helper}</p>
        </div>
        {noteId && <button className="button button-secondary" type="button" onClick={onCancelEdit}><ArrowLeft size={15} /> بازگشت</button>}
      </section>

      <section className="panel editor-panel">
        <div className="section-heading">
          <div><p className="eyebrow">اطلاعات اصلی</p><h2><BookOpen size={19} /> {noteId ? "فرم ویرایش" : "فرم ثبت یادداشت"}</h2></div>
          <span className="small-tag">{fieldCount.toLocaleString("fa-IR")} فیلد تکمیل‌شده</span>
        </div>

        <form className="note-form editor-form" onSubmit={(event) => void handleSave(event)} onKeyDown={handleFormKeyDown}>
          <div className="form-grid form-grid-main">
            <label className="field">
              <span>{/[\u0600-\u06FF]/u.test(values.term.trim()) ? "معنی فارسی (برای یافتن معادل انگلیسی)" : guidance.termLabel} <b>*</b></span>
              <input dir="auto" autoComplete="off" spellCheck={false} value={values.term}
                onChange={(event) => setField("term", event.target.value)} placeholder="کلمه/عبارت انگلیسی یا معنی فارسی را وارد کن" required />
            </label>
            <label className="field">
              <span>دسته‌بندی</span>
              <select value={values.kind} onChange={(event) => setField("kind", event.target.value as NoteKind)}>
                {NOTE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
          {duplicate && (
            <div className="duplicate-alert" role="alert">
              <AlertTriangle size={18} />
              <div><strong>احتمال ثبت تکراری</strong><span>«{duplicate.term}» با همین عبارت قبلاً ثبت شده است.</span></div>
              <button className="text-button" type="button" onClick={() => onOpenDuplicate(duplicate.id)}>بازکردن مورد قبلی</button>
            </div>
          )}
          <label className="field">
            <span>{guidance.meaningLabel}</span>
            <textarea rows={2} value={values.meaning} onChange={(event) => setField("meaning", event.target.value)} placeholder={guidance.meaningPlaceholder} />
          </label>

          <div className="enrichment-bar">
            <div className="enrichment-info"><Sparkles size={17} /><div><strong>تکمیل سریع اطلاعات</strong><span>دیکشنری و ترجمه سریع؛ هوش مصنوعی اختیاری و محدود به تایم‌اوت</span></div></div>
            <button type="button" className="button button-enrich" onClick={() => void handleEnrich()} disabled={!canEnrich || isEnriching}>
              {isEnriching ? <LoaderCircle className="spin" size={16} /> : <CloudLightning size={16} />}
              {isEnriching ? "در حال تکمیل…" : "تکمیل هوشمند"}
            </button>
          </div>
          {enrichmentMessage && <div className={`enrichment-result ${enrichmentQuality === "ai" ? "result-ai" : ""}`} role="status"><CheckCircle2 size={15} /><span>{enrichmentMessage}</span></div>}
          <button className="text-button settings-toggle" type="button" onClick={() => setShowSettings((shown) => !shown)}>
            <Settings2 size={15} /> {showSettings ? "بستن تنظیمات هوش مصنوعی" : "تنظیم کلید API و سرویس هوشمند"}
          </button>
          {showSettings && (
            <div className="ai-settings">
              <div className="field-grid-three">
                <label className="field"><span>ارائه‌دهنده</span><select value={settings.provider} onChange={(event) => {
                  const provider = event.target.value as EnrichmentProvider;
                  persistSettings({ ...settings, provider, model: provider === "gemini" ? "gemini-4-hydrogen" : "google/gemini-4-hydrogen" });
                }}><option value="gemini">Google Gemini</option><option value="openrouter">OpenRouter</option></select></label>
                <label className="field field-wide"><span>شناسه مدل</span><input dir="ltr" value={settings.model} onChange={(event) => persistSettings({ ...settings, model: event.target.value })} placeholder="gemini-4-hydrogen" /></label>
                <label className="field"><span>مهلت AI (میلی‌ثانیه)</span><input dir="ltr" inputMode="numeric" type="number" min={700} max={3500} step={100} value={settings.timeoutMs} onChange={(event) => persistSettings({ ...settings, timeoutMs: Math.max(700, Math.min(3500, Number(event.target.value) || 1800)) })} /></label>
              </div>
              <label className="field"><span>API Key (اختیاری)</span><div className="secret-input"><input dir="ltr" type={showApiKey ? "text" : "password"} autoComplete="off" value={settings.apiKey} onChange={(event) => persistSettings({ ...settings, apiKey: event.target.value })} placeholder="کلید API را وارد کن" /><button className="row-icon" type="button" onClick={() => setShowApiKey((value) => !value)} aria-label="نمایش یا پنهان‌کردن کلید">{showApiKey ? <X size={15} /> : <CircleHelp size={15} />}</button></div></label>
              <label className="field"><span>آدرس پراکسی امن سرور (اولویت بالاتر از کلید مرورگر)</span><input dir="ltr" value={settings.proxyUrl} onChange={(event) => persistSettings({ ...settings, proxyUrl: event.target.value })} placeholder="https://your-domain.example/api/enrich" /></label>
              <p className="security-note"><AlertTriangle size={15} /> کلید مستقیم فقط در sessionStorage همین نشست ذخیره می‌شود، اما همچنان در اختیار کد مرورگر است و برای انتشار عمومی امن نیست. برای استفاده واقعی، پراکسی سمت سرور تنظیم کن و کلید را فقط در Secret سمت سرور نگه دار.</p>
              <div className="settings-footer"><span>{settings.proxyUrl.trim() ? "پراکسی سرور فعال است." : settings.apiKey.trim() ? "کلید مستقیم تنظیم شده است." : "بدون AI: دیکشنری و مترجم سریع همچنان کار می‌کنند."}</span><button className="text-button" type="button" onClick={() => { persistSettings({ ...DEFAULT_ENRICHMENT_SETTINGS }); }}>پاک‌کردن تنظیمات</button></div>
            </div>
          )}

          <div className="editor-divider" />
          <div className="form-grid">
            <label className="field"><span>تلفظ فونتیک (IPA)</span><input dir="ltr" value={values.ipa} onChange={(event) => setField("ipa", event.target.value)} placeholder="/rɪˈzɪliənt/" /></label>
            <label className="field"><span>{guidance.structureLabel}</span><input dir="auto" value={values.structure} onChange={(event) => setField("structure", event.target.value)} placeholder={guidance.structurePlaceholder} /></label>
          </div>
          <div className="form-grid">
            <label className="field"><span>{guidance.exampleLabel}</span><textarea dir="ltr" rows={2} value={values.example} onChange={(event) => setField("example", event.target.value)} placeholder={guidance.examplePlaceholder} /></label>
            <label className="field"><span>ترجمه مثال</span><textarea rows={2} value={values.exampleFa} onChange={(event) => setField("exampleFa", event.target.value)} placeholder="ترجمه طبیعی جمله به فارسی" /></label>
          </div>
          <div className="form-grid form-grid-source">
            <label className="field"><span>جلسه / منبع</span><input value={values.source} onChange={(event) => setField("source", event.target.value)} placeholder="مثلاً: جلسه ۳، کتاب، پادکست…" /></label>
            <label className="remember-source"><input type="checkbox" checked={rememberSource} onChange={(event) => setRememberSource(event.target.checked)} /><span><strong>جلسه/منبع را برای ثبت بعدی نگه دار</strong><small>در صورت فعال بودن، پس از ذخیره پاک نمی‌شود.</small></span></label>
          </div>
          <label className="field"><span>نکات تکمیلی</span><textarea rows={3} value={values.notes} onChange={(event) => setField("notes", event.target.value)} placeholder={guidance.notesPlaceholder} /></label>

          {formError && <p className="inline-message message-error"><AlertTriangle size={15} /> {formError}</p>}
          <div className="editor-footer">
            <span className="shortcut-hint">میانبر ذخیره: <kbd>Ctrl</kbd> + <kbd>Enter</kbd> یا <kbd>⌘</kbd> + <kbd>Enter</kbd></span>
            <div className="editor-actions">
              {noteId && <button className="button button-secondary" type="button" onClick={onCancelEdit}><X size={15} /> انصراف</button>}
              <button className="button button-primary" type="submit" disabled={isSaving || !values.term.trim() || Boolean(duplicate)}>{isSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{isSaving ? "در حال ذخیره…" : noteId ? "ذخیره تغییرات" : "ذخیره یادداشت"}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
