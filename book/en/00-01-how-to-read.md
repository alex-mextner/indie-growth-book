# How to Read This Book {#ch-0-1}

This book is for people who can build a product but can't yet get anyone to use it or pay for it. If you have a bot, an app or a service used by you, your family and a couple of friends, you're our reader. We were in exactly that spot when we started writing.

We are a product-minded developer with fifteen years in software and a writer with an audience and an ear for language. Between us we had several working products and one community grown from zero to ten thousand people. Not one of those products made money.

We knew how to build, and we knew how to gather people around something useful. We didn't know how to count, how to pick channels or how to sell. This book exists to close exactly that gap.

## What you won't find here

You won't find an explanation of what marketing is or why you should listen to users. You know that already. Nor will you find stories about a startup that raised $10 million and bought a Super Bowl ad. Your first-stage budget is closer to $100, and that's fine.

There are no universal recipes like "post seven times a week" or "the algorithm loves video." Anyone who confidently explains how a social network's algorithm works either works at that network or is wrong. We keep three things apart: what a primary source confirms, what works for us, and what is still a hypothesis.

## How each chapter works

Every chapter has the same four-part skeleton.

**The gist.** One or two pages on what people who have done this many times already know. It links to the books and articles behind it, so you can read the primary sources in full. If the topic is familiar, you'll recognize it in the first paragraph and move on.

**The bridge.** The core of the chapter. How the idea plays out for a small product: two people, about $100, Telegram (a messaging app with its own bot and payments platform), a Russian-speaking audience, and a bill for every AI request. This is where the calculations, database queries, tables and real numbers live.

**Your step.** One thing to do tonight, with a clear "done when" test. A step never asks you to buy a subscription or learn a new tool. If you take no steps at all, the book stays an interesting read and nothing more.

**Recap.** Three to five lines on where the idea comes back later and from what angle. We repeat key ideas on purpose: in our experience, what sticks is what you've met several times in different contexts.

Some chapters open with a "Know this? Skip ahead" box. It means the first pages cover the basics, and it tells you which section to start from if you already know them.

## The running example

Theory without an example doesn't stick. So one product runs through the whole book: HyperCalendarBot, a calendar bot for Telegram whose code you can read on GitHub[^src-hcb]. You talk to it like a person: "gym Thursday at seven, remind me an hour before." It creates the event, syncs it with Google Calendar, can call you by voice, and keeps a shared calendar for a family or a group of friends.

We'll call products like this **conversational products**: you don't click through pages, you chat. They have their own rules for funnels, retention and onboarding, and the book gives them special attention.

The bot makes a good teaching example for three reasons. Every user costs money: each request to the AI model is billed, so a free user is an expense. It has built-in virality: an event invitation brings a new person in by itself.

And it has two possible business models: a subscription for individuals, and payment from organizers with many participants. Almost any indie product resembles it in at least one of these ways.

The second running example is an expense-tracking bot. It's simpler, with a different benefit and a different usage rhythm. Where a chapter's method doesn't obviously carry over to it, a separate box shows how. You'll also meet a community of electric-car owners and a writer's social media account: examples of growth through usefulness and through content.

::: note
The code in this book is TypeScript and SQLite (the `bun:sqlite` driver), same as the bot itself. Full versions with tests live in the `examples` folder of the book's repository.

If you use Postgres, store dates as `timestamptz` and swap: `INSERT OR IGNORE` → `INSERT … ON CONFLICT DO NOTHING`, `datetime('now', '-7 days')` → `now() - interval '7 days'`, `SUM(condition)` → `COUNT(*) FILTER (WHERE condition)`, `strftime` → `date_trunc`. If your bot runs on Python and aiogram, use a single `CommandStart()` handler: the link parameter arrives in `command.args`, and for a bare `/start` it's `None`.
:::

## If you're short on time

The chapter order is logical but not mandatory. The detailed reading map is in [chapter 0.2](#ch-0-2), where a short questionnaire suggests what to read first. In brief, there are three routes.

**"I'm launching next week."** [Chapter 2.1](#ch-2-1) on attribution, [2.2](#ch-2-2) on the funnel, [5.1](#ch-5-1) on the bot's profile card, [5.2](#ch-5-2) on onboarding and [5.8](#ch-5-8) on personal data. Paid ads ([chapter 3.4](#ch-3-4)) come only after the funnel shows that the people who arrive actually reach the value.

**"I don't know who needs this."** Part I, especially [chapter 1.2](#ch-1-2) on interviews and [1.4](#ch-1-4) on positioning. Then [chapter 2.3](#ch-2-3) on cohorts: it shows whether the product keeps people.

**"I have users but no money."** Part IV, then [chapter 2.4](#ch-2-4) on unit economics. If the product spends money on every user, start with 2.4.

## Terms and numbers

We introduce each term in plain words the first time it appears in a chapter, and spell out abbreviations: retention, customer acquisition cost (CAC). Nearly all the literature and tools on the subject are in English, while our running examples serve Russian-speaking users. The glossary at the back collects every term in one place.

We date every number about platforms and prices: they change faster than new editions come out. Numbers without a source are marked as a rule of thumb. Check them against your own data.

::: step
List the products you've built or are building, up to three; one is enough. Next to each, write one number: how many people other than you and your family used it last week. If you don't know the number, write that down.

**Done when** the list is on your desk. You'll need it in [chapter 2.3](#ch-2-3), where we learn to get this number automatically. You'll use it again in [chapter 6.5](#ch-6-5) to pick which product deserves a month of work.
:::

**Recap.** You'll meet the gist → bridge → step → recap structure in every chapter. The running example, the calendar bot, takes center stage in [chapter 2.1](#ch-2-1). There we open its code for the first time and see what it didn't know about its users.

[^src-hcb]: github.com/alex-mextner/HyperCalendarBot (accessed September 27, 2026). Code fragments in the book are simplified for readability.
