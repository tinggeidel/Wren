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
} from "react-native";
import Svg, { Path, Circle, Rect } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, type, spacing, radius } from "../lib/theme";
import { toJpegBase64 } from "../lib/image";
import {
  Profile,
  ChatMessage,
  CoachCard,
  CoachFoodCard,
  DayLog,
  Flow,
  EnergyLevel,
  SavedFood,
  FoodEntry,
  Macros,
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
  EditFoodArgs,
  LogWaterArgs,
  LogCheckinArgs,
  LogWorkoutArgs,
  AdjustDayArgs,
  MoveDayArgs,
  ShiftPlanArgs,
  RememberFactArgs,
  ForgetFactArgs,
  SetTargetsArgs,
  MarkBfTrendArgs,
  SuggestMealArgs,
} from "../lib/coach";
import { computeTargets, targetsFloorCalories, recomputeMacrosFromCalories } from "../lib/targets";
import { addMemory, removeMemory } from "../lib/memory";
import {
  weekdayKey,
  dayExercises,
  planDayChanged,
  mergePlanDay,
  dateForWeekday,
  shiftWeekDays,
} from "../lib/plan";
import { detectCrisisLanguage, CRISIS_RESOURCES_MESSAGE } from "../lib/safety";
import { loadChat, saveChat, clearChat } from "../lib/storage";
import { stripChatFormatting } from "../lib/text";
import {
  makeEntry,
  addEntry,
  updateEntry,
  entriesFor,
  addWater,
  consumedTotals,
  waterFor,
  lookupBarcode,
  scaleHit,
  rescaleMacrosForQuantity,
  FoodHit,
  toSavedFood,
  saveFood,
  findSavedFood,
} from "../lib/food";
import {
  makeWorkout,
  addWorkout,
  redateWorkoutEntry,
  expandSets,
  workoutLabel,
  resolveWorkoutBurn,
  profileWeightKg,
  newId as newWorkoutId,
} from "../lib/workouts";
import {
  WorkoutEntry,
  WorkoutExercise,
  PlanDay,
  PlanExercise,
  CoachPlanChangeCard,
  CoachPlanShiftCard,
  WEEKDAY_LABELS,
  WEEKDAYS,
  Weekday,
} from "../lib/types";
import BarcodeScanner from "./BarcodeScanner";

// PRIVACY: the single friendly line shown (and persisted) when a Coach request
// fails. Kept at module scope so the live error path and the load-time scrub
// migration write byte-identical text.
const COACH_CONNECT_ERROR =
  "I'm having trouble connecting right now — give it a moment and try again.";
// Legacy bubbles persisted by the old catch interpolated the raw API error after
// this prefix — for a 429 that leaked the org UUID + console/billing URLs into
// stored chat history. We rewrite any message starting with it on load.
const LEAKY_ERROR_PREFIX = "Something went wrong reaching the Coach:";

// One-time, idempotent scrub of already-persisted error leaks. Any assistant
// message whose content starts with the old leak prefix is rewritten to the
// fixed friendly line; everything else (including already-friendly messages) is
// returned untouched, so re-running this is a no-op. Returns the same array
// reference when nothing changed, so callers can cheaply skip a re-save.
function scrubLeakedErrors(messages: ChatMessage[]): ChatMessage[] {
  let changed = false;
  const out = messages.map((m) => {
    if (m.role === "assistant" && m.content.startsWith(LEAKY_ERROR_PREFIX)) {
      changed = true;
      return { ...m, content: COACH_CONNECT_ERROR };
    }
    return m;
  });
  return changed ? out : messages;
}

// CONFABULATION GUARD (workout-trust Stage 1): compute the exercise-level diff
// between a plan day BEFORE a write and the same slot AFTER the write. Operates
// on the REAL saved days (never the model's tool args). Compares exercise NAMES
// (case-insensitive, trimmed) for added/removed/kept counts, and reports whether
// any previously-`done` exercise lost its done flag (completion preserved?). A
// missing pre or post day is treated as an empty exercise list.
function planDiff(
  before: PlanDay | undefined,
  after: PlanDay | undefined
): { added: number; removed: number; kept: number; completionPreserved: boolean } {
  const norm = (n: string) => n.trim().toLowerCase();
  const beforeEx = before ? dayExercises(before) : [];
  const afterEx = after ? dayExercises(after) : [];
  const beforeNames = new Set(beforeEx.map((e) => norm(e.name)));
  const afterNames = new Set(afterEx.map((e) => norm(e.name)));
  let added = 0;
  let kept = 0;
  afterNames.forEach((n) => (beforeNames.has(n) ? (kept += 1) : (added += 1)));
  let removed = 0;
  beforeNames.forEach((n) => (afterNames.has(n) ? null : (removed += 1)));
  // Completion is preserved when every exercise that was `done` before is still
  // present AND still marked done after. Any checked-off exercise whose done flag
  // is missing after the write (the destructive full-replace drops them) = false.
  const afterDoneNames = new Set(afterEx.filter((e) => e.done).map((e) => norm(e.name)));
  const completionPreserved = beforeEx
    .filter((e) => e.done)
    .every((e) => afterDoneNames.has(norm(e.name)));
  return { added, removed, kept, completionPreserved };
}

// CONFABULATION DETECTOR (post-turn safety net). Returns true only when the
// reply contains a sentence that BOTH (a) uses a change verb and (b) names a
// plan/workout-specific noun in that SAME sentence — i.e. an actual claim that
// the training plan was edited. Intentionally biased toward false negatives:
// the authoritative PLAN UPDATED card and the system-prompt bullet are the
// primary defenses, so it is far better to miss a confabulation than to wrongly
// contradict a correct reply (e.g. a set_targets turn that merely mentions
// "tomorrow's workout"). Sentences about targets/macros/food/water are excluded
// because those legitimately produce no plan card (they use food cards or none).
const CHANGE_VERB = /\b(updated?|moved?|pushed?|shifted?|rebuil[dt]|swapp?ed|reschedul(?:ed|e)|chang(?:ed|e))\b/i;
const PLAN_NOUN = /\b(plan|workout|training|session|rest day|leg day|lift|lifting)\b/i;
// Target/macro/food/water context — if present in the matched sentence, the
// change-verb is about something legitimately card-less or food-carded.
const TARGET_FOOD_CONTEXT =
  /\b(target|calorie|protein|macro|carb|fat|water|meal|snack|breakfast|lunch|dinner)\b/i;

function claimsPlanChange(reply: string): boolean {
  // Split into rough sentences/clauses so the verb and noun must co-occur in the
  // same unit, not anywhere-in-reply. Em dashes and semicolons split clauses too,
  // since the Coach often joins a targets update and a workout aside with "—".
  const sentences = reply.split(/(?:[.!?\n]+|\s—\s|;)/);
  return sentences.some((s) => {
    if (TARGET_FOOD_CONTEXT.test(s)) return false;
    return CHANGE_VERB.test(s) && PLAN_NOUN.test(s);
  });
}

const SUGGESTED = [
  "how does wren actually work?",
  "what's the cycle stuff?",
  "I just want to talk.",
];

// Camera outline for the input-bar left affordance. Matches the mockup's clay
// (inkMuted) stroke treatment; drawn with react-native-svg like FoodScreen's
// icons (no new icon dependency).
function CameraIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 18" fill="none">
      <Rect x={1} y={4} width={20} height={13} rx={2.5} stroke={colors.inkMuted} strokeWidth={1.5} />
      <Circle cx={11} cy={10.5} r={3.5} stroke={colors.inkMuted} strokeWidth={1.5} />
      <Path d="M7 4 L8.5 1.5 L13.5 1.5 L15 4" stroke={colors.inkMuted} strokeWidth={1.5} strokeLinejoin="round" />
    </Svg>
  );
}

