import {
  Profile,
  ChatMessage,
  GOAL_LABELS,
  TONE_STYLE,
  ACTIVITY_LABELS,
  WATER_GOAL_CUPS,
  WEEKDAY_LABELS,
  Weekday,
  PlanSetup,
  WeekPlan,
  PlanDay,
} from "./types";
import { currentPhase, toISODate, observedCycleLength, nextPredictedPeriod } from "./cycle";
import { computeTargets } from "./targets";
import { consumedTotals, entriesFor, remaining, waterFor } from "./food";
import { workoutsFor, workoutLabel, caloriesBurnedFor } from "./workouts";
import { mondayOf, newId, targetForDate, planDayForDate } from "./plan";
import { memoryLines } from "./memory";

// --- Models ---
// Haiku for routine chat (cheap), Sonnet for complex coaching + the opener.
const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-4-6";

const MAX_HISTORY = 16; // scoped memory: only the last N messages are sent (now spans days)

// API key. For SOLO TESTING ONLY it lives in the client bundle via EXPO_PUBLIC_.
// ⚠️ GRADUATION TRIGGER: before anyone else installs the app, move this call behind
// a server function (Supabase Edge Function) so the key never ships. See Feature H.
const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;

export function hasApiKey(): boolean {
  return !!API_KEY && !API_KEY.startsWith("PASTE_");
}

// Hard ED-safety + medical guardrails, shared verbatim across every LLM surface
// that produces free text the user reads (chat SYSTEM_PROMPT and the plan
// generator's PLAN_SYSTEM). Keeping this in ONE place guarantees safety is
// identical on both surfaces; editing it changes both at once. Crisis resources
// here must stay accurate (the NEDA phone helpline was discontinued in 2023 — do
// not reintroduce it). See also lib/safety.ts for the deterministic backstop that
// surfaces these resources independent of the model.
export const ED_SAFETY_RULES = `SAFETY (overrides everything, but does not make you timid):
- Never recommend calories below her estimated BMR. Never endorse starving, purging, fasting for weight loss, earning or compensating for food, or any sub-healthy target. If she asks for one, say no plainly and give the safe version instead. That is good coaching, not hedging.
- No medical advice, diagnosis, or treatment. You are not a medical provider. If something sounds medical, say so in one line and point her to her own doctor or provider.
- No supplement-by-name recommendations.
- Never body-shame, attack her body, her weight, or her worth, and never moralize about food being "good" or "bad."
- Care mode, only on genuine red flags (language about restricting, purging, self-harm, or real distress): stop the coaching push, respond with genuine warmth, and gently point her to real support. For eating-disorder concerns, mention the National Eating Disorders Association (NEDA) at nationaleatingdisorders.org or texting "NEDA" to 741741. If she mentions self-harm or suicidal thoughts, gently point her to the 988 Suicide & Crisis Lifeline (call or text 988). Do not trigger this for a normal bad day or an off-hand comment.`;

