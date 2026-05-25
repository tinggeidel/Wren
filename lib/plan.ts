// Feature E — tailored rolling weekly plan: pure helpers.
// Generation (the Claude call) lives in coach.ts; this file is the deterministic
// glue: week dates, turning a planned day into a logged WorkoutEntry, completion
// tracking, and code-computed per-day calorie cycling.

import {
  Profile,
  PlanDay,
  PlanExercise,
  WeekPlan,
  WorkoutEntry,
  WorkoutExercise,
  DayIntensity,
  DayLog,
  Macros,
  Weekday,
  WEEKDAY_LABELS,
} from "./types";
import { toISODate, parseISO, addDays } from "./cycle";
import { computeTargets, computeBMR } from "./targets";
import { consumedTotals } from "./food";
import {
  estimateBurn,
  profileWeightKg,
  makeWorkout,
  expandSets,
  newId,
} from "./workouts";

export { newId };

const JS_TO_WD: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function weekdayKey(d: Date = new Date()): Weekday {
  return JS_TO_WD[d.getDay()];
}

// ISO date of the Monday of the week containing d.
export function mondayOf(d: Date = new Date()): string {
  const day = d.getDay(); // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + shift);
  return toISODate(m);
}

// ISO date for a given weekday within the week starting at startMonISO.
export function dateForWeekday(startMonISO: string, wd: Weekday): string {
  const idx = JS_TO_WD.indexOf(wd); // sun=0..sat=6
  const offset = idx === 0 ? 6 : idx - 1; // mon=0..sun=6
  const base = new Date(startMonISO + "T00:00:00");
  base.setDate(base.getDate() + offset);
  return toISODate(base);
}

export function dayExercises(day: PlanDay): PlanExercise[] {
  return (day.sections ?? []).flatMap((s) => s.exercises);
}

export function isTrainingDay(day: PlanDay): boolean {
  return day.kind !== "rest";
}

// A day counts as logged when its WorkoutEntry exists. Strength days set this on
// the day (see WorkoutScreen.syncStrengthLog) once any exercise is checked, so a
// single day-level field is the one definition of "done".
export function dayLogged(day: PlanDay): boolean {
  if (day.kind === "rest") return false;
  return !!day.loggedEntryId;
}

export function weekProgress(week: WeekPlan): { done: number; total: number } {
  const training = week.days.filter(isTrainingDay);
  return { done: training.filter(dayLogged).length, total: training.length };
}

export function isWeekComplete(week: WeekPlan): boolean {
  const p = weekProgress(week);
  return p.total > 0 && p.done >= p.total;
}

// Convert a planned day into a real WorkoutEntry for the log (on check-off).
export function planDayToWorkoutEntry(
  profile: Profile,
  day: PlanDay,
  dateISO: string
): WorkoutEntry | null {
  if (day.kind === "rest") return null;
  const kg = profileWeightKg(profile);

  if (day.kind === "strength") {
    const exercises: WorkoutExercise[] = dayExercises(day).map((e) => ({
      id: newId(),
      name: e.name,
      sets: expandSets(e.sets ?? 1, parseInt(e.reps ?? "", 10) || 0, e.weight),
    }));
    const burn = estimateBurn("strength", undefined, day.durationMin, kg);
    return makeWorkout(
      {
        kind: "strength",
        exercises,
        durationMin: day.durationMin,
        ...(burn != null ? { caloriesBurned: burn, burnSource: "estimate" as const } : {}),
        note: day.title,
        date: dateISO,
      },
      "coach"
    );
  }

  // activity / class
  const activity = day.activity || day.title;
  const burn = estimateBurn("activity", activity, day.durationMin, kg);
  return makeWorkout(
    {
      kind: "activity",
      activity,
      durationMin: day.durationMin,
      distance: day.distance,
      ...(burn != null ? { caloriesBurned: burn, burnSource: "estimate" as const } : {}),
      note: day.note,
      date: dateISO,
    },
    "coach"
  );
}

