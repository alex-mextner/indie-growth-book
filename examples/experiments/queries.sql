-- Запросы к главе 2.5. Каждый начинается строкой «-- name: …» — по ней их находят тесты.
-- Параметры — именованные: :experiment, :step, :change_at. Впишите в me свои аккаунты и аккаунты близких.

-- name: experiment_by_variant
-- Главная метрика и две ограничительные по группам эксперимента (в главе — в прозе, здесь — запрос).
-- Все, кому группа назначена при /start, остаются в знаменателе («доля пришедших»), даже если ушли до изменения.
-- Перед чтением итога проверьте разбиение: splitLooksBroken(nA, nB) в experiments.ts.
-- Берём только тех, у кого прошло 7 дней с попадания в группу, и только до ended_at из карточки:
-- после конца эксперимента выборка не растёт, и результат не «доползает» до нужного.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
arm AS (
  SELECT a.telegram_id, a.variant, a.assigned_at
  FROM experiment_assignments a
  JOIN experiments x ON x.name = a.experiment
  WHERE a.experiment = :experiment
    AND a.assigned_at <  datetime('now', '-7 days')
    AND (x.ended_at IS NULL OR a.assigned_at < x.ended_at)
    AND a.telegram_id NOT IN (SELECT telegram_id FROM me)
)
SELECT variant,
       COUNT(*) AS users,
       SUM(EXISTS (SELECT 1 FROM funnel_events f
                   WHERE f.telegram_id = arm.telegram_id AND f.step = :step
                     AND f.at <= datetime(arm.assigned_at, '+7 days'))) AS hit,
       SUM(EXISTS (SELECT 1 FROM funnel_events f
                   WHERE f.telegram_id = arm.telegram_id AND f.step = 'first_reminder_delivered'
                     AND f.at <= datetime(arm.assigned_at, '+7 days'))) AS activated,
       SUM(EXISTS (SELECT 1 FROM bot_status b
                   WHERE b.telegram_id = arm.telegram_id AND b.status = 'kicked'
                     AND b.at <= datetime(arm.assigned_at, '+7 days'))) AS blocked
FROM arm
GROUP BY variant
ORDER BY variant;

-- name: before_after
-- До и после изменения: четыре недели до и четыре после, по группам каналов.
-- Сутки вокруг изменения выброшены: пришедшие в эти часы могли увидеть обе версии.
-- Только «дозревшие» — с прихода прошло 7 дней. Посевы — отдельной строкой: они меняют состав.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
users AS (
  SELECT telegram_id, first_seen_at,
         CASE WHEN first_seen_at < :change_at THEN '1 до' ELSE '2 после' END AS period,
         CASE WHEN first_source LIKE 'src\_tg\_%' ESCAPE '\' THEN 'посевы'
              WHEN first_source = 'src_share' THEN 'приглашения'
              ELSE 'остальные' END AS channel
  FROM user_acquisition
  WHERE first_source <> 'legacy'
    AND first_seen_at >= datetime(:change_at, '-28 days')
    AND first_seen_at <  datetime(:change_at, '+28 days')
    AND NOT (first_seen_at >= datetime(:change_at, '-1 day')
             AND first_seen_at < datetime(:change_at, '+1 day'))
    AND first_seen_at <  datetime('now', '-7 days')
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
)
SELECT period, channel,
       COUNT(*) AS users,
       SUM(EXISTS (SELECT 1 FROM funnel_events f
                   WHERE f.telegram_id = users.telegram_id AND f.step = :step
                     AND f.at <= datetime(users.first_seen_at, '+7 days'))) AS hit
FROM users
GROUP BY period, channel
ORDER BY period, channel;

-- name: by_week
-- Для чередования по неделям (variantByWeek): единица сравнения — неделя, а не человек.
-- Понедельник — день переключения — выброшен: в этот день ещё действуют хвосты прошлой недели.
-- Смотрите на пары недель: сколько пар выиграл B (signTestP в experiments.ts). 2 из 2 — случайно в каждом четвёртом случае.
WITH me(telegram_id) AS (VALUES (111111111), (222222222))
SELECT date(a.assigned_at, 'weekday 0', '-6 days') AS week,
       a.variant,
       COUNT(*) AS users,
       SUM(EXISTS (SELECT 1 FROM funnel_events f
                   WHERE f.telegram_id = a.telegram_id AND f.step = :step
                     AND f.at <= datetime(a.assigned_at, '+7 days'))) AS hit
FROM experiment_assignments a
WHERE a.experiment = :experiment
  AND a.assigned_at < datetime('now', '-7 days')
  AND strftime('%w', a.assigned_at) <> '1'
  AND a.telegram_id NOT IN (SELECT telegram_id FROM me)
GROUP BY week, a.variant
ORDER BY week;

-- name: fake_door
-- Фальшивая дверь: шаги 'fake_door_seen' (увидел кнопку) и 'fake_door_clicked' (нажал) пишет markStep
-- из examples/tracking — один раз на человека, так что считается первое нажатие.
-- Читайте долю с интервалом Уилсона, когда кнопку увидели хотя бы 40 человек (ориентир).
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
seen AS (
  SELECT telegram_id FROM funnel_events
  WHERE step = 'fake_door_seen' AND telegram_id NOT IN (SELECT telegram_id FROM me)
)
SELECT (SELECT COUNT(*) FROM seen) AS seen,
       (SELECT COUNT(*) FROM funnel_events f JOIN seen USING (telegram_id)
        WHERE f.step = 'fake_door_clicked') AS clicked;

-- name: stuck_paths
-- Качественный сигнал: путь каждого из группы, кто не дошёл до шага :step.
-- Шаги в порядке прохождения; читайте глазами, по 5–10 историй на группу.
SELECT a.variant, a.telegram_id,
       (SELECT group_concat(step, ' → ')
        FROM (SELECT step FROM funnel_events f
              WHERE f.telegram_id = a.telegram_id ORDER BY f.at, f.rowid)) AS path
FROM experiment_assignments a
WHERE a.experiment = :experiment
  AND a.assigned_at < datetime('now', '-7 days')
  AND NOT EXISTS (SELECT 1 FROM funnel_events f
                  WHERE f.telegram_id = a.telegram_id AND f.step = :step)
ORDER BY a.variant, a.assigned_at;

-- name: delete_user_experiments
-- Удаление по запросу пользователя (главы 2.1, 5.8): группа в эксперименте — тоже его данные.
DELETE FROM experiment_assignments WHERE telegram_id = :telegram_id;
