-- Схема для главы 2.5. SQLite (bun:sqlite). Все даты — datetime('now'), формат 'YYYY-MM-DD HH:MM:SS' UTC.
-- В Postgres: идентификаторы Telegram — BIGINT, даты — timestamptz.

-- Из глав 2.1–2.2 (копия из examples/tracking/schema.sql): когорты, шаги воронки, журнал блокировок.
CREATE TABLE IF NOT EXISTS user_acquisition (
  telegram_id     INTEGER PRIMARY KEY,     -- в Postgres: BIGINT
  first_source    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_source     TEXT,
  last_seen_at    TEXT,
  invited_by      INTEGER,
  self_reported   TEXT
);

CREATE TABLE IF NOT EXISTS funnel_events (
  telegram_id INTEGER NOT NULL,
  step        TEXT    NOT NULL,
  at          TEXT    NOT NULL,
  PRIMARY KEY (telegram_id, step)
);

CREATE TABLE IF NOT EXISTS bot_status (
  telegram_id INTEGER NOT NULL,
  status      TEXT    NOT NULL,            -- 'kicked' | 'member'
  at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_status_user ON bot_status (telegram_id, at);

-- 2.5. Карточка эксперимента: гипотеза и правило решения записаны ДО старта.
-- Полный журнал экспериментов — в главе 6.2.
CREATE TABLE IF NOT EXISTS experiments (
  name          TEXT PRIMARY KEY,          -- 'tz_buttons_2610'
  hypothesis    TEXT NOT NULL,             -- «если …, то …, потому что …»
  metric_step   TEXT NOT NULL,             -- главная метрика: шаг воронки за 7 дней
  decision_rule TEXT NOT NULL,             -- что делаем при каждом исходе
  min_per_arm   INTEGER NOT NULL,          -- сколько людей ждём в каждой группе
  started_at    TEXT NOT NULL,
  ended_at      TEXT,                      -- после этой даты новых людей в эксперимент не берём
  decision      TEXT                       -- что решили и почему
);

-- 2.5. Кто в какой группе. Одна строка на человека в эксперименте, группа не меняется.
CREATE TABLE IF NOT EXISTS experiment_assignments (
  experiment  TEXT    NOT NULL,
  telegram_id INTEGER NOT NULL,
  variant     TEXT    NOT NULL,            -- 'A' — как было, 'B' — изменение
  assigned_at TEXT    NOT NULL,
  PRIMARY KEY (experiment, telegram_id)
);
