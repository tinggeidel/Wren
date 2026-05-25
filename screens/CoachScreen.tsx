import { Fragment, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { toJpegBase64 } from "../lib/image";
import {
  Profile,
  ChatMessage,
  DayLog,
  Flow,
  EnergyLevel,
  WATER_GOAL_CUPS,
} from "../lib/types";
import { currentPhase, toISODate, cycleStarts } from "../lib/cycle";
import {
  askCoach,
  coachKickoff,
  ToolRunner,
  LogFoodArgs,
  LogWaterArgs,
  LogCheckinArgs,
  LogWorkoutArgs,
  AdjustDayArgs,
  MoveDayArgs,
} from "../lib/coach";
import { weekdayKey } from "../lib/plan";
import { loadChat, saveChat, clearChat, saveProfile } from "../lib/storage";
import {
  makeEntry,
  addEntry,
  addWater,
  consumedTotals,
  waterFor,
  lookupBarcode,
  scaleHit,
  FoodHit,
} from "../lib/food";
import {
  makeWorkout,
  addWorkout,
  expandSets,
  workoutLabel,
  estimateBurn,
  profileWeightKg,
  newId as newWorkoutId,
} from "../lib/workouts";
import { WorkoutEntry, WorkoutExercise, PlanDay, WEEKDAY_LABELS } from "../lib/types";
import BarcodeScanner from "./BarcodeScanner";

const SUGGESTED = ["I had eggs and toast", "What should I eat for dinner?", "How am I doing today?"];

// Friendly label for a day divider.
function formatDayLabel(d: string): string {
  const today = toISODate(new Date());
  if (d === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d === toISODate(y)) return "Yesterday";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function CoachScreen({
  profile,
  onProfileChange,
  onOpenSettings,
}: {
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  onOpenSettings: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [scanning, setScanning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Latest profile, available synchronously inside the tool loop (where several
  // log_food calls may land in one turn before React re-renders).
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Lets the Coach write food/water she's told about into the structured store.
  // Each call mutates the working profile, persists it, and reports the new
  // code-summed totals back to the model.
  const runTool: ToolRunner = async (name, input) => {
    const today = toISODate(new Date());
    if (name === "log_food") {
      const a = input as LogFoodArgs;
      const entry = makeEntry(
        {
          name: a.name,
          quantityLabel: a.quantity,
          calories: a.calories,
          protein: a.protein ?? 0,
          carbs: a.carbs ?? 0,
          fat: a.fat ?? 0,
        },
        "coach"
      );
      const updated = addEntry(profileRef.current, entry);
      profileRef.current = updated;
      await saveProfile(updated);
      onProfileChange(updated);
      const t = consumedTotals(updated, today);
      return `Logged ${entry.name}${entry.quantityLabel ? ` (${entry.quantityLabel})` : ""}: ${entry.calories} kcal, ${entry.protein}g protein. Today's running total is now ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat.`;
    }
    if (name === "log_water") {
      const a = input as LogWaterArgs;
      const cups = Math.max(0, Math.round(a.cups || 0));
      const updated = addWater(profileRef.current, today, cups);
      profileRef.current = updated;
      await saveProfile(updated);
      onProfileChange(updated);
      return `Logged ${cups} cup${cups === 1 ? "" : "s"} of water. Today: ${waterFor(updated, today)} of ${WATER_GOAL_CUPS} cups.`;
    }
    if (name === "log_checkin") {
      const a = input as LogCheckinArgs;
      const date = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : today;
      const logs = { ...(profileRef.current.dayLogs ?? {}) };
      const entry: DayLog = { ...(logs[date] ?? { date }), date };

      if (a.flow === "none") delete entry.flow;
      else if (a.flow && ["spotting", "light", "medium", "heavy"].includes(a.flow))
        entry.flow = a.flow as Flow;
      if (a.energy && ["low", "medium", "high"].includes(a.energy))
        entry.energy = a.energy as EnergyLevel;

      const union = (prev: string[] | undefined, add?: string[]) =>
        Array.from(new Set([...(prev ?? []), ...((add ?? []).map((s) => s.trim()).filter(Boolean))]));
      if (a.moods?.length) entry.moods = union(entry.moods, a.moods);
      if (a.symptoms?.length) entry.symptoms = union(entry.symptoms, a.symptoms);
      if (a.digestion?.length) entry.digestion = union(entry.digestion, a.digestion);
      if (a.note?.trim()) entry.note = entry.note ? `${entry.note}; ${a.note.trim()}` : a.note.trim();

      const meaningful =
        entry.flow ||
        entry.energy ||
        entry.moods?.length ||
        entry.symptoms?.length ||
        entry.digestion?.length ||
        entry.note;
      if (meaningful) logs[date] = entry;
      else delete logs[date];

      const starts = cycleStarts({ ...profileRef.current, dayLogs: logs });
      const updated: Profile = {
        ...profileRef.current,
        dayLogs: logs,
        lastPeriodStart: starts.length ? starts[starts.length - 1] : "",
      };
      profileRef.current = updated;
      await saveProfile(updated);
      onProfileChange(updated);

      const parts: string[] = [];
      if (entry.flow) parts.push(`flow ${entry.flow}`);
      else if (a.flow === "none") parts.push("not a period day");
      if (entry.energy) parts.push(`energy ${entry.energy}`);
      if (entry.symptoms?.length) parts.push(`symptoms ${entry.symptoms.join(", ")}`);
      if (entry.moods?.length) parts.push(`mood ${entry.moods.join(", ")}`);
      if (entry.digestion?.length) parts.push(`digestion ${entry.digestion.join(", ")}`);
      return `Saved her check-in for ${date === today ? "today" : date}: ${
        parts.join("; ") || "noted"
      }. Her Cycle tab and phase are updated.`;
    }
    if (name === "log_workout") {
      const a = input as LogWorkoutArgs;
      const kind = a.kind ?? (a.exercises?.length ? "strength" : a.activity ? "activity" : "strength");
      const date = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : today;

      // Burned: use her watch number if given, else estimate in code from weight.
      const kg = profileWeightKg(profileRef.current);
      const watch = a.caloriesBurned && a.caloriesBurned > 0 ? Math.round(a.caloriesBurned) : null;
      const est = estimateBurn(kind, a.activity, a.durationMin, kg);
      const burn = watch
        ? { caloriesBurned: watch, burnSource: "watch" as const }
        : est != null
          ? { caloriesBurned: est, burnSource: "estimate" as const }
          : {};
      const hr = {
        avgHr: a.avgHr && a.avgHr > 0 ? Math.round(a.avgHr) : undefined,
        maxHr: a.maxHr && a.maxHr > 0 ? Math.round(a.maxHr) : undefined,
      };

      let entry: WorkoutEntry;
      if (kind === "strength") {
        const exercises: WorkoutExercise[] = (a.exercises ?? [])
          .filter((e) => e.name?.trim())
          .map((e) => ({
            id: newWorkoutId(),
            name: e.name.trim(),
            sets: expandSets(e.sets ?? 1, e.reps ?? 0, e.weight),
          }));
        if (!exercises.length) return "I didn't catch the exercises — tell me what you did.";
        entry = makeWorkout(
          { kind: "strength", exercises, durationMin: a.durationMin, ...burn, ...hr, note: a.note, date },
          "coach"
        );
      } else {
        entry = makeWorkout(
          {
            kind: "activity",
            activity: a.activity?.trim() || "Workout",
            durationMin: a.durationMin,
            distance: a.distance?.trim() || undefined,
            ...burn,
            ...hr,
            note: a.note,
            date,
          },
          "coach"
        );
      }
      const updated = addWorkout(profileRef.current, entry);
      profileRef.current = updated;
      await saveProfile(updated);
      onProfileChange(updated);
      const burnNote = entry.caloriesBurned
        ? `, ~${entry.caloriesBurned} cal burned${entry.burnSource === "estimate" ? " (est.)" : ""}`
        : "";
      return `Logged workout${date === today ? "" : ` for ${date}`}: ${workoutLabel(entry)}${burnNote}.`;
    }
    if (name === "adjust_workout_day") {
      const a = input as AdjustDayArgs;
      const cur = profileRef.current.plan?.current;
      if (!cur) return "There's no active plan to adjust — she can create one on the Workout tab.";
      const wd = a.weekday ?? weekdayKey();
      const kind = a.kind ?? (a.exercises?.length ? "strength" : a.activity ? "activity" : "rest");
      const day: PlanDay = {
        weekday: wd,
        kind,
        title: a.title?.trim() || (kind === "rest" ? "Rest" : "Workout"),
        intensity: a.intensity ?? (kind === "rest" ? "rest" : "moderate"),
        durationMin: a.durationMin,
        note: a.note,
        sections:
          kind === "strength" && a.exercises?.length
            ? [
                {
                  name: "Workout",
                  exercises: a.exercises
                    .filter((e) => e.name?.trim())
                    .map((e) => ({
                      id: newWorkoutId(),
                      name: e.name.trim(),
                      sets: e.sets,
                      reps: e.reps,
                      weight: e.weight,
                      note: e.note,
                    })),
                },
              ]
            : undefined,
        activity: kind === "activity" ? a.activity?.trim() || a.title?.trim() : undefined,
      };
      const days = cur.days.map((d) => (d.weekday === wd ? day : d));
      const updated: Profile = {
        ...profileRef.current,
        plan: { ...profileRef.current.plan!, current: { ...cur, days } },
      };
      profileRef.current = updated;
      await saveProfile(updated);
      onProfileChange(updated);
      const dayName = wd === weekdayKey() ? "today" : WEEKDAY_LABELS[wd];
      return `Updated ${dayName}'s workout to "${day.title}" (${day.intensity}). It's on her Plan tab to check off.`;
    }
    if (name === "move_workout_day") {
      const a = input as MoveDayArgs;
      const cur = profileRef.current.plan?.current;
      if (!cur) return "There's no active plan to reschedule.";
      if (!a.from || !a.to || a.from === a.to) return "I need two different days to move between.";
      const from = cur.days.find((d) => d.weekday === a.from);
      const to = cur.days.find((d) => d.weekday === a.to);
      if (!from || !to) return "Couldn't find those days in the plan.";
      // Swap the two days' contents, keeping their weekday slots; clear completion
      // (rescheduled = not done yet) on the day and its exercises.
      const place = (slot: PlanDay, src: PlanDay): PlanDay => ({
        ...src,
        weekday: slot.weekday,
        loggedEntryId: undefined,
        sections: src.sections?.map((s) => ({
          ...s,
          exercises: s.exercises.map((e) => ({ ...e, done: undefined, loggedEntryId: undefined })),
        })),
      });
      const days = cur.days.map((d) =>
        d.weekday === a.from ? place(d, to) : d.weekday === a.to ? place(d, from) : d
      );
      const updated: Profile = {
        ...profileRef.current,
        plan: { ...profileRef.current.plan!, current: { ...cur, days } },
      };
      profileRef.current = updated;
      await saveProfile(updated);
      onProfileChange(updated);
      return `Moved ${WEEKDAY_LABELS[a.from]}'s "${from.title}" to ${WEEKDAY_LABELS[a.to]} (and swapped what was on ${WEEKDAY_LABELS[a.to]} back to ${WEEKDAY_LABELS[a.from]}).`;
    }
    return `Unknown tool ${name}.`;
  };

  // On open: load the (persistent) chat. Fire a fresh daily check-in only on a
  // brand-new chat or a new calendar day — appended, never erasing history.
  useEffect(() => {
    let active = true;
    loadChat().then(async (store) => {
      if (!active) return;
      setMessages(store.messages);
      const isNewDay = store.lastDate !== toISODate(new Date());
      const needKickoff = store.messages.length === 0 || isNewDay;
      if (!needKickoff) {
        setBooting(false);
        return;
      }
      const hadHistory = store.messages.length > 0;
      if (hadHistory) {
        setBooting(false);
        setSending(true);
      }
      try {
        const reply = await coachKickoff(profile);
        if (!active) return;
        const appended: ChatMessage[] = [
          ...store.messages,
          { role: "assistant", content: reply, date: toISODate(new Date()) },
        ];
        setMessages(appended);
        await saveChat(appended);
      } catch {
        // leave existing messages; she can still type
      } finally {
        if (active) {
          setBooting(false);
          setSending(false);
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const phase = currentPhase(profile);
  const phaseLabel = phase.onBirthControl
    ? "On birth control"
    : phase.dayOfCycle
      ? `${phase.phase} · day ${phase.dayOfCycle}`
      : "Cycle not set";

  // Append a user message, get the Coach's reply (which may log food/water/cycle
  // or read a photo via tools), and persist.
  async function deliver(userMsg: ChatMessage) {
    if (sending || booting) return;
    const next: ChatMessage[] = [...messages, userMsg];
    setMessages(next);
    setSending(true);
    try {
      const reply = await askCoach(profileRef.current, next, runTool);
      const withReply: ChatMessage[] = [
        ...next,
        { role: "assistant", content: reply, date: userMsg.date },
      ];
      setMessages(withReply);
      await saveChat(withReply);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const withErr: ChatMessage[] = [
        ...next,
        {
          role: "assistant",
          content: `Something went wrong reaching the Coach: ${msg}. Check your API key and connection.`,
          date: userMsg.date,
        },
      ];
      setMessages(withErr);
      await saveChat(withErr);
    } finally {
      setSending(false);
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || sending || booting) return;
    setInput("");
    deliver({ role: "user", content, date: toISODate(new Date()) });
  }

  function addPhoto() {
    if (sending || booting) return;
    Alert.alert("Add food", "Snap your meal, a nutrition label, scan a barcode, or pick a photo.", [
      { text: "Take food photo", onPress: () => launchPhoto("camera", "meal") },
      { text: "Scan nutrition label", onPress: () => launchPhoto("camera", "label") },
      { text: "Scan barcode", onPress: () => setScanning(true) },
      { text: "Choose from library", onPress: () => launchPhoto("library", "auto") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  // Scan a barcode in chat: look it up in OFF, then let the Coach log the exact
  // label numbers (and respond) — or say it isn't in the database.
  async function handleCoachScan(code: string) {
    setScanning(false);
    let hit: FoodHit | null = null;
    try {
      hit = await lookupBarcode(code);
    } catch {
      hit = null;
    }
    if (!hit || !hit.per100g) {
      const note: ChatMessage = {
        role: "assistant",
        content: `I couldn't find barcode ${code} in the food database. Tell me what it was and I'll log it, or add it on the Food tab.`,
        date: toISODate(new Date()),
      };
      const next = [...messages, note];
      setMessages(next);
      await saveChat(next);
      return;
    }
    const grams = hit.serving?.grams ?? 100;
    const m = scaleHit(hit, grams);
    const label = hit.serving?.label || `${grams} g`;
    deliver({
      role: "user",
      content: `I scanned ${hit.name}${hit.brand ? ` (${hit.brand})` : ""}. The label says about ${m.calories} cal, ${m.protein}g protein, ${m.carbs}g carbs, ${m.fat}g fat per ${label}. Log it for me (one serving unless I say otherwise).`,
      date: toISODate(new Date()),
    });
  }

  async function launchPhoto(source: "camera" | "library", kind: "meal" | "label" | "auto" = "auto") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Allow camera access to snap a meal or label.");
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
      deliver({
        role: "user",
        content:
          kind === "label"
            ? "Here's a nutrition label — read the exact numbers and log it for me."
            : "Here's a photo — estimate it and log it for me.",
        date: toISODate(new Date()),
        imageUri: asset.uri,
        imageBase64: base64,
      });
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  function handleClear() {
    Alert.alert(
      "Clear chat?",
      "This deletes your conversation history on this device. Your profile and targets stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearChat();
            setMessages([]);
            setBooting(true);
            try {
              const reply = await coachKickoff(profile);
              const fresh: ChatMessage[] = [
                { role: "assistant", content: reply, date: toISODate(new Date()) },
              ];
              setMessages(fresh);
              await saveChat(fresh);
            } catch {
              // ignore
            } finally {
              setBooting(false);
            }
          },
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Coach</Text>
          <Text style={styles.headerSub}>{phaseLabel}</Text>
        </View>
        <View style={styles.headerLinks}>
          <TouchableOpacity onPress={handleClear} disabled={sending || booting}>
            <Text style={styles.headerLink}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenSettings}>
            <Text style={styles.headerLink}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {booting && (
          <View style={styles.booting}>
            <ActivityIndicator />
            <Text style={styles.bootingText}>Setting up your day…</Text>
          </View>
        )}
        {!booting && messages.length === 0 && (
          <Text style={styles.empty}>
            Hi{profile.name ? ` ${profile.name}` : ""}! Tell me what you ate, ask what to make for
            dinner, or ask how today is going.
          </Text>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDivider = !!m.date && m.date !== prev?.date;
          return (
            <Fragment key={i}>
              {showDivider && <Text style={styles.divider}>{formatDayLabel(m.date!)}</Text>}
              <View
                style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.coachBubble]}
              >
                {m.imageUri ? (
                  <Image source={{ uri: m.imageUri }} style={styles.bubbleImage} resizeMode="cover" />
                ) : null}
                {m.content ? (
                  <Text style={m.role === "user" ? styles.userText : styles.coachText}>
                    {m.content}
                  </Text>
                ) : null}
              </View>
            </Fragment>
          );
        })}
        {sending && <ActivityIndicator style={styles.spinner} />}
      </ScrollView>

      <View style={styles.suggestRow}>
        {SUGGESTED.map((s) => (
          <TouchableOpacity
            key={s}
            style={styles.chip}
            onPress={() => send(s)}
            disabled={sending || booting}
          >
            <Text style={styles.chipText}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.inputRow}>
        <TouchableOpacity
          style={styles.photoBtn}
          onPress={addPhoto}
          disabled={sending || booting}
        >
          <Text style={styles.photoBtnIcon}>📷</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message your Coach…"
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={() => send(input)}
          disabled={sending || booting}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <BarcodeScanner onScanned={handleCoachScan} onClose={() => setScanning(false)} />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: { fontSize: 20, fontWeight: "700" },
  headerSub: { fontSize: 13, color: "#7c3aed", marginTop: 2, textTransform: "capitalize" },
  headerLinks: { flexDirection: "row", gap: 18 },
  headerLink: { fontSize: 15, color: "#7c3aed", fontWeight: "600" },
  messages: { padding: 16, paddingBottom: 8 },
  empty: { color: "#666", fontSize: 15, lineHeight: 22, marginTop: 8 },
  booting: { paddingVertical: 28, alignItems: "center", gap: 10 },
  bootingText: { color: "#666", fontSize: 14 },
  divider: {
    alignSelf: "center",
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
    marginVertical: 12,
  },
  spinner: { marginTop: 10, alignSelf: "flex-start" },
  bubbleImage: { width: 200, height: 200, borderRadius: 12, marginBottom: 6 },
  photoBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#f0eef7",
    alignItems: "center",
    justifyContent: "center",
  },
  photoBtnIcon: { fontSize: 20 },
  bubble: {
    maxWidth: "85%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#7c3aed" },
  coachBubble: { alignSelf: "flex-start", backgroundColor: "#f0eef7" },
  userText: { color: "#fff", fontSize: 16, lineHeight: 22 },
  coachText: { color: "#1a1a1a", fontSize: 16, lineHeight: 22 },
  suggestRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  chip: { backgroundColor: "#f0eef7", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: "#7c3aed", fontSize: 13, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: "#7c3aed",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
