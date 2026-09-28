# Код к главе 5.2

TypeScript + Bun + `bun:sqlite`.

- `deeplinks.ts`:
  - `initSchema` — таблицы главы; если `user_acquisition` создана по главе 2.1, добавляет столбцы `first_content` и `first_partner` (проверка через `PRAGMA table_info`, повторный запуск безопасен);
  - `checkPayload` — проверка параметра до публикации: не пустой, до 64 символов, только `A-Z a-z 0-9 _ -`, не начинается с `_tgr_` (реферальные ссылки Telegram), не служебный источник `src_share` / `none` / `legacy` (правила проверены 28.09.2026);
  - `encodeCampaign` / `decodePayload` — метка `src_<канал>_<место>[_<дата>]-c<вариант>-r<код друга>-p<код партнёра>`; поля после источника — буква-префикс и значение, разделитель — дефис; незнакомое поле даёт `{ kind: "none" }`; ссылки `ev_…` / `inv_…` из главы 2.1 разбираются как раньше;
  - `payloadFor` / `resolvePayload` — длинная метка уходит в таблицу `start_links`, в ссылку — короткий ключ `k_<10 символов>`; ключ случайный, но создаётся один раз на набор полей (это обеспечивает функция, а не таблица);
  - `legacy_labels`, `addLegacyLabel`, `labelMismatches` — старые метки (с дефисом или вариантом `_b`) разбираются раньше новой схемы; `labelMismatches` сравнивает старый и новый разбор для списка опубликованных меток;
  - `startLink`, `groupLink`, `channelLink`, `appLink` — ссылки `?start=`, `?startgroup=` (с `admin=`), `?startchannel&admin=`, `?startapp=`;
  - `recordStart` (личный чат), `recordAppStart` (мини-приложение, только из проверенного `initData`), `recordGroupAdded` / `recordGroupPayload` (группы, учёт по `chat_id`);
  - `firstScreen`, `markFirstValue`, `recordOptOut` («Больше не писать»), `isDaytime` / `localHour`, `nudgeCandidates`, `recordNudge`, `deleteUserOnboarding`.
- `onboarding.sql` — `ttfv_by_source` (доля дошедших до пользы и дошедших за 60 секунд от стартов; медиана — только от 30 дошедших), `stalled_last_step`, `nudge_candidates` (без отказавшихся и заблокировавших), `nudge_outcome`, `partner_payouts` (активации по коду партнёра с потолком выплат и всплеском стартов за день).
- `deeplinks.test.ts` — тесты: `bun test`. Один тест загружает `../tracking/schema.sql` и проверяет миграцию.

Таблицы `user_acquisition`, `invite_codes`, `funnel_events` и `bot_status` — копии из `examples/tracking`. Для Postgres и aiogram — см. врезку в главе 0.1; медиана в Postgres — `percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)`, столбец — `ALTER TABLE user_acquisition ADD COLUMN IF NOT EXISTS first_content TEXT`.

---

# Code for chapter 5.2

TypeScript + Bun + `bun:sqlite`.

- `deeplinks.ts`:
  - `initSchema` creates the chapter's tables. If `user_acquisition` was created in chapter 2.1, it adds the `first_content` and `first_partner` columns (checked through `PRAGMA table_info`, safe to run twice);
  - `checkPayload` validates a parameter before you publish it: non-empty, at most 64 characters, only `A-Z a-z 0-9 _ -`, no `_tgr_` prefix (Telegram referral links), and not one of the synthetic sources `src_share` / `none` / `legacy` (rules checked on 28.09.2026);
  - `encodeCampaign` / `decodePayload` handle the tag `src_<channel>_<placement>[_<date>]-c<variant>-r<friend code>-p<partner code>`. Every field after the source is a letter prefix plus a value, separated by hyphens. An unknown field yields `{ kind: "none" }`. Object links `ev_…` / `inv_…` from chapter 2.1 parse as before;
  - `payloadFor` / `resolvePayload`: a tag that does not fit goes into `start_links`, and the link carries a short key `k_<10 chars>`. The key is random but created once per set of fields; the function guarantees that, not the table;
  - `legacy_labels`, `addLegacyLabel`, `labelMismatches`: old tags (with a hyphen or an `_b` variant) resolve before the new scheme; `labelMismatches` compares the old and new parsers over your published tags;
  - `startLink`, `groupLink`, `channelLink`, `appLink` build `?start=`, `?startgroup=` (with `admin=`), `?startchannel&admin=` and `?startapp=` links;
  - `recordStart` (private chat), `recordAppStart` (Mini App, only from validated `initData`), `recordGroupAdded` / `recordGroupPayload` (groups, keyed by `chat_id`);
  - `firstScreen`, `markFirstValue`, `recordOptOut` ("stop messaging me"), `isDaytime` / `localHour`, `nudgeCandidates`, `recordNudge`, `deleteUserOnboarding`.
- `onboarding.sql`: `ttfv_by_source` (share of starts that reached value, and within 60 seconds; median only from 30 people who reached value), `stalled_last_step`, `nudge_candidates` (skips opt-outs and blocks), `nudge_outcome`, `partner_payouts` (activations per partner code with a payout cap and the largest one-day spike of starts).
- `deeplinks.test.ts`: run `bun test`. One test loads `../tracking/schema.sql` and checks the migration.

The `user_acquisition`, `invite_codes`, `funnel_events` and `bot_status` tables are copies from `examples/tracking`. For Postgres and aiogram see the box in chapter 0.1; in Postgres the median is `percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)` and the column is `ALTER TABLE user_acquisition ADD COLUMN IF NOT EXISTS first_content TEXT`.
