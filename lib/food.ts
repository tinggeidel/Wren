// Feature C — structured food + water logging.
//
// The whole point: a day's consumed calories/macros are SUMMED IN CODE from real
// FoodEntry records, exactly like targets are computed in code. The Coach reads
// these totals (and writes new entries via tool use) but never invents them — the
// durable fix for the old "you have 25 cal left" hallucination bug.

import {
  Profile,
  FoodEntry,
  Macros,
  FoodSource,
  SavedFood,
  SavedMeal,
} from "./types";
import { toISODate } from "./cycle";

export const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

// --- Local store helpers (all pure: return a new Profile) ---------------------

export function entriesFor(p: Profile, date: string): FoodEntry[] {
  return p.foodLogs?.[date] ?? [];
}

// A day's consumed totals — a plain deterministic sum, never an estimate.
// Entries logged BEFORE fiber tracking existed don't have e.fiber set; the
// `?? 0` rule treats them as zero contributors so older days don't suddenly
// show stale numbers.
export function consumedTotals(p: Profile, date: string): Macros {
  return entriesFor(p, date).reduce(
    (acc, e) => ({
      calories: acc.calories + (e.calories || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
      fiber: acc.fiber + (e.fiber ?? 0),
    }),
    { ...ZERO }
  );
}

export function remaining(consumed: Macros, target: Macros): Macros {
  return {
    calories: Math.round(target.calories - consumed.calories),
    protein: Math.round(target.protein - consumed.protein),
    carbs: Math.round(target.carbs - consumed.carbs),
    fat: Math.round(target.fat - consumed.fat),
    fiber: Math.round(target.fiber - consumed.fiber),
  };
}

// Recently logged foods (most recent first, de-duped by name) for one-tap re-log.
export function recentFoods(p: Profile, limit = 12): FoodEntry[] {
  const all = Object.values(p.foodLogs ?? {})
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);
  const seen = new Set<string>();
  const out: FoodEntry[] = [];
  for (const e of all) {
    const key = (e.name + (e.brand ?? "")).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

let idSeq = 0;
export function newId(): string {
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

// Build a complete FoodEntry from a partial (fills id/date/source/createdAt).
// Fiber is optional — when omitted, the entry persists without a fiber field
// (which the back-compat `?? 0` in consumedTotals handles) rather than
// pretending the food has zero fiber. Sources that DO supply fiber (OFF
// search/barcode, the Coach's log_food, manual entry once the UI exposes it)
// will pass a number through.
export function makeEntry(
  partial: Omit<
    FoodEntry,
    "id" | "createdAt" | "date" | "source" | "protein" | "carbs" | "fat" | "fiber"
  > & {
    date?: string;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
  },
  source: FoodSource
): FoodEntry {
  return {
    id: newId(),
    date: partial.date ?? toISODate(new Date()),
    createdAt: Date.now(),
    source,
    ...partial,
    name: partial.name.trim(),
    calories: Math.round(partial.calories || 0),
    protein: Math.round(partial.protein || 0),
    carbs: Math.round(partial.carbs || 0),
    fat: Math.round(partial.fat || 0),
    fiber: typeof partial.fiber === "number" ? Math.round(partial.fiber) : undefined,
  };
}

export function addEntry(p: Profile, entry: FoodEntry): Profile {
  const foodLogs = { ...(p.foodLogs ?? {}) };
  foodLogs[entry.date] = [...(foodLogs[entry.date] ?? []), entry];
  return { ...p, foodLogs };
}

export function updateEntry(p: Profile, entry: FoodEntry): Profile {
  const foodLogs = { ...(p.foodLogs ?? {}) };
  foodLogs[entry.date] = (foodLogs[entry.date] ?? []).map((e) => (e.id === entry.id ? entry : e));
  return { ...p, foodLogs };
}

export function removeEntry(p: Profile, date: string, id: string): Profile {
  const foodLogs = { ...(p.foodLogs ?? {}) };
  const next = (foodLogs[date] ?? []).filter((e) => e.id !== id);
  if (next.length) foodLogs[date] = next;
  else delete foodLogs[date];
  return { ...p, foodLogs };
}

// --- Saved foods & meals (Feature: My Meals / Saved foods) --------------------

// A reusable SavedFood template from anything with macros (entry, hit, draft).
// Fiber is optional throughout: if the source carries fiber it's persisted as
// a whole-gram number; if not (older entries / hand-entered foods without it),
// the field is left undefined and re-log paths will simply skip fiber for that
// item rather than fabricate a zero.
export function toSavedFood(src: {
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  quantityLabel?: string;
  per100g?: { calories: number; protein: number; carbs: number; fat: number; fiber?: number };
  barcode?: string;
}): SavedFood {
  return {
    id: newId(),
    name: src.name.trim(),
    brand: src.brand,
    calories: Math.round(src.calories || 0),
    protein: Math.round(src.protein || 0),
    carbs: Math.round(src.carbs || 0),
    fat: Math.round(src.fat || 0),
    fiber: typeof src.fiber === "number" ? Math.round(src.fiber) : undefined,
    quantityLabel: src.quantityLabel,
    per100g: src.per100g,
    barcode: src.barcode,
  };
}

const sameFood = (a: SavedFood, b: SavedFood) =>
  (a.name + (a.brand ?? "")).trim().toLowerCase() === (b.name + (b.brand ?? "")).trim().toLowerCase();

export function isFoodSaved(p: Profile, food: SavedFood): boolean {
  return (p.savedFoods ?? []).some((s) => sameFood(s, food));
}

// Save (or refresh) a favorite food, most-recent first, deduped by name+brand.
export function saveFood(p: Profile, food: SavedFood): Profile {
  const rest = (p.savedFoods ?? []).filter((s) => !sameFood(s, food));
  return { ...p, savedFoods: [food, ...rest].slice(0, 100) };
}

export function removeSavedFood(p: Profile, id: string): Profile {
  return { ...p, savedFoods: (p.savedFoods ?? []).filter((s) => s.id !== id) };
}

export function saveMeal(p: Profile, meal: SavedMeal): Profile {
  const rest = (p.savedMeals ?? []).filter((m) => m.id !== meal.id);
  return { ...p, savedMeals: [meal, ...rest] };
}

export function removeSavedMeal(p: Profile, id: string): Profile {
  return { ...p, savedMeals: (p.savedMeals ?? []).filter((m) => m.id !== id) };
}

// Build a loggable FoodEntry from a saved food. Fiber threads through when the
// saved food has it (newer saves); older saves without fiber pass undefined and
// the resulting entry won't contribute to the day's fiber sum.
export function entryFromSaved(
  s: SavedFood,
  date: string,
  source: FoodSource = "saved"
): FoodEntry {
  return makeEntry(
    {
      name: s.name,
      brand: s.brand,
      quantityLabel: s.quantityLabel,
      calories: s.calories,
      protein: s.protein,
      carbs: s.carbs,
      fat: s.fat,
      fiber: s.fiber,
      per100g: s.per100g,
      barcode: s.barcode,
      date,
    },
    source
  );
}

// --- Water --------------------------------------------------------------------

export function waterFor(p: Profile, date: string): number {
  return p.waterLogs?.[date] ?? 0;
}

export function setWater(p: Profile, date: string, cups: number): Profile {
  const waterLogs = { ...(p.waterLogs ?? {}) };
  const v = Math.max(0, Math.round(cups));
  if (v === 0) delete waterLogs[date];
  else waterLogs[date] = v;
  return { ...p, waterLogs };
}

export function addWater(p: Profile, date: string, delta: number): Profile {
  return setWater(p, date, waterFor(p, date) + delta);
}

// --- Open Food Facts (free, no key) ------------------------------------------
// Search + barcode lookup. We normalize the messy crowdsourced data into a tidy
// FoodHit; the UI then lets her pick a quantity, and scaleHit() does the math.

const OFF_HEADERS = { "User-Agent": "FluxApp/0.1 (solo prototype)" };

export type FoodHit = {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  per100g: Macros | null; // basis for gram math (null if OFF lacks usable kcal)
  serving: { grams: number; label: string } | null;
};

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isNaN(n) ? null : n;
}

type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: string | number;
  nutriments?: Record<string, unknown>;
};

function toHit(prod: OffProduct): FoodHit | null {
  const name = (prod.product_name_en || prod.product_name || "").trim();
  if (!name) return null;
  const n = prod.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]);
  let per100g: Macros | null = null;
  if (kcal != null) {
    per100g = {
      calories: kcal,
      protein: num(n["proteins_100g"]) ?? 0,
      carbs: num(n["carbohydrates_100g"]) ?? 0,
      fat: num(n["fat_100g"]) ?? 0,
      // OFF stores fiber under `fiber_100g` (same shape as protein/fat). Many
      // crowdsourced records leave it blank; treat missing as 0 so scaleHit
      // produces a real number rather than NaN.
      fiber: num(n["fiber_100g"]) ?? 0,
    };
  }
  const sg = num(prod.serving_quantity);
  const serving = sg && sg > 0 ? { grams: sg, label: (prod.serving_size ?? `${sg} g`).trim() } : null;
  return {
    id: prod.code || name,
    name,
    brand: (prod.brands ?? "").split(",")[0]?.trim() || undefined,
    barcode: prod.code,
    per100g,
    serving,
  };
}

