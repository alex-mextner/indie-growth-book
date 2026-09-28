# 2.5. Experiments Without Millions of Users {#ch-2-5}

::: skip
If you know what statistical power is and why you can't stop an A/B test at the first "significant" result, go straight to the bridge. Start with "What you can measure on two hundred people."
:::

In [chapter 2.2](#ch-2-2) the funnel showed a drop at the time zone step and three possible fixes. Here we test one of them: buttons with four common time zones plus "Send my location." In [chapter 2.3](#ch-2-3), week 1 went up for the newest cohorts, and we put off the question "real fix or chance?" until this chapter.

## The gist

### A controlled experiment

An **A/B test**, or controlled experiment, is simple. You split people into groups at random, and the groups run at the same time. Group A sees the product as it was; group B sees it with the change. Season, channels and news hit both groups alike, so the difference between them is the effect of the change plus chance.

Intuition about which changes will help is often wrong. In 2009, Ron Kohavi and colleagues looked at Microsoft's well-run experiments designed to improve a key metric. Only about a third actually improved it[^src-kohavi-third].

### How many people you need

An experiment can go wrong in two ways. It can "find" a difference that isn't there; the probability of that is the **significance level**, usually 5%. Or it can miss a difference that is there. The probability of catching it is the **power**, usually 80%.

For shares there's a back-of-the-envelope rule, Lehr's rule. Gerald van Belle gives it in his book *Statistical Rules of Thumb*[^src-vanbelle-lehr]:

```text
people per group ≈ 16 × p̄ × (1 − p̄) ÷ δ²
```

Here p̄ is the average of the two shares you expect, and δ is the difference between them, the minimum detectable effect. The 16 corresponds to 5% significance and 80% power. Van Belle warns that the rule works well when the answer comes out between 10 and 100.

Suppose 20% of new users reach activation, and you get 100 new users a week, 50 per group. The numbers are an illustration:

| Want to detect | People per group, by the rule | Normal approximation with pooled share p̄ | Weeks to recruit |
|---|---|---|---|
| 20 → 25% | 1,116 | 1,094 | 23 |
| 20 → 30% | 300 | 294 | 6 |
| 20 → 40% | 84 | 82 | 2 |

Add a week so the last arrivals get their seven days to activate. Evan Miller's calculator gives 5–20% less (1,030, 263 and 67), because it computes the "no effect" spread from the baseline share[^src-miller-calc]. That doesn't change the decision.

The key takeaway of this section: **with small numbers, only big changes are measurable.** Proving a five-point rise in activation takes almost six months.

### The confidence interval

A **confidence interval** is a range around a measured share. If you repeated the experiment many times, 95 out of 100 such ranges would cover the true value. The noise gauge ±2·√(p(1−p)/n) from [chapter 2.3](#ch-2-3) is a rough version of it. If the interval for B − A lies entirely above zero, chance is a poor explanation; if it covers zero, it's within the noise.

### Peeking

The most common mistake is stopping as soon as the difference turns "significant." In 2010, Evan Miller modeled a test that is checked after every new person and stopped at 5% significance or at 150 people[^src-miller-peeking]. A change that does nothing "wins" 26.1% of such experiments instead of 5%.

If you peek ten times, then even with a strict 1% threshold at each peek, you'll get 5% false wins. Miller's cure is simple: decide how many people you need before you start, and don't trust the numbers until you have them.

## The bridge

### What you can measure on two hundred people

The sample-size table above leads to three conclusions for a small product.

**Change things in big steps.** A button color won't move a share by twenty points; removing a step or replacing a question with buttons can.

**Measure the nearest step.** The buttons move the time zone step first and activation only later. In [chapter 2.2](#ch-2-2) we sketched lifting that step from 60% to 80% of those who reached it, or from 49% to 65% of all arrivals. That's 154 people per group, four weeks of recruiting; the same rise in activation, 21% to 28%, takes 604 people, about three months.

**Make everything else a guardrail metric.** Count activation and blocks in both groups to spot a collapse, not to prove an improvement.

### If you get fewer than twenty new people a week

Many new bots live here, and groups don't help: in a quarter you won't get even a hundred per group. Write the hypothesis card (next section) anyway, ship the change to everyone and compare before and after with the caveats from "Another scenario." Read the path of every arrival and talk to five people.

Groups start to make sense at around 50 new users a week (rule of thumb: check it against your own data). Between 20 and 50, alternate weeks or measure the nearest step.

### The hypothesis card

Before you start, write down what you're testing and what you'll do for each outcome. In research this is called preregistration[^src-prereg]. Without a record, it's easy to pick the metric that went up, or a convenient stopping date, after the fact.

```text
Experiment:   tz_buttons, start Mon Oct 5, recruiting ends Nov 2, readout Nov 9
Change:       instead of "What city are you in?", four common time zones
              as buttons plus a "Send my location" button
Why:          4 in 10 of those who reach this step leave (funnel, 2.2)
Who:          new users from Oct 5, group assigned on /start, 50/50; not my accounts
Primary:      share of arrivals who reach timezone_set within 7 days
Guardrails:   activation within 7 days; blocks within 7 days
Wait for:     154 per group (49 → 65%), four full weeks
Rule:         whole interval of the difference above 0 — keep B;
              whole interval below 0 — roll back;
              zero inside, lower bound above −15 points — a tie;
              lower bound below −15 — roll back
On a tie:     keep the buttons: simpler for people, off with one line
Stop early:   weekly: at least 10 blocks in B
              and the whole interval of the block difference above 0
```

Why a harm threshold of −15 rather than −5? With 154 per group, the interval for the difference is about ±11 points, so a −5 threshold would usually roll back even a neutral change. Ruling out 5 points of harm takes about 1,500 people per group. With small numbers you rule out only big harm, and the "On a tie" line settles the rest.

Recruit in full weeks: people who arrive on a Saturday behave differently (rule of thumb: check it against your own data). "Twice as many blocks" at four versus two is noise, hence the early-stop conditions.

You read the result once, on the date from the card (see "Peeking"). The weekly block check is the exception: peeking is fine here, because a mistake only costs you a missed improvement. Keep the card in the `experiments` table; the experiment log comes in [chapter 6.2](#ch-6-2).

### Splitting: a hash

The group comes from a hash of the experiment name and the user ID. A hash looks random but always gives the same result for the same input, so nobody jumps between groups:

```typescript
import { createHash } from "node:crypto";

function assignVariant(experiment: string, userId: number, shareB = 0.5): "A" | "B" {
  const h = createHash("sha256").update(`${experiment}:${userId}`).digest().readUInt32BE(0);
  return h % 10_000 < Math.round(shareB * 10_000) ? "B" : "A";
}

// recordStart is the examples/tracking version: it returns true for new users
const isNew = recordStart(db, userId, payload);
if (isNew && isRunning(db, "tz_buttons")) assign(db, "tz_buttons", userId);
```

Putting the experiment name in the hash keeps different experiments independent. `assign` writes the group to `experiment_assignments` once, with the assignment time; only group B sees the buttons.

Everyone assigned on `/start` stays in the denominator of "share of arrivals," even if they left before the time zone question. Don't mix denominators. Leave existing users out of an onboarding experiment.

### The unit of randomization

If a change touches invitations, shared events or group chats, people influence each other. Split inviters, chats or organizers instead of people: pass their ID to `assignVariant`.

Count invitees in the inviter's group. You have as many observations as organizers or chats, not people. Viral loops are in [chapter 3.5](#ch-3-5), organizers in [chapter 4.3](#ch-4-3).

### Splitting: by week

Some things can't be shown to half your users. The bot description shown in an empty chat is set with `setMyDescription`: one per language, not per person[^src-tg-description]. The same goes for a social media bio and a public price.

Then you alternate weeks; the delivery company DoorDash calls this a switchback[^src-doordash-switchback]. The unit of comparison becomes the week, not the person.

If B wins 2 pairs of weeks out of 2, that happens by chance one time in four. By the sign test, 5 out of 5 is 1 in 32, about 3%, if you predicted B's win in writing beforehand. In either direction it's 1 in 16. Two pairs are an observation; a test starts at five pairs (`signTestP` in `examples`).

The order A, B, B, A beats plain alternation: steady audience growth doesn't keep favoring B. Switch on Mondays and drop the switch day from the analysis. Watch for carryover: someone who saw the description in an A week may come back in a B week.

Copy variants of a paid placement, tagged `_b` in [chapter 2.1](#ch-2-1), are a worse case. The unit is the placement, and two posts differ in more than the text. Trust a many-fold difference that repeats several times ([chapter 3.4](#ch-3-4)).

### Counting: a share and its interval

The gauge from [chapter 2.3](#ch-2-3) misleads when there are few people or the share is near 0 or 100%[^src-wilson]. At 0 out of 10 it says "0% ± 0," as if you knew everything. The Wilson score interval, from 1927, does better: for 0 out of 10 it gives 0 to 28%. For the difference between two shares, Newcombe's interval builds on it[^src-newcombe].

```typescript
function wilson(x: number, n: number, z = 1.96) {
  const p = x / n, z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return { p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function diffInterval(xA: number, nA: number, xB: number, nB: number) {
  const a = wilson(xA, nA), b = wilson(xB, nB), d = b.p - a.p;
  return { p: d,
    low:  d - Math.sqrt((b.p - b.low) ** 2 + (a.high - a.p) ** 2),
    high: d + Math.sqrt((b.high - b.p) ** 2 + (a.p - a.low) ** 2) };
}
```

`wilson` returns the share and its 95% confidence interval; `diffInterval` does the same for the difference B − A. The counts come from the `experiment_by_variant` query in `examples`: only people with seven days behind them, and only those recruited before the experiment ended.

Before reading the result, check the split. At 50/50, a gap between group sizes larger than 3·√(nA + nB) almost certainly means a bug in your code. The `decide` function checks this first, and if a group is short of people it answers "too early."

### Illustration: time zones as buttons

Suppose that on November 9 the query returned this. The numbers are made up for illustration; intervals are 95%:

| Metric | A | A: share, % | B | B: share, % | B − A, points |
|---|---|---|---|---|---|
| Set time zone | 99 of 203 | 48.8 (42.0–55.6) | 112 of 197 | 56.9 (49.9–63.6) | +8.1 (−1.7 to +17.6) |
| Activation | 43 of 203 | 21.2 (16.1–27.3) | 48 of 197 | 24.4 (18.9–30.8) | +3.2 (−5.0 to +11.4) |
| Blocks | 5 of 203 | 2.5 (1.1–5.6) | 4 of 197 | 2.0 (0.8–5.1) | −0.4 (−3.8 to +2.9) |

The split is fine: 203 and 197 differ by 6, with 60 allowed. B is ahead by eight points, but the interval covers zero, so it's a tie. The lower bound of −1.7 is above the −15 threshold: big harm on the nearest step is ruled out.

On activation it isn't: the interval runs from −5 to +11 points. The buttons stay because of the "On a tie" line, but the decision rests on reversibility. In a month, compare the activated-user triangles from [chapter 2.3](#ch-2-3) by group.

The cost of being wrong is small: in group A, 43 of the 99 who set a time zone reached activation. If the buttons are really five points worse at that step, that's about two activations lost per hundred new users. If they're eight points better, it's about three or four gained (illustration).

**A reversible decision with a small cost of being wrong can be made without proof.** An irreversible one, such as a price or a promise to a partner, can't.

Something new sometimes works only while it's new: the novelty effect. For an important change, keep about 10% of new users on the old version for another month. Then compare triangles (rule of thumb: check it against your own data). Slices found after the fact, like "B does better among people from Threads," are a new hypothesis; the decision goes by the primary metric.

### Another scenario: before and after

Suppose there was no experiment, and the buttons shipped to everyone on August 24. These are the cohorts from [chapter 2.3](#ch-2-3), combined by hand; the numbers are an illustration:

| Cohorts | People | Set time zone, % |
|---|---|---|
| Before: Aug 3 and Aug 10 | 99 | 49.5 |
| Before: Aug 17, paid placement | 118 | 33.9 |
| After: Aug 24 – Sep 7 | 151 | 64.2 |

All "before" against all "after" gives +23.2 points. Without the paid placement, it's +14.7, with an interval from +2.2 to +26.8. The interval sits entirely above zero, but it protects only against chance.

Now the answer to the question from [chapter 2.3](#ch-2-3). Without the paid placement, week 1 rose from 20 of 99 to 42 of 151: +7.6 points, with an interval from −3.5 to +17.8. It covers zero, so the retention rise is still within the noise.

The interval doesn't protect against anything else:

- **Channel mix.** The Aug 17 paid placement dragged "before" down. Compare like channels with like.
- **Season.** In September, after vacations, a calendar is simply more useful (our hypothesis).
- **Regression to the mean.** An unusually bad measurement is usually followed by one closer to the average[^src-regression-mean]. You fix a step after its worst week, and part of the rise would have come anyway.
- **Other changes that week**, if you didn't write them down.

The `before_after` query in `examples` takes four weeks on each side, by channel group, leaving out a day before and after the change. Add a control step the change didn't touch, such as language choice: if it rose too, the audience changed.

### Qualitative signals

The "why" comes from two sources. One is the paths of people who didn't get through (the `stuck_paths` query, [chapter 2.2](#ch-2-2)). The other is conversations with five people from group B: five usability test participants find about 85% of the problems[^src-nielsen-5]. [Chapter 1.2](#ch-1-2) covers how to ask without leading.

### The fake door

The cheapest experiment is about demand for something that doesn't exist yet. Alberto Savoia calls it a fake door[^src-savoia-fake-door]: you show an entrance to a feature that isn't there and count who knocks.

That's how two of our hypotheses from [chapter 2.4](#ch-2-4) can be tested. The free limit is 10 AI requests a day and 50 a week; the subscription is about $5 in Telegram Stars. Suppose the limits are already live.

When someone hits the limit, the bot shows a "More requests with a subscription" button. Count each person's first tap among those who saw it: `markStep` records a step once, and the `fake_door` query is in `examples`. Don't mention the thank-you gift before the tap, or people tap for the gift.

Savoia advises owning up right away, apologizing and giving something in return. After the tap, the bot says honestly: "There's no subscription yet; we're checking whether people want one. Thanks, and here are five more requests for today." One gift per person; no invoice is sent and no money is taken.

The decision rule is written before the start here too, using the bounds of the Wilson interval. For example: if the lower bound is above 5%, build the subscription; if the upper bound is below 10%, not this quarter. Otherwise wait for 80 viewers; if still unclear, not this quarter (thresholds are a rule of thumb: check them against your own data). With 40 people, "not this quarter" happens only at zero taps; with 80, at two or fewer.

Two taps out of 40 is 1 to 17%: demand is neither ruled out nor proven. The full rule is `fakeDoorDecision` in `examples`.

A tap is interest, not payment; pricing is in [chapter 4.2](#ch-4-2), organizers in [chapter 4.3](#ch-4-3).

::: case
Suppose that in the expense-tracking bot, group B gets an evening "Log today's expenses" message on days two and three. The primary metric is the share who get their first summary with at least five expenses in it: that's activation from [chapter 2.2](#ch-2-2).

Blocks in the first week matter more than usual here: an annoying message shows up in `kicked` before it shows up in retention. Activation eight points higher, with a block difference whose interval sits entirely above zero, isn't a win. You've bought activation at the cost of future users.
:::

::: warning
**Don't change several things in one variant.** If B offers time zone buttons and a new greeting at once, you'll only learn whether the bundle is better. Sometimes that's enough, but then call the experiment what it is. And don't run two experiments on the same step at once; different steps are fine, since the hash splits people independently.
:::

## Your step

::: step
Tonight: the card and the split, without the change itself.

1. Take the biggest drop in your funnel from [chapter 2.2](#ch-2-2) and come up with a big change. Fill in a card like the one in this chapter, including the "On a tie, keep…" line.
2. Create the `experiments` and `experiment_assignments` tables from `examples/experiments/schema.sql` and write the card into the first one.
3. Wire `assign` from `examples/experiments/experiments.ts` into your `/start` handler for new users.

**Done when** the card is saved with a date before the start and a test account shows up in `experiment_assignments`. A second `/start` mustn't change its group. Build the change for group B over the next evenings. If recruiting would take more than two months, make the change bigger or measure the nearest step.
:::

**Recap.** The cards will come together in the experiment log in [chapter 6.2](#ch-6-2). The $100 paid channel test in [chapter 3.4](#ch-3-4) is an experiment where the unit is the placement. The first candidates for group-tested changes are in onboarding ([chapter 5.2](#ch-5-2)). The fake door comes back in [chapter 4.2](#ch-4-2), when we look for a subscription price.

[^src-kohavi-third]: Ron Kohavi, Thomas Crook, Roger Longbotham, "Online Experimentation at Microsoft," 2009: "only about one-third were successful at improving the key metric." exp-platform.com/Documents/ExP_DMCaseStudies.pdf (accessed September 28, 2026).
[^src-vanbelle-lehr]: Gerald van Belle, *Statistical Rules of Thumb*, 2nd ed., Wiley, 2008, ch. 2, sections 2.1 and 2.9: 16·π̄(1−π̄)/(π0−π1)² per group at α = 0.05 and power 0.80; the equation is due to Lehr (1992); works well for n between 10 and 100. vanbelle.org/chapters/webchapter2.pdf (accessed September 28, 2026).
[^src-miller-calc]: Evan Miller, "Sample Size Calculator," evanmiller.org/ab-testing/sample-size.html; the formula is in sample-size-fixed.js (accessed September 28, 2026).
[^src-miller-peeking]: Evan Miller, "How Not To Run an A/B Test," April 18, 2010: 26.1% false wins when testing after every observation up to 150; ten peeks turn an apparent 1% into a real 5%. evanmiller.org/how-not-to-run-an-ab-test.html (accessed September 28, 2026).
[^src-prereg]: Center for Open Science, "Preregistration": "specifying your research plan in advance of your study and submitting it to a registry." cos.io/initiatives/prereg (accessed September 28, 2026).
[^src-tg-description]: Telegram Bot API, `setMyDescription` and `setMyShortDescription`: apart from the text, the only parameter is `language_code`. core.telegram.org/bots/api#setmydescription (accessed September 28, 2026).
[^src-doordash-switchback]: David Kastelman, Raghav Ramesh, "Switchback Tests and Randomized Experimentation Under Network Effects at DoorDash," February 13, 2018: variants are switched by time windows; the unit of analysis is the window. careersatdoordash.com/blog/switchback-tests-and-randomized-experimentation-under-network-effects-at-doordash/ (accessed September 28, 2026).
[^src-wilson]: Edwin B. Wilson, "Probable Inference, the Law of Succession, and Statistical Inference," JASA, 22 (158), 1927, pp. 209–212; on the limits of the normal approximation, "Binomial proportion confidence interval," English Wikipedia (accessed September 28, 2026).
[^src-newcombe]: Robert G. Newcombe, "Interval Estimation for the Difference Between Independent Proportions: Comparison of Eleven Methods," Statistics in Medicine, 17 (8), 1998, pp. 873–890. The default method in the Python library statsmodels: `confint_proportions_2indep(method="newcomb")`, github.com/statsmodels/statsmodels (accessed September 28, 2026).
[^src-regression-mean]: "Regression toward the mean," English Wikipedia: after an extreme measurement, the next one is likely to be closer to the mean; described by Francis Galton in 1886 (accessed September 28, 2026).
[^src-nielsen-5]: Jakob Nielsen, "Why You Only Need to Test with 5 Users," Nielsen Norman Group, March 18, 2000: about 85% of usability problems; separate participants for distinct user groups. nngroup.com/articles/why-you-only-need-to-test-with-5-users/ (accessed September 28, 2026).
[^src-savoia-fake-door]: Alberto Savoia, *The Right It: Why So Many Ideas Fail and How to Make Sure Yours Succeed*, HarperOne, 2019, the Fake Door technique. See also his "Pretotyping: quick review of pretotyping techniques" (draft, 2015, albertosavoia.com): apologize and give a free burger to whoever ordered the nonexistent dish (accessed September 28, 2026).
