// Proactive pattern detection — the deterministic "noticings" the Coach LEADS
// the daily opener with.
//
// Like macros and cycle phase, patterns are computed IN CODE here and merely
// PRESENTED by the Coach. The model never invents a trend; it only narrates the
// short, factual signal strings this module produces from her real logged data.
//
// ED-SAFETY (load-bearing): proactivity in v1 is deliberately limited to ENERGY,
// SYMPTOMS, CYCLE, and WORKOUT CONSISTENCY. There is intentionally NO detector
// that polices intake amount ("you only ate X calories"), and NO weight-trend /
// weight-loss "progress" noticing. The only food-adjacent signal allowed is
// fueling-ENOUGH framing (under-fueling for her training), never restriction or
// scale progress. If you add a detector, it must stay inside that boundary.
//
// All helpers are pure (read-only over Profile). Output is bounded: a small,
// capped list of Noticing items, and signals are OMITTED entirely when there is
// nothing notable — no empty or forced noticings.

import { Profile, DayLog } from "./types";
import { toISODate, addDays, nextPredictedPeriod } from "./cycle";
import { planDayForDate, dayLogged, dayComplete, isTrainingDay, dateForWeekday } from "./plan";

// One thing worth mentioning. `kind` lets the prompt/ED-safety reason about the
// category; `text` is the short factual line the Coach narrates in her voice.
export type NoticingKind = "energy" | "symptom" | "cycle" | "adherence" | "fueling";

export type Noticing = {
  kind: NoticingKind;
  text: string;
};

// How many days back to scan for energy/symptom signals. Kept short so a
// "recent" pattern means the last week, not ancient history.
const RECENT_DAYS = 7;
// Cap the total signals so the opener stays warm and brief, not a data dump.
const MAX_NOTICINGS = 4;

// Logs for the last `days` calendar days ending today, oldest-first, with the
// date attached. Missing days are simply absent (she didn't check in).
function recentLogs(p: Profile, todayISO: string, days: number): { date: string; log: DayLog }[] {
  const out: { date: string; log: DayLog }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(todayISO, -i);
    const log = p.dayLogs?.[date];
    if (log) out.push({ date, log });
  }
  return out;
}

// --- Detectors ----------------------------------------------------------------

// Low-energy streak: consecutive most-recent check-ins (counting back from today)
// with energy === "low". Only a real streak (>= 2) is notable; a single low day
// is normal and not worth a proactive callout.
export function lowEnergyStreak(p: Profile, todayISO = toISODate(new Date())): number {
  let streak = 0;
  for (let i = 0; i < RECENT_DAYS; i++) {
    const log = p.dayLogs?.[addDays(todayISO, -i)];
    if (!log) break; // a gap (no check-in) ends the run
    if (log.energy === "low") streak += 1;
    else break;
  }
  return streak;
}

// Recurring symptoms: symptoms that appear on >= 2 of the last ~7 check-ins.
// Returns each recurring symptom (lowercased label) with how many days it showed.
export function recurringSymptoms(
  p: Profile,
  todayISO = toISODate(new Date())
): { symptom: string; days: number }[] {
  const counts = new Map<string, number>();
  for (const { log } of recentLogs(p, todayISO, RECENT_DAYS)) {
    // Count each symptom at most once per day.
    const seen = new Set<string>();
    for (const s of log.symptoms ?? []) {
      const key = s.trim();
      if (!key || seen.has(key.toLowerCase())) continue;
      seen.add(key.toLowerCase());
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, days]) => days >= 2)
    .map(([symptom, days]) => ({ symptom, days }))
    .sort((a, b) => b.days - a.days);
}

export type AdherenceSignal =
  | { type: "missed_streak"; count: number } // consecutive past planned days missed
  | { type: "strong_run"; done: number; total: number }; // strong completion this week

