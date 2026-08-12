import { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  AccessibilityInfo,
} from "react-native";
import Svg, { Defs, RadialGradient, Stop, Rect, Line } from "react-native-svg";
import {
  Profile,
  WorkoutEntry,
  WorkoutExercise,
  WorkoutKind,
  ACTIVITY_OPTIONS,
  PlanSetup,
  PlanDay,
  PlanDayKind,
  PlanExercise,
  PlanSection,
  WeekPlan,
  Weekday,
  DayIntensity,
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
  estimateExerciseBurn,
  repsToMinutes,
  resolveWorkoutBurn,
  profileWeightKg,
  newId,
} from "../lib/workouts";
import {
  weekdayKey,
  dateForWeekday,
  dayExercises,
  dayLogged,
  dayComplete,
  weekProgress,
  planDayToWorkoutEntry,
  weekReviewSummary,
  isWeekComplete,
  defaultSectionIndex,
} from "../lib/plan";
import { generateWeekPlan } from "../lib/coach";
import {
  colors,
  radius,
  phaseColors,
  fontExtrabold,
  fontBold,
  fontSemibold,
  fontMedium,
  fontRegular,
} from "../lib/theme";
// Shared with OnboardingScreen (height/weight/goal-weight steppers). Replaced
// the iOS countdown DateTimePicker that previously hosted "Time per session" —
// the picker was the crash surface on the onboarding → workout auto-open
// transition (Modal slide-in + UIDatePicker mount during the same commit as
// six simultaneous screen mounts). Stepper is pure RN, no native bridge.
import { Stepper } from "../components/Stepper";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSwipeDismiss } from "../components/useSwipeDismiss";

// ---------------------------------------------------------------------------
// CardBloom — a single, barely-there soft corner glow behind the LOG-view
// "This week so far" summary card (mockup .summary) and the PLAN-view program
// card (mockup .program):
//   summary : sage  glow anchored BOTTOM-LEFT
//   program : rose→honey glow anchored TOP-RIGHT
//
// Why no linear base: the mockup's 162deg warm-cream linear (#F6EFE4→#FCF8F1)
// is a ~2% warm shift — imperceptible, and in RN-SVG it stacked a SECOND diagonal
// seam on top of the radial. We drop it entirely and let the card's flat
// `colors.creamTile` fill be the base; CardBloom now paints ONLY the radial.
//
// Why userSpaceOnUse + a large fixed radius: in objectBoundingBox units a circle
// is stretched into an ellipse on these WIDE cards, so the falloff read as an
// elongated disc with a visible edge. We measure the card with onLayout and place
// the radial in pixel space, centered on the chosen corner, with a radius ~1.15×
// the card width so the falloff is gentle and uniform across the whole card and
// dissolves fully to transparent (last stop offset=1) before the far edge — no
// disc boundary, no wedge, no seam. Peak opacities are kept low (sage ~0.16,
// rose ~0.14 → honey ~0.08) so it reads as a faint warm/sage corner tint, not a
// defined shape. Until the card has measured (w/h 0), we render nothing — a clean
// flat card is the correct fallback, never a goofy gradient.
//
// Rendered as a StyleSheet.absoluteFill layer BEHIND the card's text; the card
// View clips it via overflow:hidden + borderRadius and the text children sit on
// top in normal flow. pointerEvents="none" so it never intercepts taps. Hues map
// to brand tokens: profileSage (#A8B89B), profileRose (#D4A89E), honey (#E8B86A).
// Kept subtle so the safety-neutral factual recap copy stays fully legible —
// copy unchanged.
// ---------------------------------------------------------------------------
function CardBloom({ variant }: { variant: "summary" | "program" }) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Anchor the glow on a corner in pixel space; radius scales with card width so
  // the falloff is gentle and uniform on the wide card (no ellipse stretch).
  const cx = variant === "summary" ? 0 : size.w; // bottom-left vs top-right
  const cy = variant === "summary" ? size.h : 0;
  const r = size.w * 1.15;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
      }}
    >
      {size.w > 0 && size.h > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            {variant === "summary" ? (
              // Faint sage glow, bottom-left corner, dissolving fully by the edge.
              <RadialGradient
                id="bloom-sage"
                gradientUnits="userSpaceOnUse"
                cx={cx}
                cy={cy}
                r={r}
                fx={cx}
                fy={cy}
              >
                <Stop offset="0" stopColor={colors.profileSage} stopOpacity={0.16} />
                <Stop offset="0.55" stopColor={colors.profileSage} stopOpacity={0.06} />
                <Stop offset="1" stopColor={colors.profileSage} stopOpacity={0} />
              </RadialGradient>
            ) : (
              // Faint rose core fading through honey to transparent, top-right.
              <RadialGradient
                id="bloom-rosehoney"
                gradientUnits="userSpaceOnUse"
                cx={cx}
                cy={cy}
                r={r}
                fx={cx}
                fy={cy}
              >
                <Stop offset="0" stopColor={colors.profileRose} stopOpacity={0.14} />
                <Stop offset="0.5" stopColor={colors.honey} stopOpacity={0.08} />
                <Stop offset="1" stopColor={colors.honey} stopOpacity={0} />
              </RadialGradient>
            )}
          </Defs>
          <Rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={variant === "summary" ? "url(#bloom-sage)" : "url(#bloom-rosehoney)"}
          />
        </Svg>
      ) : null}
    </View>
  );
}

// Loading-spinner tint — cocoa ink, matching the rest of the redesigned screen.
const SPINNER = colors.ink;

// Plan-setup session-length stepper bounds. 15-min floor (anything shorter is
// effectively a walk, not a workout); 2-hour ceiling (covers long-run / long-
// gym days); 5-min increments so taps feel meaningful and the press-and-hold
// repeat doesn't blow past a usable range.
const SESSION_MIN_MINUTES = 15;
const SESSION_MAX_MINUTES = 120;
const SESSION_STEP_MINUTES = 5;

