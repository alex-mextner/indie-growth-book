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

-- ============================================================================
-- (2.3) Когорты и удержание
-- Все даты — UTC. Неделя 0 — первые 7 дней человека (в треугольниках её нет),
-- неделя 1 — дни 7–13 и т. д. Клетка — доля ВСЕХ пришедших в когорту.
-- В Postgres: date_trunc('week', first_seen_at) вместо date(first_seen_at, 'weekday 0', '-6 days')
-- (неделя там тоже с понедельника); (day - d0) / 7 для столбцов date вместо разности julianday.
-- Первая неполная неделя записи отбрасывается ключом когорты по понедельникам — это нормально.
-- ============================================================================

-- (2.3) Перенос истории активности из таблицы событий продукта, если она есть.
-- Берите только строки, созданные самим человеком: автоповторы событий — не его действия.
-- Имена events.user_id и events.created_at у вас будут свои.
-- created_at может быть ISO-строкой, unix-секундами или миллисекундами — как в переносе из 2.1.
INSERT OR IGNORE INTO user_activity (telegram_id, day)
SELECT user_id, day FROM (
  SELECT user_id,
         CASE WHEN typeof(created_at) IN ('integer', 'real')
              THEN date(CASE WHEN created_at > 100000000000 THEN created_at / 1000 ELSE created_at END, 'unixepoch')
              ELSE date(created_at) END AS day
  FROM events
)
WHERE user_id IS NOT NULL AND day IS NOT NULL;

