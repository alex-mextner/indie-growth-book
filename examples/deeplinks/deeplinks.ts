// Код к главе 5.2 книги «Из продукта в бизнес».
// TypeScript + Bun + bun:sqlite. Для better-sqlite3 замените db.run(sql, [..]) на db.prepare(sql).run(..).
//
// Правила Telegram (проверено 28.09.2026, core.telegram.org/bots/features#deep-linking и core.telegram.org/api/links):
// параметр start / startgroup — до 64 символов из A-Z, a-z, 0-9, _ и -.
// Для startapp официальный лимит не опубликован; держимся тех же правил.
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const PAYLOAD_MAX = 64;
export const PAYLOAD_CHARS = /^[A-Za-z0-9_-]+$/;
// Префикс реферальных ссылок партнёрской программы Telegram (starref_start_param_prefixes в конфигурации клиента).
// Такой параметр клиент может принять за реферальную ссылку, поэтому свои метки с него не начинаем.
export const RESERVED_PREFIXES = ["_tgr_"];
// Служебные значения источника (главы 2.1–2.2): бот пишет их сам, в ссылке их быть не должно.
export const RESERVED_SOURCES = ["src_share", "none", "legacy"];

export type Invalid = "empty" | "too_long" | "bad_chars" | "reserved_prefix" | "reserved_source";

/** Проверить параметр до публикации ссылки. null — всё в порядке. */
export function checkPayload(p: string, max = PAYLOAD_MAX): Invalid | null {
  if (!p) return "empty";
  if (p.length > max) return "too_long";
  if (!PAYLOAD_CHARS.test(p)) return "bad_chars";
  if (RESERVED_PREFIXES.some((x) => p.startsWith(x))) return "reserved_prefix";
  if (RESERVED_SOURCES.includes(p.split("-")[0])) return "reserved_source";
  return null;
}

// Схема меток. Поля разделены дефисом; каждое поле после источника — буква-префикс и значение.
//   src_<канал>_<место>[_<дата>]  -c<вариант текста>  -r<код друга>  -p<код партнёра>
//   src_tg_chanA_0927-c2-rX9y8Z7W6
// r — пригласил пользователь (вирусность, глава 3.5); p — платный партнёр или амбассадор (глава 4.3).
// Ссылки на объекты — как в главе 2.1: ev_<токен>[_<код>].
// Длинные наборы — короткий ключ k_<10 символов>, расшифровка в таблице start_links.
const FIELD = /^[A-Za-z0-9_]+$/;
const CAMPAIGN = /^src_[A-Za-z0-9_]+$/;
const CODE = /^[A-Za-z0-9]{6,12}$/;            // код друга (глава 2.1) или партнёра
const SHARE = /^(ev|inv)_([A-Za-z0-9]{8,24})(?:_([A-Za-z0-9]{6,12}))?$/;
const KEY = /^k_([A-Za-z0-9]{10})$/;

export type LinkParams = { campaign: string; content?: string; ref?: string; partner?: string };

export type Parsed =
  | ({ kind: "campaign" } & LinkParams)
  | { kind: "share"; object: "ev" | "inv"; token: string; ref?: string }
  | { kind: "none" };

const NONE: Parsed = { kind: "none" };

/** Собрать метку из полей. Бросает ошибку, если поле содержит недопустимые символы. */
export function encodeCampaign({ campaign, content, ref, partner }: LinkParams): string {
  if (!CAMPAIGN.test(campaign) || RESERVED_SOURCES.includes(campaign)) throw new Error(`campaign: ${campaign}`);
  if (content !== undefined && !FIELD.test(content)) throw new Error(`content: ${content}`);
  if (ref !== undefined && !CODE.test(ref)) throw new Error(`ref: ${ref}`);
  if (partner !== undefined && !CODE.test(partner)) throw new Error(`partner: ${partner}`);
  return [campaign, content && `c${content}`, ref && `r${ref}`, partner && `p${partner}`].filter(Boolean).join("-");
}

