// Shared data types for Wren — Feature A (the Coach prototype).

export type Goal = "lose_fat" | "tone_up" | "build_muscle" | "feel_better" | "maintain";

export type Tone = "hype" | "bestie" | "tough_love";

export type ActivityLevel = "sedentary" | "light" | "active" | "very_active";

// The user's profile. Saved once in Settings, persisted locally on the device.
export type Profile = {
  name: string;
  profilePhotoUri?: string;
  goal: Goal;
  tone: Tone;
  dietaryRules: string; // free text, e.g. "no dairy, prefers mornings, hates burpees"
  onBirthControl: boolean;
  // When false, the user has turned cycle tracking fully OFF: all cycle UI is
  // hidden app-wide and the Coach must not reference her menstrual cycle, phase,
  // or period. Independent of `onBirthControl` (a BC user still has tracking ON,
  // just without phase predictions). BACK-COMPAT: a missing value resolves to
  // `true` (loadProfile normalizes it) so no existing profile is silently turned
  // off — every "is off" check uses `=== false`.
  cycleTrackingEnabled: boolean;
  lastPeriodStart: string; // ISO date "YYYY-MM-DD"; ignored if onBirthControl. Legacy single-date field; kept in sync with the latest start derived from dayLogs for back-compat.
  avgCycleLength: number; // days, default 28. Used as the prior until dayLogs have enough history to observe the real average.
  // Feature B: daily cycle check-ins keyed by ISO "YYYY-MM-DD". A day counts as a
  // period (bleed) day when its `flow` is set. Source of truth for cycle history,
  // predictions, the calendar, and the symptoms/feelings the Coach reads.
  dayLogs: Record<string, DayLog>;
  // Feature C: structured food + water logging keyed by ISO "YYYY-MM-DD".
  // foodLogs is the source of truth for consumed calories/macros — totals are
  // SUMMED IN CODE (see lib/food.ts), so the Coach only ever reads/writes real
  // entries and can no longer hallucinate a fake calories-remaining tally.
  foodLogs: Record<string, FoodEntry[]>;
  waterLogs: Record<string, number>; // cups of water drunk that day
  savedFoods?: SavedFood[]; // foods she starred to reuse
  savedMeals?: SavedMeal[]; // named bundles she logs in one tap
  weightLog?: WeightEntry[]; // optional weight-over-time (Progress tab)
  // Feature C (workout): logged training keyed by ISO "YYYY-MM-DD". Strength
  // entries hold exercises with sets; activity entries (cardio, pilates, boxing,
  // classes, ...) hold an activity name + duration.
  workoutLogs: Record<string, WorkoutEntry[]>;
  // Optional biometrics — improve personalization and let the Coach set targets.
  age: string;
  height: string;
  weight: string;
  goalWeight: string;
  activityLevel: ActivityLevel;
  // Optional tape-measure body measurements (in inches), captured on a dedicated
  // onboarding "measurements" step and editable later. When all three are set
  // alongside a parseable height, the US Navy Method body-fat formula
  // (lib/bodycomp.ts navyBodyFatPercent) becomes the AUTHORITATIVE BF anchor
  // for the calibration vision call. Skipping any of them leaves the field
  // undefined — no silent defaults flow into the BF computation. None of these
  // drive macros: lib/targets.ts is untouched and still owns BMR + the 1200
  // kcal floor.
  waistIn?: number;
  neckIn?: number;
  hipIn?: number;
  // How calories burned in workouts affect the Food tab's daily budget:
  // "static" = burned shown but target unchanged (safe default); "net" = burned
  // adds to today's budget (eat-back), so harder training = more room to fuel.
  // Either way the base target keeps its BMR floor — burn never lowers it.
  calorieMode: CalorieMode;
  // Feature E: the tailored, rolling weekly plan (undefined until she sets one up).
  plan?: PlanState;
  // Long-term Coach memory: durable facts about her (preferences, restrictions,
  // injuries, access, life events, her "why") the Coach saves via a tool and that
  // load into EVERY context — separate from, and cheaper than, the chat window.
  coachMemory?: CoachMemory[];
  // Optional body photos picked during onboarding's photo calibration step and
  // editable later in Settings. Stored as the local URI returned by
  // expo-image-picker (which lands in the app cache). Base64 is STILL
  // use-then-discard — only the URI persists. If cache eviction becomes an issue
  // for a prototype these can be migrated to expo-file-system documentDir, but we
  // deliberately don't pull that dep in now to keep the Expo Go install lean.
  //
  // 2026-05 photo-quality upgrade: the self-photo split into FRONT and SIDE so
  // the calibration vision call can triangulate (a single full-body photo is a
  // weak read). The legacy field `currentPhotoUri` is migrated to
  // `currentFrontPhotoUri` in loadProfile for back-compat — see lib/storage.ts.
  currentFrontPhotoUri?: string;
  currentSidePhotoUri?: string;
  goalPhotoUri?: string;
  // Feature F1: timeline of optional body photos surfaced on the Progress tab.
  // Stored URIs only (no base64) — same cache-uri-only stance as the calibration
  // photos. ED-safety: the app NEVER scores, captions, or editorializes these
  // entries; the timeline is a passive log she chooses to grow (or not).
  photoLog?: BodyPhotoEntry[];
  // ISO timestamp the user dismissed the "it's been ~N weeks" banner. We compare
  // against the newest photoLog entry on read; a later entry re-arms the banner.
  photoBannerDismissedAt?: string;
  // Feature F2: optional timeline of REAL body-composition scan results (DEXA /
  // InBody / "other"). This is DISTINCT from the US Navy tape-measure infra
  // (waistIn/neckIn/hipIn + lib/bodycomp.ts navyBodyFatPercent), which drives the
  // onboarding calibration vision call from MEASUREMENTS, not from scans. The
  // scan log is a separate, user-curated source: actual machine numbers she
  // enters when she gets one. Both can coexist; neither feeds the other. The
  // Coach receives this log as factual context (latest + trend) but never gets
  // an image — these are numeric entries only.
  bodyCompLog?: BodyCompEntry[];
  // ISO timestamp the Coach last surfaced the BF%-trend suggestion. Used to
  // gate re-pestering: the rule below requires >=14 days since this marker
  // before the Coach can raise the same trend again. Set when the Coach calls
  // the mark_bf_trend_surfaced tool (in the same turn it raises the trend).
  lastBfTrendSurfacedAt?: string;
  // User-set macro override. When present, computeTargets returns these numbers
  // verbatim and skips the goal-multiplier + BMR floor math. The override may
  // sit BELOW the BMR floor — that's allowed only because Settings forces a
  // soft-warning + explicit confirm before saving a sub-floor number, and the
  // Coach's set_targets tool refuses sub-floor entirely (the Coach maintains
  // its own ED_SAFETY_RULES stance even when the user already chose to
  // override). All five numbers move together — see lib/targets.ts.
  //
  // Back-compat: profiles saved before fiber was tracked may persist a
  // customTargets without `fiber`. lib/targets.ts back-fills the field from
  // the formula on read so the rest of the app sees a complete bundle.
  customTargets?: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  // ISO date the override was set (optional, for Coach context "her targets
  // are custom since YYYY-MM-DD" — not load-bearing, just signal).
  customTargetsSetAt?: string;
};

