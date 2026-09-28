import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as r from "./retention";
import { assignVariant } from "../experiments/experiments";

// Таблицы — те же, что в других примерах: tracking (2.1–2.3), experiments (2.5), messaging_optout (5.2).
const OPTOUT = "CREATE TABLE IF NOT EXISTS messaging_optout (telegram_id INTEGER PRIMARY KEY, at TEXT NOT NULL);";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(new URL("../tracking/schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../experiments/schema.sql", import.meta.url), "utf8"));
  db.exec(OPTOUT);
  r.initRetention(db, [111111111, 222222222]); // свои аккаунты — один список на все запросы
});

const sql1 = (q: string, ...p: any[]) => Object.values(db.query(q).get(...p) as object)[0] as string;
const daysAgo = (n: number) => sql1("SELECT date('now', ?)", `-${n} days`);
const tsAgo = (n: number) => sql1("SELECT datetime('now', ?)", `-${n} days`);

const came = (id: number, ago: number) =>
  db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (?, 'none', ?)", [id, tsAgo(ago)]);
const act = (id: number, ago: number) => db.run("INSERT OR IGNORE INTO user_activity VALUES (?, ?)", [id, daysAgo(ago)]);
const msg = (id: number, ago: number, kind = "reminder", ackAgo: number | null = null) =>
  db.run("INSERT INTO reminder_deliveries (telegram_id, kind, delivered_on, acked_on) VALUES (?, ?, ?, ?)", [
    id, kind, daysAgo(ago), ackAgo === null ? null : daysAgo(ackAgo),
  ]);
const status = (id: number, s: "kicked" | "member" | "gone", ago: number) =>
  db.run("INSERT INTO bot_status VALUES (?, ?, ?)", [id, s, tsAgo(ago)]);
const step = (id: number, s: string, ago: number) =>
  db.run("INSERT OR IGNORE INTO funnel_events VALUES (?, ?, ?)", [id, s, tsAgo(ago)]);
const optout = (id: number, ago: number) => db.run("INSERT INTO messaging_optout VALUES (?, ?)", [id, tsAgo(ago)]);

// Полдень и три часа ночи по Москве (UTC+3) в любой день.
const NOON_MSK = new Date("2026-09-28T09:00:00Z");
const NIGHT_MSK = new Date("2026-09-28T00:00:00Z");
const msk = () => "Europe/Moscow";

test("сегменты: шесть видов, свой аккаунт не считается, порядок проверок", () => {
  came(111111111, 90); act(111111111, 1);            // свой аккаунт
  came(1, 3);                                        // новый
  came(2, 60); act(2, 10);                           // активный: действие за 14 дней
  came(3, 60); act(3, 20); msg(3, 2);                // пассивный живой: действие 20 дней назад
  came(4, 60); act(4, 50); msg(4, 2, "reminder", 5); // пассивный живой: нажал «Помню» 5 дней назад
  came(5, 60); act(5, 50); msg(5, 2);                // зомби: напоминания идут, знака жизни 28+ дней нет
  came(6, 60); act(6, 40); step(6, "first_value", 59); // спящий: польза была, теперь тишина
  came(7, 60); act(7, 1); status(7, "kicked", 0);    // заблокировал — важнее активности
  came(8, 60); status(8, "kicked", 20); status(8, "member", 10); act(8, 9); // разблокировал и вернулся
  came(9, 60); act(9, 50); msg(9, 2, "weekly_summary"); // сводка — не напоминание; пользы не было
  came(10, 60); act(10, 20); status(10, "gone", 3);   // аккаунт удалён — в сегменте blocked
  optout(6, 30);

  const seg = Object.fromEntries(r.userSegments(db).map((x) => [x.telegram_id, x.segment]));
  expect(seg).toEqual({
    1: "new", 2: "active", 3: "passive_alive", 4: "passive_alive", 5: "zombie",
    6: "dormant", 7: "blocked", 8: "active", 9: "never_activated", 10: "blocked",
  });
  expect(r.userSegments(db).find((x) => x.telegram_id === 6)!.opted_out).toBe(1);
  expect(r.segmentCounts(db)).toEqual({
    blocked: 2, new: 1, active: 2, passive_alive: 2, zombie: 1, dormant: 1, never_activated: 1,
  });
});

