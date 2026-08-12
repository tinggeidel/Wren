import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, type, phaseColors } from "../lib/theme";

// --- PhaseRing -------------------------------------------------------------
// Radial cycle ring for the new Cycle screen design (Image 8). A SEAMLESS
// watercolor gradient band laid out clockwise from 12 o'clock, a cocoa dot
// positioned at the user's current cycle-day, and a centered stat stack.
//
// Pure / presentational: all inputs are props. No profile, no AsyncStorage,
// no business logic. The phase segment proportions are derived from
// `lib/cycle.ts`'s phaseName ranges (5 / 8 / 3 / 12 of 28), so if those
// boundaries change the ring stays in sync with the rest of the app.
//
// Step 2 of the redesign: this component is rendered as a PREVIEW above the
// existing CycleScreen layout. Step 3 will plug it into the final layout.

export type PhaseKey = "menstrual" | "follicular" | "ovulatory" | "luteal";

type PhaseRingProps = {
  cycleDay: number; // 1-based current cycle day
  cycleLength: number; // total cycle length in days (typically 28)
  currentPhase: PhaseKey;
  phaseLabel: string; // display string for the phase (e.g. "Luteal")
  prediction?: string | null; // e.g. "Period in ~5 days"
  size?: number; // diameter in dp; defaults to 348 (gutter-safe hero size)
};

// Default phase day-counts come from lib/cycle.ts (phaseName): in a 28-day
// cycle, menstrual is days 1–5 (5), follicular 6–13 (8), ovulatory 14–16 (3),
// luteal 17–28 (12). We re-derive these as fractions so the ring proportions
// match the rest of the app. cycleLength scales them uniformly via cycle.ts's
// own `scale = len / 28` formula, so we don't need to recompute per-length —
// the proportions are constant regardless of cycleLength.
const PHASE_DAYS_28: Record<PhaseKey, number> = {
  menstrual: 5,
  follicular: 8,
  ovulatory: 3,
  luteal: 12,
};

// Compute the 4 segment proportions, summing to exactly 1. We compute the
// last (luteal) as 1 - (sum of the first three) to absorb any float drift.
function phaseProportions(): Record<PhaseKey, number> {
  const total = 28;
  const menstrual = PHASE_DAYS_28.menstrual / total;
  const follicular = PHASE_DAYS_28.follicular / total;
  const ovulatory = PHASE_DAYS_28.ovulatory / total;
  const luteal = 1 - (menstrual + follicular + ovulatory);
  return { menstrual, follicular, ovulatory, luteal };
}

