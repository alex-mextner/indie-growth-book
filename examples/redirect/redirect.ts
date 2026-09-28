// Код к главе 5.3 книги «Из продукта в бизнес».
// Короткий адрес /r/<slug> с переадресацией в бота: считает переходы по каждому размещению.
// TypeScript + Bun + bun:sqlite. Запуск: BOT=YourBot DB=growth.sqlite bun redirect.ts
//
// Что пишем: адрес размещения (slug), время, класс User-Agent и, по желанию, хеш посетителя за сутки.
// Чего не пишем: IP, полный User-Agent, Referer, cookies, неизвестные адреса. Нужна цифра переходов, а не люди.
// Веб-сервер перед этим кодом может писать IP в свой журнал: nginx делает это по умолчанию (access.log),
// у Caddy и Cloudflare проверьте настройки журналов. Для /r/ журнал выключают или обезличивают
// (в nginx — access_log off; в location /r/).
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkPayload } from "../deeplinks/deeplinks";

const SQL = readFileSync(new URL("./placements.sql", import.meta.url), "utf8");
const [SCHEMA, ...QUERY_CHUNKS] = SQL.split(/^-- name: /m);

/** Запросы из placements.sql по имени. */
export const QUERIES: Record<string, string> = Object.fromEntries(
  QUERY_CHUNKS.map((chunk) => {
    const nl = chunk.indexOf("\n");
    return [chunk.slice(0, nl).trim(), chunk.slice(nl + 1)];
  }),
);

/** Таблицы placements и clicks. Таблицы глав 2.1–5.2 создаёт deeplinks.initSchema. */
export function initSchema(db: Database) {
  db.exec(SCHEMA);
}

// ---------- Размещения ----------

export const SLUG = /^[A-Za-z0-9_-]{1,32}$/;
export const BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/; // правила username — в главе 5.1

export type Placement = {
  slug: string;
  channel: string;
  price: number;
  currency: string;
  priceUsd?: number;
  postedAt?: string; // 'YYYY-MM-DD HH:MM:SS' UTC
  format?: string;
  payload: string;
};

