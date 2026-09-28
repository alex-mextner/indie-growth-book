import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import * as d from "../deeplinks/deeplinks";
import * as r from "./redirect";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const LAPTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  d.initSchema(db); // таблицы глав 2.1–5.2
  r.initSchema(db);
});

function get(handler: ReturnType<typeof r.createHandler>, path: string, ua?: string, ip = "203.0.113.7", method = "GET") {
  const headers: Record<string, string> = ua === undefined ? {} : { "user-agent": ua };
  return handler(new Request(`https://example.com${path}`, { method, headers }), ip);
}

const clickRows = () => db.query("SELECT slug, ua_class, visitor FROM clicks ORDER BY id").all() as
  { slug: string; ua_class: string; visitor: string | null }[];

function addChanA() {
  r.addPlacement(db, {
    slug: "a0927", channel: "канал A", price: 3500, currency: "RUB", priceUsd: 40,
    format: "1/24", payload: "src_tg_chanA_0927",
  });
}

test("переадресация: 302 на бота с меткой размещения, без кэша", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  const res = get(h, "/r/a0927", PHONE);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://t.me/YourCalendarBot?start=src_tg_chanA_0927");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(clickRows()).toHaveLength(1);
  expect(clickRows()[0].ua_class).toBe("mobile");
});

test("неизвестный slug: человек попадает в бота, в базу ничего не пишется, счётчик — в памяти", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  const res = get(h, "/r/a0972", PHONE); // опечатка
  expect(res.headers.get("location")).toBe("https://t.me/YourCalendarBot");
  get(h, "/r/a0972", PHONE, "198.51.100.1");
  expect(clickRows()).toHaveLength(0);
  expect(h.unknownSlugs.get("a0972")).toBe(2);
});

test("перебор неизвестных адресов не раздувает память", () => {
  const h = r.createHandler(db, { bot: "YourCalendarBot", rateLimit: 1e9 });
  for (let i = 0; i < 1100; i++) get(h, `/r/x${i}`, PHONE);
  expect(h.unknownSlugs.size).toBe(1000);
});

test("ограничение частоты: больше 5 переходов в минуту с одного адреса переадресуются, но не пишутся", () => {
  addChanA();
  let t = Date.parse("2026-09-28T10:00:00Z");
  const h = r.createHandler(db, { bot: "YourCalendarBot", now: () => t });
  for (let i = 0; i < 8; i++) expect(get(h, "/r/a0927", PHONE, "203.0.113.7").status).toBe(302);
  get(h, "/r/a0927", PHONE, "198.51.100.2"); // другой адрес — считается
  expect(clickRows()).toHaveLength(6);
  t += 61_000; // следующая минута
  get(h, "/r/a0927", PHONE, "203.0.113.7");
  expect(clickRows()).toHaveLength(7);
});

test("посторонние адреса и методы: 404 и 405, ничего не пишем", () => {
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  expect(get(h, "/", PHONE).status).toBe(404);
  expect(get(h, "/r/../etc", PHONE).status).toBe(404);
  expect(get(h, "/r/" + "x".repeat(33), PHONE).status).toBe(404);
  expect(get(h, "/r/a0927", PHONE, "1.1.1.1", "POST").status).toBe(405);
  expect(clickRows()).toHaveLength(0);
});

test("параметры в адресе (например, erid от ОРД) переадресации не мешают", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  const res = get(h, "/r/a0927?erid=2VtzqwXyZ", PHONE);
  expect(res.headers.get("location")).toBe("https://t.me/YourCalendarBot?start=src_tg_chanA_0927");
  expect(clickRows()[0].slug).toBe("a0927");
});

test("HEAD переадресует, но не считается", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  expect(get(h, "/r/a0927", PHONE, "1.1.1.1", "HEAD").status).toBe(302);
  expect(clickRows()).toHaveLength(0);
});

