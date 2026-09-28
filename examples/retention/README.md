# Код к главе 5.6

TypeScript + Bun + `bun:sqlite`. `initRetention(db, [ваши id])` создаёт две маленькие таблицы: `me` — ваши аккаунты и аккаунты близких, один список на все запросы `segments.sql`, и `billing_pending` — очередь сообщений о неудачном продлении. Остальное — таблицы из `examples/tracking/schema.sql` (главы 2.1–2.3), `messaging_optout` из `examples/deeplinks` (5.2) и `experiment_assignments` из `examples/experiments/schema.sql` (2.5).

Журнал `reminder_deliveries` из главы 2.3 хранит все сообщения, которые бот отправил сам, с полем `kind`. Все виды — в `KINDS` (`retention.ts`) и в шапке `segments.sql`: `reminder` и `weekly_summary` — о них человек просил; `billing` — о том, за что он заплатил (продление подписки не прошло, глава 5.5); `reengage`, `zombie_check`, `announce` и мягкое напоминание из 5.2 (шаг `nudge_sent`) — инициатива бота под общим недельным бюджетом. В `bot_status` кроме `kicked` и `member` появляется `gone` — человек недоступен (удалён, «chat not found»).

- `segments.sql`:
  - `user_segments` — сегмент каждого человека: `blocked` (заблокировал или недоступен), `new` (14 дней), `active` (действие за 14 дней), `passive_alive` (напоминания идут, знак жизни за 28 дней), `zombie` (напоминания идут, знака жизни 28 дней нет), `dormant` (ни действий, ни напоминаний 14 дней, но польза была), `never_activated` (то же, пользы не было); отдельный флаг `opted_out`;
  - `segment_counts` — сколько людей в каждом сегменте;
  - `message_budget` — сообщения за 7 дней на человека: о чём просил, `billing` и инициатива бота против общего бюджета (1 в неделю);
  - `blocks_by_kind` — ограничитель: блокировки в день отправки или на следующий, по видам сообщений;
  - `reengage_candidates` — спящие, у которых последнее действие 31–180 дней назад, без отказа, без блокировки, без сообщений за 30 дней и ещё не попавшие в эксперимент (их меньше, чем спящих);
  - `reengage_outcome` — вернувшиеся за 14 дней, отказы и блокировки по группам: B получила сообщение, A — контрольная группа (holdout).
- `retention.ts`:
  - `userSegments`, `segmentCounts`, `messageBudget`, `blocksByKind`, `reengageCandidates`, `reengageOutcome` — обёртки над запросами;
  - `mayWrite` — проверка: своё напоминание — всегда, кроме блокировки; `billing` — днём; инициатива — днём (`isDaytime` из 5.2), без «Больше не писать» и в пределах бюджета;
  - `reserveMessage` / `confirmMessage` / `releaseMessage` — проверка и запись в журнал одной транзакцией (`BEGIN IMMEDIATE`), чтобы два процесса не прошли бюджет одновременно;
  - `classifySendError` — ошибка отправки: `blocked` (403, заблокировал), `gone` (другие 403 и «chat not found»), `retry` (429, `retry_after`), `other`; `recordUnreachable` пишет статус;
  - `runReengageWave` — одна волна сообщений спящим: делит хешем `assignVariant` из 2.5 (B — пишем, A — нет), не быстрее 25 в секунду, на 429 ждёт `retry_after`; группа B пишется только при окончательном исходе, временный сбой — повтор в следующий запуск;
  - `reengageEffect` — разница долей вернувшихся B − A с интервалом Ньюкомба (`diffInterval` из 2.5);
  - `onSubscriptionUpdate` / `sendPendingBilling` — обновление `subscription`: `failed` ставит сообщение в очередь, `active` и `canceled` снимают; днём очередь уходит вне бюджета, ночью ждёт; `deleteUserRetention` — удаление по запросу.
- `retention.test.ts` — тесты: `bun test`. Схема в тестах — настоящие файлы из `examples/tracking` и `examples/experiments`.