test("бюджет: общий потолок на все виды инициативы; напоминания, сводка и billing не считаются", () => {
  came(1, 60); for (const d of [0, 1, 2, 3, 4]) msg(1, d);             // пять своих напоминаний
  came(2, 60); msg(2, 1, "zombie_check"); msg(2, 3, "announce");      // неделя с перебором: вопрос зомби + новость
  came(3, 60); msg(3, 2, "weekly_summary"); msg(3, 5, "announce"); msg(3, 1, "billing"); // одна инициатива
  came(4, 60); msg(4, 8, "announce");                                 // 8 дней назад — вне окна
  came(5, 5); step(5, "nudge_sent", 4); msg(5, 1, "announce");         // мягкое напоминание 5.2 тоже инициатива
  const rows = Object.fromEntries(r.messageBudget(db).map((x) => [x.telegram_id, x]));
  expect(rows[1]).toEqual({ telegram_id: 1, asked: 5, billing: 0, initiative: 0, budget: 1, over_budget: 0 });
  expect(rows[2]!.initiative).toBe(2);
  expect(rows[2]!.over_budget).toBe(1);
  expect(rows[3]).toMatchObject({ asked: 1, billing: 1, initiative: 1, over_budget: 0 });
  expect(rows[4]).toBeUndefined();
  expect(rows[5]).toMatchObject({ initiative: 2, over_budget: 1 });
  expect(r.initiativeLast7d(db, 5)).toBe(2);
});

test("mayWrite: своё напоминание — всегда, кроме блокировки; billing — днём и вне бюджета; инициатива — днём, без отказа, в бюджете", () => {
  came(1, 60); optout(1, 5);
  expect(r.mayWrite(db, 1, "reminder", "Europe/Moscow", NIGHT_MSK)).toEqual({ ok: true }); // человек сам заказал
  expect(r.mayWrite(db, 1, "reengage", "Europe/Moscow", NOON_MSK)).toEqual({ ok: false, reason: "opted_out" });
  expect(r.mayWrite(db, 1, "billing", "Europe/Moscow", NOON_MSK)).toEqual({ ok: true });   // о том, за что платил
  expect(r.mayWrite(db, 1, "billing", "Europe/Moscow", NIGHT_MSK)).toEqual({ ok: false, reason: "night" });

  came(2, 60);
  expect(r.mayWrite(db, 2, "reengage", "Europe/Moscow", NIGHT_MSK)).toEqual({ ok: false, reason: "night" });
  const slot = r.reserveMessage(db, 2, "zombie_check", "Europe/Moscow", NOON_MSK);
  expect(slot.ok).toBe(true);
  // Второй вид инициативы в ту же неделю не проходит: потолок общий.
  expect(r.reserveMessage(db, 2, "announce", "Europe/Moscow", NOON_MSK)).toEqual({ ok: false, reason: "over_budget" });
  expect(r.mayWrite(db, 2, "weekly_summary", "Europe/Moscow", NOON_MSK)).toEqual({ ok: true });
  expect(r.mayWrite(db, 2, "billing", "Europe/Moscow", NOON_MSK)).toEqual({ ok: true });
  // Отправка не удалась — строка убрана, бюджет свободен.
  if (slot.ok) r.releaseMessage(db, slot.id);
  expect(r.mayWrite(db, 2, "announce", "Europe/Moscow", NOON_MSK)).toEqual({ ok: true });
  const s2 = r.reserveMessage(db, 2, "announce", "Europe/Moscow", NOON_MSK);
  if (s2.ok) r.confirmMessage(db, s2.id, 77);
  expect(db.query("SELECT kind, message_id FROM reminder_deliveries WHERE telegram_id = 2").all())
    .toEqual([{ kind: "announce", message_id: 77 }]);

  came(3, 60); status(3, "kicked", 1);
  expect(r.mayWrite(db, 3, "reminder", "Europe/Moscow", NOON_MSK)).toEqual({ ok: false, reason: "blocked" });
  came(4, 60); status(4, "gone", 1);
  expect(r.mayWrite(db, 4, "billing", "Europe/Moscow", NOON_MSK)).toEqual({ ok: false, reason: "blocked" });
  expect(() => r.reserveMessage(db, 3, "reminder", "Europe/Moscow", NOON_MSK)).toThrow();
});

