# 2.1. Attribution: Where Each User Came From {#ch-2-1}

::: skip
If you already tag links with UTM parameters, store the first-touch source and review a channel report weekly, jump to "Tag it: the start parameter." That's where a bot starts to differ from a website.
:::

Everything else in this part of the book depends on one piece of knowledge: where each person came from. Funnels, cohorts, acquisition cost, ad tests all need it. Without it, every decision about where to put your next evening or your next $20 is a guess.

## The gist

Attribution answers the question "which channel brought this user?" The answer decides where your time and money go.

The American department-store owner John Wanamaker is credited with the line: "Half the money I spend on advertising is wasted; the trouble is I don't know which half"[^src-wanamaker]. The attribution is disputed, but the problem is described precisely.

A small team differs from a department store only in scale. You wrote a post, bought a paid placement (a sponsored post in someone else's Telegram channel), and asked friends to spread the word. A week later, forty people showed up. You don't know what worked, so next time you'll either repeat everything or pick by mood.

### First touch and last touch

People rarely arrive on the first exposure. They see a post, hear about the product from a friend three days later, and find it through search a week after that. Which channel gets the credit?

- **The first-touch model** credits the channel that brought the person in for the first time. It answers "how do people find out about us?"
- **The last-touch model** credits the last tagged channel before the person started using the product. It answers "what made them decide?"
- **Multi-touch models** split the credit across all touches. You need them when you have dozens of channels and thousands of sign-ups a day.

A small product only needs first touch and last touch, recorded separately. Multi-touch models demand volumes you don't have yet.

### Tags and naming conventions

The web standard is UTM tags (Urchin Tracking Module): the `utm_source`, `utm_medium` and `utm_campaign` parameters in a link. They come from Urchin, an analytics system Google bought in April 2005[^src-utm]. Today Google Analytics, Yandex Metrica (Yandex's web analytics service) and most other systems understand them. A link with `utm_source=threads&utm_medium=bio` says it all: "Threads, profile link."

The naming convention matters more than the tags themselves. A single "threads" tag on every post, your profile and your comments turns into mush within a month. So do ten tags invented on the fly with inconsistent capitalization.

### Dark traffic and self-reporting

In 2012, The Atlantic journalist Alexis Madrigal worked with analysts at Chartbeat to see where the magazine's readers came from. More than half of the visits from social networks and messaging apps, 56.5%, arrived with no source at all[^src-dark-social]. People were sharing links in private messages, and analytics recorded them as "direct" visits. Madrigal called this dark social.

For a Telegram product, dark traffic is the main environment. People forward the bot in private chats, mention it in groups, recommend it by word of mouth. You can't tag all of that.

So you add a second method on top of tags: ask the person where they heard about you (self-reported attribution). The answers are imprecise, but the gap between tag and answer is informative in itself. A tag that says 'no source' next to an answer that says 'a friend sent it' means a working recommendation that links can't see.

## The bridge

The work splits into three parts: tag the links, record the source at first contact, read the report. The full code for this chapter and the next, with tests, is in the `examples/tracking` folder of the book's repository[^src-examples]. The text shows only what you need to follow along.

### Tag it: the start parameter

A bot has no address bar to append UTM tags to. What it does have is a deep link with a `start` parameter:

```text
https://t.me/YourBot?start=src_threads_bio
```

When someone opens that link and taps "Start," the bot receives `/start src_threads_bio`. Per Telegram's documentation, the parameter can be up to 64 characters from the base64url set: A–Z, a–z, 0–9, underscore and hyphen[^src-tg-links]. The button with the parameter also appears for people who already use the bot. So an existing user who opens a link from a new placement will send a tag again, which means first touch must be recorded only once.

We use the scheme `src_<channel>_<placement>[_<variant>]`:

| Tag | Meaning |
|---|---|
| `src_threads_bio` | link in the Threads profile |
| `src_tg_chanA_0927` | paid placement in channel A, run on September 27 |
| `src_tg_chanA_0927_b` | the same placement, second copy variant |
| `src_catalog_apps` | a bot catalog (for example, Telegram Apps Center) |

The `src_` prefix separates source tags from other parameters the bot already understands. The date in a placement tag matters because you'll likely buy placements in the same channel more than once. The copy variant comes into play when you start comparing wordings ([chapter 2.5](#ch-2-5)). Keep a file listing every tag you've issued: in a month you won't remember how `_b` differed from `_c`.

### Tag it: invitations

If your product sends something to people who don't use it yet, you have a built-in growth channel. Think an event invitation, a shared list, a split bill. It needs tagging, or it dissolves into "no source."

An invitation link carries two things: the object token, without which the invitation doesn't work, and the inviter's code. For example, `?start=ev_Ab12Cd34Ef_x9Y8z7W6`. The bot recognizes such links and records the source `src_share`.

If you've already issued links in a different format, teach the parser to recognize those too. Links in old chats still bring people in, and without this they'll land in "no source."

::: warning
No identifiers in plain sight. A Telegram ID in a link that strangers can see is a personal data leak. So is a sequential event number: by iterating over numbers, anyone can open other people's events. The object token and the inviter code are random alphanumeric strings, and the mapping lives on the server.
:::

From the inviter code, the server finds who brought the person in and writes it to the `invited_by` field. The code is validated: a nonexistent code or your own doesn't count. In [chapter 3.5](#ch-3-5) we'll turn this into a viral coefficient: how many new people one user brings in.

::: case
The expense-tracking bot has no "events," but it does have a shared budget for two. When someone adds a partner, the partner gets a link `?start=inv_<budget token>_<code>`. Same scheme, different object. Look for any action in your product that sends a link to another person: that's your `src_share`.
:::

### Record it: one table, one handler

The first-touch source is a property of the user, not of an event. Store it in its own table and never overwrite it.

```sql
CREATE TABLE IF NOT EXISTS user_acquisition (
  telegram_id     INTEGER PRIMARY KEY,
  first_source    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_source     TEXT,
  last_seen_at    TEXT,
  invited_by      INTEGER,
  self_reported   TEXT
);
```

The table holds the first and last source with timestamps, who invited the person, and their answer to "where did you hear about us?" A separate table keeps marketing data apart from product data, so it's easy to export or delete.

The `/start` handler parses the parameter and makes two writes:

```typescript
function recordStart(db: Database, userId: number, payload?: string) {
  const { source, invitedBy } = parsePayload(db, userId, payload);
  const res = db.run(
    `INSERT OR IGNORE INTO user_acquisition
       (telegram_id, first_source, first_seen_at, invited_by)
     VALUES (?, ?, datetime('now'), ?)`,
    [userId, source, invitedBy],
  );
  if (res.changes === 1) markStep(db, userId, "start"); // chapter 2.2
  if (source !== "none") {
    db.run(
      `UPDATE user_acquisition SET last_source = ?, last_seen_at = datetime('now')
       WHERE telegram_id = ?`,
      [source, userId],
    );
  }
}
```

`parsePayload` turns the parameter into a source. A `src_…` tag is taken as is, an invitation link yields `src_share` plus a validated inviter, and everything else is `none`.

`INSERT OR IGNORE` inserts a row only if the user isn't there yet, so first touch is never overwritten. If the row was inserted, the person is new, and we mark the start of the funnel. We cover `markStep` in [chapter 2.2](#ch-2-2); until then, comment that line out. Last touch updates only on a real tag: the bare `/start` people tap out of habit doesn't erase it.

The database writes the timestamp itself with `datetime('now')`. That way all dates share one format and compare correctly.

If your bot already has users, move them into the table with the source `legacy` before launch. Otherwise every existing user who taps `/start` gets recorded as new. The migration query, which handles different date formats, is in `examples/tracking/queries.sql`.

::: case
In the calendar bot, the `/start` handler understood only event links and invitations and silently dropped any other parameter. The bot ran for six months, and we didn't know the most important thing: where people came from. The fix took one evening.
:::

### Record it: the "how did you hear about us?" question

Add one optional multiple-choice question to onboarding (a person's first few minutes with the product). Don't ask it on the first screen. Ask after the first useful action; for the calendar bot, that's a created event. Before then, the person hasn't decided whether to stay, and the question just gets in the way.

```text
By the way, how did you hear about us?
[A friend told me]  [Threads]  [Telegram channel]  [Search]  [Other]
```

Shuffle the order of the first four buttons for each person. Survey researchers have long known about order effects: all else being equal, people pick options near the top of a list more often[^src-primacy]. On "Other," ask one free-text follow-up.

### Read it: the channel report

Once a week, look at one table. It shows how many people came from each source and how many took the first useful action within a week.

```sql
SELECT a.first_source,
       COUNT(*) AS starts,
       SUM(EXISTS (SELECT 1 FROM events e
                   WHERE e.user_id = a.telegram_id
                     AND datetime(e.created_at) <= datetime(a.first_seen_at, '+7 days')))
         AS created_event
FROM user_acquisition a
WHERE a.first_source <> 'legacy'
  AND a.first_seen_at >= datetime('now', '-21 days')
  AND a.first_seen_at <  datetime('now', '-7 days')
GROUP BY a.first_source
ORDER BY created_event DESC;
```

The query takes people who arrived between three weeks and one week ago. For each source it counts starts and the people who created an event within seven days.

The window is shifted back a week and capped at seven days so every newcomer gets the same amount of time. People who arrived yesterday haven't had time to do anything and would drag the result down. Your `events` table and `created_at` field will have their own names.

A created event isn't true activation yet; we give a precise definition in [chapter 2.2](#ch-2-2). For comparing channels against each other, the first useful action is enough.

Here's what the result might look like. The numbers are made up for illustration:

| Source | Starts | Created an event within 7 days |
|---|---|---|
| `src_share` | 31 | 22 |
| `src_threads_bio` | 48 | 14 |
| `none` | 40 | 9 |
| `src_tg_chanA_0927` | 112 | 8 |

The paid placement brought the most starts and the fewest events. The likely explanation: people from someone else's channel came out of curiosity, not with a task. The funnel from [chapter 2.2](#ch-2-2) will help test that.

Invitations brought fewer starts, but seven in ten reached an event, because they arrived with an event already in hand. The chapter's main takeaway: **compare channels by the people who reached the value, not by starts.**

::: note
With fewer than thirty new users a week, the percentages in this report are noise (rule of thumb: check it against your own data). With ten newcomers, one person shifts a percentage by ten points. Look at absolute numbers, use a one-month window, and read individual people's paths; [chapter 2.2](#ch-2-2) shows how.
:::

### Special cases

**A website instead of a bot.** Same scheme. On the first visit, save the source in the browser. On sign-up, send it to the server and write it to the same kind of table, with your user ID instead of `telegram_id`. If the site leads into the bot, the "Open bot" button carries the source into a `start` parameter like `src_web_<source>`. For visitors from the European Union, storing marketing data in the browser requires consent (see [chapter 5.8](#ch-5-8)).

**Mini apps and groups.** For mini apps the parameter is `startapp`, and it goes not to the bot as `/start` but to the app itself, in the `start_param` field[^src-tg-webapps]. First touch has to be recorded on the app's server. The `startgroup` parameter adds the bot to a group, and the unit of accounting becomes the chat. More in [chapter 5.2](#ch-5-2).

**Platforms that dislike links.** Adam Mosseri, who ran Instagram and Threads in 2024, wrote that Threads doesn't deliberately downrank posts with links. But its algorithm places little value on clicks[^src-mosseri]. And people rarely like or comment on such posts.

For attribution, the conclusion is simple. The `src_threads_bio` link lives in the profile, not in the post itself. To estimate how many people found the bot through search after a post, look for a spike in new users with source `none` in the hours that follow.

**Clicks that never became starts.** People who opened the link and changed their mind are invisible to the bot. When you pay for a placement, it's worth counting them. To do that, route the link through your own short URL with a redirect that counts clicks. More in [chapter 5.3](#ch-5-3).

### This is personal data

The table links a person to where they came from and what they answered. That's personal data. Telegram's rules require a bot to have a privacy policy available to users. If the bot collects anything not covered by Telegram's standard policy, you need your own, linked in @BotFather.

The data must be deleted at the user's request and once it's no longer needed[^src-tg-terms]. A function that deletes a person from every table in this chapter and the next in one go is in `examples/tracking`.

::: warning
Before launch, check what the law of your users' country requires. For Russian citizens, that's Federal Law No. 152-FZ[^src-152fz]. You must notify Roskomnadzor (Russia's communications and data-protection regulator) that you process personal data. Their data must be recorded and stored on servers in Russia. Sending data abroad, including to your AI model provider, follows separate rules. For the European Union, it's the GDPR.

This isn't legal advice. Details in [chapter 5.8](#ch-5-8).
:::

## Your step

::: step
Tonight: start recording the source on `/start`.

1. Open your `/start` handler and check what happens to a parameter it doesn't recognize.
2. Create the `user_acquisition` table, move existing users into it with the source `legacy`, and add a write on start.
3. Issue one tag, for your social media profile, and add it to your tag file.

**Done when** you've opened a link with your tag and seen it in the database. From your own account the tag shows up in `last_source`; to check `first_source`, delete your row before testing.

Invitations with codes are for the next evening: the code from `examples/tracking`, plus a check that your event-link parser accepts an optional code at the end.
:::

**Recap.** The first-touch table is the foundation for the chapters that follow. In [chapter 2.2](#ch-2-2) we build a funnel on top of it and define activation precisely. In [chapter 2.3](#ch-2-3) we group users by the week they arrived and see whether they come back. In [chapter 2.4](#ch-2-4) we divide the money spent by the number of activated users and get the cost of acquisition.

[^src-wanamaker]: Quote Investigator, "Half the Money I Spend on Advertising Is Wasted," April 11, 2022: the earliest attribution to Wanamaker found dates from 1919, and his authorship is unconfirmed; the line is also attributed to William Lever. quoteinvestigator.com/2022/04/11/advertising/ (accessed September 27, 2026).
[^src-utm]: "UTM parameters" and "Google Analytics," English Wikipedia: UTM was introduced by Urchin; Google bought Urchin Software Corp. in April 2005 (accessed September 27, 2026).
[^src-dark-social]: Alexis C. Madrigal, "Dark Social: We Have the Whole History of the Web Wrong," The Atlantic, October 12, 2012. Chartbeat data: 56.5% of The Atlantic's social traffic arrived without a source.
[^src-examples]: github.com/alex-mextner/indie-growth-book, folder `examples/tracking`: schema, TypeScript (Bun) code and tests.
[^src-tg-links]: Telegram, "Deep links," section "Bot links," core.telegram.org/api/links (accessed September 27, 2026).
[^src-primacy]: Jon A. Krosnick, Duane F. Alwin, "An Evaluation of a Cognitive Theory of Response-Order Effects in Survey Measurement," Public Opinion Quarterly, 1987.
[^src-tg-webapps]: Telegram, "Telegram Mini Apps," core.telegram.org/bots/webapps (accessed September 27, 2026).
[^src-mosseri]: Adam Mosseri, Threads post, November 21, 2024: "We don't downrank links, but we don't place much value on p(click) and people don't like and comment on links much." threads.com/@mosseri/post/DCpQG0hz0m8 (accessed September 27, 2026). Since July 2025, Threads has been led by Connor Hayes.
[^src-tg-terms]: Telegram, "Bot Platform Developer Terms of Service," section 4, telegram.org/tos/bot-developers (accessed September 27, 2026).
[^src-152fz]: Russian Federal Law No. 152-FZ "On Personal Data" of July 27, 2006: Art. 18(5) (localization of databases with Russian citizens' data), Art. 22 (notifying the authorized body), Art. 12 (cross-border transfer). Current version at consultant.ru (accessed September 27, 2026).
