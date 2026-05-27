import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import {
  Profile,
  WorkoutEntry,
  WorkoutExercise,
  WorkoutKind,
  ACTIVITY_OPTIONS,
  PlanSetup,
  PlanDay,
  WeekPlan,
  Weekday,
  Experience,
  WEEKDAYS,
  WEEKDAY_LABELS,
  ACCESS_OPTIONS,
  EXPERIENCE_OPTIONS,
} from "../lib/types";
import { currentPhase, toISODate, parseISO, addDays } from "../lib/cycle";
import {
  workoutsFor,
  makeWorkout,
  addWorkout,
  updateWorkout,
  removeWorkout,
  recentExercises,
  recentActivities,
  exerciseLabel,
  expandSets,
  estimateBurn,
  estimateExerciseBurn,
  repsToMinutes,
  profileWeightKg,
  newId,
} from "../lib/workouts";
import {
  weekdayKey,
  dateForWeekday,
  dayExercises,
  dayLogged,
  weekProgress,
  planDayToWorkoutEntry,
  weekReviewSummary,
  mondayOf,
  isWeekComplete,
} from "../lib/plan";
import { generateWeekPlan } from "../lib/coach";
// Shared with OnboardingScreen (height/weight/goal-weight steppers). Replaced
// the iOS countdown DateTimePicker that previously hosted "Time per session" —
// the picker was the crash surface on the onboarding → workout auto-open
// transition (Modal slide-in + UIDatePicker mount during the same commit as
// six simultaneous screen mounts). Stepper is pure RN, no native bridge.
import { Stepper } from "../components/Stepper";

const ACCENT = "#7c3aed";
const BURN = "#e8833a";

// Plan-setup session-length stepper bounds. 15-min floor (anything shorter is
// effectively a walk, not a workout); 2-hour ceiling (covers long-run / long-
// gym days); 5-min increments so taps feel meaningful and the press-and-hold
// repeat doesn't blow past a usable range.
const SESSION_MIN_MINUTES = 15;
const SESSION_MAX_MINUTES = 120;
const SESSION_STEP_MINUTES = 5;

const PHASE_LEAN: Record<string, string> = {
  menstrual: "Many women keep it gentler now — mobility, walks, lighter lifts. Go by how you feel.",
  follicular: "Energy often climbs here — a good window to push intensity or chase a PR.",
  ovulatory: "Often peak strength and energy — great for harder training. Keep water up.",
  luteal: "Many women feel steadier with moderate, lower-volume work and a bit more recovery.",
};

// Pretty-print minutes as "1 hr 30 min" / "45 min" — used in the plan-setup
// stepper hint and elsewhere in this screen.
function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}