// Static persona + guardrails. Authoritative, human voice, decoupled safety.
const SYSTEM_PROMPT = `You are the Flux Coach: an expert, real fitness and nutrition coach for women who train with their cycle. Many of your users are not gym or nutrition people. They came here for a guide who tells them what to do, not a chatbot that makes them figure it out.

YOUR JOB: be the authority, without being pushy.
- When she asks for guidance, take a clear point of view: give a direct answer, concrete numbers, and a plan. Lead with the answer, then a short why. Do not make her configure things herself.
- Be honest when it matters. If something real is off (protein low all week, three skipped workouts), say so plainly. Do not nitpick a single fine meal or manufacture problems, and never attack her body or her worth.

READ THE ROOM: be easy to talk to, never argumentative or naggy.
- Respond to what she actually said. Do not interrogate her or ask about things she would not know yet — never ask about lunch or dinner right after she logs breakfast.
- Match her energy. If she is brief, or says "I don't know" or "not sure", accept it and keep your reply short. Do not push, do not argue, do not pressure her.
- Offer help at most once, only when it is genuinely useful, then drop it. Never repeat an offer she did not take, and never end a message with filler like "let me know if you want suggestions."
- Often the best reply is short and warm with nothing extra ("nice, eggs and toast is a solid start"). You do not need to add a task, a question, or a push to every message.

VOICE: text like a real person, not a bot.
- Plain conversational sentences. No markdown, no asterisks, no bullet points, no dashes used as bullets, no headings, no emojis.
- Short, calm, and natural. Sound like a knowledgeable friend who is also a great coach. Never salesy or over-eager.
- Match the coaching tone given in the context (it is the user's choice). Tone changes how you sound, never whether you are honest, and never the numbers.

MACROS, TARGETS, AND FOOD LOGGING:
- Her daily targets are already calculated for you and given in the context (calories and protein, carbs, fat). Present those EXACT numbers. Never invent, recompute, or change them, and never let your tone change them. The targets are her GOAL for the day.
- Flux now logs her food. The context gives you her REAL logged food for today, the consumed totals, and what is remaining versus her goal. These totals are summed in code from her actual entries, so they are trustworthy. You MAY tell her how much she has eaten and how much she has left — but ONLY using the consumed and remaining numbers given in the context. Never invent a tally, never estimate consumed or remaining numbers beyond what the context provides. If nothing is logged, the context will say so; then say plainly she has not logged anything yet.
- When she tells you she ate or drank something that is not already in today's logged list, LOG IT FOR HER by calling the log_food tool (one call per food) or log_water tool. If she did not give exact numbers, estimate the macros from typical values for that food and portion — estimates are approximate, so say so briefly and naturally (for example "logged that, roughly 280 calories, tweak it if you weighed it"). Do not claim something is logged unless you actually called the tool, and do not double-log an item that is already in today's list.
- PHOTOS: she can send two kinds.
  (a) A photo of a MEAL: identify each food, estimate its portion and macros, and log each with log_food.
  (b) A photo of a NUTRITION FACTS label / packaging: READ the printed numbers, do not estimate them. Use the per-serving calories/protein/carbs/fat as printed; figure out servings (if she said, use it; if not, assume 1 and say so), multiply, and log with log_food using the product name and a quantity label like "1 serving (40 g)".
  AFTER LOGGING (both kinds), always reply with: what you identified, the portion of each item, and its calories and macros, then the totals — for example "logged your lunch: grilled chicken (about 6 oz) 280 cal 52g protein, white rice (1 cup) 200 cal 44g carbs, broccoli (1 cup) 55 cal. total about 535 calories, 56g protein, 50g carbs, 9g fat." Keep it plain text, no markdown or bullets. For a meal say the numbers are an estimate; for a label say they're from the label. Then add one short tidbit on how her day is going — use ONLY the real consumed and remaining numbers from the context (never invent them), tie it to her goal, and say it in her tone (for example "that puts you around 1,200 of 1,800 today with protein on track, strong lunch and you've got room for a good dinner"). Be honest, not just cheerleading. Then invite corrections, e.g. "let me know if any portions are off and I'll fix it." If she then adds detail ("it also had olive oil", "that was two servings"), adjust by logging the extra or re-logging, or tell her to tap the entry on the Food tab to edit it.
- Calories burned in workouts appear in the context for awareness. In "net" calorie mode they add to her daily budget to help her FUEL her training — frame burned calories as a reason to eat enough, never as permission to eat less or as something to earn or burn off, and never push her below her BMR.
- If the context says targets are not available and she asks about them, tell her to add her age, height, and weight in Settings. Do not collect those stats in chat.
- Frame the targets as a strong starting point she will tune by results and how she feels. They already respect a safe floor (never below her BMR).

CYCLE AND DAILY CHECK-INS: speak about phases with confidence but stay honest that bodies vary. Use "many women find" and tie advice to how she actually feels and what she logs. Personalize over time. When today's check-in shows symptoms, energy, mood, or digestion, factor them into your food and training suggestions in a practical, food-first way (for example, many women find magnesium- and iron-rich foods or gentle movement help with cramps and fatigue; lighter, lower-sodium meals plus water can ease bloating; steady protein and complex carbs help with cravings and low energy). Keep it gentle and feel-based, never medical advice, never name specific supplements or doses.
- LOGGING HER CYCLE: when she tells you her period started or ended, or how she physically feels (cramps, bloating, energy, mood, digestion), record it with the log_checkin tool so her Cycle tab and phase stay current. Map her words to the fields (e.g. "my period started, kind of heavy" -> flow heavy; "so crampy and tired" -> symptoms cramps and fatigue, energy low). Confirm warmly and briefly, then give a feel-based tip; do not interrogate her for the other fields.

WORKOUTS:
- When she tells you she trained, log it with the log_workout tool. Lifting/strength -> kind "strength" with each exercise's name, sets, reps, and weight in lb (omit weight for bodyweight moves like push-ups). Cardio, a class, or a studio workout (Pilates, Lagree, boxing, yoga, spin, run, walk, hike) -> kind "activity" with the activity name and duration in minutes (and distance if she said one). For example "did 3 sets of 10 back squats at 95" -> strength; "45 minute lagree class" -> activity.
- Only log what she actually told you — don't invent sets, weights, or durations. If a detail is missing and it matters, you may ask one short question, otherwise log what you have. Confirm briefly and don't double-log something already shown in today's workouts.
- Tie training to her cycle phase gently and only when useful ("many women find they can push intensity in the follicular phase"). Never prescriptive, never medical.
- DAILY FLEX: the context gives today's weekday + date and this week's plan by day. If she says she's wiped, sore, short on time, or asks what to do, decide whether to adjust — and if so, call adjust_workout_day for the RIGHT day. It defaults to today; if she means another day ("Monday", "tomorrow"), pass that weekday — read the context's day map and "tomorrow = next weekday" so you target the correct one. You can make a day lighter, shorter, swapped, or a recovery/rest day. Honor genuine fatigue and her cycle, but if backing off is becoming a pattern, be honest about what it costs her goal and offer the smallest real session instead of just resting. Confirm which day you changed and that it's on her Plan tab. To RESCHEDULE rather than change a workout ("move Monday's workout to Tuesday", "I'm busy Monday"), use move_workout_day with from/to weekdays instead.

LONG-TERM MEMORY:
- You have a small, durable memory of facts about her, shown in the context under "WHAT YOU REMEMBER ABOUT HER". It is separate from this conversation and always applies — use it to stay consistent and personal across days.
- Use the remember_fact tool to save a lasting, useful fact she tells you: dietary restrictions or preferences, foods she likes or dislikes, injuries or physical limitations, equipment or training access, schedule constraints, life events, her goals and her "why," and what motivates her. Keep each fact short and factual, in your words (e.g. "no dairy", "bad left knee, avoid deep lunges", "trains at home with dumbbells and bands", "training for a wedding in October").
- Do NOT save transient daily data — today's food, mood, energy, or workout are already tracked elsewhere — and do not save trivia or anything that won't matter next week.
- Use the forget_fact tool when something changes or was wrong, so you can self-correct (e.g. she healed an injury, or stopped a restriction).
- ED-SAFETY (critical): never store a specific goal weight or a calorie number as a target to pursue, and never store restrictive or compensatory intentions, or body-shaming self-talk, as facts to act on. The SAFETY rules below still govern everything; memory must never be used to encode, remember toward, or optimize for an unsafe goal.

${ED_SAFETY_RULES}`;

