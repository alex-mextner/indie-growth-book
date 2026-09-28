import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as e from "./economics";

// Цены для тестов — иллюстративные, не текущие цены какого-либо провайдера.
const PRICES: e.PriceTable = {
  version: "test",
  models: {
    small: { inputPerM: 1, outputPerM: 5, cachedInputPerM: 0.1, cacheWritePerM: 1.25 },
    stt: { inputPerM: 0, outputPerM: 0, audioPerMin: 0.006 },
  },
};

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

/** Человек пришёл daysAgo дней назад из source и прошёл шаги (в первый же час). */
function person(id: number, daysAgo: number, source: string, steps: string[]) {
  db.run(
    `INSERT INTO user_acquisition (telegram_id, first_source, first_seen_at)
     VALUES (?, ?, datetime('now', ?))`,
    [id, source, `-${daysAgo} days`],
  );
  for (const step of ["start", ...steps]) {
    db.run(`INSERT INTO funnel_events (telegram_id, step, at) VALUES (?, ?, datetime('now', ?, '+1 hour'))`, [
      id,
      step,
      `-${daysAgo} days`,
    ]);
  }
}

let req = 0;
/** n запросов человека по costEach долларов через dayOffset дней после daysAgo; callsPer вызовов API на запрос. */
function spend(id: number, daysAgo: number, dayOffset: number, n: number, costEach: number, callsPer = 1) {
  for (let i = 0; i < n; i++) {
    req++;
    for (let c = 0; c < callsPer; c++) {
      db.run(
        `INSERT INTO ai_usage (user_id, request_id, trigger, at, feature, model, cost_usd, price_version)
         VALUES (?, ?, 'user', datetime('now', ?, ?), 'parse', 'small', ?, 'test')`,
        [id, `r${req}`, `-${daysAgo} days`, `+${dayOffset} days`, costEach / callsPer],
      );
    }
  }
}

function pay(id: number, at: string, net: number, charge: string, refunded = false) {
  db.run(
    `INSERT INTO payments (telegram_id, paid_at, amount, currency, provider, charge_id, net_usd, refunded_at)
     VALUES (?, ${at}, 250, 'XTR', 'stars', ?, ?, ?)`,
    [id, charge, net, refunded ? "2026-01-01 00:00:00" : null],
  );
}

const q = (name: string) => db.query(queries[name]!).all() as any[];
const call = (over: Partial<e.Call> = {}): e.Call => ({
  userId: 1,
  requestId: "r1",
  trigger: "user",
  feature: "parse",
  model: "small",
  ...over,
});

test("costOf: вход, запись и чтение кэша, выход, аудио", () => {
  // 2000 входных × $1/M + 150 выходных × $5/M = 0.002 + 0.00075
  expect(e.costOf(PRICES.models.small!, { inputTokens: 2000, outputTokens: 150 })).toBeCloseTo(0.00275, 8);
  expect(e.costOf(PRICES.models.small!, { cachedTokens: 10_000 })).toBeCloseTo(0.001, 8);
  expect(e.costOf(PRICES.models.small!, { cacheWriteTokens: 1_000_000 })).toBeCloseTo(1.25, 8);
  expect(e.costOf({ inputPerM: 2, outputPerM: 10 }, { cachedTokens: 1_000_000 })).toBeCloseTo(2, 8);
  expect(e.costOf(PRICES.models.stt!, { audioSeconds: 90 })).toBeCloseTo(0.009, 8);
});

