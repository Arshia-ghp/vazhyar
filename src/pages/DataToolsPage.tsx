import { CheckCircle2, Download, FileJson, FileSpreadsheet, FolderInput, ShieldCheck, Upload } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { NOTE_KINDS, type NoteKind } from "../types/domain";
import { downloadBackup, importBackupFile, type BackupRestoreMode } from "../services/backup";
import { downloadAnkiCsv, importCsvRows, parseCsvFile, type CsvColumnMapping, type CsvDocument, type CsvField, type CsvImportResult } from "../services/csv";

interface DataToolsPageProps {
  onNotify: (message: string, error?: boolean) => void;
}

const CSV_FIELDS: Array<{ key: CsvField; label: string; required?: boolean }> = [
  { key: "term", label: "کلمه / عبارت انگلیسی", required: true },
  { key: "meaning", label: "معنی فارسی" },
  { key: "ipa", label: "تلفظ IPA" },
  { key: "structure", label: "ساختار / الگو" },
  { key: "example", label: "مثال انگلیسی" },
  { key: "exampleFa", label: "ترجمه مثال" },
  { key: "source", label: "جلسه / منبع" },
  { key: "notes", label: "نکات تکمیلی" }
];

export function DataToolsPage({ onNotify }: DataToolsPageProps) {
  const [busy, setBusy] = useState(false);
  const [restoreMode, setRestoreMode] = useState<BackupRestoreMode>("replace");
  const [csvDocument, setCsvDocument] = useState<CsvDocument | null>(null);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvKind, setCsvKind] = useState<NoteKind>("word");
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvSummary, setCsvSummary] = useState<CsvImportResult | null>(null);

  const mappedPreview = useMemo(() => {
    if (!csvDocument) return [];
    return csvDocument.rows.slice(0, 5).map((row) => ({
      term: mapping.term === undefined ? "" : row[mapping.term] ?? "",
      meaning: mapping.meaning === undefined ? "" : row[mapping.meaning] ?? ""
    }));
  }, [csvDocument, mapping]);

  async function exportFullBackup(): Promise<void> {
    setBusy(true);
    try {
      await downloadBackup();
      onNotify("پشتیبان کامل JSON با یادداشت‌ها، کارت‌ها، تاریخچه و تنظیمات دانلود شد.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "ساخت پشتیبان ناموفق بود.", true);
    } finally { setBusy(false); }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    if (restoreMode === "replace") {
      const accepted = window.confirm("بازیابی جایگزین، اطلاعات فعلی این دستگاه را با محتوای پشتیبان جایگزین می‌کند. پیش از ادامه، از داده‌های فعلی پشتیبان بگیر. ادامه می‌دهی؟");
      if (!accepted) { event.target.value = ""; return; }
    }
    setBusy(true);
    try {
      const result = await importBackupFile(file, restoreMode);
      onNotify(`${result.notes.toLocaleString("fa-IR")} یادداشت، ${result.cards.toLocaleString("fa-IR")} کارت و ${result.logs.toLocaleString("fa-IR")} رویداد ${restoreMode === "replace" ? "جایگزین شد" : "ادغام شد"}.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "بازیابی پشتیبان ناموفق بود.", true);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function exportAnki(): Promise<void> {
    setBusy(true);
    try {
      const count = await downloadAnkiCsv();
      onNotify(`${count.toLocaleString("fa-IR")} یادداشت در فایل CSV سازگار با Anki صادر شد.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "خروجی Anki ناموفق بود.", true);
    } finally { setBusy(false); }
  }

  async function readCsv(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    setCsvSummary(null);
    try {
      const parsed = await parseCsvFile(file);
      setCsvDocument(parsed);
      setCsvFileName(file.name);
      setMapping(parsed.suggestedMapping);
      onNotify(`${parsed.rows.length.toLocaleString("fa-IR")} ردیف از فایل CSV شناسایی شد.`);
    } catch (error) {
      setCsvDocument(null);
      setCsvFileName("");
      const message = error instanceof Error ? error.message : "خواندن CSV ناموفق بود.";
      setCsvError(message);
      onNotify(message, true);
    } finally { event.target.value = ""; }
  }

  async function importCsv(): Promise<void> {
    if (!csvDocument) return;
    if (mapping.term === undefined) {
      setCsvError("ستون کلمه / عبارت انگلیسی را انتخاب کن.");
      return;
    }
    setBusy(true);
    setCsvError(null);
    try {
      const result = await importCsvRows(csvDocument, mapping, csvKind);
      setCsvSummary(result);
      onNotify(`${result.added.toLocaleString("fa-IR")} آیتم وارد شد؛ ${result.duplicates.toLocaleString("fa-IR")} تکراری و ${result.invalidRows.toLocaleString("fa-IR")} ردیف نامعتبر نادیده گرفته شد.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ورود CSV ناموفق بود.";
      setCsvError(message);
      onNotify(message, true);
    } finally { setBusy(false); }
  }

  function changeMapping(field: CsvField, value: string): void {
    setMapping((current) => {
      if (value === "") {
        const next = { ...current };
        delete next[field];
        return next;
      }
      return { ...current, [field]: Number(value) };
    });
  }

  async function downloadBlankTemplate(): Promise<void> {
    const rows = ["term,meaning,ipa,structure,example,exampleFa,source,notes", "resilient,تاب‌آور,/rɪˈzɪliənt/,adjective,She is resilient.,او تاب‌آور است.,جلسه ۱,"];
    const blob = new Blob(["\uFEFF", rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vazhyar-csv-template.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className="phase-page data-tools-page" dir="rtl">
      <section className="welcome-row">
        <div><p className="eyebrow">مالکیت و انتقال داده</p><h1>پشتیبان‌گیری و ورود اطلاعات</h1><p className="welcome-subtitle">نسخه کامل داده‌ها را مستقل از حافظه مرورگر نگه دار و مجموعه‌های قدیمی را وارد کن.</p></div>
        <div className="privacy-chip"><ShieldCheck size={16} /> داده‌ها روی دستگاه تو</div>
      </section>

      <section className="data-tools-grid">
        <article className="panel data-tool-card">
          <div className="tool-icon tool-violet"><FileJson size={22} /></div>
          <p className="eyebrow">پشتیبان کامل</p>
          <h2>خروجی و بازیابی JSON</h2>
          <p>شامل تمام یادداشت‌ها (حتی حذف نرم‌شده‌ها)، کارت‌های FSRS، تاریخچه مرور و رکوردهای تنظیمات محلی.</p>
          <button type="button" className="button button-primary button-full" onClick={() => void exportFullBackup()} disabled={busy}><Download size={16} /> دریافت پشتیبان کامل</button>
          <div className="restore-options">
            <label className="field"><span>روش بازیابی</span><select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value as BackupRestoreMode)} disabled={busy}><option value="replace">جایگزینی کامل اطلاعات فعلی</option><option value="merge">ادغام بر اساس شناسه یکتا</option></select></label>
            <label className={`button button-secondary button-full file-button ${busy ? "is-disabled" : ""}`}><Upload size={15} /> انتخاب فایل JSON برای بازیابی<input type="file" accept="application/json,.json" onChange={(event) => void restoreBackup(event)} disabled={busy} /></label>
          </div>
          <p className="tool-footnote"><ShieldCheck size={14} /> بازیابی جایگزین قبل از اجرا تأیید می‌خواهد. نسخه ۱ پشتیبان‌های قدیمی نیز پشتیبانی می‌شود.</p>
        </article>

        <article className="panel data-tool-card">
          <div className="tool-icon tool-green"><FileSpreadsheet size={22} /></div>
          <p className="eyebrow">انتقال به Anki</p>
          <h2>خروجی CSV سازگار با Anki</h2>
          <p>فیلدهای Front، Back و Tags تولید می‌شوند. معنی، IPA، ساختار، مثال و نکات تکمیلی در پشت کارت قرار می‌گیرند.</p>
          <div className="anki-preview"><span>Front</span><b dir="ltr">resilient</b><span>Back</span><b>تاب‌آور · adjective · She is resilient.</b><span>Tags</span><b dir="ltr">word starred</b></div>
          <button type="button" className="button button-primary button-full" onClick={() => void exportAnki()} disabled={busy}><Download size={16} /> خروجی CSV با UTF-8 BOM</button>
          <p className="tool-footnote">در Anki نوع یادداشت Basic را انتخاب کن و ستون‌ها را به Front، Back و Tags متصل کن.</p>
        </article>
      </section>

      <section className="panel csv-import-panel">
        <div className="section-heading">
          <div><p className="eyebrow">ورود از فایل‌های قدیمی</p><h2><FolderInput size={19} /> واردکردن CSV / Google Sheets</h2></div>
          {csvDocument && <span className="small-tag">{csvDocument.rows.length.toLocaleString("fa-IR")} ردیف</span>}
        </div>
        <p className="csv-intro">فایل CSV یا TSV خروجی از Google Sheets را انتخاب کن. برنامه جداکننده، عنوان ستون‌ها و قالب رایج انگلیسی/فارسی را تشخیص می‌دهد؛ سپس می‌توانی نگاشت ستون‌ها را اصلاح کنی.</p>
        <label className={`csv-dropzone ${busy ? "is-disabled" : ""}`}>
          <Upload size={22} />
          <strong>{csvFileName || "انتخاب فایل CSV"}</strong>
          <span>پشتیبانی از UTF-8، BOM، کاما، نقطه‌ویرگول و Tab</span>
          <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => void readCsv(event)} disabled={busy} />
        </label>
        {csvError && <p className="inline-message message-error">{csvError}</p>}

        {csvDocument && (
          <div className="csv-config">
            <div className="csv-config-heading"><h3>۱. دسته مقصد و نگاشت ستون‌ها</h3><button type="button" className="text-button" onClick={() => void downloadBlankTemplate()}><Download size={14} /> دریافت قالب نمونه</button></div>
            <div className="csv-kind-row">
              <label className="field"><span>دسته مقصد برای تمام ردیف‌ها</span><select value={csvKind} onChange={(event) => setCsvKind(event.target.value as NoteKind)}>{NOTE_KINDS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
              <div className="csv-file-meta"><b>{csvDocument.hasHeader ? "ردیف اول به‌عنوان عنوان ستون تشخیص داده شد." : "فایل بدون سرتیتر تشخیص داده شد."}</b><span>جداکننده: {csvDocument.delimiter === "\t" ? "Tab" : csvDocument.delimiter}</span></div>
            </div>
            <div className="csv-mapping-grid">
              {CSV_FIELDS.map((field) => (
                <label className="field" key={field.key}><span>{field.label}{field.required && <b> *</b>}</span><select value={mapping[field.key] ?? ""} onChange={(event) => changeMapping(field.key, event.target.value)}><option value="">— انتخاب نشود —</option>{csvDocument.columns.map((column, index) => <option value={index} key={`${column}-${index}`}>{column} (ستون {index + 1})</option>)}</select></label>
              ))}
            </div>
            <h3 className="csv-preview-title">۲. پیش‌نمایش پنج ردیف اول</h3>
            <div className="csv-preview-table-wrap"><table className="csv-preview-table"><thead><tr><th>English / Front</th><th>معنی / Back</th></tr></thead><tbody>{mappedPreview.map((row, index) => <tr key={index}><td dir="auto">{row.term || "—"}</td><td>{row.meaning || "—"}</td></tr>)}</tbody></table></div>
            <div className="csv-import-footer"><span>تکراری‌ها نادیده گرفته می‌شوند؛ کارت FSRS برای موارد جدید ساخته می‌شود.</span><button type="button" className="button button-primary" onClick={() => void importCsv()} disabled={busy || mapping.term === undefined}><FolderInput size={15} /> {busy ? "در حال ورود…" : "واردکردن ردیف‌ها"}</button></div>
            {csvSummary && <div className="csv-result" role="status"><CheckCircle2 size={16} /><span>{csvSummary.added.toLocaleString("fa-IR")} اضافه شد، {csvSummary.duplicates.toLocaleString("fa-IR")} تکراری، {csvSummary.invalidRows.toLocaleString("fa-IR")} ردیف خالی یا نامعتبر.</span></div>}
          </div>
        )}
      </section>

      {busy && <div className="busy-overlay-note" role="status"><span className="mini-loader" /> عملیات داده در حال اجراست؛ صفحه را نبند.</div>}
    </div>
  );
}