// Volatile per-request context (kept AFTER the cacheable system block).
function buildContextBlock(profile: Profile): string {
  const phase = currentPhase(profile);
  const obs = observedCycleLength(profile);
  const pred = nextPredictedPeriod(profile);
  const cycleLine = phase.onBirthControl
    ? "On hormonal birth control, no natural cycle to sync to."
    : phase.dayOfCycle
      ? `${phase.phase} phase (cycle day ${phase.dayOfCycle} of ~${obs.length}${
          obs.fromHistory ? `, observed average from her logged history` : `, default prior`
        })`
      : "cycle phase unknown (no period logged yet)";
  const predictionLine =
    !phase.onBirthControl && pred
      ? `Next period predicted around ${pred.date} (~${pred.daysUntil} days away). This is an estimate from her own logged history, not a fact — speak about it gently and never as medical or fertility advice.`
      : "";

  // Today's check-in (flow / energy / mood / symptoms / digestion) drives
  // feel-based food and training suggestions.
  const tl = profile.dayLogs?.[toISODate(new Date())];
  const checkinParts: string[] = [];
  if (tl?.flow) checkinParts.push(`period flow ${tl.flow}`);
  if (tl?.energy) checkinParts.push(`energy ${tl.energy}`);
  if (tl?.moods?.length) checkinParts.push(`mood ${tl.moods.join(", ")}`);
  if (tl?.symptoms?.length) checkinParts.push(`symptoms ${tl.symptoms.join(", ")}`);
  if (tl?.digestion?.length) checkinParts.push(`digestion ${tl.digestion.join(", ")}`);
  if (tl?.note) checkinParts.push(`her note: ${tl.note}`);
  const checkinLine = checkinParts.length
    ? `Today's check-in (use this to tailor food and training, feel-based and food-first): ${checkinParts.join("; ")}.`
    : "Today's check-in: nothing logged yet today.";

  const toneStyle = TONE_STYLE[profile.tone] ?? TONE_STYLE.bestie;
  const activity = profile.activityLevel ? ACTIVITY_LABELS[profile.activityLevel] : "not set";

  const body = [
    profile.age ? `age ${profile.age}` : "",
    profile.height ? `height ${profile.height}` : "",
    profile.weight ? `weight ${profile.weight}` : "",
    profile.goalWeight ? `goal weight ${profile.goalWeight}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const now = new Date();
  const todayISO = toISODate(now);
  const todayLine = `Today: ${now.toLocaleDateString(undefined, { weekday: "long" })}, ${todayISO}, ${now.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" }
  )}. "Today" means this weekday; "tomorrow" is the next one.`;
  const planWk = profile.plan?.current;
  const planWeekLine = planWk
    ? `This week's plan (you can adjust ANY day with adjust_workout_day — pass its weekday; default is today): ${planWk.days
        .map((d) => `${WEEKDAY_LABELS[d.weekday]}=${d.kind === "rest" ? "Rest" : d.title}`)
        .join("; ")}.`
    : "";
  const planDay = planDayForDate(profile, todayISO);
  // Target is cycled by today's plan intensity (rest/light/moderate/hard) if there's a plan.
  const t = targetForDate(profile, todayISO);
  const cycleNote = planDay ? ` (today is a ${planDay.intensity} day, so calories are cycled to match)` : "";
  const targetsLine = t
    ? `Her daily GOAL targets${cycleNote} (present these EXACT numbers, never recompute): ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat`
    : "Daily targets: not enough data yet (need age, height, and weight) — if she asks, tell her to add them in Settings.";
  const plannedLine = planDay
    ? `Today's planned workout: ${planDay.kind === "rest" ? "Rest day" : planDay.title}${
        planDay.durationMin ? `, ~${planDay.durationMin} min` : ""
      } (${planDay.intensity}). If she's tired/sore/short on time or asks what to do, adjust the RIGHT day with the adjust_workout_day tool (default today, or pass the weekday she means, e.g. tomorrow) — stay honest and goal-oriented.`
    : "";

  // Real, code-summed food log for today. The Coach presents these, never invents.
  const entries = entriesFor(profile, todayISO);
  const consumed = consumedTotals(profile, todayISO);
  const foodLines = entries.length
    ? entries
        .map(
          (e) =>
            `- ${e.name}${e.quantityLabel ? ` (${e.quantityLabel})` : ""} — ${e.calories} kcal, ${e.protein}g P, ${e.carbs}g C, ${e.fat}g F`
        )
        .join("\n")
    : "(nothing logged yet today)";
  const consumedLine = entries.length
    ? `Consumed so far today (summed in code, exact — do not change): ${consumed.calories} kcal, ${consumed.protein}g protein, ${consumed.carbs}g carbs, ${consumed.fat}g fat.`
    : "She has logged no food yet today.";
  const burned = caloriesBurnedFor(profile, todayISO);
  const mode = profile.calorieMode ?? "static";
  let remainingLine = "";
  if (t) {
    const budgetCal = mode === "net" ? t.calories + burned : t.calories;
    const calLeft = budgetCal - consumed.calories;
    const r = remaining(consumed, t);
    const budgetNote = mode === "net" && burned ? ` (goal ${t.calories} + ${burned} burned)` : "";
    remainingLine = `Remaining today: ${calLeft} kcal${budgetNote}, ${r.protein}g protein, ${r.carbs}g carbs, ${r.fat}g fat.`;
  }
  const waterLine = `Water today: ${waterFor(profile, todayISO)} of ${WATER_GOAL_CUPS} cups.`;

  const workouts = workoutsFor(profile, todayISO);
  const workoutLine = workouts.length
    ? `Workouts logged today: ${workouts.map(workoutLabel).join("; ")}.`
    : "No workouts logged yet today.";
  const burnLine =
    burned > 0
      ? `Calories burned today: ~${burned}. Calorie mode is "${mode}" — ${
          mode === "net"
            ? "these are added to her food budget so she can fuel; encourage eating enough, never less."
            : "her food target is unchanged; this is for awareness only."
        }`
      : "";

  return [
    "--- CONTEXT (today) ---",
    `Her name: ${profile.name || "(not set)"}`,
    todayLine,
    `Cycle: ${cycleLine}`,
    ...(predictionLine ? [predictionLine] : []),
    checkinLine,
    `Her goal: ${GOAL_LABELS[profile.goal]}`,
    `Activity level: ${activity}`,
    `Body: ${body || "not provided"}`,
    targetsLine,
    "Today's food log (her REAL logged entries — present these and the totals below exactly, never invent others):",
    foodLines,
    consumedLine,
    ...(remainingLine ? [remainingLine] : []),
    waterLine,
    workoutLine,
    ...(planWeekLine ? [planWeekLine] : []),
    ...(plannedLine ? [plannedLine] : []),
    ...(burnLine ? [burnLine] : []),
    "To add a food, water, workout, or cycle check-in she mentions that is not already shown above, call the matching log tool (log_food / log_water / log_workout / log_checkin). The conversation may span days; a message starting with [YYYY-MM-DD] marks that day. Never invent consumed or remaining numbers beyond those given here.",
    `Her preferences/rules: ${profile.dietaryRules || "none specified"}`,
    ...(memoryLines(profile) ? [memoryLines(profile)] : []),
    `Coaching tone to use: ${toneStyle}`,
    "What she has said/logged today is in the conversation below.",
  ].join("\n");
}

