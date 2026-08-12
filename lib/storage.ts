import AsyncStorage from "@react-native-async-storage/async-storage";
import { Profile, ChatMessage } from "./types";
import { toISODate } from "./cycle";
import { densifyWeek } from "./plan";

const PROFILE_KEY = "flux.profile";
const CHAT_KEY = "flux.chat";

export async function loadProfile(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  // A corrupt/truncated blob must not crash launch. On parse failure, treat it as
  // first-run (return null → onboarding) rather than letting the throw bubble up
  // and leave App.tsx stuck on its loading spinner. Mirrors loadChat below.
  try {
    const p = JSON.parse(raw) as Profile & {
      periodLog?: string[];
      // Legacy field from the pre-front/side photo era. Migrated below into
      // currentFrontPhotoUri so an old profile keeps its photo visible after the
      // upgrade. The new types deliberately drop this field so future code can't
      // reach for it accidentally — the cast above is the one read path.
      currentPhotoUri?: string;
    };
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
    // Back-compat: cycle tracking defaults to ON for any profile saved before this
    // field existed. Use `=== false` semantics everywhere — only an explicit
    // false (set when she taps "Turn off cycle tracking") counts as off, so a
    // missing value can never silently disable tracking for an existing user.
    if (p.cycleTrackingEnabled !== false) p.cycleTrackingEnabled = true;
    // Migrate the earlier Feature-B periodLog array (bleed days only) into dayLogs.
    if (Array.isArray(p.periodLog)) {
      for (const d of p.periodLog) {
        if (d && !p.dayLogs[d]) p.dayLogs[d] = { date: d, flow: "medium" };
      }
      delete p.periodLog;
    }
    // Back-compat: the legacy `currentPhotoUri` field has been split into
    // `currentFrontPhotoUri` (the calibration anchor) and `currentSidePhotoUri`
    // (the new side-angle slot, empty for legacy profiles). Copy the old URI
    // into the front slot so an existing user's onboarding photo doesn't
    // disappear after this upgrade. Side stays undefined — she'll see an empty
    // slot in Settings she can fill in if she wants.
    if (p.currentPhotoUri && !p.currentFrontPhotoUri) {
      p.currentFrontPhotoUri = p.currentPhotoUri;
    }
    delete p.currentPhotoUri;
    // Feature F1 back-compat: seed photoLog from the onboarding calibration photos
    // so a returning user's first timeline entry isn't blank. Only run when
    // photoLog is missing entirely — an explicit [] means she's already on the new
    // model (possibly having cleared it), so we leave it alone. We deliberately
    // keep currentFront/SidePhotoUri intact: they remain the calibration anchors
    // and are read elsewhere (Settings, future re-calibration).
    if (!Array.isArray(p.photoLog)) {
      if (p.currentFrontPhotoUri || p.currentSidePhotoUri) {
        p.photoLog = [
          {
            id: `seed-${Date.now()}`,
            date: toISODate(new Date()),
            frontUri: p.currentFrontPhotoUri,
            sideUri: p.currentSidePhotoUri,
          },
        ];
      } else {
        p.photoLog = [];
      }
    }
    // Pass 2a back-compat: existing stored plans were generated before the week
    // was guaranteed dense, so `plan.current.days` is often a PARTIAL array (only
    // the weekdays the model emitted). Densify the current week and every history
    // week so all 7 weekday slots exist — this makes Coach moves/edits land on a
    // renderable Plan-tab slot and keeps the move/adjust handlers always able to
    // resolve a weekday. densifyWeek PRESERVES every existing day object (exercises,
    // done flags, loggedEntryId, titles) and only ADDS missing rest days, so this
    // is idempotent (a no-op on an already-dense plan) and never reshapes real data.
    if (p.plan) {
      if (p.plan.current) p.plan.current = densifyWeek(p.plan.current);
      if (Array.isArray(p.plan.history)) {
        p.plan.history = p.plan.history.map((w) => densifyWeek(w));
      }
    }
    // Workout source back-compat: entries stored before the source union gained
    // "plan" used "coach" for BOTH plan check-offs AND Coach chat logs, so the
    // Log card mislabeled every chat log as "From your plan". Best-effort
    // reconcile on load: any workout entry whose id is referenced by a plan
    // day's `loggedEntryId` (in the current week or any history week) was a plan
    // check-off → rewrite "coach" → "plan". Anything else stays "coach" and now
    // reads "From Coach". A chat-logged entry can never be a plan day's
    // loggedEntryId, so it's never misclassified as plan. The only imperfect
    // case: an ancient plan check-off whose week has rotated out of both current
    // and history is no longer referenced, so it stays "coach" and reads
    // "From Coach" — acceptable for pre-existing data. New entries are tagged
    // correctly at creation and skip this path entirely.
    if (p.plan) {
      const planEntryIds = new Set<string>();
      const collect = (w?: { days?: { loggedEntryId?: string }[] } | null) => {
        for (const d of w?.days ?? []) {
          if (d.loggedEntryId) planEntryIds.add(d.loggedEntryId);
        }
      };
      collect(p.plan.current);
      if (Array.isArray(p.plan.history)) p.plan.history.forEach(collect);
      if (planEntryIds.size) {
        for (const date of Object.keys(p.workoutLogs)) {
          const entries = p.workoutLogs[date];
          if (!Array.isArray(entries)) continue;
          for (const e of entries) {
            if (e.source === "coach" && planEntryIds.has(e.id)) e.source = "plan";
          }
        }
      }
    }
    return p;
  } catch {
    return null;
  }
}

export async function saveProfile(p: Profile): Promise<void> {
  // A failed disk write must not reject: many callers fire updateProfile/persist
  // without awaiting (e.g. tapping +water, checking off an exercise), so an
  // AsyncStorage rejection here would surface as an unhandled promise rejection
  // and could crash. We swallow it so the in-memory profile (already updated
  // synchronously in App.updateProfile before this await) stays usable for the
  // session; only the persist-to-disk failed. console.warn is the minimum signal.
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch (e) {
    console.warn("Wren: failed to save profile to storage", e);
  }
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
  // Same rationale as saveProfile: don't reject on a failed write. saveChat is
  // awaited inside CoachScreen try/catch blocks, but some of those wrap user-
  // facing flows (kickoff, summarize) that would otherwise have no signal — a
  // warn keeps the live chat working while flagging that persistence failed.
  try {
    await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Wren: failed to save chat to storage", e);
  }
}

export async function clearChat(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAT_KEY);
  } catch (e) {
    console.warn("Wren: failed to clear chat from storage", e);
  }
}

// "Start over": wipe everything Wren persists — the profile (which carries all the
// data maps: dayLogs/foodLogs/workoutLogs/savedFoods/savedMeals/weightLog/plan/
// coachMemory) AND the chat. Used only by the destructive Settings reset so
// first-run onboarding can be re-tested. Reuses the same key constants as the
// individual write/clear helpers so there's a single source of truth for keys.
// Same warn-don't-throw contract as the other write helpers: a failed remove
// must not reject and crash the caller; the in-memory reset in App.resetApp
// still proceeds so the UI returns to onboarding regardless.
export async function clearAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([PROFILE_KEY, CHAT_KEY]);
  } catch (e) {
    console.warn("Wren: failed to clear all data from storage", e);
  }
}