test("classifySendError: блокировка, недоступен, 429, прочее", () => {
  expect(r.classifySendError({ error_code: 403, description: "Forbidden: bot was blocked by the user" }))
    .toEqual({ kind: "blocked" });
  expect(r.classifySendError({ error_code: 403, description: "Forbidden: user is deactivated" })).toEqual({ kind: "gone" });
  expect(r.classifySendError({ error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }))
    .toEqual({ kind: "gone" });
  expect(r.classifySendError({ error_code: 400, description: "Bad Request: chat not found" })).toEqual({ kind: "gone" });
  expect(r.classifySendError({ error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } }))
    .toEqual({ kind: "retry", after: 7 });
  expect(r.classifySendError({ error_code: 502, description: "Bad Gateway" })).toEqual({ kind: "other" });
  expect(r.classifySendError(new Error("ECONNRESET") as any)).toEqual({ kind: "other" });
});

function dormantWithValue(id: number, lastActAgo = 45) {
  came(id, 120); step(id, "first_reminder_delivered", 110); act(id, lastActAgo);
}

test("кандидаты: только замолчавшие с пользой в прошлом, без отказов, блокировок и свежих сообщений", () => {
  dormantWithValue(1);                                         // кандидат
  came(2, 120); for (const d of [60, 61, 62]) act(2, d);       // польза по трём дням действий — кандидат
  came(3, 120); act(3, 45);                                    // заглянул один раз — не кандидат
  dormantWithValue(4, 20);                                     // молчит только 20 дней
  dormantWithValue(5, 200);                                    // молчит больше 180 дней
  dormantWithValue(6); optout(6, 50);                          // «Больше не писать»
  dormantWithValue(7); status(7, "kicked", 40);                // заблокировал
  dormantWithValue(8); msg(8, 25, "reengage");                 // писали 25 дней назад
  dormantWithValue(9); msg(9, 10);                             // напоминание 10 дней назад
  dormantWithValue(10); step(10, "nudge_sent", 20);            // мягкое напоминание 20 дней назад
  dormantWithValue(11); status(11, "kicked", 60); status(11, "member", 50); // разблокировал — кандидат
  dormantWithValue(111111111);                                 // свой аккаунт
  expect(r.reengageCandidates(db, "reengage_1026")).toEqual([1, 2, 11]);
});

const tgErr = (error_code: number, description: string, retry_after?: number) =>
  Object.assign(new Error(description), { error_code, description, parameters: retry_after ? { retry_after } : undefined });

test("волна: группы по хешу из 2.5, контрольной не пишем, ночью ждём, повторно не выбираем", async () => {
  const ids = Array.from({ length: 40 }, (_, i) => 1000 + i);
  ids.forEach((id) => dormantWithValue(id));
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };
  let mid = 0;
  const send = async () => ++mid;

  expect(await r.runReengageWave(db, "reengage_1026", msk, send, { now: NIGHT_MSK, sleep }))
    .toEqual({ sent: [], holdout: [], unreachable: [], failed: [] });

  const w = await r.runReengageWave(db, "reengage_1026", msk, send, { now: NOON_MSK, sleep });
  expect(w.sent.length + w.holdout.length).toBe(40);
  for (const id of w.sent) expect(assignVariant("reengage_1026", id)).toBe("B");
  for (const id of w.holdout) expect(assignVariant("reengage_1026", id)).toBe("A");
  expect(w.sent.length).toBeGreaterThan(5);
  expect(w.holdout.length).toBeGreaterThan(5);
  expect(sleeps.every((ms) => ms >= 1000 / 25)).toBe(true);           // не быстрее 25 в секунду
  expect(sleeps.length).toBe(w.sent.length);
  const logged = db.query("SELECT COUNT(*) AS n FROM reminder_deliveries WHERE kind = 'reengage' AND message_id IS NOT NULL").get() as any;
  expect(logged.n).toBe(w.sent.length);

  // Повторный запуск: все уже назначены или им писали.
  expect(await r.runReengageWave(db, "reengage_1026", msk, send, { now: NOON_MSK, sleep }))
    .toEqual({ sent: [], holdout: [], unreachable: [], failed: [] });
});

