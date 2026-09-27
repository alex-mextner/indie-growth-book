import { Database } from "bun:sqlite";
import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import * as t from "./tracking";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
});

test("sourceOf: метки, ссылки на объекты, мусор", () => {
  expect(t.sourceOf("src_threads_bio").source).toBe("src_threads_bio");
  expect(t.sourceOf("ev_Ab12Cd34Ef_x9Y8z7W6").source).toBe("src_share");
  expect(t.sourceOf("ev_Ab12Cd34Ef_x9Y8z7W6").inviteCode).toBe("x9Y8z7W6");
  expect(t.sourceOf("ev_Ab12Cd34Ef").source).toBe("src_share"); // старая ссылка без кода
  expect(t.sourceOf("ev_Ab12Cd34Ef").inviteCode).toBeUndefined();
  expect(t.sourceOf("ev_123").source).toBe("src_share");        // старый порядковый номер
  expect(t.sourceOf("inv_3f2a9c1e-5b7d-4e8a").source).toBe("src_share"); // старый формат с дефисами
  expect(t.sourceOf("hello world").source).toBe("none");
  expect(t.sourceOf(undefined).source).toBe("none");
});

test("первое касание не перезаписывается, пустой /start не затирает последнее", () => {
  expect(t.recordStart(db, 1, "src_threads_bio")).toBe(true);
  expect(t.recordStart(db, 1, "src_tg_chanA_0927")).toBe(false);
  t.recordStart(db, 1, undefined);
  const r = db.query("SELECT * FROM user_acquisition WHERE telegram_id = 1").get() as any;
  expect(r.first_source).toBe("src_threads_bio");
  expect(r.last_source).toBe("src_tg_chanA_0927");
  const starts = db.query("SELECT COUNT(*) n FROM funnel_events WHERE step='start'").get() as any;
  expect(starts.n).toBe(1);
});

test("приглашение: код проверяется, самоприглашение не считается", () => {
  const code = t.getOrCreateInviteCode(db, 10);
  expect(code).toMatch(/^[A-Za-z0-9]{6,12}$/);
  t.recordStart(db, 11, `ev_Ab12Cd34Ef_${code}`);
  t.recordStart(db, 10, `ev_Ab12Cd34Ef_${code}`); // сам себе (уже существует — строка не вставится)
  t.recordStart(db, 12, "ev_Ab12Cd34Ef_FAKEcode1");
  const r11 = db.query("SELECT invited_by FROM user_acquisition WHERE telegram_id=11").get() as any;
  const r12 = db.query("SELECT first_source, invited_by FROM user_acquisition WHERE telegram_id=12").get() as any;
  expect(r11.invited_by).toBe(10);
  expect(r12.first_source).toBe("src_share");
  expect(r12.invited_by).toBeNull();
});

test("понятым считается только первое сообщение", () => {
  t.markFirstMessage(db, 5, false);
  t.markFirstMessage(db, 5, true);
  const n = db.query("SELECT COUNT(*) n FROM funnel_events WHERE telegram_id=5 AND step='first_message_understood'").get() as any;
  expect(n.n).toBe(0);
});

test("блокировка и разблокировка", () => {
  t.recordBotStatus(db, 7, "kicked");
  t.recordBotStatus(db, 7, "member");
  const last = db.query("SELECT status FROM bot_status WHERE telegram_id=7 ORDER BY rowid DESC LIMIT 1").get() as any;
  expect(last.status).toBe("member");
});

test("удаление по запросу чистит все таблицы", () => {
  const code = t.getOrCreateInviteCode(db, 20);
  t.recordStart(db, 20, "src_threads_bio");
  t.recordStart(db, 21, `ev_Ab12Cd34Ef_${code}`);
  t.recordBotStatus(db, 20, "kicked");
  t.markActive(db, 20);
  t.recordReminderDelivery(db, 20, 501);
  t.deleteUserTracking(db, 20);
  for (const table of ["user_acquisition", "invite_codes", "funnel_events", "bot_status", "user_activity", "reminder_deliveries"]) {
    const n = db.query(`SELECT COUNT(*) n FROM ${table} WHERE telegram_id=20`).get() as any;
    expect(n.n).toBe(0);
  }
  const r21 = db.query("SELECT invited_by FROM user_acquisition WHERE telegram_id=21").get() as any;
  expect(r21.invited_by).toBeNull();
});

