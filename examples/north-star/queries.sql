-- Запросы к главе 2.6. Каждый начинается строкой «-- name: …» — по ней их находит тест.
-- Таблицы — из examples/tracking/schema.sql: user_acquisition (2.1), funnel_events и bot_status (2.2),
-- user_activity и reminder_deliveries (2.3). Все даты — UTC.
-- Свои аккаунты и аккаунты близких перечислите в me(...) — как в главе 2.3.
-- Неделя — прошлая календарная, понедельник–воскресенье: [d1, d2).
-- Пассивные, блокировки и зомби окончательны через неделю: блокировка в течение 7 дней после
-- напоминания снимает его задним числом (как в 2.3). Пороги — ориентир, проверяйте на своих данных.

-- name: quarter_card_weekly
-- in_touch      — метрика квартала: люди на связи, кроме вас, у которых прошлая неделя — неделя 1 или позже
--                 (пришли раньше d1 − 7 дней), и при этом живые: за 28 дней было действие или нажатие «Помню».
--                 «На связи» — как в 2.3: сами что-то сделали или получили напоминание и не заблокировали бота
--                 в течение 7 дней после него.
-- new_in_touch  — отдельная строка: на связи, но пришли за последние 14 дней (их неделя 0 — /start и онбординг).
-- activated     — входная метрика: сколько человек из когорты позапрошлой календарной недели получили первое
--                 напоминание в первые 7 дней (2.2). К d2 у всех семь дней истекли, число окончательно.
-- activated_pct — диагностика: доля активированных в той же когорте.
-- blocked_pct   — ограничитель: доля получивших напоминание на прошлой неделе, которые заблокировали бота
--                 в течение 7 дней после напоминания.
-- zombie_pct    — ограничитель: доля остальных получивших, у которых 28 дней нет знака жизни.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),  -- ваши аккаунты и аккаунты близких
week AS (SELECT date('now', 'weekday 0', '-13 days') AS d1,
                date('now', 'weekday 0', '-6 days')  AS d2),
fresh AS (
  SELECT telegram_id FROM user_acquisition, week WHERE first_seen_at >= date(d1, '-7 days')
),
active AS (
  SELECT DISTINCT telegram_id FROM user_activity, week
  WHERE day >= d1 AND day < d2 AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
dlv AS (                                   -- напоминания прошлой недели и блокировка после каждого
  SELECT r.telegram_id,
         EXISTS (SELECT 1 FROM bot_status b
                 WHERE b.telegram_id = r.telegram_id AND b.status = 'kicked'
                   AND b.at >= r.delivered_on AND b.at < date(r.delivered_on, '+7 days')) AS k
  FROM reminder_deliveries r, week
  WHERE r.kind = 'reminder' AND r.delivered_on >= d1 AND r.delivered_on < d2
    AND r.telegram_id NOT IN (SELECT telegram_id FROM me)
),
got AS (SELECT telegram_id, MIN(k) AS lost, MAX(k) AS blocked FROM dlv GROUP BY telegram_id),
alive AS (                                 -- знак жизни за 28 дней: действие или «Помню»
  SELECT telegram_id FROM user_activity, week
  WHERE day >= date(d2, '-28 days') AND day < d2
  UNION
  SELECT telegram_id FROM reminder_deliveries, week
  WHERE acked_on >= date(d2, '-28 days') AND acked_on < d2
),
touch AS (
  SELECT telegram_id FROM active
  UNION
  SELECT telegram_id FROM got WHERE lost = 0
),
cohort AS (                                -- пришли в позапрошлую календарную неделю
  SELECT u.telegram_id, u.first_seen_at FROM user_acquisition u, week
  WHERE u.first_source <> 'legacy' AND u.telegram_id NOT IN (SELECT telegram_id FROM me)
    AND u.first_seen_at >= date(d1, '-7 days') AND u.first_seen_at < d1
),
activated AS (
  SELECT c.telegram_id FROM cohort c JOIN funnel_events f USING (telegram_id)
  WHERE f.step = 'first_reminder_delivered' AND f.at <= datetime(c.first_seen_at, '+7 days')
)
SELECT
  (SELECT COUNT(*) FROM touch
   WHERE telegram_id IN (SELECT telegram_id FROM alive)
     AND telegram_id NOT IN (SELECT telegram_id FROM fresh))              AS in_touch,
  (SELECT COUNT(*) FROM touch
   WHERE telegram_id IN (SELECT telegram_id FROM fresh))                  AS new_in_touch,
  (SELECT COUNT(*) FROM activated)                                        AS activated,
  ROUND(100.0 * (SELECT COUNT(*) FROM activated)
        / NULLIF((SELECT COUNT(*) FROM cohort), 0))                       AS activated_pct,
  ROUND(100.0 * (SELECT COUNT(*) FROM got WHERE blocked = 1)
        / NULLIF((SELECT COUNT(*) FROM got), 0))                          AS blocked_pct,
  ROUND(100.0 * (SELECT COUNT(*) FROM got WHERE blocked = 0
                   AND telegram_id NOT IN (SELECT telegram_id FROM alive))
        / NULLIF((SELECT COUNT(*) FROM got WHERE blocked = 0), 0))        AS zombie_pct;

-- name: quarter_card_no_push
-- Для бота, который никогда не пишет первым: пассивной линии нет.
-- active_week1  — метрика квартала: сами что-то сделали на прошлой неделе, пришли раньше d1 − 7 дней.
-- blocked_pct   — ограничитель: доля активных прошлой недели, которые заблокировали бота с начала
--                 недели до d2 + 7 дней. Окончательно через неделю.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
week AS (SELECT date('now', 'weekday 0', '-13 days') AS d1,
                date('now', 'weekday 0', '-6 days')  AS d2),
active AS (
  SELECT DISTINCT telegram_id FROM user_activity, week
  WHERE day >= d1 AND day < d2 AND telegram_id NOT IN (SELECT telegram_id FROM me)
)
SELECT
  (SELECT COUNT(*) FROM active a, week
   WHERE NOT EXISTS (SELECT 1 FROM user_acquisition u
                     WHERE u.telegram_id = a.telegram_id
                       AND u.first_seen_at >= date(week.d1, '-7 days')))  AS active_week1,
  ROUND(100.0 * (SELECT COUNT(*) FROM active a, week
                 WHERE EXISTS (SELECT 1 FROM bot_status b
                               WHERE b.telegram_id = a.telegram_id AND b.status = 'kicked'
                                 AND b.at >= week.d1 AND b.at < date(week.d2, '+7 days')))
        / NULLIF((SELECT COUNT(*) FROM active), 0))                       AS blocked_pct;
