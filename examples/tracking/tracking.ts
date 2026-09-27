// Код к главам 2.1–2.3 книги «Из продукта в бизнес».
// Bun + bun:sqlite. Для better-sqlite3 замените db.run(sql, [..]) на db.prepare(sql).run(..).
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";

export const SOURCE_RE = /^src_[A-Za-z0-9_-]{1,60}$/;
// Ссылки на объекты продукта: ev_<токен объекта>[_<код пригласившего>]
export const SHARE_RE = /^(?:ev|inv)_([A-Za-z0-9]{8,24})(?:_([A-Za-z0-9]{6,12}))?$/;
// Ссылки, выданные до разметки: поправьте префиксы под свой бот.
// Добавьте сюда префиксы, которые ваш бот выдавал раньше.
export const LEGACY_SHARE_RE = /^(?:ev|inv)_[A-Za-z0-9-]{1,60}$/;

export type Parsed = { source: string; objectToken?: string; inviteCode?: string };

export function sourceOf(payload?: string): Parsed {
  if (!payload) return { source: "none" };
  if (SOURCE_RE.test(payload)) return { source: payload };
  const m = payload.match(SHARE_RE);
  if (m) return { source: "src_share", objectToken: m[1], inviteCode: m[2] };
  if (LEGACY_SHARE_RE.test(payload)) return { source: "src_share" };
  return { source: "none" };
}

/** Разобрать параметр /start: источник и проверенный пригласивший. */
export function parsePayload(db: Database, userId: number, payload?: string) {
  const { source, inviteCode } = sourceOf(payload);
  let invitedBy: number | null = null;
  if (inviteCode) {
    const row = db.query("SELECT telegram_id FROM invite_codes WHERE code = ?").get(inviteCode) as
      | { telegram_id: number }
      | null;
    if (row && row.telegram_id !== userId) invitedBy = row.telegram_id; // чужой и существующий код
  }
  return { source, invitedBy };
}

/** Записать /start (глава 2.1). Возвращает true, если человек пришёл впервые. */
export function recordStart(db: Database, userId: number, payload?: string): boolean {
  const { source, invitedBy } = parsePayload(db, userId, payload);
  const res = db.run(
    `INSERT OR IGNORE INTO user_acquisition (telegram_id, first_source, first_seen_at, invited_by)
     VALUES (?, ?, datetime('now'), ?)`,
    [userId, source, invitedBy],
  );
  const isNew = res.changes === 1;
  if (source !== "none") {
    db.run(
      `UPDATE user_acquisition SET last_source = ?, last_seen_at = datetime('now') WHERE telegram_id = ?`,
      [source, userId],
    );
  }
  if (isNew) markStep(db, userId, "start"); // глава 2.2: старт воронки — только для новых
  return isNew;
}

export function markStep(db: Database, userId: number, step: string): boolean {
  const res = db.run(
    `INSERT OR IGNORE INTO funnel_events (telegram_id, step, at) VALUES (?, ?, datetime('now'))`,
    [userId, step],
  );
  return res.changes === 1;
}

/** Первое свободное сообщение: понятым считается, только если понято именно оно. */
export function markFirstMessage(db: Database, userId: number, understood: boolean) {
  const isFirst = markStep(db, userId, "first_message_sent");
  if (isFirst && understood) markStep(db, userId, "first_message_understood");
}

export function getOrCreateInviteCode(db: Database, userId: number): string {
  const row = db.query("SELECT code FROM invite_codes WHERE telegram_id = ?").get(userId) as
    | { code: string }
    | null;
  if (row) return row.code;
  const code = randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 10);
  db.run("INSERT INTO invite_codes (code, telegram_id) VALUES (?, ?)", [code, userId]);
  return code;
}

export function shareLink(bot: string, objectToken: string, code: string): string {
  return `https://t.me/${bot}?start=ev_${objectToken}_${code}`;
}

/** my_chat_member в личном чате: kicked = заблокировал, member = разблокировал. */
export function recordBotStatus(db: Database, userId: number, status: "kicked" | "member") {
  db.run("INSERT INTO bot_status (telegram_id, status, at) VALUES (?, ?, datetime('now'))", [userId, status]);
  if (status === "kicked") markStep(db, userId, "bot_blocked"); // первая блокировка — для воронки
}

/**
 * Глава 2.3: человек сам что-то сделал в личном чате с ботом.
 * Вызывайте на сообщения и нажатия кнопок в чате типа "private"; служебные обновления и группы — не сюда.
 */
export function markActive(db: Database, userId: number) {
  db.run("INSERT OR IGNORE INTO user_activity (telegram_id, day) VALUES (?, date('now'))", [userId]);
}

/**
 * Глава 2.3: напоминание (или сводка) ушло без ошибки. Вызывайте после успешного sendMessage,
 * передав message_id из ответа Telegram: по нему кнопка «знак жизни» найдёт свою запись.
 * Для своего напоминания (kind = "reminder", ownEvent = true) заодно отмечает шаг воронки
 * first_reminder_delivered (глава 2.2) — отдельный вызов markStep для этого шага уберите.
 * Напоминание о чужом общем событии активацией получателя не считается: ownEvent = false.
 */
export function recordReminderDelivery(
  db: Database, userId: number, messageId: number | null, kind = "reminder", ownEvent = true,
) {
  db.run(
    "INSERT INTO reminder_deliveries (telegram_id, kind, message_id, delivered_on) VALUES (?, ?, ?, date('now'))",
    [userId, kind, messageId],
  );
  if (kind === "reminder" && ownEvent) markStep(db, userId, "first_reminder_delivered");
}

/** Ошибка отправки 403: блокировка — только «bot was blocked by the user». Остальное (не нажимал /start, удалён) — не блокировка. */
export function isBlockedError(description: string | undefined): boolean {
  return !!description && description.includes("bot was blocked by the user");
}

/** Глава 2.3: настоящий ввод человека. Служебные сообщения (оплата, вход в чат и т. п.) — не использование. */
export function isHumanInput(update: { message?: any; callback_query?: { data?: string } }): boolean {
  const m = update.message;
  if (m) return !!(m.text || m.voice || m.photo || m.video_note || m.video || m.document || m.location || m.contact);
  return !!update.callback_query && update.callback_query.data !== "alive";
}

/**
 * Глава 2.3: нажата кнопка «знак жизни» под напоминанием. Возвращает true при первом нажатии.
 * Активностью НЕ считается: бот сам просит нажать, и рост нажатий изобразил бы рост продукта.
 */
export function ackReminder(db: Database, userId: number, messageId: number): boolean {
  const res = db.run(
    `UPDATE reminder_deliveries SET acked_on = date('now')
     WHERE telegram_id = ? AND message_id = ? AND acked_on IS NULL`,
    [userId, messageId],
  );
  return res.changes === 1;
}

/** Удаление по запросу пользователя: все маркетинговые таблицы разом. */
export function deleteUserTracking(db: Database, userId: number) {
  db.transaction(() => {
    db.run("DELETE FROM user_acquisition WHERE telegram_id = ?", [userId]);
    db.run("UPDATE user_acquisition SET invited_by = NULL WHERE invited_by = ?", [userId]);
    db.run("DELETE FROM invite_codes WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM funnel_events WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM bot_status WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM user_activity WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM reminder_deliveries WHERE telegram_id = ?", [userId]);
  })();
}