test("волна: 429 — ждём и повторяем; блокировка — статус и группа B; сбой — без группы, в следующий раз", async () => {
  const ids = Array.from({ length: 60 }, (_, i) => 2000 + i).filter((id) => assignVariant("re2", id) === "B").slice(0, 4);
  ids.forEach((id) => dormantWithValue(id));
  const [flaky, blocked, gone, broken] = ids as [number, number, number, number];
  const sleeps: number[] = [];
  let calls = 0;
  const send = async (id: number) => {
    if (id === flaky && calls++ === 0) throw tgErr(429, "Too Many Requests: retry after 3", 3);
    if (id === blocked) throw tgErr(403, "Forbidden: bot was blocked by the user");
    if (id === gone) throw tgErr(403, "Forbidden: user is deactivated");
    if (id === broken) throw tgErr(502, "Bad Gateway");
    return 500 + id;
  };
  const errors: number[] = [];
  const w = await r.runReengageWave(db, "re2", msk, send, {
    now: NOON_MSK, sleep: async (ms) => { sleeps.push(ms); }, log: (id) => errors.push(id),
  });
  expect(w).toEqual({ sent: [flaky], holdout: [], unreachable: [blocked, gone], failed: [broken] });
  expect(sleeps).toContain(3000);
  expect(errors).toEqual([broken]);
  const st = db.query("SELECT telegram_id, status FROM bot_status ORDER BY telegram_id").all();
  expect(st).toEqual([{ telegram_id: blocked, status: "kicked" }, { telegram_id: gone, status: "gone" }]);
  const groups = db.query("SELECT telegram_id FROM experiment_assignments WHERE experiment = 're2' ORDER BY telegram_id").all()
    .map((x: any) => x.telegram_id);
  expect(groups).toEqual([flaky, blocked, gone].sort((a, b) => a - b)); // сбой без группы
  expect(db.query("SELECT COUNT(*) AS n FROM reminder_deliveries WHERE message_id IS NULL").get()).toEqual({ n: 0 });
  // В следующий запуск сбойный — снова кандидат, остальные — нет.
  expect(r.reengageCandidates(db, "re2")).toEqual([broken]);
});

test("итог: вернувшиеся за 14 дней по группам, отказ — не возвращение, интервал разницы", () => {
  const put = (id: number, v: "A" | "B", ago = 20) =>
    db.run("INSERT INTO experiment_assignments VALUES ('re', ?, ?, ?)", [id, v, tsAgo(ago)]);
  for (let i = 1; i <= 10; i++) put(i, "A");
  for (let i = 11; i <= 20; i++) put(i, "B");
  put(21, "B", 5);                               // назначен 5 дней назад — окно не закончилось
  act(1, 15);                                    // A: вернулся сам
  act(11, 18); act(12, 10); act(13, 19);         // B: трое вернулись
  act(14, 19); optout(14, 19);                   // B: нажал «Больше не писать» — не вернулся
  status(15, "kicked", 19);                      // B: заблокировал
  act(16, 2);                                    // B: вернулся, но позже 14 дней
  const rows = r.reengageOutcome(db, "re");
  expect(rows).toEqual([
    { variant: "A", n: 10, returned_14d: 1, opted_out_14d: 0, blocked_14d: 0 },
    { variant: "B", n: 10, returned_14d: 3, opted_out_14d: 1, blocked_14d: 1 },
  ]);
  const eff = r.reengageEffect(rows)!;
  expect(eff.returned.p).toBeCloseTo(0.2, 6);
  expect(eff.returned.low).toBeLessThan(0);      // 3 из 10 против 1 из 10 — в пределах шума
  expect(eff.returned.high).toBeGreaterThan(0);
  expect(r.reengageEffect([rows[0]!])).toBeNull();
});

