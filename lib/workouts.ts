// Feature C — workout logging. Strength (exercises with sets) + activity
// (cardio/classes/studio with a duration). Pure helpers over Profile.workoutLogs.

import { Profile, WorkoutEntry, WorkoutExercise, WorkoutSet, WorkoutKind } from "./types";
import { toISODate } from "./cycle";
import { newId } from "./food";
import { parseWeightKg } from "./targets";

export { newId };

// --- Calories burned (deterministic, MET formula) ----------------------------
// calories = MET × bodyweight(kg) × hours. Moderate-effort MET values per
// activity; tweak freely. Strength uses a single MET.
const ACTIVITY_MET: Record<string, number> = {
  run: 9.8,
  running: 9.8,
  walk: 3.5,
  walking: 3.5,
  cycling: 7.5,
  spin: 7.5,
  yoga: 3,
  pilates: 3,
  lagree: 5,
  boxing: 7,
  hiit: 8,
  swim: 7,
  swimming: 7,
  hike: 6,
  hiking: 6,
  dance: 5,
};
const STRENGTH_MET = 5;
const DEFAULT_ACTIVITY_MET = 5;

export function profileWeightKg(p: Profile): number | null {
  return parseWeightKg(p.weight || "");
}

// Estimated calories for a workout. Null if we can't (no duration or no weight).
export function estimateBurn(
  kind: WorkoutKind,
  activity: string | undefined,
  durationMin: number | undefined,
  weightKg: number | null
): number | null {
  if (!durationMin || durationMin <= 0 || !weightKg || weightKg <= 0) return null;
  const met =
    kind === "strength"
      ? STRENGTH_MET
      : ACTIVITY_MET[(activity || "").trim().toLowerCase()] ?? DEFAULT_ACTIVITY_MET;
  return Math.round(met * weightKg * (durationMin / 60));
}

// --- Per-exercise calorie estimate (type-aware) -------------------------------
// Strength days mix cardio warm-ups, lifts, and mobility — wildly different
// intensities — so estimate EACH exercise on its own: pick a MET from what it is
// and a duration (parsed from a time-based rep like "5 min"/"60 sec", else ~1.5
// min per set), then MET × kg × hours. Rough, but sane across types.
const CARDIO_RE =
  /run|jog|sprint|treadmill|ramp|incline|walk|bike|cycl|\brow\b|spin|cardio|hiit|jump ?rope|condition|stair|elliptical/i;
const MOBILITY_RE = /stretch|mobility|foam roll|warm.?up|cool.?down|breath|hold|activation/i;

export function exerciseMET(name: string): number {
  if (CARDIO_RE.test(name)) return 7; // cardio
  if (MOBILITY_RE.test(name)) return 2.5; // stretch / mobility / activation
  return 5; // strength default
}