const PHASE_LEAN: Record<string, string> = {
  menstrual: "This is usually a gentler stretch — mobility, walks, lighter lifts. Go by how you feel.",
  follicular: "Energy often climbs here — a good window to push intensity or chase a PR.",
  ovulatory: "Often peak strength and energy — great for harder training. Keep water up.",
  luteal: "Energy tends to settle here — moderate, lower-volume work and a bit more recovery fit well.",
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

// Intensity "pin" colors + labels for the day-card sub-row (mockup .pin /
// .int-*). light→calm slate, moderate→handle tan, hard→period ember, rest→mist.
const INTENSITY_PIN: Record<DayIntensity, { dot: string; text: string; label: string }> = {
  light: { dot: colors.calm, text: colors.mistDark, label: "Light" },
  moderate: { dot: colors.handle, text: colors.cocoaSoft, label: "Moderate" },
  hard: { dot: colors.period, text: colors.period, label: "Hard" },
  rest: { dot: colors.divider, text: colors.inkMuted, label: "Recovery" },
};

// Day-of-month number for a weekday within the current plan week (mockup .ddate
// .n). Derived from the week's Monday startDate + the weekday's Mon..Sun offset.
function weekdayDateNum(startMonISO: string, wd: Weekday): number {
  return parseISO(dateForWeekday(startMonISO, wd)).getDate();
}

// Initials for the header avatar (mockup .avatar "TG"). Up to two letters from
// the profile name; returns "" when there's no name so the avatar renders as a
// clean cocoa circle (no stray "·" glyph) rather than a placeholder character.
function profileInitials(name?: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

function dayLabel(iso: string): string {
  const today = toISODate(new Date());
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return "Yesterday";
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Workout-LOCAL Sun-first week model (DISPLAY ONLY).
//
// The shared week model in lib/plan.ts is a rolling 7-day window anchored on the
// plan's OWN startDate (fresh plans start today; rollovers continue +7). Its
// exports — dateForWeekday, the Weekday order, WEEKDAY_LABELS — are anchor-
// agnostic and backward-compatible with old Monday-anchored stored plans, and
// lib/coach.ts generation + the Progress tab depend on them. Ting chose "Workout
// tab only" for the Sun–Sat display, so everything below is screen-local and only
// changes how the Workout tab ORDERS and GROUPS cells. We never touch a shared
// export.
//
// All planned/done/rest lookups are driven by REAL CALENDAR DATES: a cell knows
// its ISO date, and we resolve its plan day by matching that date against the
// stored WeekPlan via the plan's own dateForWeekday(startDate) mapping. Because
// that mapping is anchored on the plan's startDate (any weekday), a today-
// anchored plan's days land on their true calendar dates and show on the Sun–Sat
// strip with no off-by-one — we never re-derive a weekday by array position.
// ---------------------------------------------------------------------------
const WD_SUNFIRST: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ISO date of the Sunday of the week containing d. Workout-local mirror of the
// shared mondayOf (which we must not change); used only to anchor the Sun-first
// display strip and the Sun-first plan-setup day-picker grouping.
function sundayOf(d: Date = new Date()): string {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay()); // getDay(): 0=Sun..6=Sat → back to Sunday
  return toISODate(s);
}

// How many weeks back/forward the scrollable date strip spans, anchored on the
// Sunday of the current week. ~5 weeks back through ~4 ahead keeps recent
// history reviewable and a little runway ahead without a virtualized list.
const STRIP_WEEKS_BACK = 5;
const STRIP_WEEKS_AHEAD = 4;

// Cell sizing for the scrollable strip — fixed width so the auto-center math is
// deterministic. Mirrors the old stripDd circle metrics (34px) plus label.
const STRIP_CELL_W = 38;
const STRIP_CELL_MX = 3;

// A single date cell in the scrollable multi-week strip.
type StripCell = { iso: string; dn: string; num: number };

// Build the flat Sun→Sat list of date cells spanning the configured range,
// anchored on this week's Sunday. Grouping into Sun–Sat weeks is implicit in the
// order (every 7 cells starts a new Sunday); we render with a small gap between
// week-groups via the index. dn = single weekday letter (S M T W T F S).
function buildStripCells(): StripCell[] {
  const startSun = sundayOf(new Date());
  const firstISO = addDays(startSun, -STRIP_WEEKS_BACK * 7);
  const totalDays = (STRIP_WEEKS_BACK + STRIP_WEEKS_AHEAD + 1) * 7;
  const cells: StripCell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const iso = addDays(firstISO, i);
    const d = parseISO(iso);
    cells.push({ iso, dn: WEEKDAY_LABELS[WD_SUNFIRST[d.getDay()]][0], num: d.getDate() });
  }
  return cells;
}

// Resolve the plan day for a real ISO date against a stored (Mon-anchored)
// WeekPlan, but ONLY if the date falls inside that week (startDate..+6). We map
// each plan day to its real date via the plan's own dateForWeekday(startDate),
// so a Sun-first displayed date and the Mon-anchored stored day line up exactly
// — no off-by-one. Returns null when the date isn't in this week's plan.
function planDayForISO(week: WeekPlan | null, iso: string): PlanDay | null {
  if (!week) return null;
  if (iso < week.startDate || iso > addDays(week.startDate, 6)) return null;
  return week.days.find((d) => dateForWeekday(week.startDate, d.weekday) === iso) ?? null;
}

export default function WorkoutScreen({
  profile,
  updateProfile,
  onOpenCoach,
  onAdjustDayWithCoach,
  onOpenSettings,
  openSetupSignal,
  active = true,
}: {
  profile: Profile;
  // Shared updater (App.tsx): every transform runs against the LATEST profile,
  // so plan edits and workout logs compose with the Coach's writes instead of
  // one silently clobbering the other.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  onOpenCoach: () => void;
  // Open the Coach AND anchor the conversation to a specific plan day. Called
  // from a day card's "Or ask your Coach to adjust your plan →" link with the
  // day's real calendar date + a human label, so the Coach can lead with a
  // day-specific opener. Optional — when absent the link falls back to
  // onOpenCoach (plain tab switch), so it still works for callers/tests that
  // don't wire this.
  onAdjustDayWithCoach?: (ref: { dateISO: string; label: string }) => void;
  // Switch the app shell to the Settings tab. App owns navigation, so the header
  // avatar (mockup) routes through this — same pattern as CoachScreen's
  // onOpenSettings. Optional so other callers/tests can omit it; when absent the
  // avatar is rendered non-interactive rather than as a dead button.
  onOpenSettings?: () => void;
  // Counter bumped by App when onboarding finishes on the "create a workout plan"
  // path. Each increment auto-opens the plan-setup sheet (see effect below) so she
  // lands straight in setup. Optional so other callers/tests can omit it.
  openSetupSignal?: number;
  // True only while Workout is the visible tab. App.tsx keeps every screen mounted
  // and toggles inactive ones to display:none. A <Modal> nested inside a subtree
  // that flips to display:none after the modal was shown strands its native host
  // view (RCTModalHostView) on top of Workout — it keeps eating touches so the page
  // renders but ignores taps ("frozen"). visible={false} does NOT tear that host
  // down in this situation; only a real React unmount does. So we GATE every Modal
  // on `active` (absent from the tree when Workout is hidden) and force-close all
  // sheet state when active flips false. Mirrors FoodScreen / ProgressScreen.
  // Defaults true so the screen still works if mounted without the prop.
  active?: boolean;
}) {
  const today = toISODate(new Date());
  const phase = currentPhase(profile);
  const lean = !phase.onBirthControl && phase.phase in PHASE_LEAN ? PHASE_LEAN[phase.phase] : "";
  const weightKg = profileWeightKg(profile);

  // Whether we have a real, displayable cycle phase. lib/cycle returns
  // phase==="unknown" when there's no cycle data to anchor a phase (e.g. Ting's
  // profile). In that case the mockup never shows the eyebrow or the "· {phase}"
  // date suffix — so gate on this precisely rather than on the truthiness of the
  // capitalized string ("Unknown" is truthy). Birth control ("on birth control")
  // IS a real label and stays shown.
  // "off" (cycle tracking disabled) is treated exactly like "unknown" here: no
  // eyebrow, no day suffix, and PHASE_LEAN never matches it so no cycle-phase
  // note/adjustment is applied — training guidance stays steady like BC/unknown.
  const hasPhase = phase.phase !== "unknown" && phase.phase !== "off";

  // Header eyebrow above the lowercase "workout" title: "Luteal · Day 26".
  // Capitalize the phase name; append the cycle day when we have one. On birth
  // control / unknown phases we show just the phase label (no fabricated day).
  const phaseLabel = phase.phase.charAt(0).toUpperCase() + phase.phase.slice(1);
  const eyebrow = !hasPhase
    ? ""
    : phase.dayOfCycle != null
    ? `${phaseLabel} · Day ${phase.dayOfCycle}`
    : phaseLabel;
  // Tint the eyebrow with the current phase color where we have one (luteal →
  // dusty rose in the mockup), falling back to muted ink.
  const eyebrowColor = phaseColors[phase.phase]?.bg ?? colors.inkMuted;

  // Add sheet
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<"strength" | "activity">("strength");

  // Strength builder
  const [built, setBuilt] = useState<WorkoutExercise[]>([]);
  const [exName, setExName] = useState("");
  const [exSets, setExSets] = useState("3");
  const [exReps, setExReps] = useState("10");
  const [exWeight, setExWeight] = useState("");

  // Activity form
  const [actName, setActName] = useState("");
  const [actDur, setActDur] = useState("");
  const [actDist, setActDist] = useState("");

  // Shared "from your watch" inputs (reused by whichever form is open)
  const [wBurn, setWBurn] = useState("");
  const [wAvg, setWAvg] = useState("");
  const [wMax, setWMax] = useState("");

  // Edit existing
  const [editEntry, setEditEntry] = useState<WorkoutEntry | null>(null);
  const [eActName, setEActName] = useState("");
  const [eDur, setEDur] = useState("");
  const [eActDist, setEActDist] = useState("");
  const [eBurn, setEBurn] = useState("");
  const [eAvg, setEAvg] = useState("");
  const [eMax, setEMax] = useState("");

  // Workout tab has two sub-tabs: the tailored Plan, and the Log (calendar).
  const [activeTab, setActiveTab] = useState<"plan" | "log">("plan");

  // Selected day for the Log view. Defaults to today (so the heading reads
  // "Today" and the week strip highlights today's cell by default). The Log view
  // now reuses the Plan view's 7-cell Mon–Sun week strip for navigation instead
  // of a 42-day horizontal strip, so the old logDays/stripRef are gone.
  const [logSelDate, setLogSelDate] = useState(today);
  const selEntries = workoutsFor(profile, logSelDate);

  // Plan (Feature E)
  const plan = profile.plan;
  const week = plan?.current ?? null;
  // `selectedWd` is the day the accordion/strip last touched; it's the default
  // weekday for toggleExercise/toggleDayDone when they're called without one.
  const [selectedWd, setSelectedWd] = useState<Weekday>(weekdayKey());

  // Accordion: which day card in the week list is expanded. Presentation-only
  // local state (mockup opens today's card by default). Tapping a card head
  // toggles it; tapping an already-open card collapses it (matches mockup
  // toggleDay()). Defaults to today's weekday.
  const [openWeekday, setOpenWeekday] = useState<Weekday | null>(weekdayKey());

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

  // --- Per-day plan edit sheet (Part B) ---------------------------------------
  // editDayWd is the weekday of the day being edited (null = sheet closed). We
  // edit a flat local copy of that day's fields; on Save we rebuild a valid
  // PlanDay and write it back into plan.current.days via the wipe-guard. On a
  // STRENGTH day we flatten every section's exercises into one editable list
  // (edRows) and write them back into a single section on Save — simpler than
  // multi-section editing and keeps the PlanDay shape valid (the Coach and the
  // day-card renderer both handle a one-section strength day fine).
  type EditRow = { id: string; name: string; sets: string; reps: string; weight: string };
  const [editDayWd, setEditDayWd] = useState<Weekday | null>(null);
  // "training" vs "rest" is the Rest↔Training toggle; kind tracks whether a
  // training day is strength (exercise rows) or an activity/class (simple fields).
  const [edMode, setEdMode] = useState<"training" | "rest">("training");
  const [edKind, setEdKind] = useState<PlanDayKind>("strength");
  const [edTitle, setEdTitle] = useState("");
  const [edFocus, setEdFocus] = useState("");
  const [edIntensity, setEdIntensity] = useState<DayIntensity>("moderate");
  const [edRows, setEdRows] = useState<EditRow[]>([]);
  // Section snapshot taken at OPEN so Save can rebuild the day's NAMED sections
  // (Warm-up / Working sets / Core / Cool-down) instead of collapsing everything
  // into one "Workout" section. The flat editor (edRows) doesn't show section
  // headers, but each row keys to its origin section via its exercise id:
  //   - edSections: ordered { name, durationMin? } snapshot of the day's sections.
  //   - edRowSection: exerciseId -> section index. Rows whose id isn't in this map
  //     were added in the editor and land in the default section on Save.
  // Reordering rows in the flat list doesn't change section membership (it stays
  // by id) — acceptable for this pass; the editor isn't redesigned to show headers.
  const [edSections, setEdSections] = useState<{ name: string; durationMin?: number }[]>([]);
  const [edRowSection, setEdRowSection] = useState<Record<string, number>>({});
  const [edActivity, setEdActivity] = useState("");
  const [edDistance, setEdDistance] = useState("");
  const [edDuration, setEdDuration] = useState("");

  // Week-in-review (Stage B)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewWeek, setReviewWeek] = useState<WeekPlan | null>(null);
  const [tweakText, setTweakText] = useState("");
  const [reviewErr, setReviewErr] = useState("");

  // Swipe-down-to-dismiss for each bottom sheet. The grab zone is the handle +
  // header row (never the ScrollView). Pure RN PanResponder/Animated, no native dep.
  const addSwipe = useSwipeDismiss({ visible: addOpen, onClose: () => setAddOpen(false) });
  const editSwipe = useSwipeDismiss({ visible: !!editEntry, onClose: () => setEditEntry(null) });
  const setupSwipe = useSwipeDismiss({ visible: setupOpen, onClose: () => setSetupOpen(false) });
  const daySwipe = useSwipeDismiss({ visible: editDayWd != null, onClose: () => setEditDayWd(null) });
  const reviewSwipe = useSwipeDismiss({ visible: reviewOpen, onClose: () => setReviewOpen(false) });
  // The week is "over" once today is past the rolling window's last day
  // (startDate+6) or the week is fully done. Rolling windows are today-anchored,
  // so a calendar-week check no longer applies — we compare against the window's
  // own end date instead.
  const weekIsOver = !!week && (today > addDays(week.startDate, 6) || isWeekComplete(week));

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

  // When Workout stops being the active tab, force every sheet/modal closed. Two
  // reasons: (1) it guarantees the active-gated Modals below are absent from the
  // tree while Workout is hidden (so no native modal host can be stranded on top
  // of Workout and eat touches when we come back), and (2) reactivating Workout
  // never re-shows a stale sheet. Only runs on the false transition; reopening is
  // always user-driven. Lists EVERY modal-open state var by its real name.
  // Mirrors the FoodScreen / ProgressScreen blur-effect.
  useEffect(() => {
    if (active) return;
    setAddOpen(false);
    setEditEntry(null);
    setSetupOpen(false);
    setEditDayWd(null);
    setReviewOpen(false);
  }, [active]);

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
      // Two cases:
      //  - FRESH plan (no existing plan): today-anchored. Omit startDate so
      //    generateWeekPlan defaults to today; every selected weekday lands on
      //    its next occurrence within the rolling 7-day window, so there are no
      //    past days to clip — her full set is scheduled forward from now.
      //  - REGENERATE (a plan already exists): preserve the CURRENT week's
      //    identity. "Regenerate" swaps the programming but must stay on the same
      //    week number and the same calendar week — it is not a rollover. So we
      //    carry the existing current week's weekNumber + startDate through.
      //    Read them from the `profile` snapshot (stable within a block); the
      //    persist() overlay below still runs against the LATEST profile to keep
      //    history and any concurrent Coach writes.
      const existing = profile.plan?.current;
      const genOpts = existing
        ? { weekNumber: existing.weekNumber, startDate: existing.startDate }
        : { weekNumber: 1 };
      const wk = await generateWeekPlan(profile, setup, genOpts);
      // REGENERATE = "keep what I did, redo the rest." Merge the freshly
      // generated week onto the existing current week BY WEEKDAY: any day she has
      // already logged/checked (dayLogged — loggedEntryId set, i.e. full OR
      // partial completion) is kept verbatim, so its loggedEntryId, per-exercise
      // `done` flags, and content all survive. Only un-done days take the new
      // programming. Because startDate is preserved above, a regenerated week
      // sits on the SAME calendar dates — without this merge, re-checking a
      // regenerated day would append a SECOND WorkoutEntry for a date she'd
      // already logged (double-counted burn), and the old logged day's entry
      // would be orphaned. A logged old day is never replaced by a fresh
      // unchecked one, so neither can happen.
      //
      // wk.days is densifyWeek'd → all 7 weekdays present, so every logged old
      // day's weekday resolves in this .find and is preserved (a logged day can
      // never be dropped by the new setup reshaping which weekdays train — if she
      // did Monday, the old Monday wins even if the new week made Monday a rest
      // day). `existing` is read from the `profile` snapshot (stable within this
      // block); the persist() overlay still runs against the LATEST profile for
      // history + concurrent Coach writes.
      const persistedWeek: WeekPlan = existing
        ? {
            ...wk,
            days: wk.days.map((nd) => {
              const od = existing.days.find((d) => d.weekday === nd.weekday);
              return od && dayLogged(od) ? od : nd;
            }),
          }
        : wk;
      // Overlay onto the LATEST profile: preserve its history (and any other
      // field the Coach may have written while the plan was generating).
      await persist((p) => ({
        ...p,
        plan: { setup, current: persistedWeek, history: p.plan?.history ?? [] },
      }));
      setSelectedWd(weekdayKey());
      setSetupOpen(false);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  // --- Plan-generation reassurance sequence ----------------------------------
  // The real generateWeekPlan call is a ~5–15s blocking Claude request; a single
  // static line reads as frozen. Instead we advance a short, HONEST sequence of
  // process-only lines (no calorie/weight/body/intensity language — ED-safety),
  // then HOLD on the final line (no loop — looping reads as stuck).
  //
  // Every line is true for THIS user: conditional lines are gated on real input.
  // The cycle line is gated hard — shown ONLY for a known NATURAL phase (not on
  // birth control, and a dayOfCycle exists). Birth-control / unknown users see no
  // cycle line, because there is no cycle being synced to.
  const planLoadingLines = useMemo(() => {
    const lines: string[] = ["Building your week…"];
    // Goal is always set on the profile.
    lines.push("Shaping it around your goal…");
    const phase = currentPhase(profile);
    if (!phase.onBirthControl && phase.dayOfCycle) {
      lines.push("Factoring in where you are in your cycle…");
    }
    if (spEquip.trim() || spAccess.length) {
      lines.push("Working with your equipment…");
    }
    if (spInjury.trim()) {
      // Phrased as care; never echoes the raw injury text.
      lines.push("Keeping what you told us in mind…");
    }
    lines.push("Almost ready…"); // hold line
    return lines;
  }, [profile, spEquip, spAccess.length, spInjury]);

  const [planLoadingIdx, setPlanLoadingIdx] = useState(0);
  // ONE Animated.Value drives BOTH the breathing pulse (opacity ~1.0 -> ~0.4 ->
  // ~1.0, slow ease-in-out — a breath, not a blink) AND the line swap: we listen
  // for the value crossing down into the trough and advance the index there, so
  // the text changes while it's dim and the swap is invisible. No spinner.
  const planLoadingBreath = useRef(new Animated.Value(1)).current;
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        reduceMotionRef.current = on;
      })
      .catch(() => {
        reduceMotionRef.current = false;
      });
  }, []);

  // Drive the breathing sequence off `generating`. When it flips true we reset to
  // line 0 at full opacity and start a continuous loop: dim to the trough, then
  // brighten back up. A value listener advances the line ONCE per breath, exactly
  // when the value crosses below the trough threshold — so each swap is hidden in
  // the dim and the breath brightens onto the new line. We hold on the final line
  // (the index never advances past `last`, the breath keeps pulsing on it).
  //
  // On cleanup (success OR error — both clear `generating`) we stop the loop,
  // remove the listener, reset the index to 0 and opacity to 1. No leaked
  // animations or listeners. The real resolve tears this branch down immediately;
  // there is no artificial delay.
  useEffect(() => {
    if (!generating) {
      setPlanLoadingIdx(0);
      planLoadingBreath.setValue(1);
      return;
    }
    setPlanLoadingIdx(0);
    planLoadingBreath.setValue(1);
    const last = planLoadingLines.length - 1;

    // Reduce-motion: no pulse. Show full opacity and advance the line instantly
    // on a plain timer, holding on the last line. No Animated loop.
    if (reduceMotionRef.current) {
      planLoadingBreath.setValue(1);
      const id = setInterval(() => {
        setPlanLoadingIdx((i) => (i >= last ? i : i + 1));
      }, 2600);
      return () => clearInterval(id);
    }

    // Trough threshold: advance the line when the breath crosses below this on its
    // way down. `armed` debounces so we advance once per breath (re-arm at the top).
    const TROUGH = 0.45;
    let armed = false;
    const sub = planLoadingBreath.addListener(({ value }) => {
      if (value > 0.85) {
        armed = true; // back near the peak — ready to advance on the next dip
      } else if (armed && value <= TROUGH) {
        armed = false;
        setPlanLoadingIdx((i) => (i >= last ? i : i + 1));
      }
    });

    // One breath = dim to 0.4, brighten to 1.0, ~2500ms total, looped forever.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(planLoadingBreath, {
          toValue: 0.4,
          duration: 1250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(planLoadingBreath, {
          toValue: 1,
          duration: 1250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => {
      loop.stop();
      planLoadingBreath.removeListener(sub);
    };
  }, [generating, planLoadingLines, planLoadingBreath]);

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
  function toggleExercise(exId: string, weekday: Weekday = selectedWd) {
    const wd = weekday;
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
          // Keep the day's descriptive focus in sync (display-only).
          focus: day.focus || undefined,
        });
      } else {
        const entry = makeWorkout(
          {
            kind: "strength",
            exercises,
            durationMin: dur,
            ...(estBurn ? { caloriesBurned: estBurn, burnSource: "estimate" as const } : {}),
            note: day.title,
            // Display-only descriptive focus from the plan day; surfaced in the
            // Log card detail. Omit when the day has none.
            ...(day.focus ? { focus: day.focus } : {}),
            date: dateISO,
          },
          "plan"
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

  function toggleDayDone(weekday: Weekday = selectedWd) {
    const wd = weekday;
    // Re-find the day in the LATEST profile and toggle its completion there.
    persist((p) => {
      const cur = p.plan?.current;
      const day = cur?.days.find((d) => d.weekday === wd);
      if (!cur || !day) return p;
      return commitDay(p, { ...day }, !day.loggedEntryId);
    });
  }

  // One-tap "complete the whole day" for a STRENGTH day, wired to the day-header
  // checkmark (which now means "all exercises crossed off"). If the day isn't
  // fully done, check EVERY exercise; if it's already all-done, clear them all
  // (uncheck). Either way we route through syncStrengthLog so the Log entry stays
  // in sync — checking all lands/updates one grouped entry, clearing all removes
  // it. Mirrors toggleExercise's re-find-on-LATEST-profile pattern so a
  // concurrent Coach plan edit isn't clobbered. Activity/rest days keep
  // toggleDayDone (they have no exercises to cross off).
  function toggleAllExercises(weekday: Weekday = selectedWd) {
    const wd = weekday;
    persist((p) => {
      const cur = p.plan?.current;
      const day = cur?.days.find((d) => d.weekday === wd);
      if (!cur || !day?.sections) return p;
      const exs = dayExercises(day);
      if (exs.length === 0) return p; // nothing to cross off
      const allDone = exs.every((e) => e.done);
      const target = !allDone; // all-done → uncheck all; otherwise check all
      const newSections = day.sections.map((s) => ({
        ...s,
        exercises: s.exercises.map((e) => ({ ...e, done: target })),
      }));
      const newDay: PlanDay = { ...day, sections: newSections };
      const days = cur.days.map((d) => (d.weekday === wd ? newDay : d));
      const withDay: Profile = { ...p, plan: { ...p.plan!, current: { ...cur, days } } };
      return syncStrengthLog(withDay, newDay);
    });
  }

  // --- Per-day plan edit (Part B) ---------------------------------------------
  // Populate the edit-sheet state from a plan day and open the sheet. Callable for
  // ANY day, including already-logged/checked-off days — saveDayEdit preserves the
  // done flags and reconciles the logged WorkoutEntry on save.
  function openDayEdit(day: PlanDay) {
    setEditDayWd(day.weekday);
    setEdMode(day.kind === "rest" ? "rest" : "training");
    // A rest day has no training kind to edit; default it to strength so that
    // toggling Rest→Training lands on the exercise-row editor (she can switch to
    // an activity by typing one — but to keep this pass simple, a rest day
    // toggled to training starts as strength with a blank row).
    setEdKind(day.kind === "rest" ? "strength" : day.kind);
    setEdTitle(day.kind === "rest" ? "" : day.title);
    setEdFocus(day.focus ?? "");
    setEdIntensity(day.kind === "rest" ? "moderate" : day.intensity);
    // Flatten all section exercises into one editable list, while snapshotting the
    // section structure so Save can rebuild the day's NAMED sections. Each exercise
    // id maps to its origin section index; the ordered section snapshot keeps each
    // section's name + durationMin.
    const secSnap = (day.sections ?? []).map((s) => ({
      name: s.name,
      ...(s.durationMin != null ? { durationMin: s.durationMin } : {}),
    }));
    const rowSec: Record<string, number> = {};
    (day.sections ?? []).forEach((s, si) => {
      s.exercises.forEach((e) => {
        rowSec[e.id] = si;
      });
    });
    setEdSections(secSnap);
    setEdRowSection(rowSec);
    const rows: EditRow[] = dayExercises(day).map((e) => ({
      id: e.id,
      name: e.name,
      sets: e.sets != null ? String(e.sets) : "",
      reps: e.reps ?? "",
      weight: e.weight != null ? String(e.weight) : "",
    }));
    setEdRows(rows);
    setEdActivity(day.activity ?? "");
    setEdDistance(day.distance ?? "");
    setEdDuration(day.durationMin != null ? String(day.durationMin) : "");
  }

  function addEditRow() {
    setEdRows((r) => [...r, { id: newId(), name: "", sets: "3", reps: "10", weight: "" }]);
  }
  function removeEditRow(id: string) {
    setEdRows((r) => r.filter((x) => x.id !== id));
  }
  function updateEditRow(id: string, patch: Partial<EditRow>) {
    setEdRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  // Move a row up (dir -1) or down (dir +1) within edRows — pure array swap, no
  // drag-and-drop dependency (Expo Go / SDK 54).
  function moveEditRow(id: string, dir: -1 | 1) {
    setEdRows((r) => {
      const i = r.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // Build the edited PlanDay and write it back into plan.current.days via the
  // wipe-guard updater (overlay onto the LATEST profile; preserve plan.setup /
  // history and every other field). Cancel just closes the sheet — no write.
  function saveDayEdit() {
    const wd = editDayWd;
    if (!wd) return;
    persist((p) => {
      const cur = p.plan?.current;
      if (!cur) return p;
      const prev = cur.days.find((d) => d.weekday === wd);
      if (!prev) return p;

      let next: PlanDay;
      if (edMode === "rest") {
        // Clean rest day — drop training-only fields, keep weekday + any note.
        next = {
          weekday: wd,
          kind: "rest",
          title: edTitle.trim() || "Rest day",
          intensity: "rest",
          note: prev.note,
        };
      } else if (edKind === "strength") {
        // Carry per-exercise check-off across the edit: any exercise that was
        // `done` on the PREVIOUS day (matched by stable id — rows keep their id)
        // stays done. New rows (id not in prev) start un-done. prev's exercises
        // come from the LATEST profile, so concurrent Coach check-offs aren't lost.
        // (A non-strength prev has no exercises, so this map is empty → all fresh,
        // which is the correct "kind change starts fresh" behavior.)
        const prevDone: Record<string, boolean> = {};
        dayExercises(prev).forEach((e) => {
          if (e.done) prevDone[e.id] = true;
        });
        // Parse the edited rows into PlanExercises, keeping each row's id (so it
        // keys back to its origin section). Skip blank-name rows so an empty
        // trailing row doesn't persist. sets/weight parse to numbers (omit when
        // blank → bodyweight); reps stays free-text ("10-12", "30 sec").
        const built = edRows
          .filter((r) => r.name.trim())
          .map((r) => {
            const sets = parseInt(r.sets, 10);
            const weight = parseFloat(r.weight);
            const ex: PlanExercise = {
              id: r.id,
              name: r.name.trim(),
              ...(Number.isFinite(sets) && sets > 0 ? { sets } : {}),
              ...(r.reps.trim() ? { reps: r.reps.trim() } : {}),
              ...(Number.isFinite(weight) && r.weight.trim() ? { weight } : {}),
              ...(prevDone[r.id] ? { done: true } : {}),
            };
            return { ex, id: r.id };
          });
        const dur = parseInt(edDuration, 10);
        // Rebuild the day's NAMED sections from the open-time snapshot instead of
        // collapsing into one "Workout" section. Group each saved exercise by its
        // row id's origin section; rows whose id isn't in edRowSection were added
        // in the editor and go to the default section (shared rule). Emit sections
        // in the original order with their original name + durationMin, dropping
        // empties. If there was no snapshot (rest→strength toggle, or a day that
        // had no sections), fall back to a single { name: "Workout", exercises }.
        let sections: PlanSection[];
        if (edSections.length > 0) {
          const buckets: PlanExercise[][] = edSections.map(() => []);
          const defIdx = defaultSectionIndex(edSections);
          for (const { ex, id } of built) {
            const snap = edRowSection[id];
            const target =
              snap != null && snap >= 0 && snap < buckets.length ? snap : defIdx;
            // defIdx is >= 0 here because edSections.length > 0.
            buckets[target].push(ex);
          }
          sections = edSections
            .map((s, i) => ({
              name: s.name,
              ...(s.durationMin != null ? { durationMin: s.durationMin } : {}),
              exercises: buckets[i],
            }))
            .filter((s) => s.exercises.length > 0);
        } else {
          sections = [{ name: "Workout", exercises: built.map((b) => b.ex) }];
        }
        next = {
          weekday: wd,
          kind: "strength",
          title: edTitle.trim() || "Workout",
          ...(edFocus.trim() ? { focus: edFocus.trim() } : {}),
          location: prev.location,
          ...(Number.isFinite(dur) && dur > 0 ? { durationMin: dur } : {}),
          intensity: edIntensity,
          sections,
          note: prev.note,
        };
      } else {
        // Activity / class day — simple fields, no exercise rows.
        const dur = parseInt(edDuration, 10);
        next = {
          weekday: wd,
          kind: edKind,
          title: edTitle.trim() || "Session",
          ...(edFocus.trim() ? { focus: edFocus.trim() } : {}),
          location: prev.location,
          ...(Number.isFinite(dur) && dur > 0 ? { durationMin: dur } : {}),
          intensity: edIntensity,
          ...(edActivity.trim() ? { activity: edActivity.trim() } : {}),
          ...(edDistance.trim() ? { distance: edDistance.trim() } : {}),
          note: prev.note,
        };
      }

      // Write the edited day back into plan.current.days on the passed profile
      // (re-reads plan.current so it composes after a log-reconciliation step that
      // only touched workoutLogs). Preserves history/setup and concurrent writes.
      const writeDay = (prof: Profile, day: PlanDay): Profile => {
        const c = prof.plan!.current!;
        const days = c.days.map((x) => (x.weekday === wd ? day : x));
        return { ...prof, plan: { ...prof.plan!, current: { ...c, days } } };
      };

      // Reconcile the logged WorkoutEntry with the edit so the Log always reflects
      // the edited day and no entry is ever orphaned or duplicated. All branches
      // compose onto the LATEST `p` inside this single persist updater (one atomic
      // write). `next.loggedEntryId` is undefined out of every build branch above.
      const dateISO = dateForWeekday(cur.startDate, wd);
      const prevLoggedId = prev.loggedEntryId;
      const prevStrength = prev.kind === "strength";
      const nextStrength = next.kind === "strength";
      const prevActivityish = prev.kind === "activity" || prev.kind === "class";
      const nextActivityish = next.kind === "activity" || next.kind === "class";

      // Un-logged day → plain write (unchanged behavior).
      if (!prevLoggedId) {
        return writeDay(p, next);
      }

      // STRENGTH → STRENGTH: carry the entry id and let syncStrengthLog reconcile
      // the grouped entry to the edited/checked exercises. It updates the entry's
      // exercises + duration + burn (preserving a watch-entered total via its
      // burnSource === "watch" guard), and if the edit leaves ZERO checked
      // exercises it removes the entry and clears loggedEntryId. It also writes the
      // day back itself, so return its result directly.
      if (prevStrength && nextStrength) {
        next.loggedEntryId = prevLoggedId;
        return syncStrengthLog(p, next);
      }

      // ACTIVITY/CLASS → ACTIVITY/CLASS (was "Mark complete"-d): keep it logged but
      // refresh the entry to the edited activity/duration/distance. Drop the stale
      // entry, then re-create + re-log via commitDay (which sets the new
      // loggedEntryId and writes the day). No orphan, no duplicate.
      if (prevActivityish && nextActivityish) {
        const pRemoved = removeWorkout(p, dateISO, prevLoggedId);
        next.loggedEntryId = undefined;
        return commitDay(pRemoved, next, true);
      }

      // KIND CHANGE on a logged day (strength↔activity/class, →rest, etc.): cleanly
      // remove the old entry so nothing is orphaned. The day restarts UNLOGGED in
      // its new kind — rest can't be logged; a new strength/activity day starts
      // fresh (done flags cleared, no auto-re-log). next.loggedEntryId is already
      // undefined, so just write the day.
      const pRemoved = removeWorkout(p, dateISO, prevLoggedId);
      return writeDay(pRemoved, next);
    });
    setEditDayWd(null);
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
        // Continuous rolling: next week's window starts exactly 7 days after the
        // current week's anchor (NOT today, NOT a Monday), so a selected-day
        // pattern repeats every 7 days without drift.
        startDate: addDays(week.startDate, 7),
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
    setActName("");
    setActDur("");
    setActDist("");
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

  // Resolve burned calories: a typed watch number wins; otherwise estimate via
  // the shared helper (strength sums logged exercises, else default duration;
  // activity uses entered or default duration) so a log always lands a number.
  function resolveBurn(
    kind: WorkoutKind,
    activity: string | undefined,
    durationMin: number | undefined,
    watch: string,
    exercises?: WorkoutExercise[]
  ): { caloriesBurned?: number; burnSource?: "watch" | "estimate" } {
    return resolveWorkoutBurn({
      kind,
      activity,
      durationMin,
      exercises,
      watchCalories: watch.trim() ? parseFloat(watch) : null,
      weightKg,
    });
  }

  function watchExtras(): Pick<WorkoutEntry, "avgHr" | "maxHr"> {
    return {
      avgHr: wAvg.trim() ? Math.round(parseFloat(wAvg)) : undefined,
      maxHr: wMax.trim() ? Math.round(parseFloat(wMax)) : undefined,
    };
  }

  async function saveStrength() {
    if (!built.length) return;
    // Strength no longer carries a manual duration or note field. Burn is
    // estimated from the built exercises (sets/reps → time) via resolveBurn, so
    // durationMin is left undefined; the sum of built exercises always lands a
    // burn (save is blocked on an empty builder above).
    const entry = makeWorkout(
      {
        kind: "strength",
        exercises: built,
        ...resolveBurn("strength", undefined, undefined, wBurn, built),
        ...watchExtras(),
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
    setEBurn(e.burnSource === "watch" && e.caloriesBurned ? String(e.caloriesBurned) : "");
    setEAvg(e.avgHr ? String(e.avgHr) : "");
    setEMax(e.maxHr ? String(e.maxHr) : "");
  }

  async function saveEdit() {
    if (!editEntry) return;
    // Only activity carries an editable duration; strength burn is estimated from
    // its exercises, so a strength entry's durationMin stays undefined here.
    const duration = editEntry.kind === "activity" ? parseFloat(eDur) || undefined : undefined;
    const burn = resolveBurn(
      editEntry.kind,
      eActName || editEntry.activity,
      duration,
      eBurn,
      editEntry.exercises
    );
    // Note is no longer editable from either form; preserve any existing note
    // (e.g. a Coach-set strength title) via the spread rather than clearing it.
    const updated: WorkoutEntry = {
      ...editEntry,
      durationMin: duration,
      ...burn,
      avgHr: eAvg.trim() ? Math.round(parseFloat(eAvg)) : undefined,
      maxHr: eMax.trim() ? Math.round(parseFloat(eMax)) : undefined,
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
  // Preview the estimate the save path will actually land — the sum of the built
  // exercises' per-exercise estimates (sets/reps → time → MET burn). Gated on a
  // non-empty builder so we never show a phantom default-duration estimate before
  // any exercise has been added.
  const estStrength =
    built.length > 0
      ? resolveWorkoutBurn({
          kind: "strength",
          exercises: built,
          weightKg,
        }).caloriesBurned ?? null
      : null;
  const estActivity =
    resolveWorkoutBurn({
      kind: "activity",
      activity: actName,
      durationMin: parseFloat(actDur) || undefined,
      weightKg,
    }).caloriesBurned ?? null;

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

  // Log card (mockup .logcard): top/bottom hairline rule, left = wide-tracked
  // kind label + title + detail line + source pill; right = the big value
  // (minutes, or kcal with a "KCAL · {n} MIN" caption).
  function LogCard({ e }: { e: WorkoutEntry }) {
    const isActivity = e.kind === "activity";
    const kindLabel = isActivity ? "Logged · Activity" : "Logged · Strength";
    const title = isActivity
      ? e.activity || "Activity"
      : e.note || `Strength${e.durationMin ? ` · ${e.durationMin} min` : ""}`;
    // Detail line (mockup .logcard .ld): a SHORT one-liner, not the full list.
    //   strength → "{N} movements" (pluralized), optionally " · {focus}" when a
    //              focus phrase is available (mockup: "8 movements · hips, t-spine,
    //              slow core"). Duration lives in the right-hand value, not here.
    //   activity → "{distance} · {note}" (mockup: "Easy pace · 2.1 mi · felt
    //              good"); duration is the right-hand value, so it's dropped here.
    let detail: string;
    if (isActivity) {
      detail = [e.distance ?? "", e.note ?? ""].filter(Boolean).join(" · ");
    } else {
      const n = (e.exercises ?? []).length;
      const movements = `${n} ${n === 1 ? "movement" : "movements"}`;
      // focus is carried over from the plan day (PlanDay.focus → WorkoutEntry.focus)
      // for plan-logged strength entries; manual / Coach-chat entries have none, so
      // the detail gracefully shows just "{N} movements" (no trailing " · ").
      detail = e.focus ? `${movements} · ${e.focus}` : movements;
    }
    // Source pill: three origins, distinguished by e.source.
    //   "plan"   → a plan-day check-off on this screen (toggleDayDone →
    //              commitDay → planDayToWorkoutEntry, and toggleExercise →
    //              syncStrengthLog) → "From your plan"
    //   "coach"  → a Coach chat log via log_workout                → "From Coach"
    //   "manual" → a hand-entered save in the add sheet            → "Added manually"
    const srcPillStyle =
      e.source === "plan"
        ? styles.srcPillPlan
        : e.source === "coach"
        ? styles.srcPillCoach
        : styles.srcPillManual;
    const srcTextStyle =
      e.source === "plan"
        ? styles.srcTextPlan
        : e.source === "coach"
        ? styles.srcTextCoach
        : styles.srcTextManual;
    const srcLabel =
      e.source === "plan"
        ? "From your plan"
        : e.source === "coach"
        ? "From Coach"
        : "Added manually";
    // Right-hand value: prefer calories (with KCAL · MIN caption) when present,
    // else the duration in minutes.
    const hasBurn = !!e.caloriesBurned;
    return (
      <TouchableOpacity style={styles.logCard} onPress={() => openEdit(e)} activeOpacity={0.7}>
        <View style={styles.flex}>
          <Text style={styles.logKind}>{kindLabel}</Text>
          <Text style={styles.logName}>{title}</Text>
          {detail ? <Text style={styles.logDetail}>{detail}</Text> : null}
          <View style={[styles.srcPill, srcPillStyle]}>
            <Text style={[styles.srcText, srcTextStyle]}>{srcLabel}</Text>
          </View>
        </View>
        <View style={styles.logRight}>
          {hasBurn ? (
            <>
              <Text style={styles.logVal}>{e.caloriesBurned}</Text>
              <Text style={styles.logValUnit}>
                KCAL{e.durationMin ? ` · ${e.durationMin} MIN` : ""}
              </Text>
            </>
          ) : isActivity ? (
            <>
              <Text style={styles.logVal}>{e.durationMin ?? "—"}</Text>
              <Text style={styles.logValUnit}>MIN</Text>
            </>
          ) : (
            // Strength no longer carries a duration; if no burn landed (e.g. no
            // bodyweight on file to estimate from) show "— KCAL", never "— MIN".
            <>
              <Text style={styles.logVal}>—</Text>
              <Text style={styles.logValUnit}>KCAL</Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // CHANGE 2 — scrollable multi-week date strip (shared by Plan + Log views).
  // The cells span STRIP_WEEKS_BACK..STRIP_WEEKS_AHEAD weeks around this week's
  // Sunday, ordered Sun→Sat. Built once per mount (the range is anchored on
  // "now"); cheap enough that a plain horizontal ScrollView is fine — no
  // virtualized list needed at ~70 cells.
  const stripCells = useMemo(() => buildStripCells(), []);
  // Cell layout math for auto-centering today on mount. Each cell is a fixed
  // width with a horizontal margin; the week-group gap is an extra left margin
  // on every Sunday (index % 7 === 0) after the first.
  const todayIndex = stripCells.findIndex((c) => c.iso === today);
  // Only the LOG view renders the WeekDateStrip now (the Plan view dropped it as
  // redundant with its dated day cards), so a single strip ref suffices.
  const logStripRef = useRef<ScrollView>(null);
  const centerOffset = (cellFullWidth: number) =>
    Math.max(0, todayIndex * cellFullWidth - 120);

  // The single scrollable date strip. Selection + today highlight are driven by
  // REAL ISO dates; planned/done/rest state is resolved by matching each cell's
  // date against the stored Mon-anchored WeekPlan via planDayForISO (no
  // off-by-one). `selectedISO` highlights the chosen cell; tapping calls
  // onSelectDate(iso). The "trained" dot keeps the existing sage / honey-on-today
  // styling. Cells outside any plan week simply render neutral (no dot).
  function WeekDateStrip({
    selectedISO,
    onSelectDate,
    scrollRef,
  }: {
    selectedISO: string;
    onSelectDate: (iso: string) => void;
    scrollRef: React.RefObject<ScrollView | null>;
  }) {
    return (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripScroll}
        contentContainerStyle={styles.stripScrollContent}
        onLayout={() => {
          // Center today on first layout. STRIP_CELL_W + 2*STRIP_CELL_MX is the
          // per-cell advance; the small week-group gaps shift it slightly, which
          // is fine for a "today is visible" anchor.
          const adv = STRIP_CELL_W + STRIP_CELL_MX * 2;
          scrollRef.current?.scrollTo({ x: centerOffset(adv), animated: false });
        }}
      >
        {stripCells.map((c, i) => {
          const sel = c.iso === selectedISO;
          const isToday = c.iso === today;
          // Done state: prefer the actual logged-entry signal from the plan day
          // (matches the Plan view's "trained" dot), and also treat any manually
          // logged workout on that date as trained (matches the Log view). Either
          // source lights the dot — consistent across both callers.
          const pd = planDayForISO(week, c.iso);
          const trained =
            (pd ? dayLogged(pd) : false) || workoutsFor(profile, c.iso).length > 0;
          // Extra left margin starts each new Sun-grouped week (except the first).
          const weekGap = i > 0 && i % 7 === 0 ? styles.stripWeekGap : null;
          return (
            <TouchableOpacity
              key={c.iso}
              style={[styles.stripCell, weekGap]}
              onPress={() => onSelectDate(c.iso)}
            >
              <Text style={[styles.stripDn, sel && styles.stripDnToday]}>{c.dn}</Text>
              <View style={[styles.stripDd, sel && styles.stripDdToday]}>
                <Text style={[styles.stripDdNum, sel && styles.stripDdNumToday]}>{c.num}</Text>
                {trained ? (
                  <View
                    style={[
                      styles.stripTrained,
                      { backgroundColor: isToday ? colors.honey : colors.profileSage },
                    ]}
                  />
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.flex}>
            {eyebrow ? (
              <Text style={[styles.eyebrow, { color: eyebrowColor }]}>{eyebrow}</Text>
            ) : null}
            <Text style={styles.title}>workout</Text>
          </View>
          {/* Header avatar (mockup .avatar): initials circle. Tapping opens
              Settings via the app shell (onOpenSettings). When that prop is
              absent (other callers/tests) we render a plain non-pressable circle
              rather than a dead button. */}
          {(() => {
            // Empty string when the profile has no name → render a clean cocoa
            // circle (no stray "·"); real initials otherwise. A saved profile
            // photo takes precedence over initials (parity with Progress/Coach).
            const initials = profileInitials(profile.name);
            const inner = profile.profilePhotoUri ? (
              <Image
                source={{ uri: profile.profilePhotoUri }}
                style={styles.avatarImg}
                resizeMode="cover"
              />
            ) : initials ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : null;
            return onOpenSettings ? (
              <TouchableOpacity
                style={styles.avatar}
                onPress={onOpenSettings}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
              >
                {inner}
              </TouchableOpacity>
            ) : (
              <View style={styles.avatar}>{inner}</View>
            );
          })()}
        </View>

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
            {generating ? (
              <View style={styles.planLoading}>
                <Animated.Text style={[styles.planLoadingText, { opacity: planLoadingBreath }]}>
                  {planLoadingLines[Math.min(planLoadingIdx, planLoadingLines.length - 1)]}
                </Animated.Text>
              </View>
            ) : !week ? (
              <View style={styles.planCta}>
                <Text style={styles.planCtaTitle}>Your tailored plan</Text>
                <Text style={styles.planCtaText}>
                  A week of training built around your goal and cycle — it adapts as you go and
                  logs itself when you check it off.
                </Text>
                <TouchableOpacity style={styles.planCtaBtn} onPress={openPlanSetup}>
                  <Text style={styles.planCtaBtnText}>Create my plan</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Calm "today" date header — first thing in the plan view.
                    Display-only: derived from `today` (toISODate(new Date()),
                    line 361) at render so it always reflects the real current
                    day. Format "Wednesday, June 24" via the same
                    toLocaleDateString pattern used elsewhere in this file
                    (e.g. lines 244, 1815). Sits above the program card and reads
                    as a quiet header, not competing with the big program name. */}
                <View style={styles.planTodayHeader}>
                  <Text style={styles.planTodayEyebrow}>Today</Text>
                  <Text style={styles.planTodayDate}>
                    {parseISO(today).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </Text>
                </View>

                {/* PLAN view no longer renders the WeekDateStrip: the 7 stacked
                    day cards below already show each day's weekday + date number
                    + workout, so a date navigator strip on top of them is
                    redundant. (The strip is still the date navigator on the LOG
                    view.) Today-highlighting and the default-open card are driven
                    by openWeekday/selectedWd, both initialized to today's weekday
                    (weekdayKey()), and the day-card accordion's own onPress sets
                    them — so selection still works without the strip. */}

                {/* Program card (mockup .program): eyebrow, big program name,
                    why-this-week paragraph, progress bar + session meta. The
                    soft drop shadow lives on the OUTER wrapper (opaque backing,
                    no overflow) so iOS can cast it; the INNER view keeps the
                    overflow:hidden that clips the rounded CardBloom. */}
                <View style={styles.programCardShadow}>
                <View style={styles.programCard}>
                  {/* Rose→honey top-right soft glow (mockup .program:after); text
                      below sits on top, fully legible. */}
                  <CardBloom variant="program" />
                  <Text style={styles.programEyebrow}>
                    Your plan · Week {week.weekNumber} of this block
                  </Text>
                  <Text style={styles.programName}>{week.programName}</Text>
                  {week.whyThisWeek ? (
                    <Text style={styles.programWhy}>{week.whyThisWeek}</Text>
                  ) : null}
                  {(() => {
                    const { done, total } = weekProgress(week);
                    const frac = total > 0 ? done / total : 0;
                    return (
                      <View style={styles.progWrap}>
                        <View style={styles.progTrack}>
                          <View style={[styles.progFill, { width: `${frac * 100}%` }]} />
                        </View>
                        <View style={styles.progMeta}>
                          <Text style={styles.progMetaText}>
                            <Text style={styles.progMetaStrong}>{done}</Text> of {total} sessions
                            done
                          </Text>
                          <Text style={styles.progMetaText}>{total - done} to go</Text>
                        </View>
                      </View>
                    );
                  })()}
                </View>
                </View>

                {weekIsOver && (
                  <TouchableOpacity style={styles.reviewCta} onPress={startReview}>
                    <Text style={styles.reviewCtaTitle}>Week in review</Text>
                    <Text style={styles.reviewCtaText}>
                      You wrapped week {week.weekNumber}. Tap to see next week, tailored to how it
                      went.
                    </Text>
                  </TouchableOpacity>
                )}

                <Text style={styles.secLabel}>This week</Text>

                {/* The week list — all 7 day cards stacked, accordion (mockup
                    .dcard). Today's card emphasized + open by default. Iterated
                    in CHRONOLOGICAL order (earliest real date → latest): we sort
                    the stored days by each day's real date (dateForWeekday gives
                    an ISO string, which sorts chronologically). The underlying
                    stored week stays Mon-anchored; only this card ORDER changes.
                    Each card's date number still derives from the plan's
                    real-date mapping (weekdayDateNum). */}
                {[...week.days]
                  .sort((a, b) =>
                    dateForWeekday(week.startDate, a.weekday).localeCompare(
                      dateForWeekday(week.startDate, b.weekday)
                    )
                  )
                  .map((d) => {
                  const wd = d.weekday;
                  const isToday = wd === weekdayKey();
                  const dateNum = weekdayDateNum(week.startDate, wd);

                  // Rest day — dashed cream card, note inline, no checkbox/caret.
                  if (d.kind === "rest") {
                    const pin = INTENSITY_PIN.rest;
                    return (
                      <View
                        key={wd}
                        style={[styles.dcard, styles.dcardRest, isToday && styles.dcardToday]}
                      >
                        <View style={styles.dhead}>
                          <View style={styles.ddate}>
                            <Text style={styles.ddateW}>{WEEKDAY_LABELS[wd]}</Text>
                            <Text style={styles.ddateN}>{dateNum}</Text>
                          </View>
                          <View style={styles.dmain}>
                            <Text style={styles.dtitle}>Rest day</Text>
                            <View style={styles.dsub}>
                              <View style={styles.pin}>
                                <View style={[styles.pinDot, { backgroundColor: pin.dot }]} />
                                <Text style={[styles.pinText, { color: pin.text }]}>Recovery</Text>
                              </View>
                            </View>
                          </View>
                          {/* Edit affordance (Part B). Rest days are never logged,
                              so editing is always allowed — tapping opens the edit
                              sheet (where she can keep it a rest day or toggle it
                              to a training day). */}
                          <TouchableOpacity
                            style={styles.editPencil}
                            onPress={() => openDayEdit(d)}
                            hitSlop={8}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel="Edit this day"
                          >
                            <Text style={styles.editPencilText}>Edit</Text>
                          </TouchableOpacity>
                        </View>
                        {d.note ? (
                          <View style={styles.restBody}>
                            <Text style={styles.restBodyNote}>{d.note}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  }

                  const open = openWeekday === wd;
                  // `checked` = whole-day complete (strength: every exercise
                  // crossed off; activity: manually marked done) — drives the
                  // header checkmark + activity inner row. Editing is now available
                  // regardless of logged/checked state: saveDayEdit reconciles the
                  // log (and preserves check-off) so a logged day can be fixed too.
                  const checked = dayComplete(d);
                  const pin = INTENSITY_PIN[d.intensity] ?? INTENSITY_PIN.moderate;
                  return (
                    <View
                      key={wd}
                      style={[styles.dcard, isToday && styles.dcardToday]}
                    >
                      <TouchableOpacity
                        style={styles.dhead}
                        activeOpacity={0.7}
                        onPress={() => {
                          setSelectedWd(wd);
                          setOpenWeekday(open ? null : wd);
                        }}
                      >
                        <View style={styles.ddate}>
                          <Text style={styles.ddateW}>{WEEKDAY_LABELS[wd]}</Text>
                          <Text style={styles.ddateN}>{dateNum}</Text>
                        </View>
                        <View style={styles.dmain}>
                          <Text style={styles.dtitle}>{d.title}</Text>
                          <View style={styles.dsub}>
                            <View style={styles.pin}>
                              <View style={[styles.pinDot, { backgroundColor: pin.dot }]} />
                              <Text style={[styles.pinText, { color: pin.text }]}>{pin.label}</Text>
                            </View>
                            {[d.location, d.durationMin ? `${d.durationMin} min` : ""]
                              .filter(Boolean)
                              .join(" · ") ? (
                              <Text style={styles.dsubMeta}>
                                ·{" "}
                                {[d.location, d.durationMin ? `${d.durationMin} min` : ""]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.dright}>
                          <TouchableOpacity
                            style={[styles.chk, checked && styles.chkOn]}
                            onPress={() =>
                              d.kind === "strength"
                                ? toggleAllExercises(wd)
                                : toggleDayDone(wd)
                            }
                            hitSlop={8}
                          >
                            {checked ? <Text style={styles.chkMark}>✓</Text> : null}
                          </TouchableOpacity>
                          <Text style={[styles.caret, open && styles.caretOpen]}>▾</Text>
                        </View>
                      </TouchableOpacity>

                      {open ? (
                        <View style={styles.dbody}>
                          {d.kind === "strength" ? (
                            (d.sections ?? []).map((s, si) => (
                              <View key={si} style={styles.sect}>
                                <Text style={styles.sectHead}>
                                  {s.name}
                                  {s.durationMin ? ` · ${s.durationMin} min` : ""}
                                </Text>
                                {s.exercises.map((e) => (
                                  <TouchableOpacity
                                    key={e.id}
                                    style={styles.ex}
                                    activeOpacity={0.7}
                                    onPress={() => toggleExercise(e.id, wd)}
                                  >
                                    <View style={styles.flex}>
                                      <Text style={[styles.exName, e.done && styles.exDone]}>
                                        {e.name}
                                      </Text>
                                      {[
                                        e.weight != null ? `${e.weight} lb` : "",
                                        e.note || "",
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") ? (
                                        <Text style={styles.exCue}>
                                          {[
                                            e.weight != null ? `${e.weight} lb` : "",
                                            e.note || "",
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <Text style={styles.exVal}>
                                      {e.sets != null && e.reps
                                        ? `${e.sets} × ${e.reps}`
                                        : e.reps || ""}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            ))
                          ) : (
                            <View style={styles.sect}>
                              <Text style={styles.sectHead}>
                                {[d.activity || d.title, d.durationMin ? `${d.durationMin} min` : ""]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </Text>
                              <TouchableOpacity
                                style={styles.ex}
                                activeOpacity={0.7}
                                onPress={() => toggleDayDone(wd)}
                              >
                                <Text style={[styles.exName, checked && styles.exDone]}>
                                  {checked ? "Completed" : "Mark complete"}
                                </Text>
                                <View style={[styles.chk, checked && styles.chkOn]}>
                                  {checked ? <Text style={styles.chkMark}>✓</Text> : null}
                                </View>
                              </TouchableOpacity>
                              {d.note ? <Text style={styles.restNote}>{d.note}</Text> : null}
                            </View>
                          )}
                          {/* Edit affordance (Part B). Always available — including
                              after exercises are checked off / the day is logged.
                              saveDayEdit preserves the per-exercise done flags and
                              reconciles the logged WorkoutEntry (updating or
                              removing it) so editing never orphans the log. */}
                          {/* Footer action area. A single hairline rule separates
                              it from the exercise list above so it reads as a
                              deliberate card footer, not floating text. Primary
                              direct-edit affordance (quiet cocoa outline chip) sits
                              on top; the Coach route is the calmer secondary line
                              beneath. */}
                          <View style={styles.dayFooter}>
                            <TouchableOpacity
                              style={styles.editDayLink}
                              onPress={() => openDayEdit(d)}
                              activeOpacity={0.7}
                              accessibilityRole="button"
                              accessibilityLabel="Edit this day"
                            >
                              <Text style={styles.editDayLinkText}>Edit this day</Text>
                              <Text style={styles.editDayLinkArrow}>›</Text>
                            </TouchableOpacity>
                            {/* Coach-adjust context — shown on every expanded training
                                day (not just today) so it's always clear the plan can
                                also be changed by asking the Coach, alongside direct edit. */}
                            <TouchableOpacity
                              style={styles.flexLink}
                              onPress={() => {
                                if (onAdjustDayWithCoach) {
                                  // Real calendar date of this plan day + a human
                                  // label matching the Log date-line format
                                  // ("{weekday}, {Month} {day}" → "Thursday, May 7"),
                                  // so the Coach opener can name the exact day.
                                  const dateISO = dateForWeekday(week.startDate, wd);
                                  const label = parseISO(dateISO).toLocaleDateString(undefined, {
                                    weekday: "long",
                                    month: "long",
                                    day: "numeric",
                                  });
                                  onAdjustDayWithCoach({ dateISO, label });
                                } else {
                                  onOpenCoach();
                                }
                              }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.flexLinkText}>
                                Or ask your Coach to adjust your plan →
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                {lean ? (
                  <View style={styles.leanCard}>
                    <Text style={styles.leanPhase}>{phase.phase} phase</Text>
                    <Text style={styles.leanText}>{lean}</Text>
                  </View>
                ) : null}

                {/* Footer (mockup .ghostbtn): full-width cocoa-outline ghost pill
                    opening the existing plan-setup sheet. */}
                <TouchableOpacity style={styles.ghostBtn} onPress={openPlanSetup}>
                  <Text style={styles.ghostBtnText}>Edit / regenerate plan</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {activeTab === "log" && (
          <>
            {/* Scrollable multi-week date strip (CHANGE 1 + 2): same component as
                the Plan view, Sun→Sat, spanning several weeks back/forward,
                centered on today at mount. Selecting a date drives logSelDate so
                its log shows below; the selected cell is highlighted and the
                heading switches via dayLabel ("Today"/"Yesterday"/date). The
                trained dot lights for any date with a logged workout (or a
                checked-off plan day), honey on today, sage otherwise. */}
            <WeekDateStrip
              selectedISO={logSelDate}
              scrollRef={logStripRef}
              onSelectDate={setLogSelDate}
            />

            {/* Big "Today" header + round cocoa add button (mockup .logtop). */}
            <View style={styles.logTop}>
              <Text style={styles.logTitle}>{dayLabel(logSelDate)}</Text>
              <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
                <Svg width={20} height={20} viewBox="0 0 20 20">
                  <Line x1={10} y1={3.5} x2={10} y2={16.5} stroke={colors.cream} strokeWidth={2.4} strokeLinecap="round" />
                  <Line x1={3.5} y1={10} x2={16.5} y2={10} stroke={colors.cream} strokeWidth={2.4} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>
            {/* Date line "{weekday}, {Month} {day} · {phase}" (mockup). */}
            <Text style={styles.logDateLine}>
              {parseISO(logSelDate).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              {hasPhase ? ` · ${phaseLabel}` : ""}
            </Text>

            {selEntries.length === 0 ? (
              <Text style={styles.empty}>
                Nothing logged for this day. Tap ＋ to add a lift or class, check off your plan, or
                tell the Coach what you did.
              </Text>
            ) : (
              selEntries.map((e) => <LogCard key={e.id} e={e} />)
            )}

            {/* Weekly summary (mockup .summary): factual one-paragraph recap.
                Folds the plan-week progress + day's totals into neutral copy —
                no deficit / earn-burn / streak framing. */}
            {week ? (
              <View style={styles.summaryCardShadow}>
              <View style={styles.summaryCard}>
                {/* Sage bottom-left soft glow (mockup .summary:after); the
                    factual recap text sits on top, fully legible — copy
                    unchanged. Shadow on the outer wrapper, clip on this inner. */}
                <CardBloom variant="summary" />
                <Text style={styles.summaryLabel}>This week so far</Text>
                <Text style={styles.summaryText}>
                  {(() => {
                    const { done, total } = weekProgress(week);
                    const left = total - done;
                    const sessions =
                      total > 0
                        ? `${done} of ${total} planned ${total === 1 ? "session" : "sessions"} done`
                        : "No sessions planned this week";
                    const tail =
                      total > 0
                        ? left > 0
                          ? `, ${left} left to go.`
                          : ", the week is complete."
                        : ".";
                    return `${sessions}${tail}`;
                  })()}
                </Text>
              </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Add sheet — gated on `active` so it's fully unmounted (not just
          visible={false}) when Workout is hidden; see the `active` prop note. */}
      {active && (
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        {/* Per-Modal GestureHandlerRootView: a core RN Modal's children live in a
            separate native view tree not under the app-root provider, so in-Modal
            gestures need their own root here or they silently do nothing. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={addSwipe.gesture}>
          <Animated.View style={[styles.sheet, addSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>log a workout</Text>
                <TouchableOpacity onPress={() => setAddOpen(false)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView {...addSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
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

                  <WatchFields estimate={estStrength} />

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
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}

      {/* Edit sheet — gated on `active` (see add-sheet note above). */}
      {active && (
      <Modal visible={!!editEntry} animationType="slide" transparent onRequestClose={() => setEditEntry(null)}>
        {/* Per-Modal GestureHandlerRootView — see add-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={editSwipe.gesture}>
          <Animated.View style={[styles.sheet, editSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>edit workout</Text>
                <TouchableOpacity onPress={() => setEditEntry(null)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...editSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
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
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}

      {/* Plan setup — gated on `active` (see add-sheet note above). */}
      {active && (
      <Modal visible={setupOpen} animationType="slide" transparent onRequestClose={() => setSetupOpen(false)}>
        {/* Per-Modal GestureHandlerRootView — see add-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={setupSwipe.gesture}>
          <Animated.View style={[styles.sheet, setupSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>build your plan</Text>
                <TouchableOpacity onPress={() => setSetupOpen(false)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...setupSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Workout days</Text>
              {/* Sun-first day-picker: simply WHICH weekdays she trains (the
                  recurring pattern). With the rolling-from-today window each
                  selected weekday is scheduled on its next occurrence, so there
                  are no "passed" days to gray out — every weekday stays
                  selectable. */}
              {/* All 7 weekday chips must fit on ONE line: equal-width flex
                  chips (flex:1) in a no-wrap row with tight padding/gap. */}
              <View style={styles.dayRow}>
                {WD_SUNFIRST.map((wd) => {
                  const on = spWorkoutDays.includes(wd);
                  return (
                    <TouchableOpacity
                      key={wd}
                      style={[styles.dayChip, on && styles.chipActive]}
                      onPress={() => toggleWorkoutDay(wd)}
                      accessibilityState={{ selected: on }}
                    >
                      <Text
                        style={[styles.chipText, on && styles.chipTextActive]}
                        numberOfLines={1}
                      >
                        {WEEKDAY_LABELS[wd]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.miniLabel}>
                The days you don't pick become rest days. Your plan starts today and schedules each
                day you pick on its next occurrence.
              </Text>

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
                  // Same rotating line as the (sheet-hidden) plan-tab loader, driven by the
                  // SAME planLoadingIdx/planLoadingBreath — keeps button + plan tab in lockstep.
                  // No spinner: the breathing text IS the loading treatment.
                  <Animated.Text
                    style={[styles.saveBtnLoadingText, { opacity: planLoadingBreath }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {planLoadingLines[Math.min(planLoadingIdx, planLoadingLines.length - 1)]}
                  </Animated.Text>
                ) : (
                  <Text style={styles.saveBtnText}>Generate my plan</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.genHint}>
                Your coach builds this from your goal, cycle phase, and the answers above. Regenerate
                anytime.
              </Text>
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}

      {/* Per-day plan edit sheet (Part B) — reuses the existing sheet chrome
          (drag handle, lowercase title, cream inputs, cocoa CTA / outline pills,
          warmAlert for the per-row delete). Save writes the edited PlanDay back
          into plan.current.days via the wipe-guard; Cancel (✕) discards.
          Gated on `active` so it's fully unmounted (not just visible={false})
          when Workout is hidden; see the `active` prop note. */}
      {active && (
      <Modal
        visible={editDayWd != null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditDayWd(null)}
      >
        {/* Per-Modal GestureHandlerRootView — see add-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={daySwipe.gesture}>
          <Animated.View style={[styles.sheet, daySwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>edit day</Text>
                <TouchableOpacity onPress={() => setEditDayWd(null)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...daySwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {/* Rest ↔ Training toggle (reuses the in-sheet segmented control). */}
              <View style={styles.tabs}>
                {(["training", "rest"] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.tab, edMode === m && styles.tabActive]}
                    onPress={() => setEdMode(m)}
                  >
                    <Text style={[styles.tabText, edMode === m && styles.tabTextActive]}>
                      {m === "training" ? "Training" : "Rest"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {edMode === "rest" ? (
                <>
                  <Text style={styles.editRestNote}>
                    This day will be saved as a rest day — no exercises.
                  </Text>
                  <Text style={styles.fieldLabel}>Title (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={edTitle}
                    onChangeText={setEdTitle}
                    placeholder="Rest day"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Title</Text>
                  <TextInput
                    style={styles.input}
                    value={edTitle}
                    onChangeText={setEdTitle}
                    placeholder="e.g. Glutes + Core"
                  />

                  <Text style={styles.fieldLabel}>Focus (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={edFocus}
                    onChangeText={setEdFocus}
                    placeholder="e.g. hips, t-spine, slow core"
                  />

                  <Text style={styles.fieldLabel}>Intensity</Text>
                  <View style={styles.chipWrap}>
                    {(["light", "moderate", "hard"] as const).map((lvl) => {
                      const on = edIntensity === lvl;
                      return (
                        <TouchableOpacity
                          key={lvl}
                          style={[styles.chip, on && styles.chipActive]}
                          onPress={() => setEdIntensity(lvl)}
                          accessibilityState={{ selected: on }}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextActive]}>
                            {INTENSITY_PIN[lvl].label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {edKind === "strength" ? (
                    <>
                      <Text style={styles.fieldLabel}>Exercises</Text>
                      {edRows.length === 0 ? (
                        <Text style={styles.editHint}>No exercises yet — add one below.</Text>
                      ) : (
                        edRows.map((r, i) => (
                          <View key={r.id} style={styles.editExRow}>
                            <View style={styles.editExTopRow}>
                              <TextInput
                                style={[styles.input, styles.flex]}
                                value={r.name}
                                onChangeText={(t) => updateEditRow(r.id, { name: t })}
                                placeholder="e.g. Back squat"
                              />
                              {/* Reorder + delete controls — pure RN, no DnD dep. */}
                              <TouchableOpacity
                                style={styles.editMoveBtn}
                                onPress={() => moveEditRow(r.id, -1)}
                                disabled={i === 0}
                                hitSlop={6}
                                accessibilityLabel="Move up"
                              >
                                <Text style={[styles.editMoveText, i === 0 && styles.editMoveDisabled]}>
                                  ↑
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.editMoveBtn}
                                onPress={() => moveEditRow(r.id, 1)}
                                disabled={i === edRows.length - 1}
                                hitSlop={6}
                                accessibilityLabel="Move down"
                              >
                                <Text
                                  style={[
                                    styles.editMoveText,
                                    i === edRows.length - 1 && styles.editMoveDisabled,
                                  ]}
                                >
                                  ↓
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.editMoveBtn}
                                onPress={() => removeEditRow(r.id)}
                                hitSlop={6}
                                accessibilityLabel="Remove exercise"
                              >
                                <Text style={styles.editRemoveText}>✕</Text>
                              </TouchableOpacity>
                            </View>
                            <View style={styles.row3}>
                              <View style={styles.cell}>
                                <Text style={styles.miniLabel}>Sets</Text>
                                <TextInput
                                  style={styles.input}
                                  value={r.sets}
                                  onChangeText={(t) => updateEditRow(r.id, { sets: t })}
                                  keyboardType="numeric"
                                  placeholder="—"
                                />
                              </View>
                              <View style={styles.cell}>
                                <Text style={styles.miniLabel}>Reps</Text>
                                <TextInput
                                  style={styles.input}
                                  value={r.reps}
                                  onChangeText={(t) => updateEditRow(r.id, { reps: t })}
                                  placeholder="e.g. 10-12"
                                />
                              </View>
                              <View style={styles.cell}>
                                <Text style={styles.miniLabel}>Weight (lb)</Text>
                                <TextInput
                                  style={styles.input}
                                  value={r.weight}
                                  onChangeText={(t) => updateEditRow(r.id, { weight: t })}
                                  keyboardType="numeric"
                                  placeholder="body"
                                />
                              </View>
                            </View>
                          </View>
                        ))
                      )}
                      <TouchableOpacity style={styles.addExBtn} onPress={addEditRow}>
                        <Text style={styles.addExBtnText}>＋ Add exercise</Text>
                      </TouchableOpacity>

                      <Text style={styles.fieldLabel}>Duration (min, optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={edDuration}
                        onChangeText={setEdDuration}
                        keyboardType="numeric"
                        placeholder="—"
                      />
                    </>
                  ) : (
                    <>
                      {/* Activity / class day — simpler fields, no exercise rows. */}
                      <Text style={styles.fieldLabel}>Activity</Text>
                      <TextInput
                        style={styles.input}
                        value={edActivity}
                        onChangeText={setEdActivity}
                        placeholder="e.g. Pilates, Run, F45"
                      />
                      <View style={styles.row2}>
                        <View style={styles.cell}>
                          <Text style={styles.miniLabel}>Duration (min)</Text>
                          <TextInput
                            style={styles.input}
                            value={edDuration}
                            onChangeText={setEdDuration}
                            keyboardType="numeric"
                            placeholder="—"
                          />
                        </View>
                        <View style={styles.cell}>
                          <Text style={styles.miniLabel}>Distance (optional)</Text>
                          <TextInput
                            style={styles.input}
                            value={edDistance}
                            onChangeText={setEdDistance}
                            placeholder="e.g. 2 mi"
                          />
                        </View>
                      </View>
                    </>
                  )}
                </>
              )}

              <TouchableOpacity style={styles.saveBtn} onPress={saveDayEdit}>
                <Text style={styles.saveBtnText}>Save day</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => setEditDayWd(null)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}

      {/* Week in review → next week (Stage B) — gated on `active` so it's fully
          unmounted (not just visible={false}) when Workout is hidden; see the
          `active` prop note. */}
      {active && (
      <Modal visible={reviewOpen} animationType="slide" transparent onRequestClose={() => setReviewOpen(false)}>
        {/* Per-Modal GestureHandlerRootView — see add-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={reviewSwipe.gesture}>
          <Animated.View style={[styles.sheet, reviewSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>next week</Text>
                <TouchableOpacity onPress={() => setReviewOpen(false)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...reviewSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {reviewing ? (
                <View style={styles.planLoading}>
                  <ActivityIndicator color={SPINNER} />
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
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 24, paddingBottom: 60 },

  // Header — phase·day eyebrow over the lowercase "workout" title, avatar at
  // top-right (mockup .head). Row layout, baseline-aligned to the title.
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  // Header avatar (mockup .avatar): cocoa circle, cream initials.
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 4,
  },
  avatarImg: { width: 42, height: 42, borderRadius: 21 },
  avatarText: { fontFamily: fontBold, fontSize: 13, color: colors.cream, letterSpacing: -0.3 },
  eyebrow: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fontExtrabold,
    fontSize: 38,
    color: colors.ink,
    letterSpacing: -1.8,
    marginTop: 7,
  },

  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },

  // Phase-lean note card (cream tile, mockup .summary register).
  leanCard: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 18,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
  },
  leanPhase: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.mistDark,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  leanText: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20 },

  sectionLabel: {
    fontFamily: fontBold,
    fontSize: 9,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 2.5,
    marginTop: 4,
    marginBottom: 12,
  },
  empty: { fontFamily: fontRegular, color: colors.inkMuted, fontSize: 14, lineHeight: 22 },
  recentDay: { fontFamily: fontSemibold, fontSize: 12, color: colors.inkMuted, marginTop: 10, marginBottom: 4 },

  // Log cards — top/bottom hairline rule, kcal/min value on the right (mockup .logcard).
  card: {
    backgroundColor: "transparent",
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: colors.cardHairline,
    paddingVertical: 15,
    paddingHorizontal: 4,
    marginTop: 14,
  },
  cardTitle: { fontFamily: fontSemibold, fontSize: 16, color: colors.ink },
  cardSub: { fontFamily: fontRegular, fontSize: 12, color: colors.inkMuted, marginTop: 5, lineHeight: 17 },
  cardExercise: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, marginTop: 4 },
  // Calorie/burn line: the mockup renders kcal in cocoa ink (no orange).
  cardBurn: { fontFamily: fontSemibold, fontSize: 13, color: colors.ink, marginTop: 6 },
  cardNote: { fontFamily: fontRegular, fontSize: 13, color: colors.inkMuted, marginTop: 6 },

  // ===== Sheets ===== (mockup .sheet on glaze/cream)
  backdrop: { flex: 1, backgroundColor: "rgba(26,16,10,0.38)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: "92%",
    paddingTop: 10,
  },
  // Drag handle (mockup .handle): centered tan grabber bar.
  handle: { alignItems: "center", paddingTop: 0, paddingBottom: 4 },
  handleBar: { width: 38, height: 4, borderRadius: 999, backgroundColor: colors.handle },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  sheetTitle: { fontFamily: fontExtrabold, fontSize: 27, color: colors.ink, letterSpacing: -1.2 },
  close: { fontFamily: fontMedium, fontSize: 24, color: colors.inkMuted },
  sheetScroll: { paddingHorizontal: 22, paddingBottom: 32 },

  // In-sheet segmented control (mockup .seg2): vapor track, white-on-cocoa selected.
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 13,
    padding: 4,
    marginTop: 14,
  },
  tab: { flex: 1, paddingVertical: 11, alignItems: "center", borderRadius: 10 },
  tabActive: { backgroundColor: colors.paper },
  tabText: { fontFamily: fontBold, fontSize: 13, color: colors.mistDark },
  tabTextActive: { color: colors.ink },

  builtBox: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 16,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
  },
  builtRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  builtText: { fontFamily: fontRegular, fontSize: 14, color: colors.ink, flex: 1, paddingRight: 8, lineHeight: 20 },
  builtRemove: { fontFamily: fontBold, fontSize: 15, color: colors.inkMuted },

  // Sheet field labels (mockup .slabel): wide-tracked uppercase slate.
  fieldLabel: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.mistDark,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 10,
  },
  miniLabel: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.inkMuted,
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.creamTile,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    fontFamily: fontRegular,
    color: colors.ink,
  },
  estHint: { fontFamily: fontRegular, fontSize: 11, color: colors.inkMuted, marginBottom: 6, lineHeight: 15 },
  row2: { flexDirection: "row", gap: 10 },
  row3: { flexDirection: "row", gap: 10 },
  cell: { flex: 1 },

  // Chips (mockup .schip): warm outline; selected = cocoa fill, cream label.
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  // Workout-days picker: 7 equal-width chips on a single no-wrap line. Each chip
  // flexes to share the row evenly; tight padding + small gap keep Sun..Sat on
  // one line at standard iPhone widths while staying tappable (~44pt tall).
  dayRow: { flexDirection: "row", gap: 5, marginTop: 10 },
  dayChip: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    borderRadius: radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fontMedium, fontSize: 13, color: colors.ink },
  chipTextActive: { color: colors.cream },
  // "+ Add exercise" outline pill (mockup .soutline): cocoa outline.
  addExBtn: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 14,
  },
  addExBtnText: {
    fontFamily: fontBold,
    color: colors.ink,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  editHint: { fontFamily: fontRegular, fontSize: 11, color: colors.inkMuted, marginTop: 8, lineHeight: 16 },

  // Primary CTA (mockup .scta button): filled cocoa, uppercase letterspaced.
  saveBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnDisabled: { backgroundColor: colors.handle },
  saveBtnText: {
    fontFamily: fontBold,
    color: colors.cream,
    fontSize: 12,
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  // Spinner + rotating reassurance line, centered inside the fixed-width pill.
  // White breathing label, centered on the dark button; sentence-case (not the
  // uppercase saveBtnText), and shrinks via adjustsFontSizeToFit so the longest
  // line ("Factoring in where you are in your cycle…") fits on one line.
  saveBtnLoadingText: {
    fontFamily: fontBold,
    color: colors.cream,
    fontSize: 13,
    textAlign: "center",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  deleteBtn: { alignItems: "center", paddingVertical: 13, marginTop: 8 },
  deleteBtnText: {
    fontFamily: fontBold,
    color: colors.warmAlert,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  // Plan
  planLoading: { alignItems: "center", gap: 10, paddingVertical: 28 },
  planLoadingText: { fontFamily: fontRegular, color: colors.inkMuted, fontSize: 14, letterSpacing: 1.5, textTransform: "uppercase" },
  // No-plan CTA card (cream tile in the program-card register).
  planCta: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.xl,
    padding: 20,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
  },
  planCtaTitle: { fontFamily: fontExtrabold, fontSize: 20, color: colors.ink, letterSpacing: -0.5 },
  planCtaText: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20, marginTop: 8 },
  planCtaBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 16,
  },
  planCtaBtnText: {
    fontFamily: fontBold,
    color: colors.cream,
    fontSize: 12,
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },

  planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  planProgram: { fontFamily: fontExtrabold, fontSize: 23, color: colors.ink, letterSpacing: -0.8 },
  planWeek: { fontFamily: fontSemibold, fontSize: 11, color: colors.inkMuted, marginTop: 4, letterSpacing: 1, textTransform: "uppercase" },
  // "New plan" ghost link → cocoa outline pill (mockup .ghostbtn).
  planEdit: {
    fontFamily: fontBold,
    fontSize: 10,
    color: colors.ink,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: "hidden",
  },

  // Week-in-review CTA — cream summary tile (not a filled block).
  reviewCta: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
  },
  reviewCtaTitle: { fontFamily: fontBold, color: colors.ink, fontSize: 16 },
  reviewCtaText: { fontFamily: fontRegular, color: colors.cocoaSoft, fontSize: 13, marginTop: 6, lineHeight: 19 },
  reviewDay: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.rowHairline,
  },
  reviewDayName: {
    width: 44,
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  reviewDayTitle: { flex: 1, fontFamily: fontMedium, fontSize: 15, color: colors.ink },

  // "Why this week" — program-card cream register.
  whyCard: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
  },
  whyLabel: {
    fontFamily: fontBold,
    fontSize: 9,
    color: colors.mistDark,
    textTransform: "uppercase",
    letterSpacing: 2.5,
    marginBottom: 8,
  },
  whyText: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20 },

  // Day strip pills (mockup .day / .dd): cocoa-filled "on".
  dayPills: { marginBottom: 14 },
  dayPill: {
    minWidth: 46,
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.creamTile,
  },
  dayPillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  dayPillToday: { borderColor: colors.ink, borderWidth: 1 },
  dayPillText: { fontFamily: fontBold, fontSize: 13, color: colors.cocoaSoft },
  dayPillTextOn: { color: colors.cream },
  dayPillMark: { fontFamily: fontBold, fontSize: 11, color: colors.checkDone, height: 14 },

  // Day card (mockup .dcard): white card, cocoa accent border on today.
  dayCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    marginBottom: 11,
  },
  dayTitle: { fontFamily: fontBold, fontSize: 16, color: colors.ink, letterSpacing: -0.3 },
  daySub: { fontFamily: fontRegular, fontSize: 11.5, color: colors.inkMuted, marginTop: 3 },
  dayNote: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20, marginTop: 10 },
  // Coach-route secondary line — the calmer half of the footer action pair. The
  // hairline that used to live here now belongs to dayFooter (so the whole action
  // area reads as one footer); this is now a quiet muted-ink text row sitting
  // beneath the primary Edit chip, with a small left inset so it aligns under the
  // chip's text rather than its border.
  flexLink: { marginTop: 12, paddingLeft: 2 },
  flexLinkText: { fontFamily: fontMedium, color: colors.inkMuted, fontSize: 12, lineHeight: 17 },

  // Exercise sections (mockup .sect .sh).
  planSection: { marginTop: 14 },
  planSectionName: {
    fontFamily: fontBold,
    fontSize: 9,
    color: colors.mistDark,
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 9,
  },
  exRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, gap: 12 },
  // Completed check (mockup .chk.on): deep-sage fill, sage border.
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  checkboxOn: { backgroundColor: colors.checkDone, borderColor: colors.checkDone },
  checkmark: { color: colors.paper, fontSize: 14, fontFamily: fontExtrabold, lineHeight: 16 },
  exName: { fontFamily: fontMedium, fontSize: 14.5, color: colors.ink },
  exDone: { textDecorationLine: "line-through", color: colors.inkMuted },
  exMeta: { fontFamily: fontRegular, fontSize: 13, color: colors.inkMuted, marginTop: 2, lineHeight: 18 },

  genError: { fontFamily: fontRegular, color: colors.period, fontSize: 14, marginTop: 14, lineHeight: 19 },
  genHint: { fontFamily: fontRegular, fontSize: 11, color: colors.inkMuted, marginTop: 16, lineHeight: 16, textAlign: "center" },

  // Sub-tabs (Plan | Log) — top segmented toggle (mockup .toggle).
  subtabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 4,
    marginTop: 16,
    marginBottom: 18,
  },
  subtab: { flex: 1, paddingVertical: 11, alignItems: "center", borderRadius: 11 },
  // Selected segment (mockup .toggle button.on, box-shadow 0 3px 8px -2px): a
  // subtle lift off the vapor track. (The track's inset shadow isn't cheap in RN
  // and is skipped.)
  subtabActive: {
    backgroundColor: colors.paper,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 2,
  },
  subtabText: { fontFamily: fontBold, fontSize: 13.5, color: colors.mistDark, letterSpacing: 0.2 },
  subtabTextActive: { color: colors.ink },

  // (Removed) The 42-day Cal AI–style horizontal Log strip — the Log view now
  // reuses the Plan view's 7-cell Mon–Sun weekStrip (styles weekStrip/stripDay/
  // stripDn/stripDd/stripTrained, defined above), so the two strips are visually
  // identical.

  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 6,
  },
  logDate: { fontFamily: fontExtrabold, fontSize: 26, color: colors.ink, letterSpacing: -1 },

  // Per-day score tiles — cream summary register.
  scoreRow: { flexDirection: "row", gap: 10, marginTop: 14, marginBottom: 14 },
  scoreCard: {
    flex: 1,
    backgroundColor: colors.creamTile,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
  },
  scoreNum: { fontFamily: fontExtrabold, fontSize: 18, color: colors.ink },
  scoreLbl: { fontFamily: fontSemibold, fontSize: 11, color: colors.inkMuted, marginTop: 3, letterSpacing: 0.5 },

  // ===== Plan view — week-at-a-glance rebuild (mockup) =====

  // Week strip (mockup .strip): 7 even cells, weekday letter + date pill.
  weekStrip: { flexDirection: "row", marginBottom: 18, marginTop: 2 },
  stripDay: { flex: 1, alignItems: "center" },
  // Scrollable multi-week strip (CHANGE 2). The trained dot sits 8px below the
  // circle, so the row needs bottom padding to not clip it inside the ScrollView.
  stripScroll: { marginBottom: 18, marginTop: 2 },
  stripScrollContent: { alignItems: "flex-start", paddingBottom: 12, paddingHorizontal: 2 },
  stripCell: {
    width: STRIP_CELL_W,
    marginHorizontal: STRIP_CELL_MX,
    alignItems: "center",
  },
  // Extra gap at the start of each Sun-grouped week so the Sun–Sat grouping
  // reads visually without a divider line.
  stripWeekGap: { marginLeft: STRIP_CELL_MX + 12 },
  stripDn: { fontFamily: fontSemibold, fontSize: 10, letterSpacing: 1, color: colors.inkMuted },
  stripDnToday: { color: colors.ink },
  stripDd: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginTop: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.creamTile,
  },
  stripDdToday: { backgroundColor: colors.ink },
  stripDdNum: { fontFamily: fontBold, fontSize: 14, color: colors.cocoaSoft },
  stripDdNumToday: { color: colors.cream },
  stripTrained: {
    position: "absolute",
    bottom: -8,
    width: 5,
    height: 5,
    borderRadius: 3,
  },

  // Program card (mockup .program): cream tile, big name, why, progress bar.
  // Outer shadow wrapper (mockup box-shadow 0 12px 28px -16px @.30): carries the
  // soft drop shadow + an opaque creamTile backing iOS can cast from, with NO
  // overflow so the shadow isn't clipped. The inner programCard keeps
  // overflow:hidden to clip the rounded CardBloom glow.
  programCardShadow: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.xl,
    marginBottom: 18,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  programCard: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.xl,
    padding: 20,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    // Clip the absolute-fill CardBloom SVG to the card's rounded rect.
    overflow: "hidden",
  },
  programEyebrow: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.mistDark,
    textTransform: "uppercase",
  },
  // Calm "today" date header at the very top of the Plan view. Eyebrow matches
  // the secLabel/programEyebrow register (tiny, tracked, uppercase, muted); the
  // date itself is a quiet semibold ink line — readable but smaller than the
  // big program name so it doesn't compete. All tokens are existing.
  planTodayHeader: {
    marginBottom: 12,
  },
  planTodayEyebrow: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.inkMuted,
    textTransform: "uppercase",
  },
  planTodayDate: {
    fontFamily: fontSemibold,
    fontSize: 15,
    color: colors.ink,
    marginTop: 3,
  },
  programName: {
    fontFamily: fontExtrabold,
    fontSize: 23,
    color: colors.ink,
    letterSpacing: -0.8,
    marginTop: 8,
  },
  programWhy: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20, marginTop: 12 },
  progWrap: { marginTop: 18 },
  progTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.divider,
    overflow: "hidden",
  },
  progFill: { height: "100%", borderRadius: 999, backgroundColor: colors.ink },
  progMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  progMetaText: {
    fontFamily: fontBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.inkMuted,
    textTransform: "uppercase",
  },
  progMetaStrong: { color: colors.ink },

  // Section label (mockup .secLabel).
  secLabel: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.inkMuted,
    textTransform: "uppercase",
    marginTop: 4,
    marginBottom: 12,
  },

  // Day card (mockup .dcard): white card, today emphasized, rest dashed cream.
  // overflow:"hidden" removed — the expand body (dbody) is a conditional mount,
  // not an animated max-height, so nothing needs clipping; removing it lets the
  // card cast the mockup's soft drop shadow (0 4px 14px -7px @.16) directly. The
  // dashed rest border and the heavier today border render fine without it.
  dcard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    marginBottom: 11,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  // Today card (mockup .dcard.todayCard, 0 16px 32px -16px @.42): noticeably
  // lifted so it reads as the focal card of the week.
  dcardToday: {
    borderColor: "rgba(59,47,34,0.42)",
    borderWidth: 1,
    backgroundColor: colors.cream,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 7,
  },
  // Rest day (mockup .dcard.rest): flat dashed cream, no shadow — overriding the
  // dcard shadow back to none so the recovery card stays quiet.
  dcardRest: {
    backgroundColor: colors.creamTile,
    borderStyle: "dashed",
    borderColor: colors.divider,
    shadowOpacity: 0,
    elevation: 0,
  },
  dhead: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 16 },
  ddate: { width: 34, alignItems: "center" },
  ddateW: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.inkMuted,
    textTransform: "uppercase",
  },
  ddateN: { fontFamily: fontExtrabold, fontSize: 18, color: colors.ink, letterSpacing: -0.5, marginTop: 2 },
  dmain: { flex: 1, minWidth: 0 },
  dtitle: { fontFamily: fontBold, fontSize: 16, color: colors.ink, letterSpacing: -0.3 },
  dsub: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 3, gap: 7 },
  dsubMeta: { fontFamily: fontRegular, fontSize: 11.5, color: colors.inkMuted },

  // Intensity pin (mockup .pin): colored dot + wide-tracked label.
  pin: { flexDirection: "row", alignItems: "center", gap: 5 },
  pinDot: { width: 6, height: 6, borderRadius: 3 },
  pinText: { fontFamily: fontBold, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase" },

  dright: { flexDirection: "row", alignItems: "center", gap: 10 },
  // Completion check (mockup .chk / .chk.on): mist outline, sage fill when done.
  chk: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  chkOn: { backgroundColor: colors.checkDone, borderColor: colors.checkDone },
  chkMark: { fontFamily: fontExtrabold, fontSize: 14, color: colors.paper, lineHeight: 16 },
  caret: { fontFamily: fontRegular, fontSize: 12, color: colors.inkMuted },
  caretOpen: { transform: [{ rotate: "180deg" }] },

  // Expanded card body (mockup .dbody-inner): hairline top rule.
  dbody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 0.5,
    borderTopColor: colors.rowHairline,
  },
  sect: { marginTop: 14 },
  sectHead: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.mistDark,
    textTransform: "uppercase",
    marginBottom: 9,
  },
  // Exercise row (mockup .ex): name + cue left, value right, hairline rule.
  ex: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.rowHairline,
    gap: 12,
  },
  exCue: { fontFamily: fontRegular, fontSize: 11, color: colors.inkMuted, marginTop: 2 },
  exVal: { fontFamily: fontBold, fontSize: 13, color: colors.ink, letterSpacing: -0.2 },
  // Rest-card body (mockup .dcard.rest .dbody-inner): hairline top rule, a single
  // 12px gap to the note. Previously stacked restBody.paddingTop(12) +
  // restNote.marginTop(8) on top of dhead's 15px bottom pad, leaving a tall empty
  // band; the note now sits compactly under the divider to match the mockup.
  restBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.rowHairline,
  },
  // Note style used inside the compact rest card — no marginTop (the 12px gap
  // lives on restBody.paddingTop). Kept separate from restNote so the expanded
  // activity-section note below keeps its 8px separation from the row above it.
  restBodyNote: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20 },
  restNote: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20, marginTop: 8 },

  // Footer ghost pill (mockup .ghostbtn): full-width cocoa outline.
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 6,
    marginBottom: 8,
  },
  ghostBtnText: {
    fontFamily: fontBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.ink,
    textTransform: "uppercase",
  },

  // ===== Log view rebuild (mockup logView) =====
  logTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  logTitle: { fontFamily: fontExtrabold, fontSize: 26, color: colors.ink, letterSpacing: -1 },
  logDateLine: { fontFamily: fontRegular, fontSize: 13, color: colors.inkMuted, marginTop: 2, marginBottom: 8 },

  // Log card (mockup .logcard): top/bottom hairline rule, value on the right.
  logCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: colors.cardHairline,
    paddingVertical: 15,
    paddingHorizontal: 4,
    marginTop: 14,
  },
  logKind: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.mistDark,
    textTransform: "uppercase",
  },
  logName: { fontFamily: fontSemibold, fontSize: 16, color: colors.ink, marginTop: 5 },
  logDetail: { fontFamily: fontRegular, fontSize: 12, color: colors.inkMuted, marginTop: 5, lineHeight: 17 },
  logRight: { alignItems: "flex-end" },
  logVal: { fontFamily: fontExtrabold, fontSize: 20, color: colors.ink, letterSpacing: -0.5 },
  logValUnit: { fontFamily: fontRegular, fontSize: 10, color: colors.inkMuted, marginTop: 4, letterSpacing: 0.5 },

  // Source pill (mockup .src): plan = calm fill/slate, manual = cream/cocoa.
  srcPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 8 },
  srcPillPlan: { backgroundColor: colors.calmFill },
  srcPillManual: { backgroundColor: colors.cream },
  // "From Coach" pill: dark cocoa fill with light text — matches the user's chat
  // bubble in the Coach tab (colors.ink on colors.surface) so a Coach chat-logged
  // workout reads in the same voice as the Coach conversation itself.
  srcPillCoach: { backgroundColor: colors.ink },
  srcText: { fontFamily: fontBold, fontSize: 8.5, letterSpacing: 1.5, textTransform: "uppercase" },
  srcTextPlan: { color: colors.mistDark },
  srcTextManual: { color: colors.cocoaSoft },
  srcTextCoach: { color: colors.surface },

  // Weekly summary (mockup .summary): cream tile, factual recap.
  // Outer shadow wrapper (mockup box-shadow 0 10px 24px -15px @.28): soft drop
  // shadow + opaque creamTile backing, NO overflow. Inner summaryCard keeps
  // overflow:hidden to clip the rounded CardBloom glow.
  summaryCardShadow: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.lg,
    marginTop: 20,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  summaryCard: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    // Clip the absolute-fill CardBloom SVG to the card's rounded rect.
    overflow: "hidden",
  },
  summaryLabel: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.mistDark,
    textTransform: "uppercase",
  },
  summaryText: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 20, marginTop: 8 },

  // ===== Per-day edit affordances + sheet (Part B) =====
  // Footer action area of an expanded training day. A single hairline rule + top
  // padding lifts the whole edit/Coach pair off the exercise list above, so it
  // reads as a deliberate card footer rather than two stray text links. This
  // wrapper carries the divider (moved off flexLink) and is plain (no bg/shadow),
  // so it can't clip the dcard's outer shadow — it lives inside dbody, well
  // inside the card's shadowed boundary.
  dayFooter: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: colors.rowHairline,
  },
  // Primary direct-edit affordance — a quiet cocoa-outline chip (hairline border,
  // pill radius, cocoa text) with a small chevron. Reads as an intentional,
  // tappable control, not floating text. Self-sized so it hugs its label.
  editDayLink: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 7,
    paddingLeft: 14,
    paddingRight: 11,
    borderWidth: 1,
    borderColor: colors.cardHairline,
    borderRadius: radius.pill,
    backgroundColor: colors.creamTile,
  },
  editDayLinkText: {
    fontFamily: fontSemibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
    letterSpacing: 0.2,
  },
  // Small forward chevron on the Edit chip (NOT a pencil/edit glyph — Ting removed
  // that on purpose). Muted so it reads as a quiet directional cue, not a loud icon.
  editDayLinkArrow: {
    fontFamily: fontMedium,
    fontSize: 15,
    lineHeight: 18,
    color: colors.inkMuted,
  },
  // Neutral note shown in place of the edit chip on an already-done day — factual,
  // no streak/shame framing. Sits inside the same dayFooter frame.
  editNote: { fontFamily: fontRegular, fontSize: 12, color: colors.inkMuted, lineHeight: 17 },
  // Rest-day head "Edit" affordance — same quiet cocoa-outline chip language as the
  // training-card primary edit, scaled down for the head row so the two card types
  // share one visual vocabulary. No pencil glyph.
  editPencil: {
    paddingVertical: 5,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.cardHairline,
    borderRadius: radius.pill,
    backgroundColor: colors.creamTile,
    alignItems: "center",
    justifyContent: "center",
  },
  editPencilText: {
    fontFamily: fontSemibold,
    fontSize: 12,
    color: colors.ink,
    letterSpacing: 0.2,
    textAlign: "center",
  },

  // Edit-sheet specifics.
  editRestNote: { fontFamily: fontRegular, fontSize: 13, color: colors.cocoaSoft, lineHeight: 19, marginTop: 16 },
  // One exercise row in the edit sheet — a cream tile grouping the name+controls
  // line and the sets/reps/weight line.
  editExRow: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: colors.cardHairline,
    padding: 12,
    marginTop: 10,
    gap: 10,
  },
  editExTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  editMoveBtn: {
    width: 34,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  editMoveText: { fontFamily: fontBold, fontSize: 18, color: colors.ink },
  editMoveDisabled: { color: colors.divider },
  editRemoveText: { fontFamily: fontBold, fontSize: 16, color: colors.warmAlert },
  // "Cancel" text on the secondary action row (neutral, not destructive-tinted).
  cancelBtnText: {
    fontFamily: fontBold,
    color: colors.inkMuted,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
