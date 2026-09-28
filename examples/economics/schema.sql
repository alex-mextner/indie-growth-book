-- Схема для главы 2.4. SQLite (bun:sqlite). Все даты — datetime('now'), формат 'YYYY-MM-DD HH:MM:SS' UTC.
-- В Postgres: идентификаторы Telegram — BIGINT, даты — timestamptz.

-- Из глав 2.1–2.3 (копия из examples/tracking/schema.sql): когорты, шаги воронки, дни активности.
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

CREATE TABLE IF NOT EXISTS user_activity (
  telegram_id INTEGER NOT NULL,
  day         TEXT    NOT NULL,            -- date('now'), 'YYYY-MM-DD' UTC
  PRIMARY KEY (telegram_id, day)
);

-- 2.4. Журнал обращений к платным моделям: одна строка на один вызов API.
-- Это персональные данные: по запросу пользователя — deleteUserEconomics в economics.ts.
CREATE TABLE IF NOT EXISTS ai_usage (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL,           -- telegram_id; 0 — псевдонимизировано. В Postgres: BIGINT
  request_id         TEXT    NOT NULL,           -- одно сообщение человека = один request_id, даже если вызовов несколько
  trigger            TEXT    NOT NULL,           -- 'user' — ответ на сообщение; 'system' — сводки, расписание
  at                 TEXT    NOT NULL,
  feature            TEXT    NOT NULL,           -- 'parse' | 'voice' | 'digest' | ...
  model              TEXT    NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'ok', -- 'ok' | 'error': неудачные вызовы не идут в лимит, но их стоимость — в сверке со счётом
  input_tokens       INTEGER NOT NULL DEFAULT 0, -- вход по полной цене, БЕЗ кэша (см. toUsage)
  cache_write_tokens INTEGER NOT NULL DEFAULT 0, -- вход, записанный в кэш
  cached_tokens      INTEGER NOT NULL DEFAULT 0, -- вход, прочитанный из кэша
  output_tokens      INTEGER NOT NULL DEFAULT 0, -- включая токены рассуждений
  audio_seconds      REAL    NOT NULL DEFAULT 0, -- распознавание или синтез речи
  cost_usd           REAL    NOT NULL,           -- если модели нет в таблице цен — по самой дорогой цене из таблицы
  priced             INTEGER NOT NULL DEFAULT 1, -- 0: цены модели нет, стоимость — оценка сверху (запрос missing_prices)
  price_version      TEXT    NOT NULL            -- дата таблицы цен, по которой посчитано
);
CREATE INDEX IF NOT EXISTS ai_usage_user_at ON ai_usage (user_id, at);
CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage (at);

-- 2.4. Расходы на привлечение: одна строка на платёж за канал (посев, реклама).
-- source совпадает с меткой из главы 2.1, например 'src_tg_chanA_0927'.
CREATE TABLE IF NOT EXISTS marketing_spend (
  source      TEXT NOT NULL,
  spent_at    TEXT NOT NULL,
  amount_usd  REAL NOT NULL,
  note        TEXT
);

-- 2.4. Платежи: одна строка на списание (первое или продление подписки, разовая покупка, счёт организатору).
CREATE TABLE IF NOT EXISTS payments (
  telegram_id  INTEGER NOT NULL,           -- 0 — псевдонимизировано. В Postgres: BIGINT
  kind         TEXT    NOT NULL DEFAULT 'subscription', -- 'subscription' | 'one_off' | 'invoice'
  paid_at      TEXT    NOT NULL,
  amount       REAL    NOT NULL,           -- в валюте платежа: для Stars — число звёзд
  currency     TEXT    NOT NULL,           -- 'XTR' (Telegram Stars), 'RUB', 'USD', ...
  provider     TEXT    NOT NULL,           -- 'stars' | название эквайринга
  charge_id    TEXT    NOT NULL UNIQUE,    -- telegram_payment_charge_id или id провайдера: нужен для возврата
  net_usd      REAL    NOT NULL,           -- что дойдёт до вас после комиссии, в $ по курсу на дату платежа
  refunded_at  TEXT,                       -- NULL, если возврата не было
  expires_at   TEXT                        -- глава 5.5: до какого момента оплачена подписка; NULL — не подписка
);
CREATE INDEX IF NOT EXISTS payments_user_at ON payments (telegram_id, paid_at);

-- 5.5. Каждый показ кнопки подписки и нажатие на неё — с ценой (для теста цены по неделям).
-- На старой базе из главы 2.4 вызовите initPaymentsSchema из economics.ts: он добавит expires_at и эту таблицу.
CREATE TABLE IF NOT EXISTS paywall_views (
  telegram_id INTEGER NOT NULL,
  at          TEXT    NOT NULL,
  stars       INTEGER NOT NULL,
  action      TEXT    NOT NULL  -- 'seen' | 'clicked'
);
CREATE INDEX IF NOT EXISTS paywall_views_at ON paywall_views (at);