test("блокировки по видам сообщений: в день отправки или на следующий", () => {
  came(1, 90); msg(1, 10, "reengage"); status(1, "kicked", 9);
  came(2, 90); msg(2, 10, "reengage"); status(2, "kicked", 5);   // позже — не засчитываем
  came(3, 90); msg(3, 10); msg(3, 3);
  came(4, 90); msg(4, 1);                                        // слишком свежее
  came(5, 90); step(5, "nudge_sent", 20); status(5, "kicked", 20);
  expect(r.blocksByKind(db)).toEqual([
    { kind: "nudge", messages: 1, users: 1, blocked_after: 1 },
    { kind: "reengage", messages: 2, users: 2, blocked_after: 1 },
    { kind: "reminder", messages: 2, users: 1, blocked_after: 0 },
  ]);
});

test("пустая база: все запросы выполняются", () => {
  expect(r.userSegments(db)).toEqual([]);
  expect(r.segmentCounts(db).dormant).toBe(0);
  expect(r.messageBudget(db)).toEqual([]);
  expect(r.blocksByKind(db)).toEqual([]);
  expect(r.reengageCandidates(db, "x")).toEqual([]);
  expect(r.reengageOutcome(db, "x")).toEqual([]);
});

test("me: одна таблица на все запросы, повторный initRetention безопасен", () => {
  r.initRetention(db, [111111111, 333333333]);
  expect(db.query("SELECT telegram_id FROM me ORDER BY 1").all().map((x: any) => x.telegram_id))
    .toEqual([111111111, 222222222, 333333333]);
  came(333333333, 60); act(333333333, 1);
  came(1, 60); act(1, 1);
  expect(r.userSegments(db).map((x) => x.telegram_id)).toEqual([1]);
  expect(r.messageBudget(db)).toEqual([]);
});

test("billing: failed ночью ждёт до дня, active отменяет, недоступных убирает, вне бюджета", async () => {
  came(1, 60); came(2, 60); came(3, 60); came(4, 60);
  msg(1, 1, "announce");                                        // бюджет уже исчерпан — billing всё равно уходит
  optout(1, 2);                                                 // и «Больше не писать» ему не мешает
  r.onSubscriptionUpdate(db, 1, "failed", "sub_month", 250);
  r.onSubscriptionUpdate(db, 2, "failed", "sub_month", 250);
  r.onSubscriptionUpdate(db, 2, "active");                      // вернул подписку — писать не о чем
  r.onSubscriptionUpdate(db, 3, "failed", "sub_month", 250);
  status(3, "kicked", 0);
  r.onSubscriptionUpdate(db, 4, "failed", "sub_month", 250);
  const got: r.BillingNotice[] = [];
  const send = async (n: r.BillingNotice) => {
    if (n.telegram_id === 4) throw tgErr(502, "Bad Gateway");
    got.push(n);
    return 900 + n.telegram_id;
  };
  const opts = { sleep: async () => {}, log: () => {} };

  const night = await r.sendPendingBilling(db, msk, send, { ...opts, now: NIGHT_MSK });
  expect(night).toEqual({ sent: [], waiting: [1, 4], unreachable: [3], failed: [] });
  expect(got).toEqual([]);

  const day = await r.sendPendingBilling(db, msk, send, { ...opts, now: NOON_MSK });
  expect(day).toEqual({ sent: [1], waiting: [], unreachable: [], failed: [4] });
  expect(got).toEqual([{ telegram_id: 1, invoice_payload: "sub_month", stars: 250 }]);
  expect(db.query("SELECT kind, message_id FROM reminder_deliveries WHERE telegram_id = 1 AND kind = 'billing'").all())
    .toEqual([{ kind: "billing", message_id: 901 }]);
  expect(db.query("SELECT telegram_id FROM billing_pending").all()).toEqual([{ telegram_id: 4 }]); // сбой — в очереди
  r.deleteUserRetention(db, 4);
  expect(db.query("SELECT COUNT(*) AS n FROM billing_pending").get()).toEqual({ n: 0 });
});
