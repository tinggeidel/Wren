import { Profile, BodyCompEntry } from "./types";
import { daysBetween, toISODate } from "./cycle";

// --- US Navy Method body-fat estimate (women) ---------------------------------
//
// Computes an approximate body-fat percentage from three tape-measure inputs
// plus height. The formula is the standard US Navy circumference method for
// women — it uses waist, neck AND hip (the men's formula skips hip; Wren is a
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

// --- Feature F2: body-composition scan log helpers ----------------------------
//
// All helpers operate on profile.bodyCompLog (BodyCompEntry[]) — DEXA/InBody/
// other real scan results she entered by hand. This log is INTENTIONALLY
// SEPARATE from the Navy tape-measure infrastructure above: the tape method
// produces a measurement-derived proxy used once at onboarding (the calibration
// anchor), while these are real machine numbers she logs over time. They never
// feed each other; the Coach reads both as independent signals.

// Sort oldest -> newest, deterministic. Returns a fresh array, never mutates.
export function bodyCompSorted(p: Profile): BodyCompEntry[] {
  return [...(p.bodyCompLog ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function latestBodyComp(p: Profile): BodyCompEntry | null {
  const arr = bodyCompSorted(p);
  return arr.length ? arr[arr.length - 1] : null;
}

export function previousBodyComp(p: Profile): BodyCompEntry | null {
  const arr = bodyCompSorted(p);
  return arr.length >= 2 ? arr[arr.length - 2] : null;
}

// Result of evaluating the BF%-trend trigger condition. Used by the Coach
// context builder to decide whether to inject the conversational suggestion
// rule and by surfaces that want to know whether the trigger is armed.
//
// armed = ALL of:
//   (1) >= 2 entries with bodyFatPct
//   (2) the two most recent are >= 8 weeks (56 days) apart
//   (3) the trend conflicts with the user's stated goal:
//       - lose_fat: BF% is up (latest > previous)
//       - build_muscle: muscle/lean mass is down, OR BF% is up substantially
//         (>= 1.5%) without a lean gain
//       - other goals: never armed (no clear directional metric)
//   (4) the last-surfaced marker is >= 14 days old (or missing)
//
// Notes for callers:
// - This is PURE: no side effects, no model calls. Two callers can read it and
//   stay in agreement (the context builder + any UI that wants to surface a
//   debug indicator in the future).
// - The 1.5% threshold for build_muscle "BF% up substantially without lean
//   gain" is conservative — the spec says "BF% up substantially with no lean
//   gain." Without an objective study to anchor on, 1.5% is the smallest delta
//   that exceeds typical scan noise (~1% for InBody/DEXA repeat reads). Tweak
//   if Ting wants a different sensitivity; bumping it down would over-trigger.
export type BodyCompTrendStatus = {
  armed: boolean;
  reason: string; // short human-readable why; "" when not armed
  latest?: BodyCompEntry;
  previous?: BodyCompEntry;
  weeksBetween?: number;
  bfDelta?: number; // latest - previous (positive = up)
  // Lean-mass delta if both readings have it; muscle-mass if both have that
  // instead. Either may be null when not enough data.
  leanDelta?: number;
  muscleDelta?: number;
};

const TREND_MIN_DAYS_APART = 56; // 8 weeks
const TREND_REPEAT_GATE_DAYS = 14; // don't re-surface the same trend within
const TREND_BUILD_BF_THRESHOLD = 1.5; // % — see comment above

export function bodyCompTrendStatus(
  profile: Profile,
  todayISO: string = toISODate(new Date())
): BodyCompTrendStatus {
  // BF% is the headline metric the trend rule speaks to. Filter to entries
  // with bodyFatPct FIRST so note-only or lean-only entries (which legacy data
  // may contain even after the Save-time gate refuses new ones) don't suppress
  // a real BF% trend by occupying one of the two "most recent" slots.
  const arr = bodyCompSorted(profile).filter((e) => typeof e.bodyFatPct === "number");
  if (arr.length < 2) {
    return { armed: false, reason: "fewer than 2 entries with bodyFatPct" };
  }
  const latest = arr[arr.length - 1];
  const previous = arr[arr.length - 2];
  // Both are guaranteed to have bodyFatPct from the filter above. Pull them
  // into locals with a defensive re-check so the type narrows under strict TS
  // (the filter predicate doesn't propagate through to property access).
  const latestBf = latest.bodyFatPct;
  const previousBf = previous.bodyFatPct;
  if (typeof latestBf !== "number" || typeof previousBf !== "number") {
    return { armed: false, reason: "bodyFatPct unexpectedly missing after filter", latest, previous };
  }
  const days = daysBetween(previous.date, latest.date);
  if (days < TREND_MIN_DAYS_APART) {
    return { armed: false, reason: `latest entries are only ${days} days apart`, latest, previous };
  }
  const weeksBetween = Math.round(days / 7);
  const bfDelta = latestBf - previousBf;
  // Lean / muscle deltas — only when BOTH entries supply the same metric.
  // Otherwise undefined (the build_muscle branch handles that).
  const leanDelta =
    typeof latest.leanMassLbs === "number" && typeof previous.leanMassLbs === "number"
      ? latest.leanMassLbs - previous.leanMassLbs
      : undefined;
  const muscleDelta =
    typeof latest.muscleMassLbs === "number" && typeof previous.muscleMassLbs === "number"
      ? latest.muscleMassLbs - previous.muscleMassLbs
      : undefined;

  let goalConflict = false;
  let goalReason = "";
  if (profile.goal === "lose_fat") {
    // Fat loss: any positive BF% delta is the conflict the spec calls out.
    if (bfDelta > 0) {
      goalConflict = true;
      goalReason = `BF% trending up (${formatSignedPercent(bfDelta)}) while she's on a fat-loss plan`;
    }
  } else if (profile.goal === "build_muscle") {
    // Build muscle: lean/muscle going DOWN, OR BF% up >=1.5% without a lean
    // gain. "Without a lean gain" = lean/muscle delta is missing OR <= 0.
    const lostMass = (leanDelta != null && leanDelta < 0) || (muscleDelta != null && muscleDelta < 0);
    const noLeanGain = (leanDelta == null || leanDelta <= 0) && (muscleDelta == null || muscleDelta <= 0);
    if (lostMass) {
      goalConflict = true;
      goalReason =
        leanDelta != null && leanDelta < 0
          ? `lean mass down ${formatSignedLbs(leanDelta)} while she's on a build-muscle plan`
          : `muscle mass down ${formatSignedLbs(muscleDelta!)} while she's on a build-muscle plan`;
    } else if (bfDelta >= TREND_BUILD_BF_THRESHOLD && noLeanGain) {
      goalConflict = true;
      goalReason = `BF% up ${formatSignedPercent(bfDelta)} with no lean/muscle gain while she's on a build-muscle plan`;
    }
  }
  // tone_up / feel_better / maintain: spec says "no trigger (these goals don't
  // have a clear directional metric)."
  if (!goalConflict) {
    return { armed: false, reason: "no goal-conflict", latest, previous, weeksBetween, bfDelta, leanDelta, muscleDelta };
  }
  // Re-pester gate: don't re-fire within 14 days of the last time the Coach
  // raised this trend. If the marker is missing/unparseable we treat it as
  // never-surfaced (armed). The marker advances ONLY when the Coach calls the
  // mark_bf_trend_surfaced tool — set_targets does NOT advance it, so a stale
  // marker can't accidentally suppress a genuinely new trend after she changed
  // her plan and a new scan diverged again.
  if (profile.lastBfTrendSurfacedAt) {
    const markerDate = profile.lastBfTrendSurfacedAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(markerDate)) {
      const sinceSurfaced = daysBetween(markerDate, todayISO);
      if (sinceSurfaced < TREND_REPEAT_GATE_DAYS) {
        return {
          armed: false,
          reason: `surfaced ${sinceSurfaced} day(s) ago — within ${TREND_REPEAT_GATE_DAYS}d gate`,
          latest,
          previous,
          weeksBetween,
          bfDelta,
          leanDelta,
          muscleDelta,
        };
      }
    }
  }
  return {
    armed: true,
    reason: goalReason,
    latest,
    previous,
    weeksBetween,
    bfDelta,
    leanDelta,
    muscleDelta,
  };
}

function formatSignedPercent(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(Math.round(n * 10) / 10)}%`;
}

function formatSignedLbs(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(Math.round(n * 10) / 10)} lb`;
}

// Render the body-comp log for the Coach context block. Returns "" when the
// log is empty so callers can omit the section. Latest entry + (if >= 2)
// previous + delta. No URIs, no images, just factual numbers — the Coach
// surfaces them but never editorializes.
export function bodyCompContextLines(profile: Profile): string {
  const arr = bodyCompSorted(profile);
  if (arr.length === 0) return "";
  const latest = arr[arr.length - 1];
  const lines: string[] = ["Body composition (real scan log — facts only, never editorialize):"];
  lines.push(`- Latest: ${latest.date} ${sourceLabel(latest.source)}${formatEntry(latest)}.`);
  if (arr.length >= 2) {
    const prev = arr[arr.length - 2];
    const days = daysBetween(prev.date, latest.date);
    const weeks = Math.round(days / 7);
    lines.push(`- Previous: ${prev.date} ${sourceLabel(prev.source)}${formatEntry(prev)}.`);
    const deltas: string[] = [];
    if (typeof latest.bodyFatPct === "number" && typeof prev.bodyFatPct === "number") {
      deltas.push(`BF% ${formatSignedPercent(latest.bodyFatPct - prev.bodyFatPct)}`);
    }
    if (typeof latest.leanMassLbs === "number" && typeof prev.leanMassLbs === "number") {
      deltas.push(`lean ${formatSignedLbs(latest.leanMassLbs - prev.leanMassLbs)}`);
    }
    if (typeof latest.muscleMassLbs === "number" && typeof prev.muscleMassLbs === "number") {
      deltas.push(`muscle ${formatSignedLbs(latest.muscleMassLbs - prev.muscleMassLbs)}`);
    }
    if (deltas.length) {
      lines.push(`- Delta vs previous (${weeks} weeks apart): ${deltas.join(", ")}.`);
    } else {
      lines.push(`- Delta vs previous (${weeks} weeks apart): not enough overlapping fields to compare.`);
    }
  }
  return lines.join("\n");
}

function sourceLabel(s: BodyCompEntry["source"]): string {
  if (s === "dexa") return "DEXA";
  if (s === "inbody") return "InBody";
  return "Other";
}

function formatEntry(e: BodyCompEntry): string {
  const parts: string[] = [];
  if (typeof e.bodyFatPct === "number") parts.push(`BF ${Math.round(e.bodyFatPct * 10) / 10}%`);
  if (typeof e.leanMassLbs === "number") parts.push(`lean ${Math.round(e.leanMassLbs * 10) / 10} lb`);
  if (typeof e.muscleMassLbs === "number") parts.push(`muscle ${Math.round(e.muscleMassLbs * 10) / 10} lb`);
  if (e.note?.trim()) parts.push(`note "${e.note.trim()}"`);
  return parts.length ? ` — ${parts.join(", ")}` : "";
}
