// Код к главе 2.5 книги «Из продукта в бизнес»: эксперименты на малых числах.
// Bun + bun:sqlite. Для better-sqlite3 замените db.run(sql, [..]) на db.prepare(sql).run(..).
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export type Variant = "A" | "B";

// ---------- Разбиение на группы ----------

/** Число от 0 до 2³²−1 из строки: первые 4 байта SHA-256. Одинаково на любой машине, в Bun и Node. */
export function hash32(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32BE(0);
}

/**
 * Детерминированная группа: один и тот же человек в одном эксперименте всегда попадает в одну группу.
 * Имя эксперимента входит в хеш, поэтому разные эксперименты делят людей независимо.
 * shareB — доля группы B (по умолчанию половина).
 */
export function assignVariant(experiment: string, userId: number, shareB = 0.5): Variant {
  const bucket = hash32(`${experiment}:${userId}`) % 10_000; // 0…9999
  return bucket < Math.round(shareB * 10_000) ? "B" : "A";
}

/**
 * Чередование по неделям по шаблону: "AB" — A, B, A, B…; "ABBA" — A, B, B, A, A, B, B, A…
 * ("ABBA" гасит плавный рост или спад аудитории, который при "AB" всегда играет за B).
 * Нужно, когда вариант нельзя показать части людей: описание бота, текст в профиле, цена для всех.
 * Недели — с понедельника по UTC, как когорты в главе 2.3; стартуйте в понедельник.
 * День переключения (понедельник) запрос by_week из анализа выбрасывает.
 */
export function variantByWeek(startedAt: string, at: string, pattern = "AB"): Variant {
  const monday = (d: string) => {
    const t = new Date(d.replace(" ", "T") + (d.length > 10 ? "Z" : "T00:00:00Z"));
    const day = (t.getUTCDay() + 6) % 7; // 0 = понедельник
    return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - day);
  };
  const weeks = Math.round((monday(at) - monday(startedAt)) / (7 * 86_400_000));
  if (weeks < 0) throw new Error("дата раньше старта эксперимента");
  return pattern[weeks % pattern.length] as Variant;
}

/**
 * Записать группу человека (один раз) и вернуть её.
 * Вызывайте в момент, когда человек впервые встречает изменение, — для онбординга это первый /start.
 * Если строка уже есть, возвращается записанная группа, даже если правило разбиения с тех пор поменяли.
 */