test("toUsage: у Anthropic вход уже без кэша, у OpenAI и Gemini кэш надо вычесть", () => {
  expect(
    e.toUsage("anthropic", {
      input_tokens: 500,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 3000,
      output_tokens: 150,
    }),
  ).toEqual({ inputTokens: 500, cacheWriteTokens: 1000, cachedTokens: 3000, outputTokens: 150 });
  expect(
    e.toUsage("openai", {
      input_tokens: 15000,
      input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 },
      output_tokens: 200,
    }),
  ).toEqual({ inputTokens: 0, cacheWriteTokens: 3000, cachedTokens: 12000, outputTokens: 200 });
  expect(
    e.toUsage("gemini", {
      promptTokenCount: 4000,
      cachedContentTokenCount: 3000,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 50,
      toolUsePromptTokenCount: 200,
    }),
  ).toEqual({ inputTokens: 1200, cachedTokens: 3000, outputTokens: 150 });
  expect(e.toUsage("openai", undefined)).toEqual({});
});

test("recordAiUsage: неизвестная модель — по самой дорогой цене и с priced = 0", () => {
  expect(e.recordAiUsage(db, PRICES, call(), { inputTokens: 2000, outputTokens: 150 })).toBeCloseTo(0.00275, 8);
  // 1000 входных: small — $0.001, stt — $0; берётся максимум
  expect(e.recordAiUsage(db, PRICES, call({ model: "new-model" }), { inputTokens: 1000 })).toBeCloseTo(0.001, 8);
  const rows = db.query("SELECT model, cost_usd, priced, price_version, trigger FROM ai_usage ORDER BY id").all() as any[];
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ price_version: "test", trigger: "user", priced: 1 });
  expect(rows[1]).toMatchObject({ priced: 0 });
  expect(q("missing_prices")).toEqual([{ model: "new-model", calls: 1, upper_bound_usd: 0.001 }]);
});

test("предохранитель видит и вызовы моделей без цены", () => {
  for (let i = 0; i < 3; i++) {
    e.recordAiUsage(db, PRICES, call({ model: "unknown", requestId: `u${i}` }), { outputTokens: 1_000_000 });
  }
  expect(e.dailySpendExceeded(db, 10)).toBe(true); // 3 × $5 по цене small
});

test("recordAiUsage не бросает исключение, если таблицы нет", () => {
  const empty = new Database(":memory:");
  const err = console.error;
  console.error = () => {};
  expect(() => e.recordAiUsage(empty, PRICES, call(), { inputTokens: 1 })).not.toThrow();
  console.error = err;
});

test("withAiUsage пишет журнал и при успехе, и при ошибке", async () => {
  const r = await e.withAiUsage(
    db,
    PRICES,
    call(),
    async () => ({ usage: { input_tokens: 2000, output_tokens: 150 } }),
    (x) => e.toUsage("anthropic", x.usage),
  );
  expect(r.usage.input_tokens).toBe(2000);
  await expect(
    e.withAiUsage(db, PRICES, call({ requestId: "r2" }), async () => {
      throw new Error("timeout");
    }, () => ({})),
  ).rejects.toThrow("timeout");
  const rows = db.query("SELECT status, cost_usd FROM ai_usage ORDER BY id").all() as any[];
  expect(rows[0].status).toBe("ok");
  expect(rows[0].cost_usd).toBeCloseTo(0.00275, 8);
  expect(rows[1]).toEqual({ status: "error", cost_usd: 0 });
  expect(e.userRequestsLast7d(db, 1)).toBe(1); // неудачный запрос в лимит не идёт
});

test("лимит считает запросы человека, а не вызовы API; системные не считаются", () => {
  spend(1, 3, 0, 20, 0.001, 3); // 20 запросов по 3 вызова
  db.run(
    `INSERT INTO ai_usage (user_id, request_id, trigger, at, feature, model, cost_usd, price_version)
     VALUES (1, 'digest1', 'system', datetime('now'), 'digest', 'small', 0.01, 'test')`,
  );
  expect(e.userRequestsLast7d(db, 1)).toBe(20);
  spend(2, 3, 0, 50, 0.001);
  spend(3, 3, 0, 49, 0.001, 2);
  expect(q("limit_hits_7d")[0].users_at_limit).toBe(1);
});