// --- Code-computed calorie cycling (used by Food/Coach in Stage C) ------------
// Cycle the deterministic target around the day's intensity. Protein stays put;
// the calorie difference moves through carbs. The hard BMR floor is re-applied
// AFTER cycling (see dayTargets), so rest/light multipliers can never push the
// daily calorie target below BMR.
const INTENSITY_FACTOR: Record<DayIntensity, number> = {
  rest: 0.9,
  light: 0.95,
  moderate: 1.0,
  hard: 1.08,
};

// A plain-text recap of how last week actually went — completion, the
// adherence/fatigue PATTERN, symptoms, and diet — for the coach to read when
// building next week (so it adapts honestly and pushes back on repeated skips).
export function weekReviewSummary(p: Profile, week: WeekPlan): string {
  const training = week.days.filter(isTrainingDay);
  const done = training.filter(dayLogged);
  const skipped = training.filter((d) => !dayLogged(d));
  const parts: string[] = [];
  parts.push(
    `Last week ("${week.programName}", week ${week.weekNumber}): she completed ${done.length} of ${training.length} planned workouts.`
  );
  if (skipped.length) {
    parts.push(
      `Skipped: ${skipped.map((d) => `${WEEKDAY_LABELS[d.weekday]} ${d.title}`).join(", ")}.`
    );
  }

  const dates = week.days.map((d) => dateForWeekday(week.startDate, d.weekday));
  const logs = dates.map((dt) => p.dayLogs?.[dt]).filter(Boolean) as DayLog[];
  const lowEnergy = logs.filter((l) => l.energy === "low").length;
  const symptoms = new Set<string>();
  logs.forEach((l) => (l.symptoms ?? []).forEach((s) => symptoms.add(s)));
  if (lowEnergy) parts.push(`Reported low energy on ${lowEnergy} day(s).`);
  if (symptoms.size) parts.push(`Logged symptoms: ${Array.from(symptoms).join(", ")}.`);

  const t = computeTargets(p);
  if (t) {
    const dayCals = dates.map((dt) => consumedTotals(p, dt).calories).filter((c) => c > 0);
    if (dayCals.length) {
      const avg = Math.round(dayCals.reduce((a, b) => a + b, 0) / dayCals.length);
      parts.push(
        `Averaged ${avg} kcal/day on ${dayCals.length} logged day(s) vs her ${t.calories} target.`
      );
    }
  }

  if (done.length === training.length && training.length > 0) {
    parts.push("She completed everything — progress the loads where it makes sense.");
  } else if (skipped.length >= Math.ceil(training.length / 2)) {
    parts.push(
      "She missed a lot this week. If this is a pattern, be honest about what consistent backing off costs her goal, and offer a smaller realistic week rather than just easing off again."
    );
  }
  return parts.join(" ");
}

// The plan day for a given date, but only if that date falls in the current
// plan week (so cycling only applies to the active week).
export function planDayForDate(p: Profile, dateISO: string): PlanDay | null {
  const cur = p.plan?.current;
  if (!cur) return null;
  if (dateISO < cur.startDate || dateISO > addDays(cur.startDate, 6)) return null;
  const wd = weekdayKey(parseISO(dateISO));
  return cur.days.find((d) => d.weekday === wd) ?? null;
}

// The calorie/macro target for a date: cycled by the plan day's intensity if
// there's a plan for it, otherwise the base deterministic target.
export function targetForDate(p: Profile, dateISO: string): Macros | null {
  const day = planDayForDate(p, dateISO);
  return day ? dayTargets(p, day.intensity) : computeTargets(p);
}

export function dayTargets(profile: Profile, intensity: DayIntensity): Macros | null {
  const base = computeTargets(profile);
  if (!base) return null;
  const f = INTENSITY_FACTOR[intensity] ?? 1;
  // Re-apply the hard BMR floor: rest/light multipliers must never drop the
  // daily target below BMR. Clamp before deriving carbs so macros stay consistent.
  const bmr = computeBMR(profile);
  const floored = bmr != null ? Math.max(base.calories * f, bmr) : base.calories * f;
  const calories = Math.round(floored / 10) * 10;
  const protein = base.protein;
  const fat = base.fat;
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4 / 5) * 5);
  return { calories, protein, carbs, fat };
}
