import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as e from "./experiments";

const queries = Object.fromEntries(
  readFileSync(new URL("./queries.sql", import.meta.url), "utf8")
    .split(/^-- name: /m)
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      return [chunk.slice(0, nl).trim(), chunk.slice(nl + 1)];
    }),
) as Record<string, string>;

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
});

const round1 = (x: number) => Math.round(x * 1000) / 10;

describe("разбиение", () => {
  test("группа детерминирована и зависит от имени эксперимента", () => {
    expect(e.assignVariant("tz_buttons", 123456789)).toBe(e.assignVariant("tz_buttons", 123456789));
    let same = 0;
    for (let id = 1; id <= 2000; id++) if (e.assignVariant("x1", id) === e.assignVariant("x2", id)) same++;
    expect(same).toBeGreaterThan(900); // независимо: совпадает примерно половина
    expect(same).toBeLessThan(1100);
  });

  test("доли групп близки к заданным", () => {
    let b = 0;
    for (let id = 100_000_000; id < 100_010_000; id++) if (e.assignVariant("tz_buttons", id) === "B") b++;
    expect(b).toBeGreaterThan(4800);
    expect(b).toBeLessThan(5200);
    let b20 = 0;
    for (let id = 1; id <= 10_000; id++) if (e.assignVariant("fake_door", id, 0.2) === "B") b20++;
    expect(b20).toBeGreaterThan(1850);
    expect(b20).toBeLessThan(2150);
  });

  test("hash32: первые 4 байта SHA-256", () => {
    expect(e.hash32("abc")).toBe(0xba7816bf); // SHA-256("abc") = ba7816bf…
  });

  test("assign пишет группу один раз и потом возвращает записанную", () => {
    expect(e.assign(db, "tz", 1, "B")).toBe("B");
    expect(e.assign(db, "tz", 1, "A")).toBe("B");
    const n = db.query("SELECT COUNT(*) n FROM experiment_assignments").get() as any;
    expect(n.n).toBe(1);
    expect(e.assign(db, "tz", 2)).toBe(e.assignVariant("tz", 2));
  });

  test("чередование по неделям с понедельника", () => {
    const start = "2026-10-05 09:00:00"; // понедельник
    expect(e.variantByWeek(start, "2026-10-05 00:10:00")).toBe("A");
    expect(e.variantByWeek(start, "2026-10-11 23:59:59")).toBe("A"); // воскресенье той же недели
    expect(e.variantByWeek(start, "2026-10-12 00:00:00")).toBe("B");
    expect(e.variantByWeek(start, "2026-10-19")).toBe("A");
    expect(e.variantByWeek(start, "2026-10-28 12:00:00")).toBe("B");
    expect(() => e.variantByWeek(start, "2026-09-28")).toThrow();
    const abba = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"].map((d) =>
      e.variantByWeek(start, d, "ABBA"),
    );
    expect(abba.join("")).toBe("ABBAA");
  });

  test("isRunning смотрит на карточку", () => {
    expect(e.isRunning(db, "tz")).toBe(false);
    db.run(
      `INSERT INTO experiments (name, hypothesis, metric_step, decision_rule, min_per_arm, started_at)
       VALUES ('tz', 'h', 'timezone_set', 'r', 84, datetime('now', '-1 day'))`,
    );
    expect(e.isRunning(db, "tz")).toBe(true);
    db.run("UPDATE experiments SET ended_at = datetime('now', '-1 minute') WHERE name = 'tz'");
    expect(e.isRunning(db, "tz")).toBe(false);
  });
});