// Minutes from a time-based rep string ("5 min", "60 sec"), else null.
export function repsToMinutes(reps: string): number | null {
  const m = reps.match(/(\d+(?:\.\d+)?)\s*(sec|min)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /sec/i.test(m[2]) ? n / 60 : n;
}

export function estimateExerciseBurn(
  name: string,
  reps: string | undefined,
  sets: number | undefined,
  weightKg: number | null
): number | null {
  if (!weightKg || weightKg <= 0) return null;
  const dur = repsToMinutes(reps ?? "") ?? (sets ?? 1) * 1.5; // ~1.5 min/set incl rest
  if (dur <= 0) return null;
  return Math.round(exerciseMET(name) * weightKg * (dur / 60));
}

// Total calories burned logged on a given day.
export function caloriesBurnedFor(p: Profile, date: string): number {
  return workoutsFor(p, date).reduce((s, e) => s + (e.caloriesBurned || 0), 0);
}

export function workoutsFor(p: Profile, date: string): WorkoutEntry[] {
  return p.workoutLogs?.[date] ?? [];
}

export function makeWorkout(
  partial: Omit<WorkoutEntry, "id" | "createdAt" | "date" | "source"> & { date?: string },
  source: "manual" | "coach"
): WorkoutEntry {
  return {
    id: newId(),
    date: partial.date ?? toISODate(new Date()),
    createdAt: Date.now(),
    source,
    ...partial,
  };
}

export function addWorkout(p: Profile, entry: WorkoutEntry): Profile {
  const workoutLogs = { ...(p.workoutLogs ?? {}) };
  workoutLogs[entry.date] = [...(workoutLogs[entry.date] ?? []), entry];
  return { ...p, workoutLogs };
}

export function updateWorkout(p: Profile, entry: WorkoutEntry): Profile {
  const workoutLogs = { ...(p.workoutLogs ?? {}) };
  workoutLogs[entry.date] = (workoutLogs[entry.date] ?? []).map((e) =>
    e.id === entry.id ? entry : e
  );
  return { ...p, workoutLogs };
}

export function removeWorkout(p: Profile, date: string, id: string): Profile {
  const workoutLogs = { ...(p.workoutLogs ?? {}) };
  const next = (workoutLogs[date] ?? []).filter((e) => e.id !== id);
  if (next.length) workoutLogs[date] = next;
  else delete workoutLogs[date];
  return { ...p, workoutLogs };
}

function allEntries(p: Profile): WorkoutEntry[] {
  return Object.values(p.workoutLogs ?? {})
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Recent unique strength-exercise names, most recent first (for quick re-add).
export function recentExercises(p: Profile, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of allEntries(p)) {
    for (const x of e.exercises ?? []) {
      const key = x.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(x.name.trim());
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Recent unique activity names, most recent first.
export function recentActivities(p: Profile, limit = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of allEntries(p)) {
    const a = (e.activity ?? "").trim();
    const key = a.toLowerCase();
    if (!a || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

// Just the sets/reps/weight part: "3×10 @ 95 lb" or "10@95, 8@95, 6@95 lb".
export function setsLabel(x: WorkoutExercise): string {
  const sets = x.sets ?? [];
  if (!sets.length) return "";
  const uniform =
    sets.every((s) => s.reps === sets[0].reps && (s.weight ?? null) === (sets[0].weight ?? null));
  if (uniform) {
    const w = sets[0].weight != null ? ` @ ${sets[0].weight} lb` : "";
    return `${sets.length}×${sets[0].reps}${w}`;
  }
  const anyWeight = sets.some((s) => s.weight != null);
  const parts = sets.map((s) => (s.weight != null ? `${s.reps}@${s.weight}` : `${s.reps}`));
  return `${parts.join(", ")}${anyWeight ? " lb" : ""}`;
}

// "Squats: 3×10 @ 95 lb"
export function exerciseLabel(x: WorkoutExercise): string {
  const s = setsLabel(x);
  return s ? `${x.name}: ${s}` : x.name;
}

// One-line summary of a whole entry (for the Coach context + compact UI).
export function workoutLabel(e: WorkoutEntry): string {
  if (e.kind === "activity") {
    const bits = [e.activity || "Activity"];
    if (e.durationMin) bits.push(`${e.durationMin} min`);
    if (e.distance) bits.push(e.distance);
    return bits.join(" · ");
  }
  const ex = e.exercises ?? [];
  const totalSets = ex.reduce((n, x) => n + (x.sets?.length ?? 0), 0);
  const names = ex.map((x) => x.name).join(", ");
  return `${names || "Strength"}${totalSets ? ` · ${totalSets} sets` : ""}`;
}

// Expand a compact "S sets of R reps at W" into a sets array.
export function expandSets(count: number, reps: number, weight?: number): WorkoutSet[] {
  const n = Math.max(1, Math.round(count || 1));
  return Array.from({ length: n }, () => ({ reps: Math.round(reps || 0), ...(weight != null ? { weight } : {}) }));
}