// Up-arrow glyph for the circular send button — cream (surface) stroke on the
// cocoa circle, per the mockup. Replaces the prior "Send" text label.
function SendArrowIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 19 L12 5 M5 12 L12 5 L19 12"
        stroke={colors.surface}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Thin right-pointing arrow for the suggested-prompt list rows — warm camel/tan
// (handle) stroke, same hairline weight as the camera/send glyphs. Replaces the
// prior pill chips per the mockup's left-aligned vertical list.
function ArrowRightIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 12 L20 12 M14 6 L20 12 L14 18"
        stroke={colors.inkMuted}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

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
  clearSignal,
  adjustRequest,
}: {
  profile: Profile;
  // Single shared updater (App.tsx). Tool handlers route their PROFILE writes
  // through this so the Coach and every screen share ONE latest-profile source —
  // the whole point of the fix. It returns the next profile so a handler can
  // read the freshly-summed totals to echo back to the model.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  onOpenSettings: () => void;
  // Reboot trigger from the "Clear chat history" action that now lives in
  // Settings. CoachScreen stays MOUNTED across tab switches (App hides inactive
  // tabs rather than unmounting them), so the on-mount kickoff effect can't
  // re-fire after a Settings-side clear. App bumps this counter when the user
  // clears from Settings; the effect below watches it and runs the SAME
  // clear+reboot flow as the in-Coach handler used to, so the Coach always
  // shows a fresh kickoff (never an empty screen). A counter (not a boolean)
  // so repeated clears always refire the effect.
  clearSignal: number;
  // Set when a Workout day card's "Or ask your Coach to adjust your plan →" link
  // is tapped (App routes the tab here AND bumps this). Carries the tapped day's
  // real date + a human label so we can inject a day-specific CANNED opener
  // ("What would you like to change about Thursday, May 7's workout?"). Nonce'd
  // so re-tapping the same day re-fires; the effect below tracks the last-seen
  // nonce in a ref so the opener appends ONCE per tap (not on every render) and
  // never on a normal Coach-tab open (null / unchanged nonce). The opener is a
  // deterministic template — no Anthropic call. Her REPLY then flows through the
  // normal askCoach turn (full system prompt + ED-safety + tools + plan context).
  adjustRequest?: { dateISO: string; label: string; nonce: number } | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [scanning, setScanning] = useState(false);
  // BARCODE RE-ENTRANCY: expo-camera fires onBarcodeScanned continuously while a
  // code is in frame, so a single physical scan can deliver a burst of callbacks
  // before React state (sending/booting) updates. These refs lock synchronously,
  // independent of render timing, and survive the scanner's unmount (they live
  // here, not in BarcodeScanner). scanBusyRef blocks the burst while one scan is
  // processed; lastScanRef debounces the identical code for ~2.5s so the same
  // barcode can't immediately re-fire, while a DIFFERENT code still gets through.
  const scanBusyRef = useRef(false);
  const lastScanRef = useRef<{ code: string; t: number } | null>(null);
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

  // Editorial data cards (LOGGED / SUGGESTED) accumulated DURING the current turn
  // by runTool, then attached to the assistant message in deliver() once the turn
  // resolves. Reset at the start of every deliver() so cards never bleed between
  // turns. LOGGED cards are built here from log_food args (no prompt change);
  // SUGGESTED cards come from the suggest_meal tool. Held in a ref because runTool
  // is created once per render and must push into the live, latest array.
  const turnCardsRef = useRef<CoachCard[]>([]);

  // Which suggested foods she's already saved this session, keyed by the same
  // name+brand identity findSavedFood/saveFood dedupe on. Drives the pill's
  // "Saved" feedback. Seeded from the profile on save so the state survives a
  // re-render; we also re-check the live profile when rendering (below).
  const [savedCardKeys, setSavedCardKeys] = useState<Set<string>>(new Set());

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

  // When the keyboard opens, keep the latest message in view. onContentSizeChange
  // doesn't fire on keyboard show (the content height is unchanged), so the list
  // would otherwise stay scrolled where it was and the newest bubble can hide
  // behind the input row. iOS uses keyboardWillShow for a smooth, in-sync scroll.
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(showEvent, () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  // Whether to show the "OR ASK ME" suggested-prompt list. It's a first-time /
  // onboarding hint, NOT a persistent affordance: it shows ONLY in the fresh
  // kickoff state (the Coach has greeted but she hasn't engaged yet) and
  // disappears the moment she does. Concretely it's gated on three things, all of
  // which must hold:
  //   - not booting (no half-loaded chat flashing the hint),
  //   - the input box is empty (so the first keystroke hides it immediately, even
  //     before she sends), and
  //   - the conversation has no user message yet (so once she's sent anything it
  //     stays gone for the rest of this conversation — scrolling, blur, or being
  //     at the bottom can't bring it back).
  // After "Clear chat history" the chat reboots to a fresh kickoff with no user
  // messages, so this condition naturally shows the hint again — no special case.
  // It's deliberately independent of scroll position now (the old atBottom gate
  // caused a layout feedback loop and is gone).
  const showSuggestions =
    !booting && input.length === 0 && !messages.some((m) => m.role === "user");

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
      // Client-side LOGGED card — built from the entry we just persisted, no
      // prompt/model involvement. The label is uppercased for the card's
      // editorial slot line (the quantity label if she gave one, else a generic
      // "LOGGED" marker is added by the renderer's prefix). We use the food's
      // quantity label when present as the slot context, else "LOGGED".
      turnCardsRef.current.push({
        kind: "logged",
        label: (entry.quantityLabel || "logged").toUpperCase(),
        name: entry.name,
        calories: entry.calories,
        protein: entry.protein,
        carbs: entry.carbs,
        fat: entry.fat,
        fiber: typeof entry.fiber === "number" ? entry.fiber : undefined,
        brand: entry.brand,
        quantityLabel: entry.quantityLabel,
      });
      return `Logged ${entry.name}${entry.quantityLabel ? ` (${entry.quantityLabel})` : ""}: ${entry.calories} kcal, ${entry.protein}g protein. Today's running total is now ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat, ${t.fiber}g fiber.`;
    }
    if (name === "edit_food") {
      const a = input as EditFoodArgs;
      const q = (a.name ?? "").trim().toLowerCase();
      // CONFABULATION GUARD: edit_food edits ONLY an entry that already exists.
      // If nothing matches, report that plainly and create NOTHING.
      const todays = entriesFor(profileRef.current, today);
      const recentFirst = [...todays].reverse();

      // Word-level fuzzy match (auditor note #1): the old bidirectional substring
      // (`n.includes(q) || q.includes(n)`) could edit the wrong entry — "chicken"
      // silently matched "chicken salad". We require whole-word containment AND
      // that the query includes the entry's HEAD noun (its last word), so "latte"
      // matches "oat milk latte" but "chicken" does NOT match "chicken salad".
      const words = (s: string) =>
        s
          .toLowerCase()
          .split(/[^a-z0-9]+/i)
          .filter(Boolean);
      const qWords = words(q);
      const wordMatch = (name: string): boolean => {
        const nWords = words(name);
        if (!qWords.length || !nWords.length) return false;
        const nSet = new Set(nWords);
        const head = nWords[nWords.length - 1]; // the dish's head noun
        return qWords.every((w) => nSet.has(w)) && qWords.includes(head);
      };

      // Exact whole-name match wins (most recent first). Otherwise fall back to
      // the word-level matcher.
      let match = recentFirst.find((e) => e.name.trim().toLowerCase() === q);
      if (!match) {
        const candidates = recentFirst.filter((e) => wordMatch(e.name));
        const distinctNames = Array.from(
          new Set(candidates.map((e) => e.name.trim()))
        );
        if (distinctNames.length >= 2) {
          // AMBIGUOUS: two+ different foods match. Don't guess — ask, mutate
          // nothing. (Multiple logs of the SAME food aren't ambiguous — we still
          // auto-pick the most recent below.)
          return `A couple of things in today's log could be "${(a.name ?? "").trim()}": ${distinctNames.join(
            ", "
          )}. Which one did you mean?`;
        }
        match = candidates[0]; // exactly one food (0+ entries) or none
      }
      if (!match) {
        return `I don't see "${(a.name ?? "").trim()}" in today's log — want me to add it?`;
      }

      const gaveMacros =
        typeof a.calories === "number" ||
        typeof a.protein === "number" ||
        typeof a.carbs === "number" ||
        typeof a.fat === "number" ||
        typeof a.fiber === "number";
      // Priority: the model's supplied macros win (it computed them for the new
      // portion); else, if only a new quantity was given, rescale in code from
      // the original entry. If neither yields macros, leave the macros untouched
      // (never zero them) and just update the label.
      let macros: Macros | null = null;
      let newLabel = a.quantity?.trim() || match.quantityLabel;
      if (gaveMacros) {
        macros = {
          calories: Math.max(0, Math.round(a.calories ?? match.calories)),
          protein: Math.max(0, Math.round(a.protein ?? match.protein)),
          carbs: Math.max(0, Math.round(a.carbs ?? match.carbs)),
          fat: Math.max(0, Math.round(a.fat ?? match.fat)),
          fiber: Math.max(0, Math.round(a.fiber ?? match.fiber ?? 0)),
        };
      } else if (a.quantity?.trim()) {
        const r = rescaleMacrosForQuantity(match, a.quantity.trim());
        if (r) {
          macros = r.macros;
          // Use the normalized label so a serving edit's "(… g)" tells the truth.
          newLabel = r.label;
        }
      }

      // Preserve the "fiber untracked" back-compat: only carry a fiber number if
      // the original entry had one OR the model supplied one now.
      const keepFiber = typeof match.fiber === "number" || typeof a.fiber === "number";
      const edited: FoodEntry = {
        ...match,
        quantityLabel: newLabel,
        ...(macros
          ? {
              calories: macros.calories,
              protein: macros.protein,
              carbs: macros.carbs,
              fat: macros.fat,
              fiber: keepFiber ? macros.fiber : undefined,
            }
          : {}),
      };
      const next = await updateProfile((p) => updateEntry(p, edited));
      const t = consumedTotals(next, today);
      // Report the REAL post-write state so the model can't confabulate the edit.
      return `Updated ${edited.name}${edited.quantityLabel ? ` (${edited.quantityLabel})` : ""}: ${edited.calories} kcal, ${edited.protein}g protein, ${edited.carbs}g carbs, ${edited.fat}g fat. Today's running total is now ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat, ${t.fiber}g fiber.`;
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

      // Burned: use her watch number if given, else estimate in code from weight
      // via the shared helper (strength sums the logged exercises, else a default
      // duration; activity uses given or default duration) so a Coach-logged
      // workout always lands a number. Weight is a stable profile field — reading
      // it from the prop ref is fine.
      const kg = profileWeightKg(profileRef.current);
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
        const burn = resolveWorkoutBurn({
          kind: "strength",
          durationMin: a.durationMin,
          exercises,
          watchCalories: a.caloriesBurned ?? null,
          weightKg: kg,
        });
        entry = makeWorkout(
          { kind: "strength", exercises, durationMin: a.durationMin, ...burn, ...hr, note: a.note, date },
          "coach"
        );
      } else {
        const burn = resolveWorkoutBurn({
          kind: "activity",
          activity: a.activity,
          durationMin: a.durationMin,
          watchCalories: a.caloriesBurned ?? null,
          weightKg: kg,
        });
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
      const dayName = wd === weekdayKey() ? "today" : WEEKDAY_LABELS[wd];
      // CONFABULATION GUARD: capture the affected day BEFORE the write so we can
      // diff against the day actually saved (not the model's args). If the weekday
      // isn't in the plan at all, tell the model the truth and push no card.
      const beforeDay = profileRef.current.plan?.current?.days.find((d) => d.weekday === wd);
      if (!beforeDay) {
        return `That day (${dayName}) isn't in her current plan.`;
      }
      // Normalize the model's exercises into PlanExercise[] (fresh ids) ONCE, so
      // both the merge and replace paths share the same shape. Undefined means the
      // model named no exercises (a merge then preserves the existing ones).
      const incomingExercises: PlanExercise[] | undefined = a.exercises?.length
        ? a.exercises
            .filter((e) => e.name?.trim())
            .map((e) => ({
              id: newWorkoutId(),
              name: e.name.trim(),
              sets: e.sets,
              // Model sends reps as a number in adjust_workout_day args; PlanExercise.reps
              // is a string. Coerce here exactly like generateWeekPlan does so a numeric
              // reps never reaches planDayChanged's .trim() (the "technical issue" crash).
              reps: e.reps != null ? String(e.reps) : undefined,
              weight: e.weight,
              note: e.note,
            }))
        : undefined;

      // Build the day to save. Default is MERGE — apply only what the model
      // supplied and keep everything it didn't mention (exercises + completion).
      // replace:true rebuilds the day from scratch (old destructive behavior).
      let day: PlanDay;
      if (a.replace) {
        const kind =
          a.kind ?? (incomingExercises?.length ? "strength" : a.activity ? "activity" : "rest");
        day = {
          weekday: wd,
          kind,
          title: a.title?.trim() || (kind === "rest" ? "Rest" : "Workout"),
          intensity: a.intensity ?? (kind === "rest" ? "rest" : "moderate"),
          durationMin: a.durationMin,
          note: a.note,
          sections:
            kind === "strength" && incomingExercises?.length
              ? [{ name: "Workout", exercises: incomingExercises }]
              : undefined,
          activity: kind === "activity" ? a.activity?.trim() || a.title?.trim() : undefined,
          // A fresh rebuild discards prior completion.
          loggedEntryId: undefined,
        };
      } else {
        day = mergePlanDay(beforeDay, {
          title: a.title,
          kind: a.kind,
          intensity: a.intensity,
          durationMin: a.durationMin,
          activity: a.activity,
          note: a.note,
          incomingExercises,
          removeExercises: a.removeExercises,
        });
      }

      // Map the day into the LATEST plan inside the transform (no-op if the plan
      // was cleared concurrently), so this composes with other plan writes.
      const nextProfile = await updateProfile((p) => {
        const cur = p.plan?.current;
        if (!cur) return p;
        const days = cur.days.map((d) => (d.weekday === wd ? day : d));
        return { ...p, plan: { ...p.plan!, current: { ...cur, days } } };
      });
      // Read the day back from the ACTUAL saved profile. The card fires ONLY on a
      // material change (see planDayChanged) — a no-op rewrite must not flash
      // "PLAN UPDATED", and the tool result tells the model the truth so its prose
      // stays honest and the post-turn net doesn't misfire.
      const afterDay = nextProfile.plan?.current?.days.find((d) => d.weekday === wd);
      if (!planDayChanged(beforeDay, afterDay)) {
        return `No change — ${dayName} already looks like that.`;
      }
      // afterDay is defined here (planDayChanged returns false when it isn't).
      const savedDay = afterDay!;
      const diff = planDiff(beforeDay, savedDay);
      const card: CoachPlanChangeCard = {
        kind: "plan_change",
        // Mirror the prose's "today" affordance so card and reply agree when
        // the adjusted day is the current weekday (else show the weekday code).
        dayLabel: wd === weekdayKey() ? "TODAY" : WEEKDAY_LABELS[wd].toUpperCase(),
        oldTitle: beforeDay.title,
        newTitle: savedDay.title,
        ...diff,
      };
      turnCardsRef.current.push(card);
      return `Updated ${dayName}'s workout to "${savedDay.title}" (${savedDay.intensity}). It's on her Plan tab to check off.`;
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
      // Swap the two days' contents, keeping their weekday slots. A reschedule
      // moves the day's content AND its completion to the new slot — we do NOT
      // clear loggedEntryId or the exercises' `done` flags here, so a workout she
      // already checked off rides along to its new day instead of looking undone.
      const place = (slot: PlanDay, src: PlanDay): PlanDay => ({
        ...src,
        weekday: slot.weekday,
      });
      // CONFABULATION GUARD: capture the destination slot BEFORE the write so we
      // can diff it against what actually lands there. The "to" day is where she
      // sees the moved workout arrive, so that's the slot the card summarizes.
      const beforeTo = cur.days.find((d) => d.weekday === toArg);
      // Apply the swap against the LATEST plan inside the transform, re-finding
      // the days there so a concurrent plan edit isn't clobbered.
      const nextProfile = await updateProfile((p) => {
        const cur2 = p.plan?.current;
        if (!cur2) return p;
        const f = cur2.days.find((d) => d.weekday === fromArg);
        const t = cur2.days.find((d) => d.weekday === toArg);
        if (!f || !t) return p;
        const days = cur2.days.map((d) =>
          d.weekday === fromArg ? place(d, t) : d.weekday === toArg ? place(d, f) : d
        );
        // Re-date the logged entries so each follows its content to the new slot.
        // workoutLogs is keyed by entry.date, so a moved day's WorkoutEntry — found
        // at its OLD weekday's date — must be re-bucketed at the NEW weekday's date,
        // or check-off churn on the Plan tab will miss it and duplicate the entry.
        // The two slots SWAP: `f`'s content lands on `toArg` and `t`'s on `fromArg`,
        // so the entries cross (fromDate→toDate and toDate→fromDate). Compute both
        // target dates from this PRE-swap state and apply both re-dates by entry id,
        // so neither clobbers the other and the swap + re-dating persist atomically.
        const start = cur2.startDate;
        const fromDate = dateForWeekday(start, fromArg); // f's old date / t's new date
        const toDate = dateForWeekday(start, toArg); // t's old date / f's new date
        let next: Profile = { ...p, plan: { ...p.plan!, current: { ...cur2, days } } };
        if (f.loggedEntryId) next = redateWorkoutEntry(next, f.loggedEntryId, fromDate, toDate);
        if (t.loggedEntryId) next = redateWorkoutEntry(next, t.loggedEntryId, toDate, fromDate);
        return next;
      });
      // Read the destination slot back from the ACTUAL saved profile and build an
      // authoritative PLAN UPDATED card from real pre/post state.
      const afterTo = nextProfile.plan?.current?.days.find((d) => d.weekday === toArg);
      // Card fires ONLY on a material change at the destination slot. If the swap
      // was a no-op (the two slots were already identical), push no card and tell
      // the model the truth so its prose stays honest.
      if (!planDayChanged(beforeTo, afterTo)) {
        return `No change — ${WEEKDAY_LABELS[a.to]} already looks like that.`;
      }
      const diff = planDiff(beforeTo, afterTo!);
      const card: CoachPlanChangeCard = {
        kind: "plan_change",
        dayLabel: `${WEEKDAY_LABELS[fromArg].toUpperCase()} → ${WEEKDAY_LABELS[toArg].toUpperCase()}`,
        oldTitle: beforeTo?.title ?? "—",
        newTitle: afterTo!.title,
        ...diff,
      };
      turnCardsRef.current.push(card);
      return `Moved ${WEEKDAY_LABELS[a.from]}'s "${from.title}" to ${WEEKDAY_LABELS[a.to]} (and swapped what was on ${WEEKDAY_LABELS[a.to]} back to ${WEEKDAY_LABELS[a.from]}).`;
    }
    if (name === "shift_plan") {
      const a = input as ShiftPlanArgs;
      const cur = profileRef.current.plan?.current;
      if (!cur) return "There's no active plan to shift.";
      // Signed rotation: forward = +, back = −; default magnitude 1 when omitted
      // or non-positive. Effective rotation collapses full-week multiples to 0.
      const n = a.days && a.days > 0 ? a.days : 1;
      const signedDays = (a.direction === "back" ? -1 : 1) * n;
      const eff = ((signedDays % 7) + 7) % 7;
      const dir = a.direction === "back" ? "back" : "forward";
      if (eff === 0) {
        return "No change — that shift lands the week right back where it is.";
      }
      // PRE-shift snapshot of the days (before any write) — used both to detect a
      // materially-unchanged rotation (e.g. an all-rest week) and to compute the
      // logged-entry re-date tuples. shiftWeekDays maps each DESTINATION weekday to
      // the source `eff` slots earlier; mirror that here so a logged day's entry
      // follows its content from its OLD date to its NEW date.
      const beforeDays = cur.days;
      const beforeByWeekday = new Map<Weekday, PlanDay>();
      for (const d of beforeDays) beforeByWeekday.set(d.weekday, d);
      // Compute the (entryId, fromDate, toDate) re-date tuples from the PRE-shift
      // state FIRST, then apply them together inside the transform, so entries
      // crossing dates can't clobber each other (same care as move_workout_day's
      // both-logged case). For each SOURCE day that has a loggedEntryId: its content
      // lands on destWd = (srcIdx + eff) % 7, so its entry moves from the source
      // day's date to the destination day's date.
      const redates: { id: string; from: string; to: string }[] = [];
      WEEKDAYS.forEach((srcWd, srcIdx) => {
        const src = beforeByWeekday.get(srcWd);
        if (!src?.loggedEntryId) return;
        const destWd = WEEKDAYS[(srcIdx + eff) % 7];
        const fromDate = dateForWeekday(cur.startDate, srcWd);
        const toDate = dateForWeekday(cur.startDate, destWd);
        if (fromDate !== toDate) redates.push({ id: src.loggedEntryId, from: fromDate, to: toDate });
      });
      // ONE atomic transform: rotate the week's days AND re-date the logged entries
      // off the pre-shift snapshot. Re-find the plan inside so a concurrent edit
      // isn't clobbered; bail to the same rotated days if the plan vanished.
      const nextProfile = await updateProfile((p) => {
        const cur2 = p.plan?.current;
        if (!cur2) return p;
        const days = shiftWeekDays(cur2, signedDays);
        let next: Profile = { ...p, plan: { ...p.plan!, current: { ...cur2, days } } };
        for (const r of redates) next = redateWorkoutEntry(next, r.id, r.from, r.to);
        return next;
      });
      // Materially-unchanged guard: a rotation of an all-identical / all-rest week
      // changes nothing visible. Compare pre/post across the 7 slots via
      // planDayChanged; if no slot's content differs, push no card and tell the
      // model the truth so its prose stays honest.
      const afterByWeekday = new Map<Weekday, PlanDay>();
      for (const d of nextProfile.plan?.current?.days ?? []) afterByWeekday.set(d.weekday, d);
      const materiallyChanged = WEEKDAYS.some((wd) =>
        planDayChanged(beforeByWeekday.get(wd), afterByWeekday.get(wd))
      );
      if (!materiallyChanged) {
        return `No change — shifting her week ${dir} ${n} day(s) lands it on the same workouts.`;
      }
      const card: CoachPlanShiftCard = { kind: "plan_shift", direction: dir, days: n };
      turnCardsRef.current.push(card);
      return `Shifted her whole week ${dir} ${n} day(s); every workout and her progress moved with it. It's on her Plan tab.`;
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
    if (name === "suggest_meal") {
      // Suggestion-only: build a SUGGESTED card for the chat. We do NOT write
      // anything to the profile — a suggestion isn't consumed. The card carries
      // the macro numbers + identity so "Save for later" can build a SavedFood.
      const a = input as SuggestMealArgs;
      const nm = (a.name ?? "").trim();
      if (!nm) return "I couldn't catch the meal name — tell me what to suggest.";
      const cal = Math.round(a.calories || 0);
      const p = Math.round(a.protein || 0);
      const c = Math.round(a.carbs || 0);
      const f = Math.round(a.fat || 0);
      const fib = typeof a.fiber === "number" ? Math.round(a.fiber) : undefined;
      turnCardsRef.current.push({
        kind: "suggested",
        label: (a.label?.trim() || "meal").toUpperCase(),
        name: nm,
        calories: cal,
        protein: p,
        carbs: c,
        fat: f,
        fiber: fib,
        quantityLabel: "1 serving",
      });
      return `Surfaced a meal suggestion card for "${nm}" (~${cal} kcal, ${p}g protein). It is NOT logged — she can save it for later if she wants.`;
    }
    if (name === "mark_bf_trend_surfaced") {
      // Feature F2: stamp the marker so bodyCompTrendStatus's 14-day re-pester
      // gate engages. No-arg tool — input is ignored. We intentionally do NOT
      // gate on whether the trend was actually armed in this turn's context:
      // if the model called this when it wasn't armed, the worst-case is the
      // marker advances a few days early and the next genuine trend waits
      // slightly longer to surface. Strictly safer than letting the model
      // re-raise the same trend across multiple turns.
      void (input as MarkBfTrendArgs);
      await updateProfile((p) => ({ ...p, lastBfTrendSurfacedAt: new Date().toISOString() }));
      return "Marked that you surfaced the body-composition trend — the 14-day gate is engaged so you won't bring it up again until then.";
    }
    return `Unknown tool ${name}.`;
  };

  // On open: load the (persistent) chat. Fire a fresh daily check-in only on a
  // brand-new chat or a new calendar day — appended, never erasing history.
  useEffect(() => {
    let active = true;
    loadChat().then(async (store) => {
      if (!active) return;
      // PRIVACY MIGRATION: rewrite any old leaked error bubble (org UUID +
      // console URLs from a 429) to the friendly line before it ever renders or
      // is reused. Idempotent — already-friendly messages don't match the prefix,
      // and scrubLeakedErrors returns the same array when nothing changed, so we
      // only re-persist (with the continuity values just restored above) when an
      // actual leak was scrubbed.
      const scrubbed = scrubLeakedErrors(store.messages);
      const didScrub = scrubbed !== store.messages;
      store.messages = scrubbed;
      // Restore the conversation-continuity summary so it enriches the first turn.
      summaryRef.current = store.summary ?? "";
      summarizedCountRef.current = store.summarizedCount ?? 0;
      appendMessages(scrubbed);
      // Persist the cleaned history once, so the leaked text is gone from storage
      // (not just this render). Only when something actually changed.
      if (didScrub) {
        await saveChat(scrubbed, {
          summary: summaryRef.current,
          summarizedCount: summarizedCountRef.current,
        });
      }
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
  // "" when cycle tracking is off — the header eyebrow is then hidden entirely
  // (no phase, no day, no "cycle" wording at all).
  const phaseLabel =
    phase.phase === "off"
      ? ""
      : phase.onBirthControl
        ? "On birth control"
        : phase.dayOfCycle
          ? `${phase.phase} · day ${phase.dayOfCycle}`
          : "Cycle not set";

  // Initials for the cocoa profile avatar (mockup top-right). Falls back to a
  // bird glyph mark when there's no name. Presentation only.
  const initials = (profile.name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  // Append a user message, get the Coach's reply (which may log food/water/cycle
  // or read a photo via tools), and persist.
  async function deliver(userMsg: ChatMessage) {
    if (sending || booting) return;
    // Build on the latest list via the ref, and write through appendMessages so
    // messagesRef stays current for any append-and-save path (scan/clear/kickoff).
    const next: ChatMessage[] = [...messagesRef.current, userMsg];
    appendMessages(next);
    setSending(true);
    // Fresh card accumulator for this turn — runTool pushes LOGGED/SUGGESTED
    // cards into it as tool calls resolve; we read it back after askCoach returns
    // and attach the cards to the assistant message. Reset here so cards never
    // carry over from a previous turn.
    turnCardsRef.current = [];
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
      // Attach any cards the tools produced this turn to the assistant message.
      const turnCards = turnCardsRef.current;
      // CONFABULATION GUARD (safety net): if the prose CLAIMS a plan/workout day
      // was changed but NO plan_change card was produced this turn (no plan tool
      // succeeded), append a short deterministic correction. We never rewrite or
      // delete the model's text — only append one honest line. The matcher is
      // sentence-scoped and excludes target/food context (see claimsPlanChange)
      // so set_targets / food / advice turns that merely mention a workout don't
      // trip it.
      const claimedChange = claimsPlanChange(reply);
      // A legit plan change this turn produced EITHER a single-day plan_change card
      // (adjust/move) OR a whole-week plan_shift card. Count both, or a real
      // shift_plan trips the confabulation false-positive.
      const hasPlanCard = turnCards.some(
        (c) => c.kind === "plan_change" || c.kind === "plan_shift"
      );
      const content =
        claimedChange && !hasPlanCard
          ? `${reply}\n\n(Heads up: I didn't actually change your plan just now.)`
          : reply;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content,
        date: userMsg.date,
        ...(turnCards.length ? { cards: turnCards } : {}),
      };
      const withReply: ChatMessage[] = [...next, assistantMsg, ...crisisMsg];
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
      // PRIVACY: never surface (or persist) the raw error. Anthropic 429 bodies
      // carry the org UUID, model name, and console/billing URLs — keep the raw
      // text in the console for debugging only. The user sees a fixed friendly
      // line; rate-limit (429 / "rate limit") gets its own gentler nudge.
      console.log("[Coach] request failed:", msg);
      const isRateLimited = /rate limit/i.test(msg) || /\b429\b/.test(msg);
      const friendly = isRateLimited
        ? "I'm a bit overloaded right now — try again in a minute."
        : COACH_CONNECT_ERROR;
      const withErr: ChatMessage[] = [
        ...next,
        {
          role: "assistant",
          content: friendly,
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

  // Stable identity for a suggested card, matching how findSavedFood/saveFood
  // dedupe (name+brand). Used to track + reflect the "Saved" pill state.
  function cardKey(card: CoachFoodCard): string {
    return (card.name + (card.brand ?? "")).trim().toLowerCase();
  }

  // Build the SavedFood for a suggested card, reusing lib/food.ts's toSavedFood
  // (the same builder the Food tab uses) so the saved row carries the same shape
  // and whole-gram rounding as every other saved food.
  function savedFoodFromCard(card: CoachFoodCard): SavedFood {
    return toSavedFood({
      name: card.name,
      brand: card.brand,
      calories: card.calories,
      protein: card.protein,
      carbs: card.carbs,
      fat: card.fat,
      fiber: card.fiber,
      quantityLabel: card.quantityLabel,
    });
  }

  // Is this suggested card already in saved foods? Checks both the live profile
  // (via findSavedFood — the single identity source) and this session's set, so
  // the pill reflects "Saved" after a tap and across re-renders.
  function isCardSaved(card: CoachFoodCard): boolean {
    if (savedCardKeys.has(cardKey(card))) return true;
    return !!findSavedFood(profile, savedFoodFromCard(card));
  }

  // SAVE FOR LATER: add the suggested meal to saved foods, reusing lib/food.ts's
  // saveFood (the same add path the Food Edit-sheet's toggleSaveFood uses) and
  // routing the profile write through the shared updateProfile (never a direct
  // profile write in this screen). Idempotent — saveFood dedupes by name+brand.
  async function handleSaveCard(card: CoachFoodCard) {
    if (sending || booting) return;
    const food = savedFoodFromCard(card);
    if (findSavedFood(profile, food)) {
      // Already saved — just reflect it and tell her where it lives.
      setSavedCardKeys((prev) => new Set(prev).add(cardKey(card)));
      Alert.alert("Already saved", `"${card.name}" is in your saved foods on the Food tab.`);
      return;
    }
    try {
      await updateProfile((p) => saveFood(p, food));
      setSavedCardKeys((prev) => new Set(prev).add(cardKey(card)));
      Alert.alert("Saved", `"${card.name}" is in your saved foods — find it on the Food tab.`);
    } catch (e: unknown) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    }
  }

  // SHOW MORE: ask the Coach for another option via the normal send path, so it
  // can propose (and card) a fresh suggestion. Reuses send -> deliver unchanged.
  function handleShowMore() {
    send("Show me another option.");
  }

  function addPhoto() {
    if (sending || booting) return;
    Alert.alert("Add food", "Snap your meal, a nutrition label, scan a barcode, or pick a photo.", [
      { text: "Take food photo", onPress: () => launchPhoto("camera", "meal") },
      { text: "Scan nutrition label", onPress: () => launchPhoto("camera", "label") },
      {
        text: "Scan barcode",
        onPress: () => {
          // Fresh scan session: release any leftover lock so a legitimate scan
          // works after a previous one completed. The same-code debounce still
          // prevents an immediate re-fire of the identical barcode.
          scanBusyRef.current = false;
          setScanning(true);
        },
      },
      { text: "Choose from library", onPress: () => launchPhoto("library", "auto") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  // Scan a barcode in chat: look it up in OFF, then let the Coach log the exact
  // label numbers (and respond) — or say it isn't in the database.
  async function handleCoachScan(code: string) {
    // SYNCHRONOUS RE-ENTRANCY LOCK — runs before any state update or await, so it
    // blocks the burst of continuous-scan callbacks regardless of React timing.
    // 1) a scan is already being processed → drop. 2) same code within ~2.5s →
    // drop (debounce the identical barcode). Otherwise claim the lock + record it.
    if (scanBusyRef.current) return;
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === code && now - last.t < 2500) return;
    scanBusyRef.current = true;
    lastScanRef.current = { code, t: now };

    setScanning(false);
    // Don't run while a Coach turn is mid-flight — a multi-step deliver() could
    // still be appending its reply, and we'd race/overwrite it on save. Release
    // the lock first so a later, legitimate scan isn't stuck behind a busy turn.
    if (sending || booting) {
      scanBusyRef.current = false;
      return;
    }
    try {
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
      await deliver({
        role: "user",
        content: `I scanned ${hit.name}${hit.brand ? ` (${hit.brand})` : ""}. The label says about ${m.calories} cal, ${m.protein}g protein, ${m.carbs}g carbs, ${m.fat}g fat per ${label}. Log it for me (one serving unless I say otherwise).`,
        date: toISODate(new Date()),
      });
    } finally {
      // Release once the work (no-hit append OR full deliver turn) has settled, so
      // a later scan after reopening the scanner still works. The same-code
      // debounce above stops an immediate identical re-fire.
      scanBusyRef.current = false;
    }
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

  // Clear the chat and reboot with a fresh kickoff greeting. The "Clear chat
  // history" action lives in Settings now (it owns the destructive-confirm
  // Alert), but the actual chat-state reset + reboot MUST run here in CoachScreen
  // because this screen owns the messages/summary refs and the kickoff call.
  // App bumps `clearSignal` after Settings clears storage; the effect below calls
  // this. Storage was already cleared by the Settings handler, but we call
  // clearChat() here too so this is idempotent and self-contained (a no-op
  // second remove is harmless) and the in-memory state + reboot stay correct.
  async function clearAndReboot() {
    // Don't wipe/reboot while a Coach turn is still resolving — its reply would
    // land after the wipe. The Settings action is async (post-confirm), so a turn
    // could be mid-flight; re-check the same guard the send/photo buttons use.
    if (sending || booting) return;
    await clearChat();
    appendMessages([]);
    // Reset the rolling summary too — the thread it summarized is gone.
    summaryRef.current = "";
    summarizedCountRef.current = 0;
    setBooting(true);
    try {
      const reply = await coachKickoff(profileRef.current);
      const fresh: ChatMessage[] = [
        { role: "assistant", content: reply, date: toISODate(new Date()) },
      ];
      appendMessages(fresh);
      // The thread was just cleared; the rolling summary is reset too.
      await saveChat(fresh, { summary: "", summarizedCount: 0 });
    } catch {
      // ignore — she can still type even if the kickoff call failed
    } finally {
      setBooting(false);
    }
  }

  // Reboot when the user clears chat history from Settings. clearSignal starts at
  // 0 (App's initial value) and bumps on each Settings-side clear; we skip the
  // initial mount (the boot effect already handles first load) and only react to
  // a genuine bump. Ref-guarded so the effect can't double-fire on an unrelated
  // re-render. We intentionally don't depend on sending/booting: clearAndReboot
  // re-checks that guard itself.
  const lastClearSignalRef = useRef(clearSignal);
  useEffect(() => {
    if (clearSignal === lastClearSignalRef.current) return;
    lastClearSignalRef.current = clearSignal;
    void clearAndReboot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal]);

  // Day-specific Coach opener (Workout → "Or ask your Coach to adjust your plan"
  // link). When a NEW adjustRequest.nonce arrives, APPEND a canned assistant
  // question naming the tapped day, so the conversation is already anchored to
  // it. Tracked via a last-seen-nonce ref so it fires exactly ONCE per tap (not
  // on every render) and never on a normal Coach-tab open (null / unchanged
  // nonce). This is a deterministic template — NO Anthropic call. We append
  // (never replace) onto the latest list via messagesRef, then persist with
  // saveChat exactly like the kickoff/scan paths, so existing history is kept
  // and the rolling summary is unchanged. The onContentSizeChange auto-scroll
  // reveals it. Her reply then flows through the normal askCoach turn (full
  // system prompt + ED-safety + tools + plan context — none of which this
  // bypasses). Seed the ref with the current nonce so a request that's already
  // present at mount doesn't fire on first render.
  const lastAdjustNonceRef = useRef(adjustRequest?.nonce);
  useEffect(() => {
    const nonce = adjustRequest?.nonce;
    if (nonce == null || nonce === lastAdjustNonceRef.current) return;
    lastAdjustNonceRef.current = nonce;
    // Don't inject mid-boot or mid-turn — the boot kickoff / an in-flight reply
    // could land after us and a save could race. The tab is already routed; the
    // opener can wait one render until those settle (then a re-tap re-fires it).
    if (booting || sending) return;
    const opener: ChatMessage = {
      role: "assistant",
      content: `What would you like to change about ${adjustRequest!.label}'s workout?`,
      date: toISODate(new Date()),
    };
    const next: ChatMessage[] = [...messagesRef.current, opener];
    appendMessages(next);
    void saveChat(next, {
      summary: summaryRef.current,
      summarizedCount: summarizedCountRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustRequest?.nonce]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <View style={styles.header}>
        <View>
          {phaseLabel ? (
            <Text style={styles.eyebrow} numberOfLines={1}>
              {phaseLabel.toUpperCase()}
            </Text>
          ) : null}
          <Text style={styles.headerTitle}>coach</Text>
        </View>
        {/* The mockup gives only a single profile avatar top-right. It maps to
            Settings (the profile target). "Clear chat history" now lives inside
            Settings (with its destructive confirm); clearing there reboots the
            Coach via the clearSignal prop. */}
        <TouchableOpacity
          style={styles.profileAvatar}
          onPress={onOpenSettings}
          accessibilityLabel="Profile and settings"
        >
          {profile.profilePhotoUri ? (
            <Image
              source={{ uri: profile.profilePhotoUri }}
              style={styles.profileImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.profileInitials}>{initials || "🐦"}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => {
          // New content (a reply, the kickoff, a cleared+rebooted chat) auto-
          // scrolls to the end so the newest bubble stays visible.
          scrollRef.current?.scrollToEnd({ animated: true });
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
          const isUser = m.role === "user";
          // Show the "wren" name-chip + WREN COACH label row at the START of a
          // coach turn (first assistant message in a run, or right after a
          // divider) — matching the mockup, where consecutive coach bubbles
          // don't repeat the chip. User turns get a right-aligned "YOU" label.
          const startsCoachRun = !isUser && (prev?.role !== "assistant" || showDivider);
          const startsUserRun = isUser && (prev?.role !== "user" || showDivider);
          return (
            <Fragment key={i}>
              {showDivider && <Text style={styles.divider}>{formatDayLabel(m.date!).toUpperCase()}</Text>}
              {startsCoachRun && (
                <View style={styles.coachLabelRow}>
                  <View style={styles.nameChip}>
                    <Text style={styles.nameChipText}>wren</Text>
                  </View>
                  <Text style={styles.coachLabel}>WREN COACH</Text>
                </View>
              )}
              {startsUserRun && <Text style={styles.userLabel}>YOU</Text>}
              {/* Full-width row wrapper: gives the bubble a DEFINITE parent width
                  so its maxWidth:"82%" resolves and long text wraps. Alignment
                  (left for coach, right for user) lives on the row, not on the
                  bubble — using alignSelf on the bubble made it size to its own
                  content and let long lines run past the screen edge. */}
              <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowCoach]}>
                <View
                  style={[styles.bubble, isUser ? styles.userBubble : styles.coachBubble]}
                >
                  {m.imageUri ? (
                    <Image source={{ uri: m.imageUri }} style={styles.bubbleImage} resizeMode="cover" />
                  ) : null}
                  {m.content ? (
                    <Text style={isUser ? styles.userText : styles.coachText}>
                      {/* Sanitize asterisk/bullet markdown out of COACH text only;
                          never mutate what the user typed. Applied at render so it
                          also cleans asterisks already stored in chat history. */}
                      {isUser ? m.content : stripChatFormatting(m.content)}
                    </Text>
                  ) : null}
                </View>
              </View>
              {/* Editorial data cards attached to this assistant message: full-
                  width, cocoa hairline top+bottom, no bubble. Suggested cards get
                  the Save / Show-more pill pair beneath them. */}
              {!isUser && m.cards?.length
                ? m.cards.map((card, ci) => {
                    // CONFABULATION GUARD card: an authoritative "PLAN UPDATED"
                    // summary built in code from the real post-write profile.
                    // Styled like the LOGGED food card (same hairline rail), but
                    // its right column shows the exercise diff instead of macros.
                    // Display-only — no Save/Undo pills (Undo is a later stage).
                    if (card.kind === "plan_change") {
                      const diffParts: string[] = [];
                      if (card.added) diffParts.push(`+${card.added}`);
                      if (card.removed) diffParts.push(`−${card.removed}`);
                      if (card.kept) diffParts.push(`${card.kept} kept`);
                      const diffLine = diffParts.length
                        ? diffParts.join(" · ")
                        : "no exercise change";
                      return (
                        <Fragment key={`card-${i}-${ci}`}>
                          <View style={styles.dataCard}>
                            <View style={styles.dataCardLeft}>
                              <Text style={styles.dataCardSlot}>
                                {`PLAN UPDATED · ${card.dayLabel}`}
                              </Text>
                              <Text style={styles.dataCardName}>
                                {card.oldTitle === card.newTitle
                                  ? card.newTitle
                                  : `${card.oldTitle} → ${card.newTitle}`}
                              </Text>
                            </View>
                            <View style={styles.dataCardRight}>
                              <Text style={styles.dataCardMacros}>{diffLine}</Text>
                              {!card.completionPreserved && (
                                <Text style={styles.dataCardMacros}>completion reset</Text>
                              )}
                            </View>
                          </View>
                        </Fragment>
                      );
                    }
                    // PLAN SHIFTED card: whole-week rotation summary (shift_plan).
                    // Same hairline rail as the other plan/data cards; left column
                    // is the header, right column the magnitude line.
                    if (card.kind === "plan_shift") {
                      return (
                        <Fragment key={`card-${i}-${ci}`}>
                          <View style={styles.dataCard}>
                            <View style={styles.dataCardLeft}>
                              <Text style={styles.dataCardSlot}>PLAN SHIFTED</Text>
                              <Text style={styles.dataCardName}>
                                {`Everything moved ${card.direction} ${card.days} day${
                                  card.days > 1 ? "s" : ""
                                }`}
                              </Text>
                            </View>
                          </View>
                        </Fragment>
                      );
                    }
                    const macroLine = `${card.protein}p · ${card.carbs}c · ${card.fat}f${
                      typeof card.fiber === "number" ? ` · ${card.fiber}fb` : ""
                    }`;
                    const slot =
                      card.kind === "logged"
                        ? `LOGGED · ${card.label}`
                        : `SUGGESTED · ${card.label}`;
                    const saved = card.kind === "suggested" && isCardSaved(card);
                    return (
                      <Fragment key={`card-${i}-${ci}`}>
                        <View style={styles.dataCard}>
                          <View style={styles.dataCardLeft}>
                            <Text style={styles.dataCardSlot}>{slot}</Text>
                            <Text style={styles.dataCardName}>{card.name}</Text>
                          </View>
                          <View style={styles.dataCardRight}>
                            <Text style={styles.dataCardCals}>{card.calories}</Text>
                            <Text style={styles.dataCardMacros}>{macroLine}</Text>
                          </View>
                        </View>
                        {card.kind === "suggested" && (
                          <View style={styles.ctaRow}>
                            <TouchableOpacity
                              style={[styles.ctaPill, styles.ctaPillFill, saved && styles.ctaPillSaved]}
                              onPress={() => void handleSaveCard(card)}
                              disabled={sending || booting}
                            >
                              <Text style={styles.ctaPillFillText}>
                                {saved ? "SAVED" : "SAVE FOR LATER"}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.ctaPill, styles.ctaPillOutline]}
                              onPress={handleShowMore}
                              disabled={sending || booting}
                            >
                              <Text style={styles.ctaPillOutlineText}>SHOW MORE</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </Fragment>
                    );
                  })
                : null}
            </Fragment>
          );
        })}
        {sending && <TypingDots />}
        {/* Suggested prompts live as the LAST item in the scroll flow (right
            after the Coach's kickoff greeting) so they scroll with the chat
            instead of being pinned above the composer. */}
        {showSuggestions && (
          <View style={styles.suggestList}>
            <Text style={styles.suggestEyebrow}>OR ASK ME</Text>
            {SUGGESTED.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestItem}
                onPress={() => send(s)}
                disabled={sending || booting}
              >
                <ArrowRightIcon size={14} />
                <Text style={styles.suggestText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={addPhoto}
            disabled={sending || booting}
            accessibilityLabel="Add a food photo, label, or barcode"
          >
            <CameraIcon size={20} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message your coach…"
            placeholderTextColor={colors.inkMuted}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => send(input)}
            disabled={sending || booting}
            accessibilityLabel="Send"
          >
            <SendArrowIcon size={24} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <BarcodeScanner onScanned={handleCoachScan} onClose={() => setScanning(false)} />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.paper },
  // Header: eyebrow phase line over the lowercase "coach" wordmark; cocoa
  // profile avatar top-right. No bottom hairline in the mockup.
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing["2xl"],
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  // Eyebrow phase line — micro, wide tracking, clay. (Mockup is 9px/2.5px; the
  // micro token + wide tracking is the brand-consistent rendering of it.)
  eyebrow: {
    fontFamily: type.ui.family,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.wide,
    color: colors.inkMuted,
  },
  // Lowercase "coach" wordmark — large bold, tight negative tracking, cocoa.
  headerTitle: {
    fontFamily: type.display.family,
    fontSize: 38,
    lineHeight: 40,
    letterSpacing: -1.5,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  profileAvatar: {
    marginBottom: spacing.xs,
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden", // clips the profile photo to the pill circle
  },
  // Profile photo fills the 42px circle (cover). Falls back to initials + 🐦.
  profileImage: {
    width: 42,
    height: 42,
  },
  profileInitials: {
    fontFamily: type.display.family,
    fontSize: type.size.callout,
    letterSpacing: -0.3,
    color: colors.surface,
  },
  messages: { paddingHorizontal: spacing.lg, paddingTop: spacing["2xl"], paddingBottom: spacing.sm },
  empty: {
    fontFamily: type.body.family,
    color: colors.inkMuted,
    fontSize: type.size.body,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  // TODAY / YESTERDAY day divider — centered micro label, mist-dark, wide track.
  divider: {
    alignSelf: "center",
    fontFamily: type.label.family,
    color: colors.inkMuted,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.wide,
    marginVertical: spacing.md,
  },
  // Coach turn header row: "wren" name-chip + WREN COACH label.
  coachLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingLeft: spacing.xs,
  },
  nameChip: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  nameChipText: {
    fontFamily: type.display.family,
    fontSize: type.size.micro,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  coachLabel: {
    fontFamily: type.label.family,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.wide,
    color: colors.mistDark,
  },
  // YOU label above a user turn — right-aligned, clay.
  userLabel: {
    alignSelf: "flex-end",
    fontFamily: type.label.family,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.wide,
    color: colors.inkMuted,
    marginBottom: spacing.xs,
    paddingRight: spacing.xs,
  },
  // Typing-dots indicator: a compact coach bubble with three dots in a row.
  typingBubble: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  typingRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.inkMuted },
  bubbleImage: { width: 200, height: 200, borderRadius: radius.md, marginBottom: spacing.xs + 2 },
  photoBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  // Each mapped message bubble sits in a full-width row so the bubble's
  // maxWidth:"82%" has a definite parent width to resolve against (the screen),
  // which is what makes long text wrap instead of running off the right edge.
  // justifyContent drives left/right placement.
  bubbleRow: { width: "100%", flexDirection: "row" },
  bubbleRowCoach: { justifyContent: "flex-start" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl + 2,
    // Soft editorial lift — the app's shared soft-card recipe (WorkoutScreen
    // cards): a faint cocoa shadow so the bubble floats off the cream
    // background. Both bubble fills are opaque and neither bubble clips with
    // overflow:"hidden", so the shadow renders on iOS. Applied to the shared
    // base so coach, user, and the typing bubble all lift consistently.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 2,
  },
  // Asymmetric bubble corners per mockup: coach tucks bottom-left, user
  // tucks bottom-right (20 elsewhere, 6 on the tucked corner).
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.ink,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: 20,
    // A cocoa shadow under the cocoa user bubble is naturally faint; nudge the
    // offset/opacity up a touch so it still reads as lifted without going heavy.
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    elevation: 3,
  },
  coachBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceMuted,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 6,
  },
  userText: { fontFamily: type.body.family, color: colors.surface, fontSize: 15, lineHeight: 22 },
  coachText: { fontFamily: type.body.family, color: colors.ink, fontSize: 15, lineHeight: 22 },
  // Editorial data card (LOGGED / SUGGESTED): full-width, warm cocoa hairline
  // top+bottom, no bubble fill. Left = slot label + name; right = calories + the
  // macro line, right-aligned (per mockup lines ~72-82 / ~108-118).
  dataCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xs + 2,
    marginBottom: spacing.lg + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardHairline,
  },
  dataCardLeft: { flexShrink: 1, paddingRight: spacing.md },
  dataCardRight: { alignItems: "flex-end" },
  dataCardSlot: {
    fontFamily: type.label.family,
    fontSize: type.size.nano,
    letterSpacing: type.tracking.label,
    color: colors.mistDark,
  },
  dataCardName: {
    fontFamily: type.ui.family,
    fontSize: type.size.body,
    color: colors.ink,
    marginTop: spacing.xs + 1,
  },
  dataCardCals: {
    fontFamily: type.label.family,
    fontSize: 22,
    // lineHeight 22 == fontSize gave the line box zero headroom, clipping the
    // tops of the digits ("220"). Bump to 28 so the glyphs render fully.
    lineHeight: 28,
    letterSpacing: type.tracking.tight,
    color: colors.ink,
  },
  dataCardMacros: {
    fontFamily: type.body.family,
    fontSize: type.size.micro,
    color: colors.inkMuted,
    marginTop: spacing.xs,
  },
  // CTA pill pair under a SUGGESTED card. Both pills established on Food:
  // primary = Espresso (ink) fill / surface text; secondary = Espresso outline.
  ctaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg + 2,
    paddingHorizontal: spacing.xs + 2,
  },
  ctaPill: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPillFill: { backgroundColor: colors.ink },
  ctaPillSaved: { backgroundColor: colors.inkMuted },
  ctaPillFillText: {
    fontFamily: type.label.family,
    fontSize: type.size.caption,
    letterSpacing: type.tracking.button,
    color: colors.surface,
  },
  ctaPillOutline: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: "transparent",
    // 1.5px border vs the fill pill's borderless edge would make the outline
    // pill 3px taller; trim its vertical padding by the border width so both
    // pills match height (mockup uses 13px vs 14px padding for the same reason).
    paddingVertical: spacing.md + 2 - 1.5,
  },
  ctaPillOutlineText: {
    fontFamily: type.label.family,
    fontSize: type.size.caption,
    letterSpacing: type.tracking.button,
    color: colors.ink,
  },
  // Suggested-prompt list: left-aligned vertical list above the input bar. An
  // "OR ASK ME" eyebrow over three tappable rows; each row is a thin camel arrow
  // glyph + the prompt in cocoa. No pill background — clean list on the white
  // screen, per the mockup.
  // Inline as the last item in the scroll flow: the ScrollView's
  // contentContainer (styles.messages) already insets horizontally, so no
  // horizontal padding here. marginTop spaces it from the last bubble.
  suggestList: {
    marginTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  suggestEyebrow: {
    fontFamily: type.label.family,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.wide,
    color: colors.inkMuted,
    marginBottom: spacing.xs + 2,
  },
  suggestItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs + 1,
  },
  suggestText: {
    fontFamily: type.ui.family,
    fontSize: type.size.callout,
    color: colors.ink,
  },
  // Input bar: rounded creamTile pill with a hairline border, camera at left,
  // circular cocoa send button at right.
  inputRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs + 2,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.creamTile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radius.pill,
    // Soft editorial lift — same shared soft-card family as the chat bubbles,
    // nudged a touch more present since this is a pinned composer. Opaque
    // creamTile fill, no overflow:"hidden", so the shadow renders on iOS and
    // elevation on Android.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  input: {
    flex: 1,
    fontFamily: type.body.family,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 0,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
});
