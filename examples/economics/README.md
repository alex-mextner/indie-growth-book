# Код к главам 2.4 и 5.5

- `schema.sql` — журнал вызовов ИИ `ai_usage` (с `request_id`, `trigger`, `status`, `priced` и токенами кэша), расходы на привлечение `marketing_spend`, платежи `payments` (с `kind`: подписка, разовая покупка, счёт), а также копии таблиц `user_acquisition`, `funnel_events` и `user_activity` из `examples/tracking`.
- `economics.ts`:
  - `toUsage` — приводит поле `usage` Anthropic, OpenAI и Gemini к одному виду (поля проверены 27.09.2026);
  - `costOf`, `recordAiUsage`, `withAiUsage` — цены передаются таблицей с датой, в коде их нет; журнал пишется в `finally`, в том числе для неудачных вызовов; модель без цены пишется по самой дорогой цене из таблицы (`fallbackCost`, `priced = 0`), чтобы предохранитель её видел;
  - `userRequestsLast7d` — счётчик для недельного лимита; `dailySpendExceeded` — общий предохранитель;
  - `deleteUserEconomics` — псевдонимизация по запросу пользователя;
  - глава 5.5: `initPaymentsSchema` (миграция: `payments.expires_at`, таблица `paywall_views`), `recordStarPayment` (без дублей, `net_usd` = звёзды × `STAR_USD`, срок из `subscription_expiration_date`), `markRefunded`, `subscriptionUntil` / `hasActiveSubscription` (с запасом в сутки), `checkCheckout` (решение для `pre_checkout_query`, в том числе против второй подписки), `recordPaywallView`;
  - `maxFreeRequests`, `netRevenue`, `payerContribution`, `breakEvenPayers` (с комиссией, налогом и возвратами), `grossMargin`, `simpleLtv` и `paybackMonths` (оба — через вклад платящего и отток платящих).
- `queries.sql` — вызовы без цены, себестоимость активного за 30 дней, доля самых дорогих, стоимость по шагам воронки и по активации, CAC по каналам (с «дозреванием»), кто упёрся в лимит, расходы за сегодня, ARPPU, отток подписчиков, треугольник накопленного вклада по когортам; для главы 5.5 — `paywall_funnel_by_week` (по неделям и ценам: увидели кнопку подписки → нажали → оплатили) и `refund_share_30d`.
- `economics.test.ts` — тесты: `bun test`.

Цены и доли в тестах иллюстративные. Настоящие цены берите со страницы своего провайдера и записывайте дату в `PriceTable.version`.

Bun + `bun:sqlite`. Для Postgres и aiogram — см. врезку в главе 0.1; идентификаторы Telegram в Postgres — `BIGINT`.
