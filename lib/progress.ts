// Progress-tab data aggregation — pure helpers over Profile, no UI.
//
// The Progress redesign (brand/progresstab/wren_progress_redesign.html) shows
// four range views (week / month / year / all). The mockup fills every number
// with a random `seeded()` demo generator; THIS module replaces that with real
// data from the profile, or honest empties. Every function here is pure and
// deterministic — it only reads the profile and a range offset.
//
// Ranges are stepped by an integer `off` (0 = current period, 1 = previous, …);
// the screen never lets `off` go negative, so we never look into the future.

import { Profile, DayLog } from "./types";
import { toISODate, parseISO, addDays, daysBetween, cycleStarts, cycleLengthSeries } from "./cycle";
import { workoutsFor } from "./workouts";

// --- Mood family mapping ---------------------------------------------------
// MOOD_OPTIONS has 9 moods; the mockup's mood viz uses 4 color families
// (calm / happy / sensitive / stressed). This is the single source of truth for
// that bucketing — reused for the dots AND any "mostly X" headline. Stored mood
// strings are the human labels from MOOD_OPTIONS (e.g. "Happy", "Irritable").
export type MoodFamily = "calm" | "happy" | "sensitive" | "stressed";

export const MOOD_FAMILY: Record<string, MoodFamily> = {
  // calm family — settled, low-arousal positive/neutral
  Calm: "calm",
  Foggy: "calm",
  // happy family — bright, motivated, high-arousal positive
  Happy: "happy",
  Motivated: "happy",
  // sensitive family — tender, low, inward
  Sad: "sensitive",
  Sensitive: "sensitive",
  // stressed family — activated, on-edge, anxious
  Irritable: "stressed",
  Anxious: "stressed",
  Stressed: "stressed",
};

// Reduce one day's logged moods to a single family. A day can carry several
// moods; we pick the "loudest" one so the timeline reads honestly — stressed and
// sensitive (the ones worth planning around) win over calm/happy when mixed.
const FAMILY_PRIORITY: MoodFamily[] = ["stressed", "sensitive", "happy", "calm"];

export function dayMoodFamily(log: DayLog | undefined): MoodFamily | null {
  const moods = log?.moods ?? [];
  if (!moods.length) return null;
  const families = moods
    .map((m) => MOOD_FAMILY[m])
    .filter((f): f is MoodFamily => !!f);
  if (!families.length) return null;
  for (const fam of FAMILY_PRIORITY) {
    if (families.includes(fam)) return fam;
  }
  return families[0];
}

// --- Range windows ---------------------------------------------------------
// A window is just [startISO, endISO] inclusive. `off` steps it backward.

export type DateWindow = { start: string; end: string };

// Monday of the week containing `iso`.
function mondayOfISO(iso: string): string {
  const d = parseISO(iso);
  const day = d.getDay(); // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day;
  return addDays(iso, shift);
}

export function weekWindow(todayISO: string, off: number): DateWindow {
  const thisMon = mondayOfISO(todayISO);
  const start = addDays(thisMon, -7 * off);
  return { start, end: addDays(start, 6) };
}

// Calendar month window, stepped back by `off` whole months.
export function monthWindow(todayISO: string, off: number): DateWindow {
  const d = parseISO(todayISO);
  const y = d.getFullYear();
  const m = d.getMonth() - off;
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return { start: toISODate(first), end: toISODate(last) };
}

