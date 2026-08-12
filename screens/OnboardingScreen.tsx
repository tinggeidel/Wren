import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  LayoutChangeEvent,
  useWindowDimensions,
} from "react-native";
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import {
  Profile,
  Goal,
  Tone,
  ActivityLevel,
} from "../lib/types";
import { toISODate } from "../lib/cycle";
import { addMemory } from "../lib/memory";
import { toJpegBase64 } from "../lib/image";
import { calibrateFromPhotos, hasApiKey, CalibrationResult } from "../lib/coach";
import { navyBodyFatPercent } from "../lib/bodycomp";
import { Stepper } from "../components/Stepper";
import { colors, type as ty, spacing, radius } from "../lib/theme";

// ---------------------------------------------------------------------------
// DESIGN PASS — onboarding reskinned to match
// brand/Onboarding Tab/wren_onboarding_redesign.html (the mockup is the spec).
// Warm editorial brand: cream field, cocoa ink, clay/tan accents. The old
// Espresso-era purple (#7c3aed) is fully removed; every color now goes through
// lib/theme tokens. Behaviors, state shape, handler names, the calibration
// pipeline, touched-gating, and finish()/Profile persistence are UNCHANGED —
// only presentation (JSX + StyleSheet) was rewritten. Where the new 9-screen
// layout needs behavior the implementer must wire, a // TODO(implementer:) note
// marks it.
//
// Font note (2nd fidelity pass): the mockup uses Manrope ExtraBold (800) for
// the wordmark, big titles, and large stepper-value numerals. The first pass
// approximated with 700, which read lighter than the mockup on device. 800 is
// now genuinely bundled (Manrope_800ExtraBold added to App.tsx useFonts) and
// exposed as the `displayHeavy` token — applied to the wordmark, h1 titles,
// hero-lede, coach-pill, and stepper numerals. Body/label voice stays 700/600/
// 500/400.
//
// Depth note (2nd pass): expo-linear-gradient is NOT a dependency in this SDK-54
// app (verified package.json), so the mockup's linear-gradient(165deg,cream,
// glaze) card fills and the CTA sheen's gradient bar are reproduced WITHOUT a
// gradient lib — the cards use the warm creamTile fill plus a faint diagonal
// highlight overlay; the sheen is a skewed translucent-white Animated.View bar
// translated across the pill (clipped by overflow:hidden + pill radius). The
// CTA also gains the mockup's lift/shadow. Documented in the fidelity report.
// ---------------------------------------------------------------------------

// Reuse the exact same option ordering Settings uses, so the two screens never
// drift. These are the only fields onboarding collects; everything else on the
// Profile (the data maps, calorieMode, goalWeight, plan, memory) is seeded to its
// existing empty default — Settings remains the place to fill those in later.
const GOALS: Goal[] = ["lose_fat", "tone_up", "build_muscle", "feel_better", "maintain"];
const TONES: Tone[] = ["bestie", "tough_love", "hype"];
const ACTIVITIES: ActivityLevel[] = ["sedentary", "light", "active", "very_active"];

// Editorial row copy, lifted verbatim from the mockup (GOALS / ACTIVITY / TONES
// arrays in wren_onboarding_redesign.html). The enum KEY is still the state
// value — only the title + description shown to the user are mockup copy. This
// is presentation; the implementer keeps the state keys as-is.
const GOAL_ROWS: { key: Goal; title: string; desc: string }[] = [
  { key: "lose_fat", title: "Lean out", desc: "Lower body fat at a steady, sustainable pace" },
  { key: "tone_up", title: "Tone & define", desc: "Recomposition — hold weight, build shape" },
  { key: "build_muscle", title: "Build strength", desc: "Add muscle and get measurably stronger" },
  { key: "feel_better", title: "Feel better", desc: "More energy and consistency, less guesswork" },
  { key: "maintain", title: "Maintain", desc: "Hold your current shape with structure" },
];
const ACTIVITY_ROWS: { key: ActivityLevel; title: string; desc: string }[] = [
  { key: "sedentary", title: "Mostly seated", desc: "Desk job, little daily movement" },
  { key: "light", title: "Lightly active", desc: "On my feet some, train 1–2x/week" },
  { key: "active", title: "Active", desc: "Train 3–4x/week, move daily" },
  { key: "very_active", title: "Very active", desc: "Train 5+ x/week or physical job" },
];
// The three mutually-exclusive cycle modes — mirrors Settings → CycleEditor.
// "track" = log her natural cycle; "bc" = on hormonal birth control (tracking
// on, phase predictions handled differently); "off" = cycle tracking fully
// disabled app-wide. Copy/subtitles kept consistent with the Settings editor.
type CycleMode = "track" | "bc" | "off";
const CYCLE_MODE_ROWS: { key: CycleMode; title: string; desc: string }[] = [
  {
    key: "track",
    title: "Track my natural cycle",
    desc: "Coach paces around your phase and predicts your period.",
  },
  {
    key: "bc",
    title: "On hormonal birth control",
    desc: "Coach handles phase predictions differently.",
  },
  {
    key: "off",
    title: "Turn off cycle tracking",
    desc: "No cycle tracking or phase-based guidance. You can turn it back on anytime.",
  },
];
const TONE_ROWS: { key: Tone; title: string; desc: string }[] = [
  {
    key: "bestie",
    title: "Knowledgeable friend",
    desc: "Calm and warm — your trainer who happens to be in your corner. Holds you to the plan without the edge.",
  },
  {
    key: "tough_love",
    title: "Tough love",
    desc: "Direct and demanding. Names the misses, expects the work, never cruel.",
  },
  {
    key: "hype",
    title: "Hype",
    desc: "High energy. Big on momentum and marking the wins as you stack them.",
  },
];

// Quick dietary chips. Each maps to a short, durable memory fact phrased the way
// the Coach saves them (see lib/coach.ts memory guidance: "no dairy", "vegetarian").
const DIET_CHIPS: { key: string; label: string; fact: string }[] = [
  { key: "vegetarian", label: "Vegetarian", fact: "vegetarian" },
  { key: "vegan", label: "Vegan", fact: "vegan" },
  { key: "pescatarian", label: "Pescatarian", fact: "pescatarian" },
  { key: "dairy_free", label: "Dairy-free", fact: "no dairy" },
  { key: "gluten_free", label: "Gluten-free", fact: "no gluten" },
  { key: "nut_free", label: "Nut-free", fact: "no nuts" },
];

// Parse a "YYYY-MM-DD" string to a Date; fall back to today if empty/invalid.
function parseDateOrToday(s: string): Date {
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? new Date() : d;
}

// Whole years between a birth date and today.
function ageFromBirthDate(birth: Date, now: Date): number {
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

// Default birth date for the picker: ~30 years ago.
function defaultBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Day-granular date equality. The DOB gate uses this so the iOS spinner's
// mount-time onChange is not treated as user intent.
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
// Oldest allowed birth date: 100 years ago.
function minBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 100);
  return d;
}

// Stepper bounds. Height is in TOTAL INCHES (54 = 4'6", 84 = 7'0"); weight in lb.
const HEIGHT_MIN_IN = 54;
const HEIGHT_MAX_IN = 84;
const HEIGHT_DEFAULT_IN = 66; // 5'6"
const WEIGHT_MIN_LB = 80;
const WEIGHT_MAX_LB = 350;
const WEIGHT_DEFAULT_LB = 150;
const GOAL_WEIGHT_DEFAULT_LB = 140;

// Body-measurement stepper bounds (inches).
const WAIST_MIN_IN = 20;
const WAIST_MAX_IN = 60;
const WAIST_DEFAULT_IN = 30;
const NECK_MIN_IN = 10;
const NECK_MAX_IN = 20;
const NECK_DEFAULT_IN = 13;
const HIP_MIN_IN = 25;
const HIP_MAX_IN = 65;
const HIP_DEFAULT_IN = 38;

// Cycle length stepper bounds (days).
const CYCLE_MIN = 21;
const CYCLE_MAX = 40;

// Format total inches as the ft'in" string parseHeightCm accepts (e.g. 5'6").
function formatHeight(totalIn: number): string {
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return `${ft}'${inch}"`;
}

// The lean 9-screen step list, matching the mockup flow. Tape-measure
// measurements are NOT a standalone step — they live inside the Snapshot
// ("photos") screen as an optional expander (per Ting's decision), so they never
// appear in STEPS. The index header below maps each Step to its editorial number.
const STEPS = ["welcome", "basics", "body", "photos", "goals", "cycle", "diet", "tone", "start"] as const;
type Step = (typeof STEPS)[number];

// The 9 conceptual screens of the mockup, in order, used to render the editorial
// index header (eyebrow + "0X / 07 ——— LABEL"). Maps each navigation Step to its
// editorial index number + label.
const INDEX_LABELS: Record<Step, { num: number; label: string }> = {
  welcome: { num: 0, label: "" },
  basics: { num: 1, label: "THE BASICS" },
  goals: { num: 2, label: "YOUR GOAL" },
  body: { num: 3, label: "ABOUT YOU" },
  photos: { num: 4, label: "SNAPSHOT" },
  cycle: { num: 5, label: "YOUR CYCLE" },
  diet: { num: 6, label: "HOW YOU EAT" },
  tone: { num: 7, label: "COACH VOICE" },
  start: { num: 8, label: "YOUR COACH" },
};
// Steps that show a "Skip" affordance in the footer (optional steps).
const OPTIONAL_STEPS: Step[] = ["body", "photos", "cycle", "diet"];

type StartDest = "coach" | "workout";

// --- Presentational sub-components ------------------------------------------

// Tiny uppercase eyebrow label above each screen title.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