/**
 * Разобрать параметр без базы. Возвращает { kind: "campaign" | "share" | "none", ... }.
 * Незнакомое или повторное поле — { kind: "none" }: не угадываем. Ключи k_ и старые метки разбирает resolvePayload.
 */
export function decodePayload(p?: string): Parsed {
  if (!p || checkPayload(p)) return NONE;
  const share = p.match(SHARE);
  if (share) return { kind: "share", object: share[1] as "ev" | "inv", token: share[2], ref: share[3] };
  const [campaign, ...rest] = p.split("-");
  if (!CAMPAIGN.test(campaign)) return NONE;
  const out: LinkParams = { campaign };
  for (const part of rest) {
    const tag = part[0], value = part.slice(1);
    if (tag === "c" && FIELD.test(value) && out.content === undefined) out.content = value;
    else if (tag === "r" && CODE.test(value) && out.ref === undefined) out.ref = value;
    else if (tag === "p" && CODE.test(value) && out.partner === undefined) out.partner = value;
    else return NONE;
  }
  return { kind: "campaign", ...out };
}

export const SCHEMA = `
-- 5.2. Короткие ключи для меток, которые не влезли в 64 символа.
-- Единственность набора полей обеспечивает payloadFor, а не таблица (NULL в UNIQUE не сравниваются).
-- В note — только место публикации, без имён людей.
CREATE TABLE IF NOT EXISTS start_links (
  key        TEXT PRIMARY KEY,
  campaign   TEXT NOT NULL,
  content    TEXT,
  ref        TEXT,
  partner    TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS start_links_fields ON start_links (campaign, content, ref, partner);

-- 5.2. Метки, выданные до новой схемы: разбираются раньше decodePayload.
CREATE TABLE IF NOT EXISTS legacy_labels (
  label    TEXT PRIMARY KEY,               -- как опубликовано: src_tg_chanA_0927_b, src_tg-chanA
  campaign TEXT NOT NULL,
  content  TEXT
);

-- 5.2. Коды платных партнёров и амбассадоров. Блогеру, который ботом не пользуется, код заводят вручную.
CREATE TABLE IF NOT EXISTS partner_codes (
  code        TEXT PRIMARY KEY,
  telegram_id INTEGER,                     -- если партнёр — пользователь бота
  label       TEXT,                        -- «канал A», без имён
  max_payouts INTEGER                      -- потолок выплат по коду
);

-- 5.2. «Больше не писать»: бот не шлёт таким людям ничего, о чём они не просили.
CREATE TABLE IF NOT EXISTS messaging_optout (
  telegram_id INTEGER PRIMARY KEY,
  at          TEXT NOT NULL
);

-- 5.2. Группы: единица учёта — чат.
CREATE TABLE IF NOT EXISTS group_acquisition (
  chat_id       INTEGER PRIMARY KEY,
  first_source  TEXT NOT NULL,
  added_by      INTEGER,                   -- кто добавил (my_chat_member.from)
  first_seen_at TEXT NOT NULL
);

-- Копии таблиц из examples/tracking (2.1–2.2) + столбцы first_content и first_partner.
CREATE TABLE IF NOT EXISTS user_acquisition (
  telegram_id   INTEGER PRIMARY KEY,
  first_source  TEXT NOT NULL,
  first_content TEXT,
  first_partner TEXT,
  first_seen_at TEXT NOT NULL,
  last_source   TEXT,
  last_seen_at  TEXT,
  invited_by    INTEGER,
  self_reported TEXT
);
CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS funnel_events (
  telegram_id INTEGER NOT NULL, step TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (telegram_id, step)
);
CREATE TABLE IF NOT EXISTS bot_status (telegram_id INTEGER NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
`;

/**
 * Создать таблицы и, если user_acquisition создана по главе 2.1, добавить новые столбцы.
 * CREATE TABLE IF NOT EXISTS существующую таблицу не меняет, поэтому столбцы проверяем через PRAGMA.
 */
export function initSchema(db: Database) {
  db.exec(SCHEMA);
  const cols = (db.query("PRAGMA table_info(user_acquisition)").all() as { name: string }[]).map((c) => c.name);
  for (const col of ["first_content", "first_partner"]) {
    if (!cols.includes(col)) db.run(`ALTER TABLE user_acquisition ADD COLUMN ${col} TEXT`);
  }
}