Все пороги — ориентир, проверяйте на своих данных. Для Postgres и aiogram — см. врезку в главе 0.1; `SUM(EXISTS …)` → `COUNT(*) FILTER (WHERE EXISTS …)`, параметр `$experiment` → `$1`.

---

# Code for chapter 5.6

TypeScript + Bun + `bun:sqlite`. `initRetention(db, [your ids])` creates two small tables: `me` (your own and your family's accounts, one list for every query in `segments.sql`) and `billing_pending` (a queue of failed-renewal notices). Everything else uses the tables from `examples/tracking/schema.sql` (chapters 2.1–2.3), `messaging_optout` from `examples/deeplinks` (5.2) and `experiment_assignments` from `examples/experiments/schema.sql` (2.5).

The `reminder_deliveries` log from chapter 2.3 holds every message the bot sent on its own, with a `kind` field. All kinds are listed in `KINDS` (`retention.ts`) and at the top of `segments.sql`: `reminder` and `weekly_summary` are things the person asked for; `billing` concerns what they paid for (a failed subscription renewal, chapter 5.5); `reengage`, `zombie_check`, `announce` and the soft nudge from 5.2 (step `nudge_sent`) are the bot's own initiative under one shared weekly budget. Besides `kicked` and `member`, `bot_status` gets `gone`: the person is unreachable (deleted account, "chat not found").

- `segments.sql`:
  - `user_segments` assigns each person a segment: `blocked` (blocked or unreachable), `new` (14 days), `active` (acted in the last 14 days), `passive_alive` (reminders arrive, sign of life within 28 days), `zombie` (reminders arrive, no sign of life for 28 days), `dormant` (no actions and no reminders for 14 days, but got value before), `never_activated` (same, never got value); plus an `opted_out` flag;
  - `segment_counts` counts people per segment;
  - `message_budget` lists messages per person over 7 days: asked-for, `billing`, and bot-initiated against the shared budget (one a week);
  - `blocks_by_kind` is the guardrail: blocks on the day of sending or the next day, per message kind;
  - `reengage_candidates` finds dormant people whose last action was 31–180 days ago, with no opt-out, no block, no message in 30 days, and not yet in the experiment (fewer than the dormant segment);
  - `reengage_outcome` counts who came back within 14 days, opt-outs and blocks per group: B got the message, A is the holdout.
- `retention.ts`:
  - `userSegments`, `segmentCounts`, `messageBudget`, `blocksByKind`, `reengageCandidates`, `reengageOutcome` wrap the queries;
  - `mayWrite` checks: a reminder the person set always goes out unless blocked; `billing` only in the daytime; bot-initiated messages only in the daytime (`isDaytime` from 5.2), without "stop messaging me", and within the budget;
  - `reserveMessage` / `confirmMessage` / `releaseMessage` check and log in one transaction (`BEGIN IMMEDIATE`) so two processes can't both pass the budget;
  - `classifySendError` sorts send errors: `blocked` (403, blocked), `gone` (other 403s and "chat not found"), `retry` (429, `retry_after`), `other`; `recordUnreachable` writes the status;
  - `runReengageWave` sends one wave to dormant people: splits with the `assignVariant` hash from 2.5 (B gets the message, A does not), at most 25 per second, waits `retry_after` on 429; group B is written only on a final outcome, and a transient failure is retried on the next run;
  - `reengageEffect` returns the difference in return rates B − A with a Newcombe interval (`diffInterval` from 2.5);
  - `onSubscriptionUpdate` / `sendPendingBilling` handle the `subscription` update: `failed` queues a notice, `active` and `canceled` clear it; the queue goes out in the daytime outside the budget and waits at night; `deleteUserRetention` handles deletion requests.
- `retention.test.ts`: run `bun test`. The tests load the real schema files from `examples/tracking` and `examples/experiments`.

All thresholds are rules of thumb: check them against your own data. For Postgres and aiogram see the box in chapter 0.1; `SUM(EXISTS …)` becomes `COUNT(*) FILTER (WHERE EXISTS …)`, and the `$experiment` parameter becomes `$1`.
