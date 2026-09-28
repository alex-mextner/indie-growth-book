# 5.3. Paid Placements and Ad Exchanges {#ch-5-3}

::: skip
If you already buy ads in channels and vet them by views, start at "A short redirect address." That's where you'll find the click counter promised in [chapter 5.1](#ch-5-1) and the cost of each funnel step. If you advertise to a Russian audience, read "The law and ad marking" first. FAS (Russia's competition regulator) already treats Telegram ads as a violation, but has promised no penalties before 2027.
:::

A **paid placement** is a paid post in someone else's Telegram channel. For a small bot, it's the most accessible paid channel: no ad account, just a conversation with the channel admin. It's also the least transparent one. Prices are guesswork, views can be bought, and the result gets lost between "clicked" and "uses it."

## The gist

### Pay for views, not subscribers

Subscribers can be bought, inactive or long since muted. Only the people who open the post see the ad. That's why experienced buyers look at **post views**: the average reach of recent posts.

The ratio of views to subscribers is called **ERR** (engagement rate by reach). Telemetr, a channel analytics service, divides average post views over 7 days or 24 hours by subscribers[^src-telemetr-err-53]. Weekly ERR runs higher than daily, so pick one window and one service for every channel.

**CPM** (cost per mille) is the price of a thousand views. A $40 post with 4,000 views costs $10 per thousand (an illustration). CPM lets you compare channels of different sizes, but it can't tell you who saw the post or why.

### What fake views look like

TGStat, another analytics service, names two warning signs in its 2023 guide for advertisers[^src-tgstat-guide-53]. The first is sharp subscriber spikes with no unsubscribes. The second is over 80% of the past day's new subscribers already gone. That pattern points to **forced subscription**, where people subscribe to unlock something and leave at once.

The guide's benchmarks: ERR of 10% or more and a **citation index** of at least 30. The index grows when other channels, especially prominent ones, mention this one.

A genuine post gains views fast in the first hours, then levels off. A flat line, a step at midnight or a jump a day later is a reason to ask questions. Telemetr shows a channel's views by hour[^src-telemetr-help-53], and TGStat shows a post's average ad reach at 12, 24 and 48 hours[^src-tgstat-api-53].

### Who advertises whom

Channels sell ads to each other, and those ties are visible. The **mention graph** shows who advertised a channel and whom it advertised in turn. Telemetr shows both lists and past ad posts, even deleted ones[^src-telemetr-help-53]. A channel that buys ads from shady neighbors grows its audience from the same sources.

We found no publicly available tool that shows the audience overlap of two channels you don't own. Telemetr's audience analysis works only for your own channel[^src-telemetr-help-53]. The indirect signs are shared advertisers and similar channels, which Telegram suggests based on audience similarity[^src-tg-recommend-53]. Two channels with one audience will show your ad to the same people.

**The takeaway: pay for views from real people in your segment, and judge by clicks and first value, not by the admin's report.**

## The bridge

The code for this chapter, with tests (TypeScript + Bun), is in the `examples/redirect` folder[^src-examples-redirect]. For Python, see the note in [chapter 0.1](#ch-0-1).

### Finding channels and prices

In the Telemetr or TGStat catalog, start with the category and language filters. Then search post texts for words from the job your bot does: "after-school club," "schedule," "organizer." When you find a good channel, open its similar channels: Telegram suggests neighbors with an overlapping audience.

Find the market price yourself. Note the CPM of a dozen niche channels from an exchange catalog and take the median (rule of thumb: check it against your own data). A channel priced at twice the median should explain why.

### Exchanges and catalogs

An exchange holds your payment until the post goes live. This comparison is as of September 28, 2026; terms change.

| Platform | What it is | Who can pay | Money and marking |
|---|---|---|---|
| Telega.io | International channel ad exchange | Individuals and companies; Mamo, Capitalist, Payeer, TON, USDT, invoice | Held until the post goes live, refunded if it isn't out within 60 hours; the channel gets 87.5% of the price |
| Telega.in | Russian version of the same exchange | Not verified | Automatic marking claimed in its blog; not verified |
| Telemetr | Analytics and an agency offer (version 1.1 of September 28, 2026) | Russian residents only: legal entities, sole proprietors, self-employed; balance from 5,000 rubles | Fee shown in the account; the agent gets the erid before the post goes live |
| TGStat | Analytics, catalog, agency for brands | Brands and agencies | — |

You pay the Telega catalog price, and the channel gets 87.5%[^src-telega-faq-53]. On September 28, 2026, telega.in required a browser check, so we couldn't read its terms[^src-telega-in-53]. The rest comes from Telemetr's offer[^src-telemetr-offer-53] and TGStat's pages[^src-tgstat-agency-53]. Telegram Ads, Telegram's official ad platform, is covered in [chapter 5.4](#ch-5-4).

Telemetr's full analytics are paid: the Econom plan is 2,750 rubles a month, and during promotions a trial week costs 1 or 299 rubles[^src-telemetr-tariffs-53]. For your first placements, the free channel card is enough: subscribers, views, mentions and status in the Roskomnadzor register. Roskomnadzor is Russia's communications regulator, and the register lists large channels. A missing red fake-views mark guarantees nothing: Telemetr says it may simply not have reached the channel yet[^src-telemetr-help-53].

### Buying directly from the admin

Skipping the middleman is cheaper, but all the risk is yours. The 1/24 format means an hour at the top of the feed, then a day in the channel; 2/48 means two hours and two days[^src-telega-faq-53][^src-telemetr-offer-53]. A regular post is your text, unedited. A native post is written by the channel's author: agree on the text before you pay, and the link stays yours.

Put it in writing before you pay:

```text
Hi! I'd like to buy an ad for our bot in your channel.
Format 1/24, October 10, noon to 2 PM Moscow time, no other ads within an hour on either side.
We supply the text and the visible link example.com/r/p1010; please publish them without edits.
Marking: will you register the erid, or do you need our details for the ORD?
24 hours after the post, please send a screen recording of the post's stats.
```

For a single post, Telegram shows only a views chart; view sources are available only for the channel as a whole[^src-tg-stats-53]. A screenshot is easy to fake, so ask for a screen recording. Compare it against Telemetr's hourly data and your own `clicks_by_hour`.

A fixed price is simpler than paying per thousand views. With per-view pricing, the admin has a reason to inflate views, so a fixed price plus your own click count is more reliable. Pinning the post at the top of the channel costs extra; start without it.

The main risk is prepayment: the post never goes out, or it vanishes after an hour. With unfamiliar channels, make your first purchases through an exchange that holds the money.

### Creative: one promise from post to first screen

In chapters [2.1](#ch-2-1), [2.2](#ch-2-2) and [5.2](#ch-5-2), the `src_tg_chanA_0927` placement brought many starts and almost no value. The hypothesis there: people came without a task. The creative is where you hand them one.

- One hook: one situation the channel's readers know.
- One example phrase they can send the bot right away.
- One link: your short address, with the placement tag behind it.
- A matching promise ([chapter 5.1](#ch-5-1)): the post, the bot description and the first screen say the same thing. The `-c2` variant in the tag turns on its own first screen through `firstScreen` from chapter 5.2.

Each channel gets its own text. That's not an A/B test: the channel and the text change together, so you can't credit the difference to the text ([chapter 2.5](#ch-2-5)).

::: case
Suppose we buy a placement for our calendar bot in a parenting channel (an illustration):

> After-school clubs, doctor visits, school meetings, all in one chat. Tell the bot "Thursday 5 PM, Masha's swimming, remind me and my husband." It'll create the event and invite the other parent.

The link goes to `/r/p1010`, and from there to `?start=src_tg_par_1010-c2`. The first screen for variant `c2` says "create an event and invite your family," with a button.
:::

### A short redirect address

The bot can't see who opened the link and changed their mind. A short address on your own domain counts the clicks: `example.com/r/p1010`. It writes a row to `clicks` and answers with a 302 redirect to `t.me/<bot>?start=<tag>`. `addPlacement` validates the tag with `checkPayload` from chapter 5.2; an unknown address leads to the bot with no tag and isn't recorded.

Crawlers that build link previews also "click": `TelegramBot (like TwitterBot)`, `facebookexternalhit` and others[^src-ua-previews-53]. So we store a class, not the User-Agent: `mobile`, `desktop`, `preview`, `bot` or `unknown`.

Repeat clicks within a day are merged using a hash with a daily salt. IP addresses aren't stored; details are in the README and [chapter 5.8](#ch-5-8). Unique clicks are a lower bound: people who share a carrier's IP address and phone model count as one. That's why the total click count is shown alongside.

The web server in front of your code may log IP addresses on its own: nginx does so by default. Turn off logging for `/r/` (`access_log off;`) or anonymize it; with Caddy and Cloudflare, check the settings.

Before you publish, test the link on iOS, Android and Telegram Desktop, in both the in-app and the external browser. Put a visible address in the post, not a link hidden behind text: Telegram may ask for confirmation before opening a hidden link[^src-tg-openurl-53]. Ask the exchange whether it wraps links in its own counter: a double redirect is one more place to lose people.

### Counting a placement

The `placement_funnel` query joins clicks with starts, first value and activation from chapters [2.2](#ch-2-2) and [5.2](#ch-5-2). The cost per step is the post's price in dollars divided by the number of people who reached that step. Record the same amount in `marketing_spend` from [chapter 2.4](#ch-2-4).

Suppose we had also counted clicks for the $40 placement `src_tg_chanA_0927`. Starts, first value and activation come from chapters 2.1, 2.4 and 5.2; clicks and first messages are an illustration.

| Step | People | Cost per step, $ |
|---|---|---|
| Clicks (unique, no robots) | 260 | 0.15 |
| New starts | 112 | 0.36 |
| Sent a first message within a day | 45 | 0.89 |
| First value within 7 days | 8 | 5.00 |
| Activation within 7 days | 5 | 8.00 |

Judge the card from [chapter 5.1](#ch-5-1) by the share of people who wrote to the bot: here, 45 of 112. The biggest drop is from first message to first value. That's a hypothesis from a single placement; we'll test it with the same creative in a second channel.

In the illustration from [chapter 2.4](#ch-2-4), an activated user brings in $1–2 over their lifetime. That's a subscriber's contribution spread across ten activated users; the $1 figure is net of the free users' cost. So a $40 placement pays for itself in subscriptions at 20–40 activated users, not at five. **With a paid placement, we're testing the promise and the segment, not buying revenue.**

Chapter 2.4 promised to count people who arrived after a placement without a tag: through search (`none`) or a forward (`src_share`). The `untagged_uplift` query compares such newcomers in the 48 hours after the post with a normal 48 hours, averaged over the two weeks before it. It adds the uplift to the tagged users and gives the cost per activated user as a range: say, $5.70 to $8.

That's without first-week AI costs; with them, it's $6–8.40, as in chapter 2.4. Space placements at least two days apart, or their uplifts will overlap.

Small numbers call for the same honesty as in [chapter 2.1](#ch-2-1): five activated users versus three is no difference. Under 30 unique clicks, look at individual people and wait for a second placement before deciding (rule of thumb: check it against your own data). Trust only a severalfold difference that repeats across several channels.

### The law and ad marking

If you advertise to a Russian audience, Federal Law No. 38-FZ "On Advertising" comes down to three questions. What to mark: the post carries the word «реклама» ("advertisement"), the advertiser and an **ad ID (erid)**. The erid comes from an **advertising data operator (ORD)**, and an ad without one may not run[^src-38fz-181-53].

Who gets the erid: both the advertiser and the channel must report the ad data. The erid can be obtained by an exchange acting as your agent, by the channel or by you under a contract with an ORD.

What you risk: under KoAP, Russia's Code of Administrative Offenses, an ad without an erid costs individuals 30,000–100,000 rubles and legal entities 200,000–500,000[^src-koap-143-53]. Since January 1, 2025, ads are banned in channels with over 10,000 subscribers that aren't in the Roskomnadzor register[^src-rkn-list-53]. By the letter of the law, the channel is liable for this. We haven't checked enforcement practice, so pick channels from the register.

For ads on resources with restricted access, both the channel and the advertiser are liable[^src-38fz-38-53]. That's the provision FAS (Russia's competition regulator) applied to Telegram.

::: warning
FAS already treats advertising in Telegram as a violation of Part 10.7: Roskomnadzor restricts access to Telegram, and ads on such resources are banned. FAS stated this position on March 10, 2026, and on March 25 promised no penalties until the end of 2026[^src-fas-53]. From 2027, the advertiser and the channel risk fines: up to 2,500 rubles for individuals and 100,000–500,000 for legal entities. This is a question for a lawyer; plan your channels so the product doesn't rest on paid placements alone (checked September 28, 2026).
:::

The safe default for a first placement in a Russian channel is an exchange that obtains the erid itself. The other option is a channel that sends you the erid before the post goes live. A foreigner without an ORD contract can't get an erid on their own, which leaves the channel, the exchange or an agent. Channels pay a 3% levy on ad income, and it may be built into the post's price[^src-38fz-182-53].

::: note
This isn't legal advice. When your spending grows, ask a lawyer:

- whether Russian advertising law applies to you if you and the bot are abroad and the channel's readers are in Russia;
- who registers the erid, and whether you can sign a contract with an ORD from your country;
- what changes for advertising in Telegram from 2027;
- who pays the 3% levy when the advertiser is foreign;
- which advertising laws apply to channels in other countries, and what that means for the data of the people who arrive ([chapter 5.8](#ch-5-8)).
:::

### A $100 plan

::: case
A starter plan for our calendar bot (an illustration: the channels and prices are hypothetical). [Chapter 2.4](#ch-2-4) shows how to calculate acquisition cost on a $100 budget.

| Placement | Price, $ | Hypothesis |
|---|---|---|
| Parenting channel, 1/24 | 30 | Families will come with a "shared calendar" task |
| Channel for meetup organizers, 1/24 | 25 | Organizers will invite participants |
| Productivity channel, 1/24 | 20 | People without a specific task: a test of the chapter 5.2 conclusion |
| Repeat of the best one after 2–3 weeks | 25 | The result holds up and isn't a fluke |

The channels are small, under 10,000 subscribers, so below the register threshold, and they don't overlap in the mention graph. The posts go out at least two days apart.

Before launch, each placement gets three targets: at least 30 unique clicks, starts from 30% of clickers and first value for 10% of starters. These are rules of thumb: check them against your own data. We keep a channel if it meets at least two of the three after 7 days. Each channel brings only a handful of activated users, so we count them only across the whole plan.

We stop paid placements altogether if first value doesn't reach 10% of starts in any channel. Then the problem is onboarding, not the channels: back to [chapter 5.2](#ch-5-2).
:::

::: warning
Common paid-placement mistakes:

- Choosing by subscribers instead of views, without looking at the channel's ad history.
- One link for every channel, so you can't tell placements apart.
- Two channels with the same audience in the same week.
- Judging by starts: a cheap start with no value is the most expensive result.
- Paying the full amount up front to an unfamiliar channel.
- An ad in a Russian channel without the «реклама» mark and an erid.
- Changing the creative, the card and the first screen all at once.
:::

## Your step

::: step
Tonight, prepare one paid placement without buying anything:

1. Pick three channels in your segment. For each, note subscribers, views, ERR in one window, and whom the channel has advertised. Drop any channel with signs of fake views.
2. Write the text for the best one: one hook, one example phrase, one link.
3. You'll need Bun and a database with the tables from chapters 2.1–5.2. Put an `add.ts` file next to `redirect.ts`:

```typescript
import { Database } from "bun:sqlite";
import { initSchema as initDeeplinks } from "../deeplinks/deeplinks";
import { addPlacement, initSchema } from "./redirect";
const db = new Database("growth.sqlite"); initDeeplinks(db); initSchema(db);
addPlacement(db, { slug: "p1010", channel: "parenting channel", price: 30, currency: "USD", priceUsd: 30, format: "1/24", payload: "src_tg_par_1010-c2" });
```

4. Run `bun add.ts`, then `BOT=YourBot DB=growth.sqlite bun redirect.ts`, and open `localhost:3000/r/p1010`.

No server? Give the channel your own `?start=` link with the placement tag. Clicks won't be counted then, but the rest of the funnel will.

**Done when** the address opens the bot with a "Start" button and a `mobile` or `desktop` row appears in `clicks`.
:::

**Recap.** Which channel to keep is decided in the $100 test of [chapter 3.4](#ch-3-4). Telegram's official ads are in [chapter 5.4](#ch-5-4). Channels that bring in organizers return as partners in [chapter 4.3](#ch-4-3). `placement_funnel` joins the weekly ritual of [chapter 6.1](#ch-6-1), and the message and creative templates go to Appendix A.1.

[^src-telemetr-err-53]: Telemetr, help article "Engagement" (in Russian): the average number of views per post over 7 days or 24 hours, divided by the number of subscribers. help.telemetr.me (accessed September 28, 2026).
[^src-tgstat-guide-53]: TGStat, "A guide for Telegram advertisers" (in Russian), July 7, 2023: sharp rises and drops in subscribers; more than 80% of those who subscribed within 24 hours have already unsubscribed; ERR "from 10%"; citation index "at least 30." tgstat.ru/academy/1018-advertisers-guide (accessed September 28, 2026).
[^src-telemetr-help-53]: Telemetr help (in Russian): "Who mentioned / whom it mentioned," "Channel views by hour," "Channel information" (status in the Roskomnadzor register), "Audience analysis" (your own channel, through their bot), "Fraud and fake-view marks" (a missing red mark doesn't mean the channel isn't inflating its numbers). Deleted ad posts: the telemetr.me home page. Accessed September 28, 2026.
[^src-tgstat-api-53]: TGStat API, "Getting channel statistics": `adv_post_reach` is the average ad reach of a post over 12/24/48 hours; `err24_percent`, `ci_index`. api.tgstat.ru/docs/ru/channels/stat.html (accessed September 28, 2026).
[^src-tg-recommend-53]: Telegram API, "Similar channels and bots": similar channels based on audience similarity. core.telegram.org/api/recommend (accessed September 28, 2026).
[^src-examples-redirect]: github.com/alex-mextner/indie-growth-book, folder `examples/redirect`: a Bun redirect, the placements table, queries and tests.
[^src-telega-faq-53]: Telega.io, home page ("for both individuals and business owners") and FAQ: payment through Mamo, Capitalist, Payeer, TON, USDT or invoice; money is held until the order is fulfilled and returned if nothing is published within 60 hours; formats 1/24, 2/48, 3/72 and native; the channel receives the price minus a 12.5% commission. telega.io/faq (accessed September 28, 2026).
[^src-telega-in-53]: Telega.in: blog article titles about automatic marking, from search results; on September 28, 2026, the pages themselves wouldn't open without a browser check. The telega.io guarantees page refers users to telega.in support.
[^src-telemetr-offer-53]: Telemetr, "Agency offer agreement for arranging ad placements in Telegram and Max messenger channels" (in Russian), version 1.1, effective September 28, 2026: clause 1.1 (Russian residents: legal entities, sole proprietors, self-employed), 1.4 (formats), 3.1 (from 5,000 rubles), 3.2 (the fee is shown in the account), 4.3 (erid before the placement starts), 4.7 (channels with 10,000+ subscribers need confirmed registration). telemetr.me/oferta/advertiser (accessed September 28, 2026).
[^src-tgstat-agency-53]: TGStat, "Advertising in Telegram channels": an agency for brands and agencies (tgstat.ru/promotion/agency); "Advertising on TGStat," August 4, 2025: banners on the site's own pages (tgstat.ru/academy/1221-advertising-on-tgstat). Accessed September 28, 2026.
[^src-telemetr-tariffs-53]: Telemetr: plans (telemetr.me/tariffs), Econom at 2,750 rubles a month; help pages list the promotions "Econom for 1 ruble for 7 days" and "for 299 rubles for 7 days." Accessed September 28, 2026.
[^src-tg-stats-53]: Telegram API, "Channel statistics": a channel has `views_by_source_graph` and `new_followers_by_source_graph`; a post (`stats.getMessageStats`) has a views graph. core.telegram.org/api/stats (accessed September 28, 2026).
[^src-ua-previews-53]: Meta, "Meta Web Crawlers": `facebookexternalhit` builds link previews. The `TelegramBot (like TwitterBot)` string comes from the user-agents.net catalog; Telegram has no official description of it (accessed September 28, 2026).
[^src-tg-openurl-53]: Telegram's localization platform, Russian localization, key OpenUrlAlert2: `Перейти по ссылке %1$s?` ("Open the link `%1$s`?"). translations.telegram.org/ru/android/bots_and_payments/OpenUrlAlert2 (accessed September 28, 2026). The documentation doesn't say when the client shows it.
[^src-38fz-181-53]: Federal Law No. 38-FZ "On Advertising," Art. 18.1: Parts 3 and 5 (advertisers, ad distributors and ad system operators report data through an ORD), Part 16 (the «реклама» mark and the advertiser), Part 17 (distribution only with an ID). consultant.ru, version of August 4, 2026 (accessed September 28, 2026).
[^src-koap-143-53]: KoAP (Russia's Code of Administrative Offenses), Art. 14.3: Part 16 (an ad without an ID): individuals 30,000–100,000 rubles, officials 100,000–200,000, legal entities 200,000–500,000; Part 1 (other violations of the advertising law): individuals 2,000–2,500, officials 4,000–20,000, legal entities 100,000–500,000. consultant.ru, version of July 26, 2026 (accessed September 28, 2026).
[^src-rkn-list-53]: 38-FZ, Art. 5, Part 10.6 (added by Federal Law No. 303-FZ of August 8, 2024, in force from January 1, 2025 under Art. 5 of 303-FZ, normativ.kontur.ru); Federal Law No. 149-FZ, Art. 10.6, Parts 1.1–1.3 (the register of pages with an audience over 10,000); 38-FZ, Art. 38, Part 7: the distributor is liable under Part 10.6, and Part 6 doesn't list it for the advertiser. consultant.ru, versions of August 4, 2026 and June 26, 2026 (accessed September 28, 2026).
[^src-38fz-38-53]: 38-FZ, Art. 5, Part 10.7 (resources of undesirable organizations and resources with restricted access; from September 1, 2025, under Federal Law No. 72-FZ of April 7, 2025) and Art. 38, Parts 6 and 7 (advertiser: Parts 10.4, 10.5, 10.7, 10.8; distributor: Parts 10.5–10.8). consultant.ru, version of August 4, 2026 (accessed September 28, 2026).
[^src-fas-53]: Interfax, March 25, 2026, interfax.ru/russia/1079848 (grace period until the end of 2026; the advertiser and the distributor are liable); rb.ru, "Telegram ad ban, 2026–2027" (in Russian), May 23, 2026 (FAS position of March 10, 2026, Art. 5, Part 10.7; the advertiser and the distributor are liable). As of September 28, 2026, we found no reports of the grace period being extended.
[^src-38fz-182-53]: 38-FZ, Art. 18.2: 3% of quarterly online advertising revenue, paid by distributors and ad system operators. consultant.ru (accessed September 28, 2026).