// Route simple messages to Haiku; escalate plans/macros/food/coaching to Sonnet
// (Sonnet gives better macro estimates when logging food she describes).
function pickModel(text: string): string {
  const t = text.toLowerCase();
  const complex =
    text.length > 200 ||
    /\bwhy\b|\bplan\b|macro|calorie|protein|target|feel|stress|anxious|\bsad\b|depress|tired|exhaust|advice|should i\b|explain|struggl|\bate\b|\beat\b|\bhad\b|breakfast|lunch|dinner|snack|drank|\bwater\b|\blog\b/.test(
      t
    );
  return complex ? SONNET : HAIKU;
}

// --- Food-logging tools the Coach can call --------------------------------------
// When she tells the Coach what she ate, it calls log_food and the entry becomes
// real, code-summed data — never a number the model made up in prose.

export type LogFoodArgs = {
  name: string;
  quantity?: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};
export type LogWaterArgs = { cups: number };
export type LogCheckinArgs = {
  flow?: "spotting" | "light" | "medium" | "heavy" | "none";
  energy?: "low" | "medium" | "high";
  moods?: string[];
  symptoms?: string[];
  digestion?: string[];
  note?: string;
  date?: string;
};
export type LogWorkoutArgs = {
  kind?: "strength" | "activity";
  exercises?: { name: string; sets?: number; reps?: number; weight?: number }[];
  activity?: string;
  durationMin?: number;
  distance?: string;
  caloriesBurned?: number; // only if she gave a watch number
  avgHr?: number;
  maxHr?: number;
  note?: string;
  date?: string;
};
export type MoveDayArgs = { from: Weekday; to: Weekday };
export type RememberFactArgs = { fact: string };
export type ForgetFactArgs = { fact: string };
export type AdjustDayArgs = {
  weekday?: Weekday; // which day to change; defaults to today
  kind?: "strength" | "activity" | "rest";
  title: string;
  intensity?: "rest" | "light" | "moderate" | "hard";
  durationMin?: number;
  activity?: string;
  exercises?: { name: string; sets?: number; reps?: string; weight?: number; note?: string }[];
  note?: string;
};

// Runs a tool call against the local store; returns a short result string the
// model reads back (with the updated, code-summed totals).
export type ToolRunner = (name: string, input: unknown) => Promise<string>;

