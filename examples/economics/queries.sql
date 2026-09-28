-- Запросы к главе 2.4. Каждый начинается строкой «-- name: …» — по ней их находят тесты.
-- Окна и когорты — как в главах 2.1–2.3: пришедшие 21–7 дней назад, первые 7 дней после старта.
-- «Запрос» человека — это request_id с trigger = 'user'; вызовов API за ним может быть несколько.
-- Свои аккаунты и аккаунты близких перечислите в me(...) — как в главе 2.3.
-- Сначала проверяйте missing_prices: строки без цены записаны по самой дорогой цене и завышают суммы.

-- name: missing_prices
-- Вызовы моделей, которых нет в таблице цен: записаны по самой дорогой цене (оценка сверху), обновите таблицу.
SELECT model, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS upper_bound_usd
FROM ai_usage WHERE priced = 0 GROUP BY model;

-- name: cost_per_active_30d
-- Себестоимость ИИ на активного пользователя за 30 дней. Активный — есть день в user_activity (глава 2.3).
-- В числителе все вызовы: отдельно ответы на сообщения (user) и сводки по расписанию (system).
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
active AS (
  SELECT DISTINCT telegram_id FROM user_activity
  WHERE day >= date('now', '-30 days')
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
spent AS (
  SELECT SUM(cost_usd) AS usd,
         SUM(CASE WHEN trigger = 'user'   THEN cost_usd ELSE 0 END) AS user_usd,
         SUM(CASE WHEN trigger = 'system' THEN cost_usd ELSE 0 END) AS system_usd
  FROM ai_usage
  WHERE at >= datetime('now', '-30 days')
    AND user_id NOT IN (SELECT telegram_id FROM me)
)
SELECT (SELECT COUNT(*) FROM active)                                        AS active_users,
       ROUND((SELECT usd FROM spent), 2)                                    AS ai_cost_usd,
       ROUND((SELECT user_usd FROM spent), 2)                               AS user_triggered_usd,
       ROUND((SELECT system_usd FROM spent), 2)                             AS system_triggered_usd,
       ROUND((SELECT usd FROM spent) / NULLIF((SELECT COUNT(*) FROM active), 0), 4) AS cost_per_active_usd;

-- name: top_decile_share
-- Какую долю расходов на ИИ за 30 дней дают 10 % самых дорогих пользователей.
-- Запрос имеет смысл от двадцати пользователей с расходами; при меньшем числе вернёт пустые значения.
WITH per_user AS (
  SELECT user_id, SUM(cost_usd) AS cost FROM ai_usage
  WHERE at >= datetime('now', '-30 days') AND user_id <> 0 GROUP BY user_id
),
ranked AS (
  SELECT cost, NTILE(10) OVER (ORDER BY cost DESC) AS decile FROM per_user
  WHERE (SELECT COUNT(*) FROM per_user) >= 20
)
SELECT ROUND(100.0 * SUM(CASE WHEN decile = 1 THEN cost ELSE 0 END) / SUM(cost)) AS top10_pct,
       ROUND(AVG(cost), 4) AS avg_user_usd,
       ROUND(MAX(cost), 4) AS max_user_usd
FROM ranked;

-- name: cost_by_stage
-- Где человек остановился в воронке за первые 7 дней и сколько стоил за это время.
-- Все строки выше first_reminder_delivered — неактивированные. Сравнивайте средние на человека.
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
reached AS (
  SELECT c.telegram_id, c.started_at, MAX(s.ord) AS ord
  FROM cohort c
  JOIN funnel_events f ON f.telegram_id = c.telegram_id
                      AND f.at <= datetime(c.started_at, '+7 days')
  JOIN steps s ON s.step = f.step
  GROUP BY c.telegram_id
),
spent AS (
  SELECT r.ord,
         COUNT(DISTINCT CASE WHEN u.trigger = 'user' AND u.status = 'ok' THEN u.request_id END) AS requests,
         COALESCE(SUM(u.cost_usd), 0) AS cost
  FROM reached r
  LEFT JOIN ai_usage u ON u.user_id = r.telegram_id
                      AND u.at <= datetime(r.started_at, '+7 days')
  GROUP BY r.telegram_id
)
SELECT s.step AS stopped_at,
       COUNT(*)                   AS users,
       ROUND(AVG(sp.requests), 1) AS avg_requests,
       ROUND(AVG(sp.cost), 4)     AS avg_cost_usd,
       ROUND(SUM(sp.cost), 2)     AS total_cost_usd
FROM spent sp JOIN steps s USING (ord)
GROUP BY s.ord ORDER BY s.ord;

-- name: cost_by_activation
-- То же, короче: активированные против неактивированных за первые 7 дней.
WITH cohort AS (
  SELECT telegram_id, first_seen_at AS started_at FROM user_acquisition
  WHERE first_source <> 'legacy'
    AND first_seen_at >= datetime('now', '-21 days')
    AND first_seen_at <  datetime('now', '-7 days')
),
per_user AS (
  SELECT c.telegram_id,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = c.telegram_id AND f.step = 'first_reminder_delivered'
                   AND f.at <= datetime(c.started_at, '+7 days')) AS activated,
         (SELECT COUNT(DISTINCT u.request_id) FROM ai_usage u
          WHERE u.user_id = c.telegram_id AND u.trigger = 'user' AND u.status = 'ok'
            AND u.at <= datetime(c.started_at, '+7 days')) AS requests,
         (SELECT COALESCE(SUM(u.cost_usd), 0) FROM ai_usage u
          WHERE u.user_id = c.telegram_id AND u.at <= datetime(c.started_at, '+7 days')) AS cost
  FROM cohort c
)
SELECT activated,
       COUNT(*)                AS users,
       ROUND(AVG(requests), 1) AS avg_requests,
       ROUND(AVG(cost), 4)     AS avg_cost_usd,
       ROUND(SUM(cost), 2)     AS total_cost_usd
