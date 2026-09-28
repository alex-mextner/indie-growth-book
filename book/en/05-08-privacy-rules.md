# 5.8. Platform Rules and Personal Data {#ch-5-8}

::: skip
If your bot has its own policy in @BotFather and a data-deletion command, and you've sorted out Russian data law, jump to "The one-page checklist."
:::

Growth means more people, more data and more messages. Mistakes with them can get your bot restricted or removed by Telegram, and breaking data-protection law can mean a fine.

::: note
We aren't lawyers, and this chapter isn't legal advice. Laws change, and the answer depends on your country, your users' countries and your business structure. Before you launch paid features, show your setup to a lawyer who specializes in personal data.
:::

## The gist

### Telegram's terms

There are three layers of rules: Telegram's Bot Platform Developer Terms of Service, the bot's privacy policy, and the law. The terms are strict[^src-tg-devterms]. Store only what's necessary, encrypted, with the key kept separately. Delete data when the person asks, when it's no longer needed, and when the bot shuts down.

Collecting data to build datasets or train models is prohibited. You may use what a person sends you if you've clearly explained why and they've given explicit, active and revocable consent. Violations lead to restrictions, removal of the bot and a ban for its owner.

### Policy: standard or your own

A bot must have a privacy policy that users can access: what it stores, how it collects it and why. If you don't have your own, Telegram's Standard Bot Privacy Policy applies[^src-tg-privacy-tpa]. But you're still responsible for making sure it matches reality.

It makes promises on your behalf: collecting only what's necessary, sharing nothing with third parties without explicit permission, and answering requests within 30 days. Russian law requires a faster response.

If the bot does more, you need your own policy, set in @BotFather[^src-tg-devterms]. The usual reason is AI: every message goes to the model provider, which is a third party. Mini apps get a privacy policy button in their settings automatically.

### Who the bot can message, and how fast

A bot can't start a conversation. The person has to message it first or add it to a group[^src-tg-bots-cant-start]. The terms explicitly prohibit pestering people with unsolicited messages[^src-tg-devterms].

According to Telegram's FAQ, the limits are about one message per second to a single chat and up to 20 per minute to a group. Broadcasts are limited to about 30 messages per second[^src-tg-faq-broadcast]. Go over the limit and you get error 429.

Paid broadcasts (`allow_paid_broadcast`) allow up to 1,000 messages per second, at 0.1 Stars per message above 30. The terms require 100,000 Stars and 100,000 monthly active users; the API page mentions 10,000 Stars, but the terms take precedence. Bypassing the limits, for example with other people's bot tokens, is prohibited[^src-tg-devterms].