function randomKey(): string {
  let s = "";
  while (s.length < 10) s += randomBytes(12).toString("base64url").replace(/[-_]/g, "");
  return s.slice(0, 10);
}

/**
 * Параметр для ссылки: сама метка, если помещается, иначе короткий ключ k_… из таблицы.
 * Ключ случайный, но создаётся один раз: тот же набор полей находит уже выданный ключ.
 */
export function payloadFor(db: Database, params: LinkParams, note?: string): string {
  const direct = encodeCampaign(params);
  if (!checkPayload(direct)) return direct;
  const found = db
    .query("SELECT key FROM start_links WHERE campaign = ? AND content IS ? AND ref IS ? AND partner IS ?")
    .get(params.campaign, params.content ?? null, params.ref ?? null, params.partner ?? null) as { key: string } | null;
  if (found) return `k_${found.key}`;
  const key = randomKey();
  db.run(
    `INSERT INTO start_links (key, campaign, content, ref, partner, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [key, params.campaign, params.content ?? null, params.ref ?? null, params.partner ?? null, note ?? null],
  );
  return `k_${key}`;
}

/** Разобрать параметр: сначала старые метки, потом ключи k_, потом новая схема. */
export function resolvePayload(db: Database, p?: string): Parsed {
  if (!p) return NONE;
  const legacy = db.query("SELECT campaign, content FROM legacy_labels WHERE label = ?").get(p) as
    | { campaign: string; content: string | null }
    | null;
  if (legacy) return { kind: "campaign", campaign: legacy.campaign, content: legacy.content ?? undefined };
  const key = p.match(KEY);
  if (!key) return decodePayload(p);
  const row = db.query("SELECT campaign, content, ref, partner FROM start_links WHERE key = ?").get(key[1]) as
    | { campaign: string; content: string | null; ref: string | null; partner: string | null }
    | null;
  if (!row) return NONE;
  return {
    kind: "campaign", campaign: row.campaign,
    content: row.content ?? undefined, ref: row.ref ?? undefined, partner: row.partner ?? undefined,
  };
}

/** Заменить старую метку на поля новой схемы (чтобы вариант _b стал content = "2" и т. п.). */
export function addLegacyLabel(db: Database, label: string, campaign: string, content?: string) {
  db.run("INSERT OR REPLACE INTO legacy_labels (label, campaign, content) VALUES (?, ?, ?)", [label, campaign, content ?? null]);
}

/**
 * Прогнать опубликованные метки через старый и новый разбор. Возвращает метки, где источники разошлись:
 * их нужно внести в legacy_labels (или перевыпустить ключом k_).
 */
export function labelMismatches(db: Database, labels: string[], oldSourceOf: (p: string) => string): string[] {
  return labels.filter((label) => {
    const parsed = resolvePayload(db, label);
    const now = parsed.kind === "campaign" ? parsed.campaign : parsed.kind === "share" ? "src_share" : "none";
    return now !== oldSourceOf(label);
  });
}

// ---------- Ссылки ----------

// Права администратора для startgroup / startchannel (core.telegram.org/api/links, проверено 28.09.2026).
export const ADMIN_RIGHTS = [
  "change_info", "post_messages", "edit_messages", "delete_messages", "restrict_members",
  "invite_users", "pin_messages", "manage_topics", "promote_members", "manage_video_chats",
  "anonymous", "manage_chat", "post_stories", "edit_stories", "delete_stories",
  "manage_direct_messages", "manage_tags",
] as const;
export type AdminRight = (typeof ADMIN_RIGHTS)[number];

function mustBeValid(p: string) {
  const bad = checkPayload(p);
  if (bad) throw new Error(`payload ${bad}: ${p}`);
}

export function startLink(bot: string, payload: string) {
  mustBeValid(payload);
  return `https://t.me/${bot}?start=${payload}`;
}

/** Добавить бота в группу. Параметр придёт в группу командой /start@bot <payload>. */
export function groupLink(bot: string, payload?: string, admin: AdminRight[] = []) {
  if (payload) mustBeValid(payload);
  const q = [payload ? `startgroup=${payload}` : "startgroup"];
  if (admin.length) q.push(`admin=${admin.join("+")}`);
  return `https://t.me/${bot}?${q.join("&")}`;
}

/** Добавить бота в канал администратором. Параметра у канальных ссылок нет, права обязательны. */
export function channelLink(bot: string, admin: AdminRight[]) {
  if (!admin.length) throw new Error("channel links require admin rights");
  return `https://t.me/${bot}?startchannel&admin=${admin.join("+")}`;
}

/** Мини-приложение: главное (без app) или по короткому имени. Параметр придёт в initData.start_param. */
export function appLink(bot: string, payload?: string, app?: string) {
  if (payload) mustBeValid(payload);
  const base = app ? `https://t.me/${bot}/${app}` : `https://t.me/${bot}`;
  if (app) return payload ? `${base}?startapp=${payload}` : base;
  return payload ? `${base}?startapp=${payload}` : `${base}?startapp`;
}

// ---------- Старт и онбординг ----------

export function markStep(db: Database, userId: number, step: string): boolean {
  const res = db.run(
    `INSERT OR IGNORE INTO funnel_events (telegram_id, step, at) VALUES (?, ?, datetime('now'))`,
    [userId, step],
  );
  return res.changes === 1;
}

function lookupOwner(db: Database, table: "invite_codes" | "partner_codes", code?: string): number | null {
  if (!code) return null;
  const row = db.query(`SELECT telegram_id FROM ${table} WHERE code = ?`).get(code) as { telegram_id: number | null } | null;
  return row?.telegram_id ?? null;
}

function recordFirstTouch(db: Database, userId: number, payload?: string) {
  const parsed = resolvePayload(db, payload);
  const source = parsed.kind === "campaign" ? parsed.campaign : parsed.kind === "share" ? "src_share" : "none";
  const content = parsed.kind === "campaign" ? parsed.content ?? null : null;
  // Партнёрский код записываем, только если он заведён в partner_codes.
  const partnerCode = parsed.kind === "campaign" && parsed.partner &&
    db.query("SELECT 1 FROM partner_codes WHERE code = ?").get(parsed.partner) ? parsed.partner : null;
  const inviter = lookupOwner(db, "invite_codes", parsed.kind === "none" ? undefined : parsed.ref);
  const invitedBy = inviter !== null && inviter !== userId ? inviter : null; // чужой и существующий код
  const res = db.run(
    `INSERT OR IGNORE INTO user_acquisition
       (telegram_id, first_source, first_content, first_partner, first_seen_at, invited_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    [userId, source, content, partnerCode, invitedBy],
  );
  const isNew = res.changes === 1;
  if (source !== "none") {
    db.run(`UPDATE user_acquisition SET last_source = ?, last_seen_at = datetime('now') WHERE telegram_id = ?`, [
      source,
      userId,
    ]);
  }
  if (isNew) markStep(db, userId, "start");
  return { parsed, isNew };
}

/**
 * Записать /start в личном чате (версия главы 2.1 с новой схемой меток).
 * Возвращает разобранный параметр и признак «пришёл впервые» — по ним выбирается первый экран.
 */
export function recordStart(db: Database, userId: number, payload?: string) {
  return recordFirstTouch(db, userId, payload);
}

/**
 * Первое открытие мини-приложения по ссылке ?startapp=. Такие люди могут ни разу не прислать /start.
 * Вызывайте на сервере только после проверки подписи initData; userId и startParam — из проверенных
 * initData.user.id и initData.start_param, не из адреса страницы.
 */
export function recordAppStart(db: Database, userId: number, startParam?: string) {
  const r = recordFirstTouch(db, userId, startParam);
  markStep(db, userId, "app_opened");
  return r;
}

/** Группа: бота добавили (my_chat_member со статусом member или administrator). Источник пока неизвестен. */
export function recordGroupAdded(db: Database, chatId: number, addedBy?: number) {
  db.run(
    `INSERT OR IGNORE INTO group_acquisition (chat_id, first_source, added_by, first_seen_at)
     VALUES (?, 'none', ?, datetime('now'))`,
    [chatId, addedBy ?? null],
  );
}

/** Группа: пришло /start@bot <payload> по ссылке ?startgroup=. Источник пишется, только если его ещё не было. */
export function recordGroupPayload(db: Database, chatId: number, payload?: string) {
  const parsed = resolvePayload(db, payload);
  const source = parsed.kind === "campaign" ? parsed.campaign : parsed.kind === "share" ? "src_share" : "none";
  recordGroupAdded(db, chatId);
  if (source !== "none") {
    db.run(`UPDATE group_acquisition SET first_source = ? WHERE chat_id = ? AND first_source = 'none'`, [source, chatId]);
  }
}

export type Screen = "event_card" | "welcome" | string;

/**
 * Первый экран по параметру: приглашённый сразу видит событие,
 * пришедший по посту — экран под обещание этого поста, остальные — общее приветствие.
 * byContent — словарь «вариант текста из метки (-c…) → имя экрана»: выдали новый вариант поста — добавьте строку.
 */
export function firstScreen(parsed: Parsed, byContent: Record<string, Screen> = {}): Screen {
  if (parsed.kind === "share") return "event_card";
  if (parsed.kind === "campaign" && parsed.content && byContent[parsed.content]) return byContent[parsed.content];
  return "welcome";
}

/** Первая польза получена: один раз на человека. Время до пользы считается от first_seen_at. */
export function markFirstValue(db: Database, userId: number): boolean {
  return markStep(db, userId, "first_value");
}

/** Кнопка «Больше не писать». */
export function recordOptOut(db: Database, userId: number) {
  db.run("INSERT OR IGNORE INTO messaging_optout (telegram_id, at) VALUES (?, datetime('now'))", [userId]);
}

/** Местный час в поясе человека (или в основном поясе аудитории, если его пояс неизвестен). */
export function localHour(tz: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Напоминания — только днём. Границы — ориентир, проверяйте на своих данных. */
export function isDaytime(tz: string, now = new Date(), from = 10, to = 20): boolean {
  const h = localHour(tz, now);
  return h >= from && h < to;
}

// ---------- Запросы из onboarding.sql ----------

/** Прочитать onboarding.sql: блоки, начинающиеся строкой «-- name: <имя>». */
export function loadQueries(path = new URL("./onboarding.sql", import.meta.url)): Record<string, string> {
  const out: Record<string, string> = {};
  let name = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^-- name: (\w+)/);
    if (m) {
      name = m[1];
      out[name] = "";
    } else if (name) out[name] += line + "\n";
  }
  return out;
}

/** Кому отправить одно мягкое напоминание (запрос nudge_candidates). Время суток проверяйте isDaytime. */
export function nudgeCandidates(db: Database): number[] {
  const sql = loadQueries().nudge_candidates;
  return (db.query(sql).all() as { telegram_id: number }[]).map((r) => r.telegram_id);
}

export function recordNudge(db: Database, userId: number): boolean {
  return markStep(db, userId, "nudge_sent");
}

/** Удаление по запросу пользователя. Ключи start_links остаются работать, но без его кода. */
export function deleteUserOnboarding(db: Database, userId: number) {
  db.transaction(() => {
    db.run("UPDATE start_links SET ref = NULL WHERE ref IN (SELECT code FROM invite_codes WHERE telegram_id = ?)", [userId]);
    db.run("UPDATE partner_codes SET telegram_id = NULL WHERE telegram_id = ?", [userId]);
    db.run("UPDATE group_acquisition SET added_by = NULL WHERE added_by = ?", [userId]);
    db.run("DELETE FROM user_acquisition WHERE telegram_id = ?", [userId]);
    db.run("UPDATE user_acquisition SET invited_by = NULL WHERE invited_by = ?", [userId]);
    db.run("DELETE FROM invite_codes WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM funnel_events WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM bot_status WHERE telegram_id = ?", [userId]);
    db.run("DELETE FROM messaging_optout WHERE telegram_id = ?", [userId]);
  })();
}