// Macros for `grams` of a hit (rounded). Falls back to ZERO if no per-100g data.
// Fiber scales linearly like the other macros.
export function scaleHit(hit: FoodHit, grams: number): Macros {
  if (!hit.per100g) return { ...ZERO };
  const f = grams / 100;
  return {
    calories: Math.round(hit.per100g.calories * f),
    protein: Math.round(hit.per100g.protein * f),
    carbs: Math.round(hit.per100g.carbs * f),
    fat: Math.round(hit.per100g.fat * f),
    fiber: Math.round(hit.per100g.fiber * f),
  };
}

const FIELDS = "code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments";

// fetch with a hard timeout so a slow/blocked host fails fast and we can fall back.
async function fetchOff(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: OFF_HEADERS, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function hitsFrom(products: OffProduct[] | undefined): FoodHit[] {
  return (products ?? []).map(toHit).filter((h): h is FoodHit => !!h && !!h.per100g);
}

export async function searchFoods(query: string): Promise<FoodHit[]> {
  const q = query.trim();
  if (!q) return [];

  // Primary: OFF's "Search-a-licious" host — fast and relevance-ranks mainstream
  // US products to the top (greek yogurt -> Chobani). Bounded by a timeout.
  try {
    const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=30&fields=${FIELDS}`;
    const res = await fetchOff(url, 4000);
    if (res.ok) {
      const data = (await res.json()) as { hits?: OffProduct[] };
      const hits = hitsFrom(data.hits);
      if (hits.length) return hits;
    }
  } catch {
    // fall through to the world host
  }

  // Fallback: the `world` host (proven reachable on-device) filtered to US-sold
  // products. cgi/search.pl gets rate-limited (503), so retry once.
  const cgi =
    "https://world.openfoodfacts.org/cgi/search.pl?" +
    `search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&` +
    `tagtype_0=countries&tag_contains_0=contains&tag_0=united-states&fields=${FIELDS}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetchOff(cgi, 9000);
    } catch {
      res = null;
    }
    if (res?.ok) {
      const data = (await res.json()) as { products?: OffProduct[] };
      return hitsFrom(data.products);
    }
    if (res && res.status < 500) break; // 4xx won't fix on retry
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("Open Food Facts unreachable");
}

// Look up a scanned barcode. Returns null if OFF doesn't know the product.
export async function lookupBarcode(code: string): Promise<FoodHit | null> {
  const url =
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?` +
    "fields=code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments";
  const res = await fetch(url, { headers: OFF_HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  const hit = toHit(data.product);
  return hit && hit.per100g ? hit : null;
}
