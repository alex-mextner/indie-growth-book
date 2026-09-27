# 2.3. Cohorts and Retention Curves {#ch-2-3}

::: skip
If you've built cohort tables and know why a retention curve should level off, start with "Two retention lines." That's where we measure retention for a product that's useful while the person stays silent. If you have few users, jump to "Small numbers" as well.
:::

The funnel in [chapter 2.2](#ch-2-2) ends at activation. This chapter extends it to the right: do people come back after a week, a month, six months?

## The gist

### Cohorts and the triangle

**Retention** is the share of people who keep using a product some time after first contact. Measuring it "in general" is pointless: people arrive in different weeks, from different channels, into different versions of the product. So we split them into **cohorts**: groups defined by the week of first contact.

For each cohort, you count the share that was active in the first week after arriving, then the second, then the third. Rows of the table are cohorts; columns are weeks since arrival. Older cohorts are filled in completely, newer ones only in their first cells, so the table is called a triangle.

Plot one row of the triangle and you get a **retention curve**: the share of the cohort still with you, by weeks since arrival.

### A plateau or zero

A retention curve always falls; what matters is the shape of its tail. In 2013, Brian Balfour, who later founded the education company Reforge, made the point plainly. If the curve levels off somewhere, the product has probably found a market, at least for some audience[^src-balfour-pmf]. A curve that creeps toward zero means the product eventually loses everyone.

The flat part is called the plateau. Its height is the share of arrivals who found lasting value in the product. Casey Winters, former head of growth at Pinterest and Grubhub, notes: in transactional products, the buyers' curve can take more than six months to flatten[^src-winters-flat]. We suspect the same holds for bots people need only occasionally (our hypothesis).

In 2015, investor Andrew Chen published data from the company Quettra covering more than 125 million Android devices[^src-chen-quettra]. The average app lost 77% of its daily active users within three days of install, and 90% within 30 days. The top apps' curves started higher but fell almost as fast.

Chen's conclusion: it's activation in the first days, not a stream of notifications, that bends the curve. That doesn't clash with our approach: a reminder the person set up themselves is the product, not a marketing blast.

### Benchmarks, and why to trust them carefully

In 2020, Lenny Rachitsky and Casey Winters surveyed 20 experienced growth practitioners and checked their answers against public data[^src-lenny-retention]. They define retention as the share of sign-ups still active six months later.

| Product type | Good, % | Great, % |
|---|---|---|
| Consumer social | ~25 | ~45 |
| Consumer transactional (purchases, orders) | ~30 | ~50 |
| Consumer subscription (consumer SaaS) | ~40 | ~70 |

These numbers describe other products and another time horizon: a calendar bot is neither a social network nor a store. Treat them as orders of magnitude, and compare each cohort with your own earlier cohorts.

### Unfinished weeks

In [chapter 2.2](#ch-2-2), the funnel counted only people who had seven days to activate. The same rule applies to every cell here. If a cohort arrived ten days ago, its third week hasn't happened yet, and a zero in that cell would falsely say "everyone left."

Statisticians call this right censoring. An unfinished cell should be empty, not zero, which is why the table is a triangle.

### "On day N" and "on or after day N"

Amplitude, a popular product analytics tool, documents two ways to count a return[^src-amplitude-retention]:

- **N-day retention** (Amplitude's "Return On"): the share of the cohort active on exactly day N, or in exactly week N. The curve can even rise after vacations.
- **Unbounded retention** (Amplitude's "Return On or After"): the share active on day N or any later day. The curve only falls and never dips below the N-day curve.

Amplitude recommends the first when the rhythm of returns matters, and the second when what matters is whether a person came back at all. The second rewrites the past: someone who returns in week nine lifts every cell up to week nine.

For a product with a weekly rhythm, like a calendar or an expense tracker, use "in week N" retention. Daily retention lies here: someone who messages the bot on Thursdays looks lost six days out of seven.

### Returning users

Jorge Mazal, former chief product officer of Duolingo, tracked two kinds of returning users separately[^src-duolingo-model]. "Reactivated" users came back after a 7–29-day break; "resurrected" ones, after 30 days or more. They behave differently from new and regular users, so they deserve their own row.

## The bridge

### Two retention lines

Our calendar bot is useful even when the person is silent: events are set a month ahead, and reminders arrive on their own. Judged by messages alone, this person looks gone. So, as promised in [chapter 2.2](#ch-2-2), there are two retention lines:

- **Active retention**: the person did something themselves in week N. They wrote, tapped a button, created or changed an event.
- **Passive retention**: the bot delivered at least one reminder to the person in week N.

The active line alone understates retention; the passive line alone overstates it, because reminders also go to people who stopped reading the chat long ago. Their union, the "in touch" line, is inflated too, because it still includes zombies (more on them below). If your bot never writes first, you have no passive line.

### Record it: days of activity

For the triangle, you only need to know which days a person was active:

```sql
CREATE TABLE IF NOT EXISTS user_activity (
  telegram_id INTEGER NOT NULL,
  day         TEXT    NOT NULL,          -- date('now'), UTC
  PRIMARY KEY (telegram_id, day)
);
```

```typescript
function markActive(db: Database, userId: number) {
  db.run("INSERT OR IGNORE INTO user_activity (telegram_id, day) VALUES (?, date('now'))", [userId]);
}

bot.use((ctx, next) => {
  if (ctx.chat?.type === "private" && ctx.from && isHumanInput(ctx.update)) markActive(db, ctx.from.id);
  return next();
});
```

This middleware in grammY, the bot framework we use, runs on every update and marks only real input in a private chat. That means text, voice, photos, commands and button taps except the "sign of life" button. Service messages, such as a notice that a subscription renewed, also arrive as `message`, but paying isn't using.

This is personal data. After 12 months (rule of thumb), keep the finished triangles and use the query in `examples` to delete the raw rows ([chapters 2.1](#ch-2-1), [5.8](#ch-5-8)).

If you have an events table with an author and a date, import the history with the query in `examples`. Take only rows the person created: an automatic repeat of a weekly event isn't their action. Without history, the first cell appears three weeks after the first cohort's Monday, and a full six-week row after two months.

### Record it: a log of delivered reminders

The source of passive retention is a log of reminders that Telegram accepted without an error:

```sql
CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id           INTEGER PRIMARY KEY,
  telegram_id  INTEGER NOT NULL,                     -- recipient
  kind         TEXT    NOT NULL DEFAULT 'reminder',  -- or 'weekly_summary'
  message_id   INTEGER,
  delivered_on TEXT    NOT NULL,                     -- date only, no time
  acked_on     TEXT                                  -- tapped "sign of life"
);
```

The log holds neither the reminder's text nor the exact time: retention doesn't need them.

```typescript
async function sendReminder(userId: number, text: string, ownEvent = true) {
  const alive = { inline_keyboard: [[{ text: "Got it, thanks", callback_data: "alive" }]] };
  try {
    const msg = await bot.api.sendMessage(userId, text, { reply_markup: alive });
    recordReminderDelivery(db, userId, msg.message_id, "reminder", ownEvent);
  } catch (e) {
    if (e instanceof GrammyError && isBlockedError(e.description)) recordBotStatus(db, userId, "kicked");
    else throw e;
  }
}
```

The row is written only after a successful send. A 403 error almost always means a block, but check the text: "bot can't initiate conversation" means a participant who never tapped `/start`[^src-tg-errors]. Retries after a 429 error (too many requests) are handled by grammY's auto-retry plugin or your own queue[^src-grammy-retry]; more in [chapter 5.7](#ch-5-7).

`recordReminderDelivery` also marks the `first_reminder_delivered` step, so remove the separate `markStep` call for it from [chapter 2.2](#ch-2-2). A reminder about someone else's shared event goes into the recipient's passive line. It doesn't count as their activation: that's what `ownEvent = false` is for. The other functions are in `examples/tracking/tracking.ts`.

### Zombies and the "sign of life" button

::: note
A **zombie** is a person whose reminders are delivered but never read. They deleted the conversation without blocking the bot, archived the chat with notifications muted or stopped opening Telegram.

In a private chat, a bot receives `my_chat_member` only on block and unblock, and the Bot API has no read-receipt update[^src-tg-my-chat-member-23]. To the bot, a zombie looks exactly like a happy, quiet user.
:::

Give living users a way to respond: a "Got it, thanks" button under the reminder.

```typescript
bot.callbackQuery("alive", async (ctx) => {
  const messageId = ctx.callbackQuery.message?.message_id;
  if (messageId) ackReminder(db, ctx.from.id, messageId);
  await ctx.answerCallbackQuery({ text: "Great, I'll remind you next time too" });
});
```

`ackReminder` finds the row by the person-plus-message pair and stores the tap date; the callback already includes the message with the tapped button[^src-tg-callback]. A tap doesn't count as activity. The bot asks for it, so more taps would pass for product growth.

A lack of taps doesn't prove someone is a zombie. But if a month goes by with neither actions nor taps, ask directly: "Do you still need these reminders?" The query in `examples` finds these people (its thresholds are a rule of thumb).

### The triangle in SQL

The query builds an active-retention triangle for the last seven weeks.

```sql
WITH RECURSIVE
me(telegram_id) AS (VALUES (111111111), (222222222)),  -- your own and your family's accounts
weeks(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM weeks WHERE k < 6),
signal(telegram_id, day) AS (SELECT telegram_id, day FROM user_activity),
users AS (
  SELECT telegram_id, date(first_seen_at) AS d0,
         date(first_seen_at, 'weekday 0', '-6 days') AS cohort
  FROM user_acquisition a
  WHERE first_seen_at > '2000-01-01 00:00:00'           -- skip the import placeholder (2.1)
    AND telegram_id NOT IN (SELECT telegram_id FROM me)
),
cohorts AS (
  SELECT cohort, COUNT(*) AS n FROM users
  WHERE cohort >= date('now', 'weekday 0', '-6 days', '-49 days')
    AND date(cohort, '+20 days') <= date('now')          -- show once week 1 has ended
    AND cohort >= (SELECT MIN(day) FROM signal)          -- before recording began: false zeros
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
  WHERE date(c.cohort, '+' || (7 * w.k + 13) || ' days') <= date('now')
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
```

`users` assigns each person the Monday of their week: `'weekday 0'` moves the date forward to Sunday, and `'-6 days'` goes back to Monday. Your own accounts are excluded: as the product's most loyal users, you'd lift a small cohort's plateau. The `2000-01-01` placeholder is what the import in [chapter 2.1](#ch-2-1) gave people without an arrival date. Filtering by date rather than by `legacy` keeps older users who have a real date.

`cohorts` drops cohorts that arrived before recording began; otherwise their weeks would show false zeros. `hits` turns each active day into a week number counted from the person's first day. Week 0 is the first seven days; it isn't in the table, because `/start` also counts as activity. Week 1 is days 7–13.

The condition in `cells` keeps a cell empty until the whole cohort has lived through that week. Example: the cohort of August 3, and a person who arrived on Sunday, August 9. Their week 1 runs August 16–22, so the cell appears on August 23: 7 · 1 + 13 = 20 days after August 3.

Each cell is a share of everyone who arrived in the cohort. The variants (passive, "in touch," activated users only and "in week N or later") are in `examples/tracking/queries.sql`.

::: warning
**Small things that will skew your lines.** Dates are in UTC: in Vladivostok, on Russia's Pacific coast (UTC+10), Monday morning before 10:00 is still Sunday. The first partial week of recording drops out because cohorts start on Mondays; that's normal.

Holiday weeks sink every line at once, so mark them. Log the date of every change to what counts as activity: a new button will lift the line without improving the product. Count group activity separately, per chat ([chapter 2.1](#ch-2-1)).
:::

### How to read the triangle

Suppose that on Sunday, September 27, the query returned this table. The numbers are made up for illustration:

| Cohort (week of) | People | Wk 1, % | Wk 2, % | Wk 3, % | Wk 4, % | Wk 5, % | Wk 6, % |
|---|---|---|---|---|---|---|---|
| Aug 3 | 52 | 21 | 15 | 13 | 12 | 12 | 12 |
| Aug 10 | 47 | 19 | 15 | 11 | 11 | 11 | |
| Aug 17 | 118 | 8 | 4 | 3 | 2 | | |
| Aug 24 | 44 | 27 | 20 | 16 | | | |
| Aug 31 | 58 | 28 | 21 | | | | |
| Sep 7 | 49 | 29 | | | | | |

Read the rows first. The August 3 and August 10 cohorts lose people for three weeks and then hold at 11–12%. That's the plateau. The key takeaway of this section: **look at whether a row levels off, not at how high it starts.**

Then read the columns. From August 24 on, week 1 is higher: 27–29% versus 19–21%. If you fixed the time zone step in onboarding around then ([chapter 2.2](#ch-2-2)), that's a reason to keep watching, not a conclusion. The difference is within the noise, and the channel mix may have changed too; check the report from [chapter 2.1](#ch-2-1).

The August 17 cohort looks like a paid placement that drew the curious: twice the people, with week 1 two to three times lower. It also shows why you can't use a single average across the whole user base. In the August 3 and 10 cohorts, 20 people out of 99 were active in week 1, or 20%. Add August 17 and it becomes 29 out of 217, or 13%, though the product didn't change.

The overall triangle answers how many arrivals stay, and it depends on channels and onboarding. The activated-only triangle answers whether the product keeps those who got value. Suppose that in the August 3 cohort, 13 people got their first reminder within their first seven days (week 0). By week 6, six of them are still with us, 46%.

The three lines for that cohort (illustration):

| Week | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Active, people | 11 | 8 | 7 | 6 | 6 | 6 |
| Passive only, people | 5 | 6 | 6 | 6 | 5 | 5 |
| In touch, people | 16 | 14 | 13 | 12 | 11 | 11 |
| In touch, % of 52 | 31 | 27 | 25 | 23 | 21 | 21 |

Five or six people get reminders every week and say nothing. Whether they're happy or zombies, the "sign of life" taps and a direct question after a month of silence will tell.

::: warning
Look for the plateau on the active line only. The passive line flattens by itself: a recurring event sends reminders every week, even if the person stopped reading the chat long ago.
:::

### One number a week

The step in [chapter 0.1](#ch-0-1) had you write down how many people other than you and your family used the product last week. Now that number computes itself:

```sql
WITH me(telegram_id) AS (VALUES (111111111), (222222222)),  -- your own and your family's accounts
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
```

The query returns three numbers for last week, Monday through Sunday. The first two count people who did something themselves and people who only received a reminder; the third is their sum.

A reminder doesn't count if the person blocked the bot within the next seven days: it was probably annoying (rule of thumb). So the passive part is final only a week later. A block detected through a 403 error reaches the bot late, at the next send; `my_chat_member` is more accurate.

Next to it, keep a split of active users into new, regular and returning; the query is in `examples`. Regular users were active in at least one of the two previous weeks: with a weekly rhythm, skipping a week is normal. Returning users come back after a break of two weeks or more, a coarser split than Duolingo's. "Unknown" users arrived before recording began and have no earlier recorded activity to compare with.

::: case
Suppose the expense-tracking bot's passive value is a weekly category summary. A person logs expenses in fits and starts but opens the summary every Sunday. Summaries go into the same log with `kind = 'weekly_summary'`, and in the passive-line queries `'reminder'` becomes `'weekly_summary'`.

Zombies are more dangerous here: an unread summary creates an illusion of value. A button under the summary can be useful in its own right, such as "Details" for the biggest category. Tapping it is a real action, not politeness at the bot's request.
:::

### Small numbers

A rough gauge of noise: the spread of a share p in a cohort of n people is about ±2·√(p(1−p)/n). With 50 people and 20%, that's ±11 points; with 12 people, ±23 (rule of thumb: check it against your own data). With 50 per cohort, you can see a plateau only across several cohorts in a row.

Two workarounds help. The first is monthly cohorts with four-week periods: less noise, but you'll see the effect of a fix later.

The second is individual paths: for each arrival in the past five weeks, a query in `examples` lists the weeks with actions and with reminders. The line "actions: 0 1 4, reminders: 1 2 3 4" tells a story. The person tried the bot, went quiet under reminders for two weeks, then came back. Ten such lines explain more than a triangle built on ten people.

### If there's no plateau

If every row creeps toward zero, start with the few who stayed. Read their paths and send each of them a personal message through the bot that asks a question; don't broadcast ([chapters 1.2](#ch-1-2), [5.8](#ch-5-8)). Then check activation ([chapter 2.2](#ch-2-2)): perhaps too few people reach the value. This is a starting point, not a recipe.

## Your step

::: step
Tonight: two tables and one number. You'll need the tables from chapters [2.1](#ch-2-1) and [2.2](#ch-2-2), including the `bot_status` block log.

1. Create `user_activity` and `reminder_deliveries`. Create the second even if your bot never writes first: an empty table costs nothing, and the queries won't run without it. Wire up `markActive` and, if the bot writes on its own, `recordReminderDelivery`.
2. If you have an events table, import the activity history with the query in `examples`.
3. Put your own and your family's accounts into `me` and run the "one number a week" query.

**Done when** the query runs and your test message shows up as a row in `user_activity`. Without history, the numbers stay at zero until the first full week of recording ends, and the triangle starts filling in after three weeks. Then write the three numbers next to your list from the step in [chapter 0.1](#ch-0-1).

The "sign of life" button can wait until the next evening, once you see how many passive users you have.
:::

**Recap.** The triangle is your main tool for checking fixes: in [chapter 2.5](#ch-2-5) we'll compare cohorts before and after a change. In [chapter 2.4](#ch-2-4) the plateau turns into money: for a subscription, we'll build a payer triangle by month of first payment and revenue per cohort. In [chapter 5.6](#ch-5-6) we come back to zombies and to reminders that don't annoy. And the "other than you" number opens the weekly ritual in [chapter 6.1](#ch-6-1).

[^src-balfour-pmf]: Brian Balfour, "The Never Ending Road To Product Market Fit," December 11, 2013: if the retention curve levels off somewhere, the product has probably found a market for some audience. brianbalfour.com/essays/product-market-fit (accessed September 27, 2026).
[^src-winters-flat]: Casey Winters, "What Is Good Retention: An Exhaustive Benchmark Study with Lenny Rachitsky," 2020, BONUS section: for the demand side of transactional businesses, where the curve flattens matters more than six-month retention, and flattening can take longer than six months. caseyaccidental.com/p/what-is-good-retention-an-exhaustive-benchmark-study-with-lenny-rachitsky (accessed September 27, 2026).
[^src-chen-quettra]: Andrew Chen, "New data shows losing 80% of mobile users is normal, and why the best apps do better," 2015; Quettra data on more than 125 million Android devices over five months starting January 1, 2015; section "Bending the curve happens via activation, not notification spam." andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/ (accessed September 27, 2026).
[^src-lenny-retention]: Lenny Rachitsky, "What is good retention," Lenny's Newsletter, June 9, 2020: a survey of 20 growth practitioners plus public data; user retention at six months. lennysnewsletter.com/p/what-is-good-retention-issue-29 (accessed September 27, 2026).
[^src-amplitude-retention]: Amplitude Docs, "Interpret your retention analysis": the Return On or After (formerly Unbounded), Return On (formerly N-Day) and Return On (Custom) methods. amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-interpret (accessed September 27, 2026).
[^src-duolingo-model]: Jorge Mazal, "How Duolingo reignited user growth," Lenny's Newsletter, February 28, 2023: the new, current, reactivated (7–29 days away), resurrected (30 days or more), at-risk and dormant buckets. lennysnewsletter.com/p/how-duolingo-reignited-user-growth (accessed September 27, 2026).
[^src-tg-my-chat-member-23]: Telegram Bot API, the Update object, `my_chat_member` field: "For private chats, this update is received only when the bot is blocked or unblocked by the user." The list of updates has none for read receipts. core.telegram.org/bots/api#update (accessed September 27, 2026).
[^src-tg-callback]: Telegram Bot API, the InlineKeyboardButton object (`callback_data`, 1–64 bytes) and the CallbackQuery object (the `message` field holds the message with the tapped button). core.telegram.org/bots/api#callbackquery (accessed September 27, 2026).
[^src-tg-errors]: The Bot API has no official list of error texts. A community-maintained list includes, for code 403, "Forbidden: bot was blocked by the user," "Forbidden: bot can't initiate conversation with a user" and "Forbidden: user is deactivated." github.com/vrumger/telegram-errors (accessed September 27, 2026).
[^src-grammy-retry]: grammY, the "Retry API Requests (auto-retry)" plugin: retries a request after a 429 error, waiting for the `retry_after` value from Telegram's response (Bot API, ResponseParameters object). grammy.dev/plugins/auto-retry, core.telegram.org/bots/api#responseparameters (accessed September 27, 2026).
