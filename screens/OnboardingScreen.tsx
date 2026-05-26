import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import {
  Profile,
  Goal,
  GOAL_LABELS,
  Tone,
  TONE_LABELS,
  ActivityLevel,
  ACTIVITY_LABELS,
} from "../lib/types";
import { toISODate } from "../lib/cycle";
import { addMemory } from "../lib/memory";
import { toJpegBase64 } from "../lib/image";
import { calibrateFromPhotos, hasApiKey, CalibrationResult } from "../lib/coach";

// Reuse the exact same option ordering Settings uses, so the two screens never
// drift. These are the only fields onboarding collects; everything else on the
// Profile (the data maps, calorieMode, goalWeight, plan, memory) is seeded to its
// existing empty default — Settings remains the place to fill those in later.
const GOALS: Goal[] = ["lose_fat", "tone_up", "build_muscle", "feel_better", "maintain"];
const TONES: Tone[] = ["hype", "bestie", "tough_love"];
const ACTIVITIES: ActivityLevel[] = ["sedentary", "light", "active", "very_active"];

// Quick dietary chips. Each maps to a short, durable memory fact phrased the way
// the Coach saves them (see lib/coach.ts memory guidance: "no dairy", "vegetarian").
// "None" is a clearing choice, not a fact — selecting it deselects the others.
const DIET_CHIPS: { key: string; label: string; fact: string }[] = [
  { key: "vegetarian", label: "Vegetarian", fact: "vegetarian" },
  { key: "vegan", label: "Vegan", fact: "vegan" },
  { key: "pescatarian", label: "Pescatarian", fact: "pescatarian" },
  { key: "dairy_free", label: "Dairy-free", fact: "no dairy" },
  { key: "gluten_free", label: "Gluten-free", fact: "no gluten" },
  { key: "nut_free", label: "Nut-free", fact: "no nuts" },
];

// Parse a "YYYY-MM-DD" string to a Date; fall back to today if empty/invalid.
// Mirrors SettingsScreen.parseDateOrToday.
function parseDateOrToday(s: string): Date {
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? new Date() : d;
}

// Whole years between a birth date and today. Birthday-aware (not just a year
// subtraction), so someone whose birthday hasn't happened yet this year reads as
// one year younger. Result is clamped non-negative; callers guard the range.
function ageFromBirthDate(birth: Date, now: Date): number {
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

// Default birth date for the picker: ~30 years ago. We DON'T pre-fill the age
// field from this — age stays blank until she actually confirms a date — so a
// skipped Body step never stores a value she didn't pick. We normalize to
// midnight (start-of-day) so any picker-internal rounding still matches the
// captured initial ref when we compare at day granularity.
function defaultBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Day-granular date equality. The DOB gate uses this so the iOS spinner's
// mount-time onChange (which can fire with a sub-second-rounded date) is not
// treated as user intent. The only true signal that she picked a different
// birth date is the calendar day changing — millisecond differences from
// picker rounding must not silently commit the default ~30-yrs-ago age.
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
// Oldest allowed birth date: 100 years ago, to keep ages sane. Newest is today.
function minBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 100);
  return d;
}

// --- Stepper (core RN only, no native dep) ---------------------------------
// A -/+ row with a centered value. Replaces the old scroll-wheels, which froze
// the Body step (the weight wheel rendered ~270 non-virtualized rows nested in
// the page) and fought the page's vertical scroll. No nested scroll views, so
// the freeze and gesture conflict are gone.
//
// Tap = step once; press-and-hold = repeat. onPressIn does one immediate step,
// then starts a setInterval that keeps stepping while held; onPressOut/onBlur
// (and unmount, via the effect) clear the interval so no timer leaks. Buttons
// disable + stop at min/max, and every step is clamped to [min, max] as a belt-
// and-braces guard. onChange fires only from a real press, so the parent's
// "touched" flag is never tripped by mount/layout — a skipped step stays blank.
const HOLD_REPEAT_MS = 100;

