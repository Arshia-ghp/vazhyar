# واژه‌یار — نسخه ۰.۴.۰ (فازهای ۱ تا ۴)

PWA فارسی/RTL برای ثبت و یادگیری زبان انگلیسی، مرور FSRS، آمار، انتقال فایل و همگام‌سازی چنددستگاهی.

## ۱) پیش‌نیاز و اجرای محلی

- Node.js نسخه ۲۴ یا جدیدتر (نسخه در `.nvmrc` ثبت شده است).
- npm نسخه ۱۰ یا جدیدتر.
- مرورگر به‌روز با IndexedDB و Service Worker.

**Windows (PowerShell با nvm-windows):**

```powershell
nvm install 24
nvm use 24
node -v
npm install
npm run typecheck
npm run test
npm run build
npm run preview
```

در macOS/Linux با nvm می‌توانی از `.nvmrc` استفاده کنی:

```bash
nvm install
nvm use
npm install
npm run typecheck
npm run test
npm run build
npm run preview
```

در محیط توسعه:

```bash
npm run dev
```

Service Worker در dev غیرفعال است؛ برای تست PWA، پس از `npm run build` از `npm run preview` استفاده کن.

## ۲) مدل همگام‌سازی و LWW

هر دستگاه ابتدا در IndexedDB کار می‌کند. هنگام شروع سینک:

1. یک snapshot از `notes`، `reviewCards` و `reviewLogs` از IndexedDB خوانده می‌شود.
2. تمام رکوردهای محلی در دسته‌های کوچک Push می‌شوند.
3. سرور همه رکوردها را با صفحه‌بندی Full Pull برمی‌گرداند.
4. یادداشت و وضعیت کارت با `updatedAt` ادغام می‌شوند؛ timestamp بزرگ‌تر برنده است.
5. در timestamp برابر، نسخه‌ای که از قبل روی سرور ثبت شده برنده است؛ Pull آن را روی دستگاه محلی می‌نشاند.
6. رویدادهای مرور (`reviewLogs`) append-only هستند و بر اساس ID یکتا dedupe می‌شوند؛ رویداد قبلی بازنویسی نمی‌شود.
7. حذف یادداشت soft-delete است (`deletedAt`) و tombstone در سینک باقی می‌ماند. ردیف‌ها را از Google Sheet یا Supabase به‌صورت دستی hard-delete نکن.

Full Pull از snapshot revision و cursor صفحه‌بندی استفاده می‌کند. اگر revision سرور هنگام دریافت تغییر کند، دریافت از صفحه اول تکرار می‌شود. اگر بعد از تعداد تلاش‌های محدود همچنان داده‌ها تغییر کنند، سینک موفق اعلام نمی‌شود و پیام خطا برای تلاش مجدد نشان داده می‌شود. تغییر محلی حین سینک نیز یک دور Full Push/Pull دیگر درخواست می‌کند؛ تغییر در تب دیگر با `BroadcastChannel` به تب فعال خبر داده می‌شود.

هر درخواست شبکه timeout دارد: Google Apps Script حدود ۲۵ ثانیه و درخواست‌های Supabase حدود ۱۲ ثانیه. خطا یا timeout صف داده محلی را حذف نمی‌کند؛ اجرای بعدی Push را دوباره می‌فرستد و سمت سرور idempotent است.

### محدودیت ذاتی LWW

LWW به ساعت هر دستگاه وابسته است. گزینه Automatic date/time و منطقه زمانی صحیح را در گوشی و لپ‌تاپ فعال نگه دار. ساعت اشتباه ممکن است ویرایش قدیمی را جدیدتر جلوه دهد. در timestamp کاملاً برابر، سرور برنده است.

`reviewLogs` در هر دو دستگاه حفظ می‌شوند، اما اگر یک کارت مشخص را هم‌زمان و آفلاین روی دو دستگاه مرور کنی، وضعیت نهایی `reviewCards` با LWW انتخاب می‌شود و دو محاسبه FSRS با هم جمع نمی‌شوند. بهتر است یک کارت را هم‌زمان روی دو دستگاه مرور نکنی. تاریخچه هر دو رویداد باقی می‌ماند.