export function assign(db: Database, experiment: string, userId: number, variant?: Variant): Variant {
  const v = variant ?? assignVariant(experiment, userId);
  db.run(
    `INSERT OR IGNORE INTO experiment_assignments (experiment, telegram_id, variant, assigned_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [experiment, userId, v],
  );
  const row = db
    .query("SELECT variant FROM experiment_assignments WHERE experiment = ? AND telegram_id = ?")
    .get(experiment, userId) as { variant: Variant };
  return row.variant;
}

/** Идёт ли эксперимент: есть карточка, старт наступил, конца нет или он не наступил. */
export function isRunning(db: Database, experiment: string): boolean {
  const row = db
    .query(
      `SELECT 1 AS ok FROM experiments WHERE name = ? AND started_at <= datetime('now')
         AND (ended_at IS NULL OR ended_at > datetime('now'))`,
    )
    .get(experiment);
  return row !== null;
}

// ---------- Интервалы ----------

export type Interval = { p: number; low: number; high: number };

/** z для 95 % (в тексте главы округлено до 1,96). */
export const Z95 = 1.959964;

/**
 * Интервал Уилсона для доли x из n (Wilson, 1927), по умолчанию 95 %.
 * В отличие от «p ± 2·√(p(1−p)/n)» не вылезает за 0 и 1 и не схлопывается при x = 0.
 */
export function wilson(x: number, n: number, z = Z95): Interval {
  if (n <= 0) return { p: NaN, low: 0, high: 1 };
  const p = x / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/**
 * Интервал для разницы долей pB − pA по методу Ньюкомба (1998, «гибридный» Уилсон, метод 10).
 * Тот же метод по умолчанию в statsmodels: confint_proportions_2indep(method="newcomb").
 */
export function diffInterval(xA: number, nA: number, xB: number, nB: number, z = Z95): Interval {
  const a = wilson(xA, nA, z);
  const b = wilson(xB, nB, z);
  const d = b.p - a.p;
  const low = d - Math.sqrt((b.p - b.low) ** 2 + (a.high - a.p) ** 2);
  const high = d + Math.sqrt((b.high - b.p) ** 2 + (a.p - a.low) ** 2);
  return { p: d, low, high };
}

// ---------- Сколько людей нужно ----------

/** Квантиль стандартного нормального распределения (алгоритм Акклама, точность ~1e-9). */
export function normInv(q: number): number {
  if (q <= 0 || q >= 1) throw new Error("q вне (0, 1)");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (q < lo) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 1 - lo) return -normInv(1 - q);
  const r = q - 0.5;
  const s = r * r;
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

/**
 * Правило Лера (van Belle, «Statistical Rules of Thumb», разд. 2.9): n ≈ 16·p̄(1−p̄)/(pA−pB)² на группу
 * при α = 0,05 (двусторонний) и мощности 80 %. Автор: приближение хорошее, когда n выходит от 10 до 100.
 */
export function lehrPerArm(pA: number, pB: number): number {
  const pbar = (pA + pB) / 2;
  return Math.ceil((16 * pbar * (1 - pbar)) / (pA - pB) ** 2 - 1e-9); // −1e-9: 64,0000001 — это 64
}

/** Формула нормального приближения с объединённой долей p̄ для двух долей; для больших n точнее правила Лера. */
export function sampleSizePerArm(pA: number, pB: number, alpha = 0.05, power = 0.8): number {
  const za = normInv(1 - alpha / 2);
  const zb = normInv(power);
  const pbar = (pA + pB) / 2;
  const num = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(pA * (1 - pA) + pB * (1 - pB));
  return Math.ceil(num ** 2 / (pA - pB) ** 2 - 1e-9);
}

/**
 * Вариант формулы, где дисперсия «без эффекта» берётся по базовой доле pA, а не по средней p̄.
 * Так считает калькулятор Эвана Миллера (evanmiller.org/ab-testing/sample-size-fixed.js, проверено 28.09.2026);
 * при росте доли выходит на 5–20 % меньше, чем по p̄. Возвращает дробное число, как у Миллера до округления.
 */
export function sampleSizeBaselineVariance(pA: number, delta: number, alpha = 0.05, power = 0.8): number {
  let p = pA;
  if (p > 0.5) p = 1 - p;
  const za = normInv(1 - alpha / 2);
  const zb = normInv(power);
  const sd1 = Math.sqrt(2 * p * (1 - p));
  const sd2 = Math.sqrt(p * (1 - p) + (p + delta) * (1 - p - delta));
  return (za * sd1 + zb * sd2) ** 2 / delta ** 2;
}

// ---------- Правило решения ----------

export type Counts = { xA: number; nA: number; xB: number; nB: number };

/**
 * Проверка разбиения (sample ratio mismatch): при доле B = shareB число людей в B
 * не должно отличаться от ожидаемого больше чем на три стандартных отклонения
 * (при двух честное разбиение «ломалось» бы случайно в ~4,6 % экспериментов, при трёх — в ~0,3 %).
 * При 50/50 это то же, что |nA − nB| > 3·√(nA + nB). Сработала — сначала ищите ошибку в коде, потом читайте итог.
 */
export function splitLooksBroken(nA: number, nB: number, shareB = 0.5): boolean {
  const n = nA + nB;
  if (n === 0) return false;
  return Math.abs(nB - n * shareB) > 3 * Math.sqrt(n * shareB * (1 - shareB));
}

export type Decision = "check_split" | "too_early" | "ship" | "rollback" | "tie";

/**
 * Правило решения, записанное до старта. Вызывайте один раз — в дату итога из карточки.
 * harm — большой вред, который данные должны исключить (−0,15 = 15 пунктов; при ~150–200 в группе
 * интервал разницы около ±10–11 пунктов, и порог ближе к нулю откатывал бы и нейтральные правки).
 * check_split — разбиение подозрительно, сначала ищите ошибку;
 * too_early — в какой-то группе меньше minPerArm: вызвали раньше срока;
 * ship — весь интервал выше нуля; rollback — весь ниже нуля или большой вред не исключён;
 * tie — ноль внутри, большой вред исключён: действует записанное в карточке «при ничьей оставляем…».
 */
export function decide(
  c: Counts,
  opts: { harm?: number; minPerArm?: number; shareB?: number } = {},
): Decision {
  const { harm = -0.15, minPerArm = 0, shareB = 0.5 } = opts;
  if (splitLooksBroken(c.nA, c.nB, shareB)) return "check_split";
  if (Math.min(c.nA, c.nB) < minPerArm) return "too_early";
  const d = diffInterval(c.xA, c.nA, c.xB, c.nB);
  if (d.low > 0) return "ship";
  if (d.high < 0) return "rollback";
  if (d.low > harm) return "tie";
  return "rollback";
}

/**
 * Досрочная остановка по ограничительной метрике (блокировки и т. п.), проверка раз в неделю:
 * в B не меньше minEvents событий и весь интервал разницы долей (B − A) выше threshold.
 */
export function guardrailStop(c: Counts, minEvents = 10, threshold = 0): boolean {
  if (c.xB < minEvents) return false;
  return diffInterval(c.xA, c.nA, c.xB, c.nB).low > threshold;
}

/**
 * Критерий знаков для чередования недель: вероятность, что B выиграет не меньше wins пар из pairs
 * случайно, если разницы нет. 2 из 2 — 1/4, 5 из 5 — 1/32 ≈ 3 %.
 */
export function signTestP(wins: number, pairs: number): number {
  let sum = 0;
  let c = 1; // C(pairs, 0)
  for (let k = 0; k <= pairs; k++) {
    if (k >= wins) sum += c;
    c = (c * (pairs - k)) / (k + 1);
  }
  return sum / 2 ** pairs;
}

export type FakeDoorDecision = "build" | "not_now" | "wait";

/**
 * Правило для фальшивой двери, записанное до старта: нижняя граница Уилсона выше build (5 %) — делаем;
 * верхняя ниже notNow (10 %) — не в этом квартале; иначе ждём, пока кнопку увидят waitFor (80) человек,
 * и решаем по тем же границам; если и тогда неясно — «not_now» до новой гипотезы.
 * При 40 увидевших «не делаем» выходит только при нуле нажатий, при 80 — при двух и меньше.
 */
export function fakeDoorDecision(clicked: number, seen: number, build = 0.05, notNow = 0.1, waitFor = 80): FakeDoorDecision {
  const w = wilson(clicked, seen);
  if (w.low > build) return "build";
  if (w.high < notNow) return "not_now";
  return seen >= waitFor ? "not_now" : "wait";
}

/** Доли в процентах с одним знаком для отчёта. */
export const pct = (x: number) => Math.round(x * 1000) / 10;