test("запросы из queries.sql выполняются", () => {
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, created_at);
           CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, created_at TEXT);
           INSERT INTO users VALUES (100, '2025-01-02T10:00:00.000Z'), (101, 1735812000), (102, NULL), (103, 1735812000000);`);
  const sql = readFileSync(new URL("./queries.sql", import.meta.url), "utf8");
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !s.split("\n").every((l) => l.startsWith("--")))) {
    db.query(stmt).all();
  }
  const rows = db.query("SELECT telegram_id, first_seen_at FROM user_acquisition ORDER BY telegram_id").all() as any[];
  expect(rows.map((r) => r.first_seen_at)).toEqual(["2025-01-02 10:00:00", "2025-01-02 10:00:00", "2000-01-01 00:00:00", "2025-01-02 10:00:00"]);
});

// ---------- Глава 2.3 ----------

const QUERIES = readFileSync(new URL("./queries.sql", import.meta.url), "utf8").split(/;\s*\n/);
/** Запрос из queries.sql, в комментарии перед которым есть marker. */
function q(marker: string): string {
  const s = QUERIES.find((chunk) => chunk.includes(marker));
  if (!s) throw new Error(`нет запроса с меткой ${marker}`);
  return s;
}
const day = (expr: string) => (db.query(`SELECT ${expr} AS v`).get() as any).v as string;

test("активность — одна строка на человека в день", () => {
  t.markActive(db, 1);
  t.markActive(db, 1);
  const n = db.query("SELECT COUNT(*) n FROM user_activity WHERE telegram_id=1").get() as any;
  expect(n.n).toBe(1);
});

test("доставка напоминания отмечает активацию, сводка — нет", () => {
  t.recordReminderDelivery(db, 1, 501);
  t.recordReminderDelivery(db, 2, 502, "weekly_summary");
  const steps = db.query("SELECT telegram_id FROM funnel_events WHERE step='first_reminder_delivered'").all() as any[];
  expect(steps.map((r) => r.telegram_id)).toEqual([1]);
});

test("напоминание о чужом общем событии не активирует получателя", () => {
  t.recordReminderDelivery(db, 3, 601, "reminder", false);
  const n = db.query("SELECT COUNT(*) n FROM funnel_events WHERE telegram_id=3").get() as any;
  expect(n.n).toBe(0);
  const d = db.query("SELECT COUNT(*) n FROM reminder_deliveries WHERE telegram_id=3").get() as any;
  expect(d.n).toBe(1); // пассивная линия его всё равно видит
});

test("блокировка — только по тексту ошибки; служебные сообщения — не ввод", () => {
  expect(t.isBlockedError("Forbidden: bot was blocked by the user")).toBe(true);
  expect(t.isBlockedError("Forbidden: bot can't initiate conversation with a user")).toBe(false);
  expect(t.isBlockedError("Forbidden: user is deactivated")).toBe(false);
  expect(t.isHumanInput({ message: { text: "/start" } })).toBe(true);
  expect(t.isHumanInput({ message: { successful_payment: {} } })).toBe(false);
  expect(t.isHumanInput({ callback_query: { data: "alive" } })).toBe(false);
  expect(t.isHumanInput({ callback_query: { data: "ev_edit" } })).toBe(true);
});

test("знак жизни: чужое сообщение не засчитывается и активностью не считается", () => {
  t.recordReminderDelivery(db, 1, 501);
  expect(t.ackReminder(db, 2, 501)).toBe(false); // у человека 2 нет сообщения 501
  expect(t.ackReminder(db, 1, 501)).toBe(true);
  expect(t.ackReminder(db, 1, 501)).toBe(false); // повторное нажатие
  const r = db.query("SELECT acked_on FROM reminder_deliveries WHERE telegram_id=1 AND message_id=501").get() as any;
  expect(r.acked_on).not.toBeNull();
  const a = db.query("SELECT COUNT(*) n FROM user_activity WHERE telegram_id=1").get() as any;
  expect(a.n).toBe(0); // бот сам просит нажать — это не использование
});

describe("треугольники удержания", () => {
  // Когорта — понедельник четыре недели назад: неделя 1 окончательна даже для «на связи»
  // (+27 дней) в любой день недели, а неделя 4 (+41) ещё не закончилась.
  let c: string;
  beforeEach(() => {
    c = day("date('now', 'weekday 0', '-6 days', '-28 days')");
    db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (1, 'none', datetime(?, '+2 days', '+10 hours'))", [c]);
    db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (2, 'none', datetime(?, '+12 hours'))", [c]);
    db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (111111111, 'none', datetime(?, '+1 day'))", [c]); // свой аккаунт
    // /start — тоже действие: запись активности идёт с первого дня
    db.run("INSERT INTO user_activity VALUES (1, date(?, '+2 days')), (2, ?), (111111111, date(?, '+1 day'))", [c, c, c]);
    db.run("INSERT INTO user_activity VALUES (1, date(?, '+10 days')), (111111111, date(?, '+10 days'))", [c, c]); // неделя 1
    db.run("INSERT INTO reminder_deliveries (telegram_id, delivered_on) VALUES (99, date(?, '-7 days'))", [c]); // журнал вёлся и раньше
    db.run("INSERT INTO reminder_deliveries (telegram_id, delivered_on) VALUES (2, date(?, '+9 days'))", [c]); // человек 2: неделя 1
  });
  const row = (marker: string) => (db.query(q(marker)).all() as any[]).find((r) => r.cohort === c);

  test("активное: доля когорты без своих, будущие недели пустые", () => {
    const r = row("Треугольник активного удержания:");
    expect(r.n).toBe(2);
    expect(r.w1).toBe(50);
    expect(r.w4).toBeNull();
  });
  test("когорты до начала записи не показываются", () => {
    db.run("DELETE FROM user_activity WHERE day < date(?, '+2 days')", [c]);
    expect(row("Треугольник активного удержания:")).toBeUndefined();
  });
  test("активированные", () => {
    db.run("INSERT INTO funnel_events VALUES (1, 'first_reminder_delivered', datetime(?, '+3 days'))", [c]);
    db.run("INSERT INTO funnel_events VALUES (2, 'first_reminder_delivered', datetime(?, '+9 days'))", [c]); // позже 7 дней
    const r = row("активированных");
    expect(r.n).toBe(1);
    expect(r.w1).toBe(100);
  });
  test("пассивное", () => {
    expect(row("Треугольник пассивного").w1).toBe(50);
  });
  test("на связи: блокировка вскоре после напоминания снимает его, поздняя — нет", () => {
    expect(row("Треугольник «на связи»").w1).toBe(100);
    db.run("INSERT INTO bot_status VALUES (2, 'kicked', datetime(?, '+30 days'))", [c]);
    expect(row("Треугольник «на связи»").w1).toBe(100);
    db.run("INSERT INTO bot_status VALUES (2, 'kicked', datetime(?, '+11 days'))", [c]);
    expect(row("Треугольник «на связи»").w1).toBe(50);
  });
});

test("одно число на неделю: без своих, пассивные без заблокировавших сразу после", () => {
  const d1 = day("date('now', 'weekday 0', '-13 days')");
  db.run("INSERT INTO user_activity VALUES (3, date(?, '+1 day')), (111111111, date(?, '+1 day'))", [d1, d1]);
  db.run("INSERT INTO reminder_deliveries (telegram_id, delivered_on) VALUES (3, date(?, '+2 days')), (4, date(?, '+2 days')), (5, date(?, '+2 days'))", [d1, d1, d1]);
  db.run("INSERT INTO reminder_deliveries (telegram_id, kind, delivered_on) VALUES (8, 'weekly_summary', date(?, '+2 days'))", [d1]); // не напоминание
  db.run("INSERT INTO bot_status VALUES (5, 'kicked', datetime(?, '+3 days'))", [d1]);
  db.run("INSERT INTO user_activity VALUES (6, date(?, '-1 day'))", [d1]); // позапрошлая неделя — не считается
  const r = db.query(q("Одно число на неделю")).get() as any;
  expect(r).toEqual({ active: 1, passive: 1, in_touch: 2 });
});

test("похожие на зомби", () => {
  db.run("INSERT INTO reminder_deliveries (telegram_id, delivered_on) VALUES (6, date('now', '-1 day')), (7, date('now', '-1 day'))");
  db.run("INSERT INTO user_activity VALUES (6, date('now', '-40 days')), (7, date('now', '-3 days'))");
  const rows = db.query(q("Похожие на зомби")).all() as any[];
  expect(rows.map((r) => r.telegram_id)).toEqual([6]);
});

test("новые, постоянные, вернувшиеся, неизвестные", () => {
  const d1 = day("date('now', 'weekday 0', '-13 days')");
  db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (1, 'none', datetime(?, '+1 day')), (2, 'none', datetime(?, '-60 days')), (3, 'none', datetime(?, '-60 days')), (4, 'none', datetime(?, '-60 days'))", [d1, d1, d1, d1]);
  db.run("INSERT INTO user_activity VALUES (1, date(?, '+1 day')), (2, date(?, '+1 day')), (2, date(?, '-10 days')), (3, date(?, '+2 days')), (3, date(?, '-30 days')), (4, date(?, '+3 days'))", [d1, d1, d1, d1, d1, d1]);
  const rows = db.query(q("новые, постоянные, вернувшиеся")).all() as any[];
  expect(Object.fromEntries(rows.map((r) => [r.kind, r.users]))).toEqual({ new: 1, regular: 1, returned: 1, unknown: 1 });
});

test("путь отдельных людей: номера недель по порядку", () => {
  db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (1, 'src_threads_bio', datetime('now', '-30 days'))");
  db.run("INSERT INTO user_activity VALUES (1, date('now', '-14 days')), (1, date('now', '-30 days')), (1, date('now', '-29 days'))");
  const r = (db.query(q("путь каждого")).all() as any[])[0];
  expect(r.active_weeks).toBe("0 2");
});

test("перенос истории активности: ISO, unix-секунды и миллисекунды", () => {
  db.exec(`CREATE TABLE users (telegram_id INTEGER PRIMARY KEY, created_at);
           CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, created_at);
           INSERT INTO events (user_id, created_at) VALUES
             (1, '2025-01-02T10:00:00.000Z'), (2, 1735812000), (3, 1735812000000), (4, NULL), (NULL, 1735812000);`);
  db.exec(q("Перенос истории активности"));
  const rows = db.query("SELECT telegram_id, day FROM user_activity ORDER BY telegram_id").all() as any[];
  expect(rows).toEqual([
    { telegram_id: 1, day: "2025-01-02" },
    { telegram_id: 2, day: "2025-01-02" },
    { telegram_id: 3, day: "2025-01-02" },
  ]);
});
