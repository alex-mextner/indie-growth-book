# 2.6. One Metric per Quarter {#ch-2-6}

::: skip
If you know the North Star Metric, OMTM and paired metrics, start with "The bridge." It covers which number to pick for a product that isn't making money yet.
:::

After chapters [2.1](#ch-2-1)–[2.5](#ch-2-5) you have a dozen numbers. Two people working evenings can't move them all at once.

## The gist

### One number and its companions

Each evening goes to one thing. With five goals, any evening can be justified, and after a quarter nothing has moved. So you pick a **quarterly metric**: one number, plus input metrics you move directly and guardrails that mustn't get worse. The other numbers become diagnostics: you turn to them when the main one stalls.

### The North Star and the metric of the moment

The **North Star Metric** is a single number that reflects the value customers get and moves ahead of revenue. That's how Amplitude's guide "The North Star Playbook" describes it[^src-amplitude-northstar].

In *Lean Analytics* (2013), Alistair Croll and Benjamin Yoskovitz introduced the **One Metric That Matters** (OMTM). It depends on the business model and the product's stage, and it changes when the stage does[^src-lean-analytics]. The North Star answers what value we deliver; the quarterly metric answers what we're fixing now. Early on, they often coincide.

### What makes a good number

Of the seven questions in Amplitude's checklist, we keep four[^src-amplitude-northstar]:

- **reflects delivered value**, not the team's effort;
- **leading**: moves before revenue and churn do;
- **actionable**: it's clear which changes move it;
- **understandable**: explainable in one sentence to someone outside the product.

One more question from the checklist asks whether it's a vanity metric ([chapter 2.2](#ch-2-2)). A cumulative user count fails three of the four tests; it's understandable, and that's all.

### Input metrics

The guide splits the main number into **input metrics**, which the team moves day to day, and advises influencing the North Star only through them[^src-amplitude-northstar]. Look for inputs along four axes: breadth, depth, frequency, efficiency. For a calendar bot, breadth is how many people got a first reminder, and depth is how many events a person has. Frequency is how often they write; efficiency is how many messages the bot understood the first time.

### Guardrails against Goodhart

In 1975, economist Charles Goodhart observed that a statistical regularity breaks down once pressure is put on it for control. The popular phrasing came from anthropologist Marilyn Strathern in 1997: "When a measure becomes a target, it ceases to be a good measure"[^src-goodhart].

Andy Grove described the defense in *High Output Management* (1983). An indicator pulls your attention toward itself: start measuring inventory and you'll push it down until shortages appear. So indicators go in pairs, to capture both the effect and the counter-effect[^src-grove]. In [chapter 2.5](#ch-2-5) we called the second metric of the pair a guardrail: it gets no target, you just make sure it doesn't get worse.

## The bridge

### Candidates for the calendar bot

Let's run everything the bot can already count through the four questions.

| Candidate | Why it's not the main number |
|---|---|
| `/start` count | Grows with the paid placement budget, says nothing about value |
| Daily active users (DAU) | A calendar is needed once or twice a week; silent value doesn't show ([chapter 2.3](#ch-2-3)) |
| Events created | An attempt, not value ([chapter 2.2](#ch-2-2)) |
| Reminders delivered | One person with thirty recurring events weighs as much as thirty people; grows with zombies too |
| People in touch last week, other than us | Passes all four questions once new users and zombies are removed |
| Paying partners | Lagging: always zero before monetization |

**The bot's North Star** is people in touch last week, other than us ([chapter 2.3](#ch-2-3)). Each of them either did something themselves or got a reminder and didn't block the bot. For now, the quarterly metric matches it, with two corrections.

First, every paid placement adds people who tapped `/start` in week 0 and left. So the metric counts only people for whom last week was week 1 or later; new users go on a separate line.

Second, the passive line accumulates zombies, as [chapter 2.3](#ch-2-3) warned. We count only the living: an action or a "Got it, thanks" tap within 28 days. Otherwise, cleaning out zombies would drag the metric down.

Our success criteria (paying partners, paying users and economics that add up) all lag: people pay once they already get value.

### Inputs and guardrails

The first input is **activated users per week** ([chapter 2.2](#ch-2-2)). That's how many people from the cohort of the calendar week before last got their first reminder within seven days. We take the count: the share jumps with the channel mix and stays a diagnostic.

The second input is week-4 retention of activated users, from the triangle in [chapter 2.3](#ch-2-3). Also track the step you're fixing this quarter, such as the share who get past the time zone question. That's the "measure the nearest step" rule from [chapter 2.5](#ch-2-5).

There are two guardrails, tracked separately rather than added up. One is the share of reminder recipients who blocked the bot; the other is the share of zombies among the rest. More reminders mean more blocks, while ignoring people who leave silently lets zombies pile up. Watch the direction over several weeks.

If your bot never writes first, the metric is active users from week 1, and the guardrail is blocks among last week's active users.

### Stages

| Stage | Quarterly metric | Inputs | Guardrails |
|---|---|---|---|
| Now, before monetization | People in touch from week 1, minus zombies | Activated users per week; week-4 retention of activated users | Block share; zombie share |
| First organizers (plan) | Organizers with at least N participants in touch (hypothesis) | Participants who came through their invitations | Partner contribution above zero ([chapter 2.4](#ch-2-4)); the first row's metric doesn't fall |

Paying partners are the outcome this metric should predict. [Chapter 4.3](#ch-4-3) explains why organizers. The reminder log will need the event's author: right now it stores only the recipient.

### The weekly numbers

The `quarter_card_weekly` query in `examples/north-star` uses `user_acquisition` ([chapter 2.1](#ch-2-1)), `funnel_events` and `bot_status` ([chapter 2.2](#ch-2-2)), and `user_activity` and `reminder_deliveries` ([chapter 2.3](#ch-2-3)). Suppose that on Monday it returned this (an illustration):

```text
in_touch  new_in_touch  activated  activated_pct  blocked_pct  zombie_pct
      23             9          6             19            4          13
```

The metric is 23, with 9 new users in touch and 6 activated. Passive users, blocks and zombies become final only a week later, so rerun the query next Monday.

### Quarter, week, experiment

You pick the metric once a quarter and look at it once a week: these numbers open the weekly ritual in [chapter 6.1](#ch-6-1). Experiments from [chapter 2.5](#ch-2-5) move the inputs, and the guardrails check the result. Don't change the metric mid-quarter, except when the stage changes: the first paid invoice from an organizer.

First signs of a change show up after a week; a conclusion takes three or four. Week to week, a count of N swings by about ±2·√N, or ±10 at 25 people (rule of thumb: check it against your own data). So look at a four-week moving average, and leave holiday weeks out when setting targets. Intervals for shares are in [chapter 2.5](#ch-2-5).

If fewer than ten people are in touch, keep a list by name: who, what they did, why they left. The number will become useful later.

::: case
Suppose the expense-tracking bot's value is a weekly summary. The bot can't see whether the summary was opened: the Bot API has no read receipts. The quarterly metric is people from week 1 who tapped "Details" under the summary or logged an expense that week.

The input is new users whose first summary had at least five expenses ([chapter 2.2](#ch-2-2)). The guardrails are unsubscribes from the summary and blocks after it.
:::

::: warning
Don't pick a metric that grows with money or broadcasts: `/start` counts grow with paid placements, delivered messages with "don't forget about us" nudges. A broadcast is never written to `reminder_deliveries` as `'reminder'`. The test: if the number grows only while you're spending the $100, you're measuring the budget, not the product.
:::

## Your step

::: step
Tonight, pick your quarterly metric:

1. List three to five candidates and run them through the four questions.
2. Pick one quarterly metric, one input and a guardrail. Write the card on one line: "By [last day of the quarter] we grow [metric]; we move [input]; we make sure [guardrail] doesn't rise."
3. Adapt `quarter_card_weekly` to your tables and put your accounts into `me`.

**Done when** the card sits next to your list from the step in [chapter 0.1](#ch-0-1) and the query runs. If your tracking is less than three weeks old, zeros and empty values are expected: the card matters more right now. Add a target number in three or four weeks, once you see the normal spread.
:::

**Recap.** The card opens the weekly ritual in [chapter 6.1](#ch-6-1). In [chapter 4.6](#ch-4-6), the economics sheet supplies the guardrail for the organizer stage. In [chapter 6.5](#ch-6-5), the quarterly metric helps decide which product deserves the next month.

[^src-amplitude-northstar]: Amplitude, "The North Star Playbook," 2024 edition (co-authored by John Cutler): the definition, input metrics, a seven-question checklist (the seventh is about vanity metrics), "Never try to influence the North Star directly." info.amplitude.com/rs/138-CDN-550/images/Amplitude-The-North-Star-Playbook.pdf (accessed September 28, 2026).
[^src-lean-analytics]: Alistair Croll, Benjamin Yoskovitz, *Lean Analytics*, O'Reilly, 2013, ch. 20, "Model + Stage Drives the Metric You Track": the Empathy, Stickiness, Virality, Revenue and Scale stages. oreilly.com/library/view/lean-analytics/9781449335687/ch20.html (accessed September 28, 2026).
[^src-goodhart]: Charles Goodhart, "Problems of Monetary Management: The UK Experience," 1975. Marilyn Strathern, "'Improving ratings': audit in the British University system," European Review, 1997, vol. 5, no. 3, pp. 305–321: "When a measure becomes a target, it ceases to be a good measure," citing Keith Hoskin (1996). Per the English Wikipedia article "Goodhart's law" (accessed September 28, 2026).
[^src-grove]: Andrew S. Grove, *High Output Management*, Random House, 1983: pairing indicators so that both effect and counter-effect are measured; the inventory and shortages example (accessed September 28, 2026).