FROM per_user GROUP BY activated ORDER BY activated;

-- name: cac_by_source
-- Стоимость привлечения по каналам: на старт и на активированного, плюс ИИ за первую неделю.
-- Метка канала уникальна для каждого размещения (глава 2.1), поэтому окно не нужно.
-- Пока у кого-то из пришедших не прошло 7 дней (maturing > 0), CAC на активированного не считается:
-- активаций ещё будет больше. Первое касание недосчитывает размещения (поиск → none, пересылки → src_share),
-- поэтому считайте результат верхней границей CAC.
WITH spend AS (
  SELECT source, SUM(amount_usd) AS usd FROM marketing_spend GROUP BY source
),
people AS (
  SELECT a.first_source AS source, a.telegram_id,
         a.first_seen_at > datetime('now', '-7 days') AS maturing,
         EXISTS (SELECT 1 FROM funnel_events f
                 WHERE f.telegram_id = a.telegram_id AND f.step = 'first_reminder_delivered'
                   AND f.at <= datetime(a.first_seen_at, '+7 days')) AS activated,
         (SELECT COALESCE(SUM(u.cost_usd), 0) FROM ai_usage u
          WHERE u.user_id = a.telegram_id
            AND u.at <= datetime(a.first_seen_at, '+7 days')) AS ai_usd
  FROM user_acquisition a
  WHERE a.first_source IN (SELECT source FROM spend)
),
agg AS (
  SELECT source, COUNT(*) AS starts, SUM(maturing) AS maturing,
         SUM(activated) AS activated, SUM(ai_usd) AS ai_usd
  FROM people GROUP BY source
)
SELECT g.source,
       s.usd                                   AS spent_usd,
       g.starts, g.maturing, g.activated,
       ROUND(s.usd / g.starts, 2)              AS cac_per_start,
       CASE WHEN g.maturing = 0
            THEN ROUND(s.usd / NULLIF(g.activated, 0), 2) END                 AS cac_per_activated,
       ROUND(g.ai_usd, 2)                      AS ai_first_week_usd,
       CASE WHEN g.maturing = 0
            THEN ROUND((s.usd + g.ai_usd) / NULLIF(g.activated, 0), 2) END    AS full_cost_per_activated
