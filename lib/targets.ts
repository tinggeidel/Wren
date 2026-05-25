import { Profile, ActivityLevel } from "./types";

export type Targets = { calories: number; protein: number; carbs: number; fat: number };

// --- Tolerant unit parsing (deterministic: same input always -> same output) ---

// iOS auto-converts ' and " to curly quotes; normalize them back so 5'6" parses.
function normalizeUnits(s: string): string {
  return s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .toLowerCase();
}

export function parseWeightKg(s: string): number | null {
  const t = normalizeUnits(s);
  const m = t.match(/([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n) || n <= 0) return null;
  if (t.includes("kg")) return n;
  if (t.includes("lb") || t.includes("pound")) return n * 0.453592;
  // No unit given: guess by magnitude (women's weight > ~90 is almost surely lb).
  return n > 90 ? n * 0.453592 : n;
}

function parseHeightCm(s: string): number | null {
  const t = normalizeUnits(s).trim();
  if (t.includes("cm")) {
    const m = t.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }
  // feet/inches: 5'6", 5'6, 5 ft 6, 5'
  const fi = t.match(/(\d+)\s*(?:'|ft|feet)\s*(\d+)?/);
  if (fi) {
    const ft = parseInt(fi[1], 10);
    const inch = fi[2] ? parseInt(fi[2], 10) : 0;
    return (ft * 12 + inch) * 2.54;
  }
  const m = t.match(/([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  if (n > 90) return n; // plain number in cm range
  return null; // ambiguous (e.g. bare "5") — ask instead of guessing
}

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  active: 1.55,
  very_active: 1.725,
};

// Deterministic daily targets from the profile. Returns null if we don't have
// enough to compute (the Coach then asks for age/height/weight). Mifflin-St Jeor
// BMR -> TDEE -> goal adjustment, with a hard BMR floor for safety.
export function computeTargets(p: Profile): Targets | null {
  const age = parseInt((p.age || "").match(/\d+/)?.[0] ?? "", 10);
  const kg = parseWeightKg(p.weight || "");
  const cm = parseHeightCm(p.height || "");
  if (!age || !kg || !cm) return null;

  const bmr = 10 * kg + 6.25 * cm - 5 * age - 161; // female
  const factor = ACTIVITY_FACTOR[p.activityLevel ?? "light"] ?? 1.375;
  const tdee = bmr * factor;

  let calories: number;
  switch (p.goal) {
    case "lose_fat":
      calories = tdee * 0.8;
      break;
    case "tone_up":
      calories = tdee * 0.9;
      break;
    case "build_muscle":
      calories = tdee * 1.1;
      break;
    default:
      calories = tdee; // feel_better, maintain
  }
  calories = Math.max(calories, bmr); // safety floor: never below BMR

  const proteinPerKg = p.goal === "build_muscle" || p.goal === "tone_up" ? 2.0 : 1.8;
  const protein = proteinPerKg * kg;
  const fat = (calories * 0.27) / 9;
  const carbs = (calories - protein * 4 - fat * 9) / 4;

  return {
    calories: Math.round(calories / 10) * 10,
    protein: Math.round(protein / 5) * 5,
    carbs: Math.max(0, Math.round(carbs / 5) * 5),
    fat: Math.round(fat / 5) * 5,
  };
}