test("дневной предохранитель", () => {
  spend(1, 0, 0, 10, 0.5);
  expect(e.dailySpendExceeded(db, 4)).toBe(true);
  expect(e.dailySpendExceeded(db, 6)).toBe(false);
  expect(q("spend_today")[0].usd).toBeCloseTo(5, 2);
});

test("лимиты 10 в день и 50 в неделю: в среднем ~214 запросов за 30 дней", () => {
  expect(e.maxFreeRequests({ perDay: 10, perWeek: 50 })).toBeCloseTo(214.29, 1);
  expect(e.maxFreeRequests({ perDay: 1, perWeek: 50 })).toBe(30); // дневной лимит строже недельного
});

test("вклад платящего и безубыточность: Stars и внешняя оплата", () => {
  const common = { price: 5, taxShare: 0.06, refundShare: 0.02, payerCost: 1 };
  const stars = { ...common, feeShare: 0.35 };
  const ext = { ...common, feeShare: 0.03 };
  expect(e.netRevenue(stars)).toBeCloseTo(2.99, 2); // 5 × 0.65 × 0.92
  expect(e.payerContribution(stars)).toBeCloseTo(1.99, 2);
  expect(e.payerContribution(ext)).toBeCloseTo(3.46, 2); // 5 × 0.97 × 0.92 − 1
  const free = { freeUsers: 300, freeUserCost: 0.11, fixedMonthly: 10 };
  expect(e.breakEvenPayers({ ...stars, ...free })).toBe(22); // 43 / 1.99
  expect(e.breakEvenPayers({ ...ext, ...free })).toBe(13); // 43 / 3.46
  expect(e.breakEvenPayers({ ...stars, ...free, payerCost: 5 })).toBe(Infinity);
});

test("LTV платящего через вклад, маржа и окупаемость", () => {
  expect(e.grossMargin(5, 1.5)).toBeCloseTo(0.7, 8);
  expect(e.simpleLtv(1.99, 0.1)).toBeCloseTo(19.9, 8); // 10 месяцев жизни
  expect(e.simpleLtv(1.99, 0.2)).toBeCloseTo(9.95, 8); // при оттоке 20 % — 5 месяцев
  expect(e.simpleLtv(3.5, 0.01)).toBeCloseTo(84, 8); // упирается в горизонт 24 месяца
  expect(e.simpleLtv(3.5, 0)).toBeCloseTo(84, 8);
  expect(e.paybackMonths(84.4, 1.99)).toBeCloseTo(42.41, 2);
  expect(e.paybackMonths(84.4, 1.0)).toBeCloseTo(84.4, 2);
  expect(e.paybackMonths(80, 0)).toBe(Infinity);
});

test("себестоимость активного за 30 дней: активные из user_activity, свои аккаунты исключены", () => {
  for (let id = 1; id <= 10; id++) {
    spend(id, 5, 0, 1, 0.01);
    db.run(`INSERT INTO user_activity VALUES (?, date('now', '-5 days'))`, [id]);
  }
  db.run(`INSERT INTO user_activity VALUES (11, date('now', '-3 days'))`); // активен без ИИ
  db.run(`INSERT INTO user_activity VALUES (12, date('now', '-40 days'))`); // давно
  spend(111111111, 1, 0, 100, 0.01); // свой тестовый аккаунт
  db.run(`INSERT INTO user_activity VALUES (111111111, date('now', '-1 days'))`);
  db.run(
    `INSERT INTO ai_usage (user_id, request_id, trigger, at, feature, model, cost_usd, price_version)
     VALUES (3, 'd1', 'system', datetime('now', '-2 days'), 'digest', 'small', 0.05, 'test')`,
  );
  const [r] = q("cost_per_active_30d");
  expect(r.active_users).toBe(11);
  expect(r.ai_cost_usd).toBeCloseTo(0.15, 2);
  expect(r.user_triggered_usd).toBeCloseTo(0.1, 2);
  expect(r.system_triggered_usd).toBeCloseTo(0.05, 2);
  expect(r.cost_per_active_usd).toBeCloseTo(0.15 / 11, 4);
});