test("метка проверяется правилами главы 5.2 — при заведении и при переходе", () => {
  expect(() => r.addPlacement(db, { slug: "x", channel: "B", price: 1, currency: "USD", payload: "src_tg.chanB" })).toThrow();
  expect(() => r.addPlacement(db, { slug: "x", channel: "B", price: 1, currency: "USD", payload: "src_share" })).toThrow();
  expect(() => r.addPlacement(db, { slug: "x", channel: "B", price: 1, currency: "USD", payload: "_tgr_abc" })).toThrow();
  expect(() => r.addPlacement(db, { slug: "x", channel: "B", price: 1, currency: "USD", payload: "a".repeat(65) })).toThrow();
  expect(() => r.addPlacement(db, { slug: "a b", channel: "B", price: 1, currency: "USD", payload: "src_tg_chanB" })).toThrow();
  // Кто-то поправил таблицу руками: в ссылку испорченная метка не попадёт.
  db.run("INSERT INTO placements (slug, channel, price, currency, payload) VALUES ('bad', 'C', 1, 'USD', 'src tg')");
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  expect(get(h, "/r/bad", PHONE).headers.get("location")).toBe("https://t.me/YourCalendarBot");
});

test("username бота проверяется", () => {
  expect(() => r.createHandler(db, { bot: "@bot" })).toThrow();
  expect(() => r.createHandler(db, { bot: "abc" })).toThrow();
});