const FOOD_TOOLS = [
  {
    name: "log_food",
    description:
      "Log one food the user says she ate into today's food diary. Call once per distinct food. If she did not give exact numbers, estimate the macros from typical values for that food and portion. Do not call this for a food already shown in today's logged list.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short food name, e.g. 'scrambled eggs' or 'oat milk latte'." },
        quantity: { type: "string", description: "Human portion label, e.g. '2 eggs', '1 cup', '150 g'." },
        calories: { type: "number", description: "Estimated calories for that portion." },
        protein: { type: "number", description: "Grams of protein." },
        carbs: { type: "number", description: "Grams of carbohydrate." },
        fat: { type: "number", description: "Grams of fat." },
      },
      required: ["name", "calories"],
    },
  },
  {
    name: "log_water",
    description: "Add cups of water the user says she drank to today's water count. One glass = one cup.",
    input_schema: {
      type: "object",
      properties: {
        cups: { type: "number", description: "Number of 8 oz cups to add." },
      },
      required: ["cups"],
    },
  },
  {
    name: "log_checkin",
    description:
      "Record the user's cycle check-in when she mentions her period, flow, energy, mood, or physical symptoms. This updates her Cycle tab and her phase. Setting flow marks that day as a period (bleed) day; flow 'none' means she is not bleeding / her period ended. Pass only the fields she actually mentioned.",
    input_schema: {
      type: "object",
      properties: {
        flow: {
          type: "string",
          enum: ["spotting", "light", "medium", "heavy", "none"],
          description: "Period flow. Use 'none' if she says her period ended or it's not a period day.",
        },
        energy: { type: "string", enum: ["low", "medium", "high"] },
        moods: { type: "array", items: { type: "string" }, description: "e.g. Irritable, Calm, Anxious." },
        symptoms: {
          type: "array",
          items: { type: "string" },
          description: "e.g. Cramps, Bloating, Fatigue, Headache, Cravings.",
        },
        digestion: {
          type: "array",
          items: { type: "string" },
          description: "e.g. Bloated, Normal, Constipated, Loose.",
        },
        note: { type: "string", description: "Any extra detail she shared, in her words." },
        date: { type: "string", description: "ISO date YYYY-MM-DD; defaults to today if omitted." },
      },
    },
  },
  {
    name: "log_workout",
    description:
      "Log a workout she says she did. Two kinds: 'strength' — provide exercises, each with a name, number of sets, reps per set, and optional weight in lb (omit weight for bodyweight); or 'activity' — cardio, a class, or studio workout (Pilates, Lagree, boxing, yoga, spin, run, walk, ...) with the activity name plus duration in minutes (and distance if she gave one). Infer the kind from what she says. Use today unless she gives a date.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["strength", "activity"] },
        exercises: {
          type: "array",
          description: "For strength workouts, one item per exercise.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Exercise name, e.g. 'Back squat'." },
              sets: { type: "number", description: "Number of sets." },
              reps: { type: "number", description: "Reps per set." },
              weight: { type: "number", description: "Weight per set in lb; omit for bodyweight." },
            },
            required: ["name"],
          },
        },
        activity: {
          type: "string",
          description: "For activity workouts, e.g. 'Pilates', 'Run', 'Boxing'.",
        },
        durationMin: {
          type: "number",
          description: "Duration in minutes (for either kind). Used to estimate calories burned.",
        },
        distance: { type: "string", description: "Activity distance if given, e.g. '2 mi'." },
        caloriesBurned: {
          type: "number",
          description: "Only if she gave a number from her watch/tracker; otherwise omit and the app estimates it.",
        },
        avgHr: { type: "number", description: "Average heart rate, if she mentioned it." },
        maxHr: { type: "number", description: "Max heart rate, if she mentioned it." },
        note: { type: "string" },
        date: { type: "string", description: "ISO YYYY-MM-DD; defaults to today." },
      },
    },
  },
  {
    name: "adjust_workout_day",
    description:
      "Rewrite a day in her current week's plan when she's tired/sore/short on time or wants something different. Defaults to today; set weekday to change a specific day (e.g. she says 'Monday' or 'tomorrow' — use the context's day map to pass the right weekday). Make it lighter, shorter, swapped, or a recovery/rest day — but stay honest and goal-oriented (don't keep easing off if it's becoming a pattern). Provide the new title and intensity, and either exercises (strength) or an activity.",
    input_schema: {
      type: "object",
      properties: {
        weekday: {
          type: "string",
          enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          description: "Which day to change. Omit for today.",
        },
        kind: { type: "string", enum: ["strength", "activity", "rest"] },
        title: { type: "string", description: "e.g. 'Lighter glutes + mobility', 'Recovery walk', 'Rest'." },
        intensity: { type: "string", enum: ["rest", "light", "moderate", "hard"] },
        durationMin: { type: "number" },
        activity: { type: "string", description: "For an activity day, e.g. 'Walk', 'Yoga'." },
        exercises: {
          type: "array",
          description: "For a strength day.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              sets: { type: "number" },
              reps: { type: "string" },
              weight: { type: "number", description: "lb" },
              note: { type: "string" },
            },
            required: ["name"],
          },
        },
        note: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "move_workout_day",
    description:
      "Reschedule a workout by swapping two days in her plan (e.g. 'move Monday's workout to Tuesday'). It swaps the two days' contents — whatever was on the target day moves to the source day. Use the context's day map to pick from/to.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          description: "The day the workout is currently on.",
        },
        to: {
          type: "string",
          enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          description: "The day to move it to.",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "remember_fact",
    description:
      "Save one durable, lasting fact about the user to long-term memory so you stay consistent and personal across days. Use for: dietary restrictions/preferences, foods she likes or dislikes, injuries or physical limitations, equipment/training access, schedule constraints, life events, her goals and her 'why,' and what motivates her. Keep the fact short and factual (e.g. 'no dairy', 'bad left knee, avoid deep lunges', 'training for a wedding in October'). Do NOT save transient daily data (today's food, mood, energy, workout — already tracked) or trivia. SAFETY: never store a specific goal weight or a calorie number to pursue, and never store restrictive, compensatory, or body-shaming intentions as facts to act on.",
    input_schema: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The lasting fact to remember, short and factual." },
      },
      required: ["fact"],
    },
  },
  {
    name: "forget_fact",
    description:
      "Remove a fact from long-term memory when it changed or was wrong, so you can self-correct (e.g. she healed an injury or stopped a restriction). Pass text that matches the stored fact you want removed; the closest match is removed. No-op if nothing matches.",
    input_schema: {
      type: "object",
      properties: {
        fact: { type: "string", description: "Text matching the stored fact to forget." },
      },
      required: ["fact"],
    },
  },
];

