// Long-term Coach memory — durable facts about the user.
//
// The Coach's chat window only spans the last ~16 messages, so anything she said
// further back is forgotten. This module is a separate, bounded store of lasting
// facts (dietary preferences/restrictions, injuries, training access, schedule,
// life events, her "why") that the Coach saves via a tool and that loads into
// EVERY context (chat, plan generation, daily kickoff). It is cheap and capped —
// it is NOT a place to widen the message window.
//
// All helpers are pure: they return a new Profile, mirroring lib/food.ts.

import { Profile, CoachMemory } from "./types";
import { newId } from "./food";
import { toISODate } from "./cycle";

// Hard cap so the always-on context block stays small. When full, the oldest
// fact (front of the array) is evicted to make room for the new one.
export const MAX_COACH_MEMORY = 40;

// Save a durable fact. Trims it; skips a case-insensitive trimmed duplicate so
// the Coach can't pile up the same fact; appends with today's ISO date; evicts
// the oldest if we'd exceed the cap.
export function addMemory(profile: Profile, text: string): Profile {
  const trimmed = text.trim();
  if (!trimmed) return profile;
  const existing = profile.coachMemory ?? [];
  const key = trimmed.toLowerCase();
  if (existing.some((m) => m.text.trim().toLowerCase() === key)) return profile;
  const item: CoachMemory = { id: newId(), text: trimmed, date: toISODate(new Date()) };
  const next = [...existing, item];
  const capped = next.length > MAX_COACH_MEMORY ? next.slice(next.length - MAX_COACH_MEMORY) : next;
  return { ...profile, coachMemory: capped };
}

// Remove the fact with the given id (no-op if not present).
export function removeMemory(profile: Profile, id: string): Profile {
  const existing = profile.coachMemory ?? [];
  return { ...profile, coachMemory: existing.filter((m) => m.id !== id) };
}

// Format the durable facts for a context block. Returns "" if there are none so
// callers can omit the whole section.
export function memoryLines(profile: Profile): string {
  const items = profile.coachMemory ?? [];
  if (!items.length) return "";
  return [
    "WHAT YOU REMEMBER ABOUT HER (long-term, always applies):",
    ...items.map((m) => `- ${m.text}`),
  ].join("\n");
}

// --- Standalone assertions ------------------------------------------------------
// No test runner is wired into this Expo project, so the memory invariants are
// encoded as an exported self-check (a no-op for the app, which never calls it).
// Returns the list of failures; empty = all pass.
// Run via: `npx tsx -e "import('./lib/memory').then(m=>console.log(m.runMemoryAssertions()))"`.
export function runMemoryAssertions(): string[] {
  const failures: string[] = [];
  const must = (cond: boolean, label: string) => {
    if (!cond) failures.push(label);
  };

  const base: Profile = {
    name: "",
    goal: "feel_better",
    tone: "bestie",
    dietaryRules: "",
    onBirthControl: false,
    lastPeriodStart: "",
    avgCycleLength: 28,
    dayLogs: {},
    foodLogs: {},
    waterLogs: {},
    workoutLogs: {},
    age: "",
    height: "",
    weight: "",
    goalWeight: "",
    activityLevel: "light",
    calorieMode: "static",
  };

  // Dedupe: same fact (case-insensitive, trimmed) is not stored twice.
  const deduped = addMemory(addMemory(base, "No dairy"), "  no dairy  ");
  must((deduped.coachMemory ?? []).length === 1, "dedupe case/trim insensitive -> 1 item");

  // Empty / whitespace-only text is skipped.
  const blank = addMemory(base, "   ");
  must((blank.coachMemory ?? []).length === 0, "blank text skipped -> 0 items");

  // Cap + eviction: adding more than MAX evicts the oldest (front).
  let capped = base;
  for (let i = 0; i < MAX_COACH_MEMORY + 5; i++) capped = addMemory(capped, `fact ${i}`);
  const cm = capped.coachMemory ?? [];
  must(cm.length === MAX_COACH_MEMORY, "cap holds at MAX");
  must(cm[0].text === "fact 5", "oldest evicted from front");
  must(cm[cm.length - 1].text === `fact ${MAX_COACH_MEMORY + 4}`, "newest kept at back");

  // Remove: dropping by id leaves the rest intact; unknown id is a no-op.
  const two = addMemory(addMemory(base, "loves squats"), "hates burpees");
  const firstId = (two.coachMemory ?? [])[0].id;
  const afterRemove = removeMemory(two, firstId);
  must((afterRemove.coachMemory ?? []).length === 1, "remove drops one item");
  must((afterRemove.coachMemory ?? [])[0].text === "hates burpees", "remove keeps the other");
  must((removeMemory(two, "no-such-id").coachMemory ?? []).length === 2, "remove unknown id -> no-op");

  return failures;
}