-- (2.3) Треугольник активного удержания: когорта = неделя первого контакта (с понедельника),
-- ячейка = доля когорты, которая сама что-то сделала на k-й неделе после своего первого дня.
-- Незавершённые недели не показываются (NULL), поэтому таблица — треугольник.
-- Удержание «на неделе k или позже» (unbounded): замените h.k = w.k на h.k >= w.k.
WITH RECURSIVE
me(telegram_id) AS (VALUES (111111111), (222222222)),  -- ваши аккаунты и аккаунты близких
weeks(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM weeks WHERE k < 6),
signal(telegram_id, day) AS (SELECT telegram_id, day FROM user_activity),
users AS (
  SELECT telegram_id, date(first_seen_at) AS d0,
         date(first_seen_at, 'weekday 0', '-6 days') AS cohort
  FROM user_acquisition a
  WHERE first_seen_at > '2000-01-01 00:00:00'           -- без заглушки из переноса (2.1)
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
cohorts AS (
  SELECT cohort, COUNT(*) AS n FROM users
  WHERE cohort >= date('now', 'weekday 0', '-6 days', '-49 days')
    AND date(cohort, '+20 days') <= date('now')          -- показываем, когда закончилась неделя 1
    AND cohort >= (SELECT MIN(day) FROM signal)          -- до начала записи — ложные нули
  GROUP BY cohort
),
hits AS (
  SELECT DISTINCT u.cohort, u.telegram_id,
         CAST((julianday(s.day) - julianday(u.d0)) / 7 AS INTEGER) AS k
  FROM signal s JOIN users u USING (telegram_id)
),
cells AS (
  SELECT c.cohort, w.k,
         ROUND(100.0 * (SELECT COUNT(DISTINCT h.telegram_id) FROM hits h
                        WHERE h.cohort = c.cohort AND h.k = w.k) / c.n) AS pct
  FROM cohorts c CROSS JOIN weeks w
  WHERE date(c.cohort, '+' || (7 * w.k + 13) || ' days') <= date('now')  -- неделя k закончилась у всех
)
SELECT c.cohort, c.n,
       MAX(CASE WHEN x.k = 1 THEN x.pct END) AS w1,
       MAX(CASE WHEN x.k = 2 THEN x.pct END) AS w2,
       MAX(CASE WHEN x.k = 3 THEN x.pct END) AS w3,
       MAX(CASE WHEN x.k = 4 THEN x.pct END) AS w4,
       MAX(CASE WHEN x.k = 5 THEN x.pct END) AS w5,
       MAX(CASE WHEN x.k = 6 THEN x.pct END) AS w6
FROM cohorts c LEFT JOIN cells x USING (cohort)
GROUP BY c.cohort ORDER BY c.cohort;

-- (2.3) Треугольник активного удержания активированных: только те, кому первое напоминание
-- пришло в первые 7 дней (глава 2.2). Отвечает на вопрос «держит ли продукт тех, кто получил пользу».
WITH RECURSIVE
me(telegram_id) AS (VALUES (111111111), (222222222)),  -- ваши аккаунты и аккаунты близких
weeks(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM weeks WHERE k < 6),
signal(telegram_id, day) AS (SELECT telegram_id, day FROM user_activity),
users AS (
  SELECT telegram_id, date(first_seen_at) AS d0,
         date(first_seen_at, 'weekday 0', '-6 days') AS cohort
  FROM user_acquisition a
  WHERE first_seen_at > '2000-01-01 00:00:00'           -- без заглушки из переноса (2.1)
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
    AND EXISTS (SELECT 1 FROM funnel_events f               -- активирован в первые 7 дней (2.2)
                WHERE f.telegram_id = a.telegram_id AND f.step = 'first_reminder_delivered'
                  AND f.at <= datetime(a.first_seen_at, '+7 days'))
),
cohorts AS (
  SELECT cohort, COUNT(*) AS n FROM users
  WHERE cohort >= date('now', 'weekday 0', '-6 days', '-49 days')
    AND date(cohort, '+20 days') <= date('now')          -- показываем, когда закончилась неделя 1
    AND cohort >= (SELECT MIN(day) FROM signal)          -- до начала записи — ложные нули
  GROUP BY cohort
),
hits AS (
  SELECT DISTINCT u.cohort, u.telegram_id,
         CAST((julianday(s.day) - julianday(u.d0)) / 7 AS INTEGER) AS k
  FROM signal s JOIN users u USING (telegram_id)
),
cells AS (
  SELECT c.cohort, w.k,
         ROUND(100.0 * (SELECT COUNT(DISTINCT h.telegram_id) FROM hits h
                        WHERE h.cohort = c.cohort AND h.k = w.k) / c.n) AS pct
  FROM cohorts c CROSS JOIN weeks w
  WHERE date(c.cohort, '+' || (7 * w.k + 13) || ' days') <= date('now')  -- неделя k закончилась у всех
)
SELECT c.cohort, c.n,
       MAX(CASE WHEN x.k = 1 THEN x.pct END) AS w1,
       MAX(CASE WHEN x.k = 2 THEN x.pct END) AS w2,
       MAX(CASE WHEN x.k = 3 THEN x.pct END) AS w3,
       MAX(CASE WHEN x.k = 4 THEN x.pct END) AS w4,
       MAX(CASE WHEN x.k = 5 THEN x.pct END) AS w5,
       MAX(CASE WHEN x.k = 6 THEN x.pct END) AS w6
FROM cohorts c LEFT JOIN cells x USING (cohort)
GROUP BY c.cohort ORDER BY c.cohort;

-- (2.3) Треугольник пассивного удержания: сигнал — доставленное напоминание.
-- Для сводок бота учёта расходов замените 'reminder' на 'weekly_summary'.
WITH RECURSIVE
me(telegram_id) AS (VALUES (111111111), (222222222)),  -- ваши аккаунты и аккаунты близких
weeks(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM weeks WHERE k < 6),
signal(telegram_id, day) AS (
  SELECT telegram_id, delivered_on FROM reminder_deliveries WHERE kind = 'reminder'
),
users AS (
  SELECT telegram_id, date(first_seen_at) AS d0,
         date(first_seen_at, 'weekday 0', '-6 days') AS cohort
  FROM user_acquisition a
  WHERE first_seen_at > '2000-01-01 00:00:00'           -- без заглушки из переноса (2.1)
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
cohorts AS (
  SELECT cohort, COUNT(*) AS n FROM users
  WHERE cohort >= date('now', 'weekday 0', '-6 days', '-49 days')
    AND date(cohort, '+20 days') <= date('now')          -- показываем, когда закончилась неделя 1
    AND cohort >= (SELECT MIN(day) FROM signal)          -- до начала записи — ложные нули
  GROUP BY cohort
),
hits AS (
  SELECT DISTINCT u.cohort, u.telegram_id,
         CAST((julianday(s.day) - julianday(u.d0)) / 7 AS INTEGER) AS k
  FROM signal s JOIN users u USING (telegram_id)
),
cells AS (
  SELECT c.cohort, w.k,
         ROUND(100.0 * (SELECT COUNT(DISTINCT h.telegram_id) FROM hits h
                        WHERE h.cohort = c.cohort AND h.k = w.k) / c.n) AS pct
  FROM cohorts c CROSS JOIN weeks w
  WHERE date(c.cohort, '+' || (7 * w.k + 13) || ' days') <= date('now')  -- неделя k закончилась у всех
)
SELECT c.cohort, c.n,
       MAX(CASE WHEN x.k = 1 THEN x.pct END) AS w1,
       MAX(CASE WHEN x.k = 2 THEN x.pct END) AS w2,
       MAX(CASE WHEN x.k = 3 THEN x.pct END) AS w3,
       MAX(CASE WHEN x.k = 4 THEN x.pct END) AS w4,
       MAX(CASE WHEN x.k = 5 THEN x.pct END) AS w5,
       MAX(CASE WHEN x.k = 6 THEN x.pct END) AS w6
FROM cohorts c LEFT JOIN cells x USING (cohort)
GROUP BY c.cohort ORDER BY c.cohort;

-- (2.3) Треугольник «на связи»: действие ИЛИ доставленное напоминание.
-- Напоминание не засчитывается, если человек заблокировал бота в течение 7 дней после него
-- (ориентир, проверяйте на своих данных). Зомби здесь остаются: см. кнопку «знак жизни».
-- Поэтому клетка окончательна на 7 дней позже, чем в активном треугольнике (+20 вместо +13).
-- Начало записи — более поздний из двух журналов.
WITH RECURSIVE
me(telegram_id) AS (VALUES (111111111), (222222222)),  -- ваши аккаунты и аккаунты близких
weeks(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM weeks WHERE k < 6),
signal(telegram_id, day) AS (
  SELECT telegram_id, day FROM user_activity
  UNION
  SELECT r.telegram_id, r.delivered_on FROM reminder_deliveries r
  WHERE r.kind = 'reminder'
    AND NOT EXISTS (SELECT 1 FROM bot_status b             -- заблокировал в течение 7 дней после
                    WHERE b.telegram_id = r.telegram_id AND b.status = 'kicked'
                      AND b.at >= r.delivered_on AND b.at < date(r.delivered_on, '+7 days'))
),
users AS (
  SELECT telegram_id, date(first_seen_at) AS d0,
         date(first_seen_at, 'weekday 0', '-6 days') AS cohort
  FROM user_acquisition a
  WHERE first_seen_at > '2000-01-01 00:00:00'           -- без заглушки из переноса (2.1)
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
cohorts AS (
  SELECT cohort, COUNT(*) AS n FROM users
  WHERE cohort >= date('now', 'weekday 0', '-6 days', '-49 days')
    AND date(cohort, '+27 days') <= date('now')          -- неделя 1 окончательна
    AND cohort >= MAX((SELECT MIN(day) FROM user_activity),
                      (SELECT MIN(delivered_on) FROM reminder_deliveries))
  GROUP BY cohort
),
hits AS (
  SELECT DISTINCT u.cohort, u.telegram_id,
         CAST((julianday(s.day) - julianday(u.d0)) / 7 AS INTEGER) AS k
  FROM signal s JOIN users u USING (telegram_id)
),
cells AS (
  SELECT c.cohort, w.k,
         ROUND(100.0 * (SELECT COUNT(DISTINCT h.telegram_id) FROM hits h
                        WHERE h.cohort = c.cohort AND h.k = w.k) / c.n) AS pct
  FROM cohorts c CROSS JOIN weeks w
  WHERE date(c.cohort, '+' || (7 * w.k + 20) || ' days') <= date('now')  -- и прошло 7 дней на блокировку
)
SELECT c.cohort, c.n,
       MAX(CASE WHEN x.k = 1 THEN x.pct END) AS w1,
       MAX(CASE WHEN x.k = 2 THEN x.pct END) AS w2,
       MAX(CASE WHEN x.k = 3 THEN x.pct END) AS w3,
       MAX(CASE WHEN x.k = 4 THEN x.pct END) AS w4,
       MAX(CASE WHEN x.k = 5 THEN x.pct END) AS w5,
       MAX(CASE WHEN x.k = 6 THEN x.pct END) AS w6
FROM cohorts c LEFT JOIN cells x USING (cohort)
GROUP BY c.cohort ORDER BY c.cohort;

-- (2.3) Одно число на неделю: сколько людей, кроме вас и близких, пользовались продуктом
-- на прошлой календарной неделе (понедельник–воскресенье, UTC). passive окончательно через неделю:
-- блокировка в течение 7 дней после напоминания снимает его задним числом.
-- active — сами что-то сделали, passive — только получили напоминание и не заблокировали бота
-- в течение 7 дней после него.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),  -- ваши аккаунты и аккаунты близких
week AS (SELECT date('now', 'weekday 0', '-13 days') AS d1,
                date('now', 'weekday 0', '-6 days')  AS d2),
active AS (
  SELECT DISTINCT telegram_id FROM user_activity, week
  WHERE day >= d1 AND day < d2
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
passive AS (
  SELECT DISTINCT r.telegram_id FROM reminder_deliveries r, week
  WHERE r.kind = 'reminder' AND r.delivered_on >= d1 AND r.delivered_on < d2
    AND r.telegram_id NOT IN (SELECT telegram_id FROM me)
    AND r.telegram_id NOT IN (SELECT telegram_id FROM active)
    AND NOT EXISTS (SELECT 1 FROM bot_status b
                    WHERE b.telegram_id = r.telegram_id AND b.status = 'kicked'
                      AND b.at >= r.delivered_on AND b.at < date(r.delivered_on, '+7 days'))
)
SELECT (SELECT COUNT(*) FROM active)  AS active,
       (SELECT COUNT(*) FROM passive) AS passive,
       (SELECT COUNT(*) FROM active) + (SELECT COUNT(*) FROM passive) AS in_touch;

-- (2.3) Активные на прошлой неделе: новые, постоянные, вернувшиеся.
-- regular — были активны хотя бы в одну из двух предыдущих недель (при недельном ритме пропуск
-- одной недели — норма); returned — перерыв две недели и больше; unknown — пришли до начала записи
-- и с тех пор не были активны. Порог — ориентир, проверяйте на своих данных.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
week AS (SELECT date('now', 'weekday 0', '-13 days') AS d1,
                date('now', 'weekday 0', '-6 days')  AS d2),
active AS (
  SELECT DISTINCT telegram_id FROM user_activity, week
  WHERE day >= d1 AND day < d2 AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
prev AS (
  SELECT a.telegram_id,
         (SELECT MAX(p.day) FROM user_activity p, week
          WHERE p.telegram_id = a.telegram_id AND p.day < week.d1) AS last_day
  FROM active a
)
SELECT CASE
         WHEN date(u.first_seen_at) >= w.d1   THEN 'new'
         WHEN p.last_day IS NULL              THEN 'unknown'
         WHEN p.last_day >= date(w.d1, '-14 days') THEN 'regular'
         ELSE 'returned'
       END AS kind,
       COUNT(*) AS users
FROM prev p JOIN user_acquisition u USING (telegram_id), week w
GROUP BY kind;

-- (2.3) Похожие на зомби: напоминания за 14 дней доставлены, ни действий, ни нажатий «знака жизни»
-- 28+ дней, бот не заблокирован. Кандидаты для вопроса «Напоминания ещё нужны?», а не для удаления.
WITH blocked AS (
  SELECT telegram_id FROM bot_status b
  WHERE status = 'kicked'
    AND at = (SELECT MAX(at) FROM bot_status WHERE telegram_id = b.telegram_id)
)
SELECT d.telegram_id,
       COUNT(*) AS delivered_14d,
       (SELECT MAX(r.acked_on) FROM reminder_deliveries r WHERE r.telegram_id = d.telegram_id) AS last_ack,
       (SELECT MAX(a.day) FROM user_activity a WHERE a.telegram_id = d.telegram_id) AS last_active
FROM reminder_deliveries d
WHERE d.delivered_on >= date('now', '-14 days')
  AND d.telegram_id NOT IN (SELECT telegram_id FROM blocked)
GROUP BY d.telegram_id
HAVING (last_active IS NULL OR last_active < date('now', '-28 days'))
   AND (last_ack IS NULL OR last_ack < date('now', '-28 days'));

-- (2.3) Малые числа: путь каждого пришедшего за последние 5 недель.
-- Номера недель с действиями и с напоминаниями, считая от первого дня (неделя 0 — первые 7 дней).
SELECT u.telegram_id, u.first_source, date(u.first_seen_at) AS d0,
       (SELECT group_concat(k, ' ') FROM (
          SELECT DISTINCT CAST((julianday(a.day) - julianday(date(u.first_seen_at))) / 7 AS INTEGER) AS k
          FROM user_activity a WHERE a.telegram_id = u.telegram_id ORDER BY k)) AS active_weeks,
       (SELECT group_concat(k, ' ') FROM (
          SELECT DISTINCT CAST((julianday(r.delivered_on) - julianday(date(u.first_seen_at))) / 7 AS INTEGER) AS k
          FROM reminder_deliveries r WHERE r.telegram_id = u.telegram_id ORDER BY k)) AS reminder_weeks
FROM user_acquisition u
WHERE u.first_seen_at >= datetime('now', '-35 days')
  AND u.telegram_id NOT IN (111111111, 222222222)   -- ваши аккаунты и аккаунты близких
ORDER BY u.first_seen_at;

-- (2.3) Малые числа: месячные когорты, периоды по 4 недели (m1 = дни 28–55 и т. д.).
WITH RECURSIVE
me(telegram_id) AS (VALUES (111111111), (222222222)),
periods(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM periods WHERE k < 4),
signal(telegram_id, day) AS (SELECT telegram_id, day FROM user_activity),
users AS (
  SELECT telegram_id, date(first_seen_at) AS d0,
         strftime('%Y-%m-01', first_seen_at) AS cohort
  FROM user_acquisition
  WHERE first_seen_at > '2000-01-01 00:00:00'
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
cohorts AS (
  SELECT cohort, COUNT(*) AS n FROM users
  WHERE cohort >= date('now', 'start of month', '-6 months')
    AND cohort <  date('now', 'start of month')
    AND cohort >= (SELECT MIN(day) FROM signal)
  GROUP BY cohort
),
hits AS (
  SELECT DISTINCT u.cohort, u.telegram_id,
         CAST((julianday(s.day) - julianday(u.d0)) / 28 AS INTEGER) AS k
  FROM signal s JOIN users u USING (telegram_id)
),
cells AS (
  SELECT c.cohort, p.k,
         ROUND(100.0 * (SELECT COUNT(DISTINCT h.telegram_id) FROM hits h
                        WHERE h.cohort = c.cohort AND h.k = p.k) / c.n) AS pct
  FROM cohorts c CROSS JOIN periods p
  WHERE date(c.cohort, '+1 month', '-1 day', '+' || (28 * p.k + 28) || ' days') <= date('now')
)
SELECT c.cohort, c.n,
       MAX(CASE WHEN x.k = 1 THEN x.pct END) AS m1,
       MAX(CASE WHEN x.k = 2 THEN x.pct END) AS m2,
       MAX(CASE WHEN x.k = 3 THEN x.pct END) AS m3,
       MAX(CASE WHEN x.k = 4 THEN x.pct END) AS m4
FROM cohorts c LEFT JOIN cells x USING (cohort)
GROUP BY c.cohort ORDER BY c.cohort;

-- (2.3) Срок хранения: через 12 месяцев сохраните готовые треугольники и удалите строки.
DELETE FROM user_activity       WHERE day          < date('now', '-12 months');
DELETE FROM reminder_deliveries WHERE delivered_on < date('now', '-12 months');