describe("интервалы", () => {
  test("Уилсон: сверено с statsmodels proportion_confint(method='wilson')", () => {
    const w = e.wilson(61, 102);
    expect(w.low).toBeCloseTo(0.501007, 5);
    expect(w.high).toBeCloseTo(0.687955, 5);
    const z = e.wilson(0, 10);
    expect(z.low).toBe(0);
    expect(z.high).toBeCloseTo(0.277533, 5);
  });

  test("Ньюкомб: сверено с statsmodels confint_proportions_2indep(method='newcomb')", () => {
    const d = e.diffInterval(61, 102, 70, 98); // pB − pA
    expect(d.low).toBeCloseTo(-0.015427, 5);
    expect(d.high).toBeCloseTo(0.242022, 5);
    const g = e.diffInterval(21, 102, 24, 98);
    expect(g.low).toBeCloseTo(-0.07659, 4);
    expect(g.high).toBeCloseTo(0.154254, 5);
  });

  test("числа из иллюстраций главы", () => {
    const r = (i: e.Interval) => [round1(i.p), round1(i.low), round1(i.high)];
    // эксперимент: прошли пояс, активация, блокировки
    expect(r(e.wilson(99, 203))).toEqual([48.8, 42.0, 55.6]);
    expect(r(e.wilson(112, 197))).toEqual([56.9, 49.9, 63.6]);
    expect(r(e.diffInterval(99, 203, 112, 197))).toEqual([8.1, -1.7, 17.6]);
    expect(r(e.wilson(43, 203))).toEqual([21.2, 16.1, 27.3]);
    expect(r(e.wilson(48, 197))).toEqual([24.4, 18.9, 30.8]);
    expect(r(e.diffInterval(43, 203, 48, 197))).toEqual([3.2, -5.0, 11.4]);
    expect(r(e.wilson(5, 203))).toEqual([2.5, 1.1, 5.6]);
    expect(r(e.wilson(4, 197))).toEqual([2.0, 0.8, 5.1]);
    expect(r(e.diffInterval(5, 203, 4, 197))).toEqual([-0.4, -3.8, 2.9]);
    // полуширина при 154 в группе и 1 500 в группе
    expect(r(e.diffInterval(77, 154, 77, 154))).toEqual([0, -11.0, 11.0]);
    expect(r(e.diffInterval(750, 1500, 750, 1500))).toEqual([0, -3.6, 3.6]);
    // до и после: без посева и с посевом
    expect(r(e.diffInterval(49, 99, 97, 151))).toEqual([14.7, 2.2, 26.8]);
    expect(round1(e.diffInterval(49 + 40, 217, 97, 151).p)).toBe(23.2);
    expect([e.pct(49 / 99), e.pct(40 / 118), e.pct(97 / 151)]).toEqual([49.5, 33.9, 64.2]);
    // обещание главы 2.3: неделя 1 до и после (20 из 99 против 42 из 151)
    expect(r(e.diffInterval(20, 99, 42, 151))).toEqual([7.6, -3.5, 17.8]);
  });

  test("правило решения", () => {
    const card = { harm: -0.15, minPerArm: 154 };
    expect(e.decide({ xA: 99, nA: 203, xB: 112, nB: 197 }, card)).toBe("tie");
    expect(e.decide({ xA: 99, nA: 140, xB: 112, nB: 150 }, card)).toBe("too_early");
    expect(e.decide({ xA: 60, nA: 200, xB: 120, nB: 200 }, card)).toBe("ship");
    expect(e.decide({ xA: 120, nA: 200, xB: 60, nB: 200 }, card)).toBe("rollback");
    // интервал накрывает ноль, но большой вред не исключён: откат
    expect(e.decide({ xA: 20, nA: 40, xB: 17, nB: 40 })).toBe("rollback");
    // разбиение сломано: 250 против 150 при 50/50
    expect(e.decide({ xA: 100, nA: 250, xB: 70, nB: 150 }, card)).toBe("check_split");
  });

  test("проверка разбиения", () => {
    expect(e.splitLooksBroken(203, 197)).toBe(false);
    expect(e.splitLooksBroken(220, 180)).toBe(false); // |40| не больше 3·√400 = 60
    expect(e.splitLooksBroken(230, 170)).toBe(false); // ровно 60 — ещё не больше
    expect(e.splitLooksBroken(231, 169)).toBe(true);
  });

  test("досрочная остановка по блокировкам", () => {
    expect(e.guardrailStop({ xA: 4, nA: 150, xB: 3, nB: 150 })).toBe(false); // «вдвое» на малых числах — не повод
    expect(e.guardrailStop({ xA: 2, nA: 150, xB: 8, nB: 150 })).toBe(false); // меньше 10 событий в B
    expect(e.guardrailStop({ xA: 2, nA: 150, xB: 16, nB: 150 })).toBe(true);
    expect(e.guardrailStop({ xA: 8, nA: 150, xB: 12, nB: 150 })).toBe(false); // интервал накрывает ноль
  });

  test("фальшивая дверь: правило по границам Уилсона", () => {
    expect(e.fakeDoorDecision(0, 40)).toBe("not_now"); // верхняя 8,8 %
    expect(e.fakeDoorDecision(1, 40)).toBe("wait");
    expect(e.fakeDoorDecision(2, 40)).toBe("wait"); // 1,4–16,5 %: спрос не исключён и не доказан
    expect(e.fakeDoorDecision(5, 40)).toBe("build"); // нижняя 5,5 %
    expect(e.fakeDoorDecision(2, 80)).toBe("not_now"); // верхняя 8,7 %
    expect(e.fakeDoorDecision(3, 80)).toBe("not_now"); // неясно и при 80 — не в этом квартале
    expect(e.fakeDoorDecision(8, 80)).toBe("build"); // нижняя 5,2 %
    expect(e.fakeDoorDecision(7, 80)).toBe("not_now");
  });

  test("критерий знаков", () => {
    expect(e.signTestP(2, 2)).toBe(0.25);
    expect(e.signTestP(5, 5)).toBe(1 / 32);
    expect(e.signTestP(4, 5)).toBe(6 / 32);
    expect(e.signTestP(0, 3)).toBe(1);
  });
});