## ۳) اتصال Google Sheets با Apps Script

این روش برای یک حساب شخصی ساده است و به سرور Node اختصاصی نیاز ندارد. تب‌های ذخیره‌سازی توسط اسکریپت ساخته و مخفی می‌شوند. این تب‌ها را دستی ویرایش یا حذف نکن.

### مرحله A — ساخت Spreadsheet و Apps Script

1. یک Google Spreadsheet جدید بساز.
2. از منوی **Extensions → Apps Script** ویرایشگر اسکریپت را باز کن.
3. محتوای `apps-script/Code.gs` را جایگزین کد پیش‌فرض کن و Save بزن.
4. در **Project Settings → Script Properties** دو مقدار بساز:
   - `SPREADSHEET_ID`: بخش شناسه فایل بین `/d/` و `/edit` در URL شیت.
   - `SYNC_PIN`: یک راز تصادفی حداقل ۳۲ نویسه‌ای؛ بهتر است ۶۴ رقم هگز (۲۵۶ بیت) باشد. PIN را در کد، GitHub یا شیت ننویس.
5. یک PIN تصادفی بساز؛ در ترمینال macOS/Linux:

   ```bash
   openssl rand -hex 32
   ```

   در Windows PowerShell:

   ```powershell
   -join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }))
   ```

6. از فهرست توابع، `setupVazhyarSheets` را انتخاب و یک بار Run کن. مجوزهای درخواستی Google را با حساب مالک Spreadsheet تأیید کن. این تابع سه تب `Vazhyar_Notes`، `Vazhyar_ReviewCards` و `Vazhyar_ReviewLogs` را می‌سازد و مخفی می‌کند.

### مرحله B — Deploy کردن Web App

1. در Apps Script روی **Deploy → New deployment** بزن.
2. نوع را **Web app** انتخاب کن.
3. **Execute as: Me** را انتخاب کن.
4. برای **Who has access** گزینه‌ای را انتخاب کن که کاربر ناشناس بتواند endpoint را فراخوانی کند (در رابط معمولاً `Anyone`). استفاده از این گزینه به سیاست حساب Google Workspace وابسته است؛ ممکن است مدیر سازمان آن را ممنوع کرده باشد.
5. Deploy کن، مجوزها را تأیید کن و URL نهایی `/exec` را کپی کن. از URL توسعه `/dev` استفاده نکن.
6. هر بار کد Apps Script را عوض کردی، یک نسخه جدید از deployment را منتشر کن (Manage deployments → Edit → New version).

### مرحله C — اتصال در واژه‌یار

1. در برنامه وارد **همگام‌سازی** شو.
2. ارائه‌دهنده را روی **Google Sheets** بگذار.
3. URL وب‌اپ `/exec` و همان `SYNC_PIN` را وارد کن.
4. گزینه ذخیره ماندگار PIN اختیاری است؛ پیش‌فرض، نگهداری در sessionStorage است.
5. **ذخیره و آزمایش اتصال** را بزن.
6. همین URL و PIN را روی گوشی هم وارد کن. هر دو دستگاه باید به همان Spreadsheet و همان PIN وصل شوند.
7. یک بار **همگام‌سازی دوطرفه اکنون** را اجرا کن.

ارتباط مرورگر با Apps Script از فرم POST معمولی به iframe مخفی استفاده می‌کند و پاسخ از طریق `postMessage` با شناسه درخواست تطبیق داده می‌شود؛ در نتیجه client به `fetch` و CORS/OPTIONS وابسته نیست. Apps Script در HTML Service از iframe sandbox استفاده می‌کند و bridge با `ALLOWALL` قابلیت embed را فعال می‌کند؛ PIN همچنان راز اصلی است. این جریان باید بعد از Deploy واقعی در مرورگرهای هدف آزمایش شود.