/** Завести размещение до публикации. Метку проверяем теми же правилами, что и в главе 5.2. */
export function addPlacement(db: Database, p: Placement) {
  if (!SLUG.test(p.slug)) throw new Error(`slug: ${p.slug}`);
  const bad = checkPayload(p.payload);
  if (bad) throw new Error(`payload ${bad}: ${p.payload}`);
  if (!p.payload.startsWith("src_")) throw new Error(`payload должен быть меткой src_…: ${p.payload}`);
  db.run(
    `INSERT INTO placements (slug, channel, price, currency, price_usd, posted_at, format, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.slug, p.channel, p.price, p.currency, p.priceUsd ?? null, p.postedAt ?? null, p.format ?? null, p.payload],
  );
}

/** Отметить, когда пост вышел: от этого времени считаются часы в clicks_by_hour. */
export function markPosted(db: Database, slug: string, at?: string) {
  db.run(`UPDATE placements SET posted_at = COALESCE(?, datetime('now')) WHERE slug = ?`, [at ?? null, slug]);
}

// ---------- Кто открыл ссылку ----------

export type UaClass = "mobile" | "desktop" | "preview" | "bot" | "unknown";

// Роботы, которые строят превью ссылок в мессенджерах и соцсетях (проверено 28.09.2026, список неполный):
// Telegram — «TelegramBot (like TwitterBot)», Meta — facebookexternalhit и Facebot, X — Twitterbot,
// Slack — Slackbot-LinkExpanding, Discord — Discordbot, WhatsApp, VK — vkShare, LinkedInBot, SkypeUriPreview.
const PREVIEW =
  /TelegramBot|facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|WhatsApp|vkShare|LinkedInBot|SkypeUriPreview|Iframely|Embedly/i;
// Всё, что называет себя роботом (Googlebot, YandexBot, bingbot), и типичные HTTP-клиенты.
// «bot» — с учётом регистра и не после заглавной буквы: телефоны CUBOT — люди, а не роботы.
const BOT_WORD = /(?<![A-Z])[Bb]ot\b/;
const BOT = /crawl|spider|slurp|preview|fetch|curl|wget|python-|go-http|java\/|okhttp|axios|node-fetch|headless|lighthouse/i;
const MOBILE = /Mobi|Android|iPhone|iPad|iPod/i;

/** Класс User-Agent. Сам User-Agent не храним. */
export function uaClass(ua: string | null | undefined): UaClass {
  if (!ua || !ua.trim()) return "unknown";
  if (PREVIEW.test(ua)) return "preview";
  if (BOT_WORD.test(ua) || BOT.test(ua)) return "bot";
  if (MOBILE.test(ua)) return "mobile";
  if (/Mozilla\/5\.0/.test(ua)) return "desktop";
  return "unknown";
}

// ---------- Склейка повторных переходов без хранения IP ----------
//
// Зачем: человек нажимает ссылку дважды, возвращается к посту, открывает её с телефона и компьютера.
// Без склейки переходов больше, чем людей, и доля стартов занижается.
// Как: хеш от (соль дня + IP + User-Agent). Соль случайная, живёт только в памяти процесса и
// меняется с датой UTC. Прошлые соли нигде не сохраняются, поэтому хеш за вчера уже не связать
// ни с IP, ни с сегодняшним хешем того же человека. Это наша инженерная оценка, а не юридический
// вывод: в течение суток хеш — псевдоним (глава 5.8). Цена — после перезапуска сервера в тот же
// день соль новая, и повторный переход того же человека посчитается ещё раз.
export class DailySalt {
  private day = "";
  private salt: Buffer = Buffer.alloc(0);
  constructor(private now: () => Date = () => new Date()) {}
  hash(ip: string, ua: string): string {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.salt = randomBytes(32);
    }
    return createHash("sha256").update(this.salt).update(ip).update("\n").update(ua).digest("hex").slice(0, 16);
  }
}

/** Стереть хеши за прошедшие дни: после смены соли они уже ничего не склеивают. */
export function forgetVisitors(db: Database) {
  db.run(`UPDATE clicks SET visitor = NULL WHERE visitor IS NOT NULL AND date(at) < date('now')`);
}

// ---------- Обработчик ----------

export type RedirectOptions = {
  bot: string;                 // username бота без @
  dedupe?: boolean;            // склеивать повторные переходы за сутки (по умолчанию да)
  // Откуда брать IP за своим обратным прокси: "x-real-ip" или "x-forwarded-for" (последний элемент —
  // его дописал ваш прокси; первые элементы присылает клиент, их легко подделать). По умолчанию — адрес соединения.
  trustProxy?: false | "x-real-ip" | "x-forwarded-for";
  rateLimit?: number;          // сколько переходов в минуту с одного адреса записывать (по умолчанию 5)
  salt?: DailySalt;
  now?: () => number;          // для тестов
};

export type Handler = ((req: Request, peerIp?: string) => Response) & {
  unknownSlugs: Map<string, number>; // опечатки в постах: считаются в памяти, в базу не пишутся
};

const UNKNOWN_MAX = 1000; // не больше тысячи разных неизвестных адресов — иначе память съест перебор

/** Какой IP учитывать. Сам IP никуда не записывается. */
export function clientIp(req: Request, peerIp: string | undefined, trust: RedirectOptions["trustProxy"]) {
  if (trust === "x-real-ip") return req.headers.get("x-real-ip")?.trim() || peerIp;
  if (trust === "x-forwarded-for") {
    const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return parts.at(-1) || peerIp;
  }
  return peerIp;
}

/**
 * Обработчик запросов как обычная функция: его можно вызвать в тесте без порта.
 * GET /r/<slug> → 302 на https://t.me/<bot>?start=<payload> и строка в clicks.
 * Неизвестный slug → 302 на бота без параметра (человек из поста с опечаткой всё равно дойдёт) и счётчик в памяти.
 * Больше rateLimit переходов в минуту с одного адреса — переадресуем, но не пишем.
 */
export function createHandler(db: Database, opts: RedirectOptions): Handler {
  if (!BOT_USERNAME.test(opts.bot)) throw new Error(`bot: ${opts.bot}`);
  const salt = opts.salt ?? new DailySalt();
  const dedupe = opts.dedupe ?? true;
  const limit = opts.rateLimit ?? 5;
  const now = opts.now ?? Date.now;
  const findPayload = db.query(`SELECT payload FROM placements WHERE slug = ?`);
  const insert = db.query(`INSERT INTO clicks (slug, at, ua_class, visitor) VALUES (?, datetime('now'), ?, ?)`);
  const plain = `https://t.me/${opts.bot}`;
  const unknownSlugs = new Map<string, number>();
  let minute = -1;
  let perAddr = new Map<string, number>(); // хеш адреса → переходов за текущую минуту

  const redirect = (to: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });

  const handler = (req: Request, peerIp?: string): Response => {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/r\/([^/]+)\/?$/);
    if (!m || !SLUG.test(m[1])) return new Response("Not found", { status: 404 });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });

    const slug = m[1];
    const row = findPayload.get(slug) as { payload: string } | null;
    if (!row) {
      if (req.method === "GET" && (unknownSlugs.has(slug) || unknownSlugs.size < UNKNOWN_MAX)) {
        unknownSlugs.set(slug, (unknownSlugs.get(slug) ?? 0) + 1);
      }
      return redirect(plain);
    }
    // Метку проверяем и здесь: таблицу могли поправить руками.
    const target = checkPayload(row.payload) ? plain : `${plain}?start=${row.payload}`;
    if (req.method === "HEAD") return redirect(target); // HEAD — почти всегда робот, проверяющий ссылку

    const ua = req.headers.get("user-agent");
    const cls = uaClass(ua);
    const ip = clientIp(req, peerIp, opts.trustProxy);
    if (ip) {
      const m2 = Math.floor(now() / 60_000);
      if (m2 !== minute) { minute = m2; perAddr = new Map(); }
      const key = salt.hash(ip, "");
      const n = (perAddr.get(key) ?? 0) + 1;
      perAddr.set(key, n);
      if (n > limit) return redirect(target);
    }
    const visitor = dedupe && ip && (cls === "mobile" || cls === "desktop") ? salt.hash(ip, ua ?? "") : null;
    insert.run(slug, cls, visitor);
    return redirect(target);
  };
  return Object.assign(handler, { unknownSlugs });
}

// ---------- Запуск ----------

if (import.meta.main) {
  const bot = process.env.BOT ?? "";
  const db = new Database(process.env.DB ?? "growth.sqlite");
  initSchema(db);
  const trust = process.env.TRUST_PROXY;
  const handle = createHandler(db, {
    bot,
    trustProxy: trust === "x-real-ip" || trust === "x-forwarded-for" ? trust : false,
  });
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 3000),
    fetch: (req, srv) => handle(req, srv.requestIP(req)?.address),
  });
  setInterval(() => forgetVisitors(db), 60 * 60 * 1000); // раз в час
  console.log(`redirect: http://localhost:${server.port}/r/<slug> → t.me/${bot}`);
}
