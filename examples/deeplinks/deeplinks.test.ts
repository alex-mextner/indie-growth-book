import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as d from "./deeplinks";
import { sourceOf as sourceOf21 } from "../tracking/tracking";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  d.initSchema(db);
});

test("миграция: база из главы 2.1 получает first_content и first_partner", () => {
  const old = new Database(":memory:");
  old.exec(readFileSync(new URL("../tracking/schema.sql", import.meta.url), "utf8"));
  old.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (1, 'legacy', datetime('now'))");
  d.initSchema(old);
  d.initSchema(old); // повторный запуск ничего не ломает
  const r = d.recordStart(old, 2, "src_tg_chanA_0927-c2");
  expect(r.isNew).toBe(true);
  const row = old.query("SELECT first_source, first_content FROM user_acquisition WHERE telegram_id = 2").get();
  expect(row).toEqual({ first_source: "src_tg_chanA_0927", first_content: "2" });
});

test("checkPayload: длина, символы, зарезервированные префиксы и источники", () => {
  expect(d.checkPayload("src_threads_bio")).toBeNull();
  expect(d.checkPayload("a".repeat(64))).toBeNull();
  expect(d.checkPayload("a".repeat(65))).toBe("too_long");
  expect(d.checkPayload("")).toBe("empty");
  expect(d.checkPayload("src_threads.bio")).toBe("bad_chars");
  expect(d.checkPayload("src_тест")).toBe("bad_chars");
  expect(d.checkPayload("_tgr_abc")).toBe("reserved_prefix");
  expect(d.checkPayload("src_share")).toBe("reserved_source");
  expect(d.checkPayload("none")).toBe("reserved_source");
  expect(d.checkPayload("legacy")).toBe("reserved_source");
  expect(d.checkPayload("src_share-c2")).toBe("reserved_source");
});

test("служебные источники нельзя выдать и нельзя получить из ссылки", () => {
  expect(() => d.encodeCampaign({ campaign: "src_share" })).toThrow();
  expect(d.decodePayload("src_share").kind).toBe("none");
  expect(d.decodePayload("legacy").kind).toBe("none");
});

test("метка: сборка и разбор туда-обратно, друг и партнёр — разные поля", () => {
  const p = d.encodeCampaign({ campaign: "src_tg_chanA_0927", content: "2", ref: "X9y8Z7W6" });
  expect(p).toBe("src_tg_chanA_0927-c2-rX9y8Z7W6");
  expect(d.decodePayload(p)).toEqual({ kind: "campaign", campaign: "src_tg_chanA_0927", content: "2", ref: "X9y8Z7W6" });
  const q = d.encodeCampaign({ campaign: "src_tg_chanB_1003", partner: "Pa1rtn3r" });
  expect(q).toBe("src_tg_chanB_1003-pPa1rtn3r");
  expect(d.decodePayload(q)).toEqual({ kind: "campaign", campaign: "src_tg_chanB_1003", partner: "Pa1rtn3r" });
  expect(d.decodePayload("src_threads_bio")).toEqual({ kind: "campaign", campaign: "src_threads_bio" });
});

test("метка: недопустимые поля не собираются и не угадываются", () => {
  expect(() => d.encodeCampaign({ campaign: "threads_bio" })).toThrow();
  expect(() => d.encodeCampaign({ campaign: "src_a", content: "x-y" })).toThrow();
  expect(() => d.encodeCampaign({ campaign: "src_a", ref: "abc" })).toThrow();
  expect(d.decodePayload("src_a-zzz").kind).toBe("none");
  expect(d.decodePayload("src_a-c2-c3").kind).toBe("none");
  expect(d.decodePayload("hello").kind).toBe("none");
  expect(d.decodePayload(undefined).kind).toBe("none");
});

test("ссылки на объекты из главы 2.1 разбираются как раньше", () => {
  expect(d.decodePayload("ev_Ab12Cd34Ef_x9Y8z7W6")).toEqual({
    kind: "share", object: "ev", token: "Ab12Cd34Ef", ref: "x9Y8z7W6",
  });
  expect(d.decodePayload("inv_Ab12Cd34Ef")).toEqual({ kind: "share", object: "inv", token: "Ab12Cd34Ef", ref: undefined });
});