A bot that sells digital goods for Telegram Stars must respond to `/paysupport`. Unresolved payment disputes put it at risk of a SCAM label, visible to everyone who opens the bot. [Chapter 2.4](#ch-2-4) explains why digital goods can be sold only for Stars.

::: case
An event invitation in our calendar bot is a link. Until the invitee taps "Start," the bot can't even remind them about the event. So the invitation's job is to get the person to `/start`, not to "send a notification."
:::

### Groups and mini apps

In groups, bots have privacy mode switched on by default[^src-tg-features-privacy]. The bot sees service messages, commands addressed to it, and general commands if it was the last bot to post in the chat. It also sees messages sent via the bot and replies to its own messages. It doesn't see ordinary mentions.

Don't switch privacy mode off or make the bot an admin unless you need to: an admin sees every message. The group's members never started the bot themselves. That matters if you grow through the `startgroup` links from [chapter 5.2](#ch-5-2).

The same terms cover mini apps. An app receives the person's IP address and may receive their id, name, username, photo, language and Premium status[^src-tg-miniapps-terms]. Verify the signature of the `initData` launch data on the server. Telegram explicitly calls the `initDataUnsafe` field untrusted[^src-tg-webapps-validate].

## The bridge

### What the bot actually receives

With every message, the bot receives a User object: a numeric `id` and a `first_name`. The last name, `username` and interface language (`language_code`) arrive if they're set[^src-tg-api-user], along with the message text itself. The bot can request the profile photo with the `getUserProfilePhotos` method.

The bot sees a phone number only through the `request_contact` button, and a location only through `request_location`. An invoice with `need_phone_number` asks for a phone number, but the parameter is ignored for payments in Stars[^src-tg-api-payments]. The bot learns an IP address if the person follows a link to the owner's website[^src-tg-privacy-bots].

Russia's personal data law, Federal Law No. 152-FZ, defines personal data as any information about a directly or indirectly identifiable person[^src-152fz-core]. A bare `telegram_id` most likely falls under that definition; that's our own assessment. Hashing the id gives you a pseudonym, not anonymity. Without a secret key, the id can be recovered by brute force; with one, whoever holds the key can restore the link.

If you need a pseudonym, use an HMAC with a key stored separately from the database. That reduces the harm from a leak, but it doesn't remove your obligations.

### Inventory: what to keep

Don't store what you don't use. Telegram requires this, and so does the GDPR, where it's called data minimization[^src-gdpr]. For each field, answer two questions: what breaks without it, and when do you delete it?

::: case
Our calendar bot creates events, issues invitation links and sends texts to a model for parsing. Below is a hypothetical inventory for a bot like that. The retention periods are a rule of thumb: check them against your own data.

| Data | Purpose | Retention |
|---|---|---|
| `telegram_id`, name | reminders, participant list | 12 months without activity |
| `language_code`, time zone | reminder language and timing | same |
| event: title, time, participants | the core of the product | event date + 30 days |
| message text | parse the date and time | don't keep after parsing |
| `username`, last name, photo | not needed | don't request |
| invitation codes, `start_links.note` | invitations and tags (chapters 2.1, 5.2) | while the link works; no names in `note` |
| `messaging_optout` | don't message people who opted out | while any other data on the person exists |
| source, funnel steps, activity, `bot_status` | chapters 2.1–2.3 | 12 months, then counters |
| `experiment_assignments` | experiments (chapter 2.5) | 12 months without activity |
| `ai_usage`, `payments` | costs, refunds, taxes (chapter 2.4) | on deletion, id → 0 |
| group: `chat_id`, who added the bot | group accounting (chapter 5.2) | while the bot is in the group |

An event is as sensitive as a text: "Doctor's appointment on Thursday" says more than a name. We don't write texts to logs. Frameworks often log whole updates, so check your log level.
:::

### Texts and the model: legal basis and consent

Here's our setup; check it with a lawyer. We process whatever the product can't work without to perform our contract with the person, that is, the bot's terms of use[^src-152fz-core]. We ask for separate consent only for what goes beyond that. For us, that's sending the text to a model hosted abroad.

We ask at the moment of the first such action, with one button and an alternative path, like the time zone in [chapter 5.2](#ch-5-2). This satisfies Telegram's explicit-consent rule. It also meets the 152-FZ requirement to obtain consent separately from other documents[^src-156fz].

```text
To understand "call tomorrow at 9", I'll send your text to the <provider> model (servers in <country>).
We don't keep the text after parsing. To withdraw consent, use /settings.
[I agree]  [Enter the date with buttons]
```

Check the provider's documentation: does the model train on your requests, and how long are logs kept? Where you can, replace third parties' names with placeholders before sending. Add the provider and its country to your inventory.

### Storage: encryption and backups

Telegram's terms require encrypting data at rest and keeping the key separate[^src-tg-devterms]. For a small bot, one of two options is enough: an encrypted disk or volume (LUKS on Linux), or an encrypted database (SQLCipher for SQLite). Encrypt backups too: restic always encrypts its repository, and age works for individual files. The key goes in an environment variable or a secrets manager, never in the repository or next to the backups.

### Deletion: one command

Tapping `/deletedata` is a request to stop processing. Under 152-FZ you have 10 working days to comply, plus 5 more if you've sent the person a reasoned notice[^src-152fz-core]. The same deadline applies to a "what do you store about me?" request; the 30-day period applies only to destroying data after consent is withdrawn. Deleting the data as soon as the button is pressed is simpler than tracking deadlines.

```typescript
const confirm = { inline_keyboard: [[
  { text: "Delete", callback_data: "deletedata:yes" },
  { text: "Cancel", callback_data: "deletedata:no" },
]] };

bot.chatType("private").command("deletedata", (ctx) =>
  ctx.reply(
    "Delete all your data? Events you created will disappear for their participants. " +
      "Your subscription will be cancelled, and Stars can't be refunded after deletion.",
    { reply_markup: confirm },
  ),
);

bot.callbackQuery("deletedata:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Nothing was deleted.");
});

bot.callbackQuery("deletedata:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.from.id;
  // 1. Cancel the subscription renewal while the id is still known (chapter 2.4)
  const subs = db.query(
    `SELECT charge_id FROM payments
     WHERE telegram_id = ? AND provider = 'stars' AND kind = 'subscription'
       AND refunded_at IS NULL AND paid_at >= datetime('now', '-30 days')`,
  ).all(id) as { charge_id: string }[];
  for (const s of subs) {
    try {
      await ctx.api.editUserStarSubscription(id, s.charge_id, true);
    } catch (e) {
      // an already cancelled subscription isn't an error; check the exact response text on your own bot
      if (e instanceof GrammyError && /cancel/i.test(e.description)) continue;
      console.error("deletedata: subscription not cancelled", id, s.charge_id, e); // handle manually
      await ctx.editMessageText(
        "Couldn't cancel your subscription. Cancel it in Telegram settings and tap again.",
        { reply_markup: confirm },
      );
      return; // delete nothing
    }
  }
  // 2. Deletion: one transaction, one function per chapter that created tables
  db.transaction(() => {
    deleteUserProduct(db, id);    // events, invitations, time zone: your code
    deleteUserOnboarding(db, id); // chapter 5.2, including messaging_optout
    deleteUserTracking(db, id);   // chapters 2.1–2.3
    db.run("DELETE FROM experiment_assignments WHERE telegram_id = ?", [id]); // chapter 2.5
    deleteUserEconomics(db, id);  // chapter 2.4: ai_usage and payments → id 0
  })();
  await ctx.editMessageText("Done. Your data has been deleted.");
});
```

First the bot cancels the subscription renewal. `editUserStarSubscription`, like the `refundStarPayment` refund method, requires the person's id[^src-tg-api-payments]. An already canceled subscription doesn't count as an error. On any other error, the bot asks the person to cancel in Telegram settings, logs the case and deletes nothing.

We haven't verified whether the method accepts the id of a renewal payment rather than the first payment. Once the subscription is canceled, the tables are cleared in one transaction, with one function per chapter where you created tables.

`deleteUserOnboarding` runs before `deleteUserTracking` because it needs the invitation codes. Payments and the AI usage log are kept with id 0, which is why the bot warns about refunds. Telegram's standard policy allows keeping transaction history for tax purposes[^src-tg-privacy-tpa].

### Analytics without personal data

The funnel and cohorts from [chapters 2.1](#ch-2-1)–[2.3](#ch-2-3) need rows with `telegram_id`, but not forever. Once a day, roll them up into counters that identify no one.

```sql
CREATE TABLE IF NOT EXISTS funnel_counts (
  cohort_day TEXT    NOT NULL,   -- arrival day: date(first_seen_at)
  source     TEXT    NOT NULL,
  step       TEXT    NOT NULL,
  day_n      INTEGER NOT NULL,   -- which day after arrival the step was completed
  users      INTEGER NOT NULL,
  PRIMARY KEY (cohort_day, source, step, day_n)
);
CREATE TABLE IF NOT EXISTS rollup_state (id INTEGER PRIMARY KEY CHECK (id = 1), done_until TEXT NOT NULL);
INSERT OR IGNORE INTO rollup_state VALUES (1, '2000-01-01');

-- in one transaction: every day since the last rollup, except today
INSERT INTO funnel_counts (cohort_day, source, step, day_n, users)
SELECT date(a.first_seen_at), a.first_source, f.step,
       CAST(julianday(date(f.at)) - julianday(date(a.first_seen_at)) AS INTEGER), COUNT(*)
FROM funnel_events f JOIN user_acquisition a USING (telegram_id)
WHERE date(f.at) > (SELECT done_until FROM rollup_state)
  AND date(f.at) < date('now')
GROUP BY 1, 2, 3, 4
ON CONFLICT (cohort_day, source, step, day_n) DO UPDATE SET users = users + excluded.users;
UPDATE rollup_state SET done_until = date('now', '-1 day');
```

A counter stores the arrival day, source, step and the day the step was completed. That's enough for the funnel in [chapter 2.2](#ch-2-2). The query catches up on every day since the last rollup: a missed run breaks nothing, and a repeated run doesn't double-count. Retention from [chapter 2.3](#ch-2-3) rolls up the same way, but by arrival week and only for finished weeks, so each person counts once per week.

```sql
-- after the rollup: people who arrived over 12 months ago and have been inactive for 12 months (rule of thumb)
CREATE TEMP TABLE gone AS
SELECT telegram_id FROM user_acquisition
WHERE first_seen_at < datetime('now', '-12 months')
  AND telegram_id NOT IN (SELECT telegram_id FROM user_activity WHERE day >= date('now', '-12 months'));
DELETE FROM funnel_events          WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM bot_status             WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM invite_codes           WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM messaging_optout       WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM experiment_assignments WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM reminder_deliveries    WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM user_acquisition       WHERE telegram_id IN (SELECT telegram_id FROM gone);
UPDATE user_acquisition  SET invited_by  = NULL WHERE invited_by  IN (SELECT telegram_id FROM gone);
UPDATE group_acquisition SET added_by    = NULL WHERE added_by    IN (SELECT telegram_id FROM gone);
UPDATE partner_codes     SET telegram_id = NULL WHERE telegram_id IN (SELECT telegram_id FROM gone);
DELETE FROM user_activity    WHERE day < date('now', '-12 months');
DROP TABLE gone;
```

The price of this cleanup: a person who comes back after a year is recorded as new, with the source of their return. If that's a problem, keep a minimum instead of the full row: the id and the arrival day.

A breakdown with only one or two people in it is identifiable ("the only one from channel A"), so don't show it to outsiders. For the report in [chapter 2.1](#ch-2-1), copy only the creation time from `events`.

### Your own policy: a skeleton

::: tip
Your own policy fits on one page, in seven points:

1. Who the operator is and how to contact them.
2. What data the bot collects, per your inventory.
3. Why each item is collected and on what basis: contract or consent.
4. How long it's kept.
5. Who it's shared with: the model provider (and its country), hosting, the payment provider.
6. How to delete data or get a copy: `/deletedata`, response time.
7. The date of this version.

Publish it on a website or in Telegraph, and link it in the bot's settings in @BotFather and in `/help`.
:::

### 152-FZ: if your bot serves users in Russia

::: note
Does this apply to you? The law also covers foreigners who process Russian citizens' data under a contract with them or with their consent[^src-152fz-core]. The bot sees only indirect signs: `language_code` `ru`, the Moscow time zone, ruble prices. How this applies to an operator based abroad is a question for a lawyer.

There are three honest options, each with its own risk. Keeping the main database on Russian hosting covers localization, but not the notifications or sending texts to a foreign model. Not targeting Russia means no Russian interface, no ruble prices and no advertising there; Russian citizens may still show up. Collecting the bare minimum means less harm from a leak, but the obligations remain.
:::

An operator can be a company or an ordinary individual who decides what to collect and why. Here's what applies to a bot[^src-152fz-core]:

- Legal basis: performing a contract with the person, or their consent. Since September 1, 2025, consent must be obtained separately from other documents[^src-156fz].
- Publish your processing policy where you collect the data. For a bot, that's a link in @BotFather and in `/help`.
- Notify Roskomnadzor (Russia's data-protection regulator) before processing begins. The few remaining exemptions, such as non-automated processing, don't apply to a bot.
- When collecting Russian citizens' data, you may not record or store it in databases abroad[^src-152fz-local].

Cross-border transfer, including to a model provider, has its own procedure[^src-152fz-core]. Obtain information from the recipient about how it protects data, and file a separate notification with Roskomnadzor. If the country isn't on the list of countries with adequate protection, wait 10 working days after notifying.

If data leaks, notify Roskomnadzor twice: within 24 hours about the incident, and within 72 hours about the investigation's results[^src-152fz-core]. Warn the people affected too, because Telegram's terms require it[^src-tg-devterms].

Fines for leaks and missed notifications under Art. 13.11 of the Code of Administrative Offences (KoAP) went up on May 30, 2025[^src-koap-1311]. Under these provisions, sole proprietors are liable as legal entities.

| Violation | Individual, rubles | Legal entity or sole proprietor, rubles |
|---|---|---|
| processing notification not filed | 5,000–10,000 | 100,000–300,000 |
| leak not reported | 50,000–100,000 | 1–3 million |
| leak of data on 1,000–10,000 people | 100,000–200,000 | 3–5 million |
| repeat leak | 400,000–600,000 | 1–3% of revenue, from 20 to 500 million |
| databases with Russian citizens' data abroad | 30,000–50,000 | 1–6 million |
| same, repeat offense | 50,000–100,000 | 6–18 million |

### GDPR: if your bot serves people in the EU

The GDPR applies outside the European Union too, if you offer services to people in the EU, even for free[^src-gdpr]. It requires minimal data, set retention periods, a response to requests within one month, and deletion on request. You usually need a representative in the EU, unless your processing is occasional and low-risk.

Fines reach €20 million or 4% of worldwide annual turnover, whichever is higher. With a mixed audience, the laws may contradict each other, and that's a question for a lawyer.

Other countries have their own rules, so check whether they apply to you. The UK has the UK GDPR, which covers organizations outside the UK that offer goods or services to people in the UK[^src-ico-scope]. In the US, California's CCPA, as amended by the CPRA, applies to for-profit businesses that meet certain thresholds[^src-ccpa].

### ePrivacy: cookies and local storage

This rule is about websites, not bots. The ePrivacy Directive (Art. 5(3)) allows writing cookies, local storage data and the like to a device only with consent or where strictly necessary. The European Data Protection Board's Guidelines 2/2023 explain what falls within its scope[^src-edpb-53].

If the source tag from [chapter 2.1](#ch-2-1) lives only in the bot link, nothing is written to the device and no banner is needed. If your redirect or landing page saves it in a cookie, you do. You can't reliably tell a visitor's country, so ask everyone for consent.

### The one-page checklist

Telegram:

- Your own policy in @BotFather, if the bot does more than the standard policy covers.
- Message only people who started the conversation, and only when it's relevant; reminders carry a "Stop messaging me" button.
- Broadcasts at no more than 30 messages per second, pausing on error 429; `/paysupport` is in place.
- Privacy mode on in groups; `initData` is verified.

Data:

- Every field has a purpose and a retention period; texts stay out of logs.
- Disk or database and backups are encrypted, with the key kept separately.
- Consent to send texts to the model: one button, on first use.
- `/deletedata` cancels the subscription and clears everything; old analytics lives in counters.

Law:

- Russia: legal basis, policy, two notifications to Roskomnadzor, databases in Russia.
- Leak: Roskomnadzor within 24 and 72 hours, a message to the people affected.
- EU: legal basis, response within one month, a representative, cookie consent.

## Your step

::: step
Tonight: the inventory and the delete button.

1. List every table and field that holds a person's id or their text. For each field, note why it's there and when it gets deleted. Stop collecting whatever you don't need.
2. Add `/deletedata` with confirmation, subscription cancellation and the deletion functions from `examples`. Add the command to the bot menu and to `/help`.
3. Decide whether you need your own policy, and write down why.

**Done when** a test account has gone through onboarding and run `/deletedata`, and the check below shows zeros everywhere:

```sh
ID=123456789
sqlite3 bot.db "SELECT m.name || '.' || p.name FROM sqlite_master m, pragma_table_info(m.name) p
  WHERE m.type = 'table' AND p.name IN ('telegram_id', 'user_id', 'invited_by', 'added_by')" |
while IFS=. read -r t c; do echo "$t.$c: $(sqlite3 bot.db "SELECT COUNT(*) FROM $t WHERE $c = $ID")"; done
```

Payments stay, keyed by `charge_id` with id 0, and `invited_by` is empty for the people this account invited.
:::

::: tip
Bring your inventory to a lawyer. Ask whether 152-FZ applies to you and whether you need localization. Ask how to handle sending texts to the model, and whether "contract plus consent for anything beyond it" holds up.
:::

**Recap.** The rule "message only people who started the conversation, and only when it's relevant" will shape reminders in [chapter 5.6](#ch-5-6). Broadcast limits return in [chapter 5.7](#ch-5-7), and withdrawing Stars and paying taxes come up in [chapter 5.5](#ch-5-5).

[^src-tg-devterms]: Telegram, "Bot Platform Developer Terms of Service," sections 4–4.4, 5.2, 6.2.1, 6.2.5, 10. telegram.org/tos/bot-developers (accessed September 28, 2026).
[^src-tg-privacy-tpa]: Telegram, "Standard Bot Privacy Policy," clauses 2.1, 5.1, 6.2, 7.3. telegram.org/privacy-tpa (accessed September 28, 2026).
[^src-tg-bots-cant-start]: Telegram, "Bots: An introduction for developers," section "How Are Bots Different from Users?" core.telegram.org/bots (accessed September 28, 2026).
[^src-tg-faq-broadcast]: Telegram, "Bots FAQ," core.telegram.org/bots/faq; "Paid Broadcasts," core.telegram.org/bots/api (accessed September 28, 2026).
[^src-tg-features-privacy]: Telegram, "Telegram Bot Features," section "Privacy Mode." core.telegram.org/bots/features (accessed September 28, 2026).
[^src-tg-miniapps-terms]: Telegram, "Terms of Service for Mini Apps," section 4.1. telegram.org/tos/mini-apps (accessed September 28, 2026).
[^src-tg-webapps-validate]: Telegram, "Telegram Mini Apps," the `initData` and `initDataUnsafe` fields, section "Validating data received via the Mini App." core.telegram.org/bots/webapps (accessed September 28, 2026).
[^src-tg-api-user]: Telegram Bot API: the User object; the `request_contact` and `request_location` fields of the KeyboardButton object; the `getUserProfilePhotos` method. core.telegram.org/bots/api (accessed September 28, 2026).
[^src-tg-api-payments]: Telegram Bot API: `need_phone_number`, `refundStarPayment`, `editUserStarSubscription` (Bot API 8.0). core.telegram.org/bots/api, core.telegram.org/bots/api-changelog (accessed September 28, 2026).
[^src-tg-privacy-bots]: Telegram, "Privacy Policy," section 6.3 "What Data Bots Receive." telegram.org/privacy (accessed September 28, 2026).
[^src-152fz-core]: Russian Federal Law No. 152-FZ "On Personal Data" of July 27, 2006, as amended July 26, 2026: Art. 1 Part 1.1; Art. 3; Art. 6 Part 1; Art. 12 (as amended by Federal Law No. 265-FZ of July 26, 2026); Art. 14 Part 3; Art. 18.1 Part 2; Art. 21 Parts 3.1, 5, 5.1; Art. 22 (Part 2 clauses 1–6 repealed as of September 1, 2022). consultant.ru/document/cons_doc_LAW_61801/ (accessed September 28, 2026).
[^src-156fz]: Art. 9 Part 1 of Federal Law No. 152-FZ, as amended by Federal Law No. 156-FZ of June 24, 2025, in force since September 1, 2025. consultant.ru/legalnews/28832/ (accessed September 28, 2026).
[^src-152fz-local]: Art. 18 Part 5 of Federal Law No. 152-FZ, as amended by Federal Law No. 23-FZ of February 28, 2025 (in force since July 1, 2025). consultant.ru/document/cons_doc_LAW_499984/ (accessed September 28, 2026).
[^src-koap-1311]: Russian Code of Administrative Offences (KoAP), Art. 13.11, as amended July 26, 2026: Parts 8–9 (Federal Law No. 405-FZ of December 2, 2019); Parts 10–12, 15 and Note 1 (Federal Law No. 420-FZ of November 30, 2024; published November 30, 2024, in force 180 days later, from May 30, 2025). consultant.ru/document/cons_doc_LAW_34661/, publication.pravo.gov.ru/document/0001202411300011 (accessed September 28, 2026).
[^src-gdpr]: Regulation (EU) 2016/679 (GDPR): Art. 3(2), 5(1)(c) and (e), 12(3), 17, 27, 83(5). gdpr-info.eu (accessed September 28, 2026).
[^src-ico-scope]: Information Commissioner's Office (ICO), "Who does the UK GDPR apply to?": the UK GDPR "also applies to organisations outside the UK that offer goods or services to individuals in the UK." ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/who-does-the-uk-gdpr-apply-to/ (accessed September 28, 2026).
[^src-ccpa]: State of California, Department of Justice, Office of the Attorney General, "California Consumer Privacy Act (CCPA)": applicability thresholds for for-profit businesses; the CPRA (Proposition 24, November 2020) amends the CCPA. oag.ca.gov/privacy/ccpa (accessed September 28, 2026).
[^src-edpb-53]: EDPB, "Guidelines 2/2023 on Technical Scope of Art. 5(3) of ePrivacy Directive," version 2.0 of October 7, 2024, para. 1; local storage is among the example technologies. edpb.europa.eu (accessed September 28, 2026).
