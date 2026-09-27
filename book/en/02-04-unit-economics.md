# 2.4. Unit Economics When Every Request Costs Money {#ch-2-4}

::: skip
If you know CAC, LTV and gross margin, start at "Why an AI product adds up differently." If you don't use paid models, skip "Record it: the AI usage log": your server is a fixed cost. Do read "How much money actually arrives," "CAC per activated user" and "From activated to paying."
:::

In [chapters 2.1](#ch-2-1)–[2.3](#ch-2-3) we learned where people come from, where they drop off and whether they come back. Now the big question: what does one person cost, and what do they bring in? In an AI product every message is a small bill, even from a free user.

## The gist

### The unit and the key numbers

**Unit economics** means revenue and costs per single unit. It asks not "what did we make this month?" but "what do we make on one customer?" If you lose money on each customer, growth only speeds up the losses.

There are usually two units. For costs, the **active user**: their messages are what trigger model requests. For revenue, the **paying account**: a subscriber, or an organizer who pays for their participants.

**Customer acquisition cost** (CAC) is what you spend on acquisition divided by the number of people acquired. We divide by activated users, not by everyone who tapped `/start`. You can also add the hours you spend on placements and posts, at an hourly rate you set yourself; [chapter 4.6](#ch-4-6) shows how.

**Average revenue per user** (ARPU) is monthly revenue divided by all active users. **Average revenue per paying user** (ARPPU) is the same revenue divided by paying users only. With a $5 subscription and one payer in twenty, ARPPU is $5 and ARPU is 25 cents.

**Gross margin** is the share of revenue left after the cost of serving customers: model requests, speech recognition, the payment channel's fee. **Contribution margin** is the share left after you also subtract tax on revenue and refunds. In dollars, this **contribution** is the money that actually reaches you from a customer. A small bot's server is a fixed cost and belongs in neither.

**Payer churn** is the share of paying customers who stop paying in a month. If ninety of a hundred subscribers remain after a month, churn is 10%.

### LTV and payback

**Lifetime value** (LTV) is what a paying customer brings in while they keep paying. David Skok, a partner at the venture firm Matrix Partners, computes it from gross margin, monthly churn and ARPA, average revenue per account[^src-skok-defs]. ARPA is monthly revenue per paying account, which for us is the same as ARPPU. Instead of gross margin, we use contribution:

```text
LTV = payer's monthly contribution × min(1 ÷ payer churn, 24)
payer's monthly contribution = ARPPU × contribution margin
```

At 10% churn a payer stays ten months on average, so LTV is ten monthly contributions. Don't combine ARPU across all users with payer churn: the result means nothing.

The formula has two weak spots. It assumes churn stays constant, and you can't measure churn without two or three cohorts of payers. And as churn approaches zero, LTV heads toward infinity.

Skok later proposed discounting: converting future payments into today's money, adjusted for time and risk[^src-skok-ltv]. We keep it simpler and cap the lifetime at 24 months (rule of thumb: check it against your own data). Until you have payers, run the numbers at two churn rates, say 10% and 20%, and see whether the decision changes.

**Payback period** is how many months it takes a payer to earn back their acquisition cost:

```text
payback, months = payer CAC ÷ payer's monthly contribution
```

Skok writes that the best SaaS companies have an LTV more than three times their CAC[^src-skok-metrics]. That's the rule of three: contribution also has to pay for development and your evenings.

Skok has revised his payback threshold. The "12 months" guideline dates from around 2011, when capital was expensive. Today, he says, very healthy SaaS companies often take around 20 months to earn back a customer, and above 24 months the number needs work[^src-skok-defs].

These thresholds are for venture-funded companies; an indie product paying out of pocket should aim closer to the old 12 months. And compare payback with lifetime: a customer who leaves after ten months never reaches a 20-month payback.

### Why an AI product adds up differently

In classic software one more user costs almost nothing, which is why SaaS gross margins are high. In 2020, Martin Casado and Matt Bornstein of the venture firm Andreessen Horowitz described how AI companies differ. In their interviews with founders, gross margins were often 50–60%, against 60–80% or more for comparable SaaS[^src-a16z]. The reason is compute, which is billed on every request.

For a small bot, costs grow with the number of requests, not people. The most expensive users are the most active ones and those who write a lot without understanding the bot. So **a free user isn't free, they're a line item**: a free tier is marketing you pay for in tokens.

## The bridge

We'll work out the price of a request, start logging every request, and break costs down by funnel stage and channel. From that we'll derive the cost of a free user, break-even and payback. The code with tests is in `examples/economics`[^src-examples-econ].

### What a request costs

Model providers charge for tokens: the chunks of text a model splits its input and output into. Input is everything you send: instructions, chat history, tool descriptions, the message. Output is the reply.

```text
cost = input × input_price ÷ 1,000,000
     + output × output_price ÷ 1,000,000
     + audio_minutes × price_per_minute
```

As of September 27, 2026, an output token at Anthropic costs five times an input token for every model in its main table[^src-anthropic-pricing]. Yet in a chatbot the input usually costs more: every message drags the instructions and history along. In the example below, input is almost three-quarters of a request's cost. So the first saving is trimming history to what's needed.

You can't compare per-token prices across models directly: at Anthropic, models from Claude 4.7 on split the same text into about 30% more tokens[^src-anthropic-pricing]. Compare the price of one of your requests, not the price per million.

Two discounts change the math. With prompt caching, the repeated start of a request, such as instructions, is read from cache at 10% of the input price or less. Writing it costs 1.25–2 times the input price. Batch processing gives 50% off, but the answer doesn't come right away: fine for a nightly digest, not for chat[^src-anthropic-pricing].

::: warning
Prices change, and the spread is huge. In one provider's main table on September 27, 2026, the most expensive model cost ten times the cheapest[^src-anthropic-pricing]. That's why prices don't go into code; they're passed in as a dated table.
:::

### Record it: the AI usage log

Estimates of "a request costs this much" go stale fast; log every model call instead.

```sql
CREATE TABLE IF NOT EXISTS ai_usage (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL,     -- telegram_id; BIGINT in Postgres
  request_id         TEXT    NOT NULL,     -- one message from a person
  trigger            TEXT    NOT NULL,     -- 'user' | 'system'
  at                 TEXT    NOT NULL,
  feature            TEXT    NOT NULL,     -- 'parse' | 'voice' | 'digest'
  model              TEXT    NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
  input_tokens       INTEGER NOT NULL DEFAULT 0,     -- excluding cache
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  audio_seconds      REAL    NOT NULL DEFAULT 0,
  cost_usd           REAL    NOT NULL,
  priced             INTEGER NOT NULL DEFAULT 1,     -- 0: model not in price table
  price_version      TEXT    NOT NULL      -- date of the price table
);
```

One message can call the model several times, so those calls share a `request_id`, such as the Telegram update ID (`update_id`). Scheduled digests are marked `trigger = 'system'`.

The `status` field separates successes from errors. Only successes count toward limits; the cost of errors matters when you reconcile with the bill.

Cost is computed at write time and stored with the price date. A model with no price is logged at the table's highest price, with `priced = 0`. The spend doesn't vanish, and the `missing_prices` query reminds you to update prices. Providers return token counts themselves, but the fields have different names:

| Provider | Input excluding cache | Cache read | Cache write | Output |
|---|---|---|---|---|
| Anthropic | `input_tokens` | `cache_read_input_tokens` | `cache_creation_input_tokens` | `output_tokens` |
| OpenAI (Responses) | `input_tokens` minus cache reads and writes | `cached_tokens` | `cache_write_tokens` | `output_tokens` |
| Gemini | `promptTokenCount` + `toolUsePromptTokenCount` minus cache | `cachedContentTokenCount` | — | `candidatesTokenCount` + `thoughtsTokenCount` |

The fields were checked on September 27, 2026[^src-anthropic-usage][^src-openai-cache][^src-gemini-usage]. The `toUsage` function in `examples/economics/economics.ts` does the mapping, and `withAiUsage` lives there too.

```typescript
const reply = await withAiUsage(db, prices,
  { userId, requestId: String(ctx.update.update_id), trigger: "user",
    feature: "parse", model },
  () => client.messages.create({ model, max_tokens: 300, system, messages }),
  (r) => toUsage("anthropic", r.usage));
```

`withAiUsage` writes the log in a `finally` block, on success and on error alike. A failure of the write itself is caught and never breaks the reply to the user.

The log is personal data, and every model call sends a person's text to the provider, often in another country ([chapters 2.1](#ch-2-1) and [5.8](#ch-5-8)). On a user's request, `deleteUserEconomics` pseudonymizes their rows: the totals stay for reconciling with the bill.

### Cost per active user

The log's first number is the AI cost of one active user over the last 30 days. Active users come from the `user_activity` table of [chapter 2.3](#ch-2-3), with your own accounts excluded.

```sql
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),
active AS (
  SELECT DISTINCT telegram_id FROM user_activity
  WHERE day >= date('now', '-30 days')
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
)
SELECT (SELECT COUNT(*) FROM active) AS active_users,
       ROUND(SUM(cost_usd) / NULLIF((SELECT COUNT(*) FROM active), 0), 4)
         AS cost_per_active_usd
FROM ai_usage
WHERE at >= datetime('now', '-30 days')
  AND user_id NOT IN (SELECT telegram_id FROM me);
```

The query divides 30 days of AI spend by active users; the `examples` version shows digests separately. The `top_decile_share` query shows what share of spend goes to the costliest 10% of users; it's meaningful once you have twenty users with spend. If they account for half the spend, design your limits around them.

### Cost by funnel stage

In [chapter 2.2](#ch-2-2) we promised to test a hypothesis: non-activated users may cost more, because they write more while trying to figure the bot out. The `cost_by_stage` query finds each cohort member's furthest step in their first week and the cost of their requests.

Suppose the result for a cohort of two hundred looks like this. The numbers are for illustration: the funnel from [chapter 2.2](#ch-2-2), requests at $0.00275 each from the calculation below.

| Stopped at step | People | Requests per person | Cost per person, $ | Total, $ |
|---|---|---|---|---|
| `start` | 36 | 0 | 0 | 0 |
| `language_chosen` | 66 | 0 | 0 | 0 |
| `timezone_set` | 8 | 0.2 | 0.0006 | 0.00 |
| `first_message_sent` | 26 | 6.1 | 0.0168 | 0.44 |
| `first_event_created` | 22 | 7.4 | 0.0204 | 0.45 |
| `first_reminder_delivered` | 42 | 5.2 | 0.0143 | 0.60 |

Compare per-person averages, not totals. The 48 people stuck between their first message and their first reminder cost about $0.018 each on average; activated users, $0.014. In this illustration the hypothesis holds: "didn't get that" costs you twice, once in requests and once in a lost user.

Hence the fixes: recognize frequent phrases without the model, and turn a misunderstood message into a hint with buttons.

### What a free user costs

Our working assumption for the free tier: 10 AI requests a day and 50 a week. Commands recognized without the model aren't limited. Together the two limits allow about 214 requests in 30 days on average. The maximum is 220 with a rolling week, and up to 240 if the week resets on Mondays.

Suppose a typical request is 2,000 input tokens and 150 output tokens. The second and third rows use the prices of the cheapest and most expensive models in Anthropic's main table on September 27, 2026[^src-anthropic-pricing]. The first row is a hypothetical cheaper model from another provider.

| Input / output price, $ per million tokens | One request, $ | Average at the limit, ≈214 requests, $ | Typical month, 40 requests, $ |
|---|---|---|---|
| 0.25 / 1.25 | 0.00069 | 0.15 | 0.03 |
| 1 / 5 | 0.00275 | 0.59 | 0.11 |
| 10 / 50 | 0.0275 | 5.89 | 1.10 |

The "typical" 40 requests are an illustration too. On the expensive model, a free user at the limit costs more than a $5 subscription. So pick the model for the task: a cheap one usually handles "gym Thursday at seven" (rule of thumb: check it on your own messages).

### How much money actually arrives

The subscription price isn't what you receive. Telegram allows digital goods and services inside a bot to be sold only for Telegram Stars, Telegram's in-app currency[^src-tg-stars]. So for a personal subscription, Stars are the only option. By Telegram's table, 250 Stars bought through the App Store or Google Play cost the user $4.99, and the developer gets $3.25, about 65%.

Developers are credited $0.013 per Star. Withdrawals go through the Fragment platform and aren't available in every country; earned Stars unlock only after up to 21 days[^src-tg-tos]. How to withdraw the money and report the income is covered in [chapter 5.5](#ch-5-5). A Stars subscription renews every 30 days, and refunds go through a Bot API method[^src-tg-botapi].

The tax in our example is 6% of what you receive, as an illustration: check the tax treatment of Fragment payouts in your country. For comparison, Russia's self-employed pay 4% on income from individuals and 6% on income from businesses[^src-npd]. Refunds are 2% (illustration).

All amounts are in US dollars; $5 is about 420 rubles at the Bank of Russia's official rate on September 26, 2026[^src-cbr].

```text
contribution = price × (1 − fee) × (1 − tax − refunds) − payer_AI_cost
```

Say a subscriber with no limit spends $1 a month on AI (illustration). Their contribution: 5 × 0.65 × 0.92 − 1 ≈ $1.99 a month.

An organizer can pay by invoice outside Telegram, through a card payment processor charging 3% (illustration). Suppose they pay $30 a month for 50 participants (the model is in [chapter 4.3](#ch-4-3)). That leaves 30 × 0.97 × 0.92 ≈ $26.8. Minus $3 for the organizer's own requests (illustration), that's about $24 (through Stars: 30 × 0.65 × 0.92 − 3 ≈ $15).

Participants who receive template reminders, with no model involved, cost almost nothing.

::: warning
Telegram's developer terms (section 6.2) require digital goods and services in bots to be sold only for Stars. Using other payment systems brings a notice; if you don't comply, the bot disappears from app-store versions of Telegram or gets removed[^src-tg-tos]. Invoicing an organizer outside Telegram is a gray area: they pay for a service that runs in the bot. Read [chapter 5.5](#ch-5-5) first; this isn't legal, tax or financial advice.
:::

### Break-even

The **break-even point** is the number of payers at which a month's revenue covers its costs. Everything is in dollars per month; your time isn't included, and we'll add it in [chapter 4.6](#ch-4-6).

```text
payers ≥ (free_users × free_user_cost + fixed_costs)
         ÷ payer_contribution
```

If contribution is below zero, there's no break-even at any number of people. At a typical $0.11 per free user, one Stars subscriber covers about 18 free users; at the limit, at $0.59, just three. Add a $10-a-month server and 300 free users (illustration): you need 22 subscribers, one per 14 free users.

A partner contributing about $24 a month (through Stars, about $15) covers more than two hundred free users (through Stars, about 135). Partners, meaning event organizers, are our main bet.

### CAC per activated user: the $100 test

At the start our acquisition budget is about $100, and we spend it gradually. Every payment for a channel goes into `marketing_spend` (schema in `examples/economics`) with the tag from [chapter 2.1](#ch-2-1). The `cac_by_source` query divides spend by starts and by activated users, and adds first-week AI costs.

Suppose the `src_tg_chanA_0927` placement from [chapter 2.1](#ch-2-1) cost $40 and brought 112 starts and 5 activated users, with $2.20 of AI in their first week. The numbers are for illustration.

| Metric | Calculation | Value, $ |
|---|---|---|
| CAC per start | 40 ÷ 112 | 0.36 |
| CAC per activated user | 40 ÷ 5 | 8.00 |
| Full cost per activated user | (40 + 2.2) ÷ 5 | 8.44 |

The first and second rows differ by a factor of 22. **Compute acquisition cost per activated user, not per start.** Until everyone who arrived has had seven days, the query doesn't show this CAC.

First-touch tagging undercounts a placement: afterward some people find the bot by search (`none`), others get it forwarded (`src_share`). Suppose two activated users in `none` actually came from the placement. Then the cost per activated user is $6 to $8.40, and a range is the honest answer. [Chapter 5.3](#ch-5-3) covers counting clicks.

### From activated to paying

Suppose one in ten activated users subscribes through Stars. Then each subscriber costs 8.44 × 10 = $84.40. On top of that, they "carry" nine free activated users: $0.99 a month. We assume those stay for the subscriber's whole lifetime; that's conservative, since free users usually leave sooner.

| Per subscriber, 10% churn | Plain formula | Minus free users |
|---|---|---|
| Monthly contribution, $ | 1.99 | 1.00 |
| LTV over 10 months, $ | 19.9 | 10.0 |
| Subscriber CAC, $ | 84.4 | 84.4 |
| LTV ÷ CAC | 0.24 | 0.12 |
| Payback, months | 42 | 84 |

At 10% churn (illustration) a subscriber leaves after ten months on average but would need 42 or 84 months to pay back. Payback never happens. At 20% churn LTV halves, and the decision stays the same.

The takeaway isn't "ads don't work"; it's "paid placements for a $5 subscription don't pay back." What can pay back are free channels (invitations, communities, content) and partners. An organizer who cost the whole $100 pays back in five months, through Stars in seven, if they stay that long.

### Cohort LTV

The LTV formula is a back-of-the-envelope check. Once you have subscribers, build a triangle as in [chapter 2.3](#ch-2-3), but for money: cohort by month of first payment, columns by 30-day period. Each cell is the cumulative contribution per original subscriber, before subtracting the cost of the free users they carry.

Here's what it might look like on September 27, 2026 (illustration for Stars):

| First payment | Subscribers | Period 1, $ | Period 2, $ | Period 3, $ | Period 4, $ |
|---|---|---|---|---|---|
| April | 12 | 1.9 | 3.6 | 5.1 | 6.5 |
| May | 9 | 2.0 | 3.7 | 5.2 | — |
| June | 15 | 1.9 | 3.5 | — | — |

If the increase from one period to the next stops shrinking, that's the retention plateau from [chapter 2.3](#ch-2-3), in money. The column where a cell, minus the free users' share, overtakes subscriber CAC is your real payback period. The `payments` table and the queries are in `examples/economics`: `arppu_30d` (already after fees: for contribution, × (1 − tax − refunds) − AI), `payer_churn_monthly`, `cohort_ltv`.

::: case
The expense-tracking bot has different economics. Suppose "coffee 250" is parsed by a template, and the model is only needed for unclear lines and photos of receipts. There are fewer requests per active user, and the margin is higher.

But a receipt photo at Anthropic is up to 1,600 input tokens on older models and 2,700–4,800 on newer ones[^src-anthropic-vision]. The `feature` field shows which function eats the money, and that's the one to limit on the free tier.
:::

::: warning
Two traps. The first is a low price with unlimited AI: "unlimited" attracts the heaviest users most, and cost per payer climbs. Every plan needs a ceiling: high, but finite.

The second is having no global circuit breaker. Set a monthly limit in the provider's console if it has one, and check the day's `cost_usd` total against a daily cap in code. Once the cap is hit, the bot switches to template replies and alerts you ([chapter 5.7](#ch-5-7) has the fallback plan). Without this, a bug in a retry loop can burn a month's budget overnight.
:::

## Your step

::: step
Tonight, find out what an active user costs:

1. Create `ai_usage` and wrap every model call in `withAiUsage`. Fill in the price table from your provider's pricing page and record the date. Use a separate API key for your own testing and add your accounts to `me`.
2. While the log is empty, take a first approximation: the production key's spend over 30 days from the provider's console. It includes your past tests, so the number runs high. Divide it by the number of active users:

    ```sql
    SELECT COUNT(DISTINCT telegram_id) FROM user_activity
    WHERE day >= date('now', '-30 days')
      AND telegram_id NOT IN (111111111, 222222222);
    ```

    If `user_activity` is younger than 30 days, count unique message authors over 30 days from your own table or logs.
3. Write the result down next to the price date and the model.

**Done when** you have one number, the cost of an active user over 30 days, plus the first rows in `ai_usage`, and `missing_prices` is empty. In a month, reconcile the log's total with the provider's bill. A gap of more than a few percent means some calls bypass the log.
:::

**Recap.** The cost of a free user becomes the basis for limits in [chapter 4.1](#ch-4-1). Subscriber contribution sets the subscription price in [chapter 4.2](#ch-4-2), and the cost of a participant shapes what organizers pay in [chapter 4.3](#ch-4-3). In [chapter 4.6](#ch-4-6) this chapter's numbers come together on one sheet that shows whether the economics work. And what to do when AI costs grow faster than revenue is in [chapter 5.7](#ch-5-7).

[^src-skok-defs]: David Skok, "SaaS Metrics 2.0 – Detailed Definitions," updated October 19, 2025, forentrepreneurs.com/saas-metrics-2-definitions/: LTV from ARPA, gross margin (GM%) and monthly Customer Churn Rate; the 12-month payback guideline dates from around 2011, around 20 months is now common, above 24 should be improved (accessed September 27, 2026).
[^src-skok-ltv]: David Skok, "What's your TRUE customer lifetime value (LTV)? – DCF provides the answer," December 10, 2015, forentrepreneurs.com/ltv/ (accessed September 27, 2026).
[^src-skok-metrics]: David Skok, "SaaS Metrics 2.0 – A Guide to Measuring and Improving What Matters," January 16, 2013, forentrepreneurs.com/saas-metrics-2/; about the author: forentrepreneurs.com/about/ (accessed September 27, 2026).
[^src-a16z]: Martin Casado, Matt Bornstein, "The New Business of AI (and How It's Different From Traditional Software)," Andreessen Horowitz, February 16, 2020, a16z.com/the-new-business-of-ai-and-how-its-different-from-traditional-software/ (accessed September 27, 2026).
[^src-examples-econ]: github.com/alex-mextner/indie-growth-book, folder `examples/economics`: schema, TypeScript (Bun) code, queries and tests.
[^src-anthropic-pricing]: Anthropic, "Pricing," platform.claude.com/docs/en/about-claude/pricing: from $1 / $5 (Haiku 4.5) to $10 / $50 (Fable 5.1) per million tokens; cache writes 1.25–2×, reads 0.025–0.1×; Batch −50%; the Claude 4.7+ tokenizer produces about 30% more tokens (accessed September 27, 2026).
[^src-anthropic-usage]: Anthropic, "Messages API," the `usage` object, platform.claude.com/docs/en/api/messages (accessed September 27, 2026).
[^src-openai-cache]: OpenAI, "Prompt caching": in the example, `input_tokens` = 15,000 with `cached_tokens` = 12,000 and `cache_write_tokens` = 3,000. developers.openai.com/api/docs/guides/prompt-caching (accessed September 27, 2026).
[^src-gemini-usage]: Google, "UsageMetadata," ai.google.dev/api/generate-content; output price "including thinking tokens": ai.google.dev/gemini-api/docs/pricing (accessed September 27, 2026).
[^src-anthropic-vision]: Anthropic, "Vision": up to 1,568 tokens per image; on Claude 4.7+, 2,691 for 1920 × 1080 and up to 4,784. platform.claude.com/docs/en/build-with-claude/vision (accessed September 27, 2026).
[^src-tg-stars]: Telegram, "Bot Payments API for Digital Goods and Services," core.telegram.org/bots/payments-stars, "Star Pricing" table: 250 Stars cost $4.99, of which $1.50 goes to Apple / Google, $0.24 to Telegram, $3.25 to the developer (accessed September 27, 2026).
[^src-tg-tos]: Telegram, "Bot Platform Developer Terms of Service," sections 6.2–6.2.4.1, telegram.org/tos/bot-developers (accessed September 27, 2026).
[^src-tg-botapi]: Telegram Bot API: `createInvoiceLink` (`subscription_period` = 2592000 s), `refundStarPayment`. core.telegram.org/bots/api (accessed September 27, 2026).
[^src-npd]: Federal Tax Service of Russia, "Professional income tax" (the tax regime for Russia's self-employed), npd.nalog.ru (accessed September 27, 2026).
[^src-cbr]: Bank of Russia (Russia's central bank), official rate on September 26, 2026: 84.3414 rubles per US dollar. cbr.ru/currency_base/daily/ (accessed September 27, 2026).