// Workout adherence from the current plan. Two honest signals:
//  - a missed-planned-workout STREAK over recent PAST days (ties to the existing
//    anti-pushover guardrail: name it, don't nag), or
//  - a STRONG completion run worth acknowledging (most/all of this week done).
// Today is not yet "missed" (the day isn't over), so the streak only counts past
// training days. Returns null when neither is notable.
export function workoutAdherence(
  p: Profile,
  todayISO = toISODate(new Date())
): AdherenceSignal | null {
  const cur = p.plan?.current;
  if (!cur) return null;

  // Missed streak: walk back from yesterday through this plan week's PAST
  // training days; count consecutive un-logged ones. Stops at the first
  // completed (or non-training) day, and at the plan week's start.
  let missed = 0;
  for (let i = 1; i <= 7; i++) {
    const date = addDays(todayISO, -i);
    if (date < cur.startDate) break; // before this plan week
    const day = planDayForDate(p, date);
    if (!day || !isTrainingDay(day)) continue; // rest days don't break the streak
    if (dayLogged(day)) break; // a completed session ends the missed run
    missed += 1;
  }

  // Strong run: completion ratio of this week's training days so far. This is a
  // "finished sessions" signal (praise for genuinely completing work), so it uses
  // dayComplete — a partially-checked strength day is not yet a completed session
  // and shouldn't inflate the praise. (The missed-streak above deliberately uses
  // dayLogged instead: a partial check-off means she DID show up, so it breaks a
  // no-show streak even though the session isn't fully done.)
  const training = cur.days.filter(isTrainingDay);
  const done = training.filter(dayComplete).length;
  const total = training.length;

  // Prefer surfacing a real miss streak (honest nudge) over praise.
  if (missed >= 2) return { type: "missed_streak", count: missed };
  // Otherwise acknowledge a genuinely strong run: at least 3 done and >= 75%.
  if (total > 0 && done >= 3 && done / total >= 0.75) {
    return { type: "strong_run", done, total };
  }
  return null;
}

// Days until her next predicted period, surfaced ONLY when it's close (<= 4 days)
// and she has a natural cycle. null otherwise. (This reuses cycle prediction; the
// opener can give a gentle heads-up so a dip in energy/mood isn't a surprise.)
const PERIOD_HEADSUP_DAYS = 4;
export function periodHeadsUp(
  p: Profile,
  today: Date = new Date()
): { daysUntil: number; date: string } | null {
  const pred = nextPredictedPeriod(p, today);
  if (!pred) return null;
  if (pred.daysUntil < 0 || pred.daysUntil > PERIOD_HEADSUP_DAYS) return null;
  return { daysUntil: pred.daysUntil, date: pred.date };
}

// --- Assembly -----------------------------------------------------------------

// Build the bounded, ordered list of noticings for today. Each is a short factual
// line; the Coach picks the 1-2 most relevant and narrates them in her voice.
// ED-SAFETY: every line here is about energy, symptoms, cycle, consistency, or
// fueling ENOUGH — never intake amount, never weight/scale progress.
export function detectNoticings(p: Profile, today: Date = new Date()): Noticing[] {
  const todayISO = toISODate(today);
  const out: Noticing[] = [];

  // 1) Low-energy streak (>= 2 consecutive recent days).
  const energy = lowEnergyStreak(p, todayISO);
  if (energy >= 2) {
    out.push({
      kind: "energy",
      text: `Her energy has been low ${energy} days running (from her own check-ins).`,
    });
    // Fueling-ENOUGH framing: a low-energy run is a reason to check she's eating
    // enough to support her energy and training. This is the ONLY food-adjacent
    // proactive signal — it nudges toward eating ENOUGH, never less.
    out.push({
      kind: "fueling",
      text: "Low energy can sometimes mean she isn't fueling enough for what she's doing — a gentle, optional nudge toward eating enough (never less) may help.",
    });
  }

  // 2) Recurring symptoms across the last ~week.
  const symptoms = recurringSymptoms(p, todayISO);
  if (symptoms.length) {
    const top = symptoms
      .slice(0, 2)
      .map((s) => `${s.symptom.toLowerCase()} (${s.days} days)`)
      .join(" and ");
    out.push({
      kind: "symptom",
      text: `Recurring this week in her check-ins: ${top}.`,
    });
  }

  // 3) Cycle: gentle heads-up if her next predicted period is within a few days.
  // Suppressed entirely when cycle tracking is OFF (=== false so legacy/undefined
  // profiles still get the heads-up) — the Coach must surface nothing cycle then.
  const heads = p.cycleTrackingEnabled === false ? null : periodHeadsUp(p, today);
  if (heads) {
    const when =
      heads.daysUntil === 0
        ? "today"
        : heads.daysUntil === 1
          ? "tomorrow"
          : `in about ${heads.daysUntil} days`;
    out.push({
      kind: "cycle",
      text: `Her period is predicted ${when} (an estimate from her logged history, not a fact — mention it gently, never as medical advice).`,
    });
  }

  // 4) Workout adherence — an honest missed-streak nudge OR a strong-run kudos.
  const adh = workoutAdherence(p, todayISO);
  if (adh?.type === "missed_streak") {
    out.push({
      kind: "adherence",
      text: `She's missed ${adh.count} planned workout${adh.count === 1 ? "" : "s"} in a row. If it's becoming a pattern, be honest about the tradeoff and offer the smallest real session — don't nag or shame.`,
    });
  } else if (adh?.type === "strong_run") {
    out.push({
      kind: "adherence",
      text: `Strong consistency: she's done ${adh.done} of ${adh.total} planned workouts this week — worth acknowledging.`,
    });
  }

  return out.slice(0, MAX_NOTICINGS);
}

