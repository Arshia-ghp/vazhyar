# راه‌اندازی Supabase Sync

1. یک پروژه Supabase ایجاد کن.
2. Email Auth را فعال کن و یک حساب را در هر دو دستگاه استفاده کن.
3. `schema.sql` را در SQL Editor اجرا کن.
4. در واژه‌یار > همگام‌سازی، Project URL و کلید عمومی anon/publishable را وارد کن.
5. با ایمیل و گذرواژه Supabase Auth در هر دستگاه وارد شو.
6. Full Push/Pull را اجرا کن.

هرگز کلید `service_role` یا secret را داخل مرورگر نگذار. جدول RLS دارد و RPC نوشتن را به `auth.uid()` محدود می‌کند. تابع merge از advisory transaction lock مختص هر user استفاده می‌کند؛ watermark Full Pull نیز قفل shared می‌گیرد تا تخصیص sequence و ترتیب commit نویسنده‌های هم‌زمان باعث snapshot ناقص نشود.