test("старые метки: дефис ломает новый разбор, legacy_labels чинит; _b переносится в вариант", () => {
  // Дефис внутри старой метки: новый разбор видит поле c с мусорным значением.
  expect(d.decodePayload("src_tg-chanA")).toEqual({ kind: "campaign", campaign: "src_tg", content: "hanA" });
  const published = ["src_threads_bio", "src_tg_chanA_0927_b", "src_tg-chanA", "ev_Ab12Cd34Ef"];
  expect(d.labelMismatches(db, published, (p) => sourceOf21(p).source)).toEqual(["src_tg-chanA"]);
  d.addLegacyLabel(db, "src_tg-chanA", "src_tg-chanA");
  expect(d.labelMismatches(db, published, (p) => sourceOf21(p).source)).toEqual([]);
  expect(d.resolvePayload(db, "src_tg-chanA")).toEqual({ kind: "campaign", campaign: "src_tg-chanA", content: undefined });
  // Вариант _b из главы 2.1 без записи в таблице остаётся частью источника, как раньше.
  expect(d.resolvePayload(db, "src_tg_chanA_0927_b")).toEqual({ kind: "campaign", campaign: "src_tg_chanA_0927_b" });
  d.addLegacyLabel(db, "src_tg_chanA_0927_b", "src_tg_chanA_0927", "2");
  expect(d.resolvePayload(db, "src_tg_chanA_0927_b")).toEqual({ kind: "campaign", campaign: "src_tg_chanA_0927", content: "2" });
});

test("длинная метка уходит в короткий ключ, одинаковый набор — один ключ", () => {
  const long = { campaign: "src_tg_family_calendars_channel_autumn_digest_0927", content: "shared_family_v2", ref: "X9y8Z7W6" };
  expect(d.encodeCampaign(long).length).toBeGreaterThan(64);
  const p1 = d.payloadFor(db, long, "посев, осенний дайджест");
  const p2 = d.payloadFor(db, long);
  expect(p1).toMatch(/^k_[A-Za-z0-9]{10}$/);
  expect(p2).toBe(p1);
  const p3 = d.payloadFor(db, { ...long, ref: undefined });
  expect(p3).not.toBe(p1); // набор без кода — другой ключ, NULL сравнивается через IS
  expect(d.payloadFor(db, { ...long, ref: undefined })).toBe(p3);
  expect(d.resolvePayload(db, p1)).toEqual({ kind: "campaign", ...long, partner: undefined });
  expect(d.resolvePayload(db, "k_AAAAAAAAAA").kind).toBe("none");
  expect(d.payloadFor(db, { campaign: "src_threads_bio" })).toBe("src_threads_bio");
  const n = db.query("SELECT COUNT(*) n FROM start_links").get() as { n: number };
  expect(n.n).toBe(2);
});

test("ссылки: start, группа, канал, мини-приложение", () => {
  expect(d.startLink("YourBot", "src_threads_bio")).toBe("https://t.me/YourBot?start=src_threads_bio");
  expect(() => d.startLink("YourBot", "a".repeat(65))).toThrow();
  expect(d.groupLink("YourBot", "src_grp_family")).toBe("https://t.me/YourBot?startgroup=src_grp_family");
  expect(d.groupLink("YourBot", undefined, ["pin_messages"])).toBe("https://t.me/YourBot?startgroup&admin=pin_messages");
  expect(d.channelLink("YourBot", ["post_messages", "edit_messages"])).toBe(
    "https://t.me/YourBot?startchannel&admin=post_messages+edit_messages",
  );
  expect(() => d.channelLink("YourBot", [])).toThrow();
  expect(d.appLink("YourBot", "src_threads_bio")).toBe("https://t.me/YourBot?startapp=src_threads_bio");
  expect(d.appLink("YourBot")).toBe("https://t.me/YourBot?startapp");
  expect(d.appLink("YourBot", "ev_Ab12Cd34Ef", "calendar")).toBe("https://t.me/YourBot/calendar?startapp=ev_Ab12Cd34Ef");
});

test("recordStart: источник, вариант, друг, партнёр, первый экран", () => {
  db.run("INSERT INTO invite_codes (code, telegram_id) VALUES ('X9y8Z7W6', 10)");
  db.run("INSERT INTO partner_codes (code, label) VALUES ('Pa1rtn3r', 'канал B')");
  const a = d.recordStart(db, 11, "src_tg_chanA_0927-c2-rX9y8Z7W6");
  expect(a.isNew).toBe(true);
  expect(d.firstScreen(a.parsed, { "2": "family_example" })).toBe("family_example");
  const row = db.query("SELECT first_source, first_content, first_partner, invited_by FROM user_acquisition WHERE telegram_id = 11").get();
  expect(row).toEqual({ first_source: "src_tg_chanA_0927", first_content: "2", first_partner: null, invited_by: 10 });

  d.recordStart(db, 14, "src_tg_chanB_1003-pPa1rtn3r");
  d.recordStart(db, 15, "src_tg_chanB_1003-pUNKNOWN1"); // незаведённый код партнёра не пишется
  const p = db.query("SELECT telegram_id, first_partner, invited_by FROM user_acquisition WHERE telegram_id IN (14, 15) ORDER BY 1").all();
  expect(p).toEqual([
    { telegram_id: 14, first_partner: "Pa1rtn3r", invited_by: null },
    { telegram_id: 15, first_partner: null, invited_by: null },
  ]);

  const b = d.recordStart(db, 12, "ev_Ab12Cd34Ef_X9y8Z7W6");
  expect(d.firstScreen(b.parsed)).toBe("event_card");
  const c = d.recordStart(db, 13, "что-то странное");
  expect(d.firstScreen(c.parsed)).toBe("welcome");
  expect(d.recordStart(db, 11, "src_threads_bio").isNew).toBe(false);
  const starts = db.query("SELECT COUNT(*) n FROM funnel_events WHERE step = 'start'").get() as { n: number };
  expect(starts.n).toBe(5);
});

