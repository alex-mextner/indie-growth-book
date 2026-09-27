import { Database } from "bun:sqlite";
import { expect, test, beforeEach } from "bun:test";
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
  expect(t.sourceOf("s_ab12cd").source).toBe("src_share");       // старый формат HyperCalendarBot
  expect(t.sourceOf("i_3f2a9c1e-5b7d-4e8a").source).toBe("src_share");
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
  t.deleteUserTracking(db, 20);
  for (const table of ["user_acquisition", "invite_codes", "funnel_events", "bot_status"]) {
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
