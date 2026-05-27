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
  Alert,
  Image,
  Modal,
  Keyboard,
  Animated,
  Easing,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  summarizeConversation,
  messagesToFold,
  KEEP_VERBATIM,
  SUMMARY_BATCH,
  ToolRunner,
  LogFoodArgs,
  LogWaterArgs,
  LogCheckinArgs,
  LogWorkoutArgs,
  AdjustDayArgs,
  MoveDayArgs,
  RememberFactArgs,
  ForgetFactArgs,
  SetTargetsArgs,
} from "../lib/coach";
import { computeTargets, targetsFloorCalories, recomputeMacrosFromCalories } from "../lib/targets";
import { addMemory, removeMemory } from "../lib/memory";
import { weekdayKey } from "../lib/plan";
import { detectCrisisLanguage, CRISIS_RESOURCES_MESSAGE } from "../lib/safety";
import { loadChat, saveChat, clearChat } from "../lib/storage";
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

const SUGGESTED = ["What should I eat?", "How am I doing today?"];

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

// Classic three-dot "Coach is typing" indicator — rendered inside an assistant
// bubble so it reads as an in-progress message (iMessage/WhatsApp/Slack pattern).
// Each dot rises slightly and pulses opacity; the three are staggered so they
// cycle in sequence (dot 1 -> 2 -> 3 -> repeat), each cycle ~1.0s total.
// Pure RN Animated (no dependency). Loops are stopped on unmount in the effect
// cleanup so we don't leak animation drivers if the indicator unmounts mid-cycle.
function TypingDots() {
  // One progress value per dot, animated 0 -> 1 -> 0 on a 1s loop. We start the
  // three loops with staggered delays (0, 200, 400ms) so the dots cycle in
  // sequence instead of pulsing together. translateY and opacity are derived
  // from the same value via interpolate to keep them in lockstep per dot.
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (v: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: 500,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: 500,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
    const loops = [makeLoop(a), makeLoop(b), makeLoop(c)];
    // Stagger the starts so the dots cycle in sequence (1 -> 2 -> 3 -> repeat).
    // setTimeout handles are tracked so we can clear any that haven't fired yet
    // when this component unmounts mid-stagger (e.g. reply lands in <400ms).
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    loops[0].start();
    timeouts.push(setTimeout(() => loops[1].start(), 200));
    timeouts.push(setTimeout(() => loops[2].start(), 400));
    return () => {
      timeouts.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [a, b, c]);

  const dotStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
    ],
  });

  return (
    <View style={[styles.bubble, styles.coachBubble, styles.typingBubble]}>
      <View style={styles.typingRow}>
        <Animated.View style={[styles.typingDot, dotStyle(a)]} />
        <Animated.View style={[styles.typingDot, dotStyle(b)]} />
        <Animated.View style={[styles.typingDot, dotStyle(c)]} />
      </View>
    </View>
  );
}

