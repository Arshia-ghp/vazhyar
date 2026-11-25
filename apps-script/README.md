# راه‌اندازی Google Apps Script

راهنمای کامل در README ریشه، بخش «اتصال Google Sheets با Apps Script» آمده است.

خلاصه:
1. یک Google Spreadsheet بساز و از Extensions → Apps Script وارد ویرایشگر شو.
2. محتوای `Code.gs` را قرار بده.
3. در Project Settings → Script Properties دو مقدار تنظیم کن: `SPREADSHEET_ID` و `SYNC_PIN` (راز تصادفی ۳۲ نویسه یا بیشتر).
4. تابع `setupVazhyarSheets()` را یک بار به‌عنوان مالک اجرا و مجوزها را تأیید کن.
5. Deploy → New deployment → Web app؛ گزینه Execute as: Me و دسترسی Anyone، در صورت مجازبودن توسط سیاست حساب.
6. URL پایان‌یافته به `/exec` را همراه همان PIN در هر دو دستگاه وارد کن.

هر سه تب داخلی را اسکریپت می‌سازد و مخفی می‌کند. آن‌ها را دستی ویرایش، مرتب یا حذف نکن. دسترسی بدون VPN به دامنه‌های Google قابل تضمین نیست.