test("классы User-Agent: роботы превью, прочие боты, люди", () => {
  expect(r.uaClass("TelegramBot (like TwitterBot)")).toBe("preview");
  expect(r.uaClass("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe("preview");
  expect(r.uaClass("Twitterbot/1.0")).toBe("preview");
  expect(r.uaClass("WhatsApp/2.23.20.0")).toBe("preview");
  expect(r.uaClass("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe("preview");
  expect(r.uaClass("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("bot");
  expect(r.uaClass("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)")).toBe("bot");
  expect(r.uaClass("curl/8.5.0")).toBe("bot");
  expect(r.uaClass("python-requests/2.32")).toBe("bot");
  expect(r.uaClass(PHONE)).toBe("mobile");
  expect(r.uaClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36")).toBe("mobile");
  expect(r.uaClass(LAPTOP)).toBe("desktop");
  // Телефоны CUBOT — люди: «BOT» в названии модели не делает их роботами.
  expect(r.uaClass("Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe("mobile");
  expect(r.uaClass("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe("bot");
  expect(r.uaClass("Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) Mobile Safari/537.36 (compatible; Googlebot/2.1)")).toBe("bot");
  expect(r.uaClass("")).toBe("unknown");
  expect(r.uaClass(undefined)).toBe("unknown");
});

test("склейка за сутки: тот же человек дважды — один уникальный переход; IP в базе нет", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  get(h, "/r/a0927", PHONE, "203.0.113.7");
  get(h, "/r/a0927", PHONE, "203.0.113.7");
  get(h, "/r/a0927", PHONE, "198.51.100.2");
  get(h, "/r/a0927", "TelegramBot (like TwitterBot)", "149.154.160.1");
  const rows = clickRows();
  expect(rows).toHaveLength(4);
  expect(rows[0].visitor).toBe(rows[1].visitor);
  expect(rows[0].visitor).not.toBe(rows[2].visitor);
  expect(rows[3].visitor).toBeNull(); // роботов не склеиваем
  const dump = JSON.stringify(db.query("SELECT * FROM clicks").all());
  expect(dump).not.toContain("203.0.113.7");
  expect(dump).not.toContain("iPhone");
  const f = db.query(r.QUERIES.placement_funnel).get() as Record<string, number>;
  expect(f.human_clicks).toBe(3);
  expect(f.unique_clicks).toBe(2);
  expect(f.bot_clicks).toBe(1);
});

test("соль меняется с датой: вчерашний хеш не совпадает с сегодняшним", () => {
  let now = new Date("2026-09-27T23:59:00Z");
  const salt = new r.DailySalt(() => now);
  const a = salt.hash("203.0.113.7", PHONE);
  expect(salt.hash("203.0.113.7", PHONE)).toBe(a);
  now = new Date("2026-09-28T00:01:00Z");
  expect(salt.hash("203.0.113.7", PHONE)).not.toBe(a);
});

test("без склейки и без IP visitor пустой; forgetVisitors стирает прошлые дни", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot", dedupe: false });
  get(h, "/r/a0927", PHONE);
  expect(clickRows()[0].visitor).toBeNull();
  db.run("INSERT INTO clicks (slug, at, ua_class, visitor) VALUES ('a0927', datetime('now', '-2 days'), 'mobile', 'abc')");
  db.run("INSERT INTO clicks (slug, at, ua_class, visitor) VALUES ('a0927', datetime('now'), 'mobile', 'def')");
  r.forgetVisitors(db);
  const v = db.query("SELECT visitor FROM clicks ORDER BY id").all().map((x: any) => x.visitor);
  expect(v).toEqual([null, null, "def"]);
});

test("IP за прокси: последний элемент X-Forwarded-For или X-Real-IP, первые элементы — подделка", () => {
  const req = new Request("https://example.com/r/a0927", {
    headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.9", "x-real-ip": "198.51.100.9" },
  });
  expect(r.clientIp(req, "10.0.0.1", false)).toBe("10.0.0.1");
  expect(r.clientIp(req, "10.0.0.1", "x-forwarded-for")).toBe("198.51.100.9");
  expect(r.clientIp(req, "10.0.0.1", "x-real-ip")).toBe("198.51.100.9");
  expect(r.clientIp(new Request("https://example.com/"), "10.0.0.1", "x-forwarded-for")).toBe("10.0.0.1");
});

test("подделанный первый элемент X-Forwarded-For не обходит склейку", () => {
  addChanA();
  const h = r.createHandler(db, { bot: "YourCalendarBot", trustProxy: "x-forwarded-for" });
  for (const fake of ["1.1.1.1", "2.2.2.2"]) {
    h(new Request("https://example.com/r/a0927", {
      headers: { "user-agent": PHONE, "x-forwarded-for": `${fake}, 198.51.100.9` },
    }), "10.0.0.1");
  }
  const [a, b] = clickRows();
  expect(a.visitor).toBe(b.visitor);
});

test("воронка размещения: переходы → старты → польза → активация и цена шагов", () => {
  // Два размещения. Цифры — иллюстрация.
  addChanA();
  r.addPlacement(db, {
    slug: "b1003", channel: "канал B", price: 25, currency: "USD", priceUsd: 25,
    format: "2/48", payload: "src_tg_chanB_1003-c2",
  });
  db.run("UPDATE placements SET posted_at = datetime('now', '-10 days')");

  const h = r.createHandler(db, { bot: "YourCalendarBot" });
  for (let i = 0; i < 40; i++) get(h, "/r/a0927", PHONE, `203.0.113.${i}`);
  for (let i = 0; i < 10; i++) get(h, "/r/b1003", LAPTOP, `198.51.100.${i}`);
  db.run("UPDATE clicks SET at = datetime('now', '-10 days', '+1 hour')");

  // 8 новых стартов из A, 4 из B с вариантом -c2, 1 из B без варианта (не считается: другой вариант).
  for (let id = 1; id <= 8; id++) d.recordStart(db, id, "src_tg_chanA_0927");
  for (let id = 11; id <= 14; id++) d.recordStart(db, id, "src_tg_chanB_1003-c2");
  d.recordStart(db, 15, "src_tg_chanB_1003");
  db.run("UPDATE user_acquisition SET first_seen_at = datetime('now', '-10 days', '+2 hours')");
  db.run("UPDATE funnel_events SET at = datetime('now', '-10 days', '+2 hours')");
  for (const id of [1, 2, 3, 11, 12]) {
    db.run("INSERT INTO funnel_events VALUES (?, 'first_value', datetime('now', '-10 days', '+3 hours'))", [id]);
  }
  for (const id of [1, 11]) {
    db.run("INSERT INTO funnel_events VALUES (?, 'first_reminder_delivered', datetime('now', '-8 days'))", [id]);
  }
  // Польза позже 7 дней не считается.
  db.run("INSERT INTO funnel_events VALUES (4, 'first_value', datetime('now', '-1 day'))");

  const rows = db.query(r.QUERIES.placement_funnel).all() as Record<string, any>[];
  const a = rows.find((x) => x.slug === "a0927")!;
  const b = rows.find((x) => x.slug === "b1003")!;
  expect(a).toMatchObject({
    unique_clicks: 40, new_starts: 8, first_value: 3, activated: 1, maturing: 0,
    start_pct: 20, usd_per_click: 1, usd_per_start: 5, usd_per_first_value: 13.33, usd_per_activated: 40,
  });
  expect(b).toMatchObject({
    unique_clicks: 10, new_starts: 4, first_value: 2, activated: 1,
    start_pct: null, usd_per_click: 2.5, usd_per_start: 6.25, usd_per_activated: 25,
  });
});

test("пока не прошло 7 дней, цена активированного не считается", () => {
  addChanA();
  d.recordStart(db, 1, "src_tg_chanA_0927");
  db.run("INSERT INTO funnel_events VALUES (1, 'first_reminder_delivered', datetime('now'))");
  const a = db.query(r.QUERIES.placement_funnel).get() as Record<string, any>;
  expect(a.activated).toBe(1);
  expect(a.maturing).toBe(1);
  expect(a.usd_per_activated).toBeNull();
});

test("старые пользователи по ссылке размещения — отдельной строкой", () => {
  addChanA();
  db.run("UPDATE placements SET posted_at = datetime('now', '-1 hour')");
  d.recordStart(db, 1, "src_threads_bio");
  d.recordStart(db, 1, "src_tg_chanA_0927"); // вернулся по посеву
  const rows = db.query(r.QUERIES.returning_via_placement).all();
  expect(rows).toEqual([{ slug: "a0927", returning_users: 1 }]);
  const f = db.query(r.QUERIES.placement_funnel).get() as Record<string, any>;
  expect(f.new_starts).toBe(0);
});

test("переходы по часам после выхода поста", () => {
  addChanA();
  db.run("UPDATE placements SET posted_at = '2026-09-27 10:00:00'");
  for (const at of ["2026-09-27 10:05:00", "2026-09-27 10:50:00", "2026-09-27 12:30:00", "2026-09-27 09:00:00"]) {
    db.run("INSERT INTO clicks (slug, at, ua_class) VALUES ('a0927', ?, 'mobile')", [at]);
  }
  db.run("INSERT INTO clicks (slug, at, ua_class) VALUES ('a0927', '2026-09-27 10:01:00', 'preview')");
  expect(db.query(r.QUERIES.clicks_by_hour).all()).toEqual([
    { slug: "a0927", hour_after_post: 0, clicks: 2 },
    { slug: "a0927", hour_after_post: 2, clicks: 1 },
  ]);
});

test("люди без метки после посева: прибавка к обычному фону и цена активированного диапазоном", () => {
  addChanA();
  db.run("UPDATE placements SET posted_at = datetime('now', '-10 days')");
  let id = 100;
  const start = (src: string, when: string, activated = false) => {
    d.recordStart(db, ++id, src === "none" ? undefined : src);
    db.run("UPDATE user_acquisition SET first_seen_at = datetime('now', ?) WHERE telegram_id = ?", [when, id]);
    if (activated) db.run("INSERT INTO funnel_events VALUES (?, 'first_reminder_delivered', datetime('now', ?, '+1 day'))", [id, when]);
  };
  // Фон: 14 человек без метки за 14 дней до поста — по 2 на каждые 48 часов, активированных нет.
  for (let i = 0; i < 14; i++) start("none", `-${11 + i} days`);
  // 48 часов после поста: 6 без метки (двое активированы), 5 помеченных (все активированы).
  for (let i = 0; i < 6; i++) start("none", `-${10 * 24 - 1 - i} hours`, i < 2);
  for (let i = 0; i < 5; i++) start("src_tg_chanA_0927", `-${10 * 24 - 2 - i} hours`, true);
  const row = db.query(r.QUERIES.untagged_uplift).get() as Record<string, any>;
  expect(row).toMatchObject({
    untagged_after: 6, untagged_baseline: 2, extra_starts: 4, extra_activated: 2,
    tagged_activated: 5, usd_per_activated_low: 5.71, usd_per_activated_high: 8,
  });
});
