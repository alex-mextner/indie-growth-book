# 2.2. The Funnel for a Conversational Product {#ch-2-2}

::: skip
If you know the AARRR framework and have already defined an activation event for your product, start with "Stages for a bot." That's where a conversational product's funnel parts ways with a website's.
:::

In [chapter 2.1](#ch-2-1) we learned where a person came from; the next question is what happened to them afterward. A funnel is the sequence of steps from first contact to value and payment, with the share of people who reached each step. Without one, "what should we improve?" becomes an argument about taste. With one, you can see where you lose the most people.

## The gist

### Five stages

In 2007, investor Dave McClure gave a talk called "Startup Metrics for Pirates"[^src-mcclure]. He split the user's journey into five stages. Their initials spell a pirate's "AARRR."

| Stage | Letter | Question |
|---|---|---|
| Acquisition | A | Where do people come from? |
| Activation | A | Did they get their first value? |
| Retention | R | Do they come back? |
| Referral | R | Do they bring others? |
| Revenue | R | Do they pay? |

The framework's value lies in two rules. First, every stage needs a concrete event in your data, not a feeling. "Activation" isn't "they liked it"; it's something like "received their first reminder." Second, watch conversion, the share of people who move from one stage to the next, rather than absolute numbers.

A hundred new users a week is neither good nor bad. Fifteen percent of them coming back in week two is something you can compare and improve.

### The order isn't sacred

McClure listed the stages in the order a person goes through them. In 2017, Gabor Papp proposed RARRA for mobile apps, with retention first[^src-rarra]. His argument: bringing people into a product gets more expensive every year. Spending money on people who leave within a week is a costly way to learn that the product doesn't hold them.

For a small product this is doubly true. If almost no one who arrives stays, your acquisition money buys confirmation of what you already know. Plug the leaks first, then pour more people in at the top.

### Vanity metrics

In The Lean Startup (2011), Eric Ries popularized the idea of vanity metrics: numbers that look good on a slide but can't drive a decision[^src-ries]. The classic example is cumulative user count. It always goes up, even while the product is dying. A funnel guards against this trap: each stage is a share of the previous one, so a drop shows up immediately.

### Activation

Activation is the moment a person first gets what the product exists for. The literature calls it the "aha moment." Sign-up is a promise of value. The first action is an attempt. Activation is the result.

The usefulness of the whole funnel hinges on how you define activation. Define it too early, and the funnel shows good conversion while people keep leaving. Too late, and almost no one reaches it, and you won't understand why.

::: warning
Test your definition with one question: if someone reached this event and then left forever, did they get anything at all? If not, it isn't activation.
:::

## The bridge

### Stages for a bot

A conversational product has no pages and no "Sign up" button. Everything happens in the chat, so each stage has to be tied to an event the bot records itself.

| Stage | Event in the calendar bot | Why this one |
|---|---|---|
| Acquisition | A new person's first `/start` | A deliberate action |
| Activation | First reminder delivered within 7 days of start | The value isn't recording an event; it's a reminder at the right time |
| Retention | In week N after start: active means the person did something; passive means they received a reminder | A calendar is useful even when the person is silent |
| Referral | A new user arrived via an invitation (`invited_by` from [chapter 2.1](#ch-2-1)) | We count the result, not the attempt |
| Revenue | First payment | Tracked once the bot starts charging |

The first instinct is to count a created event as activation. But creating an event isn't value yet. The value is a reminder arriving at the right moment, so the person doesn't forget. If the event is three weeks away, the person may have left before then.

The seven-day deadline makes the funnel computable. Without it, anyone could become "activated" at any time.

The practical conclusion: the bot should help people get their first reminder within the first few days. For example, it could suggest setting something for today or tomorrow. That's an onboarding fix, not a marketing one, and it may pay off more than bringing new people in at the top.

Retention has a similar trap. Most of a calendar's value is passive: a person receives reminders and writes nothing for weeks. So retention here is two lines, active and passive. Why one isn't enough and how to count both is the subject of [chapter 2.3](#ch-2-3).

::: case
If activation is already defined as "created an event," test that definition with one query: of those who "created an event," how many had at least one reminder fire in their first week? If a noticeable share had none, activation sits too early: by reminder time, the bot is already an unfamiliar chat at the bottom of the list.
:::

::: case
The expense-tracking bot delivers a different kind of value. Logging an expense is an action; the result is seeing, for the first time, where the money went. Suppose its activation is "received a first category summary with at least five expenses." The summary should arrive seven days after the person's start, not on a fixed weekday such as Sunday. Otherwise activation would depend on which day the person arrived.
:::

### A signal websites don't get: the block

A website doesn't know when someone stops using it. A bot does. When a user blocks the bot in a private chat, Telegram sends a `my_chat_member` update with status `kicked`, and on unblocking, with status `member`[^src-tg-chatmember]. Sending a message to someone who blocked the bot returns a 403 error.

Record both statuses in a separate log, not as a funnel step: people block and unblock bots, and the latest status is what matters. The log schema and the `recordBotStatus` function are in `examples/tracking`.

```typescript
bot.on("my_chat_member", (ctx) => {
  const status = ctx.myChatMember.new_chat_member.status; // "kicked" | "member" | ...
  if (status === "kicked" || status === "member") recordBotStatus(db, ctx.from.id, status);
});
```

The handler writes the status to the log; on the first block, the function also marks the `bot_blocked` step for the funnel. Blocking is a conversational product's only direct "I'm gone" signal. [Chapter 5.6](#ch-5-6) covers which frameworks drop this update by default and how to handle blocks.

### The onboarding micro-funnel

Between `/start` and activation, the calendar bot has several steps: choosing a language, setting a time zone, the first message, the first event. Connecting Google Calendar is optional; count it separately. Each step is a place where someone can leave. Record them in a table.

```sql
CREATE TABLE IF NOT EXISTS funnel_events (
  telegram_id INTEGER NOT NULL,
  step        TEXT    NOT NULL,
  at          TEXT    NOT NULL,
  PRIMARY KEY (telegram_id, step)
);
```

A primary key on the user-plus-step pair means each step is recorded once, the first time it's completed. For a funnel, all you need is the fact: reached it or not.

```typescript
function markStep(db: Database, userId: number, step: string): boolean {
  const res = db.run(
    `INSERT OR IGNORE INTO funnel_events (telegram_id, step, at)
     VALUES (?, ?, datetime('now'))`,
    [userId, step],
  );
  return res.changes === 1; // true if the step was recorded for the first time
}

markStep(db, userId, "language_chosen");           // after the language is saved
markStep(db, userId, "timezone_set");              // after the time zone is saved
markStep(db, userId, "first_event_created");       // event saved
markStep(db, userId, "first_reminder_delivered");  // reminder sent without error
```

Call `markStep` where a step finishes, not where it begins. The `start` step is recorded by `recordStart` from [chapter 2.1](#ch-2-1), and only for new people. Otherwise an existing user tapping `/start` out of habit would look like a failure at the very first step. The first-message steps are recorded in a special way, covered below.

### How to read the funnel

A funnel is computed per cohort: a group of people who arrived in the same period. The query below takes people who arrived between three weeks and one week ago. It counts a step if the person completed it within their first seven days.

```sql
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
```

`cohort` selects people who had at least seven days to reach activation. Those who arrived yesterday wouldn't have had time and would drag the lower steps down. The funnel's first row is the whole cohort. `steps` sets the step order; if you reorder your onboarding, reorder it here too, or a share will climb past 100%.

The final `SELECT` computes the shares with window functions. They calculate a value from neighboring rows: `LAG` takes the previous row, `FIRST_VALUE` the first one. SQLite has had them since version 3.25.

The first people enter the cohort eight days after you ship the tracking; a full two-week cohort takes three weeks. Suppose the result looks like this (numbers for illustration):

| Step | People | From previous, % | From start, % |
|---|---|---|---|
| `start` | 200 | — | 100 |
| `language_chosen` | 164 | 82 | 82 |
| `timezone_set` | 98 | 60 | 49 |
| `first_message_sent` | 90 | 92 | 45 |
| `first_event_created` | 64 | 71 | 32 |
| `first_reminder_delivered` | 42 | 66 | 21 |

The "from start" column shows what share of arrivals reached each step. The "from previous" column shows where it breaks. Here the biggest drop is the time zone: four in ten people leave at "What city are you in?" That's the place for the first fix.

Is 21% to activation good? There's no universal benchmark: products differ in what value they deliver and how fast. Compare a cohort with your own previous one, not with someone else's numbers from the internet.

The bot has no access to a person's country or time zone. A Telegram user profile has only an optional language code, usually just `ru` or `en`[^src-tg-user]. Options for the fix:

- postpone the question until the first event with a specific time, when you can't do without a time zone;
- offer the three or four most common time zones as buttons, plus a "Send location" button;
- in a mini app, take the time zone from the browser.

The next cohort will show which option is better. How to compare options on two hundred users is covered in [chapter 2.5](#ch-2-5).

::: tip
Overall conversion is the product of the conversions at every step. So the same relative improvement at any step gives the same result. Raise "time zone" from 60 to 80%, and about 56 people out of two hundred reach a reminder instead of 42. The same 1.33× lift at the last step also gives 56.

An early drop is worth fixing first for other reasons:

- more people pass through it, so the effect of a fix shows up faster;
- onboarding fixes are usually simpler than fixes to the product's core;
- every person who clears an early step gives you data on the later ones.
:::

### Funnel by source

Combine the funnel with attribution, and it answers a practical question: which channel brings people who reach the value?

```sql
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
```

The query joins funnel steps to sources and, for each source, counts starts, created events and activations. In SQLite, `SUM(f.step = 'start')` counts the rows where the condition is true. Once you've added `markStep`, rewrite the report from [chapter 2.1](#ch-2-1) on top of this table too, so each fact has a single source.

The picture from chapter 2.1, lots of starts from the paid placement and few events, is now visible step by step. If the placement's drop-off falls at the first message, people didn't understand what to write. They need a different first screen: they came without a task, and the bot has to suggest one. More on that in [chapter 5.2](#ch-5-2).

### Misunderstood messages

On a website the path is predictable: pages, buttons, forms. In a chat, a person can write anything.

Did the bot understand "Move my haircut to after lunch"? What about "gym, the usual"? A misunderstood first message is a leak that a website's funnel doesn't have.

So there are two steps. `first_message_sent`: the person wrote their first free-form message. `first_message_understood`: the bot took an action on **that** message: it created, changed or showed an event.

```typescript
function markFirstMessage(db: Database, userId: number, understood: boolean) {
  const isFirst = markStep(db, userId, "first_message_sent"); // true if recorded for the first time
  if (isFirst && understood) markStep(db, userId, "first_message_understood");
}
```

The second step is recorded only together with the first; otherwise an understood fifth message would count as an understood first. That's why `markStep` returns whether the step was recorded for the first time. The understood share is the second divided by the first. If it's six in ten, four people in ten see "I didn't get that" in their first minute with the bot.

::: warning
The texts of misunderstood messages are the best material for fixes, but they're personal data, sometimes very private. By default, store a category rather than the text: "time not recognized," "unknown command." Store texts only with the person's explicit consent (say, a "Help improve the bot" button), briefly, and with automatic masking of names and numbers. If the bot calls an external AI model, the text already goes to that provider, and your privacy policy must say so. More in [chapter 5.8](#ch-5-8).
:::

### Every stage costs money

For an AI product, the funnel is also a bill. Someone who finished onboarding and wrote three messages has already spent tokens, the units AI model providers use to meter requests, even without activating. In [chapter 2.4](#ch-2-4) we'll attach a cost to every step and test a hypothesis. Non-activated users may cost more than activated ones, because they write more messages trying to figure out how the bot works.

### Small numbers

With fewer than thirty new people a week, funnel percentages are noise, just like in the report from [chapter 2.1](#ch-2-1). In that case, read the path of everyone who didn't reach activation:

```sql
SELECT step, at FROM funnel_events WHERE telegram_id = ? ORDER BY at;
```

The query shows which steps one person completed and when. Five such stories often explain more than any table.

## Your step

::: step
Tonight:

1. Write a five-row table for your product: stage, event in the data, why this one. Think about activation separately, using the question from the box at the start of the chapter.
2. Add `markStep` calls for the steps from start to activation, plus the block handler.

**Done when** you've gone through onboarding from scratch and seen your steps in `funnel_events`. You'll need a second Telegram account or a test copy of the bot; don't delete product tables from the production database. To see the last step, set a reminder five minutes out.
:::

**Recap.** The funnel query becomes part of the weekly ritual in [chapter 6.1](#ch-6-1). In [chapter 2.3](#ch-2-3) we extend the funnel to the right, past activation, and measure retention. In [chapter 2.4](#ch-2-4) we attach a cost to each stage, and in [chapter 2.5](#ch-2-5) we learn to compare variants of a step on small numbers.

[^src-mcclure]: Dave McClure, "Startup Metrics for Pirates: AARRR!," September 6, 2007, 500hats.typepad.com/500blogs/2007/09/startup-metrics.html; slides: slideshare.net/slideshow/startup-metrics-for-pirates-long-version/89026 (accessed September 27, 2026).
[^src-rarra]: Ben Crouch, "AARRR vs RARRA: Pirate Metrics Explained," Mind the Product, October 8, 2020; the RARRA model was proposed by Gabor Papp in 2017 on mobilegrowthstack.com (accessed September 27, 2026).
[^src-ries]: Eric Ries, The Lean Startup, Crown Business, 2011.
[^src-tg-chatmember]: Telegram Bot API, the `my_chat_member` field of the Update object: in private chats it arrives only when the user blocks or unblocks the bot. core.telegram.org/bots/api (accessed September 27, 2026).
[^src-tg-user]: Telegram Bot API, the User object: the `language_code` field is an "IETF language tag of the user's language," optional; there are no country or time zone fields. core.telegram.org/bots/api#user (accessed September 27, 2026).
