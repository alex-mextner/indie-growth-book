-- Схема и запросы к главе 5.3. SQLite (bun:sqlite). Даты — datetime('now'), 'YYYY-MM-DD HH:MM:SS' UTC.
-- Нужны таблицы глав 2.1–2.2 и 5.2: user_acquisition (с first_content), funnel_events.
-- Сначала deeplinks.initSchema(db), потом initSchema(db) из redirect.ts.
-- Всё до первой строки «-- name:» — схема; её выполняет initSchema.

-- 5.3. Одно размещение — одна строка. Метка в payload уникальна для размещения (глава 2.1).
CREATE TABLE IF NOT EXISTS placements (
  slug      TEXT PRIMARY KEY,           -- адрес /r/<slug>; короткий и ничего не говорящий постороннему
  channel   TEXT NOT NULL,              -- «канал A»: без имён и контактов администраторов
  price     REAL NOT NULL,              -- в валюте оплаты
  currency  TEXT NOT NULL,              -- 'RUB', 'USD', 'USDT', ...
  price_usd REAL,                       -- по курсу на дату оплаты; то же число — в marketing_spend (глава 2.4)
  posted_at TEXT,                       -- когда пост вышел; NULL — ещё не вышел
  format    TEXT,                       -- '1/24', '2/48', 'native', '1/24+pin' — как договорились
  payload   TEXT NOT NULL UNIQUE        -- параметр ?start=, например src_tg_chanA_0927 или src_tg_chanA_0927-c2
);

-- 5.3. Переходы по известным адресам. Без IP и без полного User-Agent; неизвестные адреса — только счётчик в памяти.
CREATE TABLE IF NOT EXISTS clicks (
  id       INTEGER PRIMARY KEY,
  slug     TEXT NOT NULL,
  at       TEXT NOT NULL,
  ua_class TEXT NOT NULL,               -- 'mobile' | 'desktop' | 'preview' | 'bot' | 'unknown'
  visitor  TEXT                         -- хеш с солью, которая живёт одни сутки (см. redirect.ts); NULL — без склейки
);
CREATE INDEX IF NOT EXISTS clicks_slug_at ON clicks (slug, at);

-- name: placement_funnel
-- Воронка по размещениям: переходы → новые старты → первая польза → активация, и цена каждого шага.
-- Переходы — только люди (mobile, desktop). unique_clicks — уникальные за сутки, это нижняя оценка:
-- люди за одним адресом (мобильный оператор, CGNAT) с одинаковым телефоном склеиваются. Рядом — human_clicks.
-- Роботы превью и прочие боты не считаются.
-- Старты — новые люди, у которых первое касание — метка размещения (и вариант -c, если он есть в метке).
-- Польза и активация — в первые 7 дней после старта, как в главах 2.2 и 5.2.
-- Пока у кого-то не прошло 7 дней (maturing > 0), цена активированного не считается.
-- Доля стартов от переходов — только от 30 уникальных переходов (ориентир): на меньших числах смотрите штуки.
WITH p AS (
  SELECT slug, channel, price, currency, price_usd, posted_at, format, payload,
         CASE WHEN instr(payload, '-') > 0 THEN substr(payload, 1, instr(payload, '-') - 1)
              ELSE payload END AS campaign
  FROM placements
),
pc AS (
  SELECT p.*,
         CASE WHEN substr(payload, length(campaign) + 2, 1) = 'c' THEN
           CASE WHEN instr(substr(payload, length(campaign) + 3), '-') > 0
                THEN substr(substr(payload, length(campaign) + 3), 1,
                            instr(substr(payload, length(campaign) + 3), '-') - 1)
                ELSE substr(payload, length(campaign) + 3) END
         END AS content
  FROM p
),
clk AS (
  SELECT slug,
         COUNT(*) AS human_clicks,
         COUNT(DISTINCT CASE WHEN visitor IS NULL THEN 'id' || id
                             ELSE date(at) || ':' || visitor END) AS unique_clicks
  FROM clicks
  WHERE ua_class IN ('mobile', 'desktop')
  GROUP BY slug
),
bots AS (
  SELECT slug, COUNT(*) AS bot_clicks FROM clicks
  WHERE ua_class IN ('preview', 'bot', 'unknown') GROUP BY slug
),
people AS (
  SELECT pc.slug, a.telegram_id,
         a.first_seen_at > datetime('now', '-7 days') AS maturing,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = a.telegram_id AND f.step = 'first_value'
                   AND f.at <= datetime(a.first_seen_at, '+7 days')) AS got_value,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = a.telegram_id AND f.step = 'first_reminder_delivered'
                   AND f.at <= datetime(a.first_seen_at, '+7 days')) AS activated
  FROM pc
  JOIN user_acquisition a
    ON a.first_source = pc.campaign
   AND (pc.content IS NULL OR a.first_content = pc.content)
),
agg AS (
  SELECT slug, COUNT(*) AS new_starts, SUM(maturing) AS maturing,
         SUM(got_value) AS first_value, SUM(activated) AS activated
  FROM people GROUP BY slug
)
SELECT pc.slug, pc.channel, pc.format, pc.posted_at, pc.price, pc.currency, pc.price_usd,
       COALESCE(b.bot_clicks, 0)                          AS bot_clicks,
       COALESCE(c.human_clicks, 0)                        AS human_clicks,
       COALESCE(c.unique_clicks, 0)                       AS unique_clicks,
       COALESCE(g.new_starts, 0)                          AS new_starts,
       COALESCE(g.first_value, 0)                         AS first_value,
       COALESCE(g.activated, 0)                           AS activated,
       COALESCE(g.maturing, 0)                            AS maturing,
       CASE WHEN c.unique_clicks >= 30
            THEN ROUND(100.0 * COALESCE(g.new_starts, 0) / c.unique_clicks) END AS start_pct,
       ROUND(pc.price_usd / NULLIF(c.unique_clicks, 0), 2) AS usd_per_click,
       ROUND(pc.price_usd / NULLIF(g.new_starts, 0), 2)    AS usd_per_start,
       ROUND(pc.price_usd / NULLIF(g.first_value, 0), 2)   AS usd_per_first_value,
       CASE WHEN COALESCE(g.maturing, 0) = 0
            THEN ROUND(pc.price_usd / NULLIF(g.activated, 0), 2) END AS usd_per_activated
