import AsyncStorage from "@react-native-async-storage/async-storage";
import { Profile, ChatMessage } from "./types";
import { toISODate } from "./cycle";

const PROFILE_KEY = "flux.profile";
const CHAT_KEY = "flux.chat";

export async function loadProfile(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
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
  if (p.calorieMode !== "net") p.calorieMode = "static"; // default to the safe mode
  // Migrate the earlier Feature-B periodLog array (bleed days only) into dayLogs.
  if (Array.isArray(p.periodLog)) {
    for (const d of p.periodLog) {
      if (d && !p.dayLogs[d]) p.dayLogs[d] = { date: d, flow: "medium" };
    }
    delete p.periodLog;
  }
  return p;
}

export async function saveProfile(p: Profile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

// The chat persists across days now. `lastDate` lets us detect a new day so the
// Coach can drop in a fresh daily check-in without erasing the history.
export type ChatStore = { lastDate: string; messages: ChatMessage[] };

export async function loadChat(): Promise<ChatStore> {
  const raw = await AsyncStorage.getItem(CHAT_KEY);
  if (!raw) return { lastDate: "", messages: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatStore>;
    return { lastDate: parsed.lastDate ?? "", messages: parsed.messages ?? [] };
  } catch {
    return { lastDate: "", messages: [] };
  }
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  // Drop base64 image data before persisting — it's large and only needed for the
  // live API call; the local imageUri is kept so the photo still renders on reload.
  const slim = messages.map(({ imageBase64, ...m }) => m);
  const payload: ChatStore = { lastDate: toISODate(new Date()), messages: slim };
  await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(payload));
}

export async function clearChat(): Promise<void> {
  await AsyncStorage.removeItem(CHAT_KEY);
}