// --- Low-level message plumbing -------------------------------------------------

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
type ApiMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

// The Messages API requires the first message to be from the user.
function toApiMessages(history: ChatMessage[]): ApiMessage[] {
  let msgs = history.slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role === "assistant") msgs = msgs.slice(1);
  // Tag the first message of each day with [YYYY-MM-DD] so the Coach can tell
  // today's entries from earlier days (history now spans multiple days).
  let lastDate = "";
  return msgs.map((m) => {
    let text = m.content;
    if (m.date && m.date !== lastDate) {
      text = `[${m.date}] ${text}`;
      lastDate = m.date;
    }
    // A meal photo becomes an image block plus a text block (vision input).
    if (m.imageBase64) {
      return {
        role: m.role,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: m.imageBase64 } },
          { type: "text", text: text || "Here's a photo of what I ate — estimate it and log it." },
        ],
      };
    }
    return { role: m.role, content: text };
  });
}

type ApiResponse = { content?: ContentBlock[]; stop_reason?: string };

// One POST to Claude via plain fetch (no SDK, so it bundles in Expo Go).
async function postMessages(
  profile: Profile,
  messages: ApiMessage[],
  model: string,
  useTools: boolean
): Promise<ApiResponse> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1500,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: buildContextBlock(profile) },
    ],
    messages,
  };
  if (useTools) body.tools = FOOD_TOOLS;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY as string,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message ?? JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Claude API ${res.status}: ${detail}`);
  }
  return (await res.json()) as ApiResponse;
}

function textFrom(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text?: string } => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

// Run a turn, resolving any log_food / log_water tool calls via runTool before
// returning the Coach's final text.
async function runConversation(
  profile: Profile,
  base: ApiMessage[],
  model: string,
  runTool?: ToolRunner
): Promise<string> {
  const messages: ApiMessage[] = [...base];
  const useTools = !!runTool;
  for (let step = 0; step < 5; step++) {
    const data = await postMessages(profile, messages, model, useTools);
    const blocks = data.content ?? [];
    const toolUses = blocks.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
        b.type === "tool_use"
    );
    if (useTools && data.stop_reason === "tool_use" && toolUses.length) {
      messages.push({ role: "assistant", content: blocks });
      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        let out: string;
        try {
          out = await runTool!(tu.name, tu.input);
        } catch (e) {
          out = `Could not log that: ${e instanceof Error ? e.message : String(e)}`;
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    return textFrom(blocks);
  }
  return "I logged that for you — take a look at your Food tab.";
}

const NO_KEY_MSG =
  "I'm not connected to my brain yet. Add your Anthropic API key to the .env file (EXPO_PUBLIC_ANTHROPIC_API_KEY=...) and restart with: npx expo start -c";

// A normal chat turn. Pass runTool to let the Coach log food/water she's told about.
export async function askCoach(
  profile: Profile,
  history: ChatMessage[],
  runTool?: ToolRunner
): Promise<string> {
  if (!hasApiKey()) return NO_KEY_MSG;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  // A photo always goes to Sonnet (vision + better food estimates).
  const model = lastUser?.imageBase64 ? SONNET : pickModel(lastUser?.content ?? "");
  const text = await runConversation(profile, toApiMessages(history), model, runTool);
  return text || "(no response)";
}

// Proactive opener: greet + today's focus. No tools (nothing to log on a hello).
// Runs when the chat is empty (first run, and fresh each new day).
export async function coachKickoff(profile: Profile): Promise<string> {
  if (!hasApiKey()) return NO_KEY_MSG;
  const kickoff: ApiMessage = {
    role: "user",
    content:
      "Kick us off for today in your tone: a short warm hello and one line on what to focus on today given my cycle phase and goal. Two or three sentences, human, no lists or formatting. Do not dump my macros and do not ask me to set anything up.",
  };
  const text = await runConversation(profile, [kickoff], SONNET);
  return text || "(no response)";
}

// --- Photo estimation for the Food tab's "Snap a meal" -------------------------
// Unlike the chat flow (which logs via tool use mid-conversation), this returns
// STRUCTURED items so the Food tab can show a confirm/edit card before saving.

export type EstimatedFood = {
  name: string;
  quantity?: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

const PHOTO_SYSTEM = `You are a nutrition vision assistant for the Flux app. Look at the photo and report the food.
- If it is a meal or plate: identify each distinct food and estimate its portion, calories, and macros from typical values. Estimates are approximate.
- If it is a nutrition facts label or packaging: read the printed numbers exactly. Use the per-serving values and assume one serving unless the photo clearly shows otherwise.
Report by calling the report_foods tool, one entry per food, with realistic numbers and short human names (e.g. "Grilled chicken breast", "White rice").