function StepButton({
  label,
  disabled,
  onStep,
}: {
  label: string;
  disabled: boolean;
  onStep: () => void;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function clear() {
    if (timer.current != null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  function start() {
    if (disabled) return;
    onStep(); // immediate first step on press
    clear(); // never stack intervals
    timer.current = setInterval(onStep, HOLD_REPEAT_MS);
  }

  // Clear any running interval if the button unmounts mid-hold (e.g. the user
  // navigates away while holding) so we never leak a timer.
  useEffect(() => clear, []);

  return (
    <TouchableOpacity
      style={[styles.stepBtn, disabled && styles.stepBtnDisabled]}
      onPressIn={start}
      onPressOut={clear}
      // onBlur isn't a TouchableOpacity event; clear() in the effect cleanup and
      // onPressOut cover the leak cases. Keeping accessibility props explicit.
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === "−" ? "Decrease" : "Increase"}
    >
      <Text style={[styles.stepBtnText, disabled && styles.stepBtnTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stepper({
  value,
  min,
  max,
  display,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  display: string;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <View style={styles.stepperRow}>
      <StepButton label="−" disabled={value <= min} onStep={() => onChange(clamp(value - 1))} />
      <View style={styles.stepperValueBox}>
        <Text style={styles.stepperValue}>{display}</Text>
      </View>
      <StepButton label="+" disabled={value >= max} onStep={() => onChange(clamp(value + 1))} />
    </View>
  );
}

// Stepper bounds. Height is in TOTAL INCHES (54 = 4'6", 84 = 7'0"); weight in lb.
const HEIGHT_MIN_IN = 54;
const HEIGHT_MAX_IN = 84;
const HEIGHT_DEFAULT_IN = 66; // 5'6"
const WEIGHT_MIN_LB = 80;
const WEIGHT_MAX_LB = 350;
const WEIGHT_DEFAULT_LB = 150;

// Format total inches as the ft'in" string parseHeightCm accepts (e.g. 5'6").
function formatHeight(totalIn: number): string {
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return `${ft}'${inch}"`;
}

// The lean step list. Body stats, cycle, diet, and photos are all skippable —
// the app and Coach already tolerate missing fields, and the Coach can ask for
// stats later. "photos" is an optional, ED-safety-bounded calibration step that
// only seeds qualitative Coach memory facts; it never changes macros (see the
// photos step body and lib/coach.ts calibrateFromPhotos for the safety contract).
// "start" is the final fork: create a plan vs. chat with the Coach.
const STEPS = ["welcome", "basics", "body", "photos", "cycle", "diet", "tone", "start"] as const;
type Step = (typeof STEPS)[number];

// Where she chose to begin after onboarding (drives App's tab + plan-setup auto-open).
type StartDest = "coach" | "workout";

export default function OnboardingScreen({
  // Builds the very first Profile from scratch and persists it (App.initProfile),
  // exactly like the old Settings-as-onboarding path did — same shape, no widening.
  initProfile,
  // Navigation-only side effect after completion. The destination she picked on
  // the final step decides whether App lands on the Coach tab (default) or the
  // Workout tab with plan-setup auto-opened.
  onDone,
}: {
  initProfile: (p: Profile) => Promise<void>;
  onDone: (dest: StartDest) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step: Step = STEPS[stepIndex];

  // Field state — defaults match Settings' first-run defaults so a fully-skipped
  // onboarding produces the same Profile the old form would have on first save.
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<Goal>("feel_better");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("light");
  const [onBirthControl, setOnBirthControl] = useState(false);
  const [lastPeriodStart, setLastPeriodStart] = useState("");
  const [avgCycleLength, setAvgCycleLength] = useState("28");
  const [showPicker, setShowPicker] = useState(false);
  const [dietChips, setDietChips] = useState<string[]>([]);
  const [dietNotes, setDietNotes] = useState("");
  const [tone, setTone] = useState<Tone>("bestie");
  const [startDest, setStartDest] = useState<StartDest>("coach");
  const [saving, setSaving] = useState(false);

  // Birth-date picker state. We keep the picked Date in local state for the
  // calendar to display, but only write the COMPUTED whole-year age into the
  // existing string `age` field (the BMR math parses that). `age` stays "" until
  // she actually SPINS to a different date, so a skipped Body step (or a step
  // where she only tapped to open the picker without spinning) never stores a
  // default she didn't choose. `birthDate` is local-only — not persisted, not
  // added to the Profile.
  //
  // `birthDateChanged` is the "did she actually spin to a different date?" flag.
  // It flips true ONLY when an onChange fires with a date that differs from the
  // initial default — opening the picker alone does NOT trip it. The belt-and-
  // suspenders fallbacks in next()/finish() and the iOS "Done" button only fire
  // when this is true, so a user who taps the DOB row but never spins stays at
  // age="" and BMR stays null (Coach asks for stats later, no silent default).
  // The initial-default Date is captured once via useRef so the comparison is
  // stable across re-renders.
  const initialBirthDateRef = useRef<Date>(defaultBirthDate());
  const [birthDate, setBirthDate] = useState<Date>(initialBirthDateRef.current);
  const [showBirthPicker, setShowBirthPicker] = useState(false);
  const [birthDateChanged, setBirthDateChanged] = useState(false);

  // Body steppers: live numeric values. Defaults show a friendly starting point
  // (5'6", 150 lb), but they only get written into height/weight once she
  // actually presses a stepper — tracked by the *Touched flags. A skipped Body
  // step (or an untouched stepper) leaves height/weight blank, so computeBMR
  // returns null and the Coach asks later — never a silent default into BMR.
  const [heightIn, setHeightIn] = useState(HEIGHT_DEFAULT_IN);
  const [heightTouched, setHeightTouched] = useState(false);
  const [weightLb, setWeightLb] = useState(WEIGHT_DEFAULT_LB);
  const [weightTouched, setWeightTouched] = useState(false);

  // Photo "calibration" step — strictly optional, use-then-discard.
  // We hold the local URI (for the in-step thumbnail) and the base64 (for the
  // single vision call). Both are CLEARED after the call so nothing about the
  // photos is persisted to disk or the Profile — only the Coach's three short
  // qualitative notes are seeded as durable memory facts. See lib/coach.ts
  // calibrateFromPhotos for the safety contract (no numbers, no goal-weight,
  // never overrides profile.goal, macros stay computed from stats + BMR floor).
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [currentBase64, setCurrentBase64] = useState<string | null>(null);
  const [goalUri, setGoalUri] = useState<string | null>(null);
  const [goalBase64, setGoalBase64] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  // Tracks the three facts seeded (if any) so we can show a brief confirm and so
  // re-running calibration replaces rather than stacks. Local-only; not persisted.
  const [calibratedFacts, setCalibratedFacts] = useState<string[]>([]);
  // The structured calibration result, rendered in the confirmation card so the
  // user can SEE that her photos produced something before we advance. Cleared
  // back to null on retake/skip. Local-only; the three qualitative strings are
  // seeded as durable memory via calibratedFacts at finish() time.
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
  // Confirmation overlay flag: when true the photo step swaps to a small card
  // showing the three qualitative strings, with auto-advance after a short
  // delay or a manual Continue tap. Auto-advance timer is held in a ref so we
  // can clear it on unmount or manual continue (no leak, no double-advance).
  const [showCalibrationConfirm, setShowCalibrationConfirm] = useState(false);
  const calibrationAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openPicker() {
    if (!lastPeriodStart) setLastPeriodStart(toISODate(new Date()));
    setShowPicker((s) => !s);
  }

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "set" && date) setLastPeriodStart(toISODate(date));
  }

  // Birth-date picker handlers. On Android the picker is a one-shot dialog (it
  // dismisses itself) so we confirm on "set" (Android's "set" event already
  // implies real user interaction with a chosen date). On iOS the spinner stays
  // open and ticks onChange continuously — we treat each tick as a commit, but
  // ONLY if the date actually differs from the initial default (so just opening
  // the picker, looking at it, and closing it without spinning never commits).
  function applyBirthDate(d: Date) {
    setBirthDate(d);
    setBirthDateChanged(true);
    setAge(String(ageFromBirthDate(d, new Date())));
  }
  function onChangeBirthDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") {
      setShowBirthPicker(false);
      // Android: "set" only fires after she taps OK on a real date she picked,
      // so commit if the date differs from the initial default at DAY granularity;
      // if she somehow tapped OK without scrolling (same calendar day as default),
      // we intentionally do NOT commit (preserve no-silent-default).
      if (event.type === "set" && date && !sameDay(date, initialBirthDateRef.current)) {
        applyBirthDate(date);
      }
      return;
    }
    // iOS inline spinner: every onChange tick fires, including the immediate
    // tick on mount (which can come back with a sub-second-rounded date — that's
    // why we compare at DAY granularity, not millisecond). Commit ONLY when the
    // calendar day differs from the initial default — that means she actually
    // spun to a new value. Opening the picker and closing it without spinning
    // leaves age="" and BMR null (Coach asks later).
    if (date && !sameDay(date, initialBirthDateRef.current)) {
      applyBirthDate(date);
    }
  }

  // Toggle the picker UI. Tapping the DOB row alone does NOT set any commit
  // flag — only an actual spin to a different date does (see onChangeBirthDate
  // and applyBirthDate). This preserves the "no silent default into BMR" line
  // for a user who taps to open the picker but never spins.
  function toggleBirthPicker() {
    setShowBirthPicker((s) => !s);
  }

  function toggleDietChip(key: string) {
    setDietChips((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Stepper change handlers fold the new value into the height/weight strings in
  // the SAME formats the existing parsers consume (parseHeightCm: 5'6";
  // parseWeightKg: 150 lb). Setting *Touched on first press is what lets a
  // skipped/untouched step stay blank (no silent BMR default).
  function onHeightChange(next: number) {
    setHeightIn(next);
    setHeightTouched(true);
    setHeight(formatHeight(next));
  }
  function onWeightChange(next: number) {
    setWeightLb(next);
    setWeightTouched(true);
    setWeight(`${next} lb`);
  }

  // --- Photo step helpers ----------------------------------------------------
  // Same image pipeline as the Coach + Food photo flows: ImagePicker for the
  // picker, toJpegBase64 for the resized JPEG the vision API needs. We never
  // persist either uri or base64 — they live in component state only.
  async function pickPhoto(slot: "current" | "goal", source: "camera" | "library") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Allow camera access to add a photo.");
          return;
        }
      }
      const opts = { mediaTypes: "images" as const };
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      let base64: string;
      try {
        base64 = await toJpegBase64(asset.uri);
      } catch {
        Alert.alert("Couldn't read that photo", "Try another one.");
        return;
      }
      if (slot === "current") {
        setCurrentUri(asset.uri);
        setCurrentBase64(base64);
      } else {
        setGoalUri(asset.uri);
        setGoalBase64(base64);
      }
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  function offerPickPhoto(slot: "current" | "goal") {
    Alert.alert(
      slot === "current" ? "Add a photo of you now" : "Add a photo of where you want to go",
      "Optional — you can always skip.",
      [
        { text: "Take photo", onPress: () => void pickPhoto(slot, "camera") },
        { text: "Choose from library", onPress: () => void pickPhoto(slot, "library") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  function removePhoto(slot: "current" | "goal") {
    if (slot === "current") {
      setCurrentUri(null);
      setCurrentBase64(null);
    } else {
      setGoalUri(null);
      setGoalBase64(null);
    }
  }

  // Run the calibration. ALWAYS resolves — never throws to the caller — because
  // onboarding must always complete. Drops the base64 either way (use-then-
  // discard). On success returns BOTH the structured result (for the
  // confirmation card UI) and the three short facts to be seeded into Coach
  // memory at finish(). On failure (network/API/parse/no key/no photos),
  // returns { result: null, facts: [] } so we soft-skip silently.
  async function runCalibration(): Promise<{ result: CalibrationResult | null; facts: string[] }> {
    const cur = currentBase64;
    const dst = goalBase64;
    // Always drop the base64 from state after the call — use-then-discard.
    // We do this BEFORE the await so even a navigation interrupt can't leak it.
    setCurrentBase64(null);
    setGoalBase64(null);
    if (!cur && !dst) return { result: null, facts: [] };
    if (!hasApiKey()) return { result: null, facts: [] };
    try {
      const result = await calibrateFromPhotos(cur ?? undefined, dst ?? undefined);
      const facts: string[] = [];
      if (result.goal_direction) facts.push(`goal direction: ${result.goal_direction}`);
      if (result.training_emphasis) facts.push(`training emphasis: ${result.training_emphasis}`);
      if (result.motivation) facts.push(`motivation: ${result.motivation}`);
      return { result, facts };
    } catch {
      // Soft-skip: no facts seeded, no scary error to her face.
      return { result: null, facts: [] };
    }
  }

  const isLast = stepIndex === STEPS.length - 1;

  // Auto-advance delay for the photo-calibration confirmation card. Long enough
  // that she can actually READ the three qualitative strings; short enough that
  // it doesn't feel stuck. A manual "Continue" tap on the card advances
  // immediately and cancels the timer.
  const CALIBRATION_CONFIRM_AUTOADVANCE_MS = 2200;

  // Clear the auto-advance timer on unmount so we never call setState after the
  // screen is gone (and never leak the handle).
  useEffect(() => {
    return () => {
      if (calibrationAdvanceTimer.current != null) {
        clearTimeout(calibrationAdvanceTimer.current);
        calibrationAdvanceTimer.current = null;
      }
    };
  }, []);

  // Cancel any pending auto-advance and move to the next step. Idempotent —
  // safe whether the timer is pending, already fired, or never started.
  function commitCalibrationAndAdvance() {
    if (calibrationAdvanceTimer.current != null) {
      clearTimeout(calibrationAdvanceTimer.current);
      calibrationAdvanceTimer.current = null;
    }
    setShowCalibrationConfirm(false);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  // Photo step advance: if she added at least one photo we run the vision call
  // (with a small loading state). On a non-empty result we briefly SHOW her the
  // captured direction in a confirmation card (so she sees the photos
  // actually produced something) and auto-advance after a short delay; she can
  // also tap "Continue" to advance immediately. On empty result or skip, we
  // silently advance as before. Either way the base64 is dropped before we
  // move on (handled inside runCalibration).
  async function advanceFromPhotos() {
    if (calibrating) return;
    setCalibrating(true);
    try {
      const { result, facts } = await runCalibration();
      setCalibratedFacts(facts);
      setCalibrationResult(result);
      if (result && facts.length > 0) {
        // Show the confirmation card; arm the auto-advance.
        setShowCalibrationConfirm(true);
        calibrationAdvanceTimer.current = setTimeout(() => {
          calibrationAdvanceTimer.current = null;
          setShowCalibrationConfirm(false);
          setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
        }, CALIBRATION_CONFIRM_AUTOADVANCE_MS);
      } else {
        // Soft-skip path: no card, just keep moving.
        setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      }
    } finally {
      setCalibrating(false);
    }
  }

  function next() {
    if (isLast) {
      void finish();
      return;
    }
    // Belt-and-suspenders: when leaving the Body step, if she actually SPUN the
    // birth picker to a different date (birthDateChanged === true) but `age` is
    // still blank for any reason, commit the current `birthDate` now. The
    // changed-flag guard preserves "no silent default": a user who opened the
    // picker but never spun stays at age="" and BMR stays null.
    if (step === "body" && birthDateChanged && !age) {
      applyBirthDate(birthDate);
    }
    if (step === "photos") {
      void advanceFromPhotos();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // Build the complete first Profile from the answers and persist it. We start
  // from the SAME empty base Settings would (every data map empty), then overlay
  // the collected fields. NO new fields — this is the documented Profile shape.
  // Dietary chips + notes are also folded into dietaryRules (free text the Coach
  // reads in context) AND seeded into coachMemory below as durable facts.
  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      // Final safety net for age. Only fires if she actually SPUN the picker
      // to a different date (birthDateChanged) but the `age` string is still
      // blank for any reason — compute it from the displayed birthDate now. We
      // can't rely on a setState here (finish() runs in the same tick) so we
      // compute locally and use it when building the Profile below. Setting
      // state too keeps the visible label honest if finish() bails mid-save.
      // Preserves no-silent-default: a user who never spun stays at age="".
      let ageForProfile = age.trim();
      if (birthDateChanged && !ageForProfile) {
        ageForProfile = String(ageFromBirthDate(birthDate, new Date()));
        setAge(ageForProfile);
      }

      const chipFacts = dietChips
        .map((k) => DIET_CHIPS.find((c) => c.key === k)?.fact)
        .filter((f): f is string => !!f);
      // dietaryRules mirrors what Settings collects as free text: the chosen chips
      // (human labels) plus any free-text notes, comma-joined. Skipping leaves "".
      const chipLabels = dietChips
        .map((k) => DIET_CHIPS.find((c) => c.key === k)?.label)
        .filter((l): l is string => !!l);
      const rulesParts = [...chipLabels, dietNotes.trim()].filter(Boolean);

      let profile: Profile = {
        name: name.trim(),
        goal,
        tone,
        dietaryRules: rulesParts.join(", "),
        onBirthControl,
        // Honor the BC branch exactly: on birth control we ignore the cycle inputs
        // (the phase math also ignores them when onBirthControl is true).
        lastPeriodStart: onBirthControl ? "" : lastPeriodStart.trim(),
        avgCycleLength: onBirthControl ? 28 : Number(avgCycleLength) || 28,
        dayLogs: {},
        foodLogs: {},
        waterLogs: {},
        workoutLogs: {},
        savedFoods: [],
        savedMeals: [],
        weightLog: [],
        age: ageForProfile,
        height: height.trim(),
        weight: weight.trim(),
        goalWeight: "",
        activityLevel,
        calorieMode: "static", // safe default; she can switch to net in Settings
        coachMemory: [],
      };

      // Seed durable Coach memory so the Coach knows her restrictions from message
      // one. addMemory dedupes (case-insensitive, trimmed) and caps, so we can fold
      // chip facts AND any free-text notes without piling up duplicates. Free-text
      // notes are seeded verbatim — short user-written facts like "no shellfish".
      // The photo-step calibrated facts (qualitative goal_direction /
      // training_emphasis / motivation strings, NEVER numbers — enforced by
      // CALIBRATION_SYSTEM + the tool schema in lib/coach.ts) ride this same path.
      const facts = [...chipFacts];
      const note = dietNotes.trim();
      if (note) facts.push(note);
      for (const f of calibratedFacts) facts.push(f);
      for (const f of facts) profile = addMemory(profile, f);

      await initProfile(profile);
      onDone(startDest);
    } catch {
      // A persist failure must not strand her on onboarding. initProfile already
      // updated the in-memory profile synchronously before its await, so move on.
      onDone(startDest);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Progress dots — simple, no dependency. */}
        <View style={styles.dots}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.dot, i <= stepIndex && styles.dotActive]} />
          ))}
        </View>

        {step === "welcome" && (
          <View>
            <Text style={styles.title}>Welcome to Flux</Text>
            <Text style={styles.body}>
              Flux is your supportive, cycle-aware coach. It works with your body and how you
              actually feel, not against it.
            </Text>
            <Text style={styles.body}>
              No calorie policing, no guilt, no chasing a number. Just a knowledgeable friend in
              your corner who helps you eat enough, move in a way that fits your cycle, and feel
              good doing it.
            </Text>
            <Text style={styles.body}>
              A few quick questions so your Coach can get to know you. Skip anything you're not sure
              about — you can always tell your Coach later, and change it in Settings anytime.
            </Text>
            <Text style={styles.bodyMuted}>Everything you enter stays on your device.</Text>
          </View>
        )}

        {step === "basics" && (
          <View>
            <Text style={styles.title}>The basics</Text>
            <Text style={styles.subtitle}>What should your Coach call you, and what are you here for?</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
            />

            <Text style={styles.label}>Your goal</Text>
            <View style={styles.chipWrap}>
              {GOALS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.chip, goal === g && styles.chipActive]}
                  onPress={() => setGoal(g)}
                >
                  <Text style={[styles.chipText, goal === g && styles.chipTextActive]}>
                    {GOAL_LABELS[g]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>
              However you frame it is fine — your Coach meets you where you are.
            </Text>
          </View>
        )}

        {step === "body" && (
          <View>
            <Text style={styles.title}>A bit about your body</Text>
            <Text style={styles.subtitle}>
              Optional — this helps set a starting point for your daily targets. Skip it and your
              Coach can ask later.
            </Text>

            <Text style={styles.label}>Date of birth</Text>
            {Platform.OS === "android" ? (
              // Android: a tappable field that opens the system date dialog (one-shot).
              <TouchableOpacity style={styles.input} onPress={toggleBirthPicker}>
                <Text style={age ? styles.dobValue : styles.dobPlaceholder}>
                  {age ? `${birthDate.toLocaleDateString()} · age ${age}` : "Tap to choose your birth date"}
                </Text>
              </TouchableOpacity>
            ) : (
              // iOS: inline spinner (same pattern Settings/plan use). Each spin
              // tick commits via applyBirthDate — Done just closes the picker UI.
              <TouchableOpacity style={styles.input} onPress={toggleBirthPicker}>
                <Text style={age ? styles.dobValue : styles.dobPlaceholder}>
                  {age ? `${birthDate.toLocaleDateString()} · age ${age}` : "Tap to choose your birth date"}
                </Text>
              </TouchableOpacity>
            )}
            {showBirthPicker && (
              <View>
                <DateTimePicker
                  value={birthDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  maximumDate={new Date()}
                  minimumDate={minBirthDate()}
                  onChange={onChangeBirthDate}
                />
                {Platform.OS === "ios" && (
                  <TouchableOpacity
                    style={styles.doneBtn}
                    onPress={() => {
                      // Done just closes the picker. Commit happened (or didn't)
                      // live in onChangeBirthDate; tapping Done without spinning
                      // must NOT commit the displayed default. Preserves the
                      // "no silent default into BMR" line.
                      setShowBirthPicker(false);
                    }}
                  >
                    <Text style={styles.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Height and weight steppers. Tap −/+ to step, or press and hold to
                repeat. No nested scroll views, so the step fits and scrolls
                cleanly. The displayed default (5'6" / 150 lb) is only stored once
                a stepper is actually touched. */}
            <Text style={styles.label}>Height</Text>
            <Stepper
              value={heightIn}
              min={HEIGHT_MIN_IN}
              max={HEIGHT_MAX_IN}
              display={formatHeight(heightIn)}
              onChange={onHeightChange}
            />

            <Text style={styles.label}>Weight</Text>
            <Stepper
              value={weightLb}
              min={WEIGHT_MIN_LB}
              max={WEIGHT_MAX_LB}
              display={`${weightLb} lb`}
              onChange={onWeightChange}
            />
            <Text style={styles.hint}>
              {heightTouched ? `Height ${formatHeight(heightIn)}.` : "Tap or hold −/+ to set height"}
              {"  ·  "}
              {weightTouched ? `Weight ${weightLb} lb.` : "set weight — or skip both."}
            </Text>

            <Text style={styles.label}>Activity level</Text>
            <View style={styles.chipWrap}>
              {ACTIVITIES.map((a) => (
                <TouchableOpacity
                  key={a}
                  style={[styles.chip, activityLevel === a && styles.chipActive]}
                  onPress={() => setActivityLevel(a)}
                >
                  <Text style={[styles.chipText, activityLevel === a && styles.chipTextActive]}>
                    {ACTIVITY_LABELS[a]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {step === "photos" && showCalibrationConfirm && calibrationResult && (
          // Brief post-call confirmation: she sees that her photos actually
          // produced something before we advance. Only the three QUALITATIVE
          // strings render here — no numbers, no body assessment, no
          // before/after framing (the CALIBRATION_SYSTEM prompt enforces those
          // constraints at the model layer; this UI just displays the result).
          // Auto-advances after CALIBRATION_CONFIRM_AUTOADVANCE_MS, or
          // immediately on Continue. Use-then-discard for the base64 already
          // happened in runCalibration.
          <View>
            <Text style={styles.title}>Got it</Text>
            <Text style={styles.subtitle}>
              Saved to your Coach's memory. You can adjust anytime in Settings under "What your
              Coach remembers about you."
            </Text>

            <View style={styles.confirmCard}>
              {calibrationResult.goal_direction ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Direction</Text>
                  <Text style={styles.confirmValue}>{calibrationResult.goal_direction}</Text>
                </View>
              ) : null}
              {calibrationResult.training_emphasis ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Training focus</Text>
                  <Text style={styles.confirmValue}>{calibrationResult.training_emphasis}</Text>
                </View>
              ) : null}
              {calibrationResult.motivation ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Why</Text>
                  <Text style={styles.confirmValue}>{calibrationResult.motivation}</Text>
                </View>
              ) : null}
            </View>

            <TouchableOpacity style={styles.continueBtn} onPress={commitCalibrationAndAdvance}>
              <Text style={styles.continueBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "photos" && !showCalibrationConfirm && (
          <View>
            <Text style={styles.title}>Your goals in pictures</Text>
            <Text style={styles.subtitle}>
              Optional: a photo of you now, and one that captures where you want to go — a workout,
              a person, a vibe, a feeling. Your Coach uses it to understand the direction you're
              going.
            </Text>
            {/* Load-bearing transparency line: macros stay computed from her stats
                with a safety floor. This is the safety contract she sees on this
                screen. Do not remove or soften. */}
            <Text style={styles.body}>
              Your macros stay computed from your stats with a safety floor; photos don't change the
              numbers.
            </Text>

            <Text style={styles.label}>A photo of you now</Text>
            {currentUri ? (
              <View style={styles.photoSlotFilled}>
                <Image source={{ uri: currentUri }} style={styles.photoThumb} />
                <View style={styles.photoSlotActions}>
                  <TouchableOpacity
                    style={styles.photoSlotBtn}
                    onPress={() => offerPickPhoto("current")}
                    disabled={calibrating}
                  >
                    <Text style={styles.photoSlotBtnText}>Replace</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoSlotBtn}
                    onPress={() => removePhoto("current")}
                    disabled={calibrating}
                  >
                    <Text style={styles.photoSlotBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.photoSlotEmpty}
                onPress={() => offerPickPhoto("current")}
                disabled={calibrating}
              >
                <Text style={styles.photoSlotEmptyText}>Tap to add a photo · optional</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.label}>A photo of where you want to go</Text>
            {goalUri ? (
              <View style={styles.photoSlotFilled}>
                <Image source={{ uri: goalUri }} style={styles.photoThumb} />
                <View style={styles.photoSlotActions}>
                  <TouchableOpacity
                    style={styles.photoSlotBtn}
                    onPress={() => offerPickPhoto("goal")}
                    disabled={calibrating}
                  >
                    <Text style={styles.photoSlotBtnText}>Replace</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoSlotBtn}
                    onPress={() => removePhoto("goal")}
                    disabled={calibrating}
                  >
                    <Text style={styles.photoSlotBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.photoSlotEmpty}
                onPress={() => offerPickPhoto("goal")}
                disabled={calibrating}
              >
                <Text style={styles.photoSlotEmptyText}>
                  Tap to add a photo · a workout, a person, a vibe — optional
                </Text>
              </TouchableOpacity>
            )}

            {calibrating && (
              <View style={styles.calibratingRow}>
                <ActivityIndicator color={ACCENT} />
                <Text style={styles.calibratingText}>Reading what motivates you…</Text>
              </View>
            )}

            <Text style={styles.hint}>
              Photos aren't saved — your Coach reads them once to understand the direction, then
              they're discarded. Skip the whole step anytime.
            </Text>
          </View>
        )}

        {step === "cycle" && (
          <View>
            <Text style={styles.title}>Your cycle</Text>
            <Text style={styles.subtitle}>
              This lets your Coach sync suggestions to your phase. Optional — skip it and log in the
              Cycle tab whenever you like.
            </Text>

            <View style={styles.switchRow}>
              <Text style={[styles.label, styles.switchLabel]}>On hormonal birth control?</Text>
              <Switch value={onBirthControl} onValueChange={setOnBirthControl} />
            </View>

            {onBirthControl ? (
              <Text style={styles.hint}>
                Got it — your Coach won't try to track a natural cycle, and will focus on how you
                feel day to day.
              </Text>
            ) : (
              <>
                <Text style={styles.label}>Last period start date</Text>
                <View style={styles.dateRow}>
                  <TextInput
                    style={[styles.input, styles.dateInput]}
                    value={lastPeriodStart}
                    onChangeText={setLastPeriodStart}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.calendarBtn} onPress={openPicker}>
                    <Text style={styles.calendarBtnText}>📅</Text>
                  </TouchableOpacity>
                </View>

                {showPicker && (
                  <View>
                    <DateTimePicker
                      value={parseDateOrToday(lastPeriodStart)}
                      mode="date"
                      display={Platform.OS === "ios" ? "inline" : "default"}
                      maximumDate={new Date()}
                      onChange={onChangeDate}
                    />
                    {Platform.OS === "ios" && (
                      <TouchableOpacity style={styles.doneBtn} onPress={() => setShowPicker(false)}>
                        <Text style={styles.doneBtnText}>Done</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <Text style={styles.label}>Average cycle length (days)</Text>
                <TextInput
                  style={styles.input}
                  value={avgCycleLength}
                  onChangeText={setAvgCycleLength}
                  placeholder="28"
                  keyboardType="number-pad"
                />
                <Text style={styles.hint}>
                  Just a starting estimate. Log your periods in the Cycle tab over time and Flux
                  learns your real average.
                </Text>
              </>
            )}
          </View>
        )}

        {step === "diet" && (
          <View>
            <Text style={styles.title}>How you eat</Text>
            <Text style={styles.subtitle}>
              Anything your Coach should always keep in mind? Tap any that apply, or skip.
            </Text>

            <View style={styles.chipWrap}>
              {DIET_CHIPS.map((c) => {
                const on = dietChips.includes(c.key);
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => toggleDietChip(c.key)}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Anything else?</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={dietNotes}
              onChangeText={setDietNotes}
              placeholder="e.g. no shellfish, lactose intolerant, hate cilantro"
              multiline
            />
            <Text style={styles.hint}>
              Your Coach will remember these from your very first message.
            </Text>
          </View>
        )}

        {step === "tone" && (
          <View>
            <Text style={styles.title}>Your Coach's vibe</Text>
            <Text style={styles.subtitle}>
              How should your Coach talk to you? You can change this anytime in Settings.
            </Text>

            <View style={styles.chipWrap}>
              {TONES.map((tn) => (
                <TouchableOpacity
                  key={tn}
                  style={[styles.chip, tone === tn && styles.chipActive]}
                  onPress={() => setTone(tn)}
                >
                  <Text style={[styles.chipText, tone === tn && styles.chipTextActive]}>
                    {TONE_LABELS[tn]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>
              {tone === "hype"
                ? "Upbeat and high-energy — celebrates your wins and pumps you up."
                : tone === "tough_love"
                  ? "Firm and accountable — pushes you, but always warmly in your corner."
                  : "Warm and casual, like your most knowledgeable friend. (A good default.)"}
            </Text>
          </View>
        )}

        {step === "start" && (
          <View>
            <Text style={styles.title}>How do you want to start?</Text>
            <Text style={styles.subtitle}>
              Either way you're all set up — pick whatever feels right. You can always do the other
              one later.
            </Text>

            <TouchableOpacity
              style={[styles.startCard, startDest === "workout" && styles.startCardOn]}
              onPress={() => setStartDest("workout")}
            >
              <Text style={[styles.startCardTitle, startDest === "workout" && styles.startCardTitleOn]}>
                🏋️ Create my workout plan
              </Text>
              <Text style={[styles.startCardText, startDest === "workout" && styles.startCardTextOn]}>
                Your Coach builds a week of training around your goal and cycle. We'll take you
                straight to set it up.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.startCard, startDest === "coach" && styles.startCardOn]}
              onPress={() => setStartDest("coach")}
            >
              <Text style={[styles.startCardTitle, startDest === "coach" && styles.startCardTitleOn]}>
                💬 Chat with my coach
              </Text>
              <Text style={[styles.startCardText, startDest === "coach" && styles.startCardTextOn]}>
                Just talk — ask anything, log how you feel, or get a plan whenever you're ready.
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Sticky footer nav: Back, optional Skip on skippable steps, and Next.
          While the calibration confirmation card is up, footer controls hide so
          the user's only forward path is the on-card Continue button (or the
          auto-advance timer) — keeps her eyes on the result that just landed. */}
      {!(step === "photos" && showCalibrationConfirm) && (
        <View style={styles.footer}>
          {stepIndex > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={back} disabled={saving || calibrating}>
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtnSpacer} />
          )}

          <TouchableOpacity style={styles.nextBtn} onPress={next} disabled={saving || calibrating}>
            <Text style={styles.nextBtnText}>
              {isLast
                ? saving
                  ? "Setting up…"
                  : startDest === "workout"
                    ? "Build my plan"
                    : "Meet your Coach"
                : step === "photos" && calibrating
                  ? "Reading…"
                  : step === "photos" && !currentUri && !goalUri
                    ? "Skip"
                    : "Next"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Styles mirror SettingsScreen (same light/purple Flux palette + chip/input
// patterns) so onboarding feels like the same app, with a stepped footer added.
const ACCENT = "#7c3aed";
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  container: { padding: 20, paddingBottom: 40 },
  dots: { flexDirection: "row", gap: 6, marginBottom: 24 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#e7e3f2" },
  dotActive: { backgroundColor: ACCENT },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 10, color: "#1a1a1a" },
  subtitle: { fontSize: 15, color: "#666", marginBottom: 8, lineHeight: 21 },
  body: { fontSize: 16, color: "#333", marginBottom: 14, lineHeight: 23 },
  bodyMuted: { fontSize: 13, color: "#999", marginTop: 6 },
  label: { fontSize: 15, fontWeight: "600", marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  // Date-of-birth pseudo-input (a TouchableOpacity styled like `input`).
  dobValue: { fontSize: 16, color: "#1a1a1a" },
  dobPlaceholder: { fontSize: 16, color: "#999" },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  hint: { fontSize: 13, color: "#666", marginTop: 10, lineHeight: 18 },
  // Height/weight steppers: big −/+ buttons flanking a centered value.
  stepperRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginTop: 2 },
  stepBtn: {
    width: 64,
    height: 56,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#f0eef7",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: { backgroundColor: "#f7f7f7", borderColor: "#eee" },
  stepBtnText: { fontSize: 28, fontWeight: "700", color: ACCENT, lineHeight: 32 },
  stepBtnTextDisabled: { color: "#ccc" },
  stepperValueBox: {
    flex: 1,
    height: 56,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#fafafa",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: { fontSize: 22, fontWeight: "700", color: "#1a1a1a" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  switchLabel: { marginTop: 16 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateInput: { flex: 1 },
  calendarBtn: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  calendarBtnText: { fontSize: 18 },
  doneBtn: { alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 12 },
  doneBtnText: { color: ACCENT, fontWeight: "700", fontSize: 15 },
  // Photo "calibration" step slots. The empty state is a dashed tap target; the
  // filled state shows a thumbnail with Replace/Remove buttons. Slots are small
  // (~100px tall) so both fit on screen without scroll being a fight.
  photoSlotEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cfc8e0",
    borderRadius: 12,
    paddingVertical: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#faf9fd",
  },
  photoSlotEmptyText: { color: ACCENT, fontWeight: "600", fontSize: 14, textAlign: "center", paddingHorizontal: 12 },
  photoSlotFilled: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e7e3f2",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#faf9fd",
  },
  photoThumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: "#eee" },
  photoSlotActions: { flex: 1, gap: 8 },
  photoSlotBtn: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  photoSlotBtnText: { color: "#333", fontSize: 14, fontWeight: "600" },
  calibratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },
  calibratingText: { color: "#666", fontSize: 14 },
  // Post-calibration confirmation card. A soft, accent-tinted block with three
  // label/value rows for the qualitative strings the model produced. Read-only
  // here — facts are seeded into Coach memory at finish() via calibratedFacts,
  // and editable later in Settings → "What your Coach remembers about you".
  confirmCard: {
    borderWidth: 1,
    borderColor: "#e7e3f2",
    backgroundColor: "#faf9fd",
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    gap: 12,
  },
  confirmRow: { gap: 4 },
  confirmLabel: { fontSize: 13, fontWeight: "700", color: ACCENT, letterSpacing: 0.3 },
  confirmValue: { fontSize: 15, color: "#1a1a1a", lineHeight: 21 },
  continueBtn: {
    marginTop: 18,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  continueBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  // Final "how to start" choice cards.
  startCard: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
  },
  startCardOn: { borderColor: ACCENT, backgroundColor: "#f0eef7" },
  startCardTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  startCardTitleOn: { color: ACCENT },
  startCardText: { fontSize: 14, color: "#666", marginTop: 6, lineHeight: 20 },
  startCardTextOn: { color: "#555" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
  },
  backBtn: { paddingVertical: 14, paddingHorizontal: 20 },
  backBtnText: { color: "#666", fontSize: 16, fontWeight: "600" },
  backBtnSpacer: { width: 0 },
  nextBtn: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  nextBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