FROM agg g JOIN spend s USING (source)
ORDER BY full_cost_per_activated IS NULL, full_cost_per_activated;

-- name: limit_hits_7d
-- Сколько людей за последние 7 дней упёрлись бы в недельный лимит (гипотеза: 50 запросов).
-- Считаются удачные запросы человека (request_id с trigger = 'user'), а не вызовы API. Платящих исключите.
SELECT COUNT(*) AS users_at_limit FROM (
  SELECT user_id FROM ai_usage
  WHERE at >= datetime('now', '-7 days') AND trigger = 'user' AND status = 'ok'
  GROUP BY user_id HAVING COUNT(DISTINCT request_id) >= 50
);

-- name: spend_today
-- Предохранитель: сколько потрачено на ИИ с полуночи UTC. Сравнивайте с дневным потолком (глава 5.7).
SELECT ROUND(COALESCE(SUM(cost_usd), 0), 2) AS usd FROM ai_usage WHERE at >= date('now');

-- name: arppu_30d
-- Средний доход на платящего за 30 дней: то, что дошло после комиссии (net_usd), без возвратов.
-- Уже после комиссии: для вклада умножайте только на (1 − налог − возвраты) и вычитайте ИИ.
SELECT COUNT(DISTINCT telegram_id)                          AS payers,
       ROUND(SUM(net_usd), 2)                               AS net_revenue_usd,
       ROUND(SUM(net_usd) / NULLIF(COUNT(DISTINCT telegram_id), 0), 2) AS net_arppu_usd
FROM payments
WHERE refunded_at IS NULL AND telegram_id <> 0 AND paid_at >= datetime('now', '-30 days');

-- name: payer_churn_monthly
-- Отток платящих по месяцам: доля платежей, за которыми не было продления в течение 35 дней
-- (подписка в Stars продлевается каждые 30 дней, 5 дней — запас). Только подписки и платежи старше 35 дней.
WITH p AS (
  SELECT telegram_id, paid_at FROM payments
  WHERE refunded_at IS NULL AND telegram_id <> 0 AND kind = 'subscription'
)
SELECT month, payments, not_renewed, ROUND(100.0 * not_renewed / payments) AS churn_pct
FROM (
  SELECT strftime('%Y-%m', p.paid_at) AS month,
         COUNT(*) AS payments,
         SUM(NOT EXISTS (SELECT 1 FROM p q
                         WHERE q.telegram_id = p.telegram_id
                           AND q.paid_at > p.paid_at
                           AND q.paid_at <= datetime(p.paid_at, '+35 days'))) AS not_renewed
  FROM p
  WHERE p.paid_at < datetime('now', '-35 days')
  GROUP BY month
)
ORDER BY month;

