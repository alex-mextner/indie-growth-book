# 5.1. The Bot Card Is Your Landing Page {#ch-5-1}

::: skip
If your description and commands already describe the job your bot does for people, jump to "Check it with numbers." It covers three rates. The first needs the redirect from [chapter 5.3](#ch-5-3); without it, you track two.
:::

A website has a landing page: a page that explains in seconds why you should stay. A bot has no such page. Instead, that job falls to everything a person sees before the "Start" button: the name, the avatar, a few profile lines and the empty chat. We call this the **bot card**.

## The gist

### Ten seconds to make a promise

In 2011, Jakob Nielsen analyzed a study of how long people spend on web pages. Most pages get closed within the first 10–20 seconds. Visitors who stay past about thirty seconds become noticeably less likely to leave[^src-nngroup-dwell]. Nielsen's conclusion: get your value proposition across in ten seconds.

That's website data: nobody has run such studies for bot cards, so we apply the conclusion by analogy. The person makes one decision: tap the button or not. A good card answers three questions: what job the bot does, who it's for, and what the person gets in the first minute. By "job" we mean the job to be done from [chapter 1.1](#ch-1-1): an outcome, not a feature list.

### Message match

Unbounce, a landing-page builder, defines **message match** in its glossary: how closely page copy repeats the wording of the ad or link a visitor followed[^src-unbounce-match]. If the post promised "a haircut reminder," the card has to talk about reminders. Otherwise the person decides they've come to the wrong place.

### What this means in numbers

The card affects two steps of the funnel from [chapter 2.2](#ch-2-2): from link click to `/start`, and from `/start` to the first message. The third metric is day-one blocks: they reveal a promise the product doesn't keep. **Judge the card by the share of people who sent a first message, not by how pretty the copy is.** First value is tracked separately, by the `first_value` step from [chapter 5.2](#ch-5-2).

## The bridge

### What people see before "Start"

Every surface of the card is set in @BotFather, and most can also be set with Bot API methods. We checked the limits on September 28, 2026, when Bot API 10.3 was current[^src-tg-api-changelog].

| Surface | Where it appears | Limit | How to set it |
|---|---|---|---|
| Name | Chat list, profile | 0–64 characters | `/setname`, `setMyName` |
| @username | Links, mentions, search | 5–32 characters: Latin letters, digits, `_`; ends in `bot` | Once, at `/newbot` |
| Avatar | Chat list, profile | JPG or MPEG4 video | `/setuserpic`, `setMyProfilePhoto` |
| Short description (about) | Profile, shared links | 0–120 characters | `/setabouttext`, `setMyShortDescription` |
| Description | Empty chat before "Start" | 0–512 characters | `/setdescription`, `setMyDescription` |
| Description picture | Above the description | Photo, video or GIF | @BotFather only |
| Commands | Menu and the hint after `/` | Up to 100 commands | `/setcommands`, `setMyCommands` |
| Menu button | Next to the input field | — | `setChatMenuButton` |

The limits come from Telegram's documentation[^src-tg-features][^src-tg-api-profile]. Unlike the name, the username can't be changed later. @BotFather itself suggests the picture sizes: a 640×360 photo, or a GIF at 320×180, 640×360 or 960×540[^src-botfather-pic]. The hint has changed over the years, so check it before uploading.

### Three paths to the button

**A link from a post or a paid placement.** It opens an empty chat with a "Start" button. The chat shows the picture and the description under the heading "What can this bot do?", which is localized for other interface languages: in Russian it reads «Что умеет этот бот?»[^src-tg-features][^src-tg-translations-51]. This is the main screen.

**A forwarded link.** Telegram sends the short description along with the link[^src-tg-features]. The web page `t.me/<username>` shows the name, avatar, short description and monthly user count[^src-tme-page]. A small number works as negative social proof, and a `?start=` link won't hide it: it's the same page. All you can do is outweigh it with copy.

**Search.** According to Telegram's FAQ, a public username can be found through global search[^src-tg-faq]. Telegram doesn't describe how search ranks bots; anything beyond that is rumor. The profile may show a Similar bots tab, picked by audience overlap[^src-tg-recommend]. So your first line has to set you apart from the bots next to you: open their cards and read them.

### Name, username, avatar

The name sits in the chat list next to a hundred others. It should name the job, not the technology: not "Smart AI Assistant" but "Calendar: reminders on time" (an illustration). People say the username out loud and type it from memory. That's dark traffic: untagged visits from private chats and word of mouth ([chapter 2.1](#ch-2-1)), so the username has to be easy to dictate.

In the chat list, the avatar is the size of a fingernail. The documentation recommends a unique image so the bot can be spotted at a glance[^src-tg-features]. At that size, any text on it blurs into a smudge.

### Short description: 120 characters

The short description appears in the profile, including for people who started the bot long ago and have forgotten why. It also travels with every forwarded link. So it has to work without context: an outcome and an example.

::: case
Suppose our calendar bot's short description looked like this (here and below, the copy is an illustration):

> A smart AI assistant for managing your time and productivity.

That's a technology and a buzzword, not a job. The edited version:

> Type "haircut Friday at 3pm" and I'll remind you in time. Invite friends with one link.

It has an action, a sample phrase and a second benefit (invitations), all in about ninety characters.
:::

### Description: the screen before "Start"

Everyone who opens the empty chat sees the description[^src-tg-api-profile]. Its 512 characters fit four things, in this order:

1. The job and who it's for, in one line.
2. An example: a phrase the person can type right away.
3. The first minute: what happens after "Start."
4. One doubt put to rest: price, data or spam.

Keep the first-minute promise honest; any gap will show up later as blocks. Check your data promise against the policy from [chapter 5.8](#ch-5-8). If messages go to an AI model provider, you can't write "we share nothing with anyone."

::: case
Before (an illustration):

> Hi! I'm a smart assistant bot powered by artificial intelligence. I can do lots of things: calendar, reminders, notes, integrations, invitations and much more. Tap /start to begin!

After (an illustration):

> A calendar you text like a friend.
>
> Type "dentist Thursday at 10." The event appears, and a reminder arrives ahead of time.
>
> No forms: after "Start," just type the task and the time. I'll only ask your city if I can't tell the time without it.
>
> Got an invitation? Tap "Start" and the event opens right away.

The greeting and the feature list are gone. In their place: an example, a first-minute promise and a line for invited guests.
:::

Our calendar bot has invitations, and `/start` parses event and invitation links ([chapter 2.1](#ch-2-1)). A stranger from a post and a friend with an invitation see the same empty chat. There's one description per language, not per person, so it has to speak to both.

The picture above the description is for a demo, not a logo. A screenshot of "typed a phrase, got an event" explains the product faster than a paragraph.

### Commands and the menu button

By default, the menu button opens the command list[^src-tg-api-profile]. It's the bot's second table of contents, and people read it before their first message. Telegram asks bots to support `/start`, `/help` and, if there are settings, `/settings`[^src-tg-features].

A command can be up to 32 characters: lowercase Latin letters, digits and underscores. Its description can run to 256[^src-tg-api-profile]. In practice, three to six words are enough. People read five commands and scroll past fifteen (rule of thumb: check it against your own data).

```text
start - get started
today - what's on today
invite - invite friends to an event
settings - city and language
help - what I can do
```

This is the format `/setcommands` accepts in @BotFather: command, hyphen, description. The set is an illustration, not our bot's current menu.

Command scopes let you show different lists in private chats, in groups and to admins. They're available only through `setMyCommands`: @BotFather's command list has a language switch, but no scopes. If your bot works in groups, give groups their own short list.

The menu button can launch a mini app. If your bot is a mini app, enable the Main Mini App in @BotFather to get a launch button and a profile preview[^src-tg-mainapp]. Otherwise, leave the command list on the button: it tells a stranger more. We cover the Mini App Store storefront in [chapter 3.6](#ch-3-6).

### Languages

The name, both descriptions and the commands are set separately per language with `language_code`, a two-letter ISO 639-1 code. Text set without a code is the default: everyone whose language has no version of its own sees it[^src-tg-api-profile][^src-tg-features].

The language comes from the app or system settings[^src-tg-privacy-lang-51]. A Russian speaker may well keep those set to English, and the same goes for any non-English audience. The moment you add an `en` version, they see English copy. So make your core audience's language the default, and add `en` only after checking the `language_code` split among your users ([chapter 2.2](#ch-2-2)).

You don't need a script to set the copy. The @BotFather mini app adds versions in other languages too, via "Add Localization" on the description and the commands[^src-botfather-pic]. @BotFather plus a file with the card copy in your repository is enough. Date every change: without dates, you can't compare the weeks before and after an edit.

### Check it with numbers

Judge the card by three rates among new people. Existing users open tagged links too, but they no longer read the card ([chapter 2.1](#ch-2-1)).

- Start rate from clicks: new tagged `/start`s divided by clicks on the link with that tag.
- First message within a day: the share of new people who wrote to the bot on day one.
- Block within a day: the share of new people who blocked the bot on day one.

The bot can't see who opened the link and changed their mind. Clicks are counted by the short redirect URL from [chapter 5.3](#ch-5-3). Without it, you get two of the three rates; post views can serve as a rough stand-in for the denominator. This query calculates those two:

```sql
SELECT a.first_source AS label,
       COUNT(*) AS new_starts,
       SUM(EXISTS (SELECT 1 FROM funnel_events f
                   WHERE f.telegram_id = a.telegram_id AND f.step = 'first_message_sent'
                     AND f.at <= datetime(a.first_seen_at, '+1 day'))) AS wrote_day1,
       SUM(EXISTS (SELECT 1 FROM bot_status b
                   WHERE b.telegram_id = a.telegram_id AND b.status = 'kicked'
                     AND b.at <= datetime(a.first_seen_at, '+1 day'))) AS blocked_day1
FROM user_acquisition a
WHERE a.first_source LIKE 'src\_%' ESCAPE '\'
  AND a.first_source <> 'src_share'
  AND a.first_seen_at >= date('now', '-8 days')
  AND a.first_seen_at <  date('now', '-1 day')
GROUP BY a.first_source;
```

The query takes tagged arrivals from seven full days ending the day before yesterday, so everyone has had a whole day since starting. For each tag, it counts new starts and the people who wrote or blocked within their first day. Invited users (`src_share`) are excluded: they arrive with an event in hand and judge the invitation, not the card. The tables come from chapters [2.1](#ch-2-1) and [2.2](#ch-2-2).

Suppose you changed the description and compared two weeks for the link in your Threads profile (the numbers are made up for illustration):

| Variant (week) | Clicks | New starts | Wrote within a day | Blocked within a day |
|---|---|---|---|---|
| Old description | 140 | 42 (30%) | 23 (55%) | 4 (10%) |
| New description | 150 | 60 (40%) | 42 (70%) | 4 (7%) |

The start rate is a lower bound: the redirect also counts existing users and the bots that build link previews. Filter those out by User-Agent: `TelegramBot (like TwitterBot)`, `facebookexternalhit` and others; this list is incomplete[^src-ua-previews-51]. Two weeks give you an observation, not a conclusion. Compare descriptions by alternating weeks A, B, B, A, with at least five pairs ([chapter 2.5](#ch-2-5)).

With fewer than thirty new people a week, don't compare percentages (rule of thumb: check it against your own data). Instead, spend a week reading every newcomer's first messages and checking who blocked the bot, as in [chapter 2.5](#ch-2-5). If starts went up while the share who wrote went down, the card promises more than the first minute delivers.

::: warning
Common card mistakes:

- A greeting and a technology instead of a job: "Hi! I'm an AI-powered bot" eats the first line and promises nothing.
- A short description cut from the long one: the first 120 characters of a description rarely work on their own.
- A stale default text: you updated only the version with a `language_code`, and the default copy stayed old.
- Editing the card and the onboarding in the same week: afterward you can't tell what worked.
:::

## Your step

::: step
Tonight: rewrite your card.

1. Ask a friend who has never opened your bot to open the link and tell you what it does. Or delete your chat with the bot and open it again: the description shows while the chat is empty. If it isn't clear in ten seconds, rewrite the first line (rule of thumb).
2. Rewrite the description using the pattern "job and who it's for, example, first minute, one doubt put to rest." Write the short description as a standalone recommendation.
3. Keep three to six commands in your audience's language, and save the copy to your repository with a date.
4. If you don't have the tables from chapters [2.1](#ch-2-1)–[2.2](#ch-2-2) yet, start with those.

**Done when** the new copy shows in the empty chat and the date of the change is written down. In a week, the query will show two rates; the third comes once you set up the redirect from [chapter 5.3](#ch-5-3).
:::

**Recap.** In [chapter 5.2](#ch-5-2) we pick up where the card ends: the reply to `/start` and the path to first value in 60 seconds. In [chapter 5.3](#ch-5-3) the redirect supplies the denominator for the start rate. In [chapter 3.6](#ch-3-6) the card returns as a storefront for catalogs and search.

[^src-nngroup-dwell]: Jakob Nielsen, "How Long Do Users Stay on Web Pages?", Nielsen Norman Group, September 11, 2011: "Users often leave Web pages in 10–20 seconds, but pages with a clear value proposition can hold people's attention for much longer." nngroup.com/articles/how-long-do-users-stay-on-web-pages/ (accessed September 28, 2026).
[^src-unbounce-match]: Unbounce, "Message Match," Conversion Glossary, revised April 20, 2023: "A measure of how well your landing page copy matches the phrasing of the ad or link that brought the visitor there." unbounce.com/conversion-glossary/definition/message-match/ (accessed September 28, 2026).
[^src-tg-api-changelog]: Telegram, "Bot API changelog": `setMyCommands` in 4.7 (March 30, 2020), command scopes in 5.3 (June 25, 2021), `setChatMenuButton` in 6.0 (April 16, 2022), `setMyDescription` and `setMyShortDescription` in 6.6 (March 9, 2023), `setMyName` in 6.7 (April 21, 2023), the main mini app in 7.8 (July 31, 2024), `setMyProfilePhoto` in 9.4 (February 9, 2026); version 10.3 on August 24, 2026. core.telegram.org/bots/api-changelog (accessed September 28, 2026).
[^src-tg-features]: Telegram, "Telegram Bot Features," sections "Commands," "Global Commands," "About text, description and profile media," "Edit bots": `/setdescription` up to 512 characters, the "What can this bot do?" block; `/setabouttext` up to 120 characters, sent along with the link; both texts can be localized; username 5–32 characters, can't be changed. core.telegram.org/bots/features (accessed September 28, 2026).
[^src-tg-api-profile]: Telegram Bot API: `setMyName` (0–64 characters), `setMyDescription` (0–512, shown while the chat is empty), `setMyShortDescription` (0–120), the `language_code` parameter; `setMyCommands` (up to 100 commands), `BotCommand` (1–32 and 1–256 characters), command scopes; `setChatMenuButton`; `setMyProfilePhoto`. core.telegram.org/bots/api (accessed September 28, 2026).
[^src-botfather-pic]: The @BotFather mini app, "Edit Info" and "Commands" screens (checked September 28, 2026 on the authors' bot): the hint reads "Upload a photo for the bot's start page, 640x360 pixels. You can also use a GIF animation, 320x180, 640x360 or 960x540 pixels"; the description is called Welcome message there; the description and commands have a language switch with "Add Localization" and no command scopes. In 2022 the hint named only 640×360 and a 320×180 GIF (vc.ru/social/498034, in Russian).
[^src-tg-translations-51]: Telegram Translations, Russian localization, key BotInfoTitle: "What can this bot do?" is «Что умеет этот бот?». translations.telegram.org/ru/android/bots_and_payments/ (accessed September 28, 2026).
[^src-tme-page]: The web pages t.me/BotFather and t.me/BotFather?start=abc: name, avatar, short description and a "monthly users" line (accessed September 28, 2026).
[^src-tg-faq]: Telegram FAQ, section "Usernames and t.me": a public username can be found through global search. telegram.org/faq (accessed September 28, 2026).
[^src-tg-recommend]: Telegram API, "Similar channels and bots": the `bots.getBotRecommendations` method, the "Similar bots" tab in a bot's profile, matching by audience overlap. core.telegram.org/api/recommend (accessed September 28, 2026).
[^src-tg-mainapp]: Telegram, "Telegram Mini Apps," section "Launching the main Mini App": the Launch app button and the profile preview. core.telegram.org/bots/webapps (accessed September 28, 2026).
[^src-tg-privacy-lang-51]: Telegram Privacy Policy, section 6.3: bots may receive the interface language "based on your app or operating system language settings." telegram.org/privacy (accessed September 28, 2026).
[^src-ua-previews-51]: Meta, "Meta Web Crawlers": `facebookexternalhit` fetches previews of links shared in Meta's apps. developers.facebook.com/docs/sharing/webmasters/web-crawlers/. The `TelegramBot (like TwitterBot)` string comes from the user-agents.net catalog, user-agents.net/string/telegrambot-like-twitterbot; we found no official description from Telegram (accessed September 28, 2026).