// One durable fact the Coach remembers about the user. See lib/memory.ts.
export type CoachMemory = { id: string; text: string; date: string }; // date = ISO date added

export type CalorieMode = "static" | "net";

export const CALORIE_MODE_LABELS: Record<CalorieMode, string> = {
  static: "Static",
  net: "Net (eat-back)",
};

export type Flow = "spotting" | "light" | "medium" | "heavy";
export type EnergyLevel = "low" | "medium" | "high";

// One day's check-in. Everything optional; an entry with `flow` set is a period day.
export type DayLog = {
  date: string; // "YYYY-MM-DD"
  flow?: Flow;
  energy?: EnergyLevel;
  moods?: string[];
  symptoms?: string[];
  digestion?: string[];
  note?: string;
};

export const FLOW_OPTIONS: { key: Flow; label: string }[] = [
  { key: "spotting", label: "Spotting" },
  { key: "light", label: "Light" },
  { key: "medium", label: "Medium" },
  { key: "heavy", label: "Heavy" },
];

export const ENERGY_OPTIONS: { key: EnergyLevel; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
];

// Plain-string option lists (easy to tweak). Stored as-is on the DayLog.
export const MOOD_OPTIONS = [
  "Happy", "Calm", "Motivated", "Irritable", "Anxious", "Sad", "Sensitive", "Stressed", "Foggy",
];
export const SYMPTOM_OPTIONS = [
  "Cramps", "Bloating", "Headache", "Breast tenderness", "Backache", "Acne", "Fatigue", "Cravings",
  "Insomnia", "Nausea",
];
export const DIGESTION_OPTIONS = [
  "Normal", "Bloated", "Gassy", "Constipated", "Loose", "Nauseous", "Reflux",
];