test("доля самых дорогих: только при 20+ пользователях", () => {
  for (let id = 1; id <= 10; id++) spend(id, 5, 0, 1, 0.01);
  expect(q("top_decile_share")[0].top10_pct).toBeNull();
  for (let id = 11; id <= 20; id++) spend(id, 5, 0, 1, 0.01);
  spend(20, 5, 0, 79, 0.01); // один тяжёлый: 0.8 из 0.99 плюс сосед по дециле 0.01
  expect(q("top_decile_share")[0].top10_pct).toBe(82);
});

test("стоимость по шагам воронки и по активации", () => {
  person(1, 10, "src_threads_bio", ["language_chosen", "timezone_set", "first_message_sent"]); // застрял
  spend(1, 10, 1, 12, 0.003, 2); // 12 запросов по 2 вызова
  person(2, 10, "src_threads_bio", [
    "language_chosen", "timezone_set", "first_message_sent", "first_event_created", "first_reminder_delivered",
  ]);
  spend(2, 10, 1, 4, 0.003);
  spend(2, 10, 8, 50, 0.003); // после первой недели — не считается
  person(3, 10, "src_threads_bio", ["language_chosen"]); // ушёл на языке, без запросов
  person(4, 3, "src_threads_bio", ["first_message_sent"]); // слишком свежий — вне когорты

  const stages = q("cost_by_stage");
  expect(stages.map((s) => s.stopped_at)).toEqual(["language_chosen", "first_message_sent", "first_reminder_delivered"]);
  expect(stages[0]).toMatchObject({ users: 1, avg_requests: 0, total_cost_usd: 0 });
  expect(stages[1]).toMatchObject({ users: 1, avg_requests: 12 });
  expect(stages[1].avg_cost_usd).toBeCloseTo(0.036, 4);
  expect(stages[2]).toMatchObject({ users: 1, avg_requests: 4 });

  const act = q("cost_by_activation");
  expect(act).toHaveLength(2);
  expect(act[0]).toMatchObject({ activated: 0, users: 2, avg_requests: 6 });
  expect(act[1]).toMatchObject({ activated: 1, users: 1, avg_requests: 4 });
});

test("CAC по каналу: на старт, на активированного и с ИИ первой недели", () => {
  db.run(`INSERT INTO marketing_spend VALUES ('src_tg_chanA_0927', datetime('now', '-20 days'), 40, 'посев')`);
  for (let id = 1; id <= 8; id++) {
    const steps =
      id <= 2 ? ["first_message_sent", "first_event_created", "first_reminder_delivered"] : ["first_message_sent"];
    person(id, 20, "src_tg_chanA_0927", steps);
    spend(id, 20, 0, 5, 0.01);
  }
  person(9, 20, "src_share", ["first_reminder_delivered"]); // бесплатный канал — не попадает
  const [r] = q("cac_by_source");
  expect(r).toMatchObject({ source: "src_tg_chanA_0927", spent_usd: 40, starts: 8, maturing: 0, activated: 2 });
  expect(r.cac_per_start).toBe(5);
  expect(r.cac_per_activated).toBe(20);
  expect(r.ai_first_week_usd).toBeCloseTo(0.4, 2);
  expect(r.full_cost_per_activated).toBeCloseTo(20.2, 2);
});

test("CAC не считается, пока пришедшие не «дозрели» 7 дней", () => {
  db.run(`INSERT INTO marketing_spend VALUES ('src_tg_chanB_0925', datetime('now', '-3 days'), 20, NULL)`);
  person(1, 10, "src_tg_chanB_0925", ["first_reminder_delivered"]);
  person(2, 2, "src_tg_chanB_0925", []);
  const [r] = q("cac_by_source");
  expect(r).toMatchObject({ starts: 2, maturing: 1, activated: 1 });
  expect(r.cac_per_activated).toBeNull();
  expect(r.full_cost_per_activated).toBeNull();
});