FROM pc
LEFT JOIN clk  c USING (slug)
LEFT JOIN bots b USING (slug)
LEFT JOIN agg  g USING (slug)
ORDER BY pc.posted_at IS NULL, pc.posted_at;

-- name: returning_via_placement
-- Старые пользователи, открывшие ссылку размещения: первое касание другое, последнее — метка размещения.
-- Оценка снизу: last_source перезаписывается следующей меткой. Они есть в переходах, но не в новых стартах.
WITH p AS (
  SELECT slug, posted_at,
         CASE WHEN instr(payload, '-') > 0 THEN substr(payload, 1, instr(payload, '-') - 1)
              ELSE payload END AS campaign
  FROM placements
)
SELECT p.slug, COUNT(a.telegram_id) AS returning_users
FROM p
LEFT JOIN user_acquisition a
  ON a.last_source = p.campaign AND a.first_source <> p.campaign
 AND (p.posted_at IS NULL OR a.last_seen_at >= p.posted_at)
GROUP BY p.slug;

-- name: untagged_uplift
-- Обещание главы 2.4: после посева часть людей приходит без метки — поиском (none) или пересылкой (src_share).
-- Сравниваем новых людей без метки за 48 часов после выхода поста с обычными 48 часами:
-- средним за 14 дней до поста. Прибавка — оценка тех, кого посев привёл без метки.
-- Цена активированного — диапазон: от «только помеченные» до «помеченные + прибавка».
-- Если два поста вышли с разницей меньше 48 часов, прибавка у них общая: разносите посевы.
WITH p AS (
  SELECT slug, price_usd, posted_at,
         CASE WHEN instr(payload, '-') > 0 THEN substr(payload, 1, instr(payload, '-') - 1)
              ELSE payload END AS campaign
  FROM placements WHERE posted_at IS NOT NULL
),
u AS (
  SELECT a.telegram_id, a.first_seen_at,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = a.telegram_id AND f.step = 'first_reminder_delivered'
                   AND f.at <= datetime(a.first_seen_at, '+7 days')) AS activated
  FROM user_acquisition a WHERE a.first_source IN ('none', 'src_share')
),
w AS (
  SELECT p.slug, p.price_usd, p.campaign,
         SUM(u.first_seen_at >= p.posted_at AND u.first_seen_at < datetime(p.posted_at, '+48 hours')) AS after_starts,
         SUM(CASE WHEN u.first_seen_at >= p.posted_at AND u.first_seen_at < datetime(p.posted_at, '+48 hours')
                  THEN u.activated ELSE 0 END) AS after_activated,
         SUM(u.first_seen_at >= datetime(p.posted_at, '-14 days') AND u.first_seen_at < p.posted_at) / 7.0 AS base_starts,
         SUM(CASE WHEN u.first_seen_at >= datetime(p.posted_at, '-14 days') AND u.first_seen_at < p.posted_at
                  THEN u.activated ELSE 0 END) / 7.0 AS base_activated
  FROM p LEFT JOIN u ON 1 = 1
  GROUP BY p.slug
),
tagged AS (
  SELECT p.slug, COUNT(a.telegram_id) AS activated
  FROM p
  LEFT JOIN user_acquisition a ON a.first_source = p.campaign
   AND EXISTS (SELECT 1 FROM funnel_events f
               WHERE f.telegram_id = a.telegram_id AND f.step = 'first_reminder_delivered'
                 AND f.at <= datetime(a.first_seen_at, '+7 days'))
  GROUP BY p.slug
)
SELECT w.slug,
       COALESCE(w.after_starts, 0)                                        AS untagged_after,
       ROUND(COALESCE(w.base_starts, 0), 1)                               AS untagged_baseline,
       MAX(0, ROUND(COALESCE(w.after_starts, 0) - COALESCE(w.base_starts, 0))) AS extra_starts,
       MAX(0, ROUND(COALESCE(w.after_activated, 0) - COALESCE(w.base_activated, 0))) AS extra_activated,
       t.activated                                                        AS tagged_activated,
       ROUND(w.price_usd / NULLIF(t.activated
             + MAX(0, ROUND(COALESCE(w.after_activated, 0) - COALESCE(w.base_activated, 0))), 0), 2) AS usd_per_activated_low,
       ROUND(w.price_usd / NULLIF(t.activated, 0), 2)                     AS usd_per_activated_high
FROM w JOIN tagged t USING (slug);

-- name: clicks_by_hour
-- Переходы людей по часам после выхода поста: живой пост собирает их в первые часы, потом затухает.
-- Ровная полка или всплеск через сутки — повод спросить администратора, что происходило.
SELECT c.slug,
       CAST((julianday(c.at) - julianday(p.posted_at)) * 24 AS INTEGER) AS hour_after_post,
       COUNT(*) AS clicks
FROM clicks c
JOIN placements p USING (slug)
WHERE p.posted_at IS NOT NULL AND c.at >= p.posted_at
  AND c.ua_class IN ('mobile', 'desktop')
GROUP BY c.slug, hour_after_post
ORDER BY c.slug, hour_after_post;
