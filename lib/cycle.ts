import { Profile } from "./types";
import { phaseColors } from "./theme";

// "off" is returned when the user has turned cycle tracking fully off (Settings
// → Cycle). Every UI surface treats "off" as "render no cycle anything", and the
// Coach context omits all cycle/phase lines for that user.
export type PhaseInfo = {
  phase: "off" | string; // human-readable phase name, or "off" when tracking is disabled
  dayOfCycle: number | null; // null if on birth control or no date set
  onBirthControl: boolean;
  // Set only on the ONGOING cycle once "today" has passed the projected next
  // period start with NO logged bleed. We deliberately do NOT fabricate a fresh
  // menstrual phase in that gap (an assertion the app can't confirm) — instead
  // we hold the last real phase (luteal) and flag the delay so the UI can say
  // "Period expected" in neutral, factual terms. Optional + additive: consumers
  // that only read .phase/.dayOfCycle (WorkoutScreen, coach.ts) are unaffected.
  predictedLate?: boolean;
  daysLate?: number;
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

// Each observed cycle paired with the date it started — same plausibility
// filter as cycleLengths, but keeps the start so the Progress chart can label
// bars by the month the cycle began. The length here is the days-until-next-
// start, NOT the bleed length.
export type CycleLengthPoint = { start: string; length: number };
export function cycleLengthSeries(p: Profile): CycleLengthPoint[] {
  const starts = cycleStarts(p);
  const out: CycleLengthPoint[] = [];
  for (let i = 1; i < starts.length; i++) {
    const length = daysBetween(starts[i - 1], starts[i]);
    if (length >= 15 && length <= 60) out.push({ start: starts[i - 1], length });
  }
  return out;
}

// Phase tints shared between CycleScreen and the Progress F3 month grid.
// The actual values live in theme.ts (`phaseColors`) so the brand token group
// is the single source of truth; we re-export under the legacy name+shape so
// ProgressScreen and CycleScreen can keep their imports stable. NOT used for
// BC users on Progress.
export const PHASE_COLORS = phaseColors;

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
// IMPORTANT: Wren treats phase windows as *defaults* ("many women find..."),
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
export function phaseForDate(p: Profile, date: Date, today: Date = new Date()): PhaseInfo {
  // Tracking turned fully off takes precedence over everything (incl. BC):
  // === false so an undefined/legacy value reads as enabled.
  if (p.cycleTrackingEnabled === false) {
    return { phase: "off", dayOfCycle: null, onBirthControl: false };
  }
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

  // COMPLETED cycle (bounded by a real logged next start): we know the exact
  // day, so measure it directly. Unchanged from before.
  if (nextStart) {
    const day = daysSince + 1;
    return { phase: phaseName(day, thisLen), dayOfCycle: day, onBirthControl: false };
  }

  // ONGOING cycle (no logged next start): DO NOT wrap. Wrapping used to reset
  // `day` to 1,2,3… past the projected start, which made phaseName() fabricate
  // a fresh "menstrual" period the user never logged — a bodily-state assertion
  // the app can't confirm (ED-safety + trust problem).
  const rawDay = daysSince + 1;

  if (rawDay <= thisLen) {
    // Still inside the projected cycle window — behave exactly as before.
    return { phase: phaseName(rawDay, thisLen), dayOfCycle: rawDay, onBirthControl: false };
  }

  // Past the projected start with no logged bleed. Split by future vs not:
  //
  //  • FUTURE calendar cell (iso is after today): this is an explicit *forecast*,
  //    not a claim about the user's current body, so we may project the next
  //    cycle(s) forward by wrapping. This keeps the month grid showing predicted
  //    follicular/ovulation/luteal for upcoming cycles. Any forecast "menstrual"
  //    day is rendered by CycleScreen as a predicted-period outline (via
  //    isPredictedPeriodDay), not as an assertion of bleeding.
  //
  //  • TODAY or PAST (iso <= today): this WOULD be an assertion of the user's
  //    current/overdue position, so we must NOT fabricate a fresh menstrual
  //    phase (ED-safety + trust). Hold luteal within a grace window and flag the
  //    delay; go "unknown" beyond it.
  //
  // LOAD-BEARING PLACEMENT — do not hoist this guard into currentPhase().
  // FoodScreen (and any other caller) invokes phaseForDate() DIRECTLY with the
  // default `today`, never through currentPhase(), and relies on the guard
  // living HERE. Moving it up to currentPhase() would silently regress those
  // callers to asserting a fabricated "menstrual" today. currentPhase() is a
  // plain passthrough (phaseForDate(p, today, today)) and must stay that way.
  if (iso > toISODate(today)) {
    const projDay = (daysSince % thisLen) + 1;
    return { phase: phaseName(projDay, thisLen), dayOfCycle: projDay, onBirthControl: false };
  }

  const grace = Math.max(7, Math.round(thisLen / 2));
  const late = rawDay - thisLen;
  if (late <= grace) {
    return {
      phase: "luteal",
      dayOfCycle: rawDay,
      onBirthControl: false,
      predictedLate: true,
      daysLate: late,
    };
  }

  // Beyond the grace window — read neutral, assert nothing.
  return { phase: "unknown", dayOfCycle: null, onBirthControl: false };
}

// Current phase (used by the Coach and the Coach screen header).
export function currentPhase(p: Profile, today: Date = new Date()): PhaseInfo {
  return phaseForDate(p, today, today);
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

// Does this ISO date fall in a cycle *prior* to the user's most recent (current)
// cycle? Used by the calendar to give those days a lighter tint so the eye
// reads "earlier than today's cycle" without losing the phase color. Returns
// false on BC, with no logged starts, on/after the most recent start, or in
// the future. Pure — only depends on the profile's logged starts.
export function isPreviousCycle(p: Profile, iso: string): boolean {
  if (p.onBirthControl) return false;
  const starts = cycleStarts(p);
  if (!starts.length) return false;
  const currentStart = starts[starts.length - 1];
  // Anything before the most recent cycle anchor belongs to a previous cycle.
  return iso < currentStart;
}

// --- Pattern history (Feature B, daily Cycle message) ------------------------
// "Around this cycle-day, what did she log in PAST cycles?" Pure + additive:
// used by CycleScreen to surface a gentle, factual pattern line ("Around this
// point last cycle you logged fatigue."). It reads ONLY her own logged data and
// never asserts a bodily state the app can't confirm.
export type RecurringLog = {
  kind: "symptom" | "energy" | "mood" | "digestion";
  value: string;
  cycles: number; // count of DISTINCT past cycles this (kind,value) appeared in
};

// Kind priority for ordering ties: symptom > energy > mood > digestion. Lower
// number sorts first.
const RECURRING_KIND_PRIORITY: Record<RecurringLog["kind"], number> = {
  symptom: 0,
  energy: 1,
  mood: 2,
  digestion: 3,
};

// Enumerate COMPLETED past cycles (each cycle start bounded by the NEXT start)
// and collect what she logged around the same relative cycle-day. The current
// ONGOING cycle (the last start, which has no next start) is excluded — its logs
// are "today's data", not history. BC / tracking-off / fewer than two logged
// starts all return [] (nothing to look back on).
//
// For each past cycle we look at the ISO dates at relative position
// dayOfCycle ± windowDays, clamped to that cycle's REAL length (day 1..length),
// so a short cycle can't pull in the next cycle's start day. We collect each
// symptom, mood, and digestion string, plus energy ONLY when it was "low" (the
// recurring-tiredness signal; "high"/"medium" energy is noise, not a pattern).
// Each (kind,value) is counted once per distinct cycle it appears in.
export function recurringLogsAroundDay(
  p: Profile,
  dayOfCycle: number,
  windowDays = 2,
): RecurringLog[] {
  if (p.cycleTrackingEnabled === false) return [];
  if (p.onBirthControl) return [];
  const starts = cycleStarts(p);
  // Need at least two starts to have ONE completed cycle to look back on (the
  // single most-recent start is the ongoing cycle, which we exclude).
  if (starts.length < 2) return [];

  const logs = p.dayLogs ?? {};
  // key = `${kind}:${value}` → set of cycle indices it appeared in (distinct
  // cycles), so re-logging the same symptom twice in one cycle still counts once.
  const seen = new Map<
    string,
    { kind: RecurringLog["kind"]; value: string; cycles: Set<number> }
  >();

  const record = (kind: RecurringLog["kind"], value: string, cycleIndex: number) => {
    const key = `${kind}:${value}`;
    let entry = seen.get(key);
    if (!entry) {
      entry = { kind, value, cycles: new Set<number>() };
      seen.set(key, entry);
    }
    entry.cycles.add(cycleIndex);
  };

  // Completed cycles only: index i where a next start exists (i + 1 < length).
  for (let i = 0; i + 1 < starts.length; i++) {
    const anchor = starts[i];
    const nextStart = starts[i + 1];
    const length = daysBetween(anchor, nextStart); // this cycle's real length
    for (let d = dayOfCycle - windowDays; d <= dayOfCycle + windowDays; d++) {
      if (d < 1 || d > length) continue; // clamp to the cycle's real span
      const iso = addDays(anchor, d - 1); // day N → anchor + (N-1) days
      const log = logs[iso];
      if (!log) continue;
      for (const s of log.symptoms ?? []) record("symptom", s, i);
      for (const m of log.moods ?? []) record("mood", m, i);
      for (const dg of log.digestion ?? []) record("digestion", dg, i);
      if (log.energy === "low") record("energy", "low", i);
    }
  }

  const out: RecurringLog[] = Array.from(seen.values()).map((e) => ({
    kind: e.kind,
    value: e.value,
    cycles: e.cycles.size,
  }));
  // Sort by how many cycles it recurred in (desc), then by kind priority. Ting
  // wants a single logged cycle to still count (>= 1), so no min-cycle filter.
  out.sort(
    (a, b) =>
      b.cycles - a.cycles ||
      RECURRING_KIND_PRIORITY[a.kind] - RECURRING_KIND_PRIORITY[b.kind],
  );
  return out;
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
