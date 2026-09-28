# 5.5. Деньги внутри Telegram {#ch-5-5}

::: skip
Если бот уже принимает звёзды, хранит `telegram_payment_charge_id` и отвечает на `/paysupport`, начинайте с раздела «Первый ценовой тест».
:::

В [главе 2.5](#ch-2-5) фальшивая дверь (fake door) показала, нажимают ли на подписку. Теперь за дверью — настоящий счёт. Как его выставить, вернуть деньги и вывести заработанное — в этой главе.

## Суть

### Звёзды или провайдер

**Цифровые товары и услуги** в ботах продаются только за звёзды (Telegram Stars), валюта `XTR`: это пункт 6.2 условий для разработчиков, подробнее — в [главе 2.4](#ch-2-4). **Физические товары и услуги** оплачивают через сторонних провайдеров, которых подключают в @BotFather: Bot Settings → Payments[^src-tg-payments-55].

Подписка на запросы к ИИ и доступ в закрытый чат — цифровые. Место в зале и встреча с мастером — физические. Консультация живого человека в чате — пограничный случай: условия отсылают к определениям Apple и Google, их и читайте[^src-tg-tos-55].

Комиссию здесь берёт провайдер, а не Telegram[^src-tg-payments-55]. Российский пример — ЮKassa: карты, ЮMoney, SberPay; с «Чеками от ЮKassa» счёт должен спросить почту или телефон и передать чек в `provider_data`[^src-yookassa-55].

### Путь одного платежа

Платёж звёздами проходит шесть шагов[^src-tg-stars-55]:

1. Бот выставляет счёт: `sendInvoice` в чат или `createInvoiceLink` ссылкой. В `prices` ровно одна позиция, токен провайдера — пустая строка.
2. Человек нажимает «Оплатить», при нехватке звёзд докупает их.
3. Боту приходит `pre_checkout_query` с суммой и вашей меткой `invoice_payload`.
4. Бот отвечает `answerPreCheckoutQuery` за 10 секунд, иначе платёж отменяется.
5. Приходит сообщение `successful_payment`.
6. Бот сохраняет `telegram_payment_charge_id` и только потом выдаёт покупку.

Ответ на шаге 4 — ещё не оплата: выдавать товар можно только после `successful_payment`[^src-tg-stars-55]. **Идентификатор платежа — единственный ключ к возврату и отмене подписки.**

Десять секунд легко потерять. `bot.start()` в grammY обрабатывает обновления по очереди: пока другой человек ждёт ответа ИИ, `pre_checkout_query` стоит в очереди. Запускайте бота через `@grammyjs/runner` — он обрабатывает обновления параллельно — или через вебхук, где долгие вызовы не держат очередь[^src-grammy-runner-55].

### Подписка

Подписку создаёт только `createInvoiceLink` с `subscription_period` = 2592000 (30 дней), цена — до 10 000 звёзд[^src-tg-botapi-55]. Обычным счётом в чат её не отправить[^src-tg-subs-55]. Каждое продление приходит тем же `successful_payment` с `is_recurring`; у первого платежа есть ещё `is_first_recurring`, а `subscription_expiration_date` — до какого момента оплачено.

Человек отменяет продление в настройках Telegram[^src-tg-subs-55]. С Bot API 10.2 (14.07.2026) бот узнаёт об этом из обновления `subscription`: `canceled`, `active` — вернул, `failed` — не хватило звёзд[^src-tg-changelog-55]. Если бот ограничил `allowed_updates` списком, добавьте туда `subscription`. Сам бот отменяет продление через `editUserStarSubscription`, оплаченный период при этом дослуживается[^src-tg-botapi-55].

### Возврат и обязанности продавца

`refundStarPayment(user_id, charge_id)` возвращает звёзды целиком и по условиям не штрафуется. За нерешённые споры бот рискует меткой SCAM и удалением[^src-tg-tos-55]. Если человек вернёт деньги через Apple или Google, Telegram спишет звёзды с вашего баланса[^src-tg-botapi-55]. Такие возвраты, в том числе по чужим картам, закладывайте в долю возвратов из [главы 2.4](#ch-2-4).

Обязательны `/paysupport` для вопросов об оплате и `/terms` с условиями, которые человек принимает до покупки. Предупредите, что поддержка Telegram по вашим покупкам не поможет[^src-tg-stars-55][^src-tg-tos-55]. Скелет условий:

```text
Что продаётся: подписка «…» — больше запросов к ИИ, чем в бесплатном тарифе.
Срок и цена: 30 дней за N звёзд; продлевается автоматически, пока вы не отмените.
Отмена: в настройках Telegram; оплаченные дни остаются.
Возврат: первый платёж — полностью, если попросите в течение 7 дней; продления — не возвращаем.
Поддержка: /paysupport, ответ в течение суток. Поддержка Telegram по этим покупкам не помогает.
```

```text
/paysupport: Напишите одним сообщением, что случилось с оплатой. Мы ответим в течение суток.
Если нужен возврат, так и напишите — за первый платёж в первые 7 дней вернём без вопросов.
```

Правило возврата здесь — наша гипотеза для ИИ-продукта: потраченные запросы стоят центы, а спор стоит бота. Долю возвратов считайте запросом `refund_share_30d`; рост выше заложенного в [главе 2.4](#ch-2-4) — сигнал разобраться.

Платные медиа, звёздные реакции каналов и подарки к подписке в боте отношения не имеют[^src-tg-blog-reactions-55].

## Мостик

### Сколько платит человек и сколько получаете вы

Сколько доходит до вас, посчитано в [главе 2.4](#ch-2-4). Человек покупает звёзды пакетами по цене, зависящей от способа, а вам засчитывают одинаково — 0,013 $ за звезду[^src-tg-tos-55].

| Пакет, звёзд | App Store / Google Play, $ | Fragment, $ | Разработчику, $ |
|---|---|---|---|
| 100 | 1,99 | 1,50 | 1,30 |
| 150 | 2,99 | 2,25 | 1,95 |
| 250 | 4,99 | 3,75 | 3,25 |
| 350 | 6,99 | 5,25 | 4,55 |
| 500 | 9,99 | 7,50 | 6,50 |

Магазины — по таблице Telegram без НДС, Fragment — цена на сайте, 28.09.2026[^src-tg-stars-55][^src-fragment-55]. На Fragment платят криптовалютой — для резидентов России см. раздел о выводе денег. **«250 звёзд» — это 3,75–4,99 $ для человека и 3,25 $ для вас.** Цену удобно ставить равной пакету, иначе у человека останется лишний остаток (ориентир).

Из 3,25 $ могут уйти ещё две доли: комиссия партнёрам (ниже) и плата за темы в личных чатах. Темы (Bot API 9.3) включают в @BotFather, и чат с ботом делится на ветки; пока они включены, Telegram удерживает 15 % каждой покупки[^src-tg-tos-55].

Для потокового ответа ИИ темы не нужны: `sendMessageDraft` с Bot API 9.5 (01.03.2026) доступен всем ботам[^src-tg-changelog-55]. В коде эта доля — `extraFeeShare`: не включали — 0.

Звёзды можно не выводить, а потратить на Telegram Ads для этого же бота: по условиям звезда там стоит 0,02 $, но стоимость может меняться[^src-tg-tos-55]. Для российской аудитории учтите позицию ФАС. Ч. 10.7 ст. 5 закона о рекламе запрещает рекламу на ресурсах с ограниченным доступом; для Telegram — переходный период до конца 2026 года[^src-fas-55]. Подробнее — в [главах 5.3](#ch-5-3) и [5.4](#ch-5-4).

::: note
Там, где звёзды недоступны по региону, клиент прячет их целиком — ни купить, ни заплатить[^src-tg-config-55]. Официальных данных о покупке звёзд из России нет. Обзор vc.ru от 23.07.2026 называет боты-перепродавцы с оплатой через СБП, маркетплейсы и магазины приложений, где российские карты работают нестабильно[^src-vc-stars-55]. Попросите двух-трёх людей из аудитории купить самый маленький пакет и рассказать, как вышло.
:::

### Код: от кнопки до строки в payments

Код — на TypeScript и Bun, для Python — врезка в [главе 0.1](#ch-0-1). Сначала запуск:

```typescript
const bot = new Bot(token);                            // тестовая среда: new Bot(token, { client: { environment: "test" } })
db.exec(readFileSync("examples/economics/schema.sql", "utf8")); // таблицы главы 2.4, если их ещё нет
initPaymentsSchema(db);                                // expires_at в payments и таблица paywall_views
bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));   // порядок внутри чата сохраняется
bot.catch((err) => console.error("bot:", err.error));
// ...обработчики ниже...
run(bot);                                              // вместо bot.start(): обновления параллельно
```

Наш календарный бот в [главе 2.5](#ch-2-5) показывал упёршемуся в лимит кнопку «Больше запросов по подписке». Теперь за ней — счёт, для начала на 250 звёзд, гипотеза из [главы 2.4](#ch-2-4):

```typescript
const PRICE = { A: 250, B: 150 } as const;             // звёзд; 250 — гипотеза из главы 2.4
const PRICES = new Set([250, 150]);                    // все цены, которые когда-либо были в ссылках
const TEST_START = "2026-10-05";                       // понедельник
const today = () => new Date().toISOString().slice(0, 10);
const priceNow = () => today() < TEST_START             // до старта variantByWeek бросает ошибку
  ? PRICE.A : PRICE[variantByWeek(TEST_START, today(), "A")]; // потом — "ABBA"

async function showPaywall(ctx: Context) {              // экран фальшивой двери из главы 2.5, теперь с ценой
  const stars = priceNow();
  recordPaywallView(db, ctx.from!.id, stars, "seen");
  await ctx.reply(`Лимит на сегодня исчерпан. Подписка — ${stars} звёзд за 30 дней.`, {
    reply_markup: new InlineKeyboard().text("Больше запросов по подписке", "paywall") });
}
bot.command("subscribe", showPaywall);

bot.callbackQuery("paywall", async (ctx) => {
  await ctx.answerCallbackQuery();
  const until = subscriptionUntil(db, ctx.from.id);
  if (until) return ctx.reply(`Подписка уже активна до ${until.slice(0, 10)}.`);
  const stars = priceNow();
  recordPaywallView(db, ctx.from.id, stars, "clicked");
  const link = await ctx.api.createInvoiceLink(
    "Подписка на 30 дней", "Больше запросов к ИИ, чем в бесплатном тарифе",
    `sub_${stars}`, "", "XTR", [{ label: "30 дней", amount: stars }],
    { subscription_period: 2592000 });
  await ctx.reply(`Подписка — ${stars} звёзд за 30 дней, продлевается сама, ` +
    "отменить можно в любой момент. Оплачивая, вы принимаете условия: /terms", {
    reply_markup: new InlineKeyboard().url(`Оформить за ${stars} звёзд`, link) });
});

bot.on("pre_checkout_query", (ctx) => {                // ответить за 10 секунд
  const r = checkCheckout(db, ctx.from.id, ctx.preCheckoutQuery, PRICES);
  return r.ok ? ctx.answerPreCheckoutQuery(true) : ctx.answerPreCheckoutQuery(false, r.error);
});

bot.on("message:successful_payment", async (ctx) => {
  const p = ctx.message.successful_payment;
  try {
    recordStarPayment(db, ctx.from.id, p);             // charge_id — для возврата
  } catch (e) {
    appendFileSync("payments-fallback.jsonl", JSON.stringify({ user: ctx.from.id, p }) + "\n");
    await ctx.api.sendMessage(OWNER, `Платёж не записан: ${ctx.from.id} ${p.telegram_payment_charge_id}`);
    return ctx.reply("Платёж получен, доступ включим в течение часа. Вопросы — /paysupport.");
  }
  if (!p.is_recurring || p.is_first_recurring) {       // за продления не благодарим
    await ctx.reply("Подписка работает. Вопросы по оплате — /paysupport.");
  }
});
```

Второй счёт подписчику кнопка не выставит, а старую ссылку отклонит `checkCheckout` — если подписка оплачена больше чем на сутки вперёд. Проходит ли продление через `pre_checkout_query`, документация не говорит, поэтому в `PRICES` остаются все когда-либо выданные цены.

Упавшая запись уходит в запасной файл, charge_id — владельцу. Проверка лимита из [главы 2.4](#ch-2-4) пропускает подписчиков:

```typescript
bot.on("message:text", async (ctx, next) => {
  if (dailyLimitReached(ctx.from.id) && !hasActiveSubscription(db, ctx.from.id)) return showPaywall(ctx);
  await next();
});
```

`hasActiveSubscription` смотрит `expires_at` с запасом в сутки на опоздавшее продление. Возврат и статусы подписки:

```typescript
bot.command("refund", async (ctx) => {                 // /refund <user_id> <charge_id>, только владелец
  if (ctx.from?.id !== OWNER) return;
  const [userId, chargeId] = ctx.match.trim().split(/\s+/);
  if (!userId || !chargeId) return ctx.reply("Формат: /refund <user_id> <charge_id>");
  const uid = Number(userId);
  const row = db.query("SELECT kind FROM payments WHERE charge_id = ?").get(chargeId) as { kind: string } | null;
  const why = (e: unknown) => (e instanceof GrammyError ? e.description : String(e));
  if (row?.kind === "subscription") {
    try {
      await ctx.api.editUserStarSubscription(uid, chargeId, true);   // сначала — продление
    } catch (e) {                                      // уже отменённая — не ошибка; текст проверьте на своём боте
      if (!(e instanceof GrammyError && /cancel/i.test(e.description))) {
        return ctx.reply(`Продление не отменено, возврата не было: ${why(e)}`);
      }
    }
  }
  try {
    await ctx.api.refundStarPayment(uid, chargeId);
  } catch (e) {
    return ctx.reply(`Возврат не прошёл: ${why(e)}`);
  }
  markRefunded(db, chargeId);                          // refunded_payment отметит ещё раз — это безопасно
  await ctx.reply("Продление отменено, звёзды возвращены.");
});

bot.on("message:refunded_payment", (ctx) => {
  markRefunded(db, ctx.message.refunded_payment.telegram_payment_charge_id);
});

bot.on("subscription", (ctx) => {                     // Bot API 10.2: canceled | active | failed
  const s = ctx.update.subscription;
  console.log("subscription", s.user.id, s.invoice_payload, s.state);
});
```

Для подписки сначала отменяется продление — уже отменённое ошибкой не считается, — потом возврат, и сразу `markRefunded`. Сообщение `refunded_payment` отметит возврат ещё раз, функция это переносит. Примет ли метод charge_id продления, мы не проверили ([глава 5.8](#ch-5-8)).

После `/deletedata` у платежей id 0, и вернуть звёзды уже нельзя — [глава 5.8](#ch-5-8) предупреждает об этом до удаления. Ответ на `failed` — в [главе 5.6](#ch-5-6), код и тесты — в `examples/economics`[^src-examples-econ-55].

### Что записывать

`payments` из [главы 2.4](#ch-2-4) теперь хранит и `expires_at`; повторно доставленное обновление строку не дублирует. Комиссию партнёрам и возвраты через магазины видно только в `getStarTransactions`: id транзакции совпадает с `charge_id`, у платежа есть поле `affiliate`[^src-tg-botapi-55]. Раз в месяц сверяйте `payments` с этой выпиской.

### Первый ценовой тест

Фальшивая дверь меряла намерение, настоящая — поступок. Шаги `funnel_events` пишутся раз на человека и без цены, поэтому показы и нажатия с ценой идут в `paywall_views`. Старые `fake_door_*` оставьте для сравнения.

Запрос `paywall_funnel_by_week` считает по неделям и ценам увидевших, нажавших и оплативших за 7 дней, без ваших аккаунтов из списка `me` ([глава 2.3](#ch-2-3)). Интервал Уилсона даёт функция `wilson` из `examples/experiments`.

Правило — до старта, как в [главе 2.5](#ch-2-5). Цель — нижняя граница доли оплативших выше 2 % (ориентир; сверьте с безубыточностью из [главы 2.4](#ch-2-4)).

| Увидели кнопку | Цена остаётся | Пробуем 150 звёзд | Иначе |
|---|---|---|---|
| 80 | от 5 оплат | 0–1 оплата (точечная оценка ниже 2 %) | ждём 160 |
| 160 | от 7 оплат | до 6 оплат | — |

Не набралось 80 человек за 4 недели — считайте результат качественным сигналом и спросите каждого нажавшего, почему он не заплатил.

Две цены одновременно разным людям не показывайте: в маленьком сообществе это заметят. Для 150 звёзд включите чередование недель A, B, B, A из [главы 2.5](#ch-2-5) (`variantByWeek`) и копите по 80 увидевших на цену. Сравнивайте выручку на увидевшего: доля оплативших × цена.

::: case
Допустим, 80 человек увидели кнопку, 9 нажали и 3 заплатили: 3,75 %, интервал Уилсона — от 1,3 % до 10,5 %. Ни одна строка таблицы не сработала: цену не трогаем и ждём 160. Цифры — иллюстрация.
:::

### Партнёрская программа Telegram

Если мини-приложения у бота нет — раздел пропустите. Бот с мини-приложением может открыть партнёрскую программу (affiliate program). Партнёр получает ссылку `?start=_tgr_…` ([глава 5.2](#ch-5-2)) и долю звёздных покупок тех, кто впервые открыл мини-приложение по ней[^src-tg-referrals-55]. Комиссия вычитается из ваших звёзд[^src-tg-affiliate-tos-55].

Ставка — в промилле; в примере конфигурации от 1 до 800, фактические границы задаёт сервер[^src-tg-config-55]. Ставку и срок можно только повышать. Закрытие программы занимает около суток и отключает ссылки, а старые партнёры получают своё до конца срока[^src-tg-referrals-55][^src-tg-affiliate-tos-55]. **Начинайте с низкой ставки: поднять легко, опустить нельзя.**

### Как вывести деньги: Fragment, Gram и налоги

Звёзды доступны не сразу, до 21 дня ([глава 2.4](#ch-2-4)), и сгорают через три года[^src-tg-tos-55]. Вывод идёт через Fragment в криптовалюте сети TON, с 15.06.2026 она называется Gram[^src-gram-55][^src-tg-api-stars-55]. Минимум в примере конфигурации — 1 000 звёзд[^src-tg-config-55]. Fragment работает не во всех странах[^src-tg-tos-55].

Для налоговых резидентов России на 28.09.2026 проверено вот что. С 01.07.2027 резиденты вправе совершать сделки с цифровой валютой только через лиц, организующих её обращение (ч. 1 ст. 30 закона 282-ФЗ). Содействовать нарушениям, в том числе информировать о способах таких сделок, запрещено уже с 01.09.2026 (ч. 2)[^src-282fz-55]. С 01.07.2027 получение Gram на собственный кошелёк может оказаться для резидента незаконным — это вопрос к юристу.

Доход от источника за рубежом резидент декларирует сам: 3-НДФЛ до 30 апреля, 13 % с суммы до 2,4 млн ₽ за год[^src-nk-55]. Самозанятость (НПД) недоступна при продаже или приобретении цифровой валюты и не покрывает доход в натуральной форме[^src-npd-55]. По нашему прочтению (не консультация), выплата в Gram подпадает под одно из двух, так что рассчитывайте на НДФЛ, пока бухгалтер не скажет иное.

Это меняет [главу 2.4](#ch-2-4). При НДФЛ 13 % и возвратах 2 % вклад подписчика — 5 × 0,65 × 0,85 − 1 ≈ 1,76 $ в месяц вместо 1,99 $. Пожизненная ценность клиента (LTV) падает так же. Записывайте каждый вывод: дату, звёзды, сумму в Gram и курс в рублях.

::: note
Это не налоговая и не юридическая консультация. Мы описали текст законов на дату проверки, а не то, как их применят к вам; в другой стране правила свои. До первого вывода покажите схему юристу и бухгалтеру, которые работают с доходами из-за рубежа и криптовалютой. Спросите и о том, не рискованно ли само описание криптовалютных способов оплаты для вашей аудитории.
:::

::: warning
Частые ошибки с платежами:

- Долгий обработчик держит очередь, и `pre_checkout_query` не получает ответа за 10 секунд. Нужны параллельная обработка и быстрая проверка в самом обработчике.
- Выдача покупки после `pre_checkout_query`, а не после `successful_payment`.
- `charge_id` не сохранён — ни вернуть деньги, ни отменить подписку.
- Вторая подписка поверх действующей: кнопка и `pre_checkout_query` не проверяют срок.
- Возврат подписки без отмены продления.
- Нет `/paysupport` и `/terms`, или условия показаны после оплаты.
- Удаление строк `payments` по `/deletedata` вместо замены id на 0 ([глава 5.8](#ch-5-8)).
- Цифровая услуга оплачивается через провайдера карт.
:::

## Шаг

::: step
Сегодня вечером — один настоящий платёж в тестовой среде Telegram[^src-tg-testenv-55]:

1. Загрузите в базу бота `examples/economics/schema.sql` — таблицы [главы 2.4](#ch-2-4): без `payments` `initPaymentsSchema` упадёт.
2. Заведите тестовый аккаунт: в клиенте войдите на тестовый сервер (в Telegram Desktop — Shift + Alt + правый клик по «Добавить аккаунт»). Там же создайте бота у тестового @BotFather.
3. Запустите бота с `new Bot(token, { client: { environment: "test" } })`, добавьте `/terms`, `/paysupport` и обработчики обоих блоков кода.
4. Замените ответ фальшивой двери из [главы 2.5](#ch-2-5) счётом. Двери нет — хватит команды `/subscribe` из кода.
5. Оплатите подписку с тестового аккаунта и верните платёж командой `/refund`.

**Сделано**, когда в `payments` есть строка с `charge_id`, `amount` = 250, `expires_at` и `refunded_at`, а бот ответил на `/paysupport`. Потом перенесите код в рабочего бота и запишите правило решения по цене.
:::

**Повтор.** Тест цены — здесь, упаковка подписки — в [главе 4.2](#ch-4-2), тарифы — в [главе 4.5](#ch-4-5). Строки `payments` наполнят треугольник LTV из [главы 2.4](#ch-2-4) и лист экономики в [главе 4.6](#ch-4-6). Звёзды на рекламу вернутся в [главе 5.4](#ch-5-4), обновление `failed` — в [главе 5.6](#ch-5-6).

[^src-tg-payments-55]: Telegram, «Bot Payments API for Physical Goods and Services»: Bot Settings → Payments; «does not charge any commission». core.telegram.org/bots/payments (проверено 28.09.2026).
[^src-yookassa-55]: ЮKassa, «Настройка платежей через Telegram-ботов». yookassa.ru/docs/support/payments/onboarding/integration/cms-module/telegram (проверено 28.09.2026).
[^src-tg-stars-55]: Telegram, «Bot Payments API for Digital Goods and Services»: pre-checkout «within 10 seconds», выдача после `successful_payment`, Live Checklist, таблица «Star Pricing». core.telegram.org/bots/payments-stars (проверено 28.09.2026).
[^src-grammy-runner-55]: grammY, «Concurrency With grammY runner». grammy.dev/plugins/runner (проверено 28.09.2026).
[^src-tg-botapi-55]: Telegram Bot API 10.3: `createInvoiceLink`, `SuccessfulPayment`, `editUserStarSubscription`, `StarTransaction`, `TransactionPartnerUser`. core.telegram.org/bots/api (проверено 28.09.2026).
[^src-tg-subs-55]: Telegram, «Subscriptions», раздел «Bot subscriptions». core.telegram.org/api/subscriptions (проверено 28.09.2026).
[^src-tg-changelog-55]: Telegram, «Bot API changelog»: 9.3 (31.12.2025) — темы в личных чатах; 9.5 (01.03.2026) — «Allowed all bots to use the method sendMessageDraft»; 10.2 (14.07.2026) — `BotSubscriptionUpdated`. core.telegram.org/bots/api-changelog (проверено 28.09.2026).
[^src-tg-tos-55]: Telegram, «Bot Platform Developer Terms of Service», п. 6.1, 6.2 (определения Apple и Google), 6.2.1 (возврат «with no penalty», SCAM), 6.2.3 (0,02 $, «this value may fluctuate»), 6.2.4 (0,013 $, до 21 дня), 6.2.4.1, 6.2.6 (15 %), 6.2.7 (три года). telegram.org/tos/bot-developers (проверено 28.09.2026).
[^src-tg-blog-reactions-55]: Telegram, «Super Channels, Star Reactions and Subscriptions», 14.08.2024. telegram.org/blog/superchannels-star-reactions-subscriptions (проверено 28.09.2026).
[^src-fragment-55]: Fragment, «Buy Telegram Stars». fragment.com/stars/buy (проверено 28.09.2026).
[^src-fas-55]: ФАС России, «Разъяснения ФАС России в части контроля законодательства о рекламе», 25.03.2026. base.garant.ru/413952580/ (проверено 28.09.2026).
[^src-tg-config-55]: Telegram, «Client configuration»: `stars_purchase_blocked` — иначе «all Star-related UI options should be hidden»; в примере `stars_revenue_withdrawal_min` = 1000, `starref_min/max_commission_permille` = 1 / 800. core.telegram.org/api/config (проверено 28.09.2026).
[^src-vc-stars-55]: vc.ru, «Как купить звезды Телеграм в России: 4 рабочих способа», 23.07.2026 — обзор, не данные Telegram. vc.ru/money/3043269-kak-kupit-zvezdy-v-telegram-v-rossii (проверено 28.09.2026).
[^src-examples-econ-55]: github.com/alex-mextner/indie-growth-book, папка `examples/economics`: функции главы 5.5, запросы `paywall_funnel_by_week`, `refund_share_30d` и тесты.
[^src-tg-referrals-55]: Telegram, «Affiliate programs». core.telegram.org/api/bots/referrals (проверено 28.09.2026).
[^src-tg-affiliate-tos-55]: Telegram, «Terms of Service for Affiliate Programs», п. 2.1. telegram.org/tos/affiliate-program (проверено 28.09.2026).
[^src-gram-55]: TON, t.me/gram/2385, 10.06.2026: «Native Token Rename: Toncoin (TON) to Gram (GRAM)» с 12:00 UTC 15.06.2026 (проверено 28.09.2026).
[^src-tg-api-stars-55]: Telegram, «Telegram Stars», раздел «Withdrawing revenue». core.telegram.org/api/stars (проверено 28.09.2026).
[^src-282fz-55]: Федеральный закон от 04.08.2026 № 282-ФЗ «О цифровых валютах и цифровых правах»: ст. 30 ч. 1–2; ст. 56 ч. 1–2 (закон — с 01.09.2026, ч. 1 ст. 30 — с 01.07.2027). consultant.ru/document/cons_doc_LAW_540983/ (проверено 28.09.2026).
[^src-nk-55]: Налоговый кодекс РФ, ред. от 04.08.2026: ст. 228 п. 1 пп. 3, ст. 229 п. 1, ст. 224 п. 1. consultant.ru/document/cons_doc_LAW_28165/ (проверено 28.09.2026).
[^src-npd-55]: Федеральный закон № 422-ФЗ, ред. от 04.08.2026: ст. 4 ч. 2 п. 9, ст. 6 ч. 2 п. 11. consultant.ru/document/cons_doc_LAW_311977/ (проверено 28.09.2026).
[^src-tg-testenv-55]: Telegram, «Bot Features», «Dedicated test environment». core.telegram.org/bots/features#dedicated-test-environment (проверено 28.09.2026).