// Calendar year window, stepped back by `off` whole years.
export function yearWindow(todayISO: string, off: number): DateWindow {
  const y = parseISO(todayISO).getFullYear() - off;
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function inWindow(iso: string, w: DateWindow): boolean {
  return iso >= w.start && iso <= w.end;
}

// --- Workout / movement aggregation ---------------------------------------
// We read directly from workoutLogs (the durable record of completed sessions),
// not from the plan's loggedEntryId flags — the plan only holds the CURRENT
// week, while workoutLogs persists every logged session across all history.

function allWorkoutDates(p: Profile): string[] {
  return Object.keys(p.workoutLogs ?? {});
}

// Minutes moved on a date = sum of session durations (0 if none/untimed).
function minutesOn(p: Profile, iso: string): number {
  return workoutsFor(p, iso).reduce((s, e) => s + (e.durationMin ?? 0), 0);
}

// Sessions logged on a date.
function sessionsOn(p: Profile, iso: string): number {
  return workoutsFor(p, iso).length;
}

// Per-day minutes Mon..Sun for a week window.
export function weekMovementByDay(p: Profile, w: DateWindow): number[] {
  return Array.from({ length: 7 }, (_, i) => minutesOn(p, addDays(w.start, i)));
}

// Per-day session counts Mon..Sun.
export function weekSessionsByDay(p: Profile, w: DateWindow): number[] {
  return Array.from({ length: 7 }, (_, i) => sessionsOn(p, addDays(w.start, i)));
}

// Sessions per ISO-week within a month window (the mockup's "weeks 1–4" bars).
// We split the month into rolling 7-day buckets from the 1st; the last bucket
// may be short. Returns one count per bucket.
export function monthSessionsByWeek(p: Profile, w: DateWindow): number[] {
  const totalDays = daysBetween(w.start, w.end) + 1;
  const buckets = Math.ceil(totalDays / 7);
  const out = Array(buckets).fill(0) as number[];
  for (let i = 0; i < totalDays; i++) {
    const iso = addDays(w.start, i);
    out[Math.floor(i / 7)] += sessionsOn(p, iso);
  }
  return out;
}

// Sessions per calendar month (Jan..Dec) within a year window.
export function yearSessionsByMonth(p: Profile, w: DateWindow): number[] {
  const out = Array(12).fill(0) as number[];
  for (const iso of allWorkoutDates(p)) {
    if (!inWindow(iso, w)) continue;
    const mo = parseISO(iso).getMonth();
    out[mo] += sessionsOn(p, iso);
  }
  return out;
}

export function sessionsInWindow(p: Profile, w: DateWindow): number {
  let n = 0;
  for (const iso of allWorkoutDates(p)) {
    if (inWindow(iso, w)) n += sessionsOn(p, iso);
  }
  return n;
}

export function minutesInWindow(p: Profile, w: DateWindow): number {
  let n = 0;
  for (const iso of allWorkoutDates(p)) {
    if (inWindow(iso, w)) n += minutesOn(p, iso);
  }
  return n;
}

// Which days in a week window had at least one logged session (for WeekDots).
export function weekLoggedDays(p: Profile, w: DateWindow): boolean[] {
  return Array.from({ length: 7 }, (_, i) => sessionsOn(p, addDays(w.start, i)) > 0);
}

// --- Mood aggregation ------------------------------------------------------
// Per-day mood family across a window. Days with no logged mood are null (the
// timeline renders them as a neutral gap, never a fabricated mood).
export function moodFamiliesInWindow(p: Profile, w: DateWindow): (MoodFamily | null)[] {
  const logs = p.dayLogs ?? {};
  const days = daysBetween(w.start, w.end) + 1;
  return Array.from({ length: days }, (_, i) => {
    const iso = addDays(w.start, i);
    return dayMoodFamily(logs[iso]);
  });
}

// The dominant logged family in a window + a count, for the "mostly X" headline.
// Returns null when nothing was logged.
export function dominantMood(
  families: (MoodFamily | null)[]
): { family: MoodFamily; share: number; logged: number } | null {
  const counts: Record<MoodFamily, number> = { calm: 0, happy: 0, sensitive: 0, stressed: 0 };
  let logged = 0;
  for (const f of families) {
    if (f) {
      counts[f] += 1;
      logged += 1;
    }
  }
  if (!logged) return null;
  let best: MoodFamily = "calm";
  (Object.keys(counts) as MoodFamily[]).forEach((f) => {
    if (counts[f] > counts[best]) best = f;
  });
  return { family: best, share: counts[best] / logged, logged };
}

export const MOOD_FAMILY_LABEL: Record<MoodFamily, string> = {
  calm: "calm",
  happy: "happy",
  sensitive: "sensitive",
  stressed: "stressed",
};

// --- Weight bucketing (ED-safety: averaged only, never day-to-day) ---------
// Bucket weight entries by ISO-week (week/month view) or calendar-month (year/
// all view) and average each bucket, then plot the bucket averages. The chart
// NEVER sees a raw daily point. Buckets are returned oldest→newest with a label.
export type WeightBucket = { key: string; label: string; avg: number };

function weekKey(iso: string): string {
  // Monday-anchored ISO week key, good enough for grouping + sorting.
  return mondayOfISO(iso);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

export function bucketWeights(
  p: Profile,
  cadence: "weekly" | "monthly"
): WeightBucket[] {
  const log = [...(p.weightLog ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!log.length) return [];
  const groups = new Map<string, number[]>();
  for (const e of log) {
    const key = cadence === "weekly" ? weekKey(e.date) : monthKey(e.date);
    const arr = groups.get(key) ?? [];
    arr.push(e.lbs);
    groups.set(key, arr);
  }
  const keys = [...groups.keys()].sort();
  return keys.map((key) => {
    const vals = groups.get(key)!;
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    const label =
      cadence === "weekly"
        ? parseISO(key).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : parseISO(key + "-01").toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    return { key, label, avg };
  });
}

// --- Days-logged percentage (all-time totals card) -------------------------
// A day "counts as logged" if it has ANY trace: a dayLog, a workout, or a food
// entry. Percentage is over the span from first activity to today.
export function daysLoggedStats(p: Profile, todayISO: string): { pct: number; logged: number; span: number } | null {
  const logged = new Set<string>();
  Object.keys(p.dayLogs ?? {}).forEach((d) => logged.add(d));
  Object.keys(p.workoutLogs ?? {}).forEach((d) => logged.add(d));
  Object.keys(p.foodLogs ?? {}).forEach((d) => logged.add(d));
  (p.weightLog ?? []).forEach((w) => logged.add(w.date));
  if (!logged.size) return null;
  const first = [...logged].sort()[0];
  const span = Math.max(1, daysBetween(first, todayISO) + 1);
  const within = [...logged].filter((d) => d >= first && d <= todayISO).length;
  return { pct: Math.round((within / span) * 100), logged: within, span };
}

// --- Earliest datapoint (the all-time "since <month>" label) ---------------
// Earliest of plan history starts / weightLog / photoLog / cycle starts / mood
// (dayLog) dates / workout dates / food dates. Null when there's no data at all.
export function earliestDataISO(p: Profile): string | null {
  const candidates: string[] = [];
  (p.plan?.history ?? []).forEach((w) => candidates.push(w.startDate));
  if (p.plan?.current) candidates.push(p.plan.current.startDate);
  (p.weightLog ?? []).forEach((w) => candidates.push(w.date));
  (p.photoLog ?? []).forEach((e) => candidates.push(e.date));
  cycleStarts(p).forEach((s) => candidates.push(s));
  Object.keys(p.dayLogs ?? {}).forEach((d) => candidates.push(d));
  Object.keys(p.workoutLogs ?? {}).forEach((d) => candidates.push(d));
  Object.keys(p.foodLogs ?? {}).forEach((d) => candidates.push(d));
  if (!candidates.length) return null;
  return candidates.sort()[0];
}

// --- All-time movement-by-month series + labels ----------------------------
// Sessions per month from the earliest datapoint's month through this month.
export function allTimeSessionsByMonth(
  p: Profile,
  todayISO: string
): { data: number[]; labels: string[] } {
  const first = earliestDataISO(p);
  if (!first) return { data: [], labels: [] };
  const startMonth = new Date(parseISO(first).getFullYear(), parseISO(first).getMonth(), 1);
  const today = parseISO(todayISO);
  const endMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const data: number[] = [];
  const labels: string[] = [];
  const cursor = new Date(startMonth);
  let guard = 0;
  while (cursor <= endMonth && guard < 240) {
    const wStart = toISODate(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    const wEnd = toISODate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    data.push(sessionsInWindow(p, { start: wStart, end: wEnd }));
    labels.push(cursor.toLocaleDateString(undefined, { month: "narrow" }));
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  return { data, labels };
}

// --- Cycle rings data (month/year/all) -------------------------------------
// Real observed cycle lengths, newest few, with the current (most recent) cycle
// flagged. Returns [] on BC / no data (the screen falls back to the BC-safe
// look-back card and shows no rings). Day shown = the observed length.
export type CycleRingPoint = { month: string; day: number; cur?: boolean };

export function cycleRingPoints(p: Profile, max = 4): CycleRingPoint[] {
  if (p.onBirthControl) return [];
  const series = cycleLengthSeries(p).slice(-max);
  if (!series.length) return [];
  return series.map((pt, i) => ({
    month: parseISO(pt.start).toLocaleDateString(undefined, { month: "short" }),
    day: pt.length,
    cur: i === series.length - 1,
  }));
}
