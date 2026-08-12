// Feature E — tailored rolling weekly plan: pure helpers.
// Generation (the Claude call) lives in coach.ts; this file is the deterministic
// glue: week dates, turning a planned day into a logged WorkoutEntry, completion
// tracking, and code-computed per-day calorie cycling.

import {
  Profile,
  PlanDay,
  PlanExercise,
  PlanSection,
  WeekPlan,
  WorkoutEntry,
  WorkoutExercise,
  DayIntensity,
  DayLog,
  Macros,
  Weekday,
  WEEKDAYS,
  WEEKDAY_LABELS,
} from "./types";
import { toISODate, parseISO, addDays } from "./cycle";
import { computeTargets, computeBMR, MIN_DAILY_CALORIES } from "./targets";
import { consumedTotals } from "./food";
import {
  estimateBurn,
  profileWeightKg,
  makeWorkout,
  expandSets,
  workoutsFor,
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

// ISO date for a given weekday within the 7-day window that begins at startISO.
// The window is anchored on startISO's OWN weekday — it is NOT assumed to be a
// Monday. The offset is computed relative to the start's weekday, so wd lands on
// its FIRST occurrence on or after startISO (within [startISO, startISO+6]).
//
// Backward-compatible: when startISO is a Monday this returns the exact same
// dates as the old Monday-anchored mapping (the offset-0 case for Monday, with
// every other weekday following in Mon→Sun order), so existing stored plans
// resolve identically. Round-trip holds for ANY anchor: for any date d in the
// window, dateForWeekday(startISO, weekdayKey(d)) === toISODate(d), because the
// weekday→offset map is a bijection over the 7 days of the window.
export function dateForWeekday(startISO: string, wd: Weekday): string {
  const startWdIndex = JS_TO_WD.indexOf(weekdayKey(parseISO(startISO))); // sun=0..sat=6
  const wdIndex = JS_TO_WD.indexOf(wd);
  const offset = (wdIndex - startWdIndex + 7) % 7;
  const base = new Date(startISO + "T00:00:00");
  base.setDate(base.getDate() + offset);
  return toISODate(base);
}

export function dayExercises(day: PlanDay): PlanExercise[] {
  return (day.sections ?? []).flatMap((s) => s.exercises);
}

// Section names that are NOT the main "working" section — when an edit ADDS an
// exercise and we must pick a home section, we prefer the first section that is
// NOT one of these (warm-up / cool-down / mobility / stretch).
const NON_WORKING_SECTION = /warm.?up|cool.?down|mobility|stretch/i;

// Shared "default section" rule used by BOTH write paths (Coach merge + manual
// edit-day modal) when a newly-added exercise needs a home section:
//   - the first existing section whose name is NOT warm-up/cool-down/mobility/
//     stretch (i.e. the main working block);
//   - else the first section;
//   - else, if there are no sections at all, index -1 (caller creates a single
//     { name: "Workout", exercises } section).
// Returns the index into `sections` to append to, or -1 for "no section yet".
export function defaultSectionIndex(
  sections: { name: string }[] | undefined
): number {
  if (!sections || sections.length === 0) return -1;
  const working = sections.findIndex((s) => !NON_WORKING_SECTION.test(s.name));
  return working !== -1 ? working : 0;
}

// Pass 2a: guarantee a week carries exactly one PlanDay for EVERY weekday
// (Mon–Sun, all 7). The Plan-tab accordion renders nothing for a missing weekday
// slot, so a partial `days` array (only the weekdays the model emitted) makes a
// Coach move/edit onto an empty weekday look like it "didn't change" even though
// the write was internally consistent. Densifying up front means every weekday
// always has a renderable slot for both the UI and the move/adjust handlers.
//
// Contract:
//   - PRESERVES every existing day object as-is (identity included): real days,
//     their exercises, `done`, `loggedEntryId`, titles, kind, intensity, etc. are
//     never altered or cloned away.
//   - For each MISSING weekday, adds a minimal rest PlanDay mirroring the rest
//     shape buildPlan emits — kind "rest", intensity "rest", title "Rest", and no
//     sections (rest days carry no exercises). No invented fields.
//   - Pure: never mutates the input `week` or its arrays. Returns a NEW WeekPlan
//     with a NEW days array (the existing day objects are referenced, not copied).
//   - No-op-safe / idempotent: a week that already has all 7 weekdays keeps its
//     existing day objects (no duplicates); densifying an already-dense week again
//     produces an equivalent week. If a weekday somehow appears twice in the input,
//     the first occurrence is kept and the duplicate dropped (one slot per weekday).
export function densifyWeek(week: WeekPlan): WeekPlan {
  // Data-safety guard (Pass 2a audit NOTE 1): if a stored plan's `days` is somehow
  // not an array (corrupt/legacy/malformed write), iterating it would throw, and
  // the outer storage try/catch turns that throw into `return null` — which dumps
  // the user to onboarding and LOSES HER WHOLE PROFILE, not just the plan. Degrade
  // a malformed `days` to an empty list so the week becomes an all-rest week and
  // everything else she's logged is preserved.
  const sourceDays: PlanDay[] = Array.isArray(week.days) ? week.days : [];
  const byWeekday = new Map<Weekday, PlanDay>();
  for (const d of sourceDays) {
    if (!byWeekday.has(d.weekday)) byWeekday.set(d.weekday, d);
  }
  // Build in a stable, sensible Mon→Sun order (the accordion re-sorts to its own
  // Sun-first display order, so this is just for tidy storage).
  const days: PlanDay[] = WEEKDAYS.map((wd) => {
    const existing = byWeekday.get(wd);
    if (existing) return existing;
    return { weekday: wd, kind: "rest", title: "Rest", intensity: "rest" };
  });
  return { ...week, days };
}

// Rotate the WHOLE week's CONTENT forward/back by N weekday slots (a pure
// rotation — invents nothing, loses nothing). Used by the Coach's shift_plan
// tool so "move all my workouts forward a day" rotates every day at once, not
// just one.
//
// Semantics: the content originally on weekday `Wsrc` lands on weekday
//   `Wdst = (Wsrc + days)` over the Mon..Sun cycle (wrapping Sun→Mon).
// `days` positive = FORWARD (each workout moves to a LATER weekday). The
// resulting PlanDay for slot `Wdst` is the source day's full content with its
// `weekday` field rewritten to `Wdst`; everything else of the content is
// preserved verbatim (kind/title/intensity/durationMin/activity/focus/note/
// distance/sections WITH each exercise's `done`/id, and `loggedEntryId`).
//
// Effective rotation is `((days % 7) + 7) % 7`; a 0 rotation returns the
// densified days unchanged (a no-op). Operates on a densified copy so all 7
// weekday slots exist before rotating. Pure: never mutates the input week or
// its day objects (it references the existing PlanDay objects, only overriding
// each one's `weekday`). Returns a NEW days array in Mon..Sun order.
export function shiftWeekDays(week: WeekPlan, days: number): PlanDay[] {
  // Densify first so every weekday has a slot to rotate into/out of. densifyWeek
  // returns existing day objects untouched + minimal rest days for any gaps.
  const dense = densifyWeek(week).days;
  const eff = ((days % 7) + 7) % 7;
  // No-op: a full-week (or zero) rotation lands every day right back where it is.
  if (eff === 0) return dense;
  // Index the densified days by weekday for the modular lookup below.
  const byWeekday = new Map<Weekday, PlanDay>();
  for (const d of dense) byWeekday.set(d.weekday, d);
  // For each DESTINATION slot (Mon..Sun), the source is the slot `eff` positions
  // earlier in the WEEKDAYS cycle: src = (dstIndex - eff + 7) % 7. The source's
  // content moves here, with its weekday rewritten to the destination.
  return WEEKDAYS.map((dstWd, dstIdx) => {
    const srcIdx = (dstIdx - eff + 7) % 7;
    const src = byWeekday.get(WEEKDAYS[srcIdx]);
    // src always exists (dense has all 7); the fallback keeps types honest.
    if (!src) return { weekday: dstWd, kind: "rest", title: "Rest", intensity: "rest" } as PlanDay;
    return { ...src, weekday: dstWd };
  });
}

// Did a plan-day write MATERIALLY change the day? Used to gate the "PLAN UPDATED"
// card so it can never flash on a no-op or a blind same-content rewrite. Material
// = any of: title, kind, intensity, duration, or activity changed, OR the set of
// exercises changed (a name added or removed). An exercise-internal tweak (e.g.
// reps/weight on a matched name) also counts as material — we detect it by hashing
// the normalized exercise tuples, not just names. Pure; safe to unit-test.
export function planDayChanged(
  before: PlanDay | undefined,
  after: PlanDay | undefined
): boolean {
  // A missing post-day means nothing landed — never material (and never a card).
  if (!after) return false;
  // No pre-day but a real post-day = a slot got content; treat as material.
  if (!before) return true;
  if ((before.title ?? "") !== (after.title ?? "")) return true;
  if (before.kind !== after.kind) return true;
  if (before.intensity !== after.intensity) return true;
  if ((before.durationMin ?? null) !== (after.durationMin ?? null)) return true;
  if ((before.activity ?? "") !== (after.activity ?? "")) return true;
  // Exercise-set comparison: order-independent signature of each exercise's
  // identity + the dialable fields. If the multiset differs in any way (added,
  // removed, or a matched exercise's sets/reps/weight changed), it's material.
  const sig = (e: PlanExercise) =>
    `${e.name.trim().toLowerCase()}|${e.sets ?? ""}|${String(e.reps ?? "").trim().toLowerCase()}|${e.weight ?? ""}`;
  const a = dayExercises(before).map(sig).sort();
  const b = dayExercises(after).map(sig).sort();
  if (a.length !== b.length) return true;
  return a.some((s, i) => s !== b[i]);
}

// --- Fuzzy exercise-name matching (precision-biased) --------------------------
// The Coach edits a single exercise by name, but it can't see the day's stored
// canonical names, so it paraphrases ("bent over row" for "Bent-over dumbbell
// row", "RDL" for "Romanian Deadlift"). Without fuzzy matching, mergePlanDay
// appends a duplicate. matchExerciseName resolves a paraphrase to the existing
// exercise it most confidently means.
//
// SAFETY POSTURE: editing the WRONG exercise is worse than appending a duplicate.
// So this is biased hard toward precision — it only returns a match when it is
// confident AND unambiguous, and returns null otherwise (caller then appends as
// new). It never renames the stored exercise to the paraphrase.

// Whole-token abbreviation expansions. Short and obvious on purpose — common gym
// shorthand the Coach (or the user via the Coach) is likely to type.
const EX_ABBREV: Record<string, string> = {
  rdl: "romanian deadlift",
  db: "dumbbell",
  bb: "barbell",
  ohp: "overhead press",
  sldl: "stiff leg deadlift",
  bw: "bodyweight",
};

// Equipment / posture / filler tokens that don't, by themselves, identify a
// movement. A shared token from this set is NOT enough to call a match — the two
// names must share a real movement token (e.g. "row", "squat", "deadlift") so
// "cable row" and "bent over row" can't match on "row"... wait, "row" IS the
// movement here. The point of this set is the reverse: "dumbbell" alone can't
// bind "dumbbell row" to "dumbbell curl".
const EX_GENERIC = new Set([
  "dumbbell",
  "barbell",
  "machine",
  "cable",
  "band",
  "kettlebell",
  "weighted",
  "bodyweight",
  "seated",
  "standing",
]);

function normalizeExName(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ") // hyphens & punctuation -> spaces
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize: normalize, expand abbreviations per-token, then singularize a
// trailing "s" on tokens longer than 3 chars ("squats"->"squat", "curls"->"curl"
// but NOT "press"). Returns a de-duplicated token Set.
function exTokens(name: string): Set<string> {
  const raw = normalizeExName(name).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (const t of raw) {
    const expanded = EX_ABBREV[t] ?? t;
    for (const part of expanded.split(" ")) {
      const sing = part.length > 3 && part.endsWith("s") ? part.slice(0, -1) : part;
      if (sing) out.add(sing);
    }
  }
  return out;
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

const EX_MATCH_THRESHOLD = 0.6; // min token-overlap score to even consider a match
const EX_AMBIGUITY_MARGIN = 0.15; // top two within this -> ambiguous -> null

// Regroup a flat list of (exercise, source-section-index) slots back into the
// original sections, preserving each section's order, name, and durationMin.
//   - Exercises are placed in their tagged section's bucket, in the order they
//     appear in `slots` (so within-section order is preserved).
//   - Slots tagged sec = -1 (genuinely new exercises on a day that had NO sections
//     to begin with) collect into a synthetic { name: "Workout" } section appended
//     at the end. (When the day DID have sections, new exercises are tagged with a
//     real default-section index by the caller, so they never hit this branch.)
//   - Sections that end up empty (all their exercises were removed) are DROPPED,
//     while the relative order of the sections that survive is preserved.
// Returns undefined only when nothing remains at all (no surviving exercises),
// which mergePlanDay treats as an empty strength day — equivalent to the old
// single-empty-"Workout"-section shape since dayExercises flattens both to [].
function regroupSections(
  srcSections: PlanSection[],
  slots: { ex: PlanExercise; sec: number }[]
): PlanSection[] {
  const buckets: PlanExercise[][] = srcSections.map(() => []);
  const orphans: PlanExercise[] = [];
  for (const { ex, sec } of slots) {
    if (sec >= 0 && sec < buckets.length) buckets[sec].push(ex);
    else orphans.push(ex);
  }
  const out: PlanSection[] = [];
  srcSections.forEach((s, i) => {
    if (buckets[i].length === 0) return; // drop emptied sections
    out.push({
      name: s.name,
      ...(s.durationMin != null ? { durationMin: s.durationMin } : {}),
      exercises: buckets[i],
    });
  });
  if (orphans.length) out.push({ name: "Workout", exercises: orphans });
  return out;
}

// Return the single best CONFIDENT, UNAMBIGUOUS candidate for `incomingName`, or
// null if none clears the bar or the top two are too close to separate. Pure and
// deterministic (no Math.random); ties resolve to null via the ambiguity guard.
export function matchExerciseName(
  incomingName: string,
  candidates: PlanExercise[]
): PlanExercise | null {
  const incNorm = normalizeExName(incomingName);
  if (!incNorm) return null;
  const incTokens = exTokens(incomingName);
  if (incTokens.size === 0) return null;

  // 1) Exact-normalized match wins outright (highest confidence, bypasses the
  //    ambiguity guard). First such candidate in order is returned. Note
  //    `incTokens` is built via exTokens(), which expands abbreviations BEFORE
  //    this point, so "RDL" -> "romanian deadlift" (2 tokens), "OHP" ->
  //    "overhead press" (2 tokens), etc. are already multi-token here.
  for (const c of candidates) {
    if (normalizeExName(c.name) === incNorm) return c;
  }

  // Single-token incoming names are exact-only: if no candidate matched
  // exactly above, return null (caller appends a new exercise). A lone base
  // movement word ("deadlift", "press", "curl", "row") is inherently
  // ambiguous — it could be ANY variant — so fuzzy containment would happily
  // bind "deadlift" onto "Romanian deadlift" and silently overwrite the wrong
  // lift with no runner-up to trip the ambiguity guard. Appending a harmless
  // duplicate is the safe fallback; guessing is not. Multi-token incoming
  // names (size >= 2, including expanded abbreviations) are specific enough to
  // fall through to the fuzzy scoring below.
  if (incTokens.size === 1) return null;

  // 2) Score the rest by token overlap, keeping only those that clear the
  //    threshold AND share a real (non-generic) movement token.
  type Scored = { ex: PlanExercise; score: number };
  const scored: Scored[] = [];
  for (const c of candidates) {
    const cTokens = exTokens(c.name);
    if (cTokens.size === 0) continue;
    const inter = intersectCount(incTokens, cTokens);
    if (inter === 0) continue;
    // Require at least one shared token that actually names a movement.
    let sharesMovement = false;
    for (const t of incTokens) {
      if (cTokens.has(t) && !EX_GENERIC.has(t)) {
        sharesMovement = true;
        break;
      }
    }
    if (!sharesMovement) continue;
    const containment = inter / Math.min(incTokens.size, cTokens.size);
    const dice = (2 * inter) / (incTokens.size + cTokens.size);
    const score = Math.max(containment, dice);
    if (score >= EX_MATCH_THRESHOLD) scored.push({ ex: c, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  // 3) Ambiguity guard: if the runner-up is within the margin of the leader, we
  //    can't tell which the Coach meant — append rather than risk the wrong edit.
  if (scored.length >= 2 && scored[0].score - scored[1].score < EX_AMBIGUITY_MARGIN) {
    return null;
  }
  return scored[0].ex;
}

// Merge a model-supplied PATCH into an existing plan day WITHOUT destroying what
// the model didn't mention. This is the antidote to the silent-deletion bug:
// because the model can't see the day's current exercises, omitting `exercises`
// must mean "leave them alone," not "wipe the day." Semantics:
//   - Scalar fields (title/kind/intensity/durationMin/activity) overwrite only
//     when the patch actually supplied them; otherwise the existing value stays.
//   - Exercises: if the patch supplies some, match incoming to existing by
//     case-insensitive name — update sets/reps/weight/note in place, PRESERVING
//     each matched exercise's `done` flag and id — append genuinely new ones, and
//     KEEP existing exercises the patch didn't mention. If the patch supplies no
//     exercises, `existing.sections` is preserved untouched.
//   - loggedEntryId rides along unless the day is being turned into a rest day
//     (a rest day can't be "logged" in the strength sense).
//   - removeExercises: each name is matched (matchExerciseName, same precision as
//     updates) against ONLY the day's pre-existing exercises — never against ones
//     just appended from incomingExercises this same call — so a SWAP ("remove
//     reverse lunge" + "add walking lunge") can't accidentally remove the new
//     exercise. An unmatched / ambiguous / single-token removal name is a no-op.
// `incoming` is already the normalized PlanExercise[] the handler built from the
// model's args (with fresh ids). Pure; safe to unit-test.
export function mergePlanDay(
  existing: PlanDay,
  patch: {
    title?: string;
    kind?: PlanDay["kind"];
    intensity?: DayIntensity;
    durationMin?: number;
    activity?: string;
    note?: string;
    incomingExercises?: PlanExercise[]; // undefined = model named no exercises
    removeExercises?: string[]; // names to drop from the day's EXISTING exercises
  }
): PlanDay {
  const norm = (n: string) => n.trim().toLowerCase();
  const nextKind = patch.kind ?? existing.kind;

  const hasIncoming = !!(patch.incomingExercises && patch.incomingExercises.length);
  const hasRemovals = !!(patch.removeExercises && patch.removeExercises.length);

  // Build the merged exercise set when the model supplied exercises OR removals.
  let sections = existing.sections;
  if (hasIncoming || hasRemovals) {
    // Flatten across ALL sections into one working list while REMEMBERING which
    // section each existing exercise belongs to (by source section index). Updates
    // and removals operate on this flat list (so matching searches every section's
    // exercises), then we regroup back into the original sections at the end —
    // preserving each section's order, name, and durationMin. New exercises with no
    // match land in the DEFAULT section (shared rule). This replaces the old
    // flatten-to-one-"Workout"-section behavior that destroyed Warm-up grouping.
    const srcSections = existing.sections ?? [];
    // Working copy of every existing exercise, tagged with its origin section.
    // sec = -1 marks a brand-new appended exercise (resolved to a section later).
    type Slot = { ex: PlanExercise; sec: number };
    const merged: Slot[] = [];
    srcSections.forEach((s, si) => {
      s.exercises.forEach((ex) => merged.push({ ex, sec: si }));
    });
    // Indices of entries that were APPENDED from incoming this call (i.e. brand-new
    // exercises). Removal candidates EXCLUDE these so a swap can't delete the new
    // exercise it just added. Existing-origin entries keep their slot, so a matched
    // update stays existing-origin and remains removable.
    const appendedIdx = new Set<number>();
    // Existing indices already claimed by a prior incoming, so two incomings can't
    // both grab the same existing exercise.
    const claimed = new Set<number>();

    // Which section should a genuinely-new incoming exercise join? The shared
    // default-section rule, resolved against the day's existing sections.
    const defaultSec = defaultSectionIndex(srcSections);

    // Walk incoming exercises IN ORDER. For each, resolve to an existing exercise
    // — first by exact (case-insensitive) name, then by confident/unambiguous
    // fuzzy match (matchExerciseName) over only the UNCLAIMED existing ones,
    // searching ACROSS ALL sections.
    (patch.incomingExercises ?? []).forEach((inc) => {
      // Exact normalized-name match first (highest confidence), among unclaimed.
      let targetIdx = -1;
      for (let i = 0; i < merged.length; i++) {
        if (!claimed.has(i) && norm(merged[i].ex.name) === norm(inc.name)) {
          targetIdx = i;
          break;
        }
      }
      // Otherwise try a fuzzy match against the remaining unclaimed candidates.
      if (targetIdx === -1) {
        const unclaimed = merged
          .map((slot, i) => ({ ex: slot.ex, i }))
          .filter(({ i }) => !claimed.has(i));
        const hit = matchExerciseName(inc.name, unclaimed.map((u) => u.ex));
        if (hit) targetIdx = unclaimed.find((u) => u.ex === hit)?.i ?? -1;
      }

      if (targetIdx === -1) {
        // No confident match — append as a genuinely new exercise into the default
        // section. Mark its index so removals can't target it (a swap adds new +
        // removes old in one call).
        merged.push({ ex: inc, sec: defaultSec });
        appendedIdx.add(merged.length - 1);
        return;
      }
      // Patch in place IN ITS CURRENT SECTION. PRESERVE the existing id, done,
      // canonical name, and section; only the dialable fields move, falling back to
      // existing when incoming omits.
      claimed.add(targetIdx);
      const slot = merged[targetIdx];
      merged[targetIdx] = {
        sec: slot.sec,
        ex: {
          ...slot.ex, // preserves id, done, and (via not overriding) name
          sets: inc.sets ?? slot.ex.sets,
          reps: inc.reps ?? slot.ex.reps,
          weight: inc.weight ?? slot.ex.weight,
          note: inc.note ?? slot.ex.note,
        },
      };
    });

    // Apply removals AFTER the append step, matching ONLY against existing-origin
    // entries (exclude just-appended ones). matchExerciseName carries its own
    // precision (exact-only for single tokens, ambiguity guard, movement gate) —
    // an unmatched name removes nothing. Removed indices are collected first, then
    // filtered out together so each removal name resolves against the full set of
    // existing candidates independently. Matching searches across all sections.
    const removeIdx = new Set<number>();
    (patch.removeExercises ?? []).forEach((rawName) => {
      if (!rawName?.trim()) return;
      // Candidates: existing-origin entries not already slated for removal.
      const candidates = merged
        .map((slot, i) => ({ ex: slot.ex, i }))
        .filter(({ i }) => !appendedIdx.has(i) && !removeIdx.has(i));
      // Exact normalized-name match first (highest confidence).
      let hitIdx = candidates.find((c) => norm(c.ex.name) === norm(rawName))?.i ?? -1;
      if (hitIdx === -1) {
        const hit = matchExerciseName(rawName, candidates.map((c) => c.ex));
        if (hit) hitIdx = candidates.find((c) => c.ex === hit)?.i ?? -1;
      }
      if (hitIdx !== -1) removeIdx.add(hitIdx);
    });
    const finalSlots = merged.filter((_, i) => !removeIdx.has(i));

    if (nextKind === "rest") {
      // Turning the day into a rest day clears its exercises regardless of edits.
      sections = undefined;
    } else {
      // Regroup the surviving exercises back into their original sections,
      // preserving each section's order, name, and durationMin. New exercises whose
      // sec is -1 (no existing section at all) fall into a synthetic "Workout"
      // section. Sections that ended up empty after edits are DROPPED.
      sections = regroupSections(srcSections, finalSlots);
    }
  } else if (nextKind === "rest") {
    // Turning the day into a rest day clears its exercises.
    sections = undefined;
  }

  return {
    ...existing,
    weekday: existing.weekday,
    kind: nextKind,
    title: patch.title?.trim() ? patch.title.trim() : existing.title,
    intensity: patch.intensity ?? existing.intensity,
    durationMin: patch.durationMin ?? existing.durationMin,
    activity:
      nextKind === "activity"
        ? patch.activity?.trim() || patch.title?.trim() || existing.activity
        : existing.activity,
    note: patch.note ?? existing.note,
    sections,
    // Completion rides along unless we just turned the day into a rest day.
    loggedEntryId: nextKind === "rest" ? undefined : existing.loggedEntryId,
  };
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

// A day counts as a COMPLETED session (whole-day checkmark filled, counts toward
// "N of M sessions done") only when it's genuinely finished:
//   - strength : it has exercises AND every one is checked off (done). A partial
//     check-off still logs what she did (see syncStrengthLog) and so is dayLogged,
//     but it is NOT dayComplete until the last exercise is crossed off.
//   - activity : the manual "Mark complete" chip set its loggedEntryId (there are
//     no exercises to cross off, so completion === logged here).
//   - rest     : never a session.
// This is deliberately distinct from dayLogged, which stays "is there a logged
// WorkoutEntry" (true after the FIRST strength exercise is checked). Use
// dayComplete for the checkmark + session counts; keep dayLogged for genuine
// "is there a logged entry / did she train at all" checks (e.g. the missed-streak
// guardrail and the trained-dot on the date strip).
export function dayComplete(day: PlanDay): boolean {
  if (day.kind === "rest") return false;
  if (day.kind === "strength") {
    const exs = dayExercises(day);
    return exs.length > 0 && exs.every((e) => e.done);
  }
  return !!day.loggedEntryId;
}

export function weekProgress(week: WeekPlan): { done: number; total: number } {
  const training = week.days.filter(isTrainingDay);
  return { done: training.filter(dayComplete).length, total: training.length };
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
        // Display-only descriptive focus from the plan day; surfaced in the Log
        // card detail. Omit when the plan day has none.
        ...(day.focus ? { focus: day.focus } : {}),
        date: dateISO,
      },
      "plan"
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
    "plan"
  );
}

// --- Code-computed calorie cycling (used by Food/Coach in Stage C) ------------
// Cycle the deterministic target around the day's intensity. Protein stays put;
// the calorie difference moves through carbs. The hard floors (BMR and the
// absolute 1200 kcal minimum) are re-applied AFTER cycling (see dayTargets), so
// rest/light multipliers can never push the daily calorie target below them.
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
  // Completion here mirrors the UI session count (weekProgress → dayComplete): a
  // strength day only "completed" once EVERY exercise is checked off, so a
  // partially-checked day reads as not-yet-done to the coach too (keeps the
  // review consistent with what she sees on the Plan card, and honest about
  // half-finished sessions rather than crediting them as full).
  // Three mutually-exclusive buckets (exact partition of `training`):
  //  - done    : finished session (every strength exercise checked / activity marked).
  //  - partial : she SHOWED UP (dayLogged) but didn't finish — some-but-not-all done.
  //              This is a strength-only case today: activity is all-or-nothing via
  //              loggedEntryId, so dayLogged && !dayComplete can't happen for it.
  //  - skipped : genuinely nothing logged (a true no-show).
  // Reporting a partial day as "skipped" would be factually wrong (she trained) and
  // could over-trip the anti-pushover "she missed a lot" branch, so partial is its
  // own bucket and is kept OUT of both the Skipped line and the miss threshold.
  const done = training.filter(dayComplete);
  const partial = training.filter((d) => !dayComplete(d) && dayLogged(d));
  const skipped = training.filter((d) => !dayComplete(d) && !dayLogged(d));
  const parts: string[] = [];
  parts.push(
    `Last week ("${week.programName}", week ${week.weekNumber}): she completed ${done.length} of ${training.length} planned workouts.`
  );
  if (partial.length) {
    parts.push(
      `Partially completed: ${partial
        .map((d) => {
          const label = `${WEEKDAY_LABELS[d.weekday]} ${d.title}`;
          if (d.kind !== "strength") return label; // guard: N/M is strength-only
          const exs = dayExercises(d);
          return `${label} (did ${exs.filter((e) => e.done).length} of ${exs.length} exercises)`;
        })
        .join(", ")}.`
    );
  }
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

  // --- Cross-reference the ACTUAL workout log (not just plan check-off state) ---
  // Two additive reads over the week's real WorkoutEntry rows: workouts she logged
  // that no plan day claims (credit them, factually), and the weights she actually
  // lifted on completed strength days (so next week progresses from real numbers,
  // which can differ from the planned ones after her in-session edits).
  const allEntries = dates.flatMap((dt) => workoutsFor(p, dt));
  const plannedEntryIds = new Set(
    week.days.map((d) => d.loggedEntryId).filter((id): id is string => !!id)
  );
  const entryById = new Map(allEntries.map((e) => [e.id, e] as const));

  // 1) Workouts logged outside the plan (id not owned by any plan day). Neutral
  //    "also trained" — not framed as bonus/earned. Capped so the line can't bloat.
  const unplanned = allEntries.filter((e) => !plannedEntryIds.has(e.id));
  if (unplanned.length) {
    const label = (e: WorkoutEntry): string => {
      const wd = WEEKDAY_LABELS[weekdayKey(parseISO(e.date))];
      if (e.kind === "activity") {
        const dur = e.durationMin ? `${e.durationMin}-min ` : "";
        return `${wd} ${dur}${e.activity || "activity"}`.replace(/\s+/g, " ").trim();
      }
      const n = (e.exercises ?? []).length;
      return `${wd} strength${n ? ` (${n} exercise${n === 1 ? "" : "s"})` : ""}`;
    };
    const shown = unplanned.slice(0, 4).map(label);
    const extra = unplanned.length - shown.length;
    parts.push(
      `Also trained outside the plan: ${shown.join(", ")}${extra > 0 ? `, +${extra} more` : ""}.`
    );
  }

  // 2) Actual lifted loads on completed/partial strength days. Per exercise: the
  //    top working weight (max across its sets) and the reps at that set. Bodyweight
  //    exercises (no weight anywhere) are omitted — the point is real numbers to
  //    progress FROM. Capped at the 8 heaviest so the prompt stays lean.
  const loads = [...done, ...partial]
    .filter((d) => d.kind === "strength" && d.loggedEntryId)
    .flatMap((d) => entryById.get(d.loggedEntryId as string)?.exercises ?? [])
    .map((x) => {
      let top: { weight: number; reps: number } | null = null;
      for (const s of x.sets ?? []) {
        if (s.weight == null) continue;
        if (!top || s.weight > top.weight) top = { weight: s.weight, reps: s.reps };
      }
      return top ? { name: x.name, weight: top.weight, reps: top.reps } : null;
    })
    .filter((a): a is { name: string; weight: number; reps: number } => a !== null)
    .sort((a, b) => b.weight - a.weight);
  const shownLoads = loads.slice(0, 8);
  if (shownLoads.length) {
    const extra = loads.length - shownLoads.length;
    const list = shownLoads.map(
      (a) => `${a.name} ${a.weight} lb${a.reps > 0 ? ` x ${a.reps}` : ""}`
    );
    parts.push(`Actual loads: ${list.join(", ")}${extra > 0 ? `, +${extra} more` : ""}.`);
  }

  if (done.length === training.length && training.length > 0) {
    let line = "She completed everything — progress the loads where it makes sense.";
    if (shownLoads.length) {
      line += " Progress from the actual loads listed above, not from the planned numbers.";
    }
    parts.push(line);
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
  // Re-apply the hard floors: rest/light multipliers must never drop the daily
  // target below the larger of BMR and the absolute 1200 kcal minimum. Clamp
  // before deriving carbs so macros stay consistent with the clamped calories.
  const bmr = computeBMR(profile);
  const floored = Math.max(base.calories * f, bmr ?? 0, MIN_DAILY_CALORIES);
  const calories = Math.round(floored / 10) * 10;
  const protein = base.protein;
  const fat = base.fat;
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4 / 5) * 5);
  // Fiber tracks the base target on cycled days — it's a daily-habit number
  // (driven by total kcal), not an intensity dial like calories.
  return { calories, protein, carbs, fat, fiber: base.fiber };
}