test("recordAppStart: первое касание из мини-приложения без /start", () => {
  const r = d.recordAppStart(db, 30, "src_threads_bio-c3");
  expect(r.isNew).toBe(true);
  expect(d.recordAppStart(db, 30, "src_tg_chanA_0927").isNew).toBe(false);
  const row = db.query("SELECT first_source, first_content, last_source FROM user_acquisition WHERE telegram_id = 30").get();
  expect(row).toEqual({ first_source: "src_threads_bio", first_content: "3", last_source: "src_tg_chanA_0927" });
  const steps = db.query("SELECT step FROM funnel_events WHERE telegram_id = 30 ORDER BY step").all();
  expect(steps).toEqual([{ step: "app_opened" }, { step: "start" }]);
  // Потом человек пишет боту /start — это не новый старт.
  expect(d.recordStart(db, 30).isNew).toBe(false);
});

test("группа: my_chat_member даёт строку, /start@bot с параметром — источник", () => {
  d.recordGroupAdded(db, -100500, 7);
  d.recordGroupPayload(db, -100500, "src_grp_family-c2");
  d.recordGroupPayload(db, -100500, "src_threads_bio"); // первое касание не перезаписывается
  d.recordGroupPayload(db, -100600, "src_grp_family");  // /start пришёл без my_chat_member
  const rows = db.query("SELECT chat_id, first_source, added_by FROM group_acquisition ORDER BY chat_id").all();
  expect(rows).toEqual([
    { chat_id: -100600, first_source: "src_grp_family", added_by: null },
    { chat_id: -100500, first_source: "src_grp_family", added_by: 7 },
  ]);
});

test("isDaytime: по поясу человека", () => {
  const noonUtc = new Date("2026-09-28T12:00:00Z");
  expect(d.localHour("Europe/Moscow", noonUtc)).toBe(15);
  expect(d.isDaytime("Europe/Moscow", noonUtc)).toBe(true);
  expect(d.isDaytime("Asia/Vladivostok", noonUtc)).toBe(false); // 22:00
});

// Человек пришёл daysAgo дней назад, польза через secs секунд (или никогда).
function seed(id: number, source: string, daysAgo: number, secs: number | null, steps: [string, number][] = []) {
  const t0 = `datetime('now', '-${daysAgo} days')`;
  db.run(`INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (?, ?, ${t0})`, [id, source]);
  db.run(`INSERT INTO funnel_events VALUES (?, 'start', ${t0})`, [id]);
  for (const [step, s] of steps) db.run(`INSERT INTO funnel_events VALUES (?, ?, datetime(${t0}, '+${s} seconds'))`, [id, step]);
  if (secs !== null) db.run(`INSERT INTO funnel_events VALUES (?, 'first_value', datetime(${t0}, '+${secs} seconds'))`, [id]);
}

test("ttfv_by_source: доли от стартов; медиана только от 30 дошедших, чётное n — среднее двух", () => {
  seed(1, "src_share", 10, 20);
  seed(2, "src_share", 10, 40);
  seed(3, "src_share", 10, 300);
  seed(4, "src_tg_chanA_0927", 10, 90);
  seed(5, "src_tg_chanA_0927", 10, null, [["first_message_sent", 30]]);
  seed(6, "src_tg_chanA_0927", 10, 8 * 86400); // польза позже 7 дней — не считается
  seed(7, "src_tg_chanA_0927", 2, 10);          // слишком свежий — вне когорты
  for (let i = 0; i < 30; i++) seed(100 + i, "src_threads_bio", 10, i < 15 ? 30 : 90); // 30 дошедших
  const rows = db.query(d.loadQueries().ttfv_by_source).all() as any[];
  const by = (s: string) => rows.find((r) => r.first_source === s);
  expect(by("src_share")).toMatchObject({ starts: 3, reached_value: 3, reached_pct: 100, within_60s_pct: 67, median_secs: null });
  expect(by("src_tg_chanA_0927")).toMatchObject({ starts: 3, reached_value: 1, reached_pct: 33, within_60s_pct: 0, median_secs: null });
  expect(by("src_threads_bio")).toMatchObject({ starts: 30, reached_value: 30, within_60s_pct: 50, median_secs: 60 });
});