// Format the noticings as the "WHAT TO NOTICE TODAY" context section, or "" when
// there's nothing notable (so the caller can omit the section entirely — no empty
// block, no forced noticing).
export function noticingsBlock(p: Profile, today: Date = new Date()): string {
  const items = detectNoticings(p, today);
  if (!items.length) return "";
  return [
    "WHAT TO NOTICE TODAY (computed from her real logged data — present in your own voice, only on the daily opener or when genuinely relevant; do NOT re-list these every message):",
    ...items.map((n) => `- ${n.text}`),
  ].join("\n");
}

// --- Standalone assertions ------------------------------------------------------
// No test runner is wired into this Expo project, so the pattern-detection
// invariants are encoded as an exported self-check (a no-op for the app, which
// never calls it). Returns the list of failures; empty = all pass.
// Run via: `npx tsx -e "import('./lib/patterns').then(m=>console.log(m.runPatternAssertions()))"`.
export function runPatternAssertions(): string[] {
  const failures: string[] = [];
  const must = (cond: boolean, label: string) => {
    if (!cond) failures.push(label);
  };

  const base: Profile = {
    name: "",
    goal: "feel_better",
    tone: "bestie",
    dietaryRules: "",
    onBirthControl: false,
    cycleTrackingEnabled: true,
    lastPeriodStart: "",
    avgCycleLength: 28,
    dayLogs: {},
    foodLogs: {},
    waterLogs: {},
    workoutLogs: {},
    age: "",
    height: "",
    weight: "",
    goalWeight: "",
    activityLevel: "light",
    calorieMode: "static",
  };

  const TODAY = "2026-05-25";
  const d = (n: number) => addDays(TODAY, n);

  // --- Low-energy streak ---
  // Single low day is NOT a streak.
  const oneLow: Profile = { ...base, dayLogs: { [TODAY]: { date: TODAY, energy: "low" } } };
  must(lowEnergyStreak(oneLow, TODAY) === 1, "one low day -> streak 1 (not notable)");
  must(
    !detectNoticings(oneLow, new Date(TODAY + "T12:00:00")).some((n) => n.kind === "energy"),
    "one low day -> no energy noticing"
  );

  // Three consecutive low days IS a streak and surfaces an energy + fueling signal.
  const threeLow: Profile = {
    ...base,
    dayLogs: {
      [d(-2)]: { date: d(-2), energy: "low" },
      [d(-1)]: { date: d(-1), energy: "low" },
      [TODAY]: { date: TODAY, energy: "low" },
    },
  };
  must(lowEnergyStreak(threeLow, TODAY) === 3, "three low days -> streak 3");
  const threeLowN = detectNoticings(threeLow, new Date(TODAY + "T12:00:00"));
  must(threeLowN.some((n) => n.kind === "energy"), "three low days -> energy noticing");
  must(threeLowN.some((n) => n.kind === "fueling"), "low-energy run -> fueling-enough noticing");

  // A gap (missed check-in) breaks the streak.
  const gap: Profile = {
    ...base,
    dayLogs: {
      [d(-3)]: { date: d(-3), energy: "low" },
      // d(-2) and d(-1) missing
      [TODAY]: { date: TODAY, energy: "low" },
    },
  };
  must(lowEnergyStreak(gap, TODAY) === 1, "gap before today -> streak 1");

  // A medium/high day breaks the streak.
  const broken: Profile = {
    ...base,
    dayLogs: {
      [d(-2)]: { date: d(-2), energy: "low" },
      [d(-1)]: { date: d(-1), energy: "high" },
      [TODAY]: { date: TODAY, energy: "low" },
    },
  };
  must(lowEnergyStreak(broken, TODAY) === 1, "high day breaks streak -> 1");

  // --- Recurring symptoms ---
  // A symptom on only one day is NOT recurring.
  const oneSym: Profile = {
    ...base,
    dayLogs: { [TODAY]: { date: TODAY, symptoms: ["Cramps"] } },
  };
  must(recurringSymptoms(oneSym, TODAY).length === 0, "one-day symptom -> not recurring");

  // Cramps on 3 days, fatigue on 2 -> both recurring, cramps ranked first.
  const recur: Profile = {
    ...base,
    dayLogs: {
      [d(-4)]: { date: d(-4), symptoms: ["Cramps", "Fatigue"] },
      [d(-2)]: { date: d(-2), symptoms: ["Cramps"] },
      [TODAY]: { date: TODAY, symptoms: ["Cramps", "Fatigue"] },
    },
  };
  const rs = recurringSymptoms(recur, TODAY);
  must(rs.length === 2, "two recurring symptoms");
  must(rs[0].symptom === "Cramps" && rs[0].days === 3, "cramps 3 days, ranked first");
  must(rs.some((s) => s.symptom === "Fatigue" && s.days === 2), "fatigue 2 days recurring");
  // Duplicate symptom within one day counts once.
  const dup: Profile = {
    ...base,
    dayLogs: {
      [d(-1)]: { date: d(-1), symptoms: ["Cramps", "cramps"] },
      [TODAY]: { date: TODAY, symptoms: ["Cramps"] },
    },
  };
  must(recurringSymptoms(dup, TODAY)[0]?.days === 2, "same-day duplicate counts once");

  // --- Days until period (heads-up) ---
  // Anchor a logged period start 26 days before today so the next predicted start
  // (28-day prior) is ~2 days out -> heads-up fires.
  const close: Profile = {
    ...base,
    avgCycleLength: 28,
    dayLogs: { [d(-26)]: { date: d(-26), flow: "medium" } },
  };
  const hu = periodHeadsUp(close, new Date(TODAY + "T12:00:00"));
  must(!!hu && hu.daysUntil >= 0 && hu.daysUntil <= 4, "period heads-up fires when close");

  // A period far away (just started ~3 days ago) does NOT trigger a heads-up.
  const farAway: Profile = {
    ...base,
    avgCycleLength: 28,
    dayLogs: { [d(-3)]: { date: d(-3), flow: "medium" } },
  };
  must(periodHeadsUp(farAway, new Date(TODAY + "T12:00:00")) === null, "far period -> no heads-up");

  // On birth control -> no cycle prediction, no heads-up.
  const bc: Profile = { ...close, onBirthControl: true };
  must(periodHeadsUp(bc, new Date(TODAY + "T12:00:00")) === null, "birth control -> no heads-up");

  // --- Workout adherence ---
  // No plan -> no adherence signal.
  must(workoutAdherence(base, TODAY) === null, "no plan -> no adherence signal");

  // Build a plan week (Monday-anchored) with training Mon/Wed/Fri. Place "today"
  // mid-week so some training days are in the past.
  const monISO = "2026-05-25"; // a Monday
  const trainingDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const makeWeek = (logged: Record<string, boolean>): Profile => ({
    ...base,
    plan: {
      setup: {
        daysPerWeek: 3,
        access: ["gym"],
        experience: "beginner",
      },
      current: {
        id: "w1",
        weekNumber: 1,
        startDate: monISO,
        programName: "Test",
        whyThisWeek: "",
        createdAt: 0,
        days: trainingDays.map((wd) => {
          const isTrain = wd === "mon" || wd === "wed" || wd === "fri";
          return {
            weekday: wd,
            kind: isTrain ? ("strength" as const) : ("rest" as const),
            title: isTrain ? "Lift" : "Rest",
            intensity: isTrain ? ("moderate" as const) : ("rest" as const),
            ...(isTrain && logged[wd] ? { loggedEntryId: "x" } : {}),
          };
        }),
      },
      history: [],
    },
  });

  // "Today" = Friday of that week. Mon + Wed are PAST training days.
  const friISO = dateForWeekday(monISO, "fri");
  // Both Mon and Wed missed -> missed streak of 2.
  const missedBoth = makeWeek({});
  const adhMissed = workoutAdherence(missedBoth, friISO);
  must(
    adhMissed?.type === "missed_streak" && adhMissed.count === 2,
    "missed Mon+Wed -> missed streak 2"
  );
  // A completed Wed breaks the streak before Mon (only counts back to first done).
  const wedDone = makeWeek({ wed: true });
  must(workoutAdherence(wedDone, friISO) === null, "completed Wed breaks missed streak");

  // Strong run: a 4-training-day week with 3 done and today early enough that no
  // miss streak exists. Use a Mon/Tue/Thu/Fri plan, today = Wed, all past done.
  const strongWeek: Profile = {
    ...base,
    plan: {
      setup: { daysPerWeek: 4, access: ["gym"], experience: "beginner" },
      current: {
        id: "w2",
        weekNumber: 1,
        startDate: monISO,
        programName: "Test",
        whyThisWeek: "",
        createdAt: 0,
        days: trainingDays.map((wd) => {
          const isTrain = wd === "mon" || wd === "tue" || wd === "thu" || wd === "fri";
          const done = wd === "mon" || wd === "tue";
          return {
            weekday: wd,
            kind: isTrain ? ("strength" as const) : ("rest" as const),
            title: isTrain ? "Lift" : "Rest",
            intensity: isTrain ? ("moderate" as const) : ("rest" as const),
            ...(isTrain && done ? { loggedEntryId: "x" } : {}),
          };
        }),
      },
      history: [],
    },
  };
  // Mark Thu done too via a fresh build so done=3 of 4, today=Sat (all past).
  const strongDone: Profile = {
    ...strongWeek,
    plan: {
      ...strongWeek.plan!,
      current: {
        ...strongWeek.plan!.current!,
        days: strongWeek.plan!.current!.days.map((d2) =>
          d2.weekday === "thu" ? { ...d2, loggedEntryId: "x" } : d2
        ),
      },
    },
  };
  const satISO = dateForWeekday(monISO, "sat");
  const adhStrong = workoutAdherence(strongDone, satISO);
  must(
    adhStrong?.type === "strong_run" && adhStrong.done === 3 && adhStrong.total === 4,
    "3 of 4 done, no recent miss -> strong run"
  );

  // --- Bounds & emptiness ---
  // Empty profile -> no noticings, empty block.
  must(detectNoticings(base, new Date(TODAY + "T12:00:00")).length === 0, "empty profile -> 0 noticings");
  must(noticingsBlock(base, new Date(TODAY + "T12:00:00")) === "", "empty profile -> empty block");

  // Cap holds: stack energy + symptoms + cycle + adherence; never exceed MAX.
  const loaded: Profile = {
    ...makeWeek({}),
    avgCycleLength: 28,
    dayLogs: {
      [d(-26)]: { date: d(-26), flow: "medium" },
      [d(-2)]: { date: d(-2), energy: "low", symptoms: ["Cramps"] },
      [d(-1)]: { date: d(-1), energy: "low", symptoms: ["Cramps"] },
      [TODAY]: { date: TODAY, energy: "low", symptoms: ["Cramps"] },
    },
  };
  must(detectNoticings(loaded, new Date(TODAY + "T12:00:00")).length <= MAX_NOTICINGS, "noticings capped at MAX");

  // ED-SAFETY: no noticing kind ever encodes intake amount or weight progress.
  const allKinds = new Set(detectNoticings(loaded, new Date(TODAY + "T12:00:00")).map((n) => n.kind));
  const allowed: NoticingKind[] = ["energy", "symptom", "cycle", "adherence", "fueling"];
  must(
    Array.from(allKinds).every((k) => allowed.includes(k)),
    "every noticing kind is within the ED-safe boundary"
  );

  return failures;
}