**نکته دسترسی جغرافیایی/شبکه:** استفاده از Apps Script به‌معنای تضمین دسترسی بدون VPN نیست. دسترسی به دامنه‌های Google به ISP، کشور، شبکه دانشگاه/سازمان و سیاست Workspace بستگی دارد. اگر `script.google.com` یا `script.googleusercontent.com` قابل دسترسی نبود، این روش را نمی‌توان از سمت برنامه دور زد؛ از Supabase یا endpoint قابل دسترس در زیرساختی که مجاز به استفاده از آن هستی استفاده کن.

**امنیت PIN:** Web App با دسترسی Anyone یک endpoint عمومی است که عملیات را با bearer PIN مجاز می‌کند. PIN تصادفی بلند را مانند رمز عبور نگه دار، آن را در issue/log یا مخزن GitHub نگذار و اگر افشا شد فوراً Script Property را عوض و deployment را به‌روزرسانی کن. `LockService.getScriptLock()` نوشتن‌ها و snapshot metadata را سری می‌کند؛ قفل با `tryLock` زمان محدود دارد و در `finally` آزاد می‌شود.

## ۴) اتصال Supabase

1. یک پروژه Supabase بساز.
2. در Authentication، Email provider را فعال کن و یک حساب بساز/تأیید کن.
3. فایل `supabase/schema.sql` را یک بار در **SQL Editor** اجرا کن.
4. در برنامه → همگام‌سازی → Supabase، Project URL و کلید عمومی `anon` یا `publishable` را وارد کن.
5. با همان ایمیل/گذرواژه در هر دو دستگاه وارد شو.
6. **همگام‌سازی دوطرفه اکنون** را اجرا کن.

کلید `service_role` یا secret key را هرگز داخل برنامه مرورگر وارد نکن. جدول با RLS محافظت می‌شود؛ رکوردها با `auth.uid()` محدود به حساب جاری هستند و نوشتن فقط از RPC کنترل‌شده عبور می‌کند. قفل advisory مشترک بین watermark snapshot و writerها جلوی مشکل commit-order در sequence را می‌گیرد.

جزئیات SQL در `supabase/schema.sql` و راهنمای تکمیلی در `supabase/README.md` است.

## ۵) انتشار خودکار روی GitHub Pages

Workflow در `.github/workflows/deploy.yml` با هر Push به شاخه `main` اجرا می‌شود و مراحل typecheck، test، build و deploy را انجام می‌دهد.

1. پروژه را در یک repository روی GitHub قرار بده.
2. در **Settings → Pages → Build and deployment → Source** گزینه **GitHub Actions** را انتخاب کن.
3. فایل‌های فاز ۴ را commit و به `main` push کن.
4. در تب **Actions** اجرای workflow را بررسی کن. پس از موفقیت، URL سایت در environment `github-pages` نمایش داده می‌شود.

Vite base به‌صورت خودکار تنظیم می‌شود:

- Repository معمولی: `/<repository>/`
- مخزن `username.github.io`: `/`
- اگر `CNAME` در ریشه یا `public/CNAME` وجود داشته باشد: `/`

برای دامنه سفارشی، فایل `public/CNAME` را اضافه و DNS/Custom domain را در Pages تنظیم کن. برنامه برای PWA به HTTPS نیاز دارد؛ GitHub Pages دامنه‌های `github.io` را با HTTPS ارائه می‌کند.

Node.js در `.nvmrc` روی 24 است. Workflow از `npm install` استفاده می‌کند چون بسته اولیه lockfile ندارد. پس از اولین نصب موفق و تثبیت وابستگی‌ها، بهتر است `package-lock.json` را commit و workflow را به `npm ci` تغییر دهی تا buildها reproducible شوند.

فایل `.nojekyll` در `public/` قرار دارد تا GitHub Pages خروجی استاتیک را بدون پردازش Jekyll منتشر کند.