// Editorial selectable row: optional idx number + title + description + circular
// radio mark. Matches the mockup's .row.
function EditorialRow({
  idx,
  title,
  desc,
  on,
  onPress,
}: {
  idx?: string;
  title: string;
  desc: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {idx ? <Text style={styles.rowIdx}>{idx}</Text> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{desc}</Text>
      </View>
      <View style={[styles.mark, on && styles.markOn]}>
        {on ? <View style={styles.markDot} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// Pill-shaped chip (food prefs).
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Tappable value row (DOB / date) — label-left, chevron/icon right.
function ValueRow({
  value,
  placeholder,
  filled,
  icon,
  iconColor,
  onPress,
}: {
  value: string;
  placeholder: string;
  filled: boolean;
  icon: string;
  iconColor?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.vrow} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.vrowValue, !filled && styles.vrowPlaceholder]}>
        {filled ? value : placeholder}
      </Text>
      <Text style={[styles.vrowIcon, iconColor ? { color: iconColor } : null]}>{icon}</Text>
    </TouchableOpacity>
  );
}

// Field label with optional "(optional)" tan suffix.
function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {children}
      {optional ? <Text style={styles.fieldLabelOpt}>  (optional)</Text> : null}
    </Text>
  );
}

const ARROW = "→";

// The CTA pill with the mockup's looping "sheen" sweep (.next:before). A skewed
// translucent-white bar rests off-screen left and sweeps to the far right every
// ~4.5s, then waits before repeating — matching the mockup's @keyframes sheen
// (rest 0–60%, sweep 60–80%, hold 80–100%). Implemented with the Animated API:
// one looping Animated.Value drives a translateX (useNativeDriver: true, runs on
// the UI thread → cheap, no JS-thread cost while idle). The bar is a
// pointerEvents="none" absolute overlay clipped by the pill's overflow:hidden +
// pill radius, so it never intercepts the press — onPress is owned entirely by
// the underlying TouchableOpacity and is unchanged. The pill also carries the
// mockup's slight lift/shadow for dimension.
//
// expo-linear-gradient isn't installed, so the bar's transparent→white→transparent
// falloff is approximated by stacking three vertical sub-bars of rising/falling
// opacity rather than a true gradient — the swept highlight reads the same.
function SheenPill({
  children,
  onPress,
  disabled,
  ghost,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [pillWidth, setPillWidth] = useState(0);

  useEffect(() => {
    // Loop forever. One cycle = sweep + hold, matching the mockup's ~4.5s cadence.
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 4500,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  function onLayout(e: LayoutChangeEvent) {
    setPillWidth(e.nativeEvent.layout.width);
  }

  // Rest off-screen left until 60% of the cycle, then sweep past the right edge
  // by 80%, then hold off-screen for the remainder (mockup keyframes).
  const barWidth = Math.max(40, pillWidth * 0.42);
  const translateX = progress.interpolate({
    inputRange: [0, 0.6, 0.8, 1],
    outputRange: [-barWidth * 1.6, -barWidth * 1.6, pillWidth + barWidth, pillWidth + barWidth],
  });

  return (
    <TouchableOpacity
      style={[styles.next, ghost && styles.nextGhost, !ghost && styles.nextShadow]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.9}
      onLayout={onLayout}
    >
      {!ghost && pillWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sheen,
            { width: barWidth, transform: [{ translateX }, { skewX: "-18deg" }] },
          ]}
        >
          <View style={[styles.sheenBand, styles.sheenBandSoft]} />
          <View style={[styles.sheenBand, styles.sheenBandCore]} />
          <View style={[styles.sheenBand, styles.sheenBandSoft]} />
        </Animated.View>
      ) : null}
      {children}
    </TouchableOpacity>
  );
}

// Split an "rgba(r,g,b,a)" token into the { color, opacity } pair that SVG
// <Stop> wants (stopColor takes an rgb()/hex; stopOpacity takes the alpha).
// The mesh* tokens in lib/theme are authored as rgba() so the alpha is the
// mockup's per-bloom opacity; we hand the alpha to stopOpacity and strip it
// off the color. Falls back to opacity 1 for a plain rgb()/hex token.
function rgbaSplit(token: string): { color: string; opacity: number } {
  const m = token.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) return { color: token, opacity: 1 };
  const [, r, g, b, a] = m;
  return { color: `rgb(${r},${g},${b})`, opacity: a != null ? Number(a) : 1 };
}

// Each radial bloom from the mockup .bg layer. cx/cy are the anchor (fraction
// of width/height); rx/ry are the radii (fraction of width/height). color is
// a lib/theme mesh* token (rgba). The inner stop is the token color at its
// authored alpha; it fades to the same hue at 0 opacity by ~70-72% of the
// radius — matching the mockup's "<token> -> transparent 70%/72%".
type Bloom = { id: string; cx: number; cy: number; rx: number; ry: number; token: string; fade: number };
const BLOOMS: Bloom[] = [
  { id: "butter", cx: 0.18, cy: 0.12, rx: 0.38, ry: 0.34, token: colors.meshButter, fade: 0.7 },
  { id: "vapor", cx: 0.88, cy: 0.08, rx: 0.42, ry: 0.38, token: colors.meshVapor, fade: 0.7 },
  { id: "rose", cx: 0.82, cy: 0.88, rx: 0.48, ry: 0.44, token: colors.meshRose, fade: 0.72 },
  { id: "sage", cx: 0.08, cy: 0.92, rx: 0.46, ry: 0.46, token: colors.meshSage, fade: 0.72 },
  { id: "honey", cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, token: colors.meshHoney, fade: 0.7 },
];

// ---------------------------------------------------------------------------
// AmbientMesh — the faithful warm radial mesh behind all onboarding content
// (3rd fidelity pass, JOB 1). Replaces the earlier core-RN bloom-circle
// scaffold with a single full-screen <Svg> painting, in mockup z-order:
//   1. meshBackdrop fill (the warm body backdrop the blooms sit on)
//   2. five <RadialGradient> blooms (the mockup .bg layer) as overlapping
//      <Rect>s, each its own ellipse gradient anchored at its mockup position,
//      fading the token color to fully transparent by ~70-72% of its radius.
// react-native-svg v15.12.1's RadialGradient/Stop/Rect/Defs are all natively
// backed on iOS + Android (verified in node_modules fabric exports), so this
// renders identically on device — unlike SVG filters.
//
// Sized from useWindowDimensions so the blooms anchor correctly on any device
// (Ting's Pro Max included). pointerEvents none is set on the wrapping <View>
// in the JSX so the whole layer never intercepts touches on the content.
//
// GRAIN (JOB 2) — now a tiled PNG overlay. The mockup's grain is a fine
// monochrome noise multiplied at .045 over the mesh. RN has no
// mix-blend-mode:multiply, so the agreed approximation is a low-opacity
// (~0.045) monochrome-noise PNG (assets/grain.png, 180×180 RGBA) tiled across
// the screen with <Image resizeMode="repeat"> (the correct RN tiling prop on
// SDK 54 / RN 0.81). It is painted in the ambient layer OVER the mesh blooms
// and UNDER the screenSheen highlight — see the AMBIENT BACKGROUND LAYER block
// in the JSX. The whole layer is pointerEvents="none" and the safety infocard
// + calibration recap sit on opaque creamTile tiles that occlude it, so grain
// never lands on the ED-safety copy.
// ---------------------------------------------------------------------------
function AmbientMesh({ width, height }: { width: number; height: number }) {
  const backdrop = rgbaSplit(colors.meshBackdrop);
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        {BLOOMS.map((b) => {
          const { color, opacity } = rgbaSplit(b.token);
          return (
            <RadialGradient
              key={b.id}
              id={`mesh-${b.id}`}
              // objectBoundingBox units (the RadialGradient default): cx/cy/rx/ry
              // and the focal fx/fy are 0..1 fractions of the painted Rect's box,
              // so cx=0.18 means 18% across, rx=0.38 means a radius of 38% of the
              // screen width — exactly the mockup's "radial 38% 34% at 18% 12%".
              cx={b.cx}
              cy={b.cy}
              rx={b.rx}
              ry={b.ry}
              fx={b.cx}
              fy={b.cy}
            >
              <Stop offset="0" stopColor={color} stopOpacity={opacity} />
              <Stop offset={`${b.fade}`} stopColor={color} stopOpacity={0} />
            </RadialGradient>
          );
        })}
      </Defs>
      {/* Warm backdrop field first. */}
      <Rect x={0} y={0} width={width} height={height} fill={backdrop.color} />
      {/* Then the five blooms, each painted over the full screen; transparency
          outside each bloom's radius lets the layers overlap into a soft mesh. */}
      {BLOOMS.map((b) => (
        <Rect key={b.id} x={0} y={0} width={width} height={height} fill={`url(#mesh-${b.id})`} />
      ))}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// ScreenSheen — the mockup's .screen:before corner highlight, as a SMOOTH SVG
// LinearGradient with NO hard edge (replaces the old flat-color View that ended
// abruptly at 30% height, producing a full-width horizontal seam). Mockup:
//   linear-gradient(155deg, rgba(255,255,255,.35), transparent 30%)
// 155deg in CSS points down-and-left from the top, so the bright corner sits at
// the TOP-LEFT and falls off diagonally. In SVG objectBoundingBox units we run
// the gradient vector from the top-left (x1=0,y1=0) toward the bottom-right
// (x2≈0.65,y2≈0.95) and stop the white fully transparent by ~32% along it, so
// the white tint is strongest top-left and is fully gone (stopOpacity 0) well
// before any edge — a seamless corner sheen. Fills the whole ambient layer.
// ---------------------------------------------------------------------------
function ScreenSheen() {
  const { color, opacity } = rgbaSplit(colors.screenSheen);
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id="screen-sheen" x1="0" y1="0" x2="0.65" y2="0.95">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="0.32" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#screen-sheen)" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// CardHighlight — the soft top-down sheen on cards (infocard / recap / chosen
// choice). Replaces the old flat rgba(255,255,255,0.5) View that ended abruptly
// at 62% card height, producing a horizontal seam across the card. This is a
// SMOOTH SVG LinearGradient running straight down (x1=y1=0 → x2=0, y2=1): white
// at the TOP fading to FULLY TRANSPARENT (stopOpacity 0) by the bottom, so there
// is no visible stop line anywhere. It ONLY ever lightens (white over the tile);
// it never darkens. It must sit BEHIND the card text and INSIDE the card's
// rounded clip (each card already sets overflow:hidden + radius), and the safety
// card's creamTile stays fully opaque under it. Fills its parent (the card).
// ---------------------------------------------------------------------------
function CardHighlight() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id="card-highlight" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="rgb(255,255,255)" stopOpacity={0.5} />
          <Stop offset="0.9" stopColor="rgb(255,255,255)" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#card-highlight)" />
    </Svg>
  );
}