${ED_SAFETY_RULES}`;

const REPORT_TOOL = {
  name: "report_foods",
  description: "Report the foods identified in the photo so the app can log them.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short food name." },
            quantity: { type: "string", description: "Portion label, e.g. '1 cup', '150 g', '1 serving'." },
            calories: { type: "number" },
            protein: { type: "number", description: "grams" },
            carbs: { type: "number", description: "grams" },
            fat: { type: "number", description: "grams" },
          },
          required: ["name", "calories"],
        },
      },
    },
    required: ["items"],
  },
};

export async function estimateFoodFromPhoto(
  base64: string,
  mode: "meal" | "label" | "auto" = "auto"
): Promise<EstimatedFood[]> {
  if (!hasApiKey()) throw new Error("Coach isn't connected — add your API key in .env.");
  const userText =
    mode === "label"
      ? "This is a nutrition facts label. Read the printed per-serving values exactly and report the item with those numbers; assume one serving unless the label clearly shows otherwise."
      : mode === "meal"
        ? "This is a photo of a meal. Identify each food and estimate its portion, calories, and macros."
        : "What food is in this photo? If it's a meal, estimate it; if it's a nutrition label, read the printed values. Report each item with calories and macros.";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY as string,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 1024,
      system: PHOTO_SYSTEM,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: "report_foods" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: userText },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message ?? JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Claude API ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { content?: ContentBlock[] };
  const block = (data.content ?? []).find(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use"
  );
  const items = ((block?.input as { items?: EstimatedFood[] })?.items ?? []) as EstimatedFood[];
  return items.filter((i) => i && i.name && typeof i.calories === "number");
}

// --- Feature E: tailored weekly plan generation --------------------------------

const PLAN_SYSTEM = `You are the Flux coach building one week of training for a woman who trains with her cycle. You are an expert, honest coach — warm but never a yes-man.

TAILOR THE WEEK TO:
- Her GOAL. Every choice serves it. Keep core lifts consistent week to week and progress them; this is a real program, not a random week.
- Her CYCLE PHASE (a prior, not a rule): many women can push intensity in the follicular and ovulatory phases and feel better with steadier, lower-volume work in the late luteal and menstrual phases — but still TRAINING, scaled, not skipped. Frame as "many women find," never medical.
- Her ACCESS: gym -> barbell/machine/dumbbell lifts; home -> bodyweight, bands, dumbbells; classes -> schedule the classes she actually does (e.g. F45, Pilates, Lagree, spin) on sensible days. Only program what she can actually do.
- Her EXPERIENCE (set sensible starting loads; for a first week say loads are a starting point to adjust by feel) and any INJURIES/LIMITATIONS (never program around or into an injury).
- Her schedule: if she gave specific training days, train on exactly those and make the others rest/active recovery; if she only gave a number, choose sensible days. Keep each session within her time budget (a 25-minute day must be a real 25-minute workout, not a 60-minute one).

HONEST AND GOAL-ORIENTED (critical):
- Adjustments must keep moving her toward her goal. Accommodate genuine fatigue and recovery, but do not just keep lowering things.
- If her recent history shows a pattern of skipping or repeatedly backing off, say so plainly in whyThisWeek: name the tradeoff against her goal and give the smallest real option (a shorter or lighter session) instead of defaulting to rest. Be honest about the timeline if the pattern continues. Honest, not shaming; never moralize about food or her body.

OUTPUT:
- Call generate_plan exactly once. Give each day a kind (strength/activity/class/rest), a short title, an intensity tag (rest/light/moderate/hard — used to set her calories), and for strength days, sections (warm-up, working sets, etc.) with exercises (name, sets, reps, weight in lb when applicable, and a short cue).
- whyThisWeek: 2-4 plain sentences, human, no markdown, explaining your reasoning from her goal + phase + inputs (and her recent week if given). This is the coaching she sees.

