import { useState } from "react";
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
  CalorieMode,
  CALORIE_MODE_LABELS,
  CoachMemory,
} from "../lib/types";
import { saveProfile } from "../lib/storage";
import { toISODate } from "../lib/cycle";
import { computeTargets } from "../lib/targets";
import { removeMemory } from "../lib/memory";

const GOALS: Goal[] = ["lose_fat", "tone_up", "build_muscle", "feel_better", "maintain"];
const TONES: Tone[] = ["hype", "bestie", "tough_love"];
const ACTIVITIES: ActivityLevel[] = ["sedentary", "light", "active", "very_active"];
const CALORIE_MODES: CalorieMode[] = ["static", "net"];

// Parse a "YYYY-MM-DD" string to a Date; fall back to today if empty/invalid.
function parseDateOrToday(s: string): Date {
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? new Date() : d;
}

export default function SettingsScreen({
  initial,
  onSaved,
  onProfileChange,
}: {
  initial: Profile | null;
  onSaved: (p: Profile) => void;
  // Like CoachScreen's prop: updates the parent's profile WITHOUT switching tabs.
  // Used by per-row memory deletes so they stay put on Settings.
  onProfileChange?: (p: Profile) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [goal, setGoal] = useState<Goal>(initial?.goal ?? "feel_better");
  // Coerce any old/invalid saved tone to a current one.
  const [tone, setTone] = useState<Tone>(
    initial && TONES.includes(initial.tone) ? initial.tone : "bestie"
  );
  const [dietaryRules, setDietaryRules] = useState(initial?.dietaryRules ?? "");
  const [onBirthControl, setOnBirthControl] = useState(initial?.onBirthControl ?? false);
  const [lastPeriodStart, setLastPeriodStart] = useState(initial?.lastPeriodStart ?? "");
  const [avgCycleLength, setAvgCycleLength] = useState(String(initial?.avgCycleLength ?? 28));
  const [age, setAge] = useState(initial?.age ?? "");
  const [height, setHeight] = useState(initial?.height ?? "");
  const [weight, setWeight] = useState(initial?.weight ?? "");
  const [goalWeight, setGoalWeight] = useState(initial?.goalWeight ?? "");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(
    initial?.activityLevel ?? "light"
  );
  const [calorieMode, setCalorieMode] = useState<CalorieMode>(initial?.calorieMode ?? "static");
  // Long-term Coach memory is read from the live `initial` prop (not local state)
  // so a fact the Coach saves while Settings is mounted isn't clobbered on Save,
  // and so deletes/out-of-band additions both show correctly. The parent re-passes
  // `initial` after each save, which re-renders the list below.
  const coachMemory: CoachMemory[] = initial?.coachMemory ?? [];
  const [showPicker, setShowPicker] = useState(false);

  function buildProfile(): Profile {
    return {
      name: name.trim(),
      goal,
      tone,
      dietaryRules: dietaryRules.trim(),
      onBirthControl,
      lastPeriodStart: lastPeriodStart.trim(),
      avgCycleLength: Number(avgCycleLength) || 28,
      age: age.trim(),
      height: height.trim(),
      weight: weight.trim(),
      goalWeight: goalWeight.trim(),
      activityLevel,
      calorieMode,
      dayLogs: initial?.dayLogs ?? {}, // preserve cycle history — never wipe it on save
      foodLogs: initial?.foodLogs ?? {}, // preserve food log on save (same rule)
      waterLogs: initial?.waterLogs ?? {}, // preserve water log on save
      workoutLogs: initial?.workoutLogs ?? {}, // preserve workout log on save
      savedFoods: initial?.savedFoods ?? [], // preserve saved foods on save
      savedMeals: initial?.savedMeals ?? [], // preserve saved meals on save
      weightLog: initial?.weightLog ?? [], // preserve weight log on save
      plan: initial?.plan, // preserve the tailored plan on save
      coachMemory: initial?.coachMemory ?? [], // preserve long-term Coach memory from the live prop (don't clobber out-of-band adds)
    };
  }

  // Live-computed targets shown in this screen (the home for macros).
  const targets = computeTargets(buildProfile());

  function openPicker() {
    if (!lastPeriodStart) setLastPeriodStart(toISODate(new Date()));
    setShowPicker((s) => !s);
  }

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "set" && date) setLastPeriodStart(toISODate(date));
  }

  async function handleSave() {
    const profile = buildProfile();
    await saveProfile(profile);
    onSaved(profile);
  }

  // Delete one remembered fact. Persists right away (so it sticks even if she
  // leaves without tapping Save). It removes from the LAST-SAVED live profile
  // (`initial`), not buildProfile(), so it does NOT commit any unsaved edits to
  // other form fields. It updates the parent via onProfileChange (setProfile
  // only, no tab change), so she stays on Settings and the list refreshes in
  // place. (If a row is visible, `initial` exists; guard the theoretical null.)
  async function handleForget(id: string) {
    if (!initial) return;
    const next = removeMemory(initial, id);
    await saveProfile(next);
    onProfileChange?.(next);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={styles.title}>Your Flux profile</Text>
      <Text style={styles.subtitle}>
        This stays on your device. The Coach uses it to tailor what it says.
      </Text>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" />

      <Text style={styles.label}>Goal</Text>
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

      <Text style={styles.label}>Coach's tone</Text>
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

      <Text style={styles.label}>Preferences / rules</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={dietaryRules}
        onChangeText={setDietaryRules}
        placeholder="e.g. no dairy, prefers mornings, hates burpees"
        multiline
      />

      <Text style={styles.section}>Body — optional (helps set your targets, skip if you like)</Text>
      <Text style={styles.label}>Age</Text>
      <TextInput
        style={styles.input}
        value={age}
        onChangeText={setAge}
        placeholder="e.g. 31"
        keyboardType="number-pad"
      />
      <Text style={styles.label}>Height</Text>
      <TextInput
        style={styles.input}
        value={height}
        onChangeText={setHeight}
        placeholder={"e.g. 5'6\" or 168 cm"}
      />
      <Text style={styles.label}>Weight</Text>
      <TextInput
        style={styles.input}
        value={weight}
        onChangeText={setWeight}
        placeholder="e.g. 140 lb or 64 kg"
      />
      <Text style={styles.label}>Goal weight</Text>
      <TextInput
        style={styles.input}
        value={goalWeight}
        onChangeText={setGoalWeight}
        placeholder="e.g. 130 lb or 59 kg"
      />
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

      {targets ? (
        <View style={styles.targetsCard}>
          <Text style={styles.targetsTitle}>Your daily targets</Text>
          <Text style={styles.targetsNumbers}>
            {targets.calories} kcal · {targets.protein}g protein · {targets.carbs}g carbs ·{" "}
            {targets.fat}g fat
          </Text>
          <Text style={styles.targetsHint}>A starting point — tune it by results and how you feel.</Text>
        </View>
      ) : (
        <Text style={styles.targetsMissing}>
          Add age, height, and weight (with units, e.g. 5'6" and 140 lb) to see your daily targets.
        </Text>
      )}

      <Text style={styles.section}>Calories & workouts</Text>
      <Text style={styles.label}>When you log a workout</Text>
      <View style={styles.chipWrap}>
        {CALORIE_MODES.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.chip, calorieMode === m && styles.chipActive]}
            onPress={() => setCalorieMode(m)}
          >
            <Text style={[styles.chipText, calorieMode === m && styles.chipTextActive]}>
              {CALORIE_MODE_LABELS[m]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>
        {calorieMode === "net"
          ? "Net (eat-back): calories you burn add to your daily food budget, so a harder workout means more room to fuel. Your base target never drops below your BMR."
          : "Static: your daily target stays the same. Calories burned are shown for awareness but don't change how much you should eat."}
      </Text>

      <Text style={styles.section}>Cycle</Text>
      <View style={styles.switchRow}>
        <Text style={[styles.label, styles.switchLabel]}>On hormonal birth control?</Text>
        <Switch value={onBirthControl} onValueChange={setOnBirthControl} />
      </View>

      {!onBirthControl && (
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
            This is just a starting estimate. Log your periods over time in the Cycle tab and Flux
            learns your real average and predicts your next one.
          </Text>
        </>
      )}

      <Text style={styles.section}>What your Coach remembers about you</Text>
      {coachMemory.length === 0 ? (
        <Text style={styles.hint}>
          As you chat, your Coach will note lasting things about you here — like dietary
          preferences or injuries. You can delete anything.
        </Text>
      ) : (
        <View style={styles.memoryList}>
          {coachMemory.map((m) => (
            <View key={m.id} style={styles.memoryRow}>
              <Text style={styles.memoryText}>{m.text}</Text>
              <TouchableOpacity
                style={styles.memoryDelete}
                onPress={() => handleForget(m.id)}
                accessibilityLabel={`Delete: ${m.text}`}
              >
                <Text style={styles.memoryDeleteText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>Save & go to Coach</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 12 },
  section: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7c3aed",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 24,
  },
  label: { fontSize: 15, fontWeight: "600", marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: "#7c3aed", borderColor: "#7c3aed" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  targetsCard: {
    backgroundColor: "#f0eef7",
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  targetsTitle: { fontSize: 13, fontWeight: "700", color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.5 },
  targetsNumbers: { fontSize: 16, fontWeight: "600", color: "#1a1a1a", marginTop: 8, lineHeight: 24 },
  targetsHint: { fontSize: 13, color: "#666", marginTop: 8 },
  targetsMissing: { fontSize: 14, color: "#666", marginTop: 20, lineHeight: 20 },
  hint: { fontSize: 13, color: "#666", marginTop: 8, lineHeight: 18 },
  memoryList: { marginTop: 12, gap: 8 },
  memoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "#f0eef7",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  memoryText: { flex: 1, fontSize: 15, color: "#1a1a1a", lineHeight: 20 },
  memoryDelete: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  memoryDeleteText: { fontSize: 16, color: "#7c3aed", fontWeight: "700" },
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
  doneBtnText: { color: "#7c3aed", fontWeight: "700", fontSize: 15 },
  saveBtn: {
    backgroundColor: "#7c3aed",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 28,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
