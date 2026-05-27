import { Profile } from "./types";

// --- US Navy Method body-fat estimate (women) ---------------------------------
//
// Computes an approximate body-fat percentage from three tape-measure inputs
// plus height. The formula is the standard US Navy circumference method for
// women — it uses waist, neck AND hip (the men's formula skips hip; Flux is a
// women's app per project memory so we only implement the women's branch).
//
//   BF% = 163.205 × log10(waist + hip − neck) − 97.684 × log10(height_in) − 78.387
//
// All inputs in INCHES. Returns a rounded integer percentage, or null when any
// required input is missing/invalid — onboarding's measurements step is fully
// optional, and a missing input must NOT silently default into a fake reading.
//
// Why this lives alongside CALIBRATION (not in lib/targets.ts):
// - Macros / calorie targets are unchanged. lib/targets.ts still owns BMR +
//   the 1200 kcal floor; this number is for the photo-calibration vision call
//   to ANCHOR its body_fat_range on, not for macro math.
// - This is a one-time onboarding signal. Keeping it in its own file avoids
//   churn in lib/targets.ts (which is part of the audit-tracked safety floor).
//
// Accuracy: the Navy method is roughly ±3% versus DEXA in published studies —
// considerably better than visual estimation from photos. The number lands in
// the calibration context block as the AUTHORITATIVE anchor (see lib/coach.ts
// CALIBRATION_SYSTEM).

// Local mirror of lib/targets.ts's height parser. That helper isn't exported,
// and lib/targets.ts is part of the safety-floor surface we're told to leave
// untouched — duplicating the small parser here keeps a clean dependency line
// (this file doesn't reach into targets.ts internals). If targets.ts's parser
// ever changes its parsing rules, this one must be kept in sync OR we should
// promote the parser to a shared helper.
function parseHeightInches(s: string): number | null {
  const t = s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .toLowerCase()
    .trim();
  if (t.includes("cm")) {
    const m = t.match(/([\d.]+)/);
    if (!m) return null;
    const cm = parseFloat(m[1]);
    if (isNaN(cm) || cm <= 0) return null;
    return cm / 2.54;
  }
  // feet'inches" — e.g. 5'6", 5'6, 5 ft 6, 5' (= 5'0)
  const fi = t.match(/(\d+)\s*(?:'|ft|feet)\s*(\d+)?/);
  if (fi) {
    const ft = parseInt(fi[1], 10);
    const inch = fi[2] ? parseInt(fi[2], 10) : 0;
    return ft * 12 + inch;
  }
  const m = t.match(/([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  if (n > 90) return n / 2.54; // plain number is a cm reading
  return null; // ambiguous bare number (e.g. "5") — refuse rather than guess
}

export function navyBodyFatPercent(p: Profile): number | null {
  const waist = p.waistIn;
  const neck = p.neckIn;
  const hip = p.hipIn;
  // All three measurements + a parseable height are REQUIRED. The women's
  // formula needs hip; without it the read is meaningless.
  if (typeof waist !== "number" || typeof neck !== "number" || typeof hip !== "number") {
    return null;
  }
  if (waist <= 0 || neck <= 0 || hip <= 0) return null;
  const heightIn = parseHeightInches(p.height || "");
  if (heightIn == null || heightIn <= 0) return null;
  // The log10 argument must be positive — physically that means waist + hip
  // must exceed neck. A real woman's measurements always satisfy this; the
  // guard is just to prevent NaN from a garbage / transposed entry.
  const inner = waist + hip - neck;
  if (inner <= 0) return null;
  const bf =
    163.205 * Math.log10(inner) - 97.684 * Math.log10(heightIn) - 78.387;
  if (!isFinite(bf)) return null;
  // Clamp to a sane reportable range. The formula can produce nonsense outside
  // typical anthropometric inputs; below 5% or above 60% the number is more
  // likely a measurement error than a real reading, and propagating it into
  // the calibration anchor would be misleading.
  if (bf < 5 || bf > 60) return null;
  return Math.round(bf);
}

// Inline sanity checks, matching the pattern in lib/coach.ts
// runContinuityAssertions / lib/memory.ts runMemoryAssertions. Returns the list
// of failures; empty = all pass. Not wired into the app (no test runner) — just
// here so the formula can be spot-checked manually.
//
// Worked reference (used in the implementation report):
//   5'6" (66 in), waist 28, neck 13, hip 38 -> inner = 28 + 38 - 13 = 53
//   163.205 * log10(53) - 97.684 * log10(66) - 78.387
//   = 163.205 * 1.7243 - 97.684 * 1.8195 - 78.387
//   ≈ 281.39 - 177.74 - 78.39 ≈ 25.3 -> rounds to 25
// (the task spec mentions "~22%" as a rough target; the formula's actual output
// for those numbers is ~25, which still lands solidly in a healthy range. The
// rounding contract is "nearest integer".)
export function runBodyCompAssertions(): string[] {
  const failures: string[] = [];
  const must = (cond: boolean, label: string) => {
    if (!cond) failures.push(label);
  };
  const mk = (
    waistIn: number | undefined,
    neckIn: number | undefined,
    hipIn: number | undefined,
    height: string
  ): Profile =>
    ({
      waistIn,
      neckIn,
      hipIn,
      height,
    }) as unknown as Profile;

  // Missing any measurement -> null.
  must(navyBodyFatPercent(mk(undefined, 13, 38, "5'6\"")) === null, "missing waist -> null");
  must(navyBodyFatPercent(mk(28, undefined, 38, "5'6\"")) === null, "missing neck -> null");
  must(navyBodyFatPercent(mk(28, 13, undefined, "5'6\"")) === null, "missing hip -> null");
  // Missing/unparseable height -> null.
  must(navyBodyFatPercent(mk(28, 13, 38, "")) === null, "missing height -> null");
  must(navyBodyFatPercent(mk(28, 13, 38, "5")) === null, "bare-number height -> null");
  // Valid lean input lands in a low-but-sane range (athletic woman, 5'6").
  const lean = navyBodyFatPercent(mk(26, 12.5, 35, "5'6\""));
  must(lean !== null && lean >= 12 && lean <= 22, "lean input lands ~12-22%");
  // The worked example from the function comment.
  const ex = navyBodyFatPercent(mk(28, 13, 38, "5'6\""));
  must(ex !== null && ex >= 22 && ex <= 28, "5'6 28/13/38 -> roughly mid-20s");
  // cm height parses correctly.
  const cm = navyBodyFatPercent(mk(28, 13, 38, "168 cm"));
  must(cm !== null && cm >= 22 && cm <= 28, "cm height parses");
  // Garbage inputs (transposed neck > waist+hip) -> null.
  must(navyBodyFatPercent(mk(20, 99, 20, "5'6\"")) === null, "neck > waist+hip -> null");
  // Zero/negative -> null.
  must(navyBodyFatPercent(mk(0, 13, 38, "5'6\"")) === null, "zero waist -> null");
  return failures;
}