${ED_SAFETY_RULES}`;

const GENERATE_PLAN_TOOL = {
  name: "generate_plan",
  description: "Return one tailored week of training as structured data.",
  input_schema: {
    type: "object",
    properties: {
      programName: { type: "string", description: "Short program name tied to her goal." },
      whyThisWeek: { type: "string", description: "2-4 plain sentences explaining this week's choices." },
      days: {
        type: "array",
        description: "Seven days, Monday through Sunday.",
        items: {
          type: "object",
          properties: {
            weekday: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
            kind: { type: "string", enum: ["strength", "activity", "class", "rest"] },
            title: { type: "string" },
            focus: { type: "string" },
            location: { type: "string", description: "e.g. Gym, Home, F45" },
            durationMin: { type: "number" },
            intensity: { type: "string", enum: ["rest", "light", "moderate", "hard"] },
            sections: {
              type: "array",
              description: "Strength days: ordered sections.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "e.g. Warm-up, Working sets, Core, Cool-down" },
                  durationMin: { type: "number" },
                  exercises: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        sets: { type: "number" },
                        reps: { type: "string", description: "e.g. '10', '10-12', '30 sec'" },
                        weight: { type: "number", description: "lb; omit for bodyweight/band" },
                        note: { type: "string", description: "short cue or progression note" },
                      },
                      required: ["name"],
                    },
                  },
                },
                required: ["name", "exercises"],
              },
            },
            activity: { type: "string", description: "Activity/class name for non-strength days." },
            distance: { type: "string" },
            note: { type: "string", description: "Note for rest / class / recovery days." },
          },
          required: ["weekday", "kind", "title", "intensity"],
        },
      },
    },
    required: ["programName", "whyThisWeek", "days"],
  },
};

export type GenerateWeekOptions = { weekNumber?: number; recentSummary?: string; tweak?: string };

function planContext(profile: Profile, setup: PlanSetup, opts: GenerateWeekOptions): string {
  const phase = currentPhase(profile);
  const obs = observedCycleLength(profile);
  const pred = nextPredictedPeriod(profile);
  const t = computeTargets(profile);
  const body = [
    profile.age ? `age ${profile.age}` : "",
    profile.height ? `height ${profile.height}` : "",
    profile.weight ? `weight ${profile.weight}` : "",
    profile.goalWeight ? `goal weight ${profile.goalWeight}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const cycle = phase.onBirthControl
    ? "On hormonal birth control (no natural cycle to sync to — keep training steady)."
    : phase.dayOfCycle
      ? `${phase.phase} phase, cycle day ${phase.dayOfCycle} of ~${obs.length}${pred ? `; next period ~${pred.daysUntil} days away` : ""}`
      : "cycle phase unknown (no period logged yet)";

  return [
    `Goal: ${GOAL_LABELS[profile.goal]}`,
    `Cycle: ${cycle}`,
    `Body: ${body || "not provided"}`,
    t ? `Her daily calorie target (for context): ${t.calories} kcal, ${t.protein}g protein` : "Daily target: not enough data",
    setup.workoutDays?.length
      ? `Train on these days, rest the others: ${setup.workoutDays.map((d) => WEEKDAY_LABELS[d]).join(", ")}.`
      : `Days per week she wants to train: ${setup.daysPerWeek}.`,
    setup.sessionMinutes
      ? `Time per session: about ${setup.sessionMinutes} minutes — size each workout to fit.`
      : "",
    `Access: ${setup.access.join(", ") || "not specified"}`,
    setup.equipment ? `Equipment: ${setup.equipment}` : "",
    setup.classes ? `Classes she does: ${setup.classes}` : "",
    `Experience: ${setup.experience}`,
    setup.injuries ? `Injuries/limitations: ${setup.injuries}` : "No injuries reported.",
    memoryLines(profile),
    `This is week ${opts.weekNumber ?? 1}.`,
    opts.recentSummary ? `Recent history (use this to adapt honestly): ${opts.recentSummary}` : "First week — no history yet; set sensible starting loads.",
    opts.tweak ? `She asked you to adjust this week: ${opts.tweak}. Honor it where reasonable, but keep it goal-oriented and safe.` : "",
    "Build this week now via generate_plan.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateWeekPlan(
  profile: Profile,
  setup: PlanSetup,
  opts: GenerateWeekOptions = {}
): Promise<WeekPlan> {
  if (!hasApiKey()) throw new Error("Coach isn't connected — add your API key in .env.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY as string,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 4000,
      system: PLAN_SYSTEM,
      tools: [GENERATE_PLAN_TOOL],
      tool_choice: { type: "tool", name: "generate_plan" },
      messages: [{ role: "user", content: planContext(profile, setup, opts) }],
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {
      detail = await res.text();
    }
    throw new Error(`Claude API ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { content?: ContentBlock[] };
  const block = (data.content ?? []).find(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use"
  );
  const raw = (block?.input ?? {}) as {
    programName?: string;
    whyThisWeek?: string;
    days?: Array<Record<string, unknown>>;
  };
  if (!raw.days?.length) throw new Error("The coach didn't return a plan — try again.");

  const days: PlanDay[] = raw.days.map((d) => {
    const sections = Array.isArray(d.sections)
      ? (d.sections as Array<Record<string, unknown>>).map((s) => ({
          name: String(s.name ?? "Workout"),
          durationMin: typeof s.durationMin === "number" ? s.durationMin : undefined,
          exercises: Array.isArray(s.exercises)
            ? (s.exercises as Array<Record<string, unknown>>).map((e) => ({
                id: newId(),
                name: String(e.name ?? "Exercise"),
                sets: typeof e.sets === "number" ? e.sets : undefined,
                reps: e.reps != null ? String(e.reps) : undefined,
                weight: typeof e.weight === "number" ? e.weight : undefined,
                note: e.note != null ? String(e.note) : undefined,
              }))
            : [],
        }))
      : undefined;
    const kind = (d.kind as PlanDay["kind"]) ?? "rest";
    return {
      weekday: d.weekday as PlanDay["weekday"],
      kind,
      title: String(d.title ?? (kind === "rest" ? "Rest" : "Workout")),
      focus: d.focus != null ? String(d.focus) : undefined,
      location: d.location != null ? String(d.location) : undefined,
      durationMin: typeof d.durationMin === "number" ? d.durationMin : undefined,
      intensity: (d.intensity as PlanDay["intensity"]) ?? (kind === "rest" ? "rest" : "moderate"),
      sections,
      activity: d.activity != null ? String(d.activity) : undefined,
      distance: d.distance != null ? String(d.distance) : undefined,
      note: d.note != null ? String(d.note) : undefined,
    };
  });

  return {
    id: newId(),
    weekNumber: opts.weekNumber ?? 1,
    startDate: mondayOf(new Date()),
    programName: raw.programName || "Your plan",
    whyThisWeek: raw.whyThisWeek || "",
    days,
    createdAt: Date.now(),
  };
}
