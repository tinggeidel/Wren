import AsyncStorage from "@react-native-async-storage/async-storage";
import { Profile, ChatMessage } from "./types";
import { toISODate } from "./cycle";

const PROFILE_KEY = "flux.profile";
const CHAT_KEY = "flux.chat";

export async function loadProfile(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  // A corrupt/truncated blob must not crash launch. On parse failure, treat it as
  // first-run (return null → onboarding) rather than letting the throw bubble up
  // and leave App.tsx stuck on its loading spinner. Mirrors loadChat below.
  try {
    const p = JSON.parse(raw) as Profile & { periodLog?: string[] };
    // Back-compat: ensure the check-in map exists.
    if (!p.dayLogs || typeof p.dayLogs !== "object") p.dayLogs = {};
    // Feature C: ensure the food/water/workout maps exist on older saved profiles.
    if (!p.foodLogs || typeof p.foodLogs !== "object") p.foodLogs = {};
    if (!p.waterLogs || typeof p.waterLogs !== "object") p.waterLogs = {};
    if (!p.workoutLogs || typeof p.workoutLogs !== "object") p.workoutLogs = {};
    if (!Array.isArray(p.savedFoods)) p.savedFoods = [];
    if (!Array.isArray(p.savedMeals)) p.savedMeals = [];
    if (!Array.isArray(p.weightLog)) p.weightLog = [];
    if (!Array.isArray(p.coachMemory)) p.coachMemory = []; // long-term Coach memory
    if (p.calorieMode !== "net") p.calorieMode = "static"; // default to the safe mode
    // Migrate the earlier Feature-B periodLog array (bleed days only) into dayLogs.
    if (Array.isArray(p.periodLog)) {
      for (const d of p.periodLog) {
        if (d && !p.dayLogs[d]) p.dayLogs[d] = { date: d, flow: "medium" };
      }
      delete p.periodLog;
    }
    return p;
  } catch {
    return null;
  }
}

export async function saveProfile(p: Profile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

// The chat persists across days now. `lastDate` lets us detect a new day so the
// Coach can drop in a fresh daily check-in without erasing the history.
//
// Conversation continuity (separate from long-term FACT memory in lib/memory.ts):
// only the last ~16 messages are sent to the model, so older turns are forgotten.
// `summary` is a parallel, bounded running summary of the conversation THREAD that
// has aged out of that verbatim window; `summarizedCount` is how many leading
// messages are already folded into it. The full `messages` array is NEVER trimmed
// here — the chat UI still renders the entire history (she scrolls up). The summary
// is used only to enrich the API context (see lib/coach.ts buildContextBlock).
export type ChatStore = {
  lastDate: string;
  messages: ChatMessage[];
  summary?: string;
  summarizedCount?: number;
};

export async function loadChat(): Promise<ChatStore> {
  const raw = await AsyncStorage.getItem(CHAT_KEY);
  if (!raw) return { lastDate: "", messages: [], summary: "", summarizedCount: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatStore>;
    return {
      lastDate: parsed.lastDate ?? "",
      messages: parsed.messages ?? [],
      // Older saved stores predate the summary — normalize the missing values.
      summary: parsed.summary ?? "",
      summarizedCount: typeof parsed.summarizedCount === "number" ? parsed.summarizedCount : 0,
    };
  } catch {
    return { lastDate: "", messages: [], summary: "", summarizedCount: 0 };
  }
}

// Persist the chat. `messages` is the source of truth for the UI; `cont` carries
// the conversation-continuity values (running summary + how many leading messages
// are folded into it) and is REQUIRED — every caller passes the current in-memory
// continuity values (summaryRef / summarizedCountRef in CoachScreen), which are the
// synchronous source of truth (updated before each save). Because we ALWAYS write
// exactly the passed values, there is NO read-modify-write here: a routine message
// save and the (separate, async) summarization save can no longer interleave such
// that one clobbers the other to a stale summary — each writes the latest refs.
export async function saveChat(
  messages: ChatMessage[],
  cont: { summary: string; summarizedCount: number }
): Promise<void> {
  // Drop base64 image data before persisting — it's large and only needed for the
  // live API call; the local imageUri is kept so the photo still renders on reload.
  const slim = messages.map(({ imageBase64, ...m }) => m);
  const payload: ChatStore = {
    lastDate: toISODate(new Date()),
    messages: slim,
    summary: cont.summary,
    summarizedCount: cont.summarizedCount,
  };
  await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(payload));
}

export async function clearChat(): Promise<void> {
  await AsyncStorage.removeItem(CHAT_KEY);
}
