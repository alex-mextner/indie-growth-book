// Код к главе 2.4 книги «Из продукта в бизнес».
// Bun + bun:sqlite. Цены моделей сюда не зашиты: таблицу цен передаёт вызывающий код.
import type { Database } from "bun:sqlite";

/** Цена одной модели в долларах. Токены — за миллион, аудио — за минуту. */
export type Price = {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number; // чтение из кэша; если не задана — как обычный вход
  cacheWritePerM?: number; // запись в кэш; если не задана — как обычный вход
  audioPerMin?: number;
};

/** Таблица цен с датой: цены меняются, и каждая строка журнала помнит, по какой таблице посчитана. */
export type PriceTable = { version: string; models: Record<string, Price> };

/** Токены одного вызова. inputTokens — только вход по полной цене, без кэша. */
export type Usage = {
  inputTokens?: number;
  cacheWriteTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
};

/**
 * Привести поле usage из ответа провайдера к Usage. Поля проверены 27.09.2026:
 * - anthropic (Messages API): input_tokens уже без кэша; cache_creation_input_tokens, cache_read_input_tokens.
 * - openai (Responses API): input_tokens включает и чтение, и запись кэша
 *   (input_tokens_details.cached_tokens / cache_write_tokens) — вычитаем оба.
 * - gemini (generateContent): promptTokenCount включает кэш (cachedContentTokenCount);
 *   toolUsePromptTokenCount считаем входом, thoughtsTokenCount оплачивается как выход.
 */
export function toUsage(provider: "anthropic" | "openai" | "gemini", u: any): Usage {
  if (!u) return {};
  if (provider === "anthropic") {
    return {
      inputTokens: u.input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      cachedTokens: u.cache_read_input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
    };
  }
  if (provider === "openai") {
    const cached = u.input_tokens_details?.cached_tokens ?? 0;
    const written = u.input_tokens_details?.cache_write_tokens ?? 0;
    return {
      inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached - written),
      cacheWriteTokens: written,
      cachedTokens: cached,
      outputTokens: u.output_tokens ?? 0,
    };
  }
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0) - cached),
    cachedTokens: cached,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

/** Стоимость одного вызова по цене модели. */
export function costOf(price: Price, u: Usage): number {
  return (
    ((u.inputTokens ?? 0) * price.inputPerM +
      (u.cacheWriteTokens ?? 0) * (price.cacheWritePerM ?? price.inputPerM) +
      (u.cachedTokens ?? 0) * (price.cachedInputPerM ?? price.inputPerM) +
      (u.outputTokens ?? 0) * price.outputPerM) /
      1_000_000 +
    ((u.audioSeconds ?? 0) / 60) * (price.audioPerMin ?? 0)
  );
}

export type Call = {
  userId: number;
  requestId: string; // одно сообщение человека — один requestId на все вызовы, например String(ctx.update.update_id)
  trigger: "user" | "system";
  feature: string;
  model: string;
};

/** Оценка сверху для модели без цены: самая дорогая цена из таблицы, чтобы предохранитель не пропустил расход. */
export function fallbackCost(prices: PriceTable, u: Usage): number {
  return Math.max(0, ...Object.values(prices.models).map((p) => costOf(p, u)));
}

/**
 * Записать вызов модели в журнал. Никогда не бросает исключение в код бота.
 * Модель без цены пишется по самой дорогой цене из таблицы и с priced = 0 — её покажет missing_prices.
 */