export default function OnboardingScreen({
  initProfile,
  onDone,
}: {
  initProfile: (p: Profile) => Promise<void>;
  onDone: (dest: StartDest) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step: Step = STEPS[stepIndex];

  // Drives the full-screen ambient mesh so the radial blooms anchor correctly
  // on any device (re-reads on rotation/size change).
  const { width: winW, height: winH } = useWindowDimensions();

  // The onboarding screen renders full-bleed (App.tsx mounts it outside the
  // inset SafeAreaView) so the ambient mesh paints behind the status bar and
  // home indicator. We apply these insets to CONTENT only — the index header,
  // the Welcome wordmark, and the footer — so nothing collides with the system
  // UI while the background reaches the true screen edges.
  const insets = useSafeAreaInsets();

  // --- Custom keyboard avoidance (no dependency) -----------------------------
  // ATTEMPT #5. The two problem fields (the Goal "in your words" textarea and the
  // diet "anything else" textarea — both styles.textarea, multiline) are the LAST
  // element on their step. We exploit that: track the live keyboard height, add it
  // to the ScrollView's contentContainer paddingBottom so there is exactly enough
  // scrollable room, then scrollToEnd to lift the field's bottom (where the caret
  // sits in a bottom-growing multiline) just above the keyboard line. Re-running
  // scrollToEnd on the textarea's content-size growth follows the caret line by
  // line. Pure built-in RN (Keyboard + ScrollView.scrollToEnd) — no lib, so no
  // SDK-54 compatibility risk. Prior attempts (KeyboardAwareScrollView,
  // KeyboardAvoidingView, automaticallyAdjustKeyboardInsets) did not engage on
  // RN 0.81 / React 19 / Expo Go SDK 54.
  const scrollRef = useRef<ScrollView>(null);
  const [kbHeight, setKbHeight] = useState(0);
  // True while one of the two multiline textareas holds focus, so the kbHeight
  // effect only re-scrolls when a textarea (not e.g. the name field) is focused.
  const textareaFocusedRef = useRef(false);

  useEffect(() => {
    // iOS fires Will* (smoother); Android only fires Did*. We subscribe to both
    // show variants and both hide variants, and store endCoordinates.height.
    const onShow = (e: { endCoordinates: { height: number } }) =>
      setKbHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setKbHeight(0);
    const subs = [
      Keyboard.addListener("keyboardWillShow", onShow),
      Keyboard.addListener("keyboardDidShow", onShow),
      Keyboard.addListener("keyboardWillHide", onHide),
      Keyboard.addListener("keyboardDidHide", onHide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  // When the keyboard finishes opening (kbHeight > 0), the extra paddingBottom has
  // applied — so if a textarea is focused, scroll its bottom/caret above the
  // keyboard. This is the reliable lift even if onFocus fired before the padding.
  useEffect(() => {
    if (kbHeight > 0 && textareaFocusedRef.current) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [kbHeight]);

  // Shared handlers for the two multiline textareas. onFocus: mark focused + scroll
  // to end after a frame (lets the kbHeight padding apply first). onContentSizeChange:
  // as the multiline grows while typing, re-scroll to keep the caret (at content
  // bottom) above the keyboard. onBlur: clear the focused flag.
  function onTextareaFocus() {
    textareaFocusedRef.current = true;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }
  function onTextareaBlur() {
    textareaFocusedRef.current = false;
  }
  function onTextareaGrow() {
    scrollRef.current?.scrollToEnd({ animated: true });
  }

  // Field state — defaults match Settings' first-run defaults.
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<Goal>("feel_better");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("light");
  // Cycle is a single 3-way choice (mirrors Settings → Cycle): "track" her
  // natural cycle, "bc" hormonal birth control, or "off" (no tracking at all).
  // The two stored booleans are derived from this at finish() so they can never
  // contradict each other. Default to "track".
  const [cycleMode, setCycleMode] = useState<CycleMode>("track");
  const [lastPeriodStart, setLastPeriodStart] = useState("");
  const [avgCycleLength, setAvgCycleLength] = useState("28");
  const [showPicker, setShowPicker] = useState(false);
  const [dietChips, setDietChips] = useState<string[]>([]);
  const [dietNotes, setDietNotes] = useState("");
  const [personalGoalsText, setPersonalGoalsText] = useState("");
  const [tone, setTone] = useState<Tone>("bestie");
  const [startDest, setStartDest] = useState<StartDest>("workout");
  const [saving, setSaving] = useState(false);

  // Drives the optional "Add measurements" disclosure on the Snapshot screen.
  // When open it reveals the waist/neck/hip steppers (renderMeasurementSteppers),
  // wired to the same measurement state + touched-gating the standalone step used.
  const [showMeasurements, setShowMeasurements] = useState(false);

  // Birth-date picker state.
  const initialBirthDateRef = useRef<Date>(defaultBirthDate());
  const [birthDate, setBirthDate] = useState<Date>(initialBirthDateRef.current);
  const [showBirthPicker, setShowBirthPicker] = useState(false);
  const [birthDateChanged, setBirthDateChanged] = useState(false);

  // Body steppers.
  const [heightIn, setHeightIn] = useState(HEIGHT_DEFAULT_IN);
  const [heightTouched, setHeightTouched] = useState(false);
  const [weightLb, setWeightLb] = useState(WEIGHT_DEFAULT_LB);
  const [weightTouched, setWeightTouched] = useState(false);
  const [goalWeightLb, setGoalWeightLb] = useState(GOAL_WEIGHT_DEFAULT_LB);
  const [goalWeightTouched, setGoalWeightTouched] = useState(false);

  // Body-measurement steppers (waist / neck / hip in inches).
  const [waistIn, setWaistIn] = useState(WAIST_DEFAULT_IN);
  const [waistTouched, setWaistTouched] = useState(false);
  const [neckIn, setNeckIn] = useState(NECK_DEFAULT_IN);
  const [neckTouched, setNeckTouched] = useState(false);
  const [hipIn, setHipIn] = useState(HIP_DEFAULT_IN);
  const [hipTouched, setHipTouched] = useState(false);

  // Photo "calibration" step — strictly optional, use-then-discard.
  const [currentFrontUri, setCurrentFrontUri] = useState<string | null>(null);
  const [currentFrontBase64, setCurrentFrontBase64] = useState<string | null>(null);
  const [currentSideUri, setCurrentSideUri] = useState<string | null>(null);
  const [currentSideBase64, setCurrentSideBase64] = useState<string | null>(null);
  const [goalUri, setGoalUri] = useState<string | null>(null);
  const [goalBase64, setGoalBase64] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibratedFacts, setCalibratedFacts] = useState<string[]>([]);
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
  const [calibrationUsedNavyBF, setCalibrationUsedNavyBF] = useState(false);

  function openPicker() {
    if (!lastPeriodStart) setLastPeriodStart(toISODate(new Date()));
    setShowPicker((s) => !s);
  }

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "set" && date) setLastPeriodStart(toISODate(date));
  }

  function applyBirthDate(d: Date) {
    setBirthDate(d);
    setBirthDateChanged(true);
    setAge(String(ageFromBirthDate(d, new Date())));
  }
  function onChangeBirthDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") {
      setShowBirthPicker(false);
      if (event.type === "set" && date && !sameDay(date, initialBirthDateRef.current)) {
        applyBirthDate(date);
      }
      return;
    }
    if (date && !sameDay(date, initialBirthDateRef.current)) {
      applyBirthDate(date);
    }
  }

  function toggleBirthPicker() {
    setShowBirthPicker((s) => !s);
  }

  function toggleDietChip(key: string) {
    setDietChips((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

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
  function onGoalWeightChange(next: number) {
    setGoalWeightLb(next);
    setGoalWeightTouched(true);
  }
  function onWaistChange(next: number) {
    setWaistIn(next);
    setWaistTouched(true);
  }
  function onNeckChange(next: number) {
    setNeckIn(next);
    setNeckTouched(true);
  }
  function onHipChange(next: number) {
    setHipIn(next);
    setHipTouched(true);
  }

  // Cycle-length stepper. avgCycleLength is a string in state; keep that contract.
  function onCycleLenChange(next: number) {
    setAvgCycleLength(String(next));
  }

  // --- Photo step helpers ----------------------------------------------------
  type PhotoSlot = "front" | "side" | "goal";

  async function pickPhoto(slot: PhotoSlot, source: "camera" | "library") {
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
      if (slot === "front") {
        setCurrentFrontUri(asset.uri);
        setCurrentFrontBase64(base64);
      } else if (slot === "side") {
        setCurrentSideUri(asset.uri);
        setCurrentSideBase64(base64);
      } else {
        setGoalUri(asset.uri);
        setGoalBase64(base64);
      }
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  function offerPickPhoto(slot: PhotoSlot) {
    const title =
      slot === "front"
        ? "Add a front photo"
        : slot === "side"
          ? "Add a side photo"
          : "Add a photo of where you want to go";
    Alert.alert(title, "Optional — you can always skip.", [
      { text: "Take photo", onPress: () => void pickPhoto(slot, "camera") },
      { text: "Choose from library", onPress: () => void pickPhoto(slot, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function removePhoto(slot: PhotoSlot) {
    if (slot === "front") {
      setCurrentFrontUri(null);
      setCurrentFrontBase64(null);
    } else if (slot === "side") {
      setCurrentSideUri(null);
      setCurrentSideBase64(null);
    } else {
      setGoalUri(null);
      setGoalBase64(null);
    }
  }

  async function runCalibration(): Promise<{
    result: CalibrationResult | null;
    facts: string[];
    usedNavyBF: boolean;
  }> {
    const front = currentFrontBase64;
    const side = currentSideBase64;
    const dst = goalBase64;
    setCurrentFrontBase64(null);
    setCurrentSideBase64(null);
    setGoalBase64(null);
    if (!front && !side && !dst) return { result: null, facts: [], usedNavyBF: false };
    if (!hasApiKey()) return { result: null, facts: [], usedNavyBF: false };

    const partial: Profile = {
      waistIn: waistTouched ? waistIn : undefined,
      neckIn: neckTouched ? neckIn : undefined,
      hipIn: hipTouched ? hipIn : undefined,
      height: height || "",
    } as unknown as Profile;
    const navyBF = navyBodyFatPercent(partial);

    try {
      const result = await calibrateFromPhotos(
        front ?? undefined,
        side ?? undefined,
        dst ?? undefined,
        {
          age: age || undefined,
          height: height || undefined,
          weight: weight || undefined,
          activityLevel,
          navyBodyFatPercent: navyBF ?? undefined,
          coachMemory: [],
        }
      );
      const facts: string[] = [];
      if (result.goal_direction) facts.push(`goal direction: ${result.goal_direction}`);
      if (result.training_emphasis) facts.push(`training emphasis: ${result.training_emphasis}`);
      if (result.motivation) facts.push(`motivation: ${result.motivation}`);
      if (result.body_fat_range) facts.push(`body composition estimate: ${result.body_fat_range}`);
      return { result, facts, usedNavyBF: navyBF != null };
    } catch {
      return { result: null, facts: [], usedNavyBF: false };
    }
  }

  const isLast = stepIndex === STEPS.length - 1;

  async function advanceFromPhotos() {
    if (calibrating) return;
    if (calibrationResult) {
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      return;
    }
    setCalibrating(true);
    try {
      const { result, facts, usedNavyBF } = await runCalibration();
      if (result) {
        setCalibratedFacts(facts);
        setCalibrationResult(result);
        setCalibrationUsedNavyBF(usedNavyBF);
        if (result.goal) setGoal(result.goal);
        if (result.goal_weight) {
          const match = result.goal_weight.match(/^(\d+)\s*lb$/i);
          if (match) {
            const n = Math.max(WEIGHT_MIN_LB, Math.min(WEIGHT_MAX_LB, parseInt(match[1], 10)));
            if (!isNaN(n)) {
              setGoalWeightLb(n);
              setGoalWeightTouched(true);
            }
          }
        }
      }
    } finally {
      setCalibrating(false);
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    }
  }

  function next() {
    if (isLast) {
      void finish();
      return;
    }
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

  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      let ageForProfile = age.trim();
      if (birthDateChanged && !ageForProfile) {
        ageForProfile = String(ageFromBirthDate(birthDate, new Date()));
        setAge(ageForProfile);
      }

      const chipFacts = dietChips
        .map((k) => DIET_CHIPS.find((c) => c.key === k)?.fact)
        .filter((f): f is string => !!f);
      const chipLabels = dietChips
        .map((k) => DIET_CHIPS.find((c) => c.key === k)?.label)
        .filter((l): l is string => !!l);
      const rulesParts = [...chipLabels, dietNotes.trim()].filter(Boolean);

      let profile: Profile = {
        name: name.trim(),
        goal,
        tone,
        dietaryRules: rulesParts.join(", "),
        // Both booleans are derived from the single chosen cycle mode so they
        // can never contradict each other (mirrors Settings → CycleEditor):
        // "off" disables tracking; "bc" keeps tracking on but flags birth
        // control; "track" is the natural-cycle path. Period/length only carry
        // through in "track" mode.
        onBirthControl: cycleMode === "bc",
        cycleTrackingEnabled: cycleMode !== "off",
        lastPeriodStart: cycleMode === "track" ? lastPeriodStart.trim() : "",
        avgCycleLength: cycleMode === "track" ? Number(avgCycleLength) || 28 : 28,
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
        goalWeight: goalWeightTouched ? `${goalWeightLb} lb` : "",
        activityLevel,
        calorieMode: "static",
        coachMemory: [],
        currentFrontPhotoUri: currentFrontUri ?? undefined,
        currentSidePhotoUri: currentSideUri ?? undefined,
        goalPhotoUri: goalUri ?? undefined,
        photoLog:
          currentFrontUri || currentSideUri
            ? [
                {
                  id: `seed-${Date.now()}`,
                  date: toISODate(new Date()),
                  frontUri: currentFrontUri ?? undefined,
                  sideUri: currentSideUri ?? undefined,
                },
              ]
            : [],
        waistIn: waistTouched ? waistIn : undefined,
        neckIn: neckTouched ? neckIn : undefined,
        hipIn: hipTouched ? hipIn : undefined,
      };

      const facts = [...chipFacts];
      const note = dietNotes.trim();
      if (note) facts.push(note);
      for (const f of calibratedFacts) facts.push(f);

      const personalGoalsTrimmed = personalGoalsText.trim();
      if (personalGoalsTrimmed) {
        const goalFacts = personalGoalsTrimmed
          .split(/\s*,\s*|\s*;\s*|\s+and\s+/i)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 8)
          .map((s) => `personal goal: ${s}`);
        for (const f of goalFacts) facts.push(f);
      }

      for (const f of facts) profile = addMemory(profile, f);

      await initProfile(profile);
      onDone(startDest);
    } catch {
      onDone(startDest);
    } finally {
      setSaving(false);
    }
  }

  // The coach welcome bubble copy on the final screen, mirroring the mockup's
  // coachWelcome(). Goal line keyed off the picked goal enum.
  const coachGoalLine: Record<Goal, string> = {
    lose_fat: "leaning out at a pace you can hold",
    tone_up: "recomposition — shape over scale",
    build_muscle: "building real, measurable strength",
    feel_better: "steady energy and consistency",
    maintain: "holding your shape with structure",
  };
  const coachWelcome =
    `Hi ${name.trim() || "there"} — I'm Wren, your coach. Here's how we work: I'll set your ` +
    `food and training plan around ${coachGoalLine[goal]}, check in daily, and adjust it to your ` +
    `cycle as we go. I'll keep you accountable — calm, never harsh. Let's get your first week mapped.`;

  // Editorial index header (hidden on Welcome). num/label come from INDEX_LABELS.
  const idxMeta = INDEX_LABELS[step];
  const showIndex = step !== "welcome";

  return (
    <View style={styles.flex}>
      {/* ================================================================== */}
      {/* AMBIENT BACKGROUND LAYER (3rd fidelity pass — JOB 1 + JOB 2)       */}
      {/* ------------------------------------------------------------------ */}
      {/* Non-interactive layer STACK behind the ScrollView. Fills the       */}
      {/* screen, pointerEvents="none", paints under the content (content    */}
      {/* are later siblings in the same parent, so they paint on top):      */}
      {/*   1. AmbientMesh — the faithful warm radial mesh (meshBackdrop +    */}
      {/*      five RadialGradient blooms via react-native-svg). Replaces the */}
      {/*      earlier core-RN bloom-circle scaffold (JOB 1).                 */}
      {/*   2. GRAIN — assets/grain.png (180×180 monochrome noise) tiled via  */}
      {/*      <Image resizeMode="repeat"> at ~0.045 opacity, painted OVER the */}
      {/*      mesh and UNDER the sheen. Approximates the mockup's grain @     */}
      {/*      .045 multiply (RN has no multiply blend). (JOB 2)               */}
      {/*   3. screenSheen — the mockup's top-left .screen:before highlight,  */}
      {/*      kept as a core-RN translucent corner wash.                     */}
      {/*                                                                    */}
      {/* SAFETY NOTE (honored): the "How your targets are set" infocard and  */}
      {/* the calibration recap render on an OPAQUE creamTile tile with       */}
      {/* overflow:hidden, so this ambient mesh never washes over the safety  */}
      {/* copy — the tile fully occludes the mesh behind it. The whole stack  */}
      {/* is pointerEvents="none" and behind content.                        */}
      <View style={styles.ambient} pointerEvents="none">
        <AmbientMesh width={winW} height={winH} />
        {/* grain: tiled monochrome-noise PNG over the mesh, under the sheen */}
        {/* pointerEvents inherits "none" from the ambient parent View; Image's
            RN typings don't accept the prop directly, and it can never be
            interactive behind content anyway. */}
        <Image
          source={require("../assets/grain.png")}
          resizeMode="repeat"
          style={styles.grain}
        />
        {/* top-left screen highlight (.screen:before), painted over the grain.
            Smooth SVG LinearGradient corner sheen — no hard edge. */}
        <ScreenSheen />
      </View>

      {/* Content stack (index header + ScrollView + footer). The ambient mesh
          above is an absoluteFill sibling BEHIND this stack, so it keeps painting
          full-bleed and stays pointerEvents="none". The tree stays:
          root <View flex> → ambient (absolute, behind) → [index header, ScrollView, footer].

          KEYBOARD HANDLING (attempt #5, custom, no-dependency): three prior
          approaches failed on RN 0.81 / React 19 / Expo Go SDK 54 —
          KeyboardAvoidingView (behavior="padding") only shrank the stack and pushed
          the pinned FOOTER up without scrolling the low textareas into view;
          ScrollView's automaticallyAdjustKeyboardInsets did not reliably follow the
          caret as the auto-growing textareas grew; and the
          react-native-keyboard-aware-scroll-view lib did not engage at all (old/
          unmaintained on this stack). The current solution is pure built-in RN: a
          Keyboard show/hide listener tracks kbHeight, that height is ADDED to the
          ScrollView's contentContainer paddingBottom (giving scrollToEnd somewhere
          to scroll), and the two multiline textareas (the last element on their
          step) call scrollToEnd on focus, on content-size growth, and once the
          keyboard finishes opening — lifting the field's bottom (where the caret is)
          above the keyboard and following the caret as the field grows. The footer
          sits at the screen bottom behind the keyboard while typing — expected;
          seeing the field you're typing in is the priority. */}
      {/* Editorial index progress header (hidden on Welcome). The top safe-area
          inset is added to its base padding so the header clears the status bar
          while the ambient mesh behind it still reaches the top edge. */}
      {showIndex && (
        <View style={[styles.index, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.indexNum}>
            {String(idxMeta.num).padStart(2, "0")}
            <Text style={styles.indexNumDim}> / 07</Text>
          </Text>
          <View style={styles.indexRule}>
            <View style={[styles.indexRuleFill, { width: `${(idxMeta.num / 7) * 100}%` }]} />
          </View>
          <Text style={styles.indexLabel}>{idxMeta.label}</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        // Base 40 (styles.container.paddingBottom) + the live keyboard height.
        // This extra room is the crux: it gives scrollToEnd somewhere to scroll
        // to so the last textarea's bottom lands just above the keyboard line.
        contentContainerStyle={[styles.container, { paddingBottom: 40 + kbHeight }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ---------------------------------------------------------------- */}
        {/* 0 — WELCOME */}
        {/* ---------------------------------------------------------------- */}
        {step === "welcome" && (
          // The Welcome step hides the index header, so the wordmark itself must
          // clear the status bar: add the top safe-area inset to the hero's base
          // padding while the ambient mesh keeps painting behind the status bar.
          <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
            <View style={styles.heroMark}>
              <Text style={styles.wordmark}>wren</Text>
              <Text style={styles.tagline}>A softer science</Text>
            </View>
            <Text style={styles.heroLede}>A structured coach{"\n"}that holds you to it.</Text>
            <Text style={styles.heroSub}>
              Your trainer and nutritionist in one — Wren builds the plan around your body and your
              cycle, then keeps you accountable to it, day after day.
            </Text>
            <View style={styles.hiw}>
              <View style={styles.hiwItem}>
                <Text style={styles.hiwNum}>01</Text>
                <Text style={styles.hiwText}>
                  <Text style={styles.hiwBold}>A daily plan</Text> for food and training, set for you
                  — not left to willpower.
                </Text>
              </View>
              <View style={styles.hiwItem}>
                <Text style={styles.hiwNum}>02</Text>
                <Text style={styles.hiwText}>
                  <Text style={styles.hiwBold}>Real check-ins</Text> that keep you honest and adjust
                  when life moves.
                </Text>
              </View>
              <View style={[styles.hiwItem, styles.hiwItemLast]}>
                <Text style={styles.hiwNum}>03</Text>
                <Text style={styles.hiwText}>
                  <Text style={styles.hiwBold}>Cycle-aware</Text> — intensity and fuel tuned to where
                  you are.
                </Text>
              </View>
            </View>
            <Text style={styles.note}>
              A few quick questions so your Coach can build your plan. Everything stays on your
              device.
            </Text>
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 1 — NAME */}
        {/* ---------------------------------------------------------------- */}
        {step === "basics" && (
          <View>
            <Eyebrow>Step 01 — The basics</Eyebrow>
            <Text style={styles.title}>What should{"\n"}I call you?</Text>
            <Text style={styles.sub}>
              So your Coach speaks to you directly — by name, every day.
            </Text>
            <FieldLabel>Your name</FieldLabel>
            <TextInput
              style={styles.uline}
              value={name}
              onChangeText={setName}
              placeholder="First name"
              placeholderTextColor={colors.divider}
            />
            <Text style={styles.micro}>You can change this anytime in Settings.</Text>
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 2 — GOAL */}
        {/* ---------------------------------------------------------------- */}
        {step === "goals" && (
          <View>
            <Eyebrow>Step 02 — Your goal</Eyebrow>
            <Text style={styles.title}>What are we{"\n"}working toward?</Text>
            <Text style={styles.sub}>
              This is the spine of your plan — your Coach builds training and targets around it.
            </Text>

            {/* The Goal screen is a clean 5-row picker (mockup). The photo-
                calibration recap + optional goal-weight stepper that used to live
                here was re-homed to the Meet-your-Coach (start) screen, where it
                always renders after calibration. setGoal is still set here; the
                calibration pipeline (advanceFromPhotos) may overwrite goal from a
                successful photo read. */}
            <View style={[styles.rows, styles.rowsSpaced]}>
              {GOAL_ROWS.map((g, i) => (
                <EditorialRow
                  key={g.key}
                  idx={`0${i + 1}`}
                  title={g.title}
                  desc={g.desc}
                  on={goal === g.key}
                  onPress={() => setGoal(g.key)}
                />
              ))}
            </View>

            <FieldLabel optional>In your words</FieldLabel>
            <TextInput
              style={styles.textarea}
              value={personalGoalsText}
              onChangeText={setPersonalGoalsText}
              placeholder="Snatched waist, stronger glutes, steady energy through my afternoons…"
              placeholderTextColor={colors.inkMuted}
              multiline
              onFocus={onTextareaFocus}
              onBlur={onTextareaBlur}
              onContentSizeChange={onTextareaGrow}
            />
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 3 — BODY */}
        {/* ---------------------------------------------------------------- */}
        {step === "body" && (
          <View>
            <Eyebrow>Step 03 — A bit about you</Eyebrow>
            <Text style={[styles.title, styles.titleSm]}>The numbers{"\n"}behind your targets.</Text>
            <Text style={styles.sub}>
              Your Coach uses these to set accurate daily targets. Optional — it can ask later.
            </Text>

            <FieldLabel>Date of birth</FieldLabel>
            <ValueRow
              value={age ? `Age ${age}` : ""}
              placeholder="Choose your birth date"
              filled={!!age}
              icon="📅"
              iconColor={colors.inkMuted}
              onPress={toggleBirthPicker}
            />
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
                    onPress={() => setShowBirthPicker(false)}
                  >
                    <Text style={styles.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <FieldLabel>Height</FieldLabel>
            <Stepper
              value={heightIn}
              min={HEIGHT_MIN_IN}
              max={HEIGHT_MAX_IN}
              display={formatHeight(heightIn)}
              onChange={onHeightChange}
              dimmed={!heightTouched}
              valueFontSize={28}
            />

            <FieldLabel>Weight</FieldLabel>
            <Stepper
              value={weightLb}
              min={WEIGHT_MIN_LB}
              max={WEIGHT_MAX_LB}
              display={`${weightLb} lb`}
              onChange={onWeightChange}
              dimmed={!weightTouched}
              valueFontSize={28}
            />

            <FieldLabel>How active are you?</FieldLabel>
            <View style={styles.rows}>
              {ACTIVITY_ROWS.map((a) => (
                <EditorialRow
                  key={a.key}
                  title={a.title}
                  desc={a.desc}
                  on={activityLevel === a.key}
                  onPress={() => setActivityLevel(a.key)}
                />
              ))}
            </View>
          </View>
        )}

        {/* Tape-measure measurements are NOT a standalone step — they live in  */}
        {/* the Snapshot screen below as an optional expander (renderMeasurement-*/}
        {/* Steppers), wired to the same waist/neck/hip state + touched-gating.  */}

        {/* ---------------------------------------------------------------- */}
        {/* 4 — SNAPSHOT (photos + infocard + optional measurements expander) */}
        {/* ---------------------------------------------------------------- */}
        {step === "photos" && (
          <View>
            <Eyebrow>Step 04 — Optional snapshot</Eyebrow>
            <Text style={[styles.title, styles.titleSm]}>Where you are,{"\n"}where you're going.</Text>
            <Text style={styles.sub}>
              A front and side photo now, plus one that captures the direction you want. Your Coach
              uses them to calibrate your plan and track progress.
            </Text>

            {/* Three dashed photo slots, mockup .photo-row. */}
            <View style={styles.photoRow}>
              <PhotoSlot
                label="Front"
                filled={!!currentFrontUri}
                uri={currentFrontUri}
                onPress={() => offerPickPhoto("front")}
                onRemove={() => removePhoto("front")}
                disabled={calibrating}
              />
              <PhotoSlot
                label="Side"
                filled={!!currentSideUri}
                uri={currentSideUri}
                onPress={() => offerPickPhoto("side")}
                onRemove={() => removePhoto("side")}
                disabled={calibrating}
              />
              <PhotoSlot
                label="Goal"
                filled={!!goalUri}
                uri={goalUri}
                onPress={() => offerPickPhoto("goal")}
                onRemove={() => removePhoto("goal")}
                disabled={calibrating}
              />
            </View>

            {/* Infocard — "How your targets are set". SAFETY COPY: kept verbatim
                in meaning and rendered at legible size/contrast (cocoaSoft on
                cream cardface, 12.5px+). Do not soften. */}
            <View style={styles.infocard}>
              <CardHighlight />
              <Text style={styles.infocardTitle}>How your targets are set</Text>
              <Text style={styles.infocardBody}>
                Your daily targets are computed from your stats with a safe minimum floor. Photos
                sharpen how your Coach reads your starting point and direction — they refine the
                plan, they don't replace the math.
              </Text>
            </View>

            {calibrating && (
              <View style={styles.calibratingRow}>
                <ActivityIndicator color={colors.ink} />
                <Text style={styles.calibratingText}>Reading what motivates you…</Text>
              </View>
            )}

            {/* Optional "Have a tape measure?" expander — the mockup's micro note,
                now an affordance that reveals the waist/neck/hip steppers folded
                in from the old measurements step. */}
            {!showMeasurements ? (
              <TouchableOpacity
                style={styles.expanderTrigger}
                onPress={() => setShowMeasurements(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.micro}>
                  Have a tape measure?{" "}
                  <Text style={styles.expanderLink}>Add waist / neck / hip</Text> for a more precise
                  body-comp read — or skip the step.
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.expanderOpen}>
                <View style={styles.expanderHead}>
                  <Text style={styles.expanderHeadLabel}>Measurements</Text>
                  <TouchableOpacity onPress={() => setShowMeasurements(false)} activeOpacity={0.7}>
                    <Text style={styles.expanderHeadHide}>HIDE</Text>
                  </TouchableOpacity>
                </View>
                {renderMeasurementSteppers()}
              </View>
            )}
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 5 — CYCLE */}
        {/* ---------------------------------------------------------------- */}
        {step === "cycle" && (
          <View>
            <Eyebrow>Step 05 — Your cycle</Eyebrow>
            <Text style={styles.title}>Built around{"\n"}your phase.</Text>
            <Text style={styles.sub}>
              Your Coach times training intensity and fuel to where you are in your cycle — so the
              plan works with your body.
            </Text>

            <FieldLabel>How should Coach handle your cycle?</FieldLabel>
            {/* 3-way cycle mode selector — mirrors Settings → Cycle. Mutually
                exclusive; reuses onboarding's own EditorialRow (title + subtitle
                + radio mark), not the Settings card styles. "off" disables cycle
                tracking app-wide; "bc" keeps tracking on but flags birth control.
                Period/length fields show only in "track" mode (below). */}
            <View style={styles.rows}>
              {CYCLE_MODE_ROWS.map((c) => (
                <EditorialRow
                  key={c.key}
                  title={c.title}
                  desc={c.desc}
                  on={cycleMode === c.key}
                  onPress={() => setCycleMode(c.key)}
                />
              ))}
            </View>

            {cycleMode === "track" && (
              <>
                <FieldLabel>Last period start</FieldLabel>
                <ValueRow
                  value={lastPeriodStart}
                  placeholder="Choose a date"
                  filled={!!lastPeriodStart}
                  icon="📅"
                  iconColor={colors.period}
                  onPress={openPicker}
                />
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

                <FieldLabel>Average cycle length</FieldLabel>
                <Stepper
                  value={Number(avgCycleLength) || 28}
                  min={CYCLE_MIN}
                  max={CYCLE_MAX}
                  display={`${Number(avgCycleLength) || 28} days`}
                  onChange={onCycleLenChange}
                  valueFontSize={28}
                />
                {/* SAFETY/learning micro-copy preserved verbatim in meaning. */}
                <Text style={styles.micro}>
                  A starting estimate. Log periods over time and Wren learns your real average.
                </Text>
              </>
            )}
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 6 — FOOD */}
        {/* ---------------------------------------------------------------- */}
        {step === "diet" && (
          <View>
            <Eyebrow>Step 06 — How you eat</Eyebrow>
            <Text style={styles.title}>What should I{"\n"}plan around?</Text>
            <Text style={styles.sub}>
              Your Coach factors these into every meal it suggests, from day one.
            </Text>

            <FieldLabel>Preferences</FieldLabel>
            <View style={styles.chips}>
              {DIET_CHIPS.map((c) => (
                <Chip
                  key={c.key}
                  label={c.label}
                  on={dietChips.includes(c.key)}
                  onPress={() => toggleDietChip(c.key)}
                />
              ))}
            </View>

            <FieldLabel optional>Anything else?</FieldLabel>
            <TextInput
              style={styles.textarea}
              value={dietNotes}
              onChangeText={setDietNotes}
              placeholder="No shellfish, lactose intolerant, hate cilantro…"
              placeholderTextColor={colors.inkMuted}
              multiline
              onFocus={onTextareaFocus}
              onBlur={onTextareaBlur}
              onContentSizeChange={onTextareaGrow}
            />
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 7 — VOICE */}
        {/* ---------------------------------------------------------------- */}
        {step === "tone" && (
          <View>
            <Eyebrow>Step 07 — Your Coach's voice</Eyebrow>
            <Text style={[styles.title, styles.titleSm]}>How should it{"\n"}hold you to it?</Text>
            <Text style={styles.sub}>
              Same structure, same accountability — you choose the delivery.
            </Text>
            <View style={[styles.rows, styles.rowsSpaced]}>
              {TONE_ROWS.map((tn) => (
                <EditorialRow
                  key={tn.key}
                  title={tn.title}
                  desc={tn.desc}
                  on={tone === tn.key}
                  onPress={() => setTone(tn.key)}
                />
              ))}
            </View>
          </View>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 8 — MEET YOUR COACH */}
        {/* ---------------------------------------------------------------- */}
        {step === "start" && (
          <View>
            <View style={styles.coachIntro}>
              <Eyebrow>{`Your plan is ready${name.trim() ? `, ${name.trim()}` : ""}`}</Eyebrow>
              <Text style={styles.title}>Meet{"\n"}your Coach.</Text>
            </View>

            <View style={styles.coachHead}>
              <Text style={styles.coachPill}>wren</Text>
              <Text style={styles.coachMeta}>WREN COACH · NOW</Text>
            </View>
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{coachWelcome}</Text>
            </View>

            {/* Re-homed calibration recap (was the Goal-screen auto-card in the
                pre-redesign flow). When photos calibrated successfully it shows a
                read-only "what your Coach picked up" list of the qualitative facts
                + the optional goal-weight stepper. These facts are the same
                strings that reach Coach memory in finish() (calibratedFacts); the
                goal-weight value flows to Profile.goalWeight only when touched.
                Calibration NEVER produces a body-weight estimate — only the
                qualitative facts below — and goal weight is validated against the
                healthy-BMI floor inside calibrateFromPhotos (lib/coach.ts). */}
            {calibrationResult && calibratedFacts.length > 0 && (
              <View style={styles.recap}>
                <CardHighlight />
                <Text style={styles.recapTitle}>What your Coach picked up</Text>
                {calibratedFacts.map((f, i) => (
                  <View key={i} style={styles.recapRow}>
                    <Text style={styles.recapDot}>—</Text>
                    <Text style={styles.recapText}>{f}</Text>
                  </View>
                ))}
                {calibrationUsedNavyBF && (
                  <Text style={styles.recapMicro}>
                    Body-comp read anchored to your tape measurements.
                  </Text>
                )}
                <FieldLabel optional>Goal weight</FieldLabel>
                <Stepper
                  value={goalWeightLb}
                  min={WEIGHT_MIN_LB}
                  max={WEIGHT_MAX_LB}
                  display={`${goalWeightLb} lb`}
                  onChange={onGoalWeightChange}
                  dimmed={!goalWeightTouched}
                />
                <Text style={styles.recapMicro}>
                  {goalWeightTouched
                    ? "Your Coach pre-filled this from your snapshot — adjust if you like."
                    : "Optional — leave it and your Coach won't set a goal weight."}
                </Text>
              </View>
            )}

            <FieldLabel>Where do you want to start?</FieldLabel>
            <ChoiceCard
              title="Build my plan"
              desc="Your Coach lays out this week's training and daily targets, tuned to your goal and cycle."
              on={startDest === "workout"}
              onPress={() => setStartDest("workout")}
            />
            <ChoiceCard
              title="Set my plan together"
              desc="Talk it through with your Coach first, then lock in the week."
              on={startDest === "coach"}
              onPress={() => setStartDest("coach")}
            />
          </View>
        )}
      </ScrollView>

      {/* ------------------------------------------------------------------ */}
      {/* FOOTER — Back · (Skip) · Next/Begin/Build pill */}
      {/* ------------------------------------------------------------------ */}
      <View style={[styles.footer, { paddingBottom: Math.max(28, insets.bottom + 16) }]}>
        {stepIndex > 0 ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={back}
            disabled={saving || calibrating}
            activeOpacity={0.6}
          >
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        ) : null}

        {stepIndex > 0 && OPTIONAL_STEPS.includes(step) ? (
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))}
            disabled={saving || calibrating}
            activeOpacity={0.6}
          >
            <Text style={styles.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        ) : null}

        <SheenPill onPress={next} disabled={saving || calibrating}>
          <Text style={styles.nextText}>
            {step === "welcome"
              ? "Begin"
              : isLast
                ? saving
                  ? "Setting up…"
                  : startDest === "workout"
                    ? "Build my plan"
                    : "Start together"
                : step === "photos" && calibrating
                  ? "Reading…"
                  : "Continue"}
          </Text>
          {!saving && !calibrating ? <Text style={styles.nextArrow}>{ARROW}</Text> : null}
        </SheenPill>
      </View>
    </View>
  );

  // --- Inline render helper for the three measurement steppers ---------------
  // Rendered inside the Snapshot expander. Kept inside the component so it closes
  // over the stepper state + handlers without prop-drilling.
  function renderMeasurementSteppers() {
    return (
      <View>
        <FieldLabel>Waist (in)</FieldLabel>
        <Stepper
          value={waistIn}
          min={WAIST_MIN_IN}
          max={WAIST_MAX_IN}
          display={`${waistIn} in`}
          onChange={onWaistChange}
          dimmed={!waistTouched}
        />
        <Text style={styles.micro}>Measure the narrowest point, just above the navel.</Text>

        <FieldLabel>Neck (in)</FieldLabel>
        <Stepper
          value={neckIn}
          min={NECK_MIN_IN}
          max={NECK_MAX_IN}
          display={`${neckIn} in`}
          onChange={onNeckChange}
          dimmed={!neckTouched}
        />
        <Text style={styles.micro}>Measure just below the larynx.</Text>

        <FieldLabel>Hip (in)</FieldLabel>
        <Stepper
          value={hipIn}
          min={HIP_MIN_IN}
          max={HIP_MAX_IN}
          display={`${hipIn} in`}
          onChange={onHipChange}
          dimmed={!hipTouched}
        />
        <Text style={styles.micro}>Measure the widest point of your hips/glutes.</Text>
      </View>
    );
  }
}

// Dashed photo slot — empty shows a circular "+" badge + uppercase label; filled
// shows the thumbnail with a small remove control. Matches the mockup .pslot.
function PhotoSlot({
  label,
  filled,
  uri,
  onPress,
  onRemove,
  disabled,
}: {
  label: string;
  filled: boolean;
  uri: string | null;
  onPress: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  if (filled && uri) {
    return (
      <View style={[styles.pslot, styles.pslotOn]}>
        <Image source={{ uri }} style={styles.pslotImage} />
        <TouchableOpacity
          style={styles.pslotRemove}
          onPress={onRemove}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Text style={styles.pslotRemoveText}>✕</Text>
        </TouchableOpacity>
        <Text style={[styles.pslotLabel, styles.pslotLabelOn]}>{label}</Text>
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={styles.pslot}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={styles.pslotBadge}>
        <Text style={styles.pslotBadgeText}>+</Text>
      </View>
      <Text style={styles.pslotLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// Choice card on the Meet-your-Coach screen — title + description + circular
// radio mark. Matches the mockup .choice.
function ChoiceCard({
  title,
  desc,
  on,
  onPress,
}: {
  title: string;
  desc: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.choice, on && styles.choiceOn]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {on ? <CardHighlight /> : null}
      <View style={styles.choiceText}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDesc}>{desc}</Text>
      </View>
      <View style={[styles.mark, on && styles.markOn, styles.choiceMark]}>
        {on ? <View style={styles.markDot} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// STYLES — translated from the mockup's CSS to RN, all colors via lib/theme.
// Mockup → token map: --ink/--ink2→ink/cocoaSoft, --clay→inkMuted, --mist→
// divider, --tan→handle, --period→period, --cream/--glaze→creamTile/surface,
// --slate→mistDark, --vapor→surfaceMuted. Decorative mesh/grain/orb omitted.
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // 3rd pass: root is the mockup's warm backdrop (meshBackdrop) so the ambient
  // mesh blooms fade INTO the warm field rather than onto flat cream. The
  // ScrollView content itself is transparent so the mesh shows through.
  flex: { flex: 1, backgroundColor: colors.meshBackdrop },
  // Mockup body padding is 4px 28px 10px. 3rd pass: gutter 28→32 (proportional
  // to the wider ~430pt device) while keeping the column wide enough that the
  // bigger 50px headline's two-line {"\n"} breaks don't wrap awkwardly.
  // paddingBottom is generous (40) so the LAST fields on a step — the Goal
  // "in your words" textarea and the diet "anything else" textarea, both near the
  // end of the content — have room to scroll up clear of the keyboard. The
  // KeyboardAwareScrollView follows the focused field's caret (incl. as the
  // multiline grows) and lifts it above the keyboard by extraScrollHeight; this
  // bottom slack gives a field near the very end somewhere to scroll to. The
  // footer is a sibling OUTSIDE the scroll view, so this padding does not affect
  // the footer's resting position.
  container: { paddingHorizontal: 32, paddingTop: 4, paddingBottom: 40, backgroundColor: "transparent" },

  // ---- ambient background layer (3rd pass — JOB 1) ----
  // Full-screen non-interactive stack behind all content. absoluteFill so it
  // tracks the screen; pointerEvents none is set on the JSX element. The mesh
  // itself is the <AmbientMesh> react-native-svg painting (the earlier bloom-
  // circle scaffold styles were removed when the faithful mesh landed).
  ambient: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  // Tiled grain overlay (JOB 2): the 180×180 grain.png repeated across the full
  // screen via resizeMode="repeat". opacity 0.045 approximates the mockup's
  // grain @ .045 multiply (RN has no multiply blend). Sits over the mesh,
  // under the screenSheen; inside the pointerEvents="none" ambient layer.
  grain: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%", opacity: 0.045 },
  // Top-left screen highlight (.screen:before) is now the <ScreenSheen> SVG
  // LinearGradient component (smooth corner sheen, no hard edge) — the old flat
  // screenSheen View style was removed with the seam-fix pass.

  // ---- editorial index header ----
  // Mockup .index padding: 10px 28px 16px.
  index: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 28,
    paddingTop: 10,
    paddingBottom: 16,
  },
  indexNum: {
    fontSize: 11.5,
    letterSpacing: 2.5,
    color: colors.ink,
    fontFamily: ty.display.family,
  },
  indexNumDim: { color: colors.inkMuted, fontFamily: ty.label.family },
  indexRule: {
    flex: 1,
    height: 1.5,
    backgroundColor: colors.divider,
    borderRadius: 2,
    overflow: "hidden",
  },
  indexRuleFill: { height: "100%", backgroundColor: colors.ink, borderRadius: 2 },
  indexLabel: {
    fontSize: 11.5,
    letterSpacing: 2.5,
    color: colors.inkMuted,
    fontFamily: ty.display.family,
  },

  // ---- shared text voice ----
  eyebrow: {
    // 3rd pass: 9→10.5, tracking kept ~4 (mockup proportion on wider device).
    fontSize: 10.5,
    letterSpacing: 4,
    color: colors.inkMuted,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  // Display title. Mockup is Manrope 800 / 42px / -2 tracking / line-height .98.
  // 3RD FIDELITY PASS (device): on Ting's ~430pt-wide Pro Max the mockup's
  // literal 42px occupied a smaller fraction of the wider screen than it did in
  // the 366px mockup frame, so the headline read "minimized" and content top-
  // clustered. Per Ting's decision the display type + vertical rhythm are scaled
  // up ~1.18-1.2x to FIXED bigger values (intentionally NOT responsive) so the
  // headline owns the top third of a 430pt device and matches the mockup's
  // PROPORTIONS. 42→50, lineHeight ~0.98 ratio, tracking -2→-2.4, marginTop
  // 14→18. The {"\n"} hard line-breaks in titles are kept; the two-line titles
  // still break sensibly and don't overflow horizontally at this size on 430pt.
  title: {
    fontFamily: ty.displayHeavy.family,
    fontSize: 50,
    color: colors.ink,
    // Bug-fix: lineHeight was 49 (< fontSize), which on heavy Manrope_800ExtraBold
    // cropped the cap-height/ascenders of the FIRST line ("B" in "Built…", "W" in
    // "What…"). Raise to fontSize × ~1.08 (54) — smallest leading that clears the
    // clip while keeping the tight editorial stack. paddingTop 2 gives the first
    // line a hair of top room against the container edge; includeFontPadding off
    // keeps Android consistent with iOS.
    lineHeight: 54,
    letterSpacing: -2.4,
    marginTop: 18,
    paddingTop: 2,
    includeFontPadding: false,
  },
  // Bug-fix: lineHeight 41 (< fontSize 42) clipped the first line's caps; raise to
  // fontSize × ~1.07 (45).
  titleSm: { fontSize: 42, lineHeight: 45, letterSpacing: -1.8 },
  sub: {
    fontSize: 17,
    color: colors.cocoaSoft,
    lineHeight: 25,
    marginTop: 20,
    fontFamily: ty.body.family,
  },
  micro: {
    // 3rd pass: 11.5→13.5, leading + top gap opened ~1.18x to breathe.
    fontSize: 13.5,
    color: colors.inkMuted,
    lineHeight: 20,
    marginTop: 19,
    fontFamily: ty.body.family,
  },

  // ---- field label ----
  // 3rd pass: 10→11, marginTop 28→34, marginBottom 12→14 (rhythm ~1.18x).
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: colors.mistDark,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
    marginTop: 34,
    marginBottom: 14,
  },
  fieldLabelOpt: {
    color: colors.handle,
    letterSpacing: 0.5,
    fontFamily: ty.ui.family,
    textTransform: "none",
    fontSize: 13,
  },

  // ---- underline name input ----
  uline: {
    width: "100%",
    backgroundColor: "transparent",
    borderBottomWidth: 1.5,
    borderBottomColor: colors.divider,
    paddingHorizontal: 2,
    // Bug-fix: the 30px placeholder/value ("First name") was clipped at the top —
    // top room was too tight for the 30px glyphs. Give an explicit lineHeight of
    // ~38 (fontSize × 1.27) plus more paddingTop so the cap-height clears.
    paddingTop: 14,
    paddingBottom: 14,
    // 3rd pass: 26→30 to match scaled display rhythm.
    fontSize: 30,
    lineHeight: 38,
    includeFontPadding: false,
    fontFamily: ty.display.family,
    letterSpacing: -1,
    color: colors.ink,
  },

  // ---- textarea ----
  textarea: {
    width: "100%",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rowHairline,
    borderRadius: radius.lg,
    paddingHorizontal: 17,
    paddingVertical: 16,
    // 3rd pass: 14.5→16.5, leading + min-height opened ~1.18x.
    fontSize: 16.5,
    color: colors.ink,
    fontFamily: ty.body.family,
    minHeight: 88,
    lineHeight: 24,
    textAlignVertical: "top",
  },

  // ---- editorial selectable rows ----
  rows: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rowHairline },
  // Goal + Voice screens space the picker further from the lede (mockup .rows
  // style="margin-top:18px"); the Body screen's activity rows keep the default 6.
  // 3rd pass: picker offset 18→22 to hold proportion under the bigger lede.
  rowsSpaced: { marginTop: 22 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    // 3rd pass: row vertical padding 16→19 so the picker breathes and fills
    // more of the taller device, killing the dead zone above the footer.
    paddingVertical: 19,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rowHairline,
  },
  rowIdx: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.handle,
    fontFamily: ty.display.family,
    width: 24,
  },
  rowText: { flex: 1 },
  rowTitle: {
    // 3rd pass: 16.5→19.
    fontSize: 19,
    color: colors.ink,
    letterSpacing: -0.3,
    fontFamily: ty.label.family,
  },
  rowDesc: { fontSize: 14, color: colors.inkMuted, lineHeight: 20, marginTop: 4, fontFamily: ty.body.family },

  // ---- circular radio mark (rows + choice cards) ----
  // 3rd pass: radio mark 22→26 to stay proportional to the bigger row type.
  mark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: { borderColor: colors.ink, backgroundColor: colors.ink },
  markDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.surface },

  // ---- chips ----
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    // 3rd pass: chip padding opened ~1.18x.
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  // Selected chip: cocoa fill + a slight lift (mockup .chip.on translateY(-1px))
  // expressed as a soft shadow so the active chip reads tactile.
  chipOn: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  chipText: { fontSize: 16, color: colors.ink, fontFamily: ty.ui.family },
  chipTextOn: { color: colors.surface },

  // ---- tappable value row ----
  vrow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rowHairline,
    borderRadius: radius.lg,
    paddingHorizontal: 18,
    paddingVertical: 19,
  },
  // 3rd pass: 15→17.5 + icon to match.
  vrowValue: { fontSize: 17.5, color: colors.ink, fontFamily: ty.label.family },
  vrowPlaceholder: { color: colors.inkMuted, fontFamily: ty.ui.family },
  vrowIcon: { fontSize: 17.5, color: colors.inkMuted },

  // ---- mockup switch ----
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 6,
  },
  switchCopy: {
    flex: 1,
    // 3rd pass: 13→15.5, leading opened. BC framing copy stays verbatim/legible.
    fontSize: 15.5,
    color: colors.cocoaSoft,
    lineHeight: 22,
    fontFamily: ty.body.family,
  },
  switchTrack: {
    width: 52,
    height: 31,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    justifyContent: "center",
  },
  switchTrackOn: { backgroundColor: colors.ink },
  switchKnob: {
    position: "absolute",
    left: 3,
    width: 25,
    height: 25,
    borderRadius: 12.5,
    backgroundColor: colors.paper,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  switchKnobOn: { left: 24 },

  // ---- photo slots ----
  photoRow: { flexDirection: "row", gap: 11, marginTop: 4 },
  pslot: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    overflow: "hidden",
  },
  pslotOn: {
    borderStyle: "solid",
    borderColor: colors.calm,
    backgroundColor: colors.calmFill,
    // Selected photo lifts off the sheet (mockup .pslot.on depth).
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  pslotImage: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  pslotBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.inkMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  pslotBadgeText: { fontSize: 24, color: colors.inkMuted, fontFamily: ty.ui.family, lineHeight: 26 },
  pslotLabel: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.inkMuted,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  pslotLabelOn: {
    position: "absolute",
    bottom: 8,
    color: colors.paper,
    // subtle scrim handled by the image; keep label readable on photo
  },
  pslotRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(59,47,34,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  pslotRemoveText: { color: colors.surface, fontSize: 11, fontFamily: ty.label.family },

  // The card top-down highlight is now the <CardHighlight> SVG LinearGradient
  // component (smooth top→transparent fade, no hard edge) — the old flat
  // cardHighlight View style was removed with the seam-fix pass.

  // ---- infocard ----
  infocard: {
    backgroundColor: colors.creamTile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rowHairline,
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginTop: 20,
    overflow: "hidden",
    // Soft warm lift for dimension (mockup card depth).
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  infocardTitle: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: colors.mistDark,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  // SAFETY copy: "How your targets are set" — computed-from-stats / safe-minimum-
  // floor / refine-not-replace-the-math. 3rd pass scales it UP (12.5→15) with
  // the rest of the type, which only IMPROVES legibility. It sits on an OPAQUE
  // creamTile tile with overflow:hidden, so the ambient mesh/grain layer (added
  // this pass, behind the ScrollView) never washes over the safety text. Kept
  // verbatim; cocoaSoft on creamTile at 15px / 1.5 is comfortably above the
  // legibility floor. Do not soften or shrink.
  infocardBody: { fontSize: 15, color: colors.cocoaSoft, lineHeight: 22.5, marginTop: 11, fontFamily: ty.body.family },

  // ---- measurements expander ----
  expanderTrigger: { marginTop: 4 },
  expanderLink: { color: colors.ink, fontFamily: ty.label.family },
  expanderOpen: {
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rowHairline,
    paddingTop: 4,
  },
  expanderHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  expanderHeadLabel: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: colors.mistDark,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  expanderHeadHide: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.inkMuted,
    fontFamily: ty.display.family,
  },

  // ---- calibrating row ----
  calibratingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 19 },
  calibratingText: { color: colors.inkMuted, fontSize: 16, fontFamily: ty.body.family },

  // ---- welcome / hero ----
  hero: { paddingTop: 28 },
  heroMark: { marginTop: 28 },
  // 3rd pass: wordmark 58→68, tracking -3→-3.5, lineHeight to match.
  wordmark: { fontSize: 68, color: colors.ink, letterSpacing: -3.5, fontFamily: ty.displayHeavy.family, lineHeight: 68 },
  tagline: {
    fontSize: 11.5,
    letterSpacing: 6,
    color: colors.inkMuted,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
    marginTop: 18,
  },
  // 3rd pass: heroLede 24→28, tracking -1.2→-1.4, ~1.12 leading kept.
  heroLede: {
    fontSize: 28,
    color: colors.ink,
    lineHeight: 31,
    letterSpacing: -1.4,
    fontFamily: ty.displayHeavy.family,
    marginTop: 42,
  },
  // 3rd pass: heroSub 14.5→16.5, leading up proportionally.
  heroSub: { fontSize: 16.5, color: colors.cocoaSoft, lineHeight: 25, marginTop: 19, fontFamily: ty.body.family },
  hiw: { marginTop: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rowHairline },
  hiwItem: {
    flexDirection: "row",
    gap: 15,
    alignItems: "flex-start",
    // 3rd pass: 14→17 vertical so the welcome list fills the taller hero.
    paddingVertical: 17,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rowHairline,
  },
  hiwItemLast: {},
  hiwNum: { fontSize: 10.5, letterSpacing: 1.5, color: colors.handle, fontFamily: ty.display.family, marginTop: 3 },
  hiwText: { flex: 1, fontSize: 16, color: colors.ink, lineHeight: 23, fontFamily: ty.ui.family },
  hiwBold: { fontFamily: ty.display.family },
  note: { fontSize: 13, color: colors.handle, marginTop: 22, lineHeight: 19, fontFamily: ty.body.family },

  // ---- meet your coach ----
  coachIntro: { marginTop: 28 },
  coachHead: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24, marginBottom: 12 },
  coachPill: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: "hidden",
    fontSize: 13,
    color: colors.ink,
    letterSpacing: -0.3,
    fontFamily: ty.displayHeavy.family,
  },
  coachMeta: { fontSize: 10.5, letterSpacing: 2.5, color: colors.mistDark, fontFamily: ty.display.family },
  bubble: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 19,
    paddingVertical: 17,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderBottomLeftRadius: 7,
  },
  // 3rd pass: 14.5→16.5, leading up.
  bubbleText: { fontSize: 16.5, color: colors.ink, lineHeight: 25, fontFamily: ty.body.family },

  // ---- calibration recap (re-homed from the old Goal-screen auto-card) ----
  recap: {
    marginTop: 18,
    backgroundColor: colors.creamTile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rowHairline,
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 18,
    overflow: "hidden",
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  recapTitle: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: colors.mistDark,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  recapRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 9 },
  recapDot: { fontSize: 15, color: colors.handle, fontFamily: ty.body.family, lineHeight: 22 },
  recapText: { flex: 1, fontSize: 15, color: colors.cocoaSoft, lineHeight: 22, fontFamily: ty.body.family },
  recapMicro: {
    fontSize: 13.5,
    color: colors.inkMuted,
    lineHeight: 20,
    marginTop: 14,
    fontFamily: ty.body.family,
  },

  // ---- choice cards ----
  choice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: 21,
    marginTop: 14,
    overflow: "hidden",
  },
  // Selected choice card gets the mockup's cream→glaze gradient face (faked via
  // the cardHighlight overlay) + cocoa border + a soft lift so the selection
  // reads tactile/elevated rather than flat.
  choiceOn: {
    borderColor: colors.ink,
    backgroundColor: colors.creamTile,
    shadowColor: colors.ink,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  choiceText: { flex: 1 },
  choiceTitle: { fontSize: 19, color: colors.ink, fontFamily: ty.display.family },
  choiceDesc: { fontSize: 15, color: colors.cocoaSoft, lineHeight: 22, marginTop: 7, fontFamily: ty.body.family },
  choiceMark: { marginTop: 2 },

  // ---- iOS date picker Done ----
  doneBtn: { alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 12 },
  doneBtnText: { color: colors.ink, fontFamily: ty.label.family, fontSize: 15 },

  // ---- footer ----
  // Mockup .footer base padding 14px 26px 28px. Transparent (no hairline) so the
  // warm mesh runs unbroken behind the buttons to the bottom edge (Ting).
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 26,
    paddingTop: 14,
    paddingBottom: 28,
    // Transparent so the page's warm mesh shows through behind BACK/SKIP/CONTINUE
    // and runs unbroken to the bottom edge (Ting). No top hairline — a line across
    // the mesh would read as a seam; the footer is a seamless part of the page.
    backgroundColor: "transparent",
  },
  backBtn: { paddingVertical: 16, paddingHorizontal: 6 },
  backBtnText: {
    color: colors.inkMuted,
    fontSize: 12.5,
    letterSpacing: 1.5,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  skipBtn: { paddingVertical: 16, paddingHorizontal: 6 },
  skipBtnText: {
    color: colors.inkMuted,
    fontSize: 12.5,
    letterSpacing: 1.5,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  next: {
    flex: 1,
    backgroundColor: colors.ink,
    paddingVertical: 19,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    // Clip the sweeping sheen bar to the pill shape (mockup overflow:hidden).
    overflow: "hidden",
  },
  // Mockup gives the CTA a slight lift for dimension — a soft warm cocoa shadow.
  nextShadow: {
    shadowColor: colors.ink,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  nextGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.ink },

  // ---- CTA sheen sweep (mockup .next:before) ----
  // Full-height skewed bar; absolute so it sits over the fill but under the
  // label is fine too (white-on-cocoa it reads as a passing highlight). The
  // transparent→white→transparent falloff is faked with three vertical bands.
  sheen: {
    position: "absolute",
    top: -4,
    bottom: -4,
    left: 0,
    flexDirection: "row",
  },
  sheenBand: { flex: 1, height: "100%" },
  sheenBandSoft: { backgroundColor: "rgba(255,255,255,0.06)" },
  sheenBandCore: { backgroundColor: "rgba(255,255,255,0.18)" },
  nextText: {
    color: colors.surface,
    fontSize: 13,
    letterSpacing: 2.5,
    fontFamily: ty.display.family,
    textTransform: "uppercase",
  },
  nextArrow: { color: colors.surface, fontSize: 17, fontFamily: ty.label.family },
});