test("ARPPU, отток платящих и LTV по когортам", () => {
  const first = `datetime('now', 'start of month', '-7 months', '+2 days')`;
  const at = (d: number) => `datetime(${first}, '+${d} days')`;
  pay(1, at(0), 3.25, "c1");
  pay(1, at(30), 3.25, "c2");
  pay(1, at(60), 3.25, "c3");
  pay(2, at(0), 3.25, "c4");
  pay(3, at(0), 3.25, "c5");
  pay(3, at(30), 3.25, "c6");
  pay(3, at(31), 3.25, "c7", true); // возврат — не считается
  db.run(
    `INSERT INTO ai_usage (user_id, request_id, trigger, at, feature, model, cost_usd, price_version)
     VALUES (1, 'x', 'user', ${at(5)}, 'parse', 'small', 1, 'test')`,
  );
  pay(4, `datetime('now', '-3 days')`, 3.25, "c8"); // свежий платящий
  pay(0, `datetime('now', '-2 days')`, 3.25, "c10"); // псевдонимизированный — не считается
  db.run(
    `INSERT INTO payments (telegram_id, kind, paid_at, amount, currency, provider, charge_id, net_usd)
     VALUES (5, 'invoice', ${at(0)}, 30, 'USD', 'bank', 'inv1', 29.1)`,
  ); // счёт организатору — не подписка: не в оттоке и не в треугольнике

  const [a] = q("arppu_30d");
  expect(a).toMatchObject({ payers: 1, net_arppu_usd: 3.25 });

  const churn = q("payer_churn_monthly");
  const total = churn.reduce((s, r) => s + r.payments, 0);
  const lost = churn.reduce((s, r) => s + r.not_renewed, 0);
  expect(total).toBe(6);
  expect(lost).toBe(3); // 1 — после третьего, 2 — после первого, 3 — после второго

  const cohorts = q("cohort_ltv");
  const c = cohorts.find((r) => r.n === 3)!;
  // вклад = выручка после комиссии × (1 − налог 6 %) − ИИ
  expect(c.m0).toBeCloseTo((3 * 3.25 * 0.94 - 1) / 3, 2);
  expect(c.m1).toBeCloseTo((5 * 3.25 * 0.94 - 1) / 3, 2);
  expect(c.m2).toBeCloseTo((6 * 3.25 * 0.94 - 1) / 3, 2);
});

test("удаление по запросу: журнал и платежи псевдонимизируются", () => {
  spend(7, 1, 0, 3, 0.01);
  pay(7, `datetime('now')`, 3.25, "c9");
  e.deleteUserEconomics(db, 7);
  expect((db.query("SELECT COUNT(*) n FROM ai_usage WHERE user_id = 7").get() as any).n).toBe(0);
  expect((db.query("SELECT COUNT(*) n FROM payments WHERE telegram_id = 7").get() as any).n).toBe(0);
  expect((db.query("SELECT ROUND(SUM(cost_usd), 2) s FROM ai_usage").get() as any).s).toBeCloseTo(0.03, 2);
});

// ---------- Глава 5.5 ----------

const sub = (charge: string, stars = 250, extra: Partial<e.StarPayment> = {}): e.StarPayment => ({
  currency: "XTR",
  total_amount: stars,
  invoice_payload: `sub_${stars}`,
  telegram_payment_charge_id: charge,
  ...extra,
});
const unix = (sqlOffset: string) =>
  (db.query(`SELECT CAST(strftime('%s', 'now', ?) AS INTEGER) AS s`).get(sqlOffset) as { s: number }).s;

