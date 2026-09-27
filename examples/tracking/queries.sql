-- Перенос существующих пользователей (2.1). created_at может быть ISO, unix-секундами или NULL.
INSERT OR IGNORE INTO user_acquisition (telegram_id, first_source, first_seen_at)
SELECT telegram_id, 'legacy',
       COALESCE(
         CASE WHEN typeof(created_at) IN ('integer', 'real')
              THEN datetime(CASE WHEN created_at > 100000000000 THEN created_at / 1000 ELSE created_at END, 'unixepoch')
              ELSE datetime(created_at) END,
         '2000-01-01 00:00:00')  -- даты нет: заглушка, legacy исключены из отчётов
FROM users;
-- Проверка: должно быть 0.
SELECT COUNT(*) AS missing FROM users
WHERE telegram_id NOT IN (SELECT telegram_id FROM user_acquisition);

-- Отчёт по каналам (2.1): пришедшие 21–7 дней назад, событие — в первые 7 дней.
SELECT a.first_source,
       COUNT(*) AS starts,
       SUM(EXISTS (SELECT 1 FROM events e
                   WHERE e.user_id = a.telegram_id
                     AND datetime(e.created_at) <= datetime(a.first_seen_at, '+7 days'))) AS created_event
FROM user_acquisition a
WHERE a.first_source <> 'legacy'
  AND a.first_seen_at >= datetime('now', '-21 days')
  AND a.first_seen_at <  datetime('now', '-7 days')
GROUP BY a.first_source
ORDER BY created_event DESC;

-- Воронка (2.2): та же когорта, шаг засчитан, если пройден в первые 7 дней.
WITH cohort AS (
  SELECT telegram_id, first_seen_at AS started_at FROM user_acquisition
  WHERE first_source <> 'legacy'
    AND first_seen_at >= datetime('now', '-21 days')
    AND first_seen_at <  datetime('now', '-7 days')
),
steps(ord, step) AS (VALUES
  (1, 'start'), (2, 'language_chosen'), (3, 'timezone_set'),
  (4, 'first_message_sent'), (5, 'first_event_created'),
  (6, 'first_reminder_delivered')
),
counts AS (
  SELECT s.ord, s.step,
         CASE WHEN s.step = 'start' THEN (SELECT COUNT(*) FROM cohort)
         ELSE (SELECT COUNT(*) FROM funnel_events f JOIN cohort c USING (telegram_id)
               WHERE f.step = s.step
                 AND f.at <= datetime(c.started_at, '+7 days')) END AS users
  FROM steps s
)
SELECT step, users,
       ROUND(100.0 * users / LAG(users) OVER (ORDER BY ord))         AS from_prev,
       ROUND(100.0 * users / FIRST_VALUE(users) OVER (ORDER BY ord)) AS from_start
FROM counts ORDER BY ord;

-- Доля понятых первых сообщений (2.2).
SELECT ROUND(100.0 * SUM(step = 'first_message_understood') / NULLIF(SUM(step = 'first_message_sent'), 0)) AS understood_pct
FROM funnel_events;

-- Кто сейчас заблокировал бота (2.2): последний статус по каждому.
SELECT telegram_id FROM bot_status b
WHERE status = 'kicked'
  AND at = (SELECT MAX(at) FROM bot_status WHERE telegram_id = b.telegram_id);

-- Воронка по источникам (2.2).
WITH cohort AS (
  SELECT telegram_id, first_source, first_seen_at AS started_at FROM user_acquisition
  WHERE first_source <> 'legacy'
    AND first_seen_at >= datetime('now', '-21 days')
    AND first_seen_at <  datetime('now', '-7 days')
)
SELECT c.first_source,
       SUM(f.step = 'start')                    AS starts,
       SUM(f.step = 'first_event_created')      AS created_event,
       SUM(f.step = 'first_reminder_delivered') AS activated
FROM funnel_events f
JOIN cohort c USING (telegram_id)
WHERE f.at <= datetime(c.started_at, '+7 days')
GROUP BY c.first_source
ORDER BY activated DESC;