test("stalled_last_step: последний шаг тех, кто не дошёл", () => {
  seed(1, "src_tg_chanA_0927", 10, null, [["language_chosen", 5], ["first_message_sent", 30]]);
  seed(2, "src_tg_chanA_0927", 10, null, [["language_chosen", 5], ["first_message_sent", 30]]);
  seed(3, "src_tg_chanA_0927", 10, null, [["language_chosen", 5], ["nudge_sent", 90000]]);
  seed(4, "src_tg_chanA_0927", 10, 60);
  const rows = db.query(d.loadQueries().stalled_last_step).all() as any[];
  expect(rows).toEqual([
    { first_source: "src_tg_chanA_0927", last_step: "first_message_sent", users: 2 },
    { first_source: "src_tg_chanA_0927", last_step: "language_chosen", users: 1 },
  ]);
});

test("nudge_candidates: один раз, без пользы, без отказа, без блокировки, в окне 20–48 часов", () => {
  const at = (id: number, hoursAgo: number) => {
    db.run(`INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (?, 'src_threads_bio', datetime('now', '-${hoursAgo} hours'))`, [id]);
  };
  at(1, 24);
  at(2, 24); d.markFirstValue(db, 2);
  at(3, 24); d.recordNudge(db, 3);
  at(4, 24); db.run("INSERT INTO bot_status VALUES (4, 'kicked', datetime('now'))");
  at(5, 5);
  at(6, 72);
  at(7, 24); d.recordOptOut(db, 7);
  expect(d.nudgeCandidates(db)).toEqual([1]);
  expect(d.recordNudge(db, 1)).toBe(true);
  expect(d.recordNudge(db, 1)).toBe(false);
  expect(d.nudgeCandidates(db)).toEqual([]);
});

test("nudge_outcome: польза после напоминания и блокировки за 48 часов", () => {
  for (const id of [1, 2, 3]) {
    db.run(`INSERT INTO funnel_events VALUES (?, 'nudge_sent', datetime('now', '-10 days'))`, [id]);
  }
  db.run(`INSERT INTO funnel_events VALUES (1, 'first_value', datetime('now', '-9 days'))`);
  db.run(`INSERT INTO bot_status VALUES (2, 'kicked', datetime('now', '-10 days', '+3 hours'))`);
  const r = db.query(d.loadQueries().nudge_outcome).get();
  expect(r).toEqual({ nudged: 3, value_after: 1, blocked_48h: 1 });
});

test("partner_payouts: платим за активацию, с потолком, без самоприглашения", () => {
  db.run("INSERT INTO partner_codes (code, telegram_id, label, max_payouts) VALUES ('Pa1rtn3r', 50, 'канал B', 2)");
  for (const id of [50, 51, 52, 53, 54]) {
    db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_partner, first_seen_at) VALUES (?, 'src_tg_chanB_1003', 'Pa1rtn3r', datetime('now', '-10 days'))", [id]);
    db.run("INSERT INTO funnel_events VALUES (?, 'first_reminder_delivered', datetime('now', '-9 days'))", [id]);
  }
  const r = db.query(d.loadQueries().partner_payouts).get();
  expect(r).toEqual({ code: "Pa1rtn3r", label: "канал B", starts: 4, activated: 4, payable: 2, max_day_starts: 4 });
});

test("удаление по запросу", () => {
  db.run("INSERT INTO invite_codes (code, telegram_id) VALUES ('X9y8Z7W6', 20)");
  const key = d.payloadFor(db, { campaign: "src_tg_family_calendars_channel_autumn_digest_0927", content: "shared_family_v2", ref: "X9y8Z7W6" });
  d.recordStart(db, 20, "src_threads_bio");
  d.recordStart(db, 21, "ev_Ab12Cd34Ef_X9y8Z7W6");
  d.recordGroupAdded(db, -1, 20);
  d.markFirstValue(db, 20);
  d.recordOptOut(db, 20);
  d.deleteUserOnboarding(db, 20);
  for (const t of ["user_acquisition", "invite_codes", "funnel_events", "bot_status", "messaging_optout"]) {
    const n = db.query(`SELECT COUNT(*) n FROM ${t} WHERE telegram_id = 20`).get() as { n: number };
    expect(n.n).toBe(0);
  }
  expect(db.query("SELECT invited_by FROM user_acquisition WHERE telegram_id = 21").get()).toEqual({ invited_by: null });
  expect(db.query("SELECT added_by FROM group_acquisition WHERE chat_id = -1").get()).toEqual({ added_by: null });
  const k = d.resolvePayload(db, key);
  expect(k.kind === "campaign" && k.ref).toBeUndefined(); // ключ работает, но без кода удалённого
});