// An editorial "data card" rendered in the chat under an assistant turn (see the
// Coach mockup). Two kinds:
//   - "logged": derived in code from a log_food tool run this turn (the food is
//     already in her diary). NO model/prompt involvement — built client-side.
//   - "suggested": surfaced by the Coach via the suggest_meal tool when it
//     proposes a meal. NOTHING is logged for a suggestion (it isn't consumed);
//     the card just carries the macro numbers + enough identity to SAVE it later.
// Persisted automatically because it lives on ChatMessage (saveChat serializes it).
export type CoachCard = CoachFoodCard | CoachPlanChangeCard | CoachPlanShiftCard;

// The original food card (logged or suggested meal). Unchanged shape.
export type CoachFoodCard = {
  kind: "logged" | "suggested";
  label: string; // editorial label shown small + tracked, e.g. "BREAKFAST", "LUNCH"
  name: string; // the food/meal name, e.g. "Eggs & toast"
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number; // optional, like FoodEntry — back-compat + not always estimated
  // Enough identity to build a SavedFood when she taps "Save for later" on a
  // suggested card. Mirrors the SavedFood shape's optional fields.
  brand?: string;
  quantityLabel?: string;
};

// CONFABULATION GUARD (workout-trust Stage 1): an authoritative "PLAN UPDATED"
// card pushed by the plan handlers (adjust_workout_day / move_workout_day) AFTER
// the write lands. It is built from the ACTUAL saved profile state (pre vs post),
// never from the model's tool args — so the model can't tell her a day changed
// without a real change behind it. Display-only for now (no Undo until Stage 4).
export type CoachPlanChangeCard = {
  kind: "plan_change";
  // Human weekday label(s) the change touched, e.g. "MON" or "MON → TUE".
  dayLabel: string;
  oldTitle: string; // the affected day's title before the write
  newTitle: string; // the affected day's title after the write (read back)
  // Exercise-level diff, computed from the real pre/post sections via dayExercises.
  added: number; // exercises present after but not before
  removed: number; // exercises present before but not after
  kept: number; // exercises present both before and after
  // True when NO previously-done exercise lost its done flag (completion intact);
  // false when at least one checked-off exercise's done flag was dropped by the
  // write (the destructive full-replace can do this — the card shows it honestly).
  completionPreserved: boolean;
};

// CONFABULATION GUARD (shift_plan): an authoritative "PLAN SHIFTED" card pushed
// by the shift_plan handler AFTER the whole-week rotation lands. Like
// CoachPlanChangeCard, it is produced only when a real, material rotation
// occurred — so the model can't tell her the week moved without a real change
// behind it. Carries just the direction + magnitude (the per-day diff is the
// rotation itself; the Plan tab shows the result). Display-only.
export type CoachPlanShiftCard = {
  kind: "plan_shift";
  direction: "forward" | "back";
  days: number; // positive count of days the whole week rotated by
};

// One line in the Coach conversation.
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  date?: string; // "YYYY-MM-DD" the message belongs to (for day dividers + today-scoping)
  imageUri?: string; // local uri of an attached meal photo, shown in the bubble
  imageBase64?: string; // transient: JPEG sent to the vision model; stripped before persisting
  // Optional editorial data cards attached to an ASSISTANT message (logged or
  // suggested meals). Rendered full-width under the bubble; persisted via saveChat.
  cards?: CoachCard[];
};

// Human-readable labels for goals (shown in the UI and sent to the Coach).
export const GOAL_LABELS: Record<Goal, string> = {
  lose_fat: "Lean out",
  tone_up: "Tone & define",
  build_muscle: "Build strength",
  feel_better: "Feel better",
  maintain: "Maintain",
};

export const TONE_LABELS: Record<Tone, string> = {
  hype: "Hype",
  bestie: "Knowledgeable friend",
  tough_love: "Tough love",
};

// Style descriptions sent to the Coach so it embodies the chosen tone.
export const TONE_STYLE: Record<Tone, string> = {
  hype: "upbeat and high energy, celebrate her wins and pump her up to take action, confident and exciting but never fake",
  bestie:
    "warm, casual and genuine, like her most knowledgeable friend who happens to be a great coach",
  tough_love:
    "firm, direct and accountable: pushes her hard and does not let her off the hook, but stays warm and clearly in her corner. Tough on the plan because she believes in her, never harsh, mean, or belittling. Accountability with love.",
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Mostly seated",
  light: "Lightly active",
  active: "Active",
  very_active: "Very active",
};