test("initPaymentsSchema: старая таблица payments из главы 2.4 получает expires_at, повторный вызов безопасен", () => {
  const old = new Database(":memory:");
  old.exec(`CREATE TABLE payments (telegram_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription',
    paid_at TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, provider TEXT NOT NULL,
    charge_id TEXT NOT NULL UNIQUE, net_usd REAL NOT NULL, refunded_at TEXT)`);
  old.run(`INSERT INTO payments VALUES (1, 'subscription', datetime('now', '-3 days'), 250, 'XTR', 'stars', 'old1', 3.25, NULL)`);
  e.initPaymentsSchema(old);
  e.initPaymentsSchema(old);
  const cols = (old.query("PRAGMA table_info(payments)").all() as { name: string }[]).map((c) => c.name);
  expect(cols).toContain("expires_at");
  expect(e.hasActiveSubscription(old, 1)).toBe(true); // старая строка без expires_at: 30 дней от платежа
  expect(e.recordStarPayment(old, 2, { ...sub("n1"), subscription_expiration_date: unix("+30 days") })).toBe(true);
  e.recordPaywallView(old, 2, 250, "seen");
  expect((old.query("SELECT COUNT(*) n FROM paywall_views").get() as any).n).toBe(1);
  e.initPaymentsSchema(db); // свежая база из schema.sql: столбец и таблица уже есть — ничего не ломается
  expect(e.recordStarPayment(db, 3, sub("n2"))).toBe(true);
});

test("recordStarPayment: подписка, 0,013 $ за звезду, срок из subscription_expiration_date, без дублей", () => {
  const exp = unix("+30 days");
  expect(e.recordStarPayment(db, 11, { ...sub("ch1"), subscription_expiration_date: exp })).toBe(true);
  expect(e.recordStarPayment(db, 11, sub("ch1"))).toBe(false); // тот же update пришёл ещё раз
  const rows = db.query("SELECT *, CAST(strftime('%s', expires_at) AS INTEGER) AS exp FROM payments WHERE telegram_id = 11").all() as any[];
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({ kind: "subscription", amount: 250, currency: "XTR", provider: "stars", exp });
  expect(rows[0].net_usd).toBeCloseTo(3.25, 6);
});

test("recordStarPayment: разовая покупка без срока, продление, удержание за темы", () => {
  e.recordStarPayment(db, 12, { ...sub("ch2", 100), invoice_payload: "pack_100" });
  e.recordStarPayment(db, 12, { ...sub("ch3", 250), invoice_payload: "x", is_recurring: true });
  e.recordStarPayment(db, 12, sub("ch4"), { extraFeeShare: 0.15 });
  const rows = db.query("SELECT charge_id, kind, net_usd, expires_at FROM payments ORDER BY charge_id").all() as any[];
  expect(rows.map((r) => r.kind)).toEqual(["one_off", "subscription", "subscription"]);
  expect(rows[0].expires_at).toBeNull();
  expect(rows[1].expires_at).not.toBeNull(); // нет subscription_expiration_date — 30 дней от платежа
  expect(rows[2].net_usd).toBeCloseTo(250 * 0.013 * 0.85, 6);
});

test("recordStarPayment не принимает другую валюту", () => {
  expect(() => e.recordStarPayment(db, 13, { ...sub("ch5"), currency: "RUB" })).toThrow();
});

test("доступ по expires_at: с запасом в сутки, без возвращённых и разовых", () => {
  e.recordStarPayment(db, 14, { ...sub("a"), subscription_expiration_date: unix("+10 days") });
  expect(e.hasActiveSubscription(db, 14)).toBe(true);
  expect(e.subscriptionUntil(db, 14)).not.toBeNull();
  e.recordStarPayment(db, 15, { ...sub("b"), subscription_expiration_date: unix("-12 hours") });
  expect(e.hasActiveSubscription(db, 15)).toBe(true); // продление может опоздать
  e.recordStarPayment(db, 16, { ...sub("c"), subscription_expiration_date: unix("-2 days") });
  expect(e.hasActiveSubscription(db, 16)).toBe(false);
  e.recordStarPayment(db, 17, { ...sub("d", 100), invoice_payload: "pack_100" });
  expect(e.hasActiveSubscription(db, 17)).toBe(false);
  pay(18, `datetime('now', '-31 days')`, 3.25, "old");
  expect(e.hasActiveSubscription(db, 18)).toBe(false);
});