function dayLabel(iso: string): string {
  const today = toISODate(new Date());
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return "Yesterday";
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function WorkoutScreen({
  profile,
  updateProfile,
  onOpenCoach,
  openSetupSignal,
}: {
  profile: Profile;
  // Shared updater (App.tsx): every transform runs against the LATEST profile,
  // so plan edits and workout logs compose with the Coach's writes instead of
  // one silently clobbering the other.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  onOpenCoach: () => void;
  // Counter bumped by App when onboarding finishes on the "create a workout plan"
  // path. Each increment auto-opens the plan-setup sheet (see effect below) so she
  // lands straight in setup. Optional so other callers/tests can omit it.
  openSetupSignal?: number;
}) {
  const today = toISODate(new Date());
  const phase = currentPhase(profile);
  const lean = !phase.onBirthControl && phase.phase in PHASE_LEAN ? PHASE_LEAN[phase.phase] : "";
  const weightKg = profileWeightKg(profile);

  // Add sheet
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<"strength" | "activity">("strength");

  // Strength builder
  const [built, setBuilt] = useState<WorkoutExercise[]>([]);
  const [exName, setExName] = useState("");
  const [exSets, setExSets] = useState("3");
  const [exReps, setExReps] = useState("10");
  const [exWeight, setExWeight] = useState("");
  const [sDur, setSDur] = useState("");
  const [sNote, setSNote] = useState("");

  // Activity form
  const [actName, setActName] = useState("");
  const [actDur, setActDur] = useState("");
  const [actDist, setActDist] = useState("");
  const [actNote, setActNote] = useState("");

  // Shared "from your watch" inputs (reused by whichever form is open)
  const [wBurn, setWBurn] = useState("");
  const [wAvg, setWAvg] = useState("");
  const [wMax, setWMax] = useState("");

  // Edit existing
  const [editEntry, setEditEntry] = useState<WorkoutEntry | null>(null);
  const [eActName, setEActName] = useState("");
  const [eDur, setEDur] = useState("");
  const [eActDist, setEActDist] = useState("");
  const [eNote, setENote] = useState("");
  const [eBurn, setEBurn] = useState("");
  const [eAvg, setEAvg] = useState("");
  const [eMax, setEMax] = useState("");

  // Workout tab has two sub-tabs: the tailored Plan, and the Log (calendar).
  const [activeTab, setActiveTab] = useState<"plan" | "log">("plan");

  // Log calendar (Cal AI–style horizontal day strip): last 42 days through today.
  const [logSelDate, setLogSelDate] = useState(today);
  const stripRef = useRef<ScrollView>(null);
  const logDays: string[] = [];
  for (let i = 41; i >= 0; i--) logDays.push(addDays(today, -i));
  const selEntries = workoutsFor(profile, logSelDate);
  const dayBurned = selEntries.reduce((s, e) => s + (e.caloriesBurned || 0), 0);
  const dayMinutes = selEntries.reduce((s, e) => s + (e.durationMin || 0), 0);

  // Plan (Feature E)
  const plan = profile.plan;
  const week = plan?.current ?? null;
  const [selectedWd, setSelectedWd] = useState<Weekday>(weekdayKey());
  const selectedDay = week?.days.find((d) => d.weekday === selectedWd) ?? null;

  // Plan setup form
  const [setupOpen, setSetupOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [spWorkoutDays, setSpWorkoutDays] = useState<Weekday[]>([]);
  // Session length in minutes (plain number). Was previously a Date encoded
  // for the iOS countdown DateTimePicker; replaced by a cross-platform Stepper
  // that reads/writes minutes directly. Default 45 matches the prior default.
  const [spSessionMinutes, setSpSessionMinutes] = useState<number>(45);
  const [spAccess, setSpAccess] = useState<string[]>([]);
  const [spEquip, setSpEquip] = useState("");
  const [spClasses, setSpClasses] = useState("");
  const [spExp, setSpExp] = useState<Experience>("beginner");
  const [spInjury, setSpInjury] = useState("");

  // Week-in-review (Stage B)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewWeek, setReviewWeek] = useState<WeekPlan | null>(null);
  const [tweakText, setTweakText] = useState("");
  const [reviewErr, setReviewErr] = useState("");
  // The week is "over" once a new calendar week has started or it's fully done.
  const weekIsOver = !!week && (mondayOf(new Date()) !== week.startDate || isWeekComplete(week));

  // All persistence goes through the shared updater so each transform applies to
  // the LATEST profile (never the render-time `profile` prop). Local alias.
  const persist = updateProfile;

  function openPlanSetup() {
    const s = plan?.setup;
    setSpWorkoutDays(s?.workoutDays ?? []);
    setSpSessionMinutes(s?.sessionMinutes ?? 45);
    setSpAccess(s?.access ?? []);
    setSpEquip(s?.equipment ?? "");
    setSpClasses(s?.classes ?? "");
    setSpExp(s?.experience ?? "beginner");
    setSpInjury(s?.injuries ?? "");
    setGenError("");
    setSetupOpen(true);
  }

  // Onboarding's "create a workout plan" path bumps openSetupSignal. On each new
  // value (>0) make sure we're on the Plan sub-tab and open the same setup sheet
  // the no-plan CTA opens, so she lands straight in plan setup. Guard the initial
  // 0 so a normal mount never auto-opens. Disable the exhaustive-deps lint: this
  // must fire ONLY when the signal changes, not when openPlanSetup's closure does.
  //
  // CRASH FIX: defer the auto-open one tick. On a fresh-onboarding completion,
  // OnboardingScreen unmounts and all six main screens (incl. WorkoutScreen)
  // mount in the SAME commit. The original crash surface — an iOS countdown
  // DateTimePicker mounting inside this Modal during that transition — has
  // been removed (replaced with a pure-RN Stepper, see below). The
  // `setTimeout(0)` stays as belt-and-suspenders for any remaining native
  // bridge timing issue on this transition (Modal slide-in during the same
  // commit as six screen mounts). We also clear the timer on unmount so a
  // navigate-away mid-defer doesn't fire setState on an unmounted screen.
  useEffect(() => {
    if (!openSetupSignal) return;
    setActiveTab("plan");
    const t = setTimeout(() => {
      openPlanSetup();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSetupSignal]);

  function toggleAccess(key: string) {
    setSpAccess((a) => (a.includes(key) ? a.filter((x) => x !== key) : [...a, key]));
  }
  function toggleWorkoutDay(wd: Weekday) {
    setSpWorkoutDays((d) => (d.includes(wd) ? d.filter((x) => x !== wd) : [...d, wd]));
  }

  async function generatePlan() {
    // Keep workout days in Mon–Sun order.
    const days = WEEKDAYS.filter((d) => spWorkoutDays.includes(d));
    const setup: PlanSetup = {
      daysPerWeek: days.length || 4,
      workoutDays: days.length ? days : undefined,
      sessionMinutes: spSessionMinutes || undefined,
      access: spAccess.length ? spAccess : ["home"],
      equipment: spEquip.trim() || undefined,
      classes: spClasses.trim() || undefined,
      experience: spExp,
      injuries: spInjury.trim() || undefined,
    };
    setGenerating(true);
    setGenError("");
    try {
      const wk = await generateWeekPlan(profile, setup, { weekNumber: 1 });
      // Overlay onto the LATEST profile: preserve its history (and any other
      // field the Coach may have written while the plan was generating).
      await persist((p) => ({
        ...p,
        plan: { setup, current: wk, history: p.plan?.history ?? [] },
      }));
      setSelectedWd(weekdayKey());
      setSetupOpen(false);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Set/clear the logged WorkoutEntry for a plan day, then write the day back.
  // Operates on the passed-in LATEST profile `prof` (supplied by updateProfile),
  // not the render-time `profile`, so the workoutLogs change composes with any
  // concurrent write. `day` carries the desired day state to write back.
  function commitDay(prof: Profile, day: PlanDay, wantLogged: boolean): Profile {
    const cur = prof.plan?.current;
    if (!cur) return prof;
    const next = { ...day };
    const dateISO = dateForWeekday(cur.startDate, day.weekday);
    if (wantLogged && !next.loggedEntryId) {
      const entry = planDayToWorkoutEntry(prof, next, dateISO);
      if (entry) {
        prof = addWorkout(prof, entry);
        next.loggedEntryId = entry.id;
      }
    } else if (!wantLogged && next.loggedEntryId) {
      prof = removeWorkout(prof, dateISO, next.loggedEntryId);
      next.loggedEntryId = undefined;
    }
    const cur2 = prof.plan!.current!;
    const days = cur2.days.map((d) => (d.weekday === next.weekday ? next : d));
    return { ...prof, plan: { ...prof.plan!, current: { ...cur2, days } } };
  }

  // Toggle one plan exercise's done state on the LATEST profile, then re-sync the
  // day's logged workout. We re-find the day (by weekday) and the exercise (by
  // stable id) in `p.plan.current` rather than reusing the render-time
  // `selectedDay`, so a concurrent Coach plan edit (adjust/move day) isn't lost.
  function toggleExercise(exId: string) {
    const wd = selectedWd;
    persist((p) => {
      const cur = p.plan?.current;
      const day = cur?.days.find((d) => d.weekday === wd);
      if (!cur || !day?.sections) return p;
      const newSections = day.sections.map((s) => ({
        ...s,
        exercises: s.exercises.map((e) => (e.id === exId ? { ...e, done: !e.done } : e)),
      }));
      const newDay: PlanDay = { ...day, sections: newSections };
      const days = cur.days.map((d) => (d.weekday === wd ? newDay : d));
      const withDay: Profile = { ...p, plan: { ...p.plan!, current: { ...cur, days } } };
      return syncStrengthLog(withDay, newDay);
    });
  }

  // Log the day as ONE grouped workout entry containing the checked exercises.
  // Calories = sum of the per-exercise (type-aware) estimates, so it's one total
  // you can override once (e.g. from your Apple Watch). Re-syncs as you check or
  // uncheck (cancel) exercises; a watch-entered total is preserved. Operates on
  // the passed-in LATEST profile `prof`; `day` is the already-updated plan day.
  function syncStrengthLog(prof: Profile, day: PlanDay): Profile {
    const cur = prof.plan?.current;
    if (!cur) return prof;
    const dateISO = dateForWeekday(cur.startDate, day.weekday);
    const next: PlanDay = { ...day };
    const checked = dayExercises(day).filter((e) => e.done);

    if (checked.length) {
      const kg = profileWeightKg(prof);
      const exercises: WorkoutExercise[] = checked.map((e) => ({
        id: newId(),
        name: e.name,
        sets: expandSets(e.sets ?? 1, parseInt(e.reps ?? "", 10) || 0, e.weight),
      }));
      const estBurn = checked.reduce((s, e) => s + (estimateExerciseBurn(e.name, e.reps, e.sets, kg) ?? 0), 0);
      const dur = Math.round(
        checked.reduce((s, e) => s + (repsToMinutes(e.reps ?? "") ?? (e.sets ?? 1) * 1.5), 0)
      );
      const existing = workoutsFor(prof, dateISO).find((w) => w.id === next.loggedEntryId);
      if (existing) {
        const keepWatch = existing.burnSource === "watch";
        prof = updateWorkout(prof, {
          ...existing,
          exercises,
          durationMin: dur,
          caloriesBurned: keepWatch ? existing.caloriesBurned : estBurn || undefined,
          burnSource: keepWatch ? "watch" : estBurn ? "estimate" : undefined,
        });
      } else {
        const entry = makeWorkout(
          {
            kind: "strength",
            exercises,
            durationMin: dur,
            ...(estBurn ? { caloriesBurned: estBurn, burnSource: "estimate" as const } : {}),
            note: day.title,
            date: dateISO,
          },
          "coach"
        );
        prof = addWorkout(prof, entry);
        next.loggedEntryId = entry.id;
      }
    } else if (next.loggedEntryId) {
      prof = removeWorkout(prof, dateISO, next.loggedEntryId);
      next.loggedEntryId = undefined;
    }

    const cur2 = prof.plan!.current!;
    const days = cur2.days.map((d) => (d.weekday === next.weekday ? next : d));
    return { ...prof, plan: { ...prof.plan!, current: { ...cur2, days } } };
  }

  function toggleDayDone() {
    if (!selectedDay) return;
    const wd = selectedWd;
    // Re-find the day in the LATEST profile and toggle its completion there.
    persist((p) => {
      const cur = p.plan?.current;
      const day = cur?.days.find((d) => d.weekday === wd);
      if (!cur || !day) return p;
      return commitDay(p, { ...day }, !day.loggedEntryId);
    });
  }

  // --- Week in review (Stage B) ---
  async function buildNextWeek(tweak?: string) {
    if (!week || !plan) return;
    setReviewing(true);
    setReviewErr("");
    try {
      const summary = weekReviewSummary(profile, week);
      const next = await generateWeekPlan(profile, plan.setup, {
        weekNumber: week.weekNumber + 1,
        recentSummary: summary,
        tweak: tweak?.trim() || undefined,
      });
      setReviewWeek(next);
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }
  function startReview() {
    setReviewWeek(null);
    setTweakText("");
    setReviewErr("");
    setReviewOpen(true);
    buildNextWeek();
  }
  function acceptReview() {
    if (!plan || !week || !reviewWeek) return;
    const nextWeek = reviewWeek;
    const finishedWeek = week;
    // Archive the finished week and start the new one, overlaying onto the LATEST
    // profile so we don't drop a concurrent write.
    persist((p) => {
      if (!p.plan) return p;
      return {
        ...p,
        plan: { ...p.plan, current: nextWeek, history: [...p.plan.history, finishedWeek] },
      };
    });
    setReviewOpen(false);
    setReviewWeek(null);
    setSelectedWd(weekdayKey());
  }

  function resetWatch() {
    setWBurn("");
    setWAvg("");
    setWMax("");
  }

  function openAdd() {
    setKind("strength");
    setBuilt([]);
    setExName("");
    setExSets("3");
    setExReps("10");
    setExWeight("");
    setSDur("");
    setSNote("");
    setActName("");
    setActDur("");
    setActDist("");
    setActNote("");
    resetWatch();
    setAddOpen(true);
  }

  function addExercise() {
    const name = exName.trim();
    const reps = parseInt(exReps, 10) || 0;
    const sets = parseInt(exSets, 10) || 0;
    if (!name || reps <= 0 || sets <= 0) return;
    const weight = exWeight.trim() ? parseFloat(exWeight) : undefined;
    setBuilt((b) => [...b, { id: newId(), name, sets: expandSets(sets, reps, weight) }]);
    setExName("");
  }

  // Resolve burned calories: a typed watch number wins; otherwise the estimate.
  function resolveBurn(
    kind: WorkoutKind,
    activity: string | undefined,
    durationMin: number | undefined,
    watch: string
  ): { caloriesBurned?: number; burnSource?: "watch" | "estimate" } {
    if (watch.trim()) {
      const n = Math.round(parseFloat(watch) || 0);
      if (n > 0) return { caloriesBurned: n, burnSource: "watch" };
    }
    const est = estimateBurn(kind, activity, durationMin, weightKg);
    return est != null ? { caloriesBurned: est, burnSource: "estimate" } : {};
  }

  function watchExtras(): Pick<WorkoutEntry, "avgHr" | "maxHr"> {
    return {
      avgHr: wAvg.trim() ? Math.round(parseFloat(wAvg)) : undefined,
      maxHr: wMax.trim() ? Math.round(parseFloat(wMax)) : undefined,
    };
  }

  async function saveStrength() {
    if (!built.length) return;
    const duration = parseFloat(sDur) || undefined;
    const entry = makeWorkout(
      {
        kind: "strength",
        exercises: built,
        durationMin: duration,
        ...resolveBurn("strength", undefined, duration, wBurn),
        ...watchExtras(),
        note: sNote.trim() || undefined,
        date: logSelDate,
      },
      "manual"
    );
    await persist((p) => addWorkout(p, entry));
    setAddOpen(false);
  }

  async function saveActivity() {
    const name = actName.trim();
    if (!name) return;
    const duration = parseFloat(actDur) || undefined;
    const entry = makeWorkout(
      {
        kind: "activity",
        activity: name,
        durationMin: duration,
        distance: actDist.trim() || undefined,
        ...resolveBurn("activity", name, duration, wBurn),
        ...watchExtras(),
        note: actNote.trim() || undefined,
        date: logSelDate,
      },
      "manual"
    );
    await persist((p) => addWorkout(p, entry));
    setAddOpen(false);
  }

  function openEdit(e: WorkoutEntry) {
    setEditEntry(e);
    setEActName(e.activity ?? "");
    setEDur(e.durationMin ? String(e.durationMin) : "");
    setEActDist(e.distance ?? "");
    setENote(e.note ?? "");
    setEBurn(e.burnSource === "watch" && e.caloriesBurned ? String(e.caloriesBurned) : "");
    setEAvg(e.avgHr ? String(e.avgHr) : "");
    setEMax(e.maxHr ? String(e.maxHr) : "");
  }

  async function saveEdit() {
    if (!editEntry) return;
    const duration = parseFloat(eDur) || undefined;
    const burn = resolveBurn(editEntry.kind, eActName || editEntry.activity, duration, eBurn);
    const updated: WorkoutEntry = {
      ...editEntry,
      durationMin: duration,
      ...burn,
      avgHr: eAvg.trim() ? Math.round(parseFloat(eAvg)) : undefined,
      maxHr: eMax.trim() ? Math.round(parseFloat(eMax)) : undefined,
      note: eNote.trim() || undefined,
      ...(editEntry.kind === "activity"
        ? { activity: eActName.trim() || editEntry.activity, distance: eActDist.trim() || undefined }
        : {}),
    };
    await persist((p) => updateWorkout(p, updated));
    setEditEntry(null);
  }

  async function deleteEntry() {
    if (!editEntry) return;
    const { date, id } = editEntry;
    await persist((p) => removeWorkout(p, date, id));
    setEditEntry(null);
  }

  const exRecents = recentExercises(profile);
  const actRecents = recentActivities(profile);
  const estStrength = estimateBurn("strength", undefined, parseFloat(sDur) || undefined, weightKg);
  const estActivity = estimateBurn("activity", actName, parseFloat(actDur) || undefined, weightKg);

  function burnText(e: WorkoutEntry): string {
    const bits: string[] = [];
    if (e.caloriesBurned)
      bits.push(`🔥 ${e.caloriesBurned} cal${e.burnSource === "estimate" ? " (est.)" : ""}`);
    if (e.avgHr) bits.push(`❤️ ${e.avgHr} avg${e.maxHr ? ` / ${e.maxHr} max` : ""}`);
    else if (e.maxHr) bits.push(`❤️ ${e.maxHr} max`);
    return bits.join("   ");
  }

  function WatchFields({ estimate }: { estimate: number | null }) {
    return (
      <>
        <Text style={styles.fieldLabel}>Manual (optional)</Text>
        {estimate != null && !wBurn.trim() ? (
          <Text style={styles.estHint}>Estimated burn ~{estimate} cal — or enter it manually below.</Text>
        ) : null}
        {estimate == null && !weightKg ? (
          <Text style={styles.estHint}>Add your weight in Settings to auto-estimate calories burned.</Text>
        ) : null}
        <View style={styles.row3}>
          <View style={styles.cell}>
            <Text style={styles.miniLabel}>Calories</Text>
            <TextInput
              style={styles.input}
              value={wBurn}
              onChangeText={setWBurn}
              keyboardType="numeric"
              placeholder={estimate != null ? String(estimate) : "—"}
            />
          </View>
          <View style={styles.cell}>
            <Text style={styles.miniLabel}>Avg HR</Text>
            <TextInput style={styles.input} value={wAvg} onChangeText={setWAvg} keyboardType="numeric" placeholder="—" />
          </View>
          <View style={styles.cell}>
            <Text style={styles.miniLabel}>Max HR</Text>
            <TextInput style={styles.input} value={wMax} onChangeText={setWMax} keyboardType="numeric" placeholder="—" />
          </View>
        </View>
      </>
    );
  }

  function EntryCard({ e }: { e: WorkoutEntry }) {
    const burn = burnText(e);
    return (
      <TouchableOpacity style={styles.card} onPress={() => openEdit(e)}>
        {e.kind === "activity" ? (
          <>
            <Text style={styles.cardTitle}>{e.activity || "Activity"}</Text>
            <Text style={styles.cardSub}>
              {[e.durationMin ? `${e.durationMin} min` : "", e.distance ?? ""].filter(Boolean).join(" · ") ||
                "logged"}
              {e.source === "coach" ? "  · via Coach" : ""}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.cardTitle}>
              Strength{e.durationMin ? ` · ${e.durationMin} min` : ""}
              {e.source === "coach" ? "  · via Coach" : ""}
            </Text>
            {(e.exercises ?? []).map((x) => (
              <Text key={x.id} style={styles.cardExercise}>
                {exerciseLabel(x)}
              </Text>
            ))}
          </>
        )}
        {burn ? <Text style={styles.cardBurn}>{burn}</Text> : null}
        {e.note ? <Text style={styles.cardNote}>{e.note}</Text> : null}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Workout</Text>

        <View style={styles.subtabs}>
          {(["plan", "log"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.subtab, activeTab === t && styles.subtabActive]}
              onPress={() => setActiveTab(t)}
            >
              <Text style={[styles.subtabText, activeTab === t && styles.subtabTextActive]}>
                {t === "plan" ? "Plan" : "Log"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === "plan" && (
          <>
        {/* Tailored plan */}
        {generating ? (
          <View style={styles.planLoading}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.planLoadingText}>Building your week…</Text>
          </View>
        ) : !week ? (
          <View style={styles.planCta}>
            <Text style={styles.planCtaTitle}>Your tailored plan</Text>
            <Text style={styles.planCtaText}>
              A week of training built around your goal and cycle — it adapts as you go and logs
              itself when you check it off.
            </Text>
            <TouchableOpacity style={styles.planCtaBtn} onPress={openPlanSetup}>
              <Text style={styles.planCtaBtnText}>Create my plan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.planHeader}>
              <View style={styles.flex}>
                <Text style={styles.planProgram}>{week.programName}</Text>
                <Text style={styles.planWeek}>
                  Week {week.weekNumber} · {weekProgress(week).done}/{weekProgress(week).total} done
                </Text>
              </View>
              <TouchableOpacity onPress={openPlanSetup}>
                <Text style={styles.planEdit}>New plan</Text>
              </TouchableOpacity>
            </View>

            {weekIsOver && (
              <TouchableOpacity style={styles.reviewCta} onPress={startReview}>
                <Text style={styles.reviewCtaTitle}>📋 Week in review</Text>
                <Text style={styles.reviewCtaText}>
                  You wrapped week {week.weekNumber}. Tap to see next week, tailored to how it went.
                </Text>
              </TouchableOpacity>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.dayPills}
              contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
            >
              {WEEKDAYS.map((wd) => {
                const d = week.days.find((x) => x.weekday === wd);
                const on = wd === selectedWd;
                const isToday = wd === weekdayKey();
                const done = d ? dayLogged(d) : false;
                return (
                  <TouchableOpacity
                    key={wd}
                    style={[styles.dayPill, on && styles.dayPillOn, isToday && !on && styles.dayPillToday]}
                    onPress={() => setSelectedWd(wd)}
                  >
                    <Text style={[styles.dayPillText, on && styles.dayPillTextOn]}>
                      {WEEKDAY_LABELS[wd]}
                    </Text>
                    <Text style={[styles.dayPillMark, on && styles.dayPillTextOn]}>
                      {done ? "✓" : d?.kind === "rest" ? "·" : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {selectedDay ? (
              <View style={styles.dayCard}>
                <Text style={styles.dayTitle}>{selectedDay.title}</Text>
                {[selectedDay.location, selectedDay.durationMin ? `${selectedDay.durationMin} min` : "", selectedDay.focus]
                  .filter(Boolean)
                  .join(" · ") ? (
                  <Text style={styles.daySub}>
                    {[selectedDay.location, selectedDay.durationMin ? `${selectedDay.durationMin} min` : "", selectedDay.focus]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}

                {selectedDay.kind === "rest" ? (
                  <Text style={styles.dayNote}>{selectedDay.note || "Rest and recover."}</Text>
                ) : selectedDay.kind === "strength" ? (
                  (selectedDay.sections ?? []).map((s, si) => (
                    <View key={si} style={styles.planSection}>
                      <Text style={styles.planSectionName}>
                        {s.name}
                        {s.durationMin ? ` · ${s.durationMin} min` : ""}
                      </Text>
                      {s.exercises.map((e) => (
                        <TouchableOpacity
                          key={e.id}
                          style={styles.exRow}
                          onPress={() => toggleExercise(e.id)}
                        >
                          <View style={[styles.checkbox, e.done && styles.checkboxOn]}>
                            {e.done ? <Text style={styles.checkmark}>✓</Text> : null}
                          </View>
                          <View style={styles.flex}>
                            <Text style={[styles.exName, e.done && styles.exDone]}>
                              {e.name}
                              {e.weight != null ? `  ·  ${e.weight} lb` : ""}
                            </Text>
                            {[
                              e.sets != null && e.reps ? `${e.sets} × ${e.reps}` : e.reps || "",
                              e.note || "",
                            ]
                              .filter(Boolean)
                              .join("   ") ? (
                              <Text style={styles.exMeta}>
                                {[
                                  e.sets != null && e.reps ? `${e.sets} × ${e.reps}` : e.reps || "",
                                  e.note || "",
                                ]
                                  .filter(Boolean)
                                  .join("   ")}
                              </Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))
                ) : (
                  <>
                    {selectedDay.note ? <Text style={styles.dayNote}>{selectedDay.note}</Text> : null}
                    <TouchableOpacity style={styles.exRow} onPress={toggleDayDone}>
                      <View style={[styles.checkbox, selectedDay.loggedEntryId && styles.checkboxOn]}>
                        {selectedDay.loggedEntryId ? <Text style={styles.checkmark}>✓</Text> : null}
                      </View>
                      <Text style={styles.exName}>
                        {selectedDay.loggedEntryId ? "Completed" : "Mark complete"}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
                {selectedWd === weekdayKey() && (
                  <TouchableOpacity style={styles.flexLink} onPress={onOpenCoach}>
                    <Text style={styles.flexLinkText}>
                      Not feeling it? Ask the Coach to adjust today →
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </>
        )}

            {lean ? (
              <View style={styles.leanCard}>
                <Text style={styles.leanPhase}>{phase.phase} phase</Text>
                <Text style={styles.leanText}>{lean}</Text>
              </View>
            ) : null}

            {week?.whyThisWeek ? (
              <View style={styles.whyCard}>
                <Text style={styles.whyLabel}>Why this week</Text>
                <Text style={styles.whyText}>{week.whyThisWeek}</Text>
              </View>
            ) : null}
          </>
        )}

        {activeTab === "log" && (
          <>
            {/* Cal AI–style week strip */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              ref={stripRef}
              onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}
              contentContainerStyle={styles.strip}
            >
              {logDays.map((d) => {
                const sel = d === logSelDate;
                const isToday = d === today;
                const has = workoutsFor(profile, d).length > 0;
                const dt = parseISO(d);
                return (
                  <TouchableOpacity key={d} style={styles.stripCell} onPress={() => setLogSelDate(d)}>
                    <Text style={[styles.stripDow, sel && styles.stripDowSel]}>
                      {dt.toLocaleDateString(undefined, { weekday: "narrow" })}
                    </Text>
                    <View
                      style={[
                        styles.stripCircle,
                        sel && styles.stripCircleSel,
                        isToday && !sel && styles.stripCircleToday,
                      ]}
                    >
                      <Text style={[styles.stripNum, sel && styles.stripNumSel]}>{dt.getDate()}</Text>
                    </View>
                    <View style={[styles.stripDot, has && styles.stripDotOn]} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.logHeader}>
              <Text style={styles.logDate}>{dayLabel(logSelDate)}</Text>
              <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
                <Text style={styles.addBtnText}>＋</Text>
              </TouchableOpacity>
            </View>

            {selEntries.length > 0 && (
              <View style={styles.scoreRow}>
                <View style={styles.scoreCard}>
                  <Text style={styles.scoreNum}>🔥 {dayBurned}</Text>
                  <Text style={styles.scoreLbl}>cal burned</Text>
                </View>
                <View style={styles.scoreCard}>
                  <Text style={styles.scoreNum}>{dayMinutes}</Text>
                  <Text style={styles.scoreLbl}>active min</Text>
                </View>
                <View style={styles.scoreCard}>
                  <Text style={styles.scoreNum}>{selEntries.length}</Text>
                  <Text style={styles.scoreLbl}>logged</Text>
                </View>
              </View>
            )}

            {selEntries.length === 0 ? (
              <Text style={styles.empty}>
                Nothing logged for this day. Tap ＋ to add a lift or class, check off your plan, or
                tell the Coach what you did.
              </Text>
            ) : (
              selEntries.map((e) => <EntryCard key={e.id} e={e} />)
            )}
          </>
        )}
      </ScrollView>

      {/* Add sheet */}
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Log a workout</Text>
              <TouchableOpacity onPress={() => setAddOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.tabs}>
                {(["strength", "activity"] as const).map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.tab, kind === k && styles.tabActive]}
                    onPress={() => setKind(k)}
                  >
                    <Text style={[styles.tabText, kind === k && styles.tabTextActive]}>
                      {k === "strength" ? "Strength" : "Activity"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {kind === "strength" ? (
                <>
                  {built.length > 0 && (
                    <View style={styles.builtBox}>
                      {built.map((x) => (
                        <View key={x.id} style={styles.builtRow}>
                          <Text style={styles.builtText}>{exerciseLabel(x)}</Text>
                          <TouchableOpacity onPress={() => setBuilt((b) => b.filter((e) => e.id !== x.id))} hitSlop={8}>
                            <Text style={styles.builtRemove}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  <Text style={styles.fieldLabel}>Exercise</Text>
                  <TextInput style={styles.input} value={exName} onChangeText={setExName} placeholder="e.g. Back squat" />
                  {exRecents.length > 0 && (
                    <View style={styles.chipWrap}>
                      {exRecents.slice(0, 8).map((n) => (
                        <TouchableOpacity key={n} style={styles.chip} onPress={() => setExName(n)}>
                          <Text style={styles.chipText}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <View style={styles.row3}>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Sets</Text>
                      <TextInput style={styles.input} value={exSets} onChangeText={setExSets} keyboardType="numeric" />
                    </View>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Reps</Text>
                      <TextInput style={styles.input} value={exReps} onChangeText={setExReps} keyboardType="numeric" />
                    </View>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Weight (lb)</Text>
                      <TextInput style={styles.input} value={exWeight} onChangeText={setExWeight} keyboardType="numeric" placeholder="—" />
                    </View>
                  </View>
                  <TouchableOpacity style={styles.addExBtn} onPress={addExercise}>
                    <Text style={styles.addExBtnText}>＋ Add exercise</Text>
                  </TouchableOpacity>

                  <Text style={styles.fieldLabel}>Duration (min)</Text>
                  <TextInput
                    style={styles.input}
                    value={sDur}
                    onChangeText={setSDur}
                    keyboardType="numeric"
                    placeholder="for calories burned"
                  />

                  <WatchFields estimate={estStrength} />

                  <Text style={styles.fieldLabel}>Note (optional)</Text>
                  <TextInput style={styles.input} value={sNote} onChangeText={setSNote} placeholder="How it felt, etc." />

                  <TouchableOpacity
                    style={[styles.saveBtn, !built.length && styles.saveBtnDisabled]}
                    onPress={saveStrength}
                    disabled={!built.length}
                  >
                    <Text style={styles.saveBtnText}>Save workout{built.length ? ` (${built.length})` : ""}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Activity</Text>
                  <TextInput style={styles.input} value={actName} onChangeText={setActName} placeholder="e.g. Pilates, Run, Boxing" />
                  <View style={styles.chipWrap}>
                    {[...new Set([...actRecents, ...ACTIVITY_OPTIONS])].slice(0, 12).map((a) => {
                      const on = actName === a;
                      return (
                        <TouchableOpacity key={a} style={[styles.chip, on && styles.chipActive]} onPress={() => setActName(a)}>
                          <Text style={[styles.chipText, on && styles.chipTextActive]}>{a}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.row2}>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Duration (min)</Text>
                      <TextInput style={styles.input} value={actDur} onChangeText={setActDur} keyboardType="numeric" placeholder="e.g. 45" />
                    </View>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Distance (optional)</Text>
                      <TextInput style={styles.input} value={actDist} onChangeText={setActDist} placeholder="e.g. 2 mi" />
                    </View>
                  </View>

                  <WatchFields estimate={estActivity} />

                  <Text style={styles.fieldLabel}>Note (optional)</Text>
                  <TextInput style={styles.input} value={actNote} onChangeText={setActNote} placeholder="How it felt, etc." />

                  <TouchableOpacity
                    style={[styles.saveBtn, !actName.trim() && styles.saveBtnDisabled]}
                    onPress={saveActivity}
                    disabled={!actName.trim()}
                  >
                    <Text style={styles.saveBtnText}>Save workout</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit sheet */}
      <Modal visible={!!editEntry} animationType="slide" transparent onRequestClose={() => setEditEntry(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Edit workout</Text>
              <TouchableOpacity onPress={() => setEditEntry(null)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {editEntry?.kind === "activity" ? (
                <>
                  <Text style={styles.fieldLabel}>Activity</Text>
                  <TextInput style={styles.input} value={eActName} onChangeText={setEActName} />
                  <View style={styles.row2}>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Duration (min)</Text>
                      <TextInput style={styles.input} value={eDur} onChangeText={setEDur} keyboardType="numeric" />
                    </View>
                    <View style={styles.cell}>
                      <Text style={styles.miniLabel}>Distance</Text>
                      <TextInput style={styles.input} value={eActDist} onChangeText={setEActDist} />
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.builtBox}>
                  {(editEntry?.exercises ?? []).map((x) => (
                    <Text key={x.id} style={styles.builtText}>
                      {exerciseLabel(x)}
                    </Text>
                  ))}
                  <Text style={styles.editHint}>To change sets, delete and re-log, or tell the Coach the new numbers.</Text>
                  <Text style={[styles.miniLabel, { marginTop: 12 }]}>Duration (min)</Text>
                  <TextInput style={styles.input} value={eDur} onChangeText={setEDur} keyboardType="numeric" />
                </View>
              )}

              <Text style={styles.fieldLabel}>Manual (optional)</Text>
              <View style={styles.row3}>
                <View style={styles.cell}>
                  <Text style={styles.miniLabel}>Calories</Text>
                  <TextInput style={styles.input} value={eBurn} onChangeText={setEBurn} keyboardType="numeric" placeholder="—" />
                </View>
                <View style={styles.cell}>
                  <Text style={styles.miniLabel}>Avg HR</Text>
                  <TextInput style={styles.input} value={eAvg} onChangeText={setEAvg} keyboardType="numeric" placeholder="—" />
                </View>
                <View style={styles.cell}>
                  <Text style={styles.miniLabel}>Max HR</Text>
                  <TextInput style={styles.input} value={eMax} onChangeText={setEMax} keyboardType="numeric" placeholder="—" />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Note</Text>
              <TextInput style={styles.input} value={eNote} onChangeText={setENote} placeholder="—" />

              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() =>
                  Alert.alert("Delete workout?", "This removes it from your log.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: deleteEntry },
                  ])
                }
              >
                <Text style={styles.deleteBtnText}>Delete workout</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Plan setup */}
      <Modal visible={setupOpen} animationType="slide" transparent onRequestClose={() => setSetupOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Build your plan</Text>
              <TouchableOpacity onPress={() => setSetupOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Workout days</Text>
              <View style={styles.chipWrap}>
                {WEEKDAYS.map((wd) => {
                  const on = spWorkoutDays.includes(wd);
                  return (
                    <TouchableOpacity
                      key={wd}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => toggleWorkoutDay(wd)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>
                        {WEEKDAY_LABELS[wd]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.miniLabel}>The days you don't pick become rest days.</Text>

              <Text style={styles.fieldLabel}>Time per session</Text>
              {/* Cross-platform Stepper. Range 15–120 min, step 5. Hold −/+ to
                  repeat. Replaces the iOS countdown DateTimePicker + Android
                  numeric TextInput pair — the picker was the crash surface on
                  the onboarding → workout auto-open transition. Pre-populated
                  from the saved plan setup if any (see openPlanSetup); otherwise
                  defaults to 45 min. */}
              <Stepper
                value={spSessionMinutes}
                min={SESSION_MIN_MINUTES}
                max={SESSION_MAX_MINUTES}
                step={SESSION_STEP_MINUTES}
                display={durationLabel(spSessionMinutes)}
                onChange={setSpSessionMinutes}
              />
              <Text style={styles.miniLabel}>{durationLabel(spSessionMinutes)} per workout.</Text>

              <Text style={styles.fieldLabel}>Where you train</Text>
              <View style={styles.chipWrap}>
                {ACCESS_OPTIONS.map((o) => {
                  const on = spAccess.includes(o.key);
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => toggleAccess(o.key)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Equipment (optional)</Text>
              <TextInput
                style={styles.input}
                value={spEquip}
                onChangeText={setSpEquip}
                placeholder="e.g. dumbbells, bands, full gym"
              />

              <Text style={styles.fieldLabel}>Classes you do (optional)</Text>
              <TextInput
                style={styles.input}
                value={spClasses}
                onChangeText={setSpClasses}
                placeholder="e.g. F45 Tue/Thu, Lagree Sat"
              />

              <Text style={styles.fieldLabel}>Experience</Text>
              <View style={styles.chipWrap}>
                {EXPERIENCE_OPTIONS.map((o) => {
                  const on = spExp === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => setSpExp(o.key)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Injuries or limitations (optional)</Text>
              <TextInput
                style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
                value={spInjury}
                onChangeText={setSpInjury}
                placeholder="e.g. bad left knee, avoid jumping"
                multiline
              />

              {genError ? <Text style={styles.genError}>{genError}</Text> : null}

              <TouchableOpacity
                style={[styles.saveBtn, generating && styles.saveBtnDisabled]}
                onPress={generatePlan}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Generate my plan</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.genHint}>
                Your coach builds this from your goal, cycle phase, and the answers above. Regenerate
                anytime.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Week in review → next week (Stage B) */}
      <Modal visible={reviewOpen} animationType="slide" transparent onRequestClose={() => setReviewOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Next week</Text>
              <TouchableOpacity onPress={() => setReviewOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {reviewing ? (
                <View style={styles.planLoading}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={styles.planLoadingText}>Reviewing your week…</Text>
                </View>
              ) : reviewErr ? (
                <Text style={styles.genError}>{reviewErr}</Text>
              ) : reviewWeek ? (
                <>
                  <Text style={styles.planProgram}>{reviewWeek.programName}</Text>
                  <Text style={styles.planWeek}>Week {reviewWeek.weekNumber}</Text>
                  {reviewWeek.whyThisWeek ? (
                    <View style={styles.whyCard}>
                      <Text style={styles.whyLabel}>Why this week</Text>
                      <Text style={styles.whyText}>{reviewWeek.whyThisWeek}</Text>
                    </View>
                  ) : null}
                  {reviewWeek.days.map((d) => (
                    <View key={d.weekday} style={styles.reviewDay}>
                      <Text style={styles.reviewDayName}>{WEEKDAY_LABELS[d.weekday]}</Text>
                      <Text style={styles.reviewDayTitle}>
                        {d.title}
                        {d.kind !== "rest" && d.durationMin ? ` · ${d.durationMin} min` : ""}
                      </Text>
                    </View>
                  ))}

                  <Text style={styles.fieldLabel}>Want changes?</Text>
                  <TextInput
                    style={styles.input}
                    value={tweakText}
                    onChangeText={setTweakText}
                    placeholder="e.g. more upper body, traveling Thursday"
                  />
                  <TouchableOpacity style={styles.addExBtn} onPress={() => buildNextWeek(tweakText)}>
                    <Text style={styles.addExBtnText}>Regenerate with changes</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.saveBtn} onPress={acceptReview}>
                    <Text style={styles.saveBtnText}>Start this week</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 60 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 24, fontWeight: "700" },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontSize: 22, fontWeight: "700", lineHeight: 24 },

  leanCard: { backgroundColor: "#f7f6fb", borderRadius: 16, padding: 16, marginBottom: 18 },
  leanPhase: { fontSize: 13, fontWeight: "700", color: ACCENT, textTransform: "capitalize", marginBottom: 4 },
  leanText: { fontSize: 14, color: "#555", lineHeight: 20 },

  sectionLabel: { fontSize: 13, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 8 },
  empty: { color: "#666", fontSize: 15, lineHeight: 22 },
  recentDay: { fontSize: 12, color: "#999", fontWeight: "600", marginTop: 10, marginBottom: 4 },

  card: { backgroundColor: "#faf9fc", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#eee" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  cardSub: { fontSize: 14, color: "#666", marginTop: 3 },
  cardExercise: { fontSize: 14, color: "#444", marginTop: 4 },
  cardBurn: { fontSize: 13, color: BURN, marginTop: 6, fontWeight: "600" },
  cardNote: { fontSize: 13, color: "#888", marginTop: 6, fontStyle: "italic" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "92%", paddingTop: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 },
  sheetTitle: { fontSize: 19, fontWeight: "700", color: "#1a1a1a" },
  close: { fontSize: 18, color: "#999", fontWeight: "600" },
  sheetScroll: { paddingHorizontal: 20, paddingBottom: 32 },

  tabs: { flexDirection: "row", backgroundColor: "#f0eef7", borderRadius: 12, padding: 4, marginTop: 14 },
  tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 9 },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 14, color: "#777", fontWeight: "600" },
  tabTextActive: { color: ACCENT },

  builtBox: { backgroundColor: "#f7f6fb", borderRadius: 12, padding: 12, marginTop: 16 },
  builtRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  builtText: { fontSize: 14, color: "#333", flex: 1, paddingRight: 8, lineHeight: 20 },
  builtRemove: { fontSize: 15, color: "#bbb", fontWeight: "700" },

  fieldLabel: { fontSize: 14, fontWeight: "700", color: "#444", marginTop: 18, marginBottom: 6 },
  miniLabel: { fontSize: 13, color: "#666", fontWeight: "600", marginTop: 6, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  estHint: { fontSize: 13, color: BURN, marginBottom: 6 },
  row2: { flexDirection: "row", gap: 10 },
  row3: { flexDirection: "row", gap: 10 },
  cell: { flex: 1 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },

  addExBtn: { borderWidth: 1.5, borderColor: ACCENT, borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 14 },
  addExBtnText: { color: ACCENT, fontWeight: "700", fontSize: 15 },

  editHint: { fontSize: 12, color: "#999", marginTop: 8, lineHeight: 17 },

  saveBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 24 },
  saveBtnDisabled: { backgroundColor: "#c9c2e0" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  deleteBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  deleteBtnText: { color: "#e2556b", fontSize: 15, fontWeight: "600" },

  // Plan
  planLoading: { alignItems: "center", gap: 10, paddingVertical: 28 },
  planLoadingText: { color: "#666", fontSize: 14 },
  planCta: { backgroundColor: "#f0eef7", borderRadius: 16, padding: 18, marginBottom: 8 },
  planCtaTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  planCtaText: { fontSize: 14, color: "#555", lineHeight: 20, marginTop: 6 },
  planCtaBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 14 },
  planCtaBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  planHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10 },
  planProgram: { fontSize: 18, fontWeight: "700", color: "#1a1a1a" },
  planWeek: { fontSize: 13, color: "#888", marginTop: 2, fontWeight: "600" },
  planEdit: { fontSize: 14, color: ACCENT, fontWeight: "700" },

  reviewCta: { backgroundColor: ACCENT, borderRadius: 14, padding: 16, marginBottom: 14 },
  reviewCtaTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  reviewCtaText: { color: "#ece8f8", fontSize: 13, marginTop: 4, lineHeight: 18 },
  reviewDay: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  reviewDayName: { width: 44, fontSize: 13, fontWeight: "700", color: "#999" },
  reviewDayTitle: { flex: 1, fontSize: 15, color: "#1a1a1a" },

  whyCard: { backgroundColor: "#f7f6fb", borderRadius: 14, padding: 14, marginBottom: 14 },
  whyLabel: { fontSize: 12, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  whyText: { fontSize: 14, color: "#444", lineHeight: 20 },

  dayPills: { marginBottom: 14 },
  dayPill: {
    minWidth: 46,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e2e2",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  dayPillOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  dayPillToday: { borderColor: ACCENT },
  dayPillText: { fontSize: 13, fontWeight: "700", color: "#555" },
  dayPillTextOn: { color: "#fff" },
  dayPillMark: { fontSize: 11, color: ACCENT, fontWeight: "700", height: 14 },

  dayCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#eee", marginBottom: 8 },
  dayTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  daySub: { fontSize: 13, color: "#888", marginTop: 3 },
  dayNote: { fontSize: 14, color: "#555", lineHeight: 20, marginTop: 10 },
  flexLink: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  flexLinkText: { color: ACCENT, fontSize: 14, fontWeight: "600" },

  planSection: { marginTop: 16 },
  planSectionName: { fontSize: 12, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  exRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#cbd0d6",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  checkmark: { color: "#fff", fontSize: 14, fontWeight: "800", lineHeight: 16 },
  exName: { fontSize: 15, color: "#1a1a1a", fontWeight: "600" },
  exDone: { textDecorationLine: "line-through", color: "#aaa" },
  exMeta: { fontSize: 13, color: "#888", marginTop: 2, lineHeight: 18 },

  genError: { color: "#e2556b", fontSize: 14, marginTop: 14, lineHeight: 19 },
  genHint: { fontSize: 12, color: "#999", marginTop: 12, lineHeight: 17, textAlign: "center" },

  // Sub-tabs (Plan | Log)
  subtabs: { flexDirection: "row", backgroundColor: "#f0eef7", borderRadius: 12, padding: 4, marginBottom: 18 },
  subtab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 9 },
  subtabActive: { backgroundColor: "#fff" },
  subtabText: { fontSize: 15, color: "#777", fontWeight: "700" },
  subtabTextActive: { color: ACCENT },

  // Cal AI–style day strip
  strip: { gap: 6, paddingVertical: 4, paddingRight: 8 },
  stripCell: { alignItems: "center", width: 44 },
  stripDow: { fontSize: 12, color: "#999", fontWeight: "600", marginBottom: 6 },
  stripDowSel: { color: ACCENT },
  stripCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f4f6",
  },
  stripCircleSel: { backgroundColor: ACCENT },
  stripCircleToday: { borderWidth: 2, borderColor: ACCENT, backgroundColor: "#fff" },
  stripNum: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  stripNumSel: { color: "#fff" },
  stripDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5, backgroundColor: "transparent" },
  stripDotOn: { backgroundColor: ACCENT },

  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 10,
  },
  logDate: { fontSize: 18, fontWeight: "700", color: "#1a1a1a" },

  scoreRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  scoreCard: { flex: 1, backgroundColor: "#f7f6fb", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  scoreNum: { fontSize: 18, fontWeight: "800", color: "#1a1a1a" },
  scoreLbl: { fontSize: 12, color: "#888", marginTop: 3, fontWeight: "600" },
});
