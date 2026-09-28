// Код к главе 5.6 книги «Из продукта в бизнес»: удержание в продукте-диалоге.
// Bun + bun:sqlite. Для better-sqlite3 замените db.run(sql, [..]) на db.prepare(sql).run(..).
//
// Нужны: examples/tracking/schema.sql (2.1–2.3), messaging_optout (5.2) и experiment_assignments (2.5).
// Свои две маленькие таблицы создаёт initRetention: me (ваши аккаунты) и billing_pending (отложенные
// сообщения о неудачном продлении). Все пороги — ориентир, проверяйте на своих данных.
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { assign, assignVariant, diffInterval, type Interval, type Variant } from "../experiments/experiments";
import { isDaytime } from "../deeplinks/deeplinks";
import { recordBotStatus } from "../tracking/tracking";

export type Segment = "blocked" | "new" | "active" | "passive_alive" | "zombie" | "dormant" | "never_activated";

/**
 * Все виды сообщений, которые бот отправляет сам, — в одном месте.
 * asked      — человек просил сам: время выбрал он, бюджет не тратится, мешает только блокировка;
 * paid       — касается того, за что человек заплатил: днём, вне бюджета, «Больше не писать» не мешает;
 * initiative — инициатива бота: днём, без отказа, в пределах общего недельного бюджета.
 * Мягкое напоминание из главы 5.2 (шаг nudge_sent в funnel_events) — тоже инициатива.
 */
export const KINDS = {
  reminder: "asked",
  weekly_summary: "asked",
  billing: "paid",
  reengage: "initiative",
  zombie_check: "initiative",
  announce: "initiative",
} as const;
export type Kind = keyof typeof KINDS;

/** Сообщений по инициативе бота на человека за 7 дней — общий потолок на все виды. Ориентир. */
export const WEEKLY_INITIATIVE_BUDGET = 1;
/** Не больше стольких отправок в секунду: общий лимит рассылки Telegram — около 30 (глава 5.8). */
export const MAX_PER_SECOND = 25;

// ---------- Запросы из segments.sql ----------

/** Прочитать segments.sql: блоки, начинающиеся строкой «-- name: <имя>». */
export function loadQueries(path = new URL("./segments.sql", import.meta.url)): Record<string, string> {
  const out: Record<string, string> = {};
  let name = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^-- name: (\w+)/);
    if (m) {
      name = m[1]!;
      out[name] = "";
    } else if (name) out[name] += line + "\n";
  }
  return out;
}

const Q = loadQueries();

/**
 * Создать таблицы главы и вписать свои аккаунты и аккаунты близких — один список на все запросы segments.sql.
 * Повторный вызов безопасен; чтобы убрать аккаунт из списка — DELETE FROM me WHERE telegram_id = ?.
 */