-- name: cohort_ltv
-- Треугольник платящих: когорта = месяц первого подписочного платежа, k = 30-дневный период от него.
-- Клетка — накопленный вклад на ОДНОГО исходного платящего: выручка после комиссии (net_usd) без возвращённых
-- платежей, за вычетом налога (params.tax) и затрат этих людей на ИИ. Та же величина, что «вклад» в формуле LTV.
-- Бесплатные, которых «несёт» платящий, в клетку не входят. Незавершённые периоды не показываются.
WITH RECURSIVE
params(tax) AS (VALUES (0.06)),                 -- иллюстрация: подставьте свою ставку
ks(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM ks WHERE k < 5),
payers AS (
  SELECT telegram_id, MIN(paid_at) AS first_paid, strftime('%Y-%m', MIN(paid_at)) AS cohort
  FROM payments WHERE refunded_at IS NULL AND telegram_id <> 0 AND kind = 'subscription'
  GROUP BY telegram_id
),
cohorts AS (SELECT cohort, COUNT(*) AS n FROM payers GROUP BY cohort),
rev AS (
  SELECT pr.cohort,
         CAST((julianday(p.paid_at) - julianday(pr.first_paid)) / 30 AS INTEGER) AS k,
         SUM(p.net_usd) * (1 - (SELECT tax FROM params)) AS usd
  FROM payments p JOIN payers pr USING (telegram_id)
  WHERE p.refunded_at IS NULL AND p.kind = 'subscription' GROUP BY 1, 2
),
ai AS (
  SELECT pr.cohort,
         CAST((julianday(u.at) - julianday(pr.first_paid)) / 30 AS INTEGER) AS k,
         SUM(u.cost_usd) AS usd
  FROM ai_usage u JOIN payers pr ON pr.telegram_id = u.user_id
  WHERE u.at >= pr.first_paid GROUP BY 1, 2
),
cells AS (
  SELECT c.cohort, c.n, ks.k,
         (SELECT COALESCE(SUM(r.usd), 0) FROM rev r WHERE r.cohort = c.cohort AND r.k <= ks.k)
       - (SELECT COALESCE(SUM(a.usd), 0) FROM ai  a WHERE a.cohort = c.cohort AND a.k <= ks.k) AS contribution_cum
  FROM cohorts c CROSS JOIN ks
  WHERE datetime(c.cohort || '-01', '+1 month', '+' || (30 * (ks.k + 1)) || ' days') <= datetime('now')
)
SELECT cohort, n,
       MAX(CASE WHEN k = 0 THEN ROUND(contribution_cum / n, 2) END) AS m0,
       MAX(CASE WHEN k = 1 THEN ROUND(contribution_cum / n, 2) END) AS m1,
       MAX(CASE WHEN k = 2 THEN ROUND(contribution_cum / n, 2) END) AS m2,
       MAX(CASE WHEN k = 3 THEN ROUND(contribution_cum / n, 2) END) AS m3,
       MAX(CASE WHEN k = 4 THEN ROUND(contribution_cum / n, 2) END) AS m4,
       MAX(CASE WHEN k = 5 THEN ROUND(contribution_cum / n, 2) END) AS m5
FROM cells GROUP BY cohort ORDER BY cohort;

-- name: paywall_funnel_by_week
-- Глава 5.5: настоящая дверь вместо фальшивой (глава 2.5), по неделям (с понедельника, UTC) и ценам.
-- Показы и нажатия — из paywall_views (recordPaywallView), оплата — подписка по той же цене не позже 7 дней
-- после первого показа на этой неделе, без возврата. Свои аккаунты исключены. Считаются люди, а не показы.
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
v AS (
  SELECT telegram_id, stars, action, at,
         date(at, '-' || ((CAST(strftime('%w', at) AS INTEGER) + 6) % 7) || ' days') AS week
  FROM paywall_views WHERE telegram_id NOT IN (SELECT telegram_id FROM me)
),
seen AS (
  SELECT week, stars, telegram_id, MIN(at) AS first_at FROM v WHERE action = 'seen'
  GROUP BY week, stars, telegram_id
)
SELECT s.week, s.stars,
       COUNT(*) AS seen,
       SUM(EXISTS (SELECT 1 FROM v WHERE v.week = s.week AND v.stars = s.stars
                   AND v.telegram_id = s.telegram_id AND v.action = 'clicked')) AS clicked,
       SUM(EXISTS (SELECT 1 FROM payments p
                   WHERE p.telegram_id = s.telegram_id AND p.kind = 'subscription' AND p.amount = s.stars
                     AND p.refunded_at IS NULL AND p.paid_at >= s.first_at
                     AND p.paid_at <= datetime(s.first_at, '+7 days'))) AS paid
FROM seen s
GROUP BY s.week, s.stars
ORDER BY s.week, s.stars;

-- name: refund_share_30d
-- Глава 5.5: доля возвращённых платежей звёздами за 30 дней — предохранитель. В главе 2.4 заложено 2 % (иллюстрация).
SELECT COUNT(*) AS payments,
       SUM(refunded_at IS NOT NULL) AS refunded,
       ROUND(100.0 * SUM(refunded_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS refund_pct
FROM payments
WHERE provider = 'stars' AND paid_at >= datetime('now', '-30 days');
