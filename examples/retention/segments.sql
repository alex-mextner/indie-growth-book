-- Запросы к главе 5.6. Каждый начинается строкой «-- name: …» — по ней их находят retention.ts и тест.
-- Таблицы — из других примеров, новых глава не добавляет:
--   examples/tracking/schema.sql     — user_acquisition (2.1), funnel_events и bot_status (2.2),
--                                      user_activity и reminder_deliveries (2.3);
--   examples/deeplinks/deeplinks.ts  — messaging_optout (5.2, кнопка «Больше не писать»);
--   examples/experiments/schema.sql  — experiment_assignments (2.5).
-- Все даты — UTC. Свои аккаунты и аккаунты близких — в таблице me, одной на все запросы:
--   CREATE TABLE IF NOT EXISTS me (telegram_id INTEGER PRIMARY KEY);
--   INSERT OR IGNORE INTO me VALUES (111111111), (222222222);
-- Её создаёт initRetention(db, [...]) из retention.ts. В главах 2.3 и 2.6 тот же список задан в самих запросах.
-- Журнал reminder_deliveries хранит все сообщения, которые бот отправил сам, с полем kind.
-- Все виды — в одном месте (они же — KINDS в retention.ts):
--   о чём человек просил:  'reminder'       — напоминание, которое он поставил сам;
--                          'weekly_summary' — недельная сводка, если он её включил;
--   о том, за что платил:  'billing'        — продление подписки не прошло (обновление subscription, failed);
--   инициатива бота:       'reengage'       — одно сообщение замолчавшему;
--                          'zombie_check'   — вопрос «Напоминания ещё нужны?»;
--                          'announce'       — прочие сообщения по инициативе бота;
--                          мягкое напоминание из главы 5.2 — шаг 'nudge_sent' в funnel_events.
-- Бюджет — общий потолок на ВСЕ виды инициативы: они не наложатся друг на друга в одну неделю.
-- bot_status: кроме 'kicked' и 'member' (2.2) пишем 'gone' — человек недоступен (удалён аккаунт,
-- «chat not found», не запускал бота). Блокировкой 'gone' не считается, но писать ему тоже бесполезно.
-- Пороги (14, 28, 31, 180 дней, бюджет 1 в неделю) — ориентир, проверяйте на своих данных.

-- name: user_segments
-- Сегмент каждого человека на сегодня. Порядок проверок важен: первое совпадение побеждает.
--   blocked       — последний статус в bot_status — 'kicked' или 'gone';
--   new           — пришёл за последние 14 дней (онбординг и одно напоминание из 5.2);
--   active        — сам что-то сделал за 14 дней (при недельном ритме пропуск недели — норма, 2.3);
--   passive_alive — действий за 14 дней нет, напоминания за 14 дней доставлены,
--                   знак жизни (действие или «Помню») был за 28 дней;
--   zombie        — напоминания за 14 дней доставлены, знака жизни 28 дней нет (2.3);
--   dormant       — ни действий, ни напоминаний за 14 дней, но раньше получал пользу
--                   (шаг first_value или first_reminder_delivered, или действия хотя бы в 3 разных дня);
--   never_activated — то же, но пользы не получал никогда: это забота онбординга (5.2), а не возврата.
-- opted_out — нажал «Больше не писать»: это не сегмент, а запрет на сообщения по инициативе бота.
WITH
facts AS (
  SELECT a.telegram_id, a.first_seen_at,
         (SELECT b.status FROM bot_status b WHERE b.telegram_id = a.telegram_id
          ORDER BY b.at DESC, b.rowid DESC LIMIT 1)                               AS last_status,
         (SELECT MAX(u.day) FROM user_activity u WHERE u.telegram_id = a.telegram_id) AS last_act,
         (SELECT MAX(r.acked_on) FROM reminder_deliveries r
          WHERE r.telegram_id = a.telegram_id)                                    AS last_ack,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = a.telegram_id
                   AND f.step IN ('first_value', 'first_reminder_delivered'))
         OR (SELECT COUNT(*) FROM user_activity u WHERE u.telegram_id = a.telegram_id) >= 3 AS had_value,
         EXISTS (SELECT 1 FROM reminder_deliveries r
                 WHERE r.telegram_id = a.telegram_id AND r.kind = 'reminder'
                   AND r.delivered_on >= date('now', '-14 days'))                 AS got_reminders,
         EXISTS (SELECT 1 FROM messaging_optout o WHERE o.telegram_id = a.telegram_id) AS opted_out
  FROM user_acquisition a
  WHERE a.telegram_id NOT IN (SELECT telegram_id FROM me)
)
SELECT telegram_id,
       CASE
         WHEN last_status IN ('kicked', 'gone')              THEN 'blocked'
         WHEN first_seen_at >= datetime('now', '-14 days')    THEN 'new'
         WHEN last_act >= date('now', '-14 days')             THEN 'active'
         WHEN got_reminders AND (last_act >= date('now', '-28 days')
                                 OR last_ack >= date('now', '-28 days')) THEN 'passive_alive'
         WHEN got_reminders                                   THEN 'zombie'
         WHEN had_value                                       THEN 'dormant'
         ELSE 'never_activated'
       END AS segment,
       opted_out
