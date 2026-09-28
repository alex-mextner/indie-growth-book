# 5.6. Retention in a Conversational Product {#ch-5-6}

::: skip
If you know the Hooked model and the debate over notification frequency, start with "The bridge." The code is TypeScript + Bun; for Python, see the note in [chapter 0.1](#ch-0-1). You'll need the tables from chapters [2.1](#ch-2-1)–[2.3](#ch-2-3), `messaging_optout` from [5.2](#ch-5-2) and the experiment groups from [2.5](#ch-2-5); without them, use the fallback in "Segments by behavior."
:::

In [chapter 2.3](#ch-2-3) we learned to see who stays; here we look at what makes people stay. In a conversational product, the whole app is the chat. Every bot message is either value or a reason to block the bot.

## The gist

### Habit and trigger

**Retention** rests on habit: a person comes back without having to decide to each time. In *Hooked* (2014), Nir Eyal described a cycle[^src-eyal-hooked-56]: a **trigger** (a reason to open the product), an action, a **variable reward** and an investment.

The first triggers are external: an email, a link, a badge. Over time, Eyal argues, internal triggers replace them: a situation itself reminds the person of the product. Investment, such as data, settings or invited friends, makes the next loop more valuable.

Critics compare the variable reward to a slot machine[^src-harris-56]. Eyal himself suggested asking whether you'd use the product yourself and whether it improves people's lives[^src-eyal-matrix-56]. A calendar doesn't need unpredictability, so we take only the external trigger and the investment from the model.

Habits form slowly: in a 2010 study by Phillippa Lally and colleagues, modeled automaticity plateaued after 18 to 254 days. Anything beyond the 84 days of observation is extrapolation[^src-lally-56]. The median of 66 days comes from 39 of the 82 participants. A single lapse didn't hurt; our rule of thumb is that a missed week isn't churn.

### Notification fatigue

**Notification fatigue** sets in when messages come so often that people stop reading them or turn them off. In a year-long experiment at Meta, Facebook sent only notifications people were predicted to rate 5 out of 5[^src-meta-notif-56]. At first people used the app less; after a year, more. The team's conclusion: "long-term effects may be different from short-term effects, or even the opposite."

At Duolingo, reminder text a person had seen recently worked worse than fresh text. Accounting for that wear-out raised daily active users by 0.5% and new-user retention by 2%[^src-duolingo-bandit-56].

In a 2019 experiment, 237 people were assigned to one of four regimes: notifications as usual, batched three times a day, batched hourly, or none[^src-fitz-56]. Batching made people calmer, while going without notifications made them anxious. This is about phones in general, not bots. We found no established norm for message frequency, so the budget below is a rule of thumb.

### Value you don't have to open

A reminder is useful even if the chat stays closed: the person reads it on the lock screen and acts on it. Using Quettra's data, Andrew Chen concluded that activation, not a stream of notifications, bends the retention curve[^src-chen-quettra-56]. Our takeaway: a reminder the person set up themselves is the product, not a marketing blast.

The key takeaway of this section: **a bot message retains people only when the message itself is value; every other message spends trust.**

A bot that only replies waits to be remembered. A bot that writes first gets an external trigger; the question is what to write and how often.

## The bridge

::: note
Terms from chapters 2.3 and 2.6: the **active line** counts people who acted themselves in a week; the **passive line**, people who got a reminder. "In touch" is their union ([chapter 2.3](#ch-2-3)); the triangle is cohort retention by week since arrival. A guardrail is a metric that mustn't get worse, and the quarterly metric is the one number you're trying to grow ([chapter 2.6](#ch-2-6)).
:::

The code with tests is in the `examples/retention` folder[^src-examples-retention-56]. `initRetention(db, [your ids])` creates the `me` table and the `billing_pending` queue. `me` holds your own accounts: one list shared by every query.

### Which messages a bot may send

Telegram's terms forbid unsolicited messages ([chapter 5.8](#ch-5-8)), but not writing first: a bot can only write to people who started it. Our reading: you may message such people when it's relevant, with a "Stop messaging me" button, within the limits from chapter 5.8. Spam is a broadcast to everyone about something they didn't ask for, with no way to opt out.

Every kind of bot message is listed in the table below and in `KINDS` in `retention.ts`:

| Message | `kind` | Initiative | When and how often |
|---|---|---|---|
| Event reminder | `reminder` | the person asked | at the requested time; only a block stops it |
| Weekly summary, if turned on | `weekly_summary` | the person asked | daytime, once a week, if there are events |
| Subscription renewal failed | `billing` | the person paid | daytime, once, outside the budget |
| Gentle nudge for a new user ([chapter 5.2](#ch-5-2)) | step `nudge_sent` | the bot | daytime, once, within the budget |
| "Do you still need these reminders?" for zombies | `zombie_check` | the bot | daytime, within the budget |
| One message to a dormant user | `reengage` | the bot | daytime, within the budget, with a control group |
| Bot news | `announce` | the bot | daytime, within the budget, ideally never |

"Stop messaging me" stops everything except reminders and `billing`; people opt out of reminders by deleting the event. The `reminder` kind is for real reminders only. Otherwise a broadcast inflates the passive line ([chapter 2.6](#ch-2-6)).

::: note
This isn't legal advice. A message about a new feature may count as advertising. If your bot serves users in Russia, Russian advertising law applies (38-FZ, Art. 18, Parts 1–2)[^src-38fz-56]. Sending ads to them over telecom networks requires the recipient's prior consent, and automated ad mailings are banned.

In the EU, direct marketing by email requires consent (ePrivacy, Art. 13)[^src-eprivacy-56]; whether that covers messaging apps is a question for a lawyer. The safe path: write on your own initiative only about the person's events and data, and ask for explicit consent before sending news.
:::

### The message budget

A **message budget** is a weekly cap on bot-initiated messages per person, shared across all kinds: the gentle nudge, `zombie_check`, `reengage`, `announce`. Our rule of thumb is one a week; check it against your own data. Reminders, the summary and `billing` don't count toward it.

A shared cap prevents collisions. On Tuesday, one job asks a zombie "Do you still need these reminders?"; on Thursday, another wants to send news. With a budget, Thursday's message waits.

```typescript
// examples/retention/retention.ts
const slot = reserveMessage(db, userId, "zombie_check", tzOf(userId));
if (slot.ok) {
  const m = await bot.api.sendMessage(userId, text, { reply_markup: keyboard });
  confirmMessage(db, slot.id, m.message_id);  // on error: releaseMessage(db, slot.id)
}
```

Run every bot message through `mayWrite`: it always lets a reminder through unless the person blocked the bot. For everything else, `reserveMessage` checks the budget and writes the log in one `BEGIN IMMEDIATE` transaction, so two jobs can't both slip past it. Reminders are logged by `recordReminderDelivery` ([chapter 2.3](#ch-2-3)). `message_budget` shows overruns, and `blocks_by_kind` shows blocks by message kind.

The budget's guardrail is blocks ([chapters 2.5](#ch-2-5), [2.6](#ch-2-6)). If people block the bot noticeably more often after a given kind of message than after reminders, cut it back. With small numbers, "noticeably" means a severalfold difference for several weeks in a row.

::: note
The bot learns about a block from the `my_chat_member` update ([chapter 2.2](#ch-2-2)). Telegram sends it by default, but an `allowed_updates` list changes the set; if you don't pass one, the previous setting stays[^src-tg-updates-56].

In grammY, if you list update types in `bot.start({ allowed_updates })`, add `my_chat_member`[^src-grammy-updates-56]. In aiogram 3, no `my_chat_member` handler means no such update[^src-aiogram-updates-56]. Either way, a block then surfaces only as a 403 error on the next send.
:::

### Segments by behavior

Let's split people into seven segments using the tables from [chapter 2.3](#ch-2-3):

| Segment | How to tell | What to send |
|---|---|---|
| New | arrived within 14 days | onboarding and one gentle nudge ([chapter 5.2](#ch-5-2)) |
| Active | did something themselves within 14 days | only what they asked for |
| Passive, alive | no actions for 14 days, reminders arriving, a sign of life within 28 days | reminders only: they are the value |
| Zombie | reminders arriving, no sign of life for 28 days | one `zombie_check` question |
| Dormant | neither actions nor reminders for 14 days, got value before | one message with new value |
| Never reached value | same, but never got value | nothing: this is onboarding's job |
| Blocked or unreachable | last status `kicked` or `gone` | nothing |

A sign of life is an action or a tap on "Got it, thanks" ([chapter 2.3](#ch-2-3)); the bot can't see a muted or archived chat. The core of the `user_segments` query:

```sql
CASE
  WHEN last_status IN ('kicked', 'gone')             THEN 'blocked'
  WHEN first_seen_at >= datetime('now', '-14 days')  THEN 'new'
  WHEN last_act >= date('now', '-14 days')           THEN 'active'
  WHEN got_reminders AND (last_act >= date('now', '-28 days')
                          OR last_ack >= date('now', '-28 days')) THEN 'passive_alive'
  WHEN got_reminders                                 THEN 'zombie'
  WHEN had_value                                     THEN 'dormant'
  ELSE 'never_activated'
END AS segment
```

The first match from the top wins: someone active yesterday who blocked the bot today is no longer active. `gone` means the person is unreachable (deleted account, chat not found) and doesn't count as a block. Opting out of messages is a separate flag, `opted_out`.

The windows here are 14 days, while the quarterly metric is weekly, so don't compare the numbers directly. Zombies aren't in the quarterly metric, and there's no reason to stop their reminders: to the bot, a zombie looks like a happy, quiet user. Ask once, with "Yes, keep them" and "Pause reminders" buttons; silence isn't an answer.

Without the chapter 2.3 tables, build rough segments from your logs: the date of the person's last message and of the bot's last send.

A bot without reminders, such as an AI assistant, has only four segments: new, active, dormant and blocked. Its only value that doesn't require opening the chat is what it sends on its own, like the expense-tracking bot's weekly summary ([chapter 2.3](#ch-2-3)).

`segment_counts` counts the segments and leaves out your own accounts listed in `me`. An illustration:

```text
segment          users
never_activated     88
blocked             63
dormant             53
passive_alive       22
active              19
new                 17
zombie              11
```

### Dormant users: one message with new value

"We miss you" is a request, not value. Write only when there's something new for this particular person. Suppose the bot has gained recurring events:

```text
Now you can set a repeat in one phrase: "training every Tuesday at 7 PM."
Want to set up one of your events the same way?
[Set a repeat]  [Stop messaging me]
```

A person becomes dormant after 14 days of silence; you may write to them from day 31, and never after day 180 (rule of thumb). So `reengage_candidates` returns fewer candidates than there are dormant users. People who opted out, are unreachable or got a message within 30 days are excluded.

Dormant users sometimes come back on their own, so the bot doesn't write to some of the candidates. That's the **control group**, or holdout.

A one-off message is a single attempt, so statistical power matters most: split the candidates in half. A permanent rule, such as the summary, can be tested for months with a 10% control group, but only if you have thousands of users. With hundreds, split in half or alternate weeks ([chapter 2.5](#ch-2-5)). With 50 users, a control group shows nothing: send the wave to everyone, watch blocks and opt-outs, and draw conclusions wave by wave.

```typescript
// examples/retention/retention.ts; GrammyError carries error_code, description and parameters
const wave = await runReengageWave(db, "reengage_1026", tzOf, async (id) =>
  (await bot.api.sendMessage(id, text, { reply_markup: keyboard })).message_id);
// { sent, holdout, unreachable, failed }
```

Run `runReengageWave` every hour during the day (cron or `setInterval`): each person's group is written once, so there are no repeats. The function takes candidates for whom it's daytime right now and splits them with the `assignVariant` hash from [chapter 2.5](#ch-2-5). It sends at most 25 messages per second; on a 429 error it waits for `retry_after`.

`classifySendError` sorts errors into blocked, unreachable, "retry later" and other. A person is recorded in group B only once the send has a final outcome; a network failure leaves them a candidate. Someone who blocked the bot stays in B. Group A has just as many such people, and dropping them from B alone would tilt the result toward the message.

After 14 days, `reengage_outcome` counts who came back, opted out or blocked the bot; "Stop messaging me" doesn't count as coming back. `reengageEffect` gives the difference with Newcombe's interval from [chapter 2.5](#ch-2-5): 3 out of 10 versus 1 out of 10 is still noise. If opt-outs and blocks in B outnumber the extra returns, don't send that message again.

### Renewal failed

Since Bot API 10.2, a bot receives the `subscription` update with the state `canceled`, `active` or `failed`. The last one means the renewal payment didn't go through[^src-tg-subscription-56] ([chapter 5.5](#ch-5-5)). This is about something the person paid for, so one message goes out regardless of the budget and of "Stop messaging me." The update arrives once, at any hour, but you should write only during the day, hence the queue:

```text
Your subscription didn't renew: your balance was short of Stars.
[Top up Stars]
```

```typescript
bot.on("subscription", (ctx) => {                       // examples/retention/retention.ts
  const s = ctx.update.subscription;
  onSubscriptionUpdate(db, s.user.id, s.state, s.invoice_payload, priceOf(s.invoice_payload));
});
// every hour during the day, next to the dormant-user wave:
await sendPendingBilling(db, tzOf, async (n) => (await bot.api.sendMessage(n.telegram_id, text,
  { reply_markup: topUpButton(n.stars) })).message_id);
```

`failed` puts the person in the queue; `active` and `canceled` take them out. During the day, the message goes out and is logged as `billing`. The button is a `tg://stars_topup?balance=<price>` link that tops the balance up to the required amount[^src-tg-topup-56].

### Groups

Our hypothesis: a shared family or team calendar, added through a `startgroup` link ([chapter 5.2](#ch-5-2)), retains better than a personal one. To leave it, you'd have to leave the family chat. The unit of accounting is the chat, and experiments split by chat ([chapter 2.5](#ch-2-5)); `examples` has no retention queries by `chat_id` yet. You can't message group members privately if they never started the bot ([chapter 5.8](#ch-5-8)), and in a group, everyone sees an unnecessary message.

### Weekly summary or silence

A summary is a batch instead of a stream, and batches won in the 2019 experiment (see "The gist"). Our rules: only for people who turned it on, only when there are events, with a "Turn off summary" button. It also goes out silently, via the `disable_notification` parameter[^src-tg-updates-56].

```text
3 events this week: Tue 7:00 PM training, Thu 12:00 PM call, Sat 3:00 PM Masha's birthday.
[Open the week]  [Turn off summary]
```

Send it on Sunday around 6 PM in the person's time zone (rule of thumb). An empty summary is just another "we've updated" broadcast.

### The product retains better than messages

Three changes that, we hypothesize, will move retention more than a broadcast:

- Fewer steps to an event: one phrase instead of a question-and-answer dialogue, as in [chapter 5.2](#ch-5-2). AI parsing costs money ([chapter 2.4](#ch-2-4)), but every question you remove is one less reason to leave.
- Recurring events: one investment, reminders every week. The flip side: the passive line grows on its own, and zombies with it.
- Invitations: an invited person who asked for a reminder gets reminders, and their reply gives the organizer a reason to come back ([chapter 3.5](#ch-3-5)).

The key takeaway of this section: **if you can bring someone back either with a product change or with a message, choose the change.** A message pokes everyone; a change works for those who need it.

### How to measure

Test product changes with the before-and-after triangle ([chapter 2.5](#ch-2-5)), and messages with a control group. The guardrails are the shares of blocks and zombies ([chapter 2.6](#ch-2-6)). Meta's lesson: an early dip isn't a verdict, and an early rise isn't a win.

::: warning
Common mistakes:

- "We miss you" to every dormant user, with no control group.
- A chain of three messages to someone who went quiet.
- Scheduling in UTC: in Vladivostok (UTC+10), it's the middle of the night.
- A broadcast logged as `reminder`: an inflated passive line.
- "Stop messaging me" counted as a return: an inflated experiment result.
- Two broadcast jobs without a shared budget.
- `allowed_updates` without `my_chat_member`: hidden blocks.
:::

## Your step

::: step
Tonight: segments and the budget. You'll need the tables from chapters 2.1–2.3 and `messaging_optout` from 5.2; without them, use the fallback from "Segments by behavior."

1. Call `initRetention(db, [your own and your family's ids])` and run `segment_counts`.
2. List every message the bot sends on its own and give each one a `kind` from the table. Send everything except reminders through `reserveMessage`.
3. Run `message_budget`.

**Done when** you have numbers per segment, and `message_budget` shows no overruns or you know which message is to blame. The dormant-user wave with a control group can wait for another evening, after the hypothesis card from [chapter 2.5](#ch-2-5).
:::

**Recap.** Segments and blocks join the weekly ritual in [chapter 6.1](#ch-6-1), and the dormant-user experiment goes into the log in [chapter 6.2](#ch-6-2). Invitations become a viral loop in [chapter 3.5](#ch-3-5). The send queue and limits are in [chapter 5.7](#ch-5-7), and retaining paying users is in [chapter 4.2](#ch-4-2).

[^src-eyal-hooked-56]: Nir Eyal, Ryan Hoover, *Hooked: How to Build Habit-Forming Products*, Portfolio (Penguin), 2014; Russian edition published by MIF. The author's own summary: nirandfar.com/how-to-manufacture-desire/ (accessed September 28, 2026).
[^src-harris-56]: Tristan Harris, "How Technology is Hijacking Your Mind," May 18, 2016, section "Hijack #2." medium.com/thrive-global/how-technology-hijacks-peoples-minds-from-a-magician-and-google-s-design-ethicist-56d62ef5edf3 (accessed September 28, 2026).
[^src-eyal-matrix-56]: Nir Eyal, "The Art of Manipulation," July 3, 2012: the Manipulation Matrix. nirandfar.com/the-art-of-manipulation/ (accessed September 28, 2026).
[^src-lally-56]: Phillippa Lally et al., "How are habits formed: Modelling habit formation in the real world," European Journal of Social Psychology, 40 (6), 2010, pp. 998–1009: 96 participants, 12 weeks. doi.org/10.1002/ejsp.674 (accessed September 28, 2026).
[^src-meta-notif-56]: Analytics at Meta, "Notifications: why less is more," December 19, 2022. medium.com/@AnalyticsAtMeta/notifications-why-less-is-more-how-facebook-has-been-increasing-both-user-satisfaction-and-app-9463f7325e7d (accessed September 28, 2026).
[^src-duolingo-bandit-56]: Kevin P. Yancey, Burr Settles, "A Sleeping, Recovering Bandit Algorithm for Optimizing Recurring Notifications," KDD 2020. research.duolingo.com/papers/yancey.kdd20.pdf (accessed September 28, 2026).
[^src-fitz-56]: Nicholas Fitz, Kostadin Kushlev et al., "Batching smartphone notifications can improve well-being," Computers in Human Behavior, 101, 2019, pp. 84–94: two weeks. doi.org/10.1016/j.chb.2019.07.016 (accessed September 28, 2026).
[^src-chen-quettra-56]: Andrew Chen, "New data shows losing 80% of mobile users is normal, and why the best apps do better," 2015, section "Bending the curve happens via activation, not notification spam." andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/ (accessed September 28, 2026).
[^src-38fz-56]: Russian Federal Law No. 38-FZ "On Advertising" of March 13, 2006, as amended August 4, 2026, Art. 18 Parts 1–2. consultant.ru/document/cons_doc_LAW_58968/ (accessed September 28, 2026).
[^src-eprivacy-56]: Directive 2002/58/EC (ePrivacy), Art. 13 "Unsolicited communications," paragraphs 1–2. legislation.gov.uk/eudr/2002/58/article/13 (accessed September 28, 2026).
[^src-tg-updates-56]: Telegram Bot API 10.3: `getUpdates`, `allowed_updates`: "If not specified, the previous setting will be used"; `sendMessage`, `disable_notification`. core.telegram.org/bots/api (accessed September 28, 2026).
[^src-grammy-updates-56]: grammY, "Reactions": `allowed_updates` in `bot.start()`. grammy.dev/guide/reactions (accessed September 28, 2026).
[^src-aiogram-updates-56]: aiogram 3, "Dispatcher," `start_polling`: "By default, all used update types are enabled (resolved from handlers)." docs.aiogram.dev/en/latest/dispatcher/dispatcher.html (accessed September 28, 2026).
[^src-tg-subscription-56]: Telegram Bot API 10.2: BotSubscriptionUpdated, the `state` field with the values `canceled`, `active` and `failed`. core.telegram.org/bots/api, core.telegram.org/bots/api-changelog (accessed September 28, 2026).
[^src-tg-topup-56]: Telegram, "Deep links," section "Stars topup link"; Bot API, InlineKeyboardButton, the `url` field: "HTTP or tg:// URL." core.telegram.org/api/links, core.telegram.org/bots/api (accessed September 28, 2026).
[^src-examples-retention-56]: github.com/alex-mextner/indie-growth-book, folder `examples/retention`: TypeScript (Bun) code, queries and tests.