// --- Feature C: food + water logging -----------------------------------------

// How an entry was logged. "coach" = Coach estimated it from chat; "photo" = from
// a snapped meal/label photo; "saved" = a saved favorite; "meal" = part of a saved meal.
export type FoodSource = "search" | "barcode" | "manual" | "coach" | "photo" | "saved" | "meal";

// A food the user explicitly saved to reuse (a template, not tied to a date).
// Fiber is optional for back-compat — saved foods created before fiber tracking
// don't have the field; new ones (from OFF, manual save, edit) will.
export type SavedFood = {
  id: string;
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  quantityLabel?: string;
  per100g?: { calories: number; protein: number; carbs: number; fat: number; fiber?: number };
  barcode?: string;
};

// A named bundle of foods the user eats together (e.g. "my usual breakfast").
export type SavedMeal = { id: string; name: string; items: SavedFood[] };

// One optional weigh-in (Progress tab). lbs to match the rest of the app.
export type WeightEntry = { date: string; lbs: number };

// Feature F2 — one entry in the optional body-composition scan log on the
// Progress tab. Source = DEXA / InBody / "other" (any third-party scan she
// happens to get). bodyFatPct is the headline metric; leanMassLbs and
// muscleMassLbs are both optional because different reports surface them
// differently (DEXA -> lean mass; InBody -> muscle mass distinct from lean).
// note is free text. None of id/date are optional — those are always written
// at save-time.
//
// NOT to be confused with the Navy tape-measurement infrastructure
// (waistIn/neckIn/hipIn + lib/bodycomp.ts navyBodyFatPercent) which lives on
// the Profile separately and drives the onboarding calibration call. The two
// sources never feed each other: the tape method is a measurement-derived
// proxy used once at onboarding; this log is real machine scan output the
// user enters by hand.
export type BodyCompSource = "dexa" | "inbody" | "other";

export type BodyCompEntry = {
  id: string;
  date: string; // "YYYY-MM-DD"
  source: BodyCompSource;
  bodyFatPct?: number; // percentage as number, e.g. 22.4
  leanMassLbs?: number;
  muscleMassLbs?: number; // InBody often reports this separately from lean mass
  note?: string;
};

export const BODY_COMP_SOURCE_LABELS: Record<BodyCompSource, string> = {
  dexa: "DEXA",
  inbody: "InBody",
  other: "Other",
};

// Feature F1 — one entry in the optional body-photo timeline on the Progress tab.
// frontUri is what the UI surfaces as the "main" photo; sideUri is an optional
// second angle. note is free text she may or may not write. All fields except
// id/date are optional so an empty entry shouldn't exist — the save flow
// requires at least one URI.
export type BodyPhotoEntry = {
  id: string;
  date: string; // "YYYY-MM-DD"
  frontUri?: string;
  sideUri?: string;
  note?: string;
};

// One logged food. Macros are stored for the AMOUNT she logged, so a day's
// totals are a plain deterministic sum (the durable fix for the calorie bug).
//
// `fiber` is optional for BACK-COMPAT: entries logged before fiber was tracked
// will not have the field. All summing paths must treat `undefined` as 0
// (see consumedTotals in lib/food.ts).
export type FoodEntry = {
  id: string;
  date: string; // "YYYY-MM-DD"
  name: string;
  brand?: string;
  calories: number; // for the logged quantity
  protein: number; // grams
  carbs: number; // grams
  fat: number; // grams
  fiber?: number; // grams; optional for back-compat
  quantityLabel?: string; // human label e.g. "150 g", "2 eggs", "1 container"
  source: FoodSource;
  barcode?: string;
  // Optional per-100g basis kept so the quantity editor can rescale cleanly.
  per100g?: { calories: number; protein: number; carbs: number; fat: number; fiber?: number };
  createdAt: number;
};

// Macro bundle reused for totals and targets math. Fiber is included so a day's
// consumed totals and the target line both carry it; per-food `per100g` keeps
// fiber optional since older OFF records and older entries may not have it.
export type Macros = { calories: number; protein: number; carbs: number; fat: number; fiber: number };

export const WATER_GOAL_CUPS = 8;

// --- Feature C: workout logging ----------------------------------------------

export type WorkoutKind = "strength" | "activity";

// One set within a strength exercise. weight omitted = bodyweight.
export type WorkoutSet = { reps: number; weight?: number; done?: boolean };