export default function CoachScreen({
  profile,
  updateProfile,
  onOpenSettings,
}: {
  profile: Profile;
  // Single shared updater (App.tsx). Tool handlers route their PROFILE writes
  // through this so the Coach and every screen share ONE latest-profile source —
  // the whole point of the fix. It returns the next profile so a handler can
  // read the freshly-summed totals to echo back to the model.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  onOpenSettings: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [scanning, setScanning] = useState(false);
  // Hide the suggested-prompt chips while the input is focused so the keyboard
  // doesn't crowd the screen; they reappear on blur (keyboard dismissed).
  const [inputFocused, setInputFocused] = useState(false);
  // Also hide the chips while the user has scrolled up to read history; they
  // reappear once they're back near the bottom of the chat. Default true so the
  // chips show on open (we start scrolled to the latest message).
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  // The Coach screen lives inside App's SafeAreaView (edges top+bottom), which
  // already reserves the top inset ABOVE this KeyboardAvoidingView. With
  // behavior="padding", iOS measures the view's screen position to size the
  // padding, so we offset by the top inset to keep the input row exactly above
  // the keyboard. The custom tab bar sits BELOW our SafeAreaView, so it doesn't
  // add to this offset.
  const insets = useSafeAreaInsets();

  // Always-current view of `messages`, so append-and-persist paths can build on
  // the latest list (not a stale render closure) before calling saveChat. Mirrors
  // the profileRef pattern below. Updated via appendMessages on every change.
  const messagesRef = useRef<ChatMessage[]>([]);
  const appendMessages = (next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  };

  // Conversation-continuity state (the rolling summary of messages that have aged
  // out of the last-MAX_HISTORY window the API sees). Held in refs so the send
  // path can read the latest summary synchronously and the (async, non-blocking)
  // summarization pass can build on current values without a stale render closure.
  // Loaded from the persisted ChatStore on open; reset on Clear.
  const summaryRef = useRef("");
  const summarizedCountRef = useRef(0);
  // Guards against two overlapping summarization passes (each is async and folds
  // the same pending range) — only one runs at a time.
  const summarizingRef = useRef(false);

  // After a turn is delivered and saved, fold any aged-out messages into the
  // rolling summary IF enough have accumulated (SUMMARY_BATCH). Runs without
  // blocking her next message. Race-safety: the summary write rebuilds on
  // messagesRef.current (the latest persisted list) and is a single saveChat with
  // the cont payload, so it can't clobber messages that arrived meanwhile. On any
  // error we keep the prior summary and try again next batch (continuity degrades
  // to "last 16 only", never crashes).
  async function maybeSummarize() {
    if (summarizingRef.current) return;
    const all = messagesRef.current;
    const toFold = messagesToFold(
      all.length,
      summarizedCountRef.current,
      KEEP_VERBATIM,
      SUMMARY_BATCH
    );
    if (toFold <= 0) return;
    summarizingRef.current = true;
    try {
      const start = summarizedCountRef.current;
      const batch = all.slice(start, start + toFold);
      const merged = await summarizeConversation(summaryRef.current, batch);
      // null = the summarizer produced no new summary (empty/failed extraction).
      // Do NOT advance summarizedCount or change the summary in that case, so this
      // batch is retried next time rather than being marked folded into a summary
      // that never actually included it. Empty extraction is rare, so retry is fine.
      if (merged == null) return;
      // Update the refs FIRST (synchronous source of truth), then persist with
      // exactly those values — no read-modify-write, so a concurrent message save
      // can't regress the summary (Fix A).
      summaryRef.current = merged;
      summarizedCountRef.current = start + toFold;
      // Persist the updated summary alongside the CURRENT message list (the ref,
      // which already includes anything appended while we were summarizing).
      await saveChat(messagesRef.current, {
        summary: summaryRef.current,
        summarizedCount: summarizedCountRef.current,
      });
    } catch {
      // Keep the prior summary + count; the next batch retries the same range.
    } finally {
      summarizingRef.current = false;
    }
  }

  // Latest profile, available synchronously when we build the per-turn context
  // for askCoach (it can lag the prop by a render, but the tool ECHOES return the
  // exact code-summed totals, so the model still gets accurate numbers mid-turn).
  // PROFILE WRITES no longer happen here — they go through the shared
  // updateProfile (App.tsx), which composes them on App's single latest-profile
  // ref. This ref is read-only context; it must never be the write source again.
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Recompute "is the chat near its bottom?" from a scroll event and update
  // atBottom only when the boolean actually flips (avoids a setState on every
  // throttled scroll frame). A small threshold treats "almost at the end" as
  // bottom, so the chips don't flicker on tiny over-scroll/bounce.
  const NEAR_BOTTOM = 48;
  const updateAtBottom = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
    setAtBottom((prev) => (prev === near ? prev : near));
  };

  // When the keyboard opens, keep the latest message in view. onContentSizeChange
  // doesn't fire on keyboard show (the content height is unchanged), so the list
  // would otherwise stay scrolled where it was and the newest bubble can hide
  // behind the input row. iOS uses keyboardWillShow for a smooth, in-sync scroll.
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(showEvent, () => {
      scrollRef.current?.scrollToEnd({ animated: true });
      // Programmatic scroll-to-end doesn't always emit onScroll, so assert the
      // bottom state directly (chips would otherwise stay hidden if she'd been
      // scrolled up before focusing).
      setAtBottom(true);
    });
    return () => sub.remove();
  }, []);

  // Lets the Coach write food/water she's told about into the structured store.
  // Each call routes its profile write through the shared updateProfile, which
  // applies it to App's LATEST profile (composing with screen writes — no clobber)
  // and returns the next profile. We then read the freshly code-summed totals
  // from that returned profile to report exact numbers back to the model.
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
          // Pass fiber only when the model actually estimated one — preserves
          // the "undefined contributes 0" back-compat in consumedTotals.
          fiber: typeof a.fiber === "number" ? a.fiber : undefined,
        },
        "coach"
      );
      const next = await updateProfile((p) => addEntry(p, entry));
      const t = consumedTotals(next, today);
      return `Logged ${entry.name}${entry.quantityLabel ? ` (${entry.quantityLabel})` : ""}: ${entry.calories} kcal, ${entry.protein}g protein. Today's running total is now ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat, ${t.fiber}g fiber.`;
    }
    if (name === "log_water") {
      const a = input as LogWaterArgs;
      const cups = Math.max(0, Math.round(a.cups || 0));
      const next = await updateProfile((p) => addWater(p, today, cups));
      return `Logged ${cups} cup${cups === 1 ? "" : "s"} of water. Today: ${waterFor(next, today)} of ${WATER_GOAL_CUPS} cups.`;
    }
    if (name === "log_checkin") {
      const a = input as LogCheckinArgs;
      const date = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : today;
      // The merged day entry is computed INSIDE the transform from the latest
      // p.dayLogs, so a concurrent dayLogs write (e.g. from the Cycle tab) isn't
      // clobbered. We capture it here for the echo below.
      let entry: DayLog = { date };
      const union = (prev: string[] | undefined, add?: string[]) =>
        Array.from(new Set([...(prev ?? []), ...((add ?? []).map((s) => s.trim()).filter(Boolean))]));
      await updateProfile((p) => {
        const logs = { ...(p.dayLogs ?? {}) };
        entry = { ...(logs[date] ?? { date }), date };

        if (a.flow === "none") delete entry.flow;
        else if (a.flow && ["spotting", "light", "medium", "heavy"].includes(a.flow))
          entry.flow = a.flow as Flow;
        if (a.energy && ["low", "medium", "high"].includes(a.energy))
          entry.energy = a.energy as EnergyLevel;

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

        const starts = cycleStarts({ ...p, dayLogs: logs });
        return {
          ...p,
          dayLogs: logs,
          lastPeriodStart: starts.length ? starts[starts.length - 1] : "",
        };
      });

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
      // Weight is a stable profile field — reading it from the prop ref is fine.
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
      await updateProfile((p) => addWorkout(p, entry));
      const burnNote = entry.caloriesBurned
        ? `, ~${entry.caloriesBurned} cal burned${entry.burnSource === "estimate" ? " (est.)" : ""}`
        : "";
      return `Logged workout${date === today ? "" : ` for ${date}`}: ${workoutLabel(entry)}${burnNote}.`;
    }
    if (name === "adjust_workout_day") {
      const a = input as AdjustDayArgs;
      if (!profileRef.current.plan?.current)
        return "There's no active plan to adjust — she can create one on the Workout tab.";
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
      // Map the day into the LATEST plan inside the transform (no-op if the plan
      // was cleared concurrently), so this composes with other plan writes.
      await updateProfile((p) => {
        const cur = p.plan?.current;
        if (!cur) return p;
        const days = cur.days.map((d) => (d.weekday === wd ? day : d));
        return { ...p, plan: { ...p.plan!, current: { ...cur, days } } };
      });
      const dayName = wd === weekdayKey() ? "today" : WEEKDAY_LABELS[wd];
      return `Updated ${dayName}'s workout to "${day.title}" (${day.intensity}). It's on her Plan tab to check off.`;
    }
    if (name === "move_workout_day") {
      const a = input as MoveDayArgs;
      const cur = profileRef.current.plan?.current;
      if (!cur) return "There's no active plan to reschedule.";
      if (!a.from || !a.to || a.from === a.to) return "I need two different days to move between.";
      const fromArg = a.from;
      const toArg = a.to;
      const from = cur.days.find((d) => d.weekday === fromArg);
      const to = cur.days.find((d) => d.weekday === toArg);
      if (!from || !to) return "Couldn't find those days in the plan.";
      // Swap the two days' contents, keeping their weekday slots; clear completion
      // (rescheduled = not done yet) on the day and its exercises.
      const place = (slot: PlanDay, src: PlanDay): PlanDay => ({
        ...src,
        weekday: slot.weekday,
        loggedEntryId: undefined,
        sections: src.sections?.map((s) => ({
          ...s,
          exercises: s.exercises.map((e) => ({ ...e, done: undefined })),
        })),
      });
      // Apply the swap against the LATEST plan inside the transform, re-finding
      // the days there so a concurrent plan edit isn't clobbered.
      await updateProfile((p) => {
        const cur2 = p.plan?.current;
        if (!cur2) return p;
        const f = cur2.days.find((d) => d.weekday === fromArg);
        const t = cur2.days.find((d) => d.weekday === toArg);
        if (!f || !t) return p;
        const days = cur2.days.map((d) =>
          d.weekday === fromArg ? place(d, t) : d.weekday === toArg ? place(d, f) : d
        );
        return { ...p, plan: { ...p.plan!, current: { ...cur2, days } } };
      });
      return `Moved ${WEEKDAY_LABELS[a.from]}'s "${from.title}" to ${WEEKDAY_LABELS[a.to]} (and swapped what was on ${WEEKDAY_LABELS[a.to]} back to ${WEEKDAY_LABELS[a.from]}).`;
    }
    if (name === "remember_fact") {
      const a = input as RememberFactArgs;
      const fact = (a.fact ?? "").trim();
      // Lightweight trace so Ting can confirm in Metro logs whether the model
      // actually fires this tool (vs. just saying "I'll remember" in prose).
      console.log("[Coach] remember_fact called:", JSON.stringify(a));
      if (!fact) return "Nothing to remember — no fact given.";
      // addMemory is a no-op on a duplicate (returns the same object), so detect
      // that inside the transform — against the LATEST coachMemory — to report
      // honestly without clobbering a concurrent memory write.
      let wasDuplicate = false;
      await updateProfile((p) => {
        const updated = addMemory(p, fact);
        wasDuplicate = updated === p;
        return updated;
      });
      if (wasDuplicate) return `Already remembered "${fact}".`;
      return `Got it — I'll remember that: "${fact}". (Saved to long-term memory; she can view or delete it in Settings.)`;
    }
    if (name === "forget_fact") {
      const a = input as ForgetFactArgs;
      console.log("[Coach] forget_fact called:", JSON.stringify(a));
      const q = (a.fact ?? "").trim().toLowerCase();
      if (!q) return "Nothing to forget — no fact given.";
      // The match decision must run against the LATEST coachMemory, so we do it
      // inside the transform and capture the outcome for the echo. Only an
      // unambiguous single match deletes; 0 or many -> no-op (return p unchanged).
      // Held in a typed object so the closure mutation survives narrowing.
      const result: { kind: "none" | "many" | "deleted"; text: string } = { kind: "none", text: "" };
      await updateProfile((p) => {
        // Safe match: (1) prefer an exact (case-insensitive) hit; else (2) stored
        // facts whose text CONTAINS the full query. We deliberately do NOT match
        // the q.includes(t) direction: a long forget query that merely contains a
        // short stored fact (e.g. "no dairy") could nuke a real restriction.
        const items = p.coachMemory ?? [];
        const exact = items.find((m) => m.text.trim().toLowerCase() === q);
        const candidates = exact ? [exact] : items.filter((m) => m.text.toLowerCase().includes(q));
        if (candidates.length === 0) {
          result.kind = "none";
          return p;
        }
        if (candidates.length > 1) {
          result.kind = "many";
          return p;
        }
        const match = candidates[0];
        result.kind = "deleted";
        result.text = match.text;
        return removeMemory(p, match.id);
      });
      if (result.kind === "none")
        return `I don't have a saved fact matching "${a.fact}", so nothing to forget.`;
      if (result.kind === "many")
        return `I have a few saved facts that could match "${a.fact}", so I didn't remove anything. Ask her which one to forget.`;
      return `Done — I've forgotten "${result.text}".`;
    }
    if (name === "set_targets") {
      const a = input as SetTargetsArgs;
      // Floor = max(BMR, 1200). Single source of truth shared with Settings.
      const floor = targetsFloorCalories(profileRef.current);
      // REFUSAL: the Coach maintains its own ED_SAFETY_RULES stance even when
      // Settings allows the user to override the floor herself. The user CAN
      // override directly in Settings (after a soft warning + confirm); the
      // Coach cannot. The message points her there if she really wants it.
      if (typeof a.calories === "number" && floor != null && a.calories < floor) {
        return `Refused: cannot set calories below the BMR floor of ${floor} kcal. The user can change it herself in Settings if she really wants.`;
      }
      // Build the new customTargets bundle. The override is all-FIVE-numbers
      // together (calories/protein/carbs/fat/fiber — full granularity, not
      // partial overlay over the formula), so any field she didn't specify is
      // filled from her current effective targets. When ONLY calories was
      // specified, use the formula to auto-distribute the four macros (incl
      // fiber) — this is what the prompt tells the model it can do. Fiber
      // doesn't have a safety floor; only the calorie BMR floor check above
      // applies.
      const current = computeTargets(profileRef.current);
      const calOnly =
        typeof a.calories === "number" &&
        typeof a.protein !== "number" &&
        typeof a.carbs !== "number" &&
        typeof a.fat !== "number" &&
        typeof a.fiber !== "number";
      let next: {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        fiber: number;
      } | null = null;
      if (calOnly) {
        const auto = recomputeMacrosFromCalories(profileRef.current, a.calories!);
        if (!auto) {
          return "Refused: cannot auto-distribute macros without her weight. Ask her to add it in Settings, or give specific macro numbers.";
        }
        next = auto;
      } else {
        // Need a baseline to fill any unspecified fields. Without weight/age
        // on the profile and no full override already, we can't construct a
        // sensible target from a partial spec.
        if (
          !current &&
          (typeof a.protein !== "number" ||
            typeof a.carbs !== "number" ||
            typeof a.fat !== "number" ||
            typeof a.fiber !== "number" ||
            typeof a.calories !== "number")
        ) {
          return "Refused: she hasn't set enough body info (age, height, weight) for me to fill in the rest. Ask her to add it in Settings, or specify all five numbers (calories, protein, carbs, fat, fiber).";
        }
        next = {
          calories: typeof a.calories === "number" ? Math.round(a.calories) : current!.calories,
          protein: typeof a.protein === "number" ? Math.round(a.protein) : current!.protein,
          carbs: typeof a.carbs === "number" ? Math.round(a.carbs) : current!.carbs,
          fat: typeof a.fat === "number" ? Math.round(a.fat) : current!.fat,
          fiber: typeof a.fiber === "number" ? Math.round(a.fiber) : current!.fiber,
        };
      }
      // Second-pass refusal: if any merge produced sub-floor calories (e.g. she
      // specified protein/carbs/fat but the existing calories field somehow
      // ended up under, or the calorie-only auto-distribute rounded under),
      // refuse here too. Defense in depth.
      if (floor != null && next.calories < floor) {
        return `Refused: cannot set calories below the BMR floor of ${floor} kcal. The user can change it herself in Settings if she really wants.`;
      }
      await updateProfile((p) => ({
        ...p,
        customTargets: next!,
        customTargetsSetAt: toISODate(new Date()),
      }));
      return `Updated her targets to ${next.calories} kcal, ${next.protein}g protein, ${next.carbs}g carbs, ${next.fat}g fat, ${next.fiber}g fiber. She can see and edit them in Settings.`;
    }
    return `Unknown tool ${name}.`;
  };

  // On open: load the (persistent) chat. Fire a fresh daily check-in only on a
  // brand-new chat or a new calendar day — appended, never erasing history.
  useEffect(() => {
    let active = true;
    loadChat().then(async (store) => {
      if (!active) return;
      appendMessages(store.messages);
      // Restore the conversation-continuity summary so it enriches the first turn.
      summaryRef.current = store.summary ?? "";
      summarizedCountRef.current = store.summarizedCount ?? 0;
      const isNewDay = store.lastDate !== toISODate(new Date());
      const needKickoff = store.messages.length === 0 || isNewDay;
      if (!needKickoff) {
        setBooting(false);
        return;
      }
      // First-time welcome: ONLY when there's no history at all AND the chat key
      // has never been persisted with a date (lastDate === ""). Both conditions
      // are required so a returning user with an emptied message list (shouldn't
      // happen, but defense in depth) can't trigger the welcome again. The chat
      // key is removed by both clearChat (in-app "Clear") AND clearAllData
      // (Settings "Start over"); after Start-over the user goes back through
      // onboarding, then re-mounts here and gets the full personalized welcome.
      const firstTime = store.messages.length === 0 && !store.lastDate;
      const hadHistory = store.messages.length > 0;
      if (hadHistory) {
        setBooting(false);
        setSending(true);
      }
      try {
        const reply = await coachKickoff(profile, firstTime);
        if (!active) return;
        const appended: ChatMessage[] = [
          ...store.messages,
          { role: "assistant", content: reply, date: toISODate(new Date()) },
        ];
        appendMessages(appended);
        await saveChat(appended, {
          summary: summaryRef.current,
          summarizedCount: summarizedCountRef.current,
        });
      } catch {
        // leave existing messages; she can still type
      } finally {
        if (active) {
          setBooting(false);
          setSending(false);
        }
      }
    }).catch(() => {
      // loadChat already swallows parse errors, but a storage read rejection must
      // never leave the Coach stuck on its boot spinner — clear booting so she can
      // still type even if history couldn't load.
      if (active) setBooting(false);
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
    // Build on the latest list via the ref, and write through appendMessages so
    // messagesRef stays current for any append-and-save path (scan/clear/kickoff).
    const next: ChatMessage[] = [...messagesRef.current, userMsg];
    appendMessages(next);
    setSending(true);
    // Deterministic crisis backstop: if the user's own words contain unambiguous
    // high-risk language, we ALWAYS surface support resources as an extra
    // assistant message, regardless of what the model returns (the model still
    // replies via care-mode; this is the guarantee it never gets missed). Decided
    // from the user text here, appended below alongside the reply in a single
    // save so it can't race the chat-append path.
    const crisis = detectCrisisLanguage(userMsg.content);
    const crisisMsg: ChatMessage[] = crisis
      ? [{ role: "assistant", content: CRISIS_RESOURCES_MESSAGE, date: userMsg.date }]
      : [];
    try {
      const reply = await askCoach(profileRef.current, next, runTool, summaryRef.current);
      const withReply: ChatMessage[] = [
        ...next,
        { role: "assistant", content: reply, date: userMsg.date },
        ...crisisMsg,
      ];
      appendMessages(withReply);
      await saveChat(withReply, {
        summary: summaryRef.current,
        summarizedCount: summarizedCountRef.current,
      });
      // Reply is persisted; now fold older messages into the rolling summary if
      // enough have aged out. Not awaited — it must not add latency to her next
      // message; it persists itself safely (single saveChat on the latest ref).
      void maybeSummarize();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const withErr: ChatMessage[] = [
        ...next,
        {
          role: "assistant",
          content: `Something went wrong reaching the Coach: ${msg}. Check your API key and connection.`,
          date: userMsg.date,
        },
        // Even if the Coach call fails, the deterministic support resources must
        // still appear — that's exactly when the backstop matters most.
        ...crisisMsg,
      ];
      appendMessages(withErr);
      await saveChat(withErr, {
        summary: summaryRef.current,
        summarizedCount: summarizedCountRef.current,
      });
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
    // Don't run while a Coach turn is mid-flight — a multi-step deliver() could
    // still be appending its reply, and we'd race/overwrite it on save.
    if (sending || booting) return;
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
      // Build on the latest list (ref), so a turn that resolved between the guard
      // and here can't be clobbered when we persist.
      const next: ChatMessage[] = [...messagesRef.current, note];
      appendMessages(next);
      await saveChat(next, {
        summary: summaryRef.current,
        summarizedCount: summarizedCountRef.current,
      });
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
    // Same guard as the send/photo buttons: don't wipe history while a Coach
    // turn is still resolving (its reply would land after the wipe).
    if (sending || booting) return;
    Alert.alert(
      "Clear chat?",
      "This deletes your conversation history on this device. Your profile and targets stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            // Re-check the guard: the alert is async, so a turn could have started
            // (and be mid-flight) between tapping Clear and confirming it.
            if (sending || booting) return;
            await clearChat();
            appendMessages([]);
            // Reset the rolling summary too — the thread it summarized is gone.
            summaryRef.current = "";
            summarizedCountRef.current = 0;
            setBooting(true);
            try {
              const reply = await coachKickoff(profile);
              const fresh: ChatMessage[] = [
                { role: "assistant", content: reply, date: toISODate(new Date()) },
              ];
              appendMessages(fresh);
              // The thread was just cleared; the rolling summary is reset too.
              await saveChat(fresh, { summary: "", summarizedCount: 0 });
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
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
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
        onScroll={updateAtBottom}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          // New content (a reply, the kickoff, a cleared+rebooted chat) auto-
          // scrolls to the end, so we're back at the bottom — assert it here
          // since the programmatic scroll may not emit onScroll.
          scrollRef.current?.scrollToEnd({ animated: true });
          setAtBottom(true);
        }}
      >
        {booting && <TypingDots />}
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
        {sending && <TypingDots />}
      </ScrollView>

      {!inputFocused && atBottom && (
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
      )}

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
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
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
  divider: {
    alignSelf: "center",
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
    marginVertical: 12,
  },
  // Typing-dots indicator: a compact assistant bubble (matches coachBubble bg/
  // radius/alignment) with three dots in a row. Slightly tighter vertical
  // padding than a real message bubble so it reads as "composing", not a reply.
  typingBubble: { paddingVertical: 12, paddingHorizontal: 14 },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#999" },
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
