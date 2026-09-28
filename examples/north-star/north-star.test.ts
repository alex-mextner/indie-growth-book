import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Таблицы — копия из examples/tracking/schema.sql (главы 2.1–2.3).
const SCHEMA = `
CREATE TABLE user_acquisition (
  telegram_id INTEGER PRIMARY KEY, first_source TEXT NOT NULL, first_seen_at TEXT NOT NULL,
  last_source TEXT, last_seen_at TEXT, invited_by INTEGER, self_reported TEXT);
CREATE TABLE funnel_events (
  telegram_id INTEGER NOT NULL, step TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (telegram_id, step));
CREATE TABLE bot_status (telegram_id INTEGER NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE user_activity (telegram_id INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (telegram_id, day));
CREATE TABLE reminder_deliveries (
  id INTEGER PRIMARY KEY, telegram_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'reminder',
  message_id INTEGER, delivered_on TEXT NOT NULL, acked_on TEXT);
`;

const queries = Object.fromEntries(
  readFileSync(new URL("./queries.sql", import.meta.url), "utf8")
    .split(/^-- name: /m)
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      return [chunk.slice(0, nl).trim(), chunk.slice(nl + 1)];
    }),
);

let db: Database;
let d1: string; // понедельник прошлой недели
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  d1 = (db.query("SELECT date('now', 'weekday 0', '-13 days') AS d").get() as any).d;
});

const day = (offset: number) =>
  (db.query("SELECT date(?, ?) AS d").get(d1, `${offset} days`) as any).d as string;
const ago = (days: number) =>
  (db.query("SELECT datetime('now', ?) AS d").get(`-${days} days`) as any).d as string;

const act = (id: number, d: string) => db.run("INSERT INTO user_activity VALUES (?, ?)", [id, d]);
const rem = (id: number, d: string, acked: string | null = null) =>
  db.run("INSERT INTO reminder_deliveries (telegram_id, delivered_on, acked_on) VALUES (?, ?, ?)", [id, d, acked]);
const came = (id: number, at: string, source = "none") =>
  db.run("INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (?, ?, ?)", [id, source, at]);

test("карточка квартала: на связи с недели 1 без зомби, новые отдельно, активация, два ограничителя", () => {
  const old = `${day(-30)} 12:00:00`;
  act(111111111, day(1));                           // свой аккаунт — не считается
  came(1, old); act(1, day(2));                     // активный
  came(2, old); rem(2, day(3), day(3));             // пассивный, нажал «Помню» — живой
  came(3, old); rem(3, day(3));                     // заблокировал через день
  db.run("INSERT INTO bot_status VALUES (3, 'kicked', ?)", [`${day(4)} 10:00:00`]);
  came(4, old); rem(4, day(3));                     // пассивный, 28 дней тишины — зомби
  came(5, old); rem(5, day(1)); act(5, day(5));     // и напоминание, и действие — один раз
  came(8, "2000-01-01 00:00:00", "legacy"); act(8, day(2)); // старый из переноса — считается
  came(6, `${day(-3)} 12:00:00`); act(6, day(0));   // новый: позапрошлая неделя, активирован
  db.run("INSERT INTO funnel_events VALUES (6, 'first_reminder_delivered', ?)", [`${day(-1)} 09:00:00`]);
  came(7, `${day(-5)} 12:00:00`);                   // новый, не активирован, не на связи
  came(9, `${day(2)} 12:00:00`); act(9, day(2));    // пришёл на прошлой неделе

  const r = db.query(queries.quarter_card_weekly!).get() as any;
  expect(r.in_touch).toBe(4);        // 1, 2, 5, 8
  expect(r.new_in_touch).toBe(2);    // 6, 9
  expect(r.activated).toBe(1);       // 6
  expect(r.activated_pct).toBe(50);  // 6 из 6 и 7
  expect(r.blocked_pct).toBe(25);    // 3 из 2, 3, 4, 5
  expect(r.zombie_pct).toBe(33);     // 4 из 2, 4, 5
});

test("бот, который не пишет первым: активные с недели 1 и блокировки среди них", () => {
  came(1, `${day(-30)} 12:00:00`); act(1, day(2));
  came(2, `${day(-30)} 12:00:00`); act(2, day(3));
  db.run("INSERT INTO bot_status VALUES (2, 'kicked', ?)", [`${day(9)} 10:00:00`]);
  came(3, `${day(1)} 12:00:00`); act(3, day(1));    // новый — не в метрике, но в знаменателе блокировок
  const r = db.query(queries.quarter_card_no_push!).get() as any;
  expect(r.active_week1).toBe(2);
  expect(r.blocked_pct).toBe(33);
});

test("пустая база: запросы выполняются, доли — NULL", () => {
  const r = db.query(queries.quarter_card_weekly!).get() as any;
  expect(r.in_touch).toBe(0);
  expect(r.activated_pct).toBeNull();
  expect(r.blocked_pct).toBeNull();
  expect(r.zombie_pct).toBeNull();
  const n = db.query(queries.quarter_card_no_push!).get() as any;
  expect(n.active_week1).toBe(0);
  expect(n.blocked_pct).toBeNull();
});