export function initRetention(db: Database, me: number[] = []) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS me (telegram_id INTEGER PRIMARY KEY);
    -- Неудачное продление: обновление subscription приходит один раз и в любой час, а писать можно только днём.
    CREATE TABLE IF NOT EXISTS billing_pending (
      telegram_id     INTEGER PRIMARY KEY,
      invoice_payload TEXT,
      stars           INTEGER,             -- цена продления: сумма для кнопки пополнения
      at              TEXT NOT NULL
    );
  `);
  for (const id of me) db.run("INSERT OR IGNORE INTO me (telegram_id) VALUES (?)", [id]);
}

export type SegmentRow = { telegram_id: number; segment: Segment; opted_out: 0 | 1 };

/** Сегмент каждого человека на сегодня (запрос user_segments). */
export function userSegments(db: Database): SegmentRow[] {
  return db.query(Q.user_segments!).all() as SegmentRow[];
}

/** Сколько людей в каждом сегменте (запрос segment_counts). */
export function segmentCounts(db: Database): Record<Segment, number> {
  const out = { blocked: 0, new: 0, active: 0, passive_alive: 0, zombie: 0, dormant: 0, never_activated: 0 };
  for (const r of db.query(Q.segment_counts!).all() as { segment: Segment; users: number }[]) out[r.segment] = r.users;
  return out;
}

// ---------- Кому и что можно отправить ----------

/** Последний статус — блокировка ('kicked') или человек недоступен ('gone'). */
function isUnreachable(db: Database, userId: number): boolean {
  const row = db
    .query("SELECT status FROM bot_status WHERE telegram_id = ? ORDER BY at DESC, rowid DESC LIMIT 1")
    .get(userId) as { status: string } | null;
  return row?.status === "kicked" || row?.status === "gone";
}

function isOptedOut(db: Database, userId: number): boolean {
  return db.query("SELECT 1 FROM messaging_optout WHERE telegram_id = ?").get(userId) !== null;
}

const INITIATIVE = Object.entries(KINDS).filter(([, v]) => v === "initiative").map(([k]) => k);

/** Сколько сообщений по инициативе бота человек получил за 7 дней (сегодня и 6 дней до него), всех видов. */
export function initiativeLast7d(db: Database, userId: number): number {
  const kinds = INITIATIVE.map(() => "?").join(", ");
  const row = db
    .query(
      `SELECT (SELECT COUNT(*) FROM reminder_deliveries
               WHERE telegram_id = ? AND delivered_on >= date('now', '-6 days') AND kind IN (${kinds}))
            + (SELECT COUNT(*) FROM funnel_events
               WHERE telegram_id = ? AND step = 'nudge_sent' AND at >= date('now', '-6 days')) AS n`,
    )
    .get(userId, ...INITIATIVE, userId) as { n: number };
  return row.n;
}

export type WriteCheck = { ok: true } | { ok: false; reason: "blocked" | "opted_out" | "night" | "over_budget" };

/**
 * Можно ли сейчас отправить человеку сообщение вида kind. Пускайте через неё всё, что бот шлёт сам.
 * asked — в заказанное время, мешает только блокировка; paid — днём; initiative — днём, без отказа
 * («Больше не писать», глава 5.2) и в пределах общего бюджета. tz — пояс человека или основной пояс аудитории.
 * Только проверка: чтобы два процесса не прошли её одновременно, отправляйте через reserveMessage.
 */
export function mayWrite(
  db: Database, userId: number, kind: Kind, tz: string, now = new Date(), budget = WEEKLY_INITIATIVE_BUDGET,
): WriteCheck {
  if (isUnreachable(db, userId)) return { ok: false, reason: "blocked" };
  const cls = KINDS[kind];
  if (cls === "asked") return { ok: true };
  if (!isDaytime(tz, now)) return { ok: false, reason: "night" };
  if (cls === "paid") return { ok: true };
  if (isOptedOut(db, userId)) return { ok: false, reason: "opted_out" };
  if (initiativeLast7d(db, userId) >= budget) return { ok: false, reason: "over_budget" };
  return { ok: true };
}

/**
 * Проверка и запись одной транзакцией (BEGIN IMMEDIATE): второй процесс ждёт, пока первый не запишет строку,
 * и уже видит её в бюджете. Строка журнала появляется до отправки, с message_id = NULL.
 * После sendMessage вызовите confirmMessage, при ошибке — releaseMessage.
 * Упавший между ними процесс оставит строку: она считается отправленной — лучше недописать, чем написать дважды.
 */
export function reserveMessage(
  db: Database, userId: number, kind: Kind, tz: string, now = new Date(), budget = WEEKLY_INITIATIVE_BUDGET,
): ({ ok: true; id: number } | Extract<WriteCheck, { ok: false }>) {
  if (kind === "reminder") throw new Error("напоминания пишет recordReminderDelivery (глава 2.3)");
  return db.transaction(() => {
    const check = mayWrite(db, userId, kind, tz, now, budget);
    if (!check.ok) return check;
    const res = db.run(
      "INSERT INTO reminder_deliveries (telegram_id, kind, message_id, delivered_on) VALUES (?, ?, NULL, date('now'))",
      [userId, kind],
    );
    return { ok: true as const, id: Number(res.lastInsertRowid) };
  }).immediate();
}

/** Отправка прошла: записать message_id (по нему кнопки под сообщением найдут свою строку). */
export function confirmMessage(db: Database, rowId: number, messageId: number) {
  db.run("UPDATE reminder_deliveries SET message_id = ? WHERE id = ?", [messageId, rowId]);
}

/** Отправка не удалась: убрать строку, бюджет не тратится. */
export function releaseMessage(db: Database, rowId: number) {
  db.run("DELETE FROM reminder_deliveries WHERE id = ? AND message_id IS NULL", [rowId]);
}

// ---------- Ошибки отправки ----------

export type TgError = { error_code?: number; description?: string; parameters?: { retry_after?: number } };
export type SendOutcome =
  | { kind: "blocked" }             // 403 bot was blocked by the user
  | { kind: "gone" }                // человек недоступен: удалён, не запускал бота, чат не найден
  | { kind: "retry"; after: number } // 429: подождать retry_after секунд и повторить
  | { kind: "other" };              // 5xx, сеть, прочее: записать в журнал и повторить в другой раз

/**
 * Разобрать ошибку отправки. Официального списка текстов ошибок у Bot API нет (глава 2.3), поэтому
 * блокировкой считаем только «bot was blocked by the user», остальные 403 и «chat not found» — недоступностью.
 * GrammyError из grammY и ошибки aiogram несут те же поля error_code, description и parameters.
 */
export function classifySendError(e: TgError): SendOutcome {
  const code = e.error_code;
  const text = (e.description ?? "").toLowerCase();
  if (code === 429) return { kind: "retry", after: Math.max(1, e.parameters?.retry_after ?? 1) };
  if (code === 403 && text.includes("bot was blocked by the user")) return { kind: "blocked" };
  if (code === 403) return { kind: "gone" };
  if (code === 400 && text.includes("chat not found")) return { kind: "gone" };
  return { kind: "other" };
}

/** Записать итог ошибки в bot_status. 'gone' блокировкой не считается и в блокировки глав 2.2–2.6 не попадает. */
export function recordUnreachable(db: Database, userId: number, outcome: SendOutcome) {
  if (outcome.kind === "blocked") recordBotStatus(db, userId, "kicked");
  else if (outcome.kind === "gone")
    db.run("INSERT INTO bot_status (telegram_id, status, at) VALUES (?, 'gone', datetime('now'))", [userId]);
}

export type BudgetRow = {
  telegram_id: number; asked: number; billing: number; initiative: number; budget: number; over_budget: 0 | 1;
};

/** Сообщения за 7 дней на человека против бюджета (запрос message_budget). */
export function messageBudget(db: Database): BudgetRow[] {
  return db.query(Q.message_budget!).all() as BudgetRow[];
}

export type KindBlocks = { kind: string; messages: number; users: number; blocked_after: number };

/** Ограничитель: блокировки после сообщений каждого вида (запрос blocks_by_kind). */
export function blocksByKind(db: Database): KindBlocks[] {
  return db.query(Q.blocks_by_kind!).all() as KindBlocks[];
}

// ---------- Одно сообщение спящим, с контрольной группой ----------

/** Кандидаты на одно сообщение с новой пользой (запрос reengage_candidates). */
export function reengageCandidates(db: Database, experiment: string): number[] {
  return (db.query(Q.reengage_candidates!).all({ $experiment: experiment }) as { telegram_id: number }[]).map(
    (r) => r.telegram_id,
  );
}

/** Отправить одно сообщение: вернуть message_id или бросить ошибку с полями TgError (как GrammyError). */
export type SendFn = (userId: number) => Promise<number>;

export type WaveResult = { sent: number[]; holdout: number[]; unreachable: number[]; failed: number[] };

/**
 * Одна волна сообщений спящим. Запускайте каждый час днём (cron или setInterval): повторов не будет,
 * потому что группа записывается один раз, а получившим бот уже писал.
 * Группа — хеш из главы 2.5 (assignVariant): B — пишем, A — контрольная группа, не пишем.
 * A записывается сразу. B — только когда исход окончательный: сообщение ушло, или человек заблокировал бота
 * или недоступен. Такие остаются в B: в A их столько же, просто мы о них не знаем, и выбросить их только
 * из B значило бы подыграть B. Временная ошибка (429 после повторов, 5xx, сеть) группу не пишет —
 * человек вернётся в список в следующий запуск.
 * Не быстрее perSecond отправок в секунду; на 429 ждём retry_after (или используйте плагин auto-retry).
 */
export async function runReengageWave(
  db: Database,
  experiment: string,
  tzOf: (userId: number) => string,
  send: SendFn,
  opts: { now?: Date; sendShare?: number; perSecond?: number; maxRetries?: number;
          sleep?: (ms: number) => Promise<void>; log?: (userId: number, e: unknown) => void } = {},
): Promise<WaveResult> {
  const now = opts.now ?? new Date();
  const perSecond = Math.min(opts.perSecond ?? MAX_PER_SECOND, MAX_PER_SECOND);
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((id: number, e: unknown) => console.error("reengage", id, e));
  const out: WaveResult = { sent: [], holdout: [], unreachable: [], failed: [] };

  for (const id of reengageCandidates(db, experiment)) {
    const tz = tzOf(id);
    if (!isDaytime(tz, now)) continue;                        // придёт в список днём
    const v: Variant = assignVariant(experiment, id, opts.sendShare ?? 0.5);
    if (v === "A") {
      assign(db, experiment, id, "A");
      out.holdout.push(id);
      continue;
    }
    const slot = reserveMessage(db, id, "reengage", tz, now);
    if (!slot.ok) continue;                                   // отказ или блокировка случились только что
    let done = false;
    for (let attempt = 0; attempt <= maxRetries && !done; attempt++) {
      try {
        const messageId = await send(id);
        confirmMessage(db, slot.id, messageId);
        assign(db, experiment, id, "B");
        out.sent.push(id);
        done = true;
      } catch (e) {
        const res = classifySendError(e as TgError);
        if (res.kind === "retry" && attempt < maxRetries) {
          await sleep(res.after * 1000);
          continue;
        }
        releaseMessage(db, slot.id);
        if (res.kind === "blocked" || res.kind === "gone") {
          recordUnreachable(db, id, res);
          assign(db, experiment, id, "B");
          out.unreachable.push(id);
        } else {
          log(id, e);
          out.failed.push(id);
        }
        done = true;
      }
    }
    await sleep(1000 / perSecond);
  }
  return out;
}

// ---------- Продление не прошло (billing) ----------

/**
 * Обработчик обновления subscription (Bot API 10.2). failed — запомнить и написать днём;
 * active или canceled — сообщение больше не нужно: человек вернул подписку или отменил её сам.
 */
export function onSubscriptionUpdate(
  db: Database, userId: number, state: "failed" | "active" | "canceled", invoicePayload?: string, stars?: number,
) {
  if (state === "failed") {
    db.run(
      `INSERT INTO billing_pending (telegram_id, invoice_payload, stars, at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (telegram_id) DO UPDATE SET invoice_payload = excluded.invoice_payload,
         stars = excluded.stars, at = excluded.at`,
      [userId, invoicePayload ?? null, stars ?? null],
    );
  } else {
    db.run("DELETE FROM billing_pending WHERE telegram_id = ?", [userId]);
  }
}

export type BillingNotice = { telegram_id: number; invoice_payload: string | null; stars: number | null };

/**
 * Разослать отложенные сообщения о неудачном продлении тем, у кого сейчас день. Запускайте вместе с волной
 * спящим, каждый час днём. Отправленное и недоступные уходят из очереди; ночь и временный сбой — остаются.
 */
export async function sendPendingBilling(
  db: Database,
  tzOf: (userId: number) => string,
  send: (n: BillingNotice) => Promise<number>,
  opts: { now?: Date; sleep?: (ms: number) => Promise<void>; log?: (userId: number, e: unknown) => void } = {},
): Promise<{ sent: number[]; waiting: number[]; unreachable: number[]; failed: number[] }> {
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((id: number, e: unknown) => console.error("billing", id, e));
  const out = { sent: [] as number[], waiting: [] as number[], unreachable: [] as number[], failed: [] as number[] };
  const rows = db.query("SELECT telegram_id, invoice_payload, stars FROM billing_pending ORDER BY at").all() as BillingNotice[];
  for (const n of rows) {
    const id = n.telegram_id;
    const slot = reserveMessage(db, id, "billing", tzOf(id), now);
    if (!slot.ok) {
      if (slot.reason === "blocked") {
        db.run("DELETE FROM billing_pending WHERE telegram_id = ?", [id]);
        out.unreachable.push(id);
      } else out.waiting.push(id);                              // ночь: подождём до дня
      continue;
    }
    try {
      confirmMessage(db, slot.id, await send(n));
      db.run("DELETE FROM billing_pending WHERE telegram_id = ?", [id]);
      out.sent.push(id);
    } catch (e) {
      releaseMessage(db, slot.id);
      const res = classifySendError(e as TgError);
      if (res.kind === "blocked" || res.kind === "gone") {
        recordUnreachable(db, id, res);
        db.run("DELETE FROM billing_pending WHERE telegram_id = ?", [id]);
        out.unreachable.push(id);
      } else {
        if (res.kind === "other") log(id, e);
        out.failed.push(id);                                    // 429 или сбой — в следующий запуск
      }
    }
    await sleep(1000 / MAX_PER_SECOND);
  }
  return out;
}

/** Удаление по запросу (глава 5.8): таблицы этой главы. Журнал и статусы чистят функции глав 2.3 и 5.2. */
export function deleteUserRetention(db: Database, userId: number) {
  db.run("DELETE FROM billing_pending WHERE telegram_id = ?", [userId]);
}

export type OutcomeRow = { variant: Variant; n: number; returned_14d: number; opted_out_14d: number; blocked_14d: number };

/** Итог по группам (запрос reengage_outcome). */
export function reengageOutcome(db: Database, experiment: string): OutcomeRow[] {
  return db.query(Q.reengage_outcome!).all({ $experiment: experiment }) as OutcomeRow[];
}

/**
 * Эффект сообщения: разница долей вернувшихся B − A с 95-процентным интервалом Ньюкомба (глава 2.5).
 * null — пока нет обеих групп.
 */
export function reengageEffect(rows: OutcomeRow[]): { returned: Interval; blocked: Interval } | null {
  const a = rows.find((r) => r.variant === "A");
  const b = rows.find((r) => r.variant === "B");
  if (!a || !b || a.n === 0 || b.n === 0) return null;
  return {
    returned: diffInterval(a.returned_14d, a.n, b.returned_14d, b.n),
    blocked: diffInterval(a.blocked_14d, a.n, b.blocked_14d, b.n),
  };
}