export type WorkoutExercise = { id: string; name: string; sets: WorkoutSet[] };

// One logged workout. Strength = exercises with sets; activity = a named
// activity (cardio/class/studio) with a duration.
export type WorkoutEntry = {
  id: string;
  date: string; // "YYYY-MM-DD"
  kind: WorkoutKind;
  exercises?: WorkoutExercise[]; // strength
  activity?: string; // activity, e.g. "Pilates", "Run", "Boxing"
  durationMin?: number; // duration in minutes (both kinds; needed to estimate burn)
  distance?: string; // activity, optional, e.g. "2 mi"
  // Calories burned: estimated in code (MET formula) or taken from her watch.
  caloriesBurned?: number;
  burnSource?: "watch" | "estimate";
  avgHr?: number; // optional, from her watch
  maxHr?: number; // optional, from her watch
  note?: string;
  // Optional short descriptive focus carried over from a plan day (PlanDay.focus),
  // e.g. "hips, t-spine, slow core". DISPLAY-ONLY: it's surfaced in the Log card's
  // detail line and nowhere else — never used in burn estimation, plan generation,
  // calorie math, or Coach logic. Absent on manual/Coach-chat entries (no plan
  // origin), and absent on entries stored before this field existed; both are fine
  // because it's optional and purely cosmetic (no migration needed).
  focus?: string;
  // Origin of the entry, used for the Log card's source pill:
  //   "plan"   = a plan-day check-off (Plan tab: toggleDayDone/commitDay or
  //              toggleExercise/syncStrengthLog) → "From your plan"
  //   "coach"  = a Coach chat log via log_workout                → "From Coach"
  //   "manual" = hand-entered in the Log's add sheet             → "Added manually"
  // Purely a display label — never used in burn/calorie math.
  source: "manual" | "coach" | "plan";
  createdAt: number;
};

// Quick-pick activities (free text still allowed). Tweak freely.
export const ACTIVITY_OPTIONS = [
  "Run",
  "Walk",
  "Cycling",
  "Spin",
  "Yoga",
  "Pilates",
  "Lagree",
  "Boxing",
  "HIIT",
  "Swim",
  "Hike",
  "Dance",
];

// --- Feature E: tailored, rolling weekly plan --------------------------------

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export type PlanDayKind = "strength" | "activity" | "class" | "rest";
// Drives code-computed calorie cycling (rest lowest, hard highest).
export type DayIntensity = "rest" | "light" | "moderate" | "hard";
export type Experience = "beginner" | "intermediate" | "advanced";

export type PlanExercise = {
  id: string;
  name: string;
  sets?: number;
  reps?: string; // "10", "10-12", "30 sec" — flexible
  weight?: number; // lb; omit for bodyweight/band
  note?: string; // cue / progression note
  done?: boolean; // checked off this week
};

export type PlanSection = { name: string; durationMin?: number; exercises: PlanExercise[] };

export type PlanDay = {
  weekday: Weekday;
  kind: PlanDayKind;
  title: string; // "Glutes + Core", "HIIT Class", "Rest"
  focus?: string;
  location?: string; // "Gym" / "Home" / "F45"
  durationMin?: number;
  intensity: DayIntensity;
  sections?: PlanSection[]; // strength days
  activity?: string; // activity/class days
  distance?: string;
  note?: string; // rest / class / general note
  loggedEntryId?: string; // the WorkoutEntry created when this day was checked off
};

export type WeekPlan = {
  id: string;
  weekNumber: number;
  startDate: string; // ISO date of that week's Monday
  programName: string;
  whyThisWeek: string;
  days: PlanDay[]; // 7, Mon..Sun
  createdAt: number;
};

export type PlanSetup = {
  daysPerWeek: number;
  workoutDays?: Weekday[]; // specific days she wants to train (rest = the others)
  sessionMinutes?: number; // time budget per session
  access: string[]; // any of: "gym", "home", "classes"
  equipment?: string; // free text
  classes?: string; // free text — which classes she does
  experience: Experience;
  injuries?: string; // free text
};

export type PlanState = {
  setup: PlanSetup;
  current: WeekPlan | null;
  history: WeekPlan[];
};

export const ACCESS_OPTIONS: { key: string; label: string }[] = [
  { key: "gym", label: "Gym" },
  { key: "home", label: "Home" },
  { key: "classes", label: "Classes" },
];
export const EXPERIENCE_OPTIONS: { key: Experience; label: string }[] = [
  { key: "beginner", label: "Beginner" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
];