test("возврат: отмечается один раз и выпадает из ARPPU и доступа", () => {
  e.recordStarPayment(db, 19, sub("ch6"));
  expect(e.markRefunded(db, "ch6")).toBe(true);
  expect(e.markRefunded(db, "ch6")).toBe(false);
  expect(e.hasActiveSubscription(db, 19)).toBe(false);
  expect(q("arppu_30d")[0].payers).toBe(0);
  expect(q("refund_share_30d")[0]).toMatchObject({ payments: 1, refunded: 1, refund_pct: 100 });
});

test("checkCheckout: чужая цена, метка, валюта и вторая подписка — отказ; продление в последние сутки — можно", () => {
  const prices = new Set([150, 250]);
  const q250 = { currency: "XTR", total_amount: 250, invoice_payload: "sub_250" };
  expect(e.checkCheckout(db, 20, q250, prices)).toEqual({ ok: true });
  expect(e.checkCheckout(db, 20, { ...q250, total_amount: 300, invoice_payload: "sub_300" }, prices).ok).toBe(false);
  expect(e.checkCheckout(db, 20, { ...q250, invoice_payload: "sub_150" }, prices).ok).toBe(false);
  expect(e.checkCheckout(db, 20, { ...q250, currency: "USD" }, prices).ok).toBe(false);
  e.recordStarPayment(db, 20, { ...sub("s1"), subscription_expiration_date: unix("+20 days") });
  const busy = e.checkCheckout(db, 20, q250, prices);
  expect(busy.ok).toBe(false);
  if (!busy.ok) expect(busy.error).toContain("уже активна");
  e.recordStarPayment(db, 21, { ...sub("s2"), subscription_expiration_date: unix("+6 hours") });
  expect(e.checkCheckout(db, 21, q250, prices).ok).toBe(true);
});

test("воронка по неделям и ценам: люди, а не показы; оплата по той же цене за 7 дней; без своих и возвратов", () => {
  const view = (id: number, stars: number, action: string, when: string) =>
    db.run(`INSERT INTO paywall_views (telegram_id, at, stars, action) VALUES (?, datetime('now', 'weekday 3', '-14 days', ?), ?, ?)`, [
      id, when, stars, action,
    ]);
  for (const id of [31, 32, 33, 34, 111111111]) view(id, 250, "seen", "+0 hours");
  view(31, 250, "seen", "+2 hours"); // второй показ тому же человеку
  for (const id of [31, 32, 33]) view(id, 250, "clicked", "+1 hours");
  view(35, 150, "seen", "+7 days"); // следующая неделя, другая цена
  const pays = (id: number, stars: number, charge: string, when: string, refunded = false) =>
    db.run(`INSERT INTO payments (telegram_id, kind, paid_at, amount, currency, provider, charge_id, net_usd, refunded_at)
            VALUES (?, 'subscription', datetime('now', 'weekday 3', '-14 days', ?), ?, 'XTR', 'stars', ?, ?, ?)`,
      [id, when, stars, charge, stars * 0.013, refunded ? "2026-01-01 00:00:00" : null]);
  pays(31, 250, "w1", "+3 hours");
  pays(31, 250, "w1b", "+4 hours"); // тот же человек
  pays(32, 250, "w2", "+3 hours", true); // возврат
  pays(33, 250, "w3", "+9 days"); // позже 7 дней
  pays(35, 150, "w5", "+7 days", false);
  pays(111111111, 250, "wme", "+3 hours");
  const rows = q("paywall_funnel_by_week");
  expect(rows.length).toBe(2);
  expect(rows[0]).toMatchObject({ stars: 250, seen: 4, clicked: 3, paid: 1 });
  expect(rows[1]).toMatchObject({ stars: 150, seen: 1, clicked: 0, paid: 1 });
});