FROM facts
ORDER BY telegram_id;

-- name: segment_counts
-- Сколько людей в каждом сегменте. Смотрите на направление за несколько недель, а не на одно число.
WITH
facts AS (
  SELECT a.telegram_id, a.first_seen_at,
         (SELECT b.status FROM bot_status b WHERE b.telegram_id = a.telegram_id
          ORDER BY b.at DESC, b.rowid DESC LIMIT 1)                               AS last_status,
         (SELECT MAX(u.day) FROM user_activity u WHERE u.telegram_id = a.telegram_id) AS last_act,
         (SELECT MAX(r.acked_on) FROM reminder_deliveries r
          WHERE r.telegram_id = a.telegram_id)                                    AS last_ack,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = a.telegram_id
                   AND f.step IN ('first_value', 'first_reminder_delivered'))
         OR (SELECT COUNT(*) FROM user_activity u WHERE u.telegram_id = a.telegram_id) >= 3 AS had_value,
         EXISTS (SELECT 1 FROM reminder_deliveries r
                 WHERE r.telegram_id = a.telegram_id AND r.kind = 'reminder'
                   AND r.delivered_on >= date('now', '-14 days'))                 AS got_reminders
  FROM user_acquisition a
  WHERE a.telegram_id NOT IN (SELECT telegram_id FROM me)
),
seg AS (
  SELECT CASE
           WHEN last_status IN ('kicked', 'gone')              THEN 'blocked'
           WHEN first_seen_at >= datetime('now', '-14 days')    THEN 'new'
           WHEN last_act >= date('now', '-14 days')             THEN 'active'
           WHEN got_reminders AND (last_act >= date('now', '-28 days')
                                   OR last_ack >= date('now', '-28 days')) THEN 'passive_alive'
           WHEN got_reminders                                   THEN 'zombie'
           WHEN had_value                                       THEN 'dormant'
           ELSE 'never_activated'
         END AS segment
  FROM facts
)
SELECT segment, COUNT(*) AS users FROM seg GROUP BY segment ORDER BY users DESC;

-- name: message_budget
-- Сообщения за последние 7 дней (сегодня и 6 дней до него) на человека: о чём просил и что бот написал сам.
-- Бюджет ограничивает только инициативу бота: напоминания и сводку человек заказал сам,
-- billing касается того, за что он заплатил.
-- over_budget = 1 — бот написал по своей инициативе больше, чем разрешает бюджет.
WITH
budget(max_initiative) AS (VALUES (1)),              -- потолок на все виды инициативы бота за 7 дней
asked_kinds(kind) AS (VALUES ('reminder'), ('weekly_summary')),
initiative_kinds(kind) AS (VALUES ('reengage'), ('zombie_check'), ('announce'), ('nudge')),
sent AS (
  SELECT telegram_id, kind FROM reminder_deliveries
  WHERE delivered_on >= date('now', '-6 days')
  UNION ALL
  SELECT telegram_id, 'nudge' FROM funnel_events
  WHERE step = 'nudge_sent' AND at >= date('now', '-6 days')
)
SELECT telegram_id,
       SUM(kind IN (SELECT kind FROM asked_kinds))                  AS asked,
       SUM(kind = 'billing')                                        AS billing,
       SUM(kind IN (SELECT kind FROM initiative_kinds))             AS initiative,
       (SELECT max_initiative FROM budget)                          AS budget,
       SUM(kind IN (SELECT kind FROM initiative_kinds))
         > (SELECT max_initiative FROM budget)                      AS over_budget
FROM sent
WHERE telegram_id NOT IN (SELECT telegram_id FROM me)
GROUP BY telegram_id
ORDER BY initiative DESC, asked DESC;

-- name: blocks_by_kind
-- Ограничитель: блокировки после сообщений каждого вида. Берём отправленные от 60 до 2 дней назад;
-- блокировка засчитывается, если случилась в день отправки или на следующий день
-- (в журнале только дата отправки, без времени). Мягкое напоминание 5.2 — строкой 'nudge'.
WITH
sent AS (
  SELECT telegram_id, kind, delivered_on AS d FROM reminder_deliveries
  WHERE delivered_on >= date('now', '-60 days') AND delivered_on < date('now', '-2 days')
  UNION ALL
  SELECT telegram_id, 'nudge', date(at) FROM funnel_events
  WHERE step = 'nudge_sent' AND at >= date('now', '-60 days') AND at < date('now', '-2 days')
)
SELECT kind,
       COUNT(*)                     AS messages,
       COUNT(DISTINCT telegram_id)  AS users,
       SUM(EXISTS (SELECT 1 FROM bot_status b
                   WHERE b.telegram_id = s.telegram_id AND b.status = 'kicked'
                     AND b.at >= s.d AND b.at < date(s.d, '+2 days'))) AS blocked_after
