import { Profile } from "./types";

export type PhaseInfo = {
  phase: string; // human-readable phase name
  dayOfCycle: number | null; // null if on birth control or no date set
  onBirthControl: boolean;
};

export type PeriodRange = { start: string; end: string; length: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Convert a Date to a "YYYY-MM-DD" string in the device's local time.
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a "YYYY-MM-DD" string as a local-midnight Date.
export function parseISO(s: string): Date {
  return new Date(s + "T00:00:00");
}

// Shift an ISO date by n days (n may be negative).
export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Whole days from a to b (b - a). Negative if b is before a.
export function daysBetween(aISO: string, bISO: string): number {
  return Math.round((parseISO(bISO).getTime() - parseISO(aISO).getTime()) / MS_PER_DAY);
}

// --- History (Feature B) -----------------------------------------------------

// All logged period (bleed) days, sorted ascending — every day whose check-in has
// a `flow`. Falls back to the legacy single lastPeriodStart only while no check-in
// marks a period, so existing users keep a working phase until they log on the
// new calendar.
export function periodDays(p: Profile): string[] {
  const logs = p.dayLogs ?? {};
  const bleed = Object.keys(logs)
    .filter((d) => !!logs[d]?.flow)
    .sort();
  if (bleed.length) return bleed;
  return p.lastPeriodStart ? [p.lastPeriodStart] : [];
}

// Group consecutive period days into bleed ranges. The first day of each range
// is a cycle start.
export function periodRanges(p: Profile): PeriodRange[] {
  const days = periodDays(p);
  const ranges: PeriodRange[] = [];
  for (const d of days) {
    const last = ranges[ranges.length - 1];
    if (last && daysBetween(last.end, d) === 1) {
      last.end = d;
      last.length += 1;
    } else {
      ranges.push({ start: d, end: d, length: 1 });
    }
  }
  return ranges;
}

export function cycleStarts(p: Profile): string[] {
  return periodRanges(p).map((r) => r.start);
}

// Gaps (days) between consecutive cycle starts, filtered to plausible values so a
// single mis-tap can't wreck the average.
export function cycleLengths(p: Profile): number[] {
  const starts = cycleStarts(p);
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) gaps.push(daysBetween(starts[i - 1], starts[i]));
  return gaps.filter((g) => g >= 15 && g <= 60);
}

export type CycleStats = { length: number; fromHistory: boolean; cycles: number };

// Observed average cycle length from history (last up to 6 cycles), or the
// user's stated prior when there isn't enough logged yet.
export function observedCycleLength(p: Profile): CycleStats {
  const gaps = cycleLengths(p);
  if (gaps.length >= 1) {
    const recent = gaps.slice(-6);
    const avg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
    return { length: avg, fromHistory: true, cycles: gaps.length };
  }
  const fallback = p.avgCycleLength > 0 ? p.avgCycleLength : 28;
  return { length: fallback, fromHistory: false, cycles: 0 };
}

// Typical bleed length from history (for drawing predicted periods), fallback 5.
export function observedPeriodLength(p: Profile): number {
  const lens = periodRanges(p)
    .map((r) => r.length)
    .filter((l) => l >= 1 && l <= 10)
    .slice(-6);
  if (!lens.length) return 5;
  return Math.max(2, Math.round(lens.reduce((a, b) => a + b, 0) / lens.length));
}

// --- Phase math --------------------------------------------------------------
// IMPORTANT: Flux treats phase windows as *defaults* ("many women find..."),
// not rules. The Coach defers to how the user actually feels.

function phaseName(day: number, len: number): string {
  const scale = len / 28;
  if (day <= 5 * scale) return "menstrual";
  if (day <= 13 * scale) return "follicular";
  if (day <= 16 * scale) return "ovulatory";
  return "luteal";
}

// Phase for an arbitrary date. Each *past* cycle is measured by its own real
// length (gap to the next logged start); the current/future cycle is projected
// with the observed average. Dates before the first logged period are unknown.
export function phaseForDate(p: Profile, date: Date): PhaseInfo {
  if (p.onBirthControl) {
    return { phase: "on birth control", dayOfCycle: null, onBirthControl: true };
  }
  const starts = cycleStarts(p);
  if (!starts.length) {
    return { phase: "unknown", dayOfCycle: null, onBirthControl: false };
  }

  const iso = toISODate(date);
  let i = -1;
  for (let k = 0; k < starts.length; k++) {
    if (starts[k] <= iso) i = k;
    else break;
  }
  if (i === -1) {
    // Before her first logged period — we don't claim to know.
    return { phase: "unknown", dayOfCycle: null, onBirthControl: false };
  }

  const anchor = starts[i];
  const nextStart = i + 1 < starts.length ? starts[i + 1] : null;
  const thisLen = nextStart
    ? Math.max(15, daysBetween(anchor, nextStart))
    : observedCycleLength(p).length;
  const daysSince = daysBetween(anchor, iso);
  // Within a completed cycle we know the day exactly; for the ongoing/future
  // cycle we wrap by the projected length so upcoming phases still render.
  const day = nextStart ? daysSince + 1 : (daysSince % thisLen) + 1;

  return { phase: phaseName(day, thisLen), dayOfCycle: day, onBirthControl: false };
}

// Current phase (used by the Coach and the Coach screen header).
export function currentPhase(p: Profile, today: Date = new Date()): PhaseInfo {
  return phaseForDate(p, today);
}

// --- Predictions (in-app only; push reminders are Feature J) ------------------

export type Prediction = { date: string; daysUntil: number };

// Next predicted period start, always in the future. null on birth control or
// with no history.
export function nextPredictedPeriod(p: Profile, today: Date = new Date()): Prediction | null {
  if (p.onBirthControl) return null;
  const starts = cycleStarts(p);
  if (!starts.length) return null;
  const len = observedCycleLength(p).length;
  const iso = toISODate(today);
  let next = starts[starts.length - 1];
  let guard = 0;
  do {
    next = addDays(next, len);
    guard++;
  } while (next < iso && guard < 1000);
  return { date: next, daysUntil: daysBetween(iso, next) };
}

// Is this date part of a *predicted* (not yet logged) upcoming period? Used to
// draw the outlined days on the calendar.
export function isPredictedPeriodDay(p: Profile, iso: string): boolean {
  if (p.onBirthControl) return false;
  const starts = cycleStarts(p);
  if (!starts.length) return false;
  if (periodDays(p).includes(iso)) return false; // logged takes precedence
  const last = starts[starts.length - 1];
  if (iso <= last) return false; // only the future is predicted
  const len = observedCycleLength(p).length;
  const plen = observedPeriodLength(p);
  for (let k = 1; k <= 18; k++) {
    const ps = addDays(last, len * k);
    const off = daysBetween(ps, iso);
    if (off >= 0 && off < plen) return true;
    if (ps > iso) break;
  }
  return false;
}
