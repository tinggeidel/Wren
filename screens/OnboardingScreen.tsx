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
} from "react-native";
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
// skipped Body step never stores a value she didn't pick.
function defaultBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 30);
  return d;
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

// The lean step list. Body stats, cycle, and diet are all skippable — the app and
// Coach already tolerate missing fields, and the Coach can ask for stats later.
// "start" is the final fork: create a plan vs. chat with the Coach.
const STEPS = ["welcome", "basics", "body", "cycle", "diet", "tone", "start"] as const;
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
  // she confirms a date, so a skipped Body step never stores a default she didn't
  // choose. `birthDate` is local-only — not persisted, not added to the Profile.
  const [birthDate, setBirthDate] = useState<Date>(defaultBirthDate);
  const [showBirthPicker, setShowBirthPicker] = useState(false);

  // Body steppers: live numeric values. Defaults show a friendly starting point
  // (5'6", 150 lb), but they only get written into height/weight once she
  // actually presses a stepper — tracked by the *Touched flags. A skipped Body
  // step (or an untouched stepper) leaves height/weight blank, so computeBMR
  // returns null and the Coach asks later — never a silent default into BMR.
  const [heightIn, setHeightIn] = useState(HEIGHT_DEFAULT_IN);
  const [heightTouched, setHeightTouched] = useState(false);
  const [weightLb, setWeightLb] = useState(WEIGHT_DEFAULT_LB);
  const [weightTouched, setWeightTouched] = useState(false);

  function openPicker() {
    if (!lastPeriodStart) setLastPeriodStart(toISODate(new Date()));
    setShowPicker((s) => !s);
  }

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "set" && date) setLastPeriodStart(toISODate(date));
  }

  // Birth-date picker handlers. On confirm we compute + store the age string only;
  // on Android the picker is a one-shot dialog (it dismisses itself) so we confirm
  // on "set"; on iOS the inline picker stays open and a Done button confirms.
  function applyBirthDate(d: Date) {
    setBirthDate(d);
    setAge(String(ageFromBirthDate(d, new Date())));
  }
  function onChangeBirthDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") {
      setShowBirthPicker(false);
      if (event.type === "set" && date) applyBirthDate(date);
      return;
    }
    // iOS inline: reflect the spin live; the field is set when she taps Done.
    if (date) setBirthDate(date);
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

  const isLast = stepIndex === STEPS.length - 1;

  function next() {
    if (isLast) {
      void finish();
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
        age: age.trim(),
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
      const facts = [...chipFacts];
      const note = dietNotes.trim();
      if (note) facts.push(note);
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
              <TouchableOpacity style={styles.input} onPress={() => setShowBirthPicker(true)}>
                <Text style={age ? styles.dobValue : styles.dobPlaceholder}>
                  {age ? `${birthDate.toLocaleDateString()} · age ${age}` : "Tap to choose your birth date"}
                </Text>
              </TouchableOpacity>
            ) : (
              // iOS: inline spinner (same pattern Settings/plan use), confirmed by Done.
              <TouchableOpacity style={styles.input} onPress={() => setShowBirthPicker((s) => !s)}>
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
                      applyBirthDate(birthDate);
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

      {/* Sticky footer nav: Back, optional Skip on skippable steps, and Next. */}
      <View style={styles.footer}>
        {stepIndex > 0 ? (
          <TouchableOpacity style={styles.backBtn} onPress={back} disabled={saving}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtnSpacer} />
        )}

        <TouchableOpacity style={styles.nextBtn} onPress={next} disabled={saving}>
          <Text style={styles.nextBtnText}>
            {isLast
              ? saving
                ? "Setting up…"
                : startDest === "workout"
                  ? "Build my plan"
                  : "Meet your Coach"
              : "Next"}
          </Text>
        </TouchableOpacity>
      </View>
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