## ۶) PWA، Service Worker و پاک‌کردن کش نسخه قبلی

`vite-plugin-pwa` در زمان Build فایل `manifest.webmanifest` و `sw.js` را تولید می‌کند؛ این فایل‌ها در سورس دستی نیستند. تنظیمات اصلی در `vite.config.ts` و ثبت lifecycle در `src/services/pwa.ts` است.

- فایل‌های JS/CSS/HTML، فونت‌ها، آیکون‌ها و manifest در precache قرار می‌گیرند.
- پاسخ API و داده همگام‌سازی وارد Cache Storage نمی‌شود؛ داده کاربر در IndexedDB می‌ماند.
- `cacheId: "vazhyar"` نام کش‌های جدید را مخصوص همین برنامه می‌کند؛ ابزار پاک‌سازی فقط Service Worker با scope همین PWA و کش‌های `vazhyar-*` را حذف می‌کند. در GitHub Pages زیرمسیر‌دار، کش عمومی Workbox قدیمی فقط وقتی پاک می‌شود که تمام URLهای داخل آن به همان زیرمسیر تعلق داشته باشند؛ روی دامنه ریشه، کش عمومی نامشخص دست‌نخورده می‌ماند تا PWA دیگری حذف نشود.
- `cleanupOutdatedCaches` کش precache قدیمی Workbox همین برنامه را پاک می‌کند.
- `registerType: prompt` باعث می‌شود نسخه جدید آماده شود و کاربر دکمه به‌روزرسانی را بزند؛ سپس waiting worker فعال و صفحه reload می‌شود.

### اگر نسخه قدیمی نمایش داده شد

**قبل از پاک‌سازی:** از صفحه «داده‌ها» یک بکاپ JSON بگیر یا مطمئن شو آخرین Full Sync موفق است. هرگز Clear site data را بدون بکاپ نزن؛ این کار ممکن است IndexedDB و localStorage را نیز پاک کند.

**Chrome / Edge دسکتاپ:**

1. سایت را باز کن و `F12` بزن.
2. تب **Application → Service Workers** را باز کن و Service Worker همین سایت را `Unregister` کن.
3. در **Application → Cache Storage** فقط cacheهای Workbox/واژه‌یار را حذف کن.
4. صفحه را با `Ctrl+Shift+R` (در macOS: `Cmd+Shift+R`) بارگذاری کن.
5. صفحه بعدی دوباره Service Worker جدید را ثبت می‌کند.

**از داخل خود برنامه:** صفحه «همگام‌سازی» → «پاک‌سازی کش فایل‌های برنامه و بارگذاری مجدد». این ابزار فقط Service Worker و Cache Storage مربوط به برنامه را پاک می‌کند؛ IndexedDB و localStorage را حذف نمی‌کند.

**Android Chrome:** ابتدا روی بنر «نسخه جدید آماده است» بزن. اگر گیر کرد، برنامه را ببند و دوباره از آیکون نصب‌شده اجرا کن. اگر همچنان نسخه قبلی بود، سایت را در Chrome باز کن و از Site settings فقط cache/storage مربوط به همان سایت را پاک کن؛ این کار ممکن است داده محلی را هم حذف کند، پس بکاپ/سینک قبلی الزامی است.

**iPhone/iPad:** نسخه نصب‌شده را کامل ببند و دوباره اجرا کن؛ اگر update banner نشان داده شد به‌روزرسانی را بزن. پاک‌کردن Website Data در تنظیمات Safari ممکن است IndexedDB را هم حذف کند، پس فقط پس از backup/sync انجام شود. نصب PWA روی iOS از Safari و گزینه Share → Add to Home Screen انجام می‌شود.

## ۷) چک‌لیست تست نهایی دسکتاپ و موبایل

### عملکرد اصلی

