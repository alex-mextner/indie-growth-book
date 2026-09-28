# 5.2. Deep Links, Tags, and 60-Second Onboarding {#ch-5-2}

::: skip
Already know the kinds of bot links and tag `?start=` with the scheme from [chapter 2.1](#ch-2-1)? Start at "One tag, three fields." If your tags are in order but people leave before first value, go straight to "Onboarding by parameter."
:::

In [chapter 2.1](#ch-2-1), the `start` parameter answered the question "where did this person come from?" Here it does a second job: it decides what the person sees right after the bot card from [chapter 5.1](#ch-5-1). A link from a post about a family calendar and an invitation to dinner lead to the same bot. They shouldn't open the same screen.

## The gist

### Time to first value

**Time to first value** (TTFV) is the time from first contact until a person gets what they came for. It isn't the same as activation from [chapter 2.2](#ch-2-2). For the calendar, activation is a delivered reminder, and that can come three days later. First value comes sooner: the bot understood the request and replied, "I'll remind you Friday at 6 PM."

Why a minute? We found no reliable, widely accepted benchmark, so this is our rule of thumb: check it against your own data. People open a bot between two other things, and every question before value is a chance to get distracted.

In [chapter 2.3](#ch-2-3) we cited Andrew Chen, an investor who has written about mobile app growth. The first days shape the retention curve, not a stream of notifications later on.

### What counts as first value

First value is the same "first useful action" from [chapter 2.1](#ch-2-1), only measured against the clock. For an expense-tracking bot, it's the first recorded expense. For an interpreter bot, it's the first text rendered in another language. There's one test: the person got what they came for, without demo data.

### The first screen continues the promise

Every link makes a promise: the post talked about a family calendar, the invitation about dinner on Friday. **The first screen should continue the link's promise, not start introductions from scratch.** The bot learns the promise only from the link's parameter, which is why tags and onboarding are one topic.

## The bridge

The code for this chapter, with tests (TypeScript + Bun), is in the `examples/deeplinks` folder[^src-examples-deeplinks]. It covers building and parsing tags, short keys, every kind of link, and the time-to-value queries.

### Kinds of links

A deep link is an address like `t.me/<bot>` with a parameter that Telegram passes to the bot or the mini app[^src-tg-links-bots-52][^src-tg-deeplinking-52].

| Link | Where it leads | Who receives the parameter |
|---|---|---|
| `?start=<p>` | a private chat with the bot | the bot: `/start <p>` |
| `?startgroup=<p>` | a group picker; the bot is added to the chosen group | the bot in the group: `/start@bot <p>` |
| `?startapp=<p>` | the bot's main mini app | the mini app: `start_param` |
| `/<app>?startapp=<p>` | a mini app with a short name | the mini app: `start_param` |

For a small bot, the first two rows are the ones that matter. A `?start=` link opens the chat and shows a "Start" button: it's for posts, paid placements, ads and invitations. A `?startgroup=` link is for products built around chats: a family, a team, a club. It takes an optional `admin` parameter, a plus-separated list of rights such as `pin_messages+delete_messages`.

::: note
**The other kinds of links are for reference.** `?startchannel&admin=<rights>` adds the bot to a channel as an administrator; it takes no parameter, and the rights are required[^src-tg-links-bots-52]. `?startattach=<p>` opens the attachment menu, but per the documentation only major advertisers on the Telegram Ad Platform get it[^src-tg-webapps-start-52].

Referral links from Telegram's affiliate program look like `?ref=<code>` or `?start=_tgr_<code>`. The program handles that parameter, not your bot. The link's author earns a share of Stars purchases made in the bot's mini app[^src-tg-links-bots-52]. As of September 28, 2026, the `_tgr_` prefix is set in the client configuration[^src-tg-starref-52], so don't start your own tags with it.
:::

### Parameter rules

The `start` and `startgroup` parameters take up to 64 characters: Latin letters, digits, underscore and hyphen[^src-tg-deeplinking-52]. The `start_parameter` field in the Bot API follows the same rules[^src-tg-botapi-start-52]. Spaces, periods, Cyrillic and other non-Latin letters, and the `=` sign are all off limits.

Telegram hasn't published an official limit for `startapp`. Unofficial community documentation gives 512 characters[^src-tma-start-param]. We stick to the same 64: one tag scheme for every link is simpler than two.

Anyone who sees the link sees the parameter, and anyone can change it. So it must never contain Telegram IDs or sequential numbers, and the server validates every code (see [chapter 2.1](#ch-2-1)). The bot writes the reserved source values `src_share`, `none` and `legacy` itself; `checkPayload` rejects any tag that uses one.

### One tag, three fields

In [chapter 2.1](#ch-2-1) the tag carried one field: the channel and the placement. Now you're asking the data three questions: where the person came from, which copy variant they saw, and who brought them. Fields are separated by a hyphen, because the underscore is already used inside the source. Each field after the source is a one-letter prefix followed by a value, with no space:

```text
src_tg_chanA_0927-c2-rX9y8Z7W6
```

| Field | Prefix | Example | Meaning |
|---|---|---|---|
| Source | `src_` | `src_tg_chanA_0927` | paid placement in channel A, September 27 |
| Copy variant | `c` | `c2` | second variant of the post or the first screen |
| Friend | `r` | `rX9y8Z7W6` | the user's code from the `invite_codes` table |
| Partner | `p` | `pQ4w5E6r` | the code of a paid partner or ambassador |

Altogether, that's 30 characters out of 64. The source is required, the rest is optional, and the order is fixed. Friends and partners get different prefixes because they're different channels. Friend invitations feed the viral coefficient in [chapter 3.5](#ch-3-5), and paid referrals would distort it.

```typescript
encodeCampaign({ campaign: "src_tg_chanA_0927", content: "2", ref: "X9y8Z7W6" });
// "src_tg_chanA_0927-c2-rX9y8Z7W6"
decodePayload("src_tg_chanA_0927-c2-rX9y8Z7W6");
// { kind: "campaign", campaign: "src_tg_chanA_0927", content: "2", ref: "X9y8Z7W6" }
```

`encodeCampaign` throws if a field contains a hyphen or an invalid character: it's better to find out before you publish. On an unknown or repeated field, `decodePayload` returns `{ kind: "none" }` instead of guessing. It still parses the `ev_…` object links from chapter 2.1 the old way.

Store the variant and the partner separately from the source, in new columns of the table from chapter 2.1. If the table already exists, run this once, before you deploy the new code:

```sql
ALTER TABLE user_acquisition ADD COLUMN first_content TEXT;
ALTER TABLE user_acquisition ADD COLUMN first_partner TEXT;
```

Skip this, and the new `recordStart` fails on its very first write. The `initSchema` function in the example checks the columns itself and adds any that are missing.

::: warning
**Old tags.** The parser from chapter 2.1 took the whole tag as the source. The new one splits it on hyphens, so an old tag with a hyphen parses wrong: `src_tg-chanA` becomes source `src_tg` with variant `hanA`. Run every published tag through both parsers and compare the results; `labelMismatches` does exactly that.

Put the mismatches in the `legacy_labels` table, which is checked before the new scheme. Tags already issued with a `_b` variant keep working, and the variant stays part of the source. To move it into `first_content`, add the tag to the same table, and issue new links with `-c2`.
:::

::: warning
**Pay partners for results, not for starts.** Pay for activation or a payment within the first N days, not for `/start`. Give every code a payout cap.

Watch for self-invitations from second accounts and for one-day spikes of starts on a single code; the `partner_payouts` query shows both. For a blogger who doesn't use the bot, create a code by hand in `partner_codes`. Partner terms are covered in [chapter 4.3](#ch-4-3).
:::

### When a tag doesn't fit

Sixty-four characters is plenty until you try to cram everything into the tag. `src_tg_family_calendars_channel_autumn_digest_0927` with the variant `shared_family_v2` and a code is already 78 characters. The way out is a short key.

```sql
CREATE TABLE IF NOT EXISTS start_links (
  key TEXT PRIMARY KEY, campaign TEXT NOT NULL,
  content TEXT, ref TEXT, partner TEXT,
  note TEXT,                 -- where the link was published, no people's names
  created_at TEXT NOT NULL
);
```

The link carries `k_` plus ten random letters and digits, and the fields live in the table. The `payloadFor` function decides on its own whether a key is needed: a short tag goes into the link as is.

Each key is created only once: the same set of fields always maps to the key already issued. The function enforces that uniqueness, not the table. SQLite's `UNIQUE` doesn't treat two `NULL`s as equal.

A key also hides the tag. Without one, anyone who sees the link sees `src_tg_chanA_0927`, including the channel owner and your competitors. The price of a key is dependence on the database: lose the table, and every published key turns into `none`. Backing up `start_links` matters as much as backing up your user data.

### The `/start` handler, groups and mini apps

In a private chat, the `/start` handler parses the parameter. With grammY it looks like this:

```typescript
bot.chatType("private").command("start", async (ctx) => {
  if (!ctx.from) return;
  const { parsed } = recordStart(db, ctx.from.id, ctx.match);
  await showScreen(ctx, firstScreen(parsed, { "2": "family_example" })); // variant -c2 → its own screen
});
```

`recordStart` is the chapter 2.1 version with the new tag scheme. `firstScreen` returns `event_card` for invitations, a matching screen for known copy variants, and `welcome` for everything else.

**Groups.** Here the unit of accounting is the chat, not the person, and you need a separate handler. The `my_chat_member` update tells you who added the bot: its `from` field holds whoever performed the action[^src-tg-chatmemberupdated-52].

From that, `recordGroupAdded` creates a row keyed by `chat_id`. The `startgroup` parameter arrives right after as `/start@bot <parameter>`, and `recordGroupPayload` fills in the source.

Ask only for the rights the bot can't work without. Suppose the calendar bot in a family chat only answers commands and sends reminders: it needs no admin rights at all. The `setMyDefaultAdministratorRights` method sets the default rights, and the user can edit the list before adding the bot[^src-tg-botapi-start-52].

**Mini apps.** The `startapp` parameter arrives in `initData` in the `start_param` field and is duplicated in the page URL as `tgWebAppStartParam`[^src-tg-webapps-start-52]. A person who opened the app from a link may never send `/start` at all. So `recordAppStart` records first touch on the server, and only from `initData` after checking its signature, since the URL is easy to forge.

::: note
As of September 28, 2026, the Mini Apps reference describes the `start_param` field only in terms of the attachment menu. The sections on the main app and direct links say `startapp` lands in the same field[^src-tg-webapps-start-52]. Test it once in your own app before you run any ads.
:::

### Onboarding by parameter

Onboarding is the path from first contact to first value. Our calendar bot's `/start` handler parses event and invitation parameters. Below is how that parsing becomes a fork in onboarding; the screens and wording are illustrations.

| Parameter | First screen | First value |
|---|---|---|
| `ev_<token>_<code>` | an event card with reply buttons | a reply to the invitation |
| `src_…-c<variant>` | an example that matches the post's promise | the bot understood and saved the first event |
| empty or `none` | a general welcome with one example | same as above |

Invited people arrive with an event already in hand, so the first screen is that event:

```text
Dinner at Masha's — Friday, 7:00 PM (organizer's time)
[I'll be there]  [Can't make it]  [Remind me an hour before]
```

Three buttons, not a single question. Any tap is first value: the reply is saved, and the organizer gets an answer. The invited person's path is `start`, `invite_viewed`, `first_value`, with no separate "replied" step. The "here's what else I can do" tour comes after the reply, in one message.

If the event behind the link was deleted or the token has expired, don't show an error. Say "This event has been deleted" and continue with the regular welcome.

### Ask nothing in advance

In the illustration from [chapter 2.2](#ch-2-2), four in ten people left at the time zone question. In [chapter 2.5](#ch-2-5), buttons with common time zones softened that step. Here we remove it from the start of the path entirely.

There's one rule: **ask only when you can't go on without the answer**. An invited person doesn't need a time zone. The event already has an exact time in the organizer's zone, and the server schedules the one-hour reminder without knowing the guest's. Take the language from `language_code`, and if it's missing, use your main audience's language, as in [chapter 5.1](#ch-5-1).

The time zone becomes necessary when the person types "tomorrow at 9" on their own. That's when the bot asks, and explains why:

```text
To remind you at 9 AM your time, I need to know your city.
[Moscow]  [Minsk]  [Send my location]  [Another city]
```

The location button is a keyboard button with `request_location`, and it works only in private chats[^src-tg-keyboardbutton-52]. Work out the time zone from the coordinates yourself with an offline library (`geo-tz` for Node, `timezonefinder` for Python), not an external geocoder. Store only the time zone, never the coordinates. In a mini app, the browser hands you the time zone: `Intl.DateTimeFormat().resolvedOptions().timeZone`.

The same goes for permissions. A bot can't start a conversation on its own[^src-tg-bots-intro-52], and someone coming from a mini app may never have written to it. Show the `requestWriteAccess` prompt, which asks permission for the bot to message them[^src-tg-webapps-start-52], when they set their first reminder: then the reason is obvious. The "how did you hear about us?" question from chapter 2.1 comes after first value.

### The first message

With no parameter, the bot gets one shot at explaining itself:

```text
I remind you about meetings and to-dos. Tell me what and when, the way you'd tell a friend.
For example: "dinner with Masha Friday at 7, remind me an hour before."
[Show me an example]  [What else can you do?]
```

The first line says what the bot does. The second is an example people can repeat in their own words. There are two buttons: one leads to value, the other is for the curious. A screen-long welcome with a list of commands is the first thing worth cutting.

Each post variant gets its own screen. Suppose a post in a parenting channel promised a shared family calendar. Then the first screen says "create an event and invite your family," with a button that does exactly that.

::: warning
The "Show me an example" button may create a demo event. Don't count it as first value or as activation. Otherwise time to value drops to five seconds for everyone, and the funnel from chapter 2.2 can no longer spot who came with a task. When a number becomes a target, it stops measuring anything (Goodhart's law, [chapter 2.6](#ch-2-6)).
:::

### Measuring time to first value

First value is one more step in the funnel from chapter 2.2. Record it at the point in the code where value happens:

```typescript
markFirstValue(db, userId); // the bot saved the person's own first event, or they replied to an invitation
```

The `first_value` step is written once. The `ttfv_by_source` query measures time to value from `first_seen_at`, the moment of first touch. The cohort is the same as in chapter 2.2: people who arrived one to three weeks ago, with value counted within seven days.

Suppose the result looks like this (the numbers are made up for illustration):

| Source | Reached value / starts | Reached it within 60 s, % of starts | Median, s |
|---|---|---|---|
| `src_share` | 26 / 31 | 61 | — |
| `src_threads_bio` | 14 / 48 | 13 | — |
| `none` | 9 / 40 | 8 | — |
| `src_tg_chanA_0927` | 8 / 112 | 3 | — |

The query returns a median only if at least 30 people reached value (rule of thumb: check it against your own data). Nobody clears that bar here, and that's honest: a median over eight people is noise. The start counts and the `none` row match the chapter 2.1 report. More invited people reached value than "created an event" there, because their value is replying to the invitation.

The table's main lesson isn't speed; it's the paid placement. Of the people who came from that channel, 93% got no value within a week. Speeding up their path won't help: they came without a task, as we suspected in [chapter 2.2](#ch-2-2). They need a first screen that offers them one.

`stalled_last_step` shows where everyone else stopped: for each person who didn't reach value, it takes the last step they completed. If most got stuck at `first_message_sent`, they wrote something but didn't get a useful reply. With fewer than thirty new people a week, read individual paths instead, as in chapter 2.2.

### One reminder for people who got stuck

Someone tapped "Start" and left. The bot may write to them once more, since they started the conversation. But Telegram's developer terms forbid harassing users or spamming them with unsolicited messages[^src-tg-devtos-spam-52].

Our rules (rule of thumb: check them against your own data):

- one message, not a series;
- a day or two after the start (the `nudge_candidates` query uses 20 to 48 hours);
- only in the daytime, in the person's time zone, or in your audience's main zone if theirs is unknown (`isDaytime`);
- only to people who haven't reached value, haven't opted out and haven't blocked the bot;
- the message offers the next step as a single button, plus a "Stop messaging me" button.

```text
You stopped by yesterday. Want a 20-second demo of setting your first reminder?
[Show me]  [Stop messaging me]
```

Record a tap on "Stop messaging me" in the `messaging_optout` table with `recordOptOut`. The candidates query leaves those people out, and deletion on request wipes that row too. Mark each sent reminder with the `nudge_sent` step: it's written once, so a second reminder never goes out.

`nudge_outcome` adds up the result: how many people reached value after the reminder, and how many blocked the bot within 48 hours. Blocks here are the guardrail metric from [chapter 2.5](#ch-2-5). If they outnumber the people who reached value, rewrite the reminder or drop it. People who used the bot and then went quiet are covered in [chapter 5.6](#ch-5-6).

## Your step

::: step
Tonight: one path from link to value.

1. Pick a path: from an invitation, or from your biggest channel.
2. Remove one question from it before first value: language, time zone, or "how did you hear about us?"
3. Add a `markFirstValue` call where first value happens.

**Done when** someone who has never started the bot opens the link, and `funnel_events` shows under 60 seconds between their `start` and `first_value`. Ideally, ask a friend and give no hints. Testing from your own second account works only after you delete its rows.

The next evening, if you need it: the `ALTER TABLE`, checking old tags with `labelMismatches`, and moving long tags to keys.
:::

**Recap.** Friend codes become the viral coefficient in [chapter 3.5](#ch-3-5), and partner codes become deal terms in [chapter 4.3](#ch-4-3). Tags for every placement, and clicks that never became starts, come back in [chapter 5.3](#ch-5-3). Reminders for people who went quiet are in [chapter 5.6](#ch-5-6), and location and other data in [chapter 5.8](#ch-5-8). Time to value earns a line in the weekly ritual of [chapter 6.1](#ch-6-1).

[^src-tg-links-bots-52]: Telegram, "Deep links," sections "Bot links" (the parameter is up to 64 base64url characters; the "Start" button also appears for people who have already started the bot), "Group/channel bot links" (the `admin` parameter; channel links take no parameter, and `admin` is required), "Main Mini App links," "Direct mini app links," "Bot attachment or side menu links," "Referral links" (`?ref=<referrer>` and `?start={prefix}<referrer>`; Star purchases of digital goods and subscriptions in the mini app earn Stars for the link's author). core.telegram.org/api/links (accessed September 28, 2026).
[^src-tg-deeplinking-52]: Telegram, "Telegram Bot Features," section "Deep Linking": A-Z, a-z, 0-9, _ and - are allowed, up to 64 characters; in a group, the bot receives `/start@your_bot <parameter>`. core.telegram.org/bots/features#deep-linking (accessed September 28, 2026).
[^src-tg-webapps-start-52]: Telegram, "Telegram Mini Apps": a non-empty `startapp` is passed in the `start_param` field and in the `tgWebAppStartParam` GET parameter; the attachment menu is "currently only available for major advertisers on the Telegram Ad Platform"; the `requestWriteAccess` method; validating `initData`. core.telegram.org/bots/webapps (accessed September 28, 2026).
[^src-tg-starref-52]: Telegram, "Client configuration": `starref_start_param_prefixes` is `["_tgr_"]`; the server sets the value, and it may change. core.telegram.org/api/config (accessed September 28, 2026).
[^src-tg-botapi-start-52]: Telegram Bot API: InlineQueryResultsButton, the `start_parameter` field is "1-64 characters, only A-Z, a-z, 0-9, _ and - are allowed"; `setMyDefaultAdministratorRights`: the rights "will be suggested to users, but they are free to modify the list before adding the bot." core.telegram.org/bots/api (accessed September 28, 2026).
[^src-tma-start-param]: Telegram Mini Apps (community documentation, not Telegram's), "Start Parameter": up to 512 characters from A-Z, a-z, 0-9, _ and -. docs.telegram-mini-apps.com/platform/start-parameter (accessed September 28, 2026).
[^src-tg-chatmemberupdated-52]: Telegram Bot API, the ChatMemberUpdated object, the `from` field: "Performer of the action, which resulted in the change." core.telegram.org/bots/api#chatmemberupdated (accessed September 28, 2026).
[^src-tg-bots-intro-52]: Telegram, "Bots: An introduction for developers": "Bots can't start conversations with users. A user must either add them to a group or send them a message first." core.telegram.org/bots (accessed September 28, 2026).
[^src-tg-keyboardbutton-52]: Telegram Bot API, the KeyboardButton object, the `request_location` field: "Available in private chats only." core.telegram.org/bots/api#keyboardbutton (accessed September 28, 2026).
[^src-tg-devtos-spam-52]: Telegram, "Bot Platform Developer Terms of Service," section 5.2(b): "Your TPA must not harass or spam users with unsolicited messages." telegram.org/tos/bot-developers (accessed September 28, 2026).
[^src-examples-deeplinks]: github.com/alex-mextner/indie-growth-book, folder `examples/deeplinks`: TypeScript (Bun) code, queries and tests.