// Pure RGB lerp between two #rrggbb hex colors at t∈[0,1]. String/number math
// only — no profile, no state. Used to interpolate the ring band's color
// CONTINUOUSLY between adjacent phase anchors so the boundaries melt instead of
// banding. Returns a #rrggbb string.
function lerpHex(a: string, b: string, t: number): string {
  const ah = a.replace("#", "");
  const bh = b.replace("#", "");
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const hx = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(bl)}`;
}

// Build an SVG arc path from one angle to another, going clockwise. Angles
// are in radians, measured CLOCKWISE from 12 o'clock (top). We convert to
// SVG's coordinate system, where x grows right and y grows down, and arcs
// are described by start point + end point + a sweep flag.
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  // Convert clockwise-from-top angle to (x, y) on the circle.
  const point = (angle: number) => ({
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  });
  const start = point(startAngle);
  const end = point(endAngle);
  const sweep = endAngle - startAngle;
  // largeArcFlag = 1 if the arc spans more than 180°.
  const largeArc = sweep > Math.PI ? 1 : 0;
  // sweepFlag = 1 means draw clockwise (in SVG's y-down system, our
  // conversion above lines this up — clockwise visually).
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

const PHASE_ORDER: PhaseKey[] = ["menstrual", "follicular", "ovulatory", "luteal"];

export default function PhaseRing({
  cycleDay,
  cycleLength,
  currentPhase: _currentPhase, // reserved for future highlight treatment
  phaseLabel,
  prediction,
  size = 348,
}: PhaseRingProps) {
  // Thick painted-ribbon donut (mockup): stroke ~10.5% of diameter so the
  // segments read as a wide painterly band rather than a thin line.
  const strokeWidth = Math.round(size * 0.105);
  // Inset the radius so the stroke doesn't clip the SVG bounds.
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Inner cream-fill radius — sits just inside the ring stroke so the
  // colored arcs frame a solid cream disc. Subtracting strokeWidth / 2 lands
  // the fill exactly at the inner edge of the stroke (radius is the stroke
  // CENTERLINE), and an extra 0.5dp avoids a hairline seam from antialiasing
  // between the arc and the fill.
  const innerFillRadius = radius - strokeWidth / 2 - 0.5;

  const proportions = phaseProportions();

  // --- Seamless watercolor band -------------------------------------------
  // Instead of four hard arcs (which banded at the seams and bulged into blobs
  // under round caps), we render the ring as MANY thin solid-color segments
  // around the full circle. Each segment's color is RGB-interpolated between
  // the phase anchors based on its angular position, so consecutive segments
  // differ by a tiny step → a continuous conic-style gradient with no seams,
  // no blobs, no gaps.
  //
  // Anchors: each phase's color is pinned at the MIDPOINT of its arc (arcs
  // sized by phaseProportions(): 5/8/3/12 of 28). We then interpolate
  // CIRCULARLY between consecutive anchors around the ring, wrapping the last
  // (luteal) back to the first (menstrual) so the loop closes with no hard jump
  // at 12 o'clock. Each phase color still dominates around its own region (the
  // legend stays valid); only the boundaries melt.
  const TWO_PI = Math.PI * 2;

  // Anchor angle (clockwise-from-top, radians) at the midpoint of each phase's
  // arc, in render order. cum tracks the running start of each arc.
  const anchors: { angle: number; color: string }[] = [];
  {
    let cum = 0;
    for (const phase of PHASE_ORDER) {
      const sweep = proportions[phase] * TWO_PI;
      anchors.push({ angle: cum + sweep / 2, color: phaseColors[phase].bg });
      cum += sweep;
    }
  }

  // For a given angle on the ring, find the two anchors it falls between
  // (circularly) and lerp their colors by the fractional position. Angles wrap
  // through luteal→menstrual: the gap from the last anchor up to the first
  // (plus a full turn) carries the closing blend.
  function colorAtAngle(a: number): string {
    const n = anchors.length;
    // Normalize a into [0, TWO_PI).
    const aa = ((a % TWO_PI) + TWO_PI) % TWO_PI;
    for (let i = 0; i < n; i++) {
      const cur = anchors[i];
      const nxt = anchors[(i + 1) % n];
      // Angular span from cur to nxt, going clockwise (wrapping if needed).
      let span = nxt.angle - cur.angle;
      if (span <= 0) span += TWO_PI;
      // Offset of aa from cur, going clockwise.
      let off = aa - cur.angle;
      if (off < 0) off += TWO_PI;
      if (off <= span) {
        return lerpHex(cur.color, nxt.color, span === 0 ? 0 : off / span);
      }
    }
    return anchors[0].color;
  }

  // Build the segment list. ~120 segments around the full circle is plenty for
  // a smooth static gradient and renders once. Each segment's arc end overlaps
  // its neighbor's start by a hair (OVERLAP) so antialiasing leaves no gap
  // between butt-capped strokes. Color is sampled at the segment MIDPOINT angle.
  const SEGMENTS = 120;
  const step = TWO_PI / SEGMENTS;
  const OVERLAP = step * 0.6; // ~0.6 of a step extra on the end angle
  const segments: { d: string; color: string }[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * step;
    const end = start + step + OVERLAP;
    const mid = start + step / 2;
    segments.push({
      d: arcPath(cx, cy, radius, start, end),
      color: colorAtAngle(mid),
    });
  }

  // Position of the cocoa dot. We clamp cycleDay to [1, cycleLength] so an
  // out-of-range day (e.g. a day-of-cycle past the projected length) lands
  // safely on the ring rather than overflowing.
  const safeLength = Math.max(1, cycleLength);
  const safeDay = Math.max(1, Math.min(cycleDay, safeLength));
  const dotAngle = ((safeDay - 1) / safeLength) * Math.PI * 2;
  const dotX = cx + radius * Math.sin(dotAngle);
  const dotY = cy - radius * Math.cos(dotAngle);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Render order matters: ring segments first, THEN the cream inner disc
            (it covers any antialiased bleed-through inside the stroke band),
            THEN the position dot (which has a cream stroke and needs to sit
            on top of both the ring and the inner fill).

            The band is ~120 thin solid-color arcs whose colors are RGB-lerped
            between phase anchors around the circle — a true seamless conic-style
            gradient. Caps are BUTT (no round caps → no semicircular bulbs/blobs
            at the seams), and each arc overlaps its neighbor by a hair so
            antialiasing leaves no gaps. A uniform 0.5 opacity keeps the whole
            ring a gentle translucent pastel (Ting: softer everywhere). */}
        {segments.map((s, i) => (
          <Path
            key={i}
            d={s.d}
            stroke={s.color}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            opacity={0.5}
            fill="none"
          />
        ))}
        <Circle cx={cx} cy={cy} r={innerFillRadius} fill={colors.surface} />
        <Circle
          cx={dotX}
          cy={dotY}
          r={9}
          fill={colors.focus}
          stroke={colors.surface}
          strokeWidth={4}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={styles.eyebrow}>CYCLE DAY</Text>
        <Text style={styles.bigNumber}>{safeDay}</Text>
        <Text style={styles.ofLine}>of {safeLength}</Text>
        <Text style={styles.phaseLabel}>{phaseLabel}</Text>
        {prediction ? <Text style={styles.prediction}>{prediction}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
    position: "relative",
  },
  // Absolute center overlay — sits on top of the SVG. Rather than pure-center
  // both axes, we bias the whole stack DOWNWARD (Ting: "lower cycle day and
  // everything below it. more space at top, less space at bottom under period
  // in 4 days"). justifyContent stays "center" but an asymmetric vertical pad —
  // a larger paddingTop and zero paddingBottom — pushes the centered group's
  // resting position down: more empty space opens above the CYCLE DAY eyebrow,
  // and the "Period in ~N days" line settles closer to the bottom of the donut
  // hole. The 28dp top pad is well within the ring's inner diameter (~274 at
  // size 348, inner radius ~137), so the stack stays inside the cream disc and
  // nothing clips. This shifts the stack's OVERALL position only; the tuned
  // inter-line gaps and font sizes below are untouched.
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 28,
    paddingBottom: 0,
    paddingHorizontal: 24,
  },
  eyebrow: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.eyebrow,
    color: colors.clay,
    // Tucked close down toward the hero numeral (Ting: "lower cycle day as
    // well") — was 4; tightened to 0 so the eyebrow sits just above the number.
    marginBottom: 0,
  },
  // Big cycle-day numeral — hero of the center stack. Manrope bold (the hero-
  // numeral weight); the weight is in the family name, so no companion
  // fontWeight or fontStyle. Large display number → negative tracking.
  // lineHeight is kept well ABOVE fontSize (~1.29x: 124 on 96) so the numeral's
  // ink box is never clipped on device (this was tuned for the old serif glyph;
  // a generous box is harmless for Manrope and avoids re-tuning layout).
  // 84→96 per Ting's "make 25 bigger"; lineHeight scaled proportionally to 124.
  // includeFontPadding: false removes Android's reserved padding; the absolute
  // center overlay owns the layout box and is centered both axes, so a taller
  // line box grows symmetrically about the numeral's baseline.
  bigNumber: {
    fontFamily: type.numeral.family,
    fontSize: 96,
    lineHeight: 124,
    color: colors.ink,
    letterSpacing: -1.5,
    includeFontPadding: false,
    textAlign: "center",
  },
  // Sits like a fraction denominator directly under the big numeral — almost
  // touching it. lineHeight matches fontSize (tight line box) and
  // includeFontPadding: false strips Android's extra leading. The big
  // numeral's line box is now ~1.29x (124 vs 96) to stop clipping, which adds
  // ~14dp of leading below the glyph vs a flush box; we tighten marginTop to
  // pull the "of N" denominator up tight under the numeral so "96/of N" reads
  // as one fraction unit (Ting: "less space between of 28 and luteal" / "25 of
  // 28"). Was −28 against the old 108 line box; −38 against the taller 124 box
  // to claw back the added leading AND close the gap further into a tight pair.
  ofLine: {
    fontSize: type.size.body,
    lineHeight: type.size.body,
    color: colors.clay,
    marginTop: -22,
    includeFontPadding: false,
  },
  // Phase label sits close under the "of N" line so the number / denominator /
  // phase read as one grouped center unit (Ting: "less space between of 28 and
  // luteal"). Was 18; tightened to 8. Manrope bold display weight + negative
  // tracking (a large header role).
  phaseLabel: {
    fontFamily: type.display.family,
    fontSize: 22,
    color: colors.ink,
    letterSpacing: -1,
    marginTop: 8,
    textAlign: "center",
  },
  prediction: {
    fontSize: 14,
    color: colors.clay,
    marginTop: 6,
    textAlign: "center",
    includeFontPadding: false,
  },
});
