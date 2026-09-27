-- Схема для глав 2.1–2.3. SQLite (bun:sqlite). Все даты — datetime('now'), формат 'YYYY-MM-DD HH:MM:SS' UTC.

-- 2.1. Откуда пришёл человек. Одна строка на пользователя, первое касание не меняется.
CREATE TABLE IF NOT EXISTS user_acquisition (
  telegram_id     INTEGER PRIMARY KEY,   -- в Postgres: BIGINT
  first_source    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_source     TEXT,
  last_seen_at    TEXT,
  invited_by      INTEGER,               -- telegram_id пригласившего (после проверки кода)
  self_reported   TEXT
);

-- 2.1. Коды приглашений: случайные, не идентификатор Telegram.
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL UNIQUE
);

-- 2.2. Шаги воронки: каждый шаг один раз, в момент первого прохождения.
CREATE TABLE IF NOT EXISTS funnel_events (
  telegram_id INTEGER NOT NULL,
  step        TEXT    NOT NULL,
  at          TEXT    NOT NULL,
  PRIMARY KEY (telegram_id, step)
);

-- 2.2. Блокировки и разблокировки: журнал, а не шаг воронки.
CREATE TABLE IF NOT EXISTS bot_status (
  telegram_id INTEGER NOT NULL,
  status      TEXT    NOT NULL,            -- 'kicked' | 'member'
  at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_status_user ON bot_status (telegram_id, at);

-- 2.3. Дни активности: человек сам что-то сделал в личном чате с ботом (сообщение, кнопка).
-- Одна строка на пользователя в день. Это персональные данные: храните не дольше 12 месяцев (queries.sql).
CREATE TABLE IF NOT EXISTS user_activity (
  telegram_id INTEGER NOT NULL,
  day         TEXT    NOT NULL,            -- date('now'), 'YYYY-MM-DD' UTC
  PRIMARY KEY (telegram_id, day)
);

-- 2.3. Журнал доставленных напоминаний: источник пассивного удержания.
-- Без текста напоминания и без точного времени — только дата.
CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id           INTEGER PRIMARY KEY,
  telegram_id  INTEGER NOT NULL,                     -- получатель
  kind         TEXT    NOT NULL DEFAULT 'reminder',  -- 'reminder' | 'weekly_summary' | ...
  message_id   INTEGER,                              -- id сообщения в чате: по нему находим нажатую кнопку
  delivered_on TEXT    NOT NULL,                     -- date('now')
  acked_on     TEXT                                  -- дата нажатия «знака жизни»
);
CREATE INDEX IF NOT EXISTS reminder_deliveries_user ON reminder_deliveries (telegram_id, delivered_on);
