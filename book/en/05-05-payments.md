# 5.5. Money Inside Telegram {#ch-5-5}

::: skip
If your bot already accepts Stars, stores `telegram_payment_charge_id` and answers `/paysupport`, start at "The first price test."
:::

In [chapter 2.5](#ch-2-5), a fake door showed whether people tap the subscription button. Now there's a real invoice behind the door. This chapter covers how to send one, refund it and withdraw what you earn.

## The gist

### Stars or a provider

**Digital goods and services** in bots can be sold only for Telegram Stars, currency code `XTR`. That's section 6.2 of the developer terms; [chapter 2.4](#ch-2-4) has more. **Physical goods and services** are paid for through third-party providers, which you connect in @BotFather: Bot Settings → Payments[^src-tg-payments-55].

A subscription to AI requests and access to a private chat are digital. A spot at a venue and a session with a specialist are physical. A consultation with a live person in the chat is a borderline case: the terms refer to Apple's and Google's definitions, so read those[^src-tg-tos-55].

With a provider, the provider takes the fee; Telegram takes none[^src-tg-payments-55]. A Russian example is YooKassa: cards, YooMoney, SberPay. With "Receipts from YooKassa," the invoice must ask for an email or phone number and pass the receipt in `provider_data`[^src-yookassa-55].

### The path of one payment

A payment in Stars goes through six steps[^src-tg-stars-55]:

1. The bot sends an invoice: `sendInvoice` into the chat or `createInvoiceLink` as a link. `prices` holds exactly one item, and the provider token is an empty string.
2. The person taps "Pay" and, if they're short of Stars, buys more.
3. The bot receives a `pre_checkout_query` with the amount and your own `invoice_payload` string.
4. The bot answers with `answerPreCheckoutQuery` within 10 seconds, or the payment is canceled.
5. A `successful_payment` message arrives.
6. The bot saves `telegram_payment_charge_id` and only then delivers the purchase.

The answer in step 4 doesn't mean the money has arrived: deliver the goods only after `successful_payment`[^src-tg-stars-55]. **The payment ID is the only key to a refund or to canceling a subscription.**

It's easy to miss the ten-second window. In grammY, `bot.start()` handles updates one at a time: while another person waits for an AI reply, the `pre_checkout_query` waits in line. Run the bot with `@grammyjs/runner`, which handles updates concurrently, or behind a webhook, where long calls don't hold up the queue[^src-grammy-runner-55].

### Subscriptions

Only `createInvoiceLink` with `subscription_period` = 2592000 (30 days) creates a subscription, at up to 10,000 Stars[^src-tg-botapi-55]. You can't send one as a regular invoice in the chat[^src-tg-subs-55]. Every renewal arrives as the same `successful_payment` with `is_recurring`. The first payment also carries `is_first_recurring`, and `subscription_expiration_date` shows when the paid period ends.

People cancel renewal in Telegram's settings, and since Bot API 10.2 (July 14, 2026), a `subscription` update notifies the bot[^src-tg-subs-55][^src-tg-changelog-55]. Its states are `canceled`, `active` if the person turned renewal back on, and `failed` if they ran out of Stars. If your bot limits `allowed_updates` to a list, add `subscription` to it. The bot itself cancels renewal with `editUserStarSubscription`, and the paid period runs to its end[^src-tg-botapi-55].

### Refunds and seller duties

`refundStarPayment(user_id, charge_id)` returns the Stars in full, and the terms impose no penalty for it. Unresolved disputes put the bot at risk of a SCAM label and removal[^src-tg-tos-55]. If a person gets their money back through Apple or Google, Telegram deducts the Stars from your balance[^src-tg-botapi-55]. Build these refunds, including purchases made with someone else's card, into the refund share from [chapter 2.4](#ch-2-4).

You must have `/paysupport` for payment questions and `/terms` with conditions the person accepts before buying. Warn people that Telegram support can't help with purchases in your bot[^src-tg-stars-55][^src-tg-tos-55]. Here's an outline of the terms:

```text
What's sold: the "…" subscription, with more AI requests than the free tier.
Term and price: 30 days for N Stars; renews automatically until you cancel.
Canceling: in Telegram settings; you keep the days you've paid for.
Refunds: the first payment in full if you ask within 7 days; renewals aren't refunded.
Support: /paysupport, reply within 24 hours. Telegram support can't help with these purchases.
```

```text
/paysupport: Tell us in one message what went wrong with your payment. We'll reply within 24 hours.
If you want a refund, just say so: a first payment within the first 7 days is refunded, no questions asked.
```

The refund rule here is our hypothesis for an AI product: used requests cost cents, while a dispute can cost you the bot. Track the refund share with the `refund_share_30d` query. If it climbs above what you budgeted in [chapter 2.4](#ch-2-4), find out why.

Paid media, Star reactions in channels and subscription gifts don't apply to bots[^src-tg-blog-reactions-55].

## The bridge

### What the person pays and what you get

[Chapter 2.4](#ch-2-4) worked out how much reaches you. People buy Stars in packs, at a price that depends on how they pay, but you're credited the same $0.013 per Star[^src-tg-tos-55].

| Pack, Stars | App Store / Google Play, $ | Fragment, $ | To the developer, $ |
|---|---|---|---|
| 100 | 1.99 | 1.50 | 1.30 |
| 150 | 2.99 | 2.25 | 1.95 |
| 250 | 4.99 | 3.75 | 3.25 |
| 350 | 6.99 | 5.25 | 4.55 |
| 500 | 9.99 | 7.50 | 6.50 |

App store prices come from Telegram's table, excluding VAT; Fragment prices come from its website; both as of September 28, 2026[^src-tg-stars-55][^src-fragment-55]. Fragment takes payment in cryptocurrency; for Russian residents, see the section on withdrawing money. **"250 Stars" means $3.75–4.99 for the buyer and $3.25 for you.** Set your price to match a pack, or the buyer is left with a leftover balance (rule of thumb).

Two more cuts can come out of that $3.25: affiliate commission (see below) and the fee for topics in private chats. Topics (Bot API 9.3) are switched on in @BotFather and split the chat with the bot into threads. While they're on, Telegram keeps 15% of each purchase[^src-tg-tos-55].

You don't need topics to stream an AI reply: since Bot API 9.5 (March 1, 2026), `sendMessageDraft` is available to all bots[^src-tg-changelog-55]. In the code this share is `extraFeeShare`; if you haven't turned topics on, it's 0.

Instead of withdrawing Stars, you can spend them on Telegram Ads for the same bot. Under the terms, a Star is worth $0.02 there, but that value may fluctuate[^src-tg-tos-55].

For a Russian audience, keep in mind the position of FAS, Russia's competition regulator. Part 10.7 of Article 5 of the Advertising Law bans ads on resources with restricted access. For Telegram, a grace period runs until the end of 2026[^src-fas-55]. There's more in [chapters 5.3](#ch-5-3) and [5.4](#ch-5-4).

::: note
Where Stars aren't available in a region, the client hides them entirely: people can neither buy them nor pay with them[^src-tg-config-55]. There's no official data on buying Stars from Russia. A vc.ru overview (July 23, 2026) names reseller bots that take Russia's SBP instant bank transfers, marketplaces and app stores, where Russian cards work unreliably[^src-vc-stars-55]. Ask two or three people from your audience to buy the smallest pack and tell you how it went.
:::

### Code: from the button to a row in payments

The code is TypeScript on Bun; for Python, see the note in [chapter 0.1](#ch-0-1). First, the startup code:

```typescript
const bot = new Bot(token);                            // test environment: new Bot(token, { client: { environment: "test" } })
db.exec(readFileSync("examples/economics/schema.sql", "utf8")); // chapter 2.4 tables, if they don't exist yet
initPaymentsSchema(db);                                // expires_at in payments and the paywall_views table
bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));   // order within a chat is preserved
bot.catch((err) => console.error("bot:", err.error));
// ...handlers below...
run(bot);                                              // instead of bot.start(): updates in parallel
```

In [chapter 2.5](#ch-2-5), our calendar bot showed people who hit the limit a "More requests with a subscription" button. Now there's an invoice behind it, starting at 250 Stars, the hypothesis from [chapter 2.4](#ch-2-4):

```typescript
const PRICE = { A: 250, B: 150 } as const;             // Stars; 250 is the hypothesis from chapter 2.4
const PRICES = new Set([250, 150]);                    // every price that has ever appeared in links
const TEST_START = "2026-10-05";                       // a Monday
const today = () => new Date().toISOString().slice(0, 10);
const priceNow = () => today() < TEST_START             // before the start, variantByWeek throws
  ? PRICE.A : PRICE[variantByWeek(TEST_START, today(), "A")]; // after that, "ABBA"

async function showPaywall(ctx: Context) {              // the fake-door screen from chapter 2.5, now with a price
  const stars = priceNow();
  recordPaywallView(db, ctx.from!.id, stars, "seen");
  await ctx.reply(`You've used today's limit. Subscription: ${stars} Stars for 30 days.`, {
    reply_markup: new InlineKeyboard().text("More requests with a subscription", "paywall") });
}
bot.command("subscribe", showPaywall);

bot.callbackQuery("paywall", async (ctx) => {
  await ctx.answerCallbackQuery();
  const until = subscriptionUntil(db, ctx.from.id);
  if (until) return ctx.reply(`Your subscription is already active until ${until.slice(0, 10)}.`);
  const stars = priceNow();
  recordPaywallView(db, ctx.from.id, stars, "clicked");
  const link = await ctx.api.createInvoiceLink(
    "30-day subscription", "More AI requests than the free tier",
    `sub_${stars}`, "", "XTR", [{ label: "30 days", amount: stars }],
    { subscription_period: 2592000 });
  await ctx.reply(`Subscription: ${stars} Stars for 30 days. It renews automatically, ` +
    "and you can cancel anytime. By paying, you accept the terms: /terms", {
    reply_markup: new InlineKeyboard().url(`Subscribe for ${stars} Stars`, link) });
});

bot.on("pre_checkout_query", (ctx) => {                // answer within 10 seconds
  const r = checkCheckout(db, ctx.from.id, ctx.preCheckoutQuery, PRICES);
  return r.ok ? ctx.answerPreCheckoutQuery(true) : ctx.answerPreCheckoutQuery(false, r.error);
});

bot.on("message:successful_payment", async (ctx) => {
  const p = ctx.message.successful_payment;
  try {
    recordStarPayment(db, ctx.from.id, p);             // charge_id is needed for refunds
  } catch (e) {
    appendFileSync("payments-fallback.jsonl", JSON.stringify({ user: ctx.from.id, p }) + "\n");
    await ctx.api.sendMessage(OWNER, `Payment not recorded: ${ctx.from.id} ${p.telegram_payment_charge_id}`);
    return ctx.reply("Payment received; we'll turn on access within an hour. Questions: /paysupport.");
  }
  if (!p.is_recurring || p.is_first_recurring) {       // no thank-you for renewals
    await ctx.reply("Your subscription is active. Payment questions: /paysupport.");
  }
});
```

The button won't send a subscriber a second invoice, and `checkCheckout` rejects an old link if the subscription is paid more than a day ahead. The documentation doesn't say whether renewals go through `pre_checkout_query`, so `PRICES` keeps every price ever issued.

A failed write goes to a fallback file, and the charge_id goes to the owner. The limit check from [chapter 2.4](#ch-2-4) lets subscribers through:

```typescript
bot.on("message:text", async (ctx, next) => {
  if (dailyLimitReached(ctx.from.id) && !hasActiveSubscription(db, ctx.from.id)) return showPaywall(ctx);
  await next();
});
```

`hasActiveSubscription` checks `expires_at` with a one-day margin for a late renewal. Refunds and subscription states:

```typescript
bot.command("refund", async (ctx) => {                 // /refund <user_id> <charge_id>, owner only
  if (ctx.from?.id !== OWNER) return;
  const [userId, chargeId] = ctx.match.trim().split(/\s+/);
  if (!userId || !chargeId) return ctx.reply("Format: /refund <user_id> <charge_id>");
  const uid = Number(userId);
  const row = db.query("SELECT kind FROM payments WHERE charge_id = ?").get(chargeId) as { kind: string } | null;
  const why = (e: unknown) => (e instanceof GrammyError ? e.description : String(e));
  if (row?.kind === "subscription") {
    try {
      await ctx.api.editUserStarSubscription(uid, chargeId, true);   // renewal first
    } catch (e) {                                      // already canceled isn't an error; check the text on your own bot
      if (!(e instanceof GrammyError && /cancel/i.test(e.description))) {
        return ctx.reply(`Renewal not canceled, no refund made: ${why(e)}`);
      }
    }
  }
  try {
    await ctx.api.refundStarPayment(uid, chargeId);
  } catch (e) {
    return ctx.reply(`Refund failed: ${why(e)}`);
  }
  markRefunded(db, chargeId);                          // refunded_payment marks it again, which is safe
  await ctx.reply("Renewal canceled, Stars refunded.");
});

bot.on("message:refunded_payment", (ctx) => {
  markRefunded(db, ctx.message.refunded_payment.telegram_payment_charge_id);
});

bot.on("subscription", (ctx) => {                     // Bot API 10.2: canceled | active | failed
  const s = ctx.update.subscription;
  console.log("subscription", s.user.id, s.invoice_payload, s.state);
});
```

For a subscription, renewal is canceled first (one that's already canceled doesn't count as an error), then comes the refund and, right away, `markRefunded`. The `refunded_payment` message marks the refund a second time, and the function handles that. We haven't checked whether the method accepts a renewal's charge_id ([chapter 5.8](#ch-5-8)).

After `/deletedata`, payments carry id 0, and the Stars can no longer be refunded; [chapter 5.8](#ch-5-8) warns about this before deletion. What to do on `failed` is covered in [chapter 5.6](#ch-5-6), and the code and tests are in `examples/economics`[^src-examples-econ-55].

### What to record

The `payments` table from [chapter 2.4](#ch-2-4) now stores `expires_at` too, and a redelivered update doesn't duplicate the row. Affiliate commissions and refunds through app stores show up only in `getStarTransactions`: the transaction id matches `charge_id`, and a payment has an `affiliate` field[^src-tg-botapi-55]. Once a month, reconcile `payments` with this statement.

### The first price test

The fake door measured intent; the real one measures action. `funnel_events` steps are written once per person and without a price, so views and taps with a price go into `paywall_views`. Keep the old `fake_door_*` steps for comparison.

The `paywall_funnel_by_week` query counts, by week and price, who saw the button, who tapped and who paid within 7 days. It leaves out your own accounts from the `me` list ([chapter 2.3](#ch-2-3)). The `wilson` function from `examples/experiments` gives the Wilson interval.

Set the decision rule before you start, as in [chapter 2.5](#ch-2-5). The goal is a lower bound of the payer share above 2% (rule of thumb; check it against break-even from [chapter 2.4](#ch-2-4)).

| Saw the button | Price stays | Try 150 Stars | Otherwise |
|---|---|---|---|
| 80 | 5 or more payments | 0–1 payments (point estimate below 2%) | wait for 160 |
| 160 | 7 or more payments | up to 6 payments | — |

If fewer than 80 people see the button in 4 weeks, treat the result as a qualitative signal. Ask everyone who tapped but didn't pay why.

Don't show two prices to different people at the same time: in a small community, someone will notice. To test 150 Stars, switch on the A, B, B, A week rotation from [chapter 2.5](#ch-2-5) (`variantByWeek`) and collect 80 viewers per price. Compare revenue per viewer: share of payers × price.

::: case
Suppose 80 people saw the button, 9 tapped and 3 paid: 3.75%, with a Wilson interval of 1.3% to 10.5%. Neither threshold is met, so the price stays for now and we wait for 160. The numbers are an illustration.
:::

### Telegram's affiliate program

If your bot has no mini app, skip this section. A bot with a mini app can run an affiliate program. An affiliate gets a `?start=_tgr_…` link ([chapter 5.2](#ch-5-2)) and a share of Stars purchases by people who first opened the mini app through it[^src-tg-referrals-55]. The commission comes out of your Stars[^src-tg-affiliate-tos-55].

The rate is set in per mille: the sample configuration allows 1 to 800, and the server sets the actual limits[^src-tg-config-55]. Once set, the rate and the duration can only be raised. Closing the program takes about a day and disables the links, while existing affiliates keep earning until their term ends[^src-tg-referrals-55][^src-tg-affiliate-tos-55]. **Start with a low rate: raising it is easy, lowering it is impossible.**

### Withdrawing money: Fragment, Gram and taxes

Stars become available for withdrawal after up to 21 days ([chapter 2.4](#ch-2-4)), and they expire after three years[^src-tg-tos-55]. Withdrawals go through Fragment in the TON network's cryptocurrency, which has been called Gram since June 15, 2026[^src-gram-55][^src-tg-api-stars-55]. The minimum in the sample configuration is 1,000 Stars[^src-tg-config-55]. Fragment doesn't work in every country[^src-tg-tos-55].

If you're a Russian tax resident, here's what we found as of September 28, 2026. From July 1, 2027, residents may deal in digital currency only through intermediaries that the law calls "circulation organizers" (Law 282-FZ, Article 30, Part 1). Assisting violations, including informing people about ways to make such transactions, has been prohibited since September 1, 2026 (Part 2)[^src-282fz-55]. From July 1, 2027, receiving Gram into your own wallet may become unlawful for a resident; that's a question for a lawyer.

Residents declare foreign-source income themselves, on a 3-NDFL return due April 30. Personal income tax (NDFL) is 13% on up to 2.4 million rubles a year[^src-nk-55]. The self-employed regime (NPD) isn't available for selling or acquiring digital currency and doesn't cover income in kind[^src-npd-55]. By our reading (not advice), a Gram payout falls under one of the two, so plan on personal income tax until an accountant says otherwise.

This changes the math in [chapter 2.4](#ch-2-4). With 13% income tax and 2% refunds, a subscriber contributes 5 × 0.65 × 0.85 − 1 ≈ $1.76 a month, not $1.99. Lifetime value (LTV) drops accordingly. Record every withdrawal: the date, the Stars, the amount in Gram and the ruble exchange rate.

::: note
This isn't tax or legal advice: we described the text of the laws as of the date we checked, not how they'll apply to you. Readers in other countries have their own rules and should ask an accountant how crypto payouts are treated. Before your first withdrawal, show your setup to a lawyer and an accountant who handle foreign income and cryptocurrency. Also ask whether describing crypto payment methods is itself risky for your audience.
:::

::: warning
Common payment mistakes:

- A slow handler holds up the queue, and `pre_checkout_query` gets no answer within 10 seconds. You need concurrent processing and a fast check inside the handler itself.
- Delivering the purchase after `pre_checkout_query` instead of after `successful_payment`.
- Not saving `charge_id`, so you can neither refund the payment nor cancel the subscription.
- A second subscription on top of an active one: neither the button nor `pre_checkout_query` checks the expiry date.
- Refunding a subscription without canceling renewal.
- No `/paysupport` and `/terms`, or terms shown after payment.
- Deleting `payments` rows on `/deletedata` instead of replacing the id with 0 ([chapter 5.8](#ch-5-8)).
- Taking payment for a digital service through a card provider.
:::

## Your step

::: step
Tonight: one real payment in Telegram's test environment[^src-tg-testenv-55]:

1. Load `examples/economics/schema.sql` into the bot's database. These are the [chapter 2.4](#ch-2-4) tables: without `payments`, `initPaymentsSchema` fails.
2. Set up a test account: in your client, log in to the test server (in Telegram Desktop, Shift + Alt + right-click on "Add Account"). Create a bot with the test @BotFather there too.
3. Start the bot with `new Bot(token, { client: { environment: "test" } })`, and add `/terms`, `/paysupport` and the handlers from both code blocks.
4. Replace the fake door's reply from [chapter 2.5](#ch-2-5) with an invoice. No fake door? The `/subscribe` command from the code is enough.
5. Pay for a subscription from the test account and refund it with `/refund`.

**Done when** `payments` has a row with `charge_id`, `amount` = 250, `expires_at` and `refunded_at`, and the bot has answered `/paysupport`. Then move the code to your production bot and write down your price decision rule.
:::

**Recap.** The price test lives here; packaging the subscription is in [chapter 4.2](#ch-4-2), and plans in [chapter 4.5](#ch-4-5). The `payments` rows will fill the LTV triangle from [chapter 2.4](#ch-2-4) and the economics sheet in [chapter 4.6](#ch-4-6). Stars for ads come back in [chapter 5.4](#ch-5-4), and the `failed` update in [chapter 5.6](#ch-5-6).

[^src-tg-payments-55]: Telegram, "Bot Payments API for Physical Goods and Services": Bot Settings → Payments; "does not charge any commission." core.telegram.org/bots/payments (accessed September 28, 2026).
[^src-yookassa-55]: YooKassa, "Настройка платежей через Telegram-ботов" (setting up payments through Telegram bots; in Russian). yookassa.ru/docs/support/payments/onboarding/integration/cms-module/telegram (accessed September 28, 2026).
[^src-tg-stars-55]: Telegram, "Bot Payments API for Digital Goods and Services": pre-checkout "within 10 seconds," delivery after `successful_payment`, the Live Checklist, the "Star Pricing" table. core.telegram.org/bots/payments-stars (accessed September 28, 2026).
[^src-grammy-runner-55]: grammY, "Concurrency With grammY runner." grammy.dev/plugins/runner (accessed September 28, 2026).
[^src-tg-botapi-55]: Telegram Bot API 10.3: `createInvoiceLink`, `SuccessfulPayment`, `editUserStarSubscription`, `StarTransaction`, `TransactionPartnerUser`. core.telegram.org/bots/api (accessed September 28, 2026).
[^src-tg-subs-55]: Telegram, "Subscriptions," section "Bot subscriptions." core.telegram.org/api/subscriptions (accessed September 28, 2026).
[^src-tg-changelog-55]: Telegram, "Bot API changelog": 9.3 (December 31, 2025), topics in private chats; 9.5 (March 1, 2026), "Allowed all bots to use the method sendMessageDraft"; 10.2 (July 14, 2026), `BotSubscriptionUpdated`. core.telegram.org/bots/api-changelog (accessed September 28, 2026).
[^src-tg-tos-55]: Telegram, "Bot Platform Developer Terms of Service," sections 6.1, 6.2 (Apple's and Google's definitions), 6.2.1 (refunds "with no penalty," SCAM), 6.2.3 ($0.02, "this value may fluctuate"), 6.2.4 ($0.013, up to 21 days), 6.2.4.1, 6.2.6 (15%), 6.2.7 (three years). telegram.org/tos/bot-developers (accessed September 28, 2026).
[^src-tg-blog-reactions-55]: Telegram, "Super Channels, Star Reactions and Subscriptions," August 14, 2024. telegram.org/blog/superchannels-star-reactions-subscriptions (accessed September 28, 2026).
[^src-fragment-55]: Fragment, "Buy Telegram Stars." fragment.com/stars/buy (accessed September 28, 2026).
[^src-fas-55]: FAS Russia, "Разъяснения ФАС России в части контроля законодательства о рекламе" (FAS clarifications on enforcing advertising law; in Russian), March 25, 2026. base.garant.ru/413952580/ (accessed September 28, 2026).
[^src-tg-config-55]: Telegram, "Client configuration": `stars_purchase_blocked`, "all Star-related UI options should be hidden"; in the example, `stars_revenue_withdrawal_min` = 1000, `starref_min/max_commission_permille` = 1 / 800. core.telegram.org/api/config (accessed September 28, 2026).
[^src-vc-stars-55]: vc.ru, "Как купить звезды Телеграм в России: 4 рабочих способа" (how to buy Telegram Stars in Russia: four working methods; in Russian), July 23, 2026; an overview, not Telegram data. vc.ru/money/3043269-kak-kupit-zvezdy-v-telegram-v-rossii (accessed September 28, 2026).
[^src-examples-econ-55]: github.com/alex-mextner/indie-growth-book, folder `examples/economics`: chapter 5.5 functions, the `paywall_funnel_by_week` and `refund_share_30d` queries, and tests.
[^src-tg-referrals-55]: Telegram, "Affiliate programs." core.telegram.org/api/bots/referrals (accessed September 28, 2026).
[^src-tg-affiliate-tos-55]: Telegram, "Terms of Service for Affiliate Programs," section 2.1. telegram.org/tos/affiliate-program (accessed September 28, 2026).
[^src-gram-55]: TON, t.me/gram/2385, June 10, 2026: "Native Token Rename: Toncoin (TON) to Gram (GRAM)," effective 12:00 UTC on June 15, 2026 (accessed September 28, 2026).
[^src-tg-api-stars-55]: Telegram, "Telegram Stars," section "Withdrawing revenue." core.telegram.org/api/stars (accessed September 28, 2026).
[^src-282fz-55]: Federal Law of Russia No. 282-FZ of August 4, 2026, "On Digital Currencies and Digital Rights": Article 30, Parts 1–2; Article 56, Parts 1–2 (the law applies from September 1, 2026; Part 1 of Article 30 from July 1, 2027). consultant.ru/document/cons_doc_LAW_540983/ (accessed September 28, 2026).
[^src-nk-55]: Tax Code of the Russian Federation, as amended August 4, 2026: Article 228, clause 1, subclause 3; Article 229, clause 1; Article 224, clause 1. consultant.ru/document/cons_doc_LAW_28165/ (accessed September 28, 2026).
[^src-npd-55]: Federal Law of Russia No. 422-FZ, as amended August 4, 2026: Article 4, Part 2, clause 9; Article 6, Part 2, clause 11. consultant.ru/document/cons_doc_LAW_311977/ (accessed September 28, 2026).
[^src-tg-testenv-55]: Telegram, "Bot Features," "Dedicated test environment." core.telegram.org/bots/features#dedicated-test-environment (accessed September 28, 2026).