- [ ] یک آیتم جدید در لپ‌تاپ ثبت کن؛ مرور آفلاین را آزمایش کن.
- [ ] لپ‌تاپ را آفلاین کن، آیتم دوم و یک مرور FSRS ثبت کن.
- [ ] گوشی را آفلاین کن و یک آیتم مستقل بساز.
- [ ] هر دو را آنلاین کن؛ در هر دو دستگاه Sync بزن.
- [ ] بررسی کن هر دو یادداشت و هر دو Review Log در هر دو دستگاه وجود دارند.
- [ ] یک یادداشت را روی یک دستگاه ویرایش کن؛ پس از sync دستگاه دوم باید نسخه با `updatedAt` بزرگ‌تر را بگیرد.
- [ ] روی دو دستگاه همان فیلد را آفلاین ویرایش کن؛ نتیجه باید با LWW و tie rule توضیح‌داده‌شده همگرا شود.
- [ ] یک یادداشت را soft-delete کن؛ روی دستگاه دیگر نیز حذف‌شده بماند.
- [ ] هنگام Full Push، اینترنت را قطع کن؛ وضعیت باید پس از timeout به error برگردد، نه حالت syncing.
- [ ] پس از وصل اینترنت دوباره sync کن؛ درخواست‌های تکراری نباید رکورد تکراری بسازند.
- [ ] یک مرور هم‌زمان روی دو دستگاه را فقط برای آزمون انجام بده و بررسی کن هر دو log باقی بمانند و card state با LWW تعیین شود.

### Google Sheets / Supabase

- [ ] اتصال Ping Google Sheets موفق باشد.
- [ ] PIN اشتباه رد شود.
- [ ] `LockService` در اجرای هم‌زمان، درخواست دوم را صف/رد کند و برنامه timeout شفاف نشان دهد.
- [ ] دو دستگاه با PIN و URL یکسان داده‌ها را ردوبدل کنند.
- [ ] در Supabase، هر دو دستگاه با یک حساب وارد شوند.
- [ ] مطمئن شو حساب دوم به داده‌های کاربر اول دسترسی ندارد.
- [ ] هیچ `service_role` یا PIN داخل مخزن GitHub یا فایل Build قرار نگرفته باشد.

### PWA

- [ ] `manifest.webmanifest` در DevTools بارگذاری شود.
- [ ] آیکون‌های 192 و 512 و Apple Touch Icon باز شوند.
- [ ] برنامه از Chrome/Edge دسکتاپ نصب شود.
- [ ] برنامه از Android Chrome نصب شود.
- [ ] برنامه از Safari iOS به Home Screen اضافه شود.
- [ ] پس از اولین بارگذاری موفق، برنامه در حالت آفلاین launch شود.
- [ ] نسخه جدید منتشر شود و بنر update دیده شود.
- [ ] پس از update، نسخه جدید باز شود و یادداشت‌ها/Review Logs باقی بمانند.
- [ ] در حالت stale cache، ابزار پاک‌سازی کش اجرا و سپس PWA دوباره ثبت شود.

## ۸) محدودیت‌های شفاف

- همگام‌سازی خودکار فقط وقتی برنامه باز/فعال یا اینترنت دوباره وصل می‌شود اجرا می‌شود؛ به Background Sync سیستم‌عامل وابسته نیست.
- Google Apps Script و Supabase وابسته به دسترسی شبکه‌اند؛ Local-first کارکرد آفلاین را حفظ می‌کند، اما sync بدون دسترسی به endpoint ممکن نیست.
- PIN در برنامه مرورگر یک راز bearer است؛ در حالت «ذخیره ماندگار» در localStorage نگهداری می‌شود و در برابر XSS/دسترسی محلی رمزنگاری‌شده نیست.
- LWW نمی‌تواند ساعت اشتباه یا ویرایش‌های هم‌زمان روی یک کارت FSRS را به ادغام معنایی تبدیل کند.
- پاک‌کردن کامل Site Data ممکن است IndexedDB و Mirror localStorage را با هم حذف کند؛ خروجی JSON مستقل و نسخه سرور همچنان ضروری‌اند.