describe("сколько людей нужно", () => {
  test("квантили нормального распределения", () => {
    expect(e.normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(e.normInv(0.8)).toBeCloseTo(0.841621, 5);
    expect(e.normInv(0.01)).toBeCloseTo(-2.326348, 5);
    expect(e.normInv(0.5)).toBeCloseTo(0, 9);
  });

  test("правило Лера: пример ван Белле и таблица главы", () => {
    expect(e.lehrPerArm(0.3, 0.1)).toBe(64); // van Belle, разд. 2.9
    expect(e.lehrPerArm(0.2, 0.25)).toBe(1116);
    expect(e.lehrPerArm(0.2, 0.3)).toBe(300);
    expect(e.lehrPerArm(0.2, 0.4)).toBe(84);
    expect(e.lehrPerArm(0.6, 0.8)).toBe(84);
    expect(e.lehrPerArm(0.49, 0.65)).toBe(154);
    expect(e.lehrPerArm(0.21, 0.28)).toBe(604);
  });

  test("точная формула близка к правилу", () => {
    expect(e.sampleSizePerArm(0.2, 0.25)).toBe(1094);
    expect(e.sampleSizePerArm(0.2, 0.3)).toBe(294);
    expect(e.sampleSizePerArm(0.6, 0.8)).toBe(82);
    expect(e.sampleSizePerArm(0.2, 0.4)).toBe(82);
    // калькулятор Эвана Миллера (дисперсия по базовой доле, округление до целого): 1 030, 263, 67
    expect([0.05, 0.1, 0.2].map((d) => Math.round(e.sampleSizeBaselineVariance(0.2, d)))).toEqual([1030, 263, 67]);
  });
});

describe("запросы из queries.sql", () => {
  function person(id: number, daysAgo: number, source: string, steps: string[], variant?: e.Variant) {
    db.run(
      `INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at) VALUES (?, ?, datetime('now', ?))`,
      [id, source, `-${daysAgo} days`],
    );
    for (const [i, step] of ["start", ...steps].entries()) {
      db.run(`INSERT INTO funnel_events (telegram_id, step, at) VALUES (?, ?, datetime('now', ?, ?))`, [
        id,
        step,
        `-${daysAgo} days`,
        `+${i + 1} minutes`,
      ]);
    }
    if (variant) {
      db.run(
        `INSERT INTO experiment_assignments (experiment, telegram_id, variant, assigned_at)
         VALUES ('tz', ?, ?, datetime('now', ?))`,
        [id, variant, `-${daysAgo} days`],
      );
    }
  }
  const card = (ended?: string) =>
    db.run(
      `INSERT INTO experiments (name, hypothesis, metric_step, decision_rule, min_per_arm, started_at, ended_at)
       VALUES ('tz', 'h', 'timezone_set', 'r', 84, datetime('now', '-30 days'), ?)`,
      [ended ?? null],
    );

  test("experiment_by_variant: только дозревшие, без своих, до конца эксперимента", () => {
    card();
    person(1, 10, "none", ["timezone_set", "first_reminder_delivered"], "A");
    person(2, 10, "none", [], "A");
    person(3, 10, "none", ["timezone_set"], "B");
    person(4, 3, "none", ["timezone_set"], "B"); // не дозрел
    person(111111111, 10, "none", ["timezone_set"], "B"); // свой аккаунт
    db.run(`INSERT INTO bot_status VALUES (2, 'kicked', datetime('now', '-9 days'))`);
    const rows = db.query(queries.experiment_by_variant).all({ ":experiment": "tz", ":step": "timezone_set" }) as any[];
    expect(rows).toEqual([
      { variant: "A", users: 2, hit: 1, activated: 1, blocked: 1 },
      { variant: "B", users: 1, hit: 1, activated: 0, blocked: 0 },
    ]);
  });

  test("experiment_by_variant: после ended_at новые люди не считаются", () => {
    card();
    db.run("UPDATE experiments SET ended_at = datetime('now', '-15 days')");
    person(1, 20, "none", ["timezone_set"], "A");
    person(2, 10, "none", ["timezone_set"], "A"); // пришёл после конца
    const rows = db.query(queries.experiment_by_variant).all({ ":experiment": "tz", ":step": "timezone_set" }) as any[];
    expect(rows).toEqual([{ variant: "A", users: 1, hit: 1, activated: 0, blocked: 0 }]);
  });

  test("before_after: периоды, каналы, сутки вокруг изменения выброшены", () => {
    person(1, 20, "src_threads_bio", ["timezone_set"]);
    person(2, 20, "src_tg_chanA_0927", []);
    person(3, 10, "src_share", ["timezone_set"]);
    person(4, 14, "none", ["timezone_set"]); // в сутках вокруг изменения
    person(5, 2, "none", ["timezone_set"]); // не дозрел
    const changeAt = (db.query("SELECT datetime('now', '-14 days') t").get() as any).t;
    const rows = db.query(queries.before_after).all({ ":change_at": changeAt, ":step": "timezone_set" }) as any[];
    expect(rows).toEqual([
      { period: "1 до", channel: "остальные", users: 1, hit: 1 },
      { period: "1 до", channel: "посевы", users: 1, hit: 0 },
      { period: "2 после", channel: "приглашения", users: 1, hit: 1 },
    ]);
  });

  test("by_week: понедельник (день переключения) выброшен; stuck_paths", () => {
    const at = (id: number, v: e.Variant, when: string, steps: string[]) => {
      db.run(`INSERT INTO experiment_assignments VALUES ('tz', ?, ?, ?)`, [id, v, when]);
      for (const [i, step] of ["start", ...steps].entries())
        db.run(`INSERT INTO funnel_events VALUES (?, ?, datetime(?, ?))`, [id, step, when, `+${i + 1} minutes`]);
    };
    at(1, "A", "2026-09-01 10:00:00", ["language_chosen"]); // вторник
    at(2, "B", "2026-09-08 10:00:00", ["language_chosen", "timezone_set"]); // вторник
    at(3, "B", "2026-09-07 10:00:00", ["timezone_set"]); // понедельник — выброшен
    const weeks = db.query(queries.by_week).all({ ":experiment": "tz", ":step": "timezone_set" }) as any[];
    expect(weeks).toEqual([
      { week: "2026-08-31", variant: "A", users: 1, hit: 0 },
      { week: "2026-09-07", variant: "B", users: 1, hit: 1 },
    ]);
    const stuck = db.query(queries.stuck_paths).all({ ":experiment": "tz", ":step": "timezone_set" }) as any[];
    expect(stuck).toEqual([{ variant: "A", telegram_id: 1, path: "start → language_chosen" }]);
  });

  test("fake_door: первое нажатие на человека, свои аккаунты не в счёт", () => {
    const step = (id: number, s: string) =>
      db.run(`INSERT OR IGNORE INTO funnel_events VALUES (?, ?, datetime('now'))`, [id, s]);
    for (let id = 1; id <= 40; id++) step(id, "fake_door_seen");
    step(1, "fake_door_clicked");
    step(1, "fake_door_clicked"); // второе нажатие того же человека не пишется
    step(2, "fake_door_clicked");
    step(111111111, "fake_door_seen");
    step(111111111, "fake_door_clicked");
    const r = db.query(queries.fake_door).get() as any;
    expect(r).toEqual({ seen: 40, clicked: 2 });
    expect(round1(e.wilson(2, 40).high)).toBe(16.5);
  });

  test("удаление по запросу", () => {
    person(1, 12, "none", [], "A");
    db.query(queries.delete_user_experiments).run({ ":telegram_id": 1 });
    const n = db.query("SELECT COUNT(*) n FROM experiment_assignments").get() as any;
    expect(n.n).toBe(0);
  });
});
