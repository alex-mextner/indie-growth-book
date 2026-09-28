-- Запросы к главе 5.2. SQLite (bun:sqlite). Таблицы — из deeplinks.ts (SCHEMA) и examples/tracking.
-- Каждый запрос начинается строкой «-- name: <имя>»: по ней его находит loadQueries().

-- name: ttfv_by_source
-- Время до первой пользы (шаг first_value) по источникам, от first_seen_at. Когорта — как в главе 2.2:
-- пришедшие 21–7 дней назад, польза засчитана, если получена в первые 7 дней.
-- Медиана — по дошедшим и только если их не меньше 30 (ориентир): на меньших числах она шумит.
-- При чётном числе дошедших — среднее двух средних значений.
WITH cohort AS (
  SELECT telegram_id, first_source, first_seen_at FROM user_acquisition
  WHERE first_source <> 'legacy'
    AND first_seen_at >= datetime('now', '-21 days')
    AND first_seen_at <  datetime('now', '-7 days')
),
ttfv AS (
  SELECT c.first_source,
         (julianday(v.at) - julianday(c.first_seen_at)) * 86400.0 AS secs
  FROM cohort c
  LEFT JOIN funnel_events v
         ON v.telegram_id = c.telegram_id AND v.step = 'first_value'
        AND v.at <= datetime(c.first_seen_at, '+7 days')
),
ranked AS (
  SELECT first_source, secs,
         ROW_NUMBER() OVER (PARTITION BY first_source ORDER BY secs) AS rn,
         COUNT(*)     OVER (PARTITION BY first_source)               AS n
  FROM ttfv WHERE secs IS NOT NULL
),
medians AS (
  SELECT first_source, CAST(ROUND(AVG(secs)) AS INTEGER) AS median_secs
  FROM ranked
  WHERE n >= 30 AND rn IN ((n + 1) / 2, (n + 2) / 2)
  GROUP BY first_source
)
SELECT t.first_source,
       COUNT(*)                                                 AS starts,
       COUNT(t.secs)                                            AS reached_value,
       ROUND(100.0 * COUNT(t.secs) / COUNT(*))                  AS reached_pct,
       ROUND(100.0 * COALESCE(SUM(t.secs <= 60), 0) / COUNT(*)) AS within_60s_pct,
       m.median_secs
FROM ttfv t
LEFT JOIN medians m USING (first_source)
GROUP BY t.first_source
ORDER BY starts DESC;

-- name: stalled_last_step
-- Где застряли: для тех, кто за 7 дней не дошёл до пользы, — последний пройденный шаг.
-- Служебные шаги (напоминание от бота, блокировка) не считаются шагами онбординга.
WITH cohort AS (
  SELECT telegram_id, first_source, first_seen_at FROM user_acquisition
  WHERE first_source <> 'legacy'
    AND first_seen_at >= datetime('now', '-21 days')
    AND first_seen_at <  datetime('now', '-7 days')
),
stuck AS (
  SELECT c.* FROM cohort c
  WHERE NOT EXISTS (SELECT 1 FROM funnel_events v
                    WHERE v.telegram_id = c.telegram_id AND v.step = 'first_value'
                      AND v.at <= datetime(c.first_seen_at, '+7 days'))
)
SELECT s.first_source,
       (SELECT f.step FROM funnel_events f
        WHERE f.telegram_id = s.telegram_id
          AND f.step NOT IN ('nudge_sent', 'bot_blocked')
          AND f.at <= datetime(s.first_seen_at, '+7 days')
        ORDER BY f.at DESC, f.rowid DESC LIMIT 1) AS last_step,
       COUNT(*) AS users
FROM stuck s
GROUP BY 1, 2
ORDER BY 1, users DESC;

-- name: nudge_candidates
-- Одно мягкое напоминание: пришли 20–48 часов назад, пользы нет, напоминания ещё не было,
-- не нажимали «Больше не писать», бота не заблокировали (последний статус не kicked).
-- Время суток проверяет код (isDaytime) перед отправкой.
SELECT a.telegram_id FROM user_acquisition a
WHERE a.first_source <> 'legacy'
  AND a.first_seen_at >= datetime('now', '-48 hours')
  AND a.first_seen_at <  datetime('now', '-20 hours')
  AND NOT EXISTS (SELECT 1 FROM funnel_events f
                  WHERE f.telegram_id = a.telegram_id AND f.step IN ('first_value', 'nudge_sent'))
  AND NOT EXISTS (SELECT 1 FROM messaging_optout o WHERE o.telegram_id = a.telegram_id)
  AND COALESCE((SELECT b.status FROM bot_status b WHERE b.telegram_id = a.telegram_id
                ORDER BY b.at DESC, b.rowid DESC LIMIT 1), 'member') <> 'kicked';

-- name: nudge_outcome
-- Что дало напоминание: сколько после него дошли до пользы за 7 дней и сколько заблокировали бота за 48 часов.
-- Берём напоминания старше 7 дней, чтобы у всех было одинаковое время.
SELECT COUNT(*) AS nudged,
       SUM(EXISTS (SELECT 1 FROM funnel_events v
                   WHERE v.telegram_id = n.telegram_id AND v.step = 'first_value'
                     AND v.at > n.at AND v.at <= datetime(n.at, '+7 days'))) AS value_after,
       SUM(EXISTS (SELECT 1 FROM bot_status b
                   WHERE b.telegram_id = n.telegram_id AND b.status = 'kicked'
                     AND b.at > n.at AND b.at <= datetime(n.at, '+48 hours'))) AS blocked_48h
FROM funnel_events n
WHERE n.step = 'nudge_sent'
  AND n.at <  datetime('now', '-7 days')
  AND n.at >= datetime('now', '-60 days');

-- name: partner_payouts
-- Партнёры (метка -p<код>): платим за активацию (глава 2.2) в первые 7 дней, а не за /start,
-- и не больше max_payouts по коду. Самоприглашение по коду партнёра не засчитывается.
-- max_day_starts — больше всего стартов по коду за один день: всплеск — повод проверить вторые аккаунты.
WITH attributed AS (
  SELECT a.telegram_id, a.first_partner AS code, a.first_seen_at
  FROM user_acquisition a JOIN partner_codes pc ON pc.code = a.first_partner
  WHERE pc.telegram_id IS NULL OR pc.telegram_id <> a.telegram_id
),
per_code AS (
  SELECT code,
         COUNT(*) AS starts,
         SUM(EXISTS (SELECT 1 FROM funnel_events f
                     WHERE f.telegram_id = t.telegram_id AND f.step = 'first_reminder_delivered'
                       AND f.at <= datetime(t.first_seen_at, '+7 days'))) AS activated
  FROM attributed t GROUP BY code
),
per_day AS (
  SELECT code, MAX(n) AS max_day_starts
  FROM (SELECT code, date(first_seen_at) AS d, COUNT(*) AS n FROM attributed GROUP BY code, d)
  GROUP BY code
)
SELECT pc.code, pc.label, c.starts, c.activated,
       MIN(c.activated, COALESCE(pc.max_payouts, c.activated)) AS payable,
       d.max_day_starts
FROM per_code c
JOIN partner_codes pc USING (code)
JOIN per_day d USING (code)
ORDER BY payable DESC;
