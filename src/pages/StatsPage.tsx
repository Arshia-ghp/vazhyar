import { Activity, Award, BookOpen, CalendarCheck, Flame, Layers3 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, type ReactNode } from "react";
import { calculateLearningStatistics, MASTERY_MIN_REPS, MASTERY_MIN_STABILITY_DAYS } from "../services/analytics";
import { db } from "../services/database";

const number = (value: number) => value.toLocaleString("fa-IR");

export function StatsPage() {
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
  const cards = useLiveQuery(() => db.reviewCards.toArray(), [], []);
  const logs = useLiveQuery(() => db.reviewLogs.toArray(), [], []);
  const stats = useMemo(() => calculateLearningStatistics(notes, cards, logs), [notes, cards, logs]);
  const maximumActivity = Math.max(1, ...stats.activity.map((day) => day.count));
  const maximumCategory = Math.max(1, ...stats.categories.map((item) => item.count));

  return (
    <div className="phase-page stats-page" dir="rtl">
      <section className="welcome-row">
        <div><p className="eyebrow">تحلیل یادگیری</p><h1>آمار و پیشرفت</h1><p className="welcome-subtitle">گزارش‌ها از روی یادداشت‌ها و رویدادهای واقعی مرور محاسبه می‌شوند.</p></div>
        <div className="privacy-chip"><Activity size={16} /> داده‌های همین دستگاه</div>
      </section>

      <section className="stats-grid stats-grid-five">
        <StatCard icon={<BookOpen size={19} />} color="purple" label="کل آیتم‌های فعال" value={stats.totalNotes} />
        <StatCard icon={<CalendarCheck size={19} />} color="orange" label="آماده مرور همین حالا" value={stats.dueToday} />
        <StatCard icon={<Award size={19} />} color="green" label="تسلط کامل" value={stats.mastered} />
        <StatCard icon={<Flame size={19} />} color="blue" label="استریک روزانه" value={stats.streakDays} suffix="روز" />
        <StatCard icon={<Layers3 size={19} />} color="purple" label="کل رویدادهای مرور" value={stats.reviewEvents} />
      </section>

      <section className="stats-content-grid">
        <article className="panel analytics-panel">
          <div className="section-heading">
            <div><p className="eyebrow">ثبات مطالعه</p><h2><Activity size={18} /> فعالیت ۱۴ روز اخیر</h2></div>
            <span className="small-tag">تعداد مرور در روز</span>
          </div>
          {stats.activity.every((day) => day.count === 0) ? (
            <div className="analytics-empty">هنوز فعالیتی برای نمایش ثبت نشده است.</div>
          ) : (
            <div className="activity-chart" role="img" aria-label="نمودار تعداد مرورهای روزانه در چهارده روز اخیر">
              {stats.activity.map((day) => (
                <div className="activity-column" key={day.key} title={`${day.label}: ${number(day.count)} مرور`}>
                  <span className="activity-count">{day.count ? number(day.count) : ""}</span>
                  <div className="activity-bar-track"><div className="activity-bar" style={{ height: `${Math.max(day.count > 0 ? 7 : 0, (day.count / maximumActivity) * 100)}%` }} /></div>
                  <span className="activity-label">{day.label}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel analytics-panel category-panel">
          <div className="section-heading"><div><p className="eyebrow">توزیع محتوا</p><h2><Layers3 size={18} /> تفکیک دسته‌ها</h2></div></div>
          <div className="category-stat-list">
            {stats.categories.map((item) => (
              <div className="category-stat" key={item.kind}>
                <div className="category-stat-heading"><span>{item.label}</span><b>{number(item.count)}</b></div>
                <div className="category-track"><div className="category-fill" style={{ width: `${(item.count / maximumCategory) * 100}%` }} /></div>
                <small>{number(item.percentage)}٪ از کل</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <article className="panel stats-definition">
        <h2>معیار محاسبه «تسلط کامل»</h2>
        <p>یک آیتم زمانی مسلط شمرده می‌شود که کارت FSRS آن در حالت مرور پایدار (Review) باشد، حداقل {number(MASTERY_MIN_REPS)} بار مرور شده باشد و مقدار پایداری حافظه (Stability) حداقل {number(MASTERY_MIN_STABILITY_DAYS)} روز باشد. این معیار یک تعریف عملیاتی برای داشبورد است، نه تضمین قطعی تسلط زبانی.</p>
        <p>استریک، روزهای متوالی دارای حداقل یک رویداد مرور را محاسبه می‌کند. اگر امروز هنوز مرور نکرده باشی، زنجیره می‌تواند از دیروز ادامه پیدا کند.</p>
      </article>
    </div>
  );
}

function StatCard({ icon, color, label, value, suffix }: { icon: ReactNode; color: string; label: string; value: number; suffix?: string }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon stat-${color}`}>{icon}</div>
      <div><span className="stat-label">{label}</span><strong>{number(value)}{suffix ? <small className="stat-suffix"> {suffix}</small> : null}</strong></div>
    </article>
  );
}
