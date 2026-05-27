import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  Image,
  Modal,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
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
import { toISODate } from "../lib/cycle";
import {
  computeTargets,
  targetsFloorCalories,
  recomputeMacrosFromCalories,
} from "../lib/targets";
import { removeMemory } from "../lib/memory";
import { Stepper } from "../components/Stepper";

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
  updateProfile,
  onSaved,
  onReset,
}: {
  initial: Profile | null;
  // Single shared updater (App.tsx). Applies the form overlay to the LATEST
  // profile, never `initial` (a render-time snapshot), so sibling maps —
  // dayLogs/foodLogs/workoutLogs/savedFoods/savedMeals/weightLog/plan/
  // coachMemory — and any out-of-band Coach writes are preserved on Save.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  // Navigation-only side effect after a full Save (jump to the Coach tab).
  // Per-row memory deletes deliberately do NOT call this, so they stay put.
  onSaved: () => void;
  // "Start over": wipe all data and return to onboarding (App.resetApp). Only
  // called after the destructive confirm in handleStartOver below.
  onReset: () => Promise<void>;
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
  // Photo URIs are read from the live `initial` (not local state) so a retake
  // or delete reflects immediately, and the wipe-guard pattern is preserved:
  // every change goes through updateProfile so it composes on the LATEST
  // profile and never clobbers sibling fields from a stale snapshot.
  //
  // 2026-05 upgrade: the single self-photo split into FRONT + SIDE so the
  // calibration call can triangulate. Legacy `currentPhotoUri` is migrated to
  // `currentFrontPhotoUri` in lib/storage.ts on load — Settings only reads the
  // new fields.
  const currentFrontPhotoUri = initial?.currentFrontPhotoUri;
  const currentSidePhotoUri = initial?.currentSidePhotoUri;
  const goalPhotoUri = initial?.goalPhotoUri;
  const [showPicker, setShowPicker] = useState(false);

  // Overlay the form fields onto the LATEST profile `p` (passed in by
  // updateProfile at save time). Every NON-form field — the data maps and the
  // plan/memory — is taken from `p`, not from the render-time `initial` snapshot,
  // so a Coach write (or any other screen's write) that landed after this screen
  // rendered is preserved rather than clobbered. This is also the wipe-guard:
  // we never reset these to {} / [] from a stale snapshot.
  function buildProfileFromForm(p: Profile): Profile {
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
      dayLogs: p.dayLogs ?? {}, // preserve cycle history — never wipe it on save
      foodLogs: p.foodLogs ?? {}, // preserve food log on save (same rule)
      waterLogs: p.waterLogs ?? {}, // preserve water log on save
      workoutLogs: p.workoutLogs ?? {}, // preserve workout log on save
      savedFoods: p.savedFoods ?? [], // preserve saved foods on save
      savedMeals: p.savedMeals ?? [], // preserve saved meals on save
      weightLog: p.weightLog ?? [], // preserve weight log on save
      plan: p.plan, // preserve the tailored plan on save
      coachMemory: p.coachMemory ?? [], // preserve long-term Coach memory (don't clobber out-of-band adds)
      // Photo URIs are managed by their own retake/delete handlers (which call
      // updateProfile directly), so the form save just preserves whatever is on
      // the latest profile — no clobber via stale snapshot.
      currentFrontPhotoUri: p.currentFrontPhotoUri,
      currentSidePhotoUri: p.currentSidePhotoUri,
      goalPhotoUri: p.goalPhotoUri,
      // Body measurements are preserved as-is from the latest profile —
      // Settings doesn't edit them yet (only onboarding's measurements step
      // sets them). Same wipe-guard rule: never blank them from a stale
      // snapshot.
      waistIn: p.waistIn,
      neckIn: p.neckIn,
      hipIn: p.hipIn,
      // Macro override + when-set timestamp: written by the dedicated Macros
      // editor below (which goes through updateProfile directly, like the
      // photo handlers). The full-Save path just preserves whatever the
      // latest profile holds — never blank from a stale snapshot.
      customTargets: p.customTargets,
      customTargetsSetAt: p.customTargetsSetAt,
    };
  }

  // Live-computed targets shown in this screen (the home for macros). Display
  // only — overlay the form onto the render-time `initial` (or {} on first run);
  // the authoritative save uses the latest profile via updateProfile.
  const formPreview = buildProfileFromForm(initial ?? ({} as Profile));
  const targets = computeTargets(formPreview);
  // Floor for the macros editor below: max(BMR, 1200). Null when she hasn't
  // filled in enough body fields yet — in that case the editor still works
  // and skips the warning (no floor to compare against).
  const floorCal = targetsFloorCalories(formPreview);
  const hasCustomTargets = !!initial?.customTargets;

  // --- Macros editor sheet -------------------------------------------------
  // Modal-state: live-edited calorie / macro values, NOT persisted until Save.
  // Pre-populated with the current effective targets on open. Closing without
  // tapping Save discards.
  const [macrosOpen, setMacrosOpen] = useState(false);
  const [editCal, setEditCal] = useState(0);
  const [editProtein, setEditProtein] = useState(0);
  const [editCarbs, setEditCarbs] = useState(0);
  const [editFat, setEditFat] = useState(0);

  // Re-seed the editor when it opens (or when current targets change while open
  // would be unusual, but we still want it pre-filled with the right numbers).
  useEffect(() => {
    if (!macrosOpen) return;
    const t = targets ?? { calories: 2000, protein: 130, carbs: 220, fat: 70 };
    setEditCal(t.calories);
    setEditProtein(t.protein);
    setEditCarbs(t.carbs);
    setEditFat(t.fat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macrosOpen]);

  const editBelowFloor = floorCal != null && editCal < floorCal;
  // Verbatim warning text — surfaced in the editor and (when she taps Save with
  // a sub-floor calorie value) the confirm Alert. Kept in one const so both
  // copies stay in sync. Soft + honest, non-alarmist, ED-safety-aware.
  const subFloorWarningCopy = floorCal
    ? `This is below your BMR (${floorCal} kcal). Sustained sub-BMR intake can affect energy, hormones, and recovery. You can save it if you want.`
    : "";

  // Recompute the three macro steppers from the current calorie stepper value,
  // via the same goal-aware formula the auto-targets path uses (protein per kg,
  // fat 27%, carbs the rest). No-op when weight is missing.
  function autoCalcFromCalories() {
    const out = recomputeMacrosFromCalories(formPreview, editCal);
    if (!out) {
      Alert.alert(
        "Add your weight first",
        "I need your weight to auto-calculate macros from a calorie target. Add it above and try again."
      );
      return;
    }
    setEditProtein(out.protein);
    setEditCarbs(out.carbs);
    setEditFat(out.fat);
  }

  async function persistCustomTargets() {
    const next = {
      calories: editCal,
      protein: editProtein,
      carbs: editCarbs,
      fat: editFat,
    };
    await updateProfile((p) => ({
      ...p,
      customTargets: next,
      customTargetsSetAt: toISODate(new Date()),
    }));
    setMacrosOpen(false);
  }

  function handleSaveMacros() {
    if (editBelowFloor) {
      Alert.alert("Below your BMR floor", subFloorWarningCopy + "\n\nSave it anyway?", [
        { text: "Cancel", style: "cancel" },
        { text: "Save it anyway", style: "destructive", onPress: () => void persistCustomTargets() },
      ]);
      return;
    }
    void persistCustomTargets();
  }

  async function handleResetMacros() {
    await updateProfile((p) => ({
      ...p,
      customTargets: undefined,
      customTargetsSetAt: undefined,
    }));
    setMacrosOpen(false);
  }

  function openPicker() {
    if (!lastPeriodStart) setLastPeriodStart(toISODate(new Date()));
    setShowPicker((s) => !s);
  }

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "set" && date) setLastPeriodStart(toISODate(date));
  }

  async function handleSave() {
    // Overlay the form onto the LATEST profile (via updateProfile's ref), then
    // navigate to the Coach tab. Persistence is handled by updateProfile.
    await updateProfile((p) => buildProfileFromForm(p));
    onSaved();
  }

  // Delete one remembered fact. Persists right away (so it sticks even if she
  // leaves without tapping Save), via updateProfile so it composes on the LATEST
  // profile — it does NOT commit any unsaved edits to the form's other fields,
  // and it deliberately does NOT navigate (no onSaved), so she stays on Settings
  // and the list refreshes in place.
  async function handleForget(id: string) {
    await updateProfile((p) => removeMemory(p, id));
  }

  // --- Body photos ---------------------------------------------------------
  // Retake = pick a new photo and store its URI. Delete = clear the URI.
  // Both routes go through updateProfile so they compose on the LATEST profile
  // (preserves the wipe-guard) and persist immediately, even if the user leaves
  // without tapping Save. We deliberately do NOT re-run calibration on retake —
  // the photo's role here is just on-device record; the original onboarding
  // calibration already seeded Coach memory. Re-running would burn API spend
  // every time she retakes, and the qualitative facts (now editable in the
  // memory section above) are the durable signal.
  // Three slots now: "front" + "side" (self-photos) and "goal" (direction).
  type PhotoSlot = "front" | "side" | "goal";

  async function pickAndStorePhoto(slot: PhotoSlot, source: "camera" | "library") {
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
      const uri = res.assets[0].uri;
      await updateProfile((p) => {
        if (slot === "front") return { ...p, currentFrontPhotoUri: uri };
        if (slot === "side") return { ...p, currentSidePhotoUri: uri };
        return { ...p, goalPhotoUri: uri };
      });
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  function offerRetake(slot: PhotoSlot) {
    const title =
      slot === "front"
        ? "Replace your front photo"
        : slot === "side"
          ? "Replace your side photo"
          : "Replace your goal photo";
    Alert.alert(title, "Pick a new photo or skip.", [
      { text: "Take photo", onPress: () => void pickAndStorePhoto(slot, "camera") },
      { text: "Choose from library", onPress: () => void pickAndStorePhoto(slot, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function handleDeletePhoto(slot: PhotoSlot) {
    // Clear the URI. We don't try to delete the file from cache — Expo manages
    // the cache and the URI is just a pointer; on next launch the asset may or
    // may not still be there but that's fine because we no longer reference it.
    await updateProfile((p) => {
      if (slot === "front") return { ...p, currentFrontPhotoUri: undefined };
      if (slot === "side") return { ...p, currentSidePhotoUri: undefined };
      return { ...p, goalPhotoUri: undefined };
    });
  }

  // "Start over": destructive, irreversible wipe. Gate it behind a confirm so a
  // stray tap can't erase everything. Only the destructive button calls onReset,
  // which clears all data and returns the app to onboarding.
  function handleStartOver() {
    Alert.alert(
      "Start over?",
      "This erases all your data — profile, logs, chat, plan, everything — and restarts onboarding. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Erase & restart", style: "destructive", onPress: () => void onReset() },
      ]
    );
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
            {targets.calories} kcal · {targets.protein}P / {targets.carbs}C / {targets.fat}F
          </Text>
          <Text style={styles.targetsHint}>
            {hasCustomTargets ? "Custom — set by you." : "Auto-computed from your goal."}
          </Text>
          {floorCal != null && (
            <Text style={styles.targetsFloor}>Floor: {floorCal} kcal (your BMR)</Text>
          )}
          <TouchableOpacity style={styles.customizeBtn} onPress={() => setMacrosOpen(true)}>
            <Text style={styles.customizeBtnText}>Customize</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.targetsMissing}>
          Add age, height, and weight (with units, e.g. 5'6" and 140 lb) to see your daily targets.
        </Text>
      )}

      {/* Macros editor — modal sheet. Four Steppers (calories + the three
          macros), with an "Auto-calc from calories" helper, a soft sub-floor
          warning that escalates to an Alert confirm on Save, and a Reset to
          auto path. All writes go through updateProfile so they compose on the
          LATEST profile (wipe-guard preserved). */}
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={macrosOpen}
        onRequestClose={() => setMacrosOpen(false)}
      >
        <ScrollView
          contentContainerStyle={styles.modalContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Customize macros</Text>
          <Text style={styles.subtitle}>
            Edit your daily targets. These override the auto-computed ones until you tap "Reset to
            auto."
          </Text>

          <Text style={styles.label}>Calories (kcal)</Text>
          <Stepper
            value={editCal}
            min={800}
            max={5000}
            step={10}
            display={`${editCal} kcal`}
            onChange={setEditCal}
          />
          {editBelowFloor && (
            <Text style={styles.warnText}>{subFloorWarningCopy}</Text>
          )}

          <TouchableOpacity style={styles.autoCalcBtn} onPress={autoCalcFromCalories}>
            <Text style={styles.autoCalcBtnText}>Auto-calc macros from calories</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Protein (g)</Text>
          <Stepper
            value={editProtein}
            min={0}
            max={300}
            step={5}
            display={`${editProtein} g`}
            onChange={setEditProtein}
          />

          <Text style={styles.label}>Carbs (g)</Text>
          <Stepper
            value={editCarbs}
            min={0}
            max={600}
            step={5}
            display={`${editCarbs} g`}
            onChange={setEditCarbs}
          />

          <Text style={styles.label}>Fat (g)</Text>
          <Stepper
            value={editFat}
            min={0}
            max={200}
            step={5}
            display={`${editFat} g`}
            onChange={setEditFat}
          />

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveMacros}>
            <Text style={styles.saveBtnText}>Save macros</Text>
          </TouchableOpacity>

          {hasCustomTargets && (
            <TouchableOpacity style={styles.resetMacrosBtn} onPress={() => void handleResetMacros()}>
              <Text style={styles.resetMacrosBtnText}>Reset to auto</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={() => setMacrosOpen(false)}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

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

      {/* Body photos — the current + goal photos she shared during onboarding
          (or hasn't yet). Two small thumbnail rows; each row has Retake + Delete
          if a photo is set, or a single "Add" tap target when empty. All edits
          flow through updateProfile so they persist immediately and compose on
          the LATEST profile (wipe-guard preserved). Photos stay on this device. */}
      <Text style={styles.section}>Body photos</Text>
      <Text style={styles.hint}>
        Optional. Saved on this device so you can see where you started and where you're going.
        Your Coach already read them during onboarding — they don't change your macros.
      </Text>

      <Text style={styles.label}>Front</Text>
      {currentFrontPhotoUri ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: currentFrontPhotoUri }} style={styles.photoThumb} />
          <View style={styles.photoActions}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => offerRetake("front")}>
              <Text style={styles.photoBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.photoBtn, styles.photoBtnDanger]}
              onPress={() => void handleDeletePhoto("front")}
            >
              <Text style={styles.photoBtnDangerText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.photoEmpty} onPress={() => offerRetake("front")}>
          <Text style={styles.photoEmptyText}>No front photo · tap to add</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.label}>Side</Text>
      {currentSidePhotoUri ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: currentSidePhotoUri }} style={styles.photoThumb} />
          <View style={styles.photoActions}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => offerRetake("side")}>
              <Text style={styles.photoBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.photoBtn, styles.photoBtnDanger]}
              onPress={() => void handleDeletePhoto("side")}
            >
              <Text style={styles.photoBtnDangerText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.photoEmpty} onPress={() => offerRetake("side")}>
          <Text style={styles.photoEmptyText}>No side photo · tap to add</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.label}>Goal</Text>
      {goalPhotoUri ? (
        <View style={styles.photoRow}>
          <Image source={{ uri: goalPhotoUri }} style={styles.photoThumb} />
          <View style={styles.photoActions}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => offerRetake("goal")}>
              <Text style={styles.photoBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.photoBtn, styles.photoBtnDanger]}
              onPress={() => void handleDeletePhoto("goal")}
            >
              <Text style={styles.photoBtnDangerText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.photoEmpty} onPress={() => offerRetake("goal")}>
          <Text style={styles.photoEmptyText}>No goal photo · tap to add</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>Save & go to Coach</Text>
      </TouchableOpacity>

      {/* Destructive zone — visually separated from the normal settings above so
          it can't be mistaken for a routine action. Used to re-test onboarding. */}
      <View style={styles.dangerZone}>
        <TouchableOpacity style={styles.resetBtn} onPress={handleStartOver}>
          <Text style={styles.resetBtnText}>Start over</Text>
        </TouchableOpacity>
        <Text style={styles.resetHint}>
          Erases everything on this device and restarts onboarding.
        </Text>
      </View>
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
  targetsFloor: { fontSize: 12, color: "#888", marginTop: 4 },
  targetsMissing: { fontSize: 14, color: "#666", marginTop: 20, lineHeight: 20 },
  customizeBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#7c3aed",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  customizeBtnText: { color: "#7c3aed", fontWeight: "700", fontSize: 14 },
  modalContainer: { padding: 20, paddingBottom: 60 },
  // Soft sub-floor warning. Orange/red but not alarmist; honest copy.
  warnText: {
    fontSize: 13,
    color: "#b45309",
    marginTop: 8,
    backgroundColor: "#fef3c7",
    padding: 10,
    borderRadius: 8,
    lineHeight: 18,
  },
  autoCalcBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#7c3aed",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#f0eef7",
  },
  autoCalcBtnText: { color: "#7c3aed", fontWeight: "700", fontSize: 14 },
  resetMacrosBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  resetMacrosBtnText: { color: "#333", fontWeight: "600", fontSize: 15 },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: "#666", fontSize: 15 },
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
  // Body photos section: small thumbnail row when a photo is set; dashed
  // tap-target card when empty. Same Flux palette as the rest of Settings.
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e7e3f2",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#faf9fd",
    marginTop: 6,
  },
  photoThumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: "#eee" },
  photoActions: { flex: 1, gap: 8 },
  photoBtn: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  photoBtnText: { color: "#333", fontSize: 14, fontWeight: "600" },
  photoBtnDanger: { borderColor: "#dc2626" },
  photoBtnDangerText: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  photoEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cfc8e0",
    borderRadius: 12,
    paddingVertical: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#faf9fd",
    marginTop: 6,
  },
  photoEmptyText: { color: "#7c3aed", fontWeight: "600", fontSize: 14 },
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
  dangerZone: {
    marginTop: 40,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  resetBtn: {
    borderWidth: 1,
    borderColor: "#dc2626",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  resetBtnText: { color: "#dc2626", fontSize: 16, fontWeight: "700" },
  resetHint: { fontSize: 13, color: "#999", marginTop: 10, textAlign: "center" },
});
