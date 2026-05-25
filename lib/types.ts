// Shared data types for Flux — Feature A (the Coach prototype).

export type Goal = "lose_fat" | "tone_up" | "build_muscle" | "feel_better" | "maintain";

export type Tone = "hype" | "bestie" | "tough_love";

export type ActivityLevel = "sedentary" | "light" | "active" | "very_active";

// The user's profile. Saved once in Settings, persisted locally on the device.
export type Profile = {
  name: string;
  goal: Goal;
  tone: Tone;
  dietaryRules: string; // free text, e.g. "no dairy, prefers mornings, hates burpees"
  onBirthControl: boolean;
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

// One line in the Coach conversation.
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  date?: string; // "YYYY-MM-DD" the message belongs to (for day dividers + today-scoping)
  imageUri?: string; // local uri of an attached meal photo, shown in the bubble
  imageBase64?: string; // transient: JPEG sent to the vision model; stripped before persisting
};

// Human-readable labels for goals (shown in the UI and sent to the Coach).
export const GOAL_LABELS: Record<Goal, string> = {
  lose_fat: "Lose body fat",
  tone_up: "Tone up",
  build_muscle: "Build muscle",
  feel_better: "Feel better / more energy",
  maintain: "Maintain",
};

export const TONE_LABELS: Record<Tone, string> = {
  hype: "Hype",
  bestie: "Bestie",
  tough_love: "Tough Love",
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
  sedentary: "Sedentary (little or no exercise)",
  light: "Lightly active (1-3 days/week)",
  active: "Active (3-5 days/week)",
  very_active: "Very active (6-7 days/week)",
};

// --- Feature C: food + water logging -----------------------------------------

// How an entry was logged. "coach" = Coach estimated it from chat; "photo" = from
// a snapped meal/label photo; "saved" = a saved favorite; "meal" = part of a saved meal.
export type FoodSource = "search" | "barcode" | "manual" | "coach" | "photo" | "saved" | "meal";

// A food the user explicitly saved to reuse (a template, not tied to a date).
export type SavedFood = {
  id: string;
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantityLabel?: string;
  per100g?: { calories: number; protein: number; carbs: number; fat: number };
  barcode?: string;
};

// A named bundle of foods the user eats together (e.g. "my usual breakfast").
export type SavedMeal = { id: string; name: string; items: SavedFood[] };

// One optional weigh-in (Progress tab). lbs to match the rest of the app.
export type WeightEntry = { date: string; lbs: number };

// One logged food. Macros are stored for the AMOUNT she logged, so a day's
// totals are a plain deterministic sum (the durable fix for the calorie bug).
export type FoodEntry = {
  id: string;
  date: string; // "YYYY-MM-DD"
  name: string;
  brand?: string;
  calories: number; // for the logged quantity
  protein: number; // grams
  carbs: number; // grams
  fat: number; // grams
  quantityLabel?: string; // human label e.g. "150 g", "2 eggs", "1 container"
  source: FoodSource;
  barcode?: string;
  // Optional per-100g basis kept so the quantity editor can rescale cleanly.
  per100g?: { calories: number; protein: number; carbs: number; fat: number };
  createdAt: number;
};

// Macro bundle reused for totals and targets math.
export type Macros = { calories: number; protein: number; carbs: number; fat: number };

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
  source: "manual" | "coach";
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
