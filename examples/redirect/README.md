# Код к главе 5.3

TypeScript + Bun + `bun:sqlite`. Короткий адрес `/r/<slug>` с переадресацией в бота: считает переходы по каждому посеву.

- `redirect.ts`:
  - `createHandler` — обработчик как обычная функция `(Request, ip?) => Response`: `GET /r/<slug>` отвечает 302 на `https://t.me/<бот>?start=<метка>` и пишет строку в `clicks`; неизвестный slug ведёт в бота без метки и в базу не пишется — только счётчик в памяти `handler.unknownSlugs` (не больше 1 000 адресов); больше `rateLimit` переходов в минуту с одного адреса (по умолчанию 5) переадресуются, но не пишутся; `HEAD` не считается; ответ с `Cache-Control: no-store`;
  - `addPlacement` / `markPosted` — завести размещение до публикации и отметить выход поста; метка проверяется `checkPayload` из `examples/deeplinks` и ещё раз при каждом переходе;
  - `uaClass` — класс User-Agent: `mobile`, `desktop`, `preview` (роботы превью: `TelegramBot (like TwitterBot)`, `facebookexternalhit`, Twitterbot, Slackbot, WhatsApp и др.), `bot` (слово bot — с учётом регистра, чтобы телефоны CUBOT остались людьми), `unknown`; сам User-Agent не хранится;
  - `clientIp` — IP за своим прокси: `x-real-ip` или последний элемент `X-Forwarded-For` (его дописал ваш прокси; первые элементы присылает клиент);
  - `DailySalt` и `forgetVisitors` — склейка повторных переходов за сутки хешем от соли дня, IP и User-Agent; соль живёт только в памяти и меняется с датой UTC, IP в базу не попадает; хеши прошлых дней стираются;
  - запуск: `BOT=YourBot DB=growth.sqlite bun redirect.ts` (`PORT`; `TRUST_PROXY=x-real-ip` или `x-forwarded-for` — только за своим обратным прокси).
- Журнал веб-сервера: nginx по умолчанию пишет IP в `access.log`, у Caddy и Cloudflare проверьте настройки. Для `/r/` журнал выключите или обезличьте (`access_log off;` в `location /r/`).
- `placements.sql` — таблицы `placements` (slug, канал, цена, валюта, цена в $, время выхода, формат, метка) и `clicks`; запросы `placement_funnel` (переходы людей — все и уникальные за сутки; уникальные — нижняя оценка: люди за одним адресом оператора с одинаковым телефоном склеиваются → новые старты → `first_value` → `first_reminder_delivered` за 7 дней и цена каждого шага в $; доля стартов — только от 30 уникальных переходов; цена активированного — только когда у всех прошло 7 дней), `returning_via_placement`, `untagged_uplift` (люди без метки за 48 часов после поста против фона за 14 дней до него и цена активированного диапазоном — обещание главы 2.4), `clicks_by_hour`.
- `redirect.test.ts` — тесты: `bun test`. Обработчик вызывается без порта.

Нужны таблицы глав 2.1–5.2: сначала `initSchema` из `examples/deeplinks`, потом `initSchema` отсюда. Сумму в $ из `placements.price_usd` записывайте и в `marketing_spend` (глава 2.4). Для Postgres: `instr` → `strpos`, `julianday` → `extract(epoch from …)`.

---

# Code for chapter 5.3

TypeScript + Bun + `bun:sqlite`. A short `/r/<slug>` address that redirects into the bot and counts clicks for every paid placement.

- `redirect.ts`:
  - `createHandler` returns a plain `(Request, ip?) => Response` function. `GET /r/<slug>` answers 302 to `https://t.me/<bot>?start=<tag>` and writes a row to `clicks`. An unknown slug still sends the person to the bot, without a tag; it is not written to the database, only counted in memory in `handler.unknownSlugs` (capped at 1,000 addresses). More than `rateLimit` clicks a minute from one address (5 by default) are redirected but not recorded. `HEAD` is not counted. Responses carry `Cache-Control: no-store`;
  - `addPlacement` / `markPosted` register a placement before it goes live and record when the post appeared. The tag is validated with `checkPayload` from `examples/deeplinks`, and again on every click;
  - `uaClass` sorts user agents into `mobile`, `desktop`, `preview` (link-preview robots: `TelegramBot (like TwitterBot)`, `facebookexternalhit`, Twitterbot, Slackbot, WhatsApp and others), `bot` (the word bot is matched case-sensitively, so CUBOT phones stay human) and `unknown`. The user agent itself is not stored;
  - `clientIp` picks the IP behind your own proxy: `x-real-ip`, or the last `X-Forwarded-For` element (your proxy appended it; earlier elements come from the client);
  - `DailySalt` and `forgetVisitors` merge repeat clicks within a day using a hash of the day's salt, the IP and the user agent. The salt lives only in memory and rotates with the UTC date; the IP never reaches the database; hashes from past days are wiped;
  - run it with `BOT=YourBot DB=growth.sqlite bun redirect.ts` (`PORT`; `TRUST_PROXY=x-real-ip` or `x-forwarded-for` only behind your own reverse proxy).
- Web-server logs: nginx writes IPs to `access.log` by default; check the log settings of Caddy or Cloudflare. Turn the log off or anonymize it for `/r/` (`access_log off;` in `location /r/`).
- `placements.sql` defines `placements` (slug, channel, price, currency, price in USD, time posted, format, tag) and `clicks`. Queries: `placement_funnel` (human clicks, all and unique per day; unique clicks are a lower bound, since people behind one carrier address with the same phone merge → new starts → `first_value` → `first_reminder_delivered` within 7 days, with the USD cost of each step; the click-to-start share only from 30 unique clicks; cost per activated user only once everyone has had 7 days), `returning_via_placement`, `untagged_uplift` (untagged newcomers in the 48 hours after a post against the 14-day baseline before it, and cost per activated user as a range, as promised in chapter 2.4), `clicks_by_hour`.
- `redirect.test.ts`: run `bun test`. The handler is called without binding a port.

It needs the tables from chapters 2.1–5.2: run `initSchema` from `examples/deeplinks` first, then the one here. Record the USD amount from `placements.price_usd` in `marketing_spend` as well (chapter 2.4). For Postgres: `instr` → `strpos`, `julianday` → `extract(epoch from …)`.