FROM sent s
WHERE telegram_id NOT IN (SELECT telegram_id FROM me)
GROUP BY kind
ORDER BY kind;

-- name: reengage_candidates
-- Кому можно отправить одно сообщение с новой пользой. Параметр $experiment — имя эксперимента (2.5).
-- Спящий (dormant, см. user_segments), у которого последнее действие — от 31 до 180 дней назад:
-- в сегмент попадают через 14 дней тишины, пишем с 31-го дня, после 180 дней не пишем никогда.
-- Поэтому кандидатов меньше, чем спящих.
-- Исключаем: отказавшихся («Больше не писать»), заблокировавших и недоступных ('kicked', 'gone'),
-- тех, кому бот писал за 30 дней (любое сообщение из журнала или мягкое напоминание 5.2),
-- и тех, кто уже попал в этот эксперимент (в любую группу). Время суток проверяет код (isDaytime).
SELECT a.telegram_id
FROM user_acquisition a
WHERE a.telegram_id NOT IN (SELECT telegram_id FROM me)
  AND (EXISTS (SELECT 1 FROM funnel_events f
               WHERE f.telegram_id = a.telegram_id
                 AND f.step IN ('first_value', 'first_reminder_delivered'))
       OR (SELECT COUNT(*) FROM user_activity u WHERE u.telegram_id = a.telegram_id) >= 3)
  AND (SELECT MAX(u.day) FROM user_activity u WHERE u.telegram_id = a.telegram_id)
      BETWEEN date('now', '-180 days') AND date('now', '-31 days')
  AND NOT EXISTS (SELECT 1 FROM reminder_deliveries r
                  WHERE r.telegram_id = a.telegram_id AND r.delivered_on >= date('now', '-30 days'))
  AND NOT EXISTS (SELECT 1 FROM funnel_events f
                  WHERE f.telegram_id = a.telegram_id AND f.step = 'nudge_sent'
                    AND f.at >= date('now', '-30 days'))
  AND NOT EXISTS (SELECT 1 FROM messaging_optout o WHERE o.telegram_id = a.telegram_id)
  AND COALESCE((SELECT b.status FROM bot_status b WHERE b.telegram_id = a.telegram_id
                ORDER BY b.at DESC, b.rowid DESC LIMIT 1), 'member') NOT IN ('kicked', 'gone')
  AND NOT EXISTS (SELECT 1 FROM experiment_assignments e
                  WHERE e.experiment = $experiment AND e.telegram_id = a.telegram_id)
ORDER BY a.telegram_id;

-- name: reengage_outcome
-- Итог по группам: B — получили сообщение, A — контрольная группа (holdout), им не писали.
-- Только назначенные больше 14 дней назад: у всех одинаковое окно.
-- returned_14d — сами что-то сделали за 14 дней с назначения и не нажали «Больше не писать»
--                (нажатие кнопки тоже попадает в user_activity, но возвращением не является);
-- opted_out_14d, blocked_14d — ограничители.
SELECT e.variant,
       COUNT(*) AS n,
       SUM(EXISTS (SELECT 1 FROM user_activity u
                   WHERE u.telegram_id = e.telegram_id
                     AND u.day >= date(e.assigned_at) AND u.day < date(e.assigned_at, '+14 days'))
           AND NOT EXISTS (SELECT 1 FROM messaging_optout o
                           WHERE o.telegram_id = e.telegram_id
                             AND o.at >= e.assigned_at AND o.at < datetime(e.assigned_at, '+14 days')))
         AS returned_14d,
       SUM(EXISTS (SELECT 1 FROM messaging_optout o
                   WHERE o.telegram_id = e.telegram_id
                     AND o.at >= e.assigned_at AND o.at < datetime(e.assigned_at, '+14 days')))
         AS opted_out_14d,
       SUM(EXISTS (SELECT 1 FROM bot_status b
                   WHERE b.telegram_id = e.telegram_id AND b.status = 'kicked'
                     AND b.at >= e.assigned_at AND b.at < datetime(e.assigned_at, '+14 days')))
         AS blocked_14d
FROM experiment_assignments e
WHERE e.experiment = $experiment
  AND e.assigned_at < datetime('now', '-14 days')
GROUP BY e.variant
ORDER BY e.variant;