export function recordAiUsage(
  db: Database,
  prices: PriceTable,
  call: Call,
  usage: Usage,
  status: "ok" | "error" = "ok",
): number {
  const price = prices.models[call.model];
  const cost = price ? costOf(price, usage) : fallbackCost(prices, usage);
  try {
    db.run(
      `INSERT INTO ai_usage (user_id, request_id, trigger, at, feature, model, status,
         input_tokens, cache_write_tokens, cached_tokens, output_tokens, audio_seconds,
         cost_usd, priced, price_version)
       VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        call.userId,
        call.requestId,
        call.trigger,
        call.feature,
        call.model,
        status,
        usage.inputTokens ?? 0,
        usage.cacheWriteTokens ?? 0,
        usage.cachedTokens ?? 0,
        usage.outputTokens ?? 0,
        usage.audioSeconds ?? 0,
        cost,
        price ? 1 : 0,
        prices.version,
      ],
    );
  } catch (e) {
    console.error("ai_usage: запись не удалась", e); // учёт не должен ронять ответ пользователю
  }
  return cost;
}

/**
 * Обёртка вокруг вызова модели: пишет журнал в finally — и при успехе, и при ошибке.
 * `getUsage` достаёт Usage из ответа (например, r => toUsage("anthropic", r.usage)).
 * Если ответа нет (сеть, таймаут), пишется строка с нулевыми токенами и status = 'error'.
 */
export async function withAiUsage<T>(
  db: Database,
  prices: PriceTable,
  call: Call,
  run: () => Promise<T>,
  getUsage: (r: T) => Usage,
): Promise<T> {
  let result: T | undefined;
  let ok = false;
  try {
    result = await run();
    ok = true;
    return result;
  } finally {
    let usage: Usage = {};
    try {
      if (result !== undefined) usage = getUsage(result);
    } catch {
      /* usage не разобрался — пишем нули */
    }
    recordAiUsage(db, prices, call, usage, ok ? "ok" : "error");
  }
}

/** Сколько запросов, сделанных человеком, за последние 7 дней: для недельного лимита. Неудачные не считаются. */
export function userRequestsLast7d(db: Database, userId: number): number {
  const r = db
    .query(
      `SELECT COUNT(DISTINCT request_id) AS n FROM ai_usage
       WHERE user_id = ? AND trigger = 'user' AND status = 'ok' AND at >= datetime('now', '-7 days')`,
    )
    .get(userId) as { n: number };
  return r.n;
}

/** Общий предохранитель: потрачено ли сегодня (UTC) больше дневного потолка. */
export function dailySpendExceeded(db: Database, capUsd: number): boolean {
  const r = db
    .query(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE at >= date('now')`)
    .get() as { usd: number };
  return r.usd >= capUsd;
}

/**
 * Удаление по запросу пользователя. Журнал ИИ и платежи псевдонимизируются (идентификатор → 0), а не удаляются:
 * суммы нужны для сверки со счётами, платежи — для возвратов и отчётности. Платёж по charge_id всё ещё можно
 * найти у провайдера, поэтому это псевдонимизация, а не анонимизация. Проверьте требования своего закона;
 * это не юридическая консультация. Остальные таблицы чистит deleteUserTracking из examples/tracking.
 */
export function deleteUserEconomics(db: Database, userId: number) {
  db.transaction(() => {
    db.run("UPDATE ai_usage SET user_id = 0 WHERE user_id = ?", [userId]);
    db.run("UPDATE payments SET telegram_id = 0 WHERE telegram_id = ?", [userId]);
  })();
}

/** Сколько запросов к ИИ бесплатный пользователь может сделать за `days` дней: в среднем при двух лимитах. */
export function maxFreeRequests(limits: { perDay: number; perWeek: number }, days = 30): number {
  return Math.min(limits.perDay * days, (limits.perWeek * days) / 7);
}

/** Сколько доходит с одного платежа: цена × (1 − комиссия) × (1 − налог − возвраты). */
export function netRevenue(p: { price: number; feeShare: number; taxShare: number; refundShare: number }): number {
  return p.price * (1 - p.feeShare) * (1 - p.taxShare - p.refundShare);
}

/** Вклад платящего в месяц: чистая выручка минус его собственные затраты на ИИ. */
export function payerContribution(p: {
  price: number;
  feeShare: number;
  taxShare: number;
  refundShare: number;
  payerCost: number;
}): number {
  return netRevenue(p) - p.payerCost;
}

/** Сколько платящих нужно, чтобы покрыть бесплатных и постоянные расходы за месяц. Всё — в $ в месяц. */
export function breakEvenPayers(p: {
  price: number; // цена подписки
  feeShare: number; // доля комиссии платёжного канала, 0..1
  taxShare: number; // налог, доля от полученного
  refundShare: number; // доля возвратов
  payerCost: number; // себестоимость платящего (ИИ и прочее переменное)
  freeUsers: number;
  freeUserCost: number; // себестоимость бесплатного
  fixedMonthly: number; // сервер, домен и прочее, что не растёт с числом людей
}): number {
  const perPayer = payerContribution(p);
  if (perPayer <= 0) return Infinity; // каждый платящий сам в минусе: безубыточности нет
  return Math.ceil((p.freeUsers * p.freeUserCost + p.fixedMonthly) / perPayer);
}

/** Валовая маржа: доля выручки, которая остаётся после себестоимости обслуживания. */
export function grossMargin(revenue: number, costOfService: number): number {
  return revenue > 0 ? (revenue - costOfService) / revenue : 0;
}

/**
 * Простой LTV платящего: вклад в месяц × min(1 / отток платящих; горизонт).
 * Вклад = ARPPU × доля вклада (после комиссии, налога, возвратов и ИИ). ARPPU — доход на ПЛАТЯЩЕГО
 * (у Скока — ARPA), отток — тоже платящих. Не смешивайте с ARPU по всем.
 */
export function simpleLtv(monthlyContribution: number, payerMonthlyChurn: number, horizonMonths = 24): number {
  const lifetime = payerMonthlyChurn > 0 ? Math.min(1 / payerMonthlyChurn, horizonMonths) : horizonMonths;
  return monthlyContribution * lifetime;
}

/** Срок окупаемости в месяцах: CAC платящего ÷ вклад платящего в месяц. */
export function paybackMonths(cacPerPayer: number, monthlyContribution: number): number {
  return monthlyContribution > 0 ? cacPerPayer / monthlyContribution : Infinity;
}

// ---------- Глава 5.5: платежи звёздами ----------

/**
 * Сколько долларов Telegram засчитывает разработчику за одну звезду при выводе через Fragment
 * (условия для разработчиков, п. 6.2.4; проверено 28.09.2026). Курс может меняться — передавайте свой.
 */
export const STAR_USD = 0.013;

/**
 * Миграция для главы 5.5 на базе из главы 2.4: столбец payments.expires_at и таблица показов кнопки подписки.
 * Безопасно вызывать при каждом старте.
 */
export function initPaymentsSchema(db: Database) {
  const cols = (db.query("PRAGMA table_info(payments)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("expires_at")) db.run("ALTER TABLE payments ADD COLUMN expires_at TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS paywall_views (
    telegram_id INTEGER NOT NULL,
    at          TEXT    NOT NULL,
    stars       INTEGER NOT NULL,
    action      TEXT    NOT NULL  -- 'seen' | 'clicked'
  );
  CREATE INDEX IF NOT EXISTS paywall_views_at ON paywall_views (at);`);
}

/** Записать каждый показ кнопки подписки или нажатие на неё — с ценой. В отличие от markStep, не один раз на человека. */
export function recordPaywallView(db: Database, userId: number, stars: number, action: "seen" | "clicked") {
  db.run(`INSERT INTO paywall_views (telegram_id, at, stars, action) VALUES (?, datetime('now'), ?, ?)`, [
    userId,
    stars,
    action,
  ]);
}

/** Поля SuccessfulPayment из Bot API, нужные для учёта. Объект из grammY подходит как есть. */
export type StarPayment = {
  currency: string;
  total_amount: number; // для XTR — число звёзд
  invoice_payload: string;
  telegram_payment_charge_id: string;
  is_recurring?: true;
  subscription_expiration_date?: number; // Unix time
};

/**
 * Записать платёж звёздами из successful_payment. Повторная доставка того же обновления ничего не меняет:
 * charge_id уникален. Подписка — если payload начинается с "sub" или платёж — продление (is_recurring).
 * expires_at — из subscription_expiration_date, а если его нет — через 30 дней от платежа.
 * net_usd = звёзды × usdPerStar × (1 − extraFeeShare); extraFeeShare — 0,15 при темах в личных чатах, иначе 0.
 * Комиссию партнёрской программы Telegram здесь не видно: сверяйте с getStarTransactions.
 * Возвращает true, если строка новая. Нужен initPaymentsSchema.
 */
export function recordStarPayment(
  db: Database,
  userId: number,
  p: StarPayment,
  opts: { usdPerStar?: number; extraFeeShare?: number } = {},
): boolean {
  if (p.currency !== "XTR") throw new Error(`recordStarPayment: ожидалась валюта XTR, пришла ${p.currency}`);
  const isSub = Boolean(p.is_recurring) || p.invoice_payload.startsWith("sub");
  const net = p.total_amount * (opts.usdPerStar ?? STAR_USD) * (1 - (opts.extraFeeShare ?? 0));
  const r = db.run(
    `INSERT OR IGNORE INTO payments
       (telegram_id, kind, paid_at, amount, currency, provider, charge_id, net_usd, expires_at)
     VALUES (?, ?, datetime('now'), ?, 'XTR', 'stars', ?, ?,
       CASE WHEN ? IS NOT NULL THEN datetime(?, 'unixepoch')
            WHEN ? THEN datetime('now', '+30 days') END)`,
    [
      userId,
      isSub ? "subscription" : "one_off",
      p.total_amount,
      p.telegram_payment_charge_id,
      net,
      p.subscription_expiration_date ?? null,
      p.subscription_expiration_date ?? null,
      isSub ? 1 : 0,
    ],
  );
  return r.changes > 0;
}

/** Отметить возврат по charge_id (после refundStarPayment или сообщения refunded_payment). true — если отметили сейчас. */
export function markRefunded(db: Database, chargeId: string): boolean {
  const r = db.run(
    `UPDATE payments SET refunded_at = datetime('now') WHERE charge_id = ? AND refunded_at IS NULL`,
    [chargeId],
  );
  return r.changes > 0;
}

/**
 * До какого момента (UTC, 'YYYY-MM-DD HH:MM:SS') оплачена подписка; null — если не оплачена.
 * Возвращённые платежи не считаются. Для старых строк без expires_at — 30 дней от платежа.
 * graceHours — запас после окончания: продление может прийти с задержкой.
 */
export function subscriptionUntil(db: Database, userId: number, graceHours = 24): string | null {
  const r = db
    .query(
      `SELECT MAX(COALESCE(expires_at, datetime(paid_at, '+30 days'))) AS until FROM payments
       WHERE telegram_id = ? AND kind = 'subscription' AND refunded_at IS NULL`,
    )
    .get(userId) as { until: string | null };
  if (!r.until) return null;
  const alive = db.query(`SELECT ? > datetime('now', ?) AS ok`).get(r.until, `-${graceHours} hours`) as { ok: number };
  return alive.ok ? r.until : null;
}

/** Есть ли у человека оплаченный период подписки (с запасом graceHours). Отмена продления доступ не обрывает. */
export function hasActiveSubscription(db: Database, userId: number, graceHours = 24): boolean {
  return subscriptionUntil(db, userId, graceHours) !== null;
}

/**
 * Решение для pre_checkout_query: валюта, цена из списка всех когда-либо выданных, метка, нет ли уже подписки.
 * Отказ из-за подписки — только если она оплачена больше чем на сутки вперёд: вдруг продление тоже
 * проходит через pre_checkout (документация этого не говорит), тогда его нельзя отклонять.
 */
export function checkCheckout(
  db: Database,
  userId: number,
  q: { currency: string; total_amount: number; invoice_payload: string },
  prices: ReadonlySet<number>,
): { ok: true } | { ok: false; error: string } {
  if (q.currency !== "XTR" || !prices.has(q.total_amount) || q.invoice_payload !== `sub_${q.total_amount}`) {
    return { ok: false, error: "Счёт устарел — нажмите кнопку подписки ещё раз." };
  }
  const r = db
    .query(
      `SELECT MAX(COALESCE(expires_at, datetime(paid_at, '+30 days'))) > datetime('now', '+1 day') AS busy
       FROM payments WHERE telegram_id = ? AND kind = 'subscription' AND refunded_at IS NULL`,
    )
    .get(userId) as { busy: number | null };
  if (r.busy) return { ok: false, error: "Подписка уже активна — второй раз платить не нужно." };
  return { ok: true };
}
