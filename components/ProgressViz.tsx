// Progress-tab viz primitives — presentation only, all data via props.
// Built to match brand/progresstab/wren_progress_redesign.html (the bars(),
// area(), moodTimeline(), rings() viz functions). These are pure presentational
// components: they take already-computed data and render it; no profile, no
// business logic, no AsyncStorage. The implementer feeds real series in.
//
// Reuses the arc-segment approach from components/PhaseRing.tsx for the mini
// cycle rings (SVG has no conic-gradient, so a conic = stacked arc segments).

import { View, Text, StyleSheet } from "react-native";
import Svg, {
  Polyline,
  Polygon,
  Circle,
  Defs,
  LinearGradient,
  Stop,
  Path,
} from "react-native-svg";
import { colors, type } from "../lib/theme";

// --- Mood family → color map (mockup cmap) --------------------------------
export type MoodFamily = "calm" | "happy" | "sensitive" | "stressed";
export const MOOD_COLORS: Record<MoodFamily, string> = {
  calm: colors.profileSage, // --sage
  happy: colors.honey, // --honey
  sensitive: colors.profileRose, // --rose
  stressed: colors.warmAlert, // --clay
};

// ===========================================================================
// <Bars /> — rounded vertical bars in a faint track. Current bar = ink, the
// rest = calm/slate. Matches mockup .bars/.bar (96px tall, max 20px wide bars,
// gap 8, pill radius, faint track).
// ===========================================================================
export function Bars({
  data,
  labels,
  curIdx,
}: {
  data: number[];
  labels: string[];
  curIdx: number;
}) {
  const max = Math.max(...data, 1);
  return (
    <View style={barStyles.bars}>
      {data.map((v, i) => {
        const pct = Math.max(5, (v / max) * 100);
        const isCur = i === curIdx;
        return (
          <View key={i} style={barStyles.bar}>
            <View style={barStyles.track}>
              <View
                style={[
                  barStyles.col,
                  { height: `${pct}%`, backgroundColor: isCur ? colors.ink : colors.calm },
                ]}
              />
            </View>
            <Text style={barStyles.bl}>{labels[i]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const barStyles = StyleSheet.create({
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 96 },
  bar: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  track: {
    width: "100%",
    maxWidth: 20,
    height: "100%",
    justifyContent: "flex-end",
    backgroundColor: colors.progressLineSoft,
    borderRadius: 100,
    overflow: "hidden",
  },
  col: { width: "100%", borderRadius: 100, minHeight: 5 },
  bl: {
    fontSize: 8.5,
    color: colors.inkMuted,
    fontFamily: type.ui.family,
    marginTop: 9,
  },
});

// ===========================================================================
// <AreaSpark /> — weight sparkline: gradient fill polygon + 2.5px stroke
// polyline. Matches mockup area(): viewBox 300x64, 7px vertical inset.
// ===========================================================================
export function AreaSpark({
  data,
  accent = colors.calm,
}: {
  data: number[];
  accent?: string;
}) {
  const w = 300;
  const h = 64;
  if (data.length < 2) {
    return <View style={{ height: 64 }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const x = (i: number) => i * (w / (data.length - 1));
  const y = (v: number) => h - ((v - min) / rng) * (h - 14) - 7;
  const linePts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const polyPts = `0,${h} ${linePts} ${w},${h}`;
  return (
    <Svg viewBox={`0 0 ${w} ${h}`} width="100%" height={64} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity={0.2} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Polygon points={polyPts} fill="url(#areaGrad)" />
      <Polyline
        points={linePts}
        fill="none"
        stroke={accent}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ===========================================================================
// <MoodTimeline /> — horizontal dot scatter, color per mood family. Matches
// mockup moodTimeline(): viewBox 300x42, gentle sine vertical wobble, larger
// dots for stressed/happy.
// ===========================================================================
// A day with no logged mood is `null` — rendered as a small faint neutral dot
// (an honest gap), never colored as a fabricated mood.
export function MoodTimeline({ days }: { days: (MoodFamily | null)[] }) {
  const W = 300;
  const H = 42;
  const n = days.length;
  const pad = 8;
  const x = (i: number) => (n <= 1 ? W / 2 : pad + i * ((W - 2 * pad) / (n - 1)));
  const y = (i: number) => H / 2 + Math.sin(i * 0.72) * 7;
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={42} preserveAspectRatio="none">
      {days.map((c, i) => (
        <Circle
          key={i}
          cx={x(i)}
          cy={y(i)}
          r={c == null ? 2.4 : c === "stressed" || c === "happy" ? 4.6 : 4}
          fill={c == null ? colors.progressLine : MOOD_COLORS[c]}
          opacity={c == null ? 0.7 : 1}
        />
      ))}
    </Svg>
  );
}

export function MoodLegend() {
  const items: { label: string; family: MoodFamily }[] = [
    { label: "Calm", family: "calm" },
    { label: "Happy", family: "happy" },
    { label: "Sensitive", family: "sensitive" },
    { label: "Stressed", family: "stressed" },
  ];
  return (
    <View style={moodStyles.legend}>
      {items.map((it) => (
        <View key={it.family} style={moodStyles.lg}>
          <View style={[moodStyles.lgDot, { backgroundColor: MOOD_COLORS[it.family] }]} />
          <Text style={moodStyles.lgText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Week/period marks row (mockup .wmk) — small uppercase labels under a timeline.
export function MarkRow({ marks }: { marks: string[] }) {
  return (
    <View style={moodStyles.wmk}>
      {marks.map((m, i) => (
        <Text key={i} style={moodStyles.wmkText}>
          {m}
        </Text>
      ))}
    </View>
  );
}

const moodStyles = StyleSheet.create({
  legend: { flexDirection: "row", gap: 15, justifyContent: "center", marginTop: 12 },
  lg: { flexDirection: "row", alignItems: "center", gap: 6 },
  lgDot: { width: 8, height: 8, borderRadius: 4 },
  lgText: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontFamily: type.label.family,
    color: colors.inkMuted,
    textTransform: "uppercase",
  },
  wmk: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingHorizontal: 4 },
  wmkText: {
    fontSize: 8.5,
    letterSpacing: 1,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
  },
});

// ===========================================================================
// <CycleRings /> — mini conic-gradient rings, center day numeral, halo on the
// current one. Matches mockup rings()/.mring. SVG has no conic-gradient, so we
// approximate the mockup's 4-stop conic (ember→sage→honey→lut) with four
// painted arc segments — the same arc technique PhaseRing.tsx uses.
// ===========================================================================
export type MiniCycle = { month: string; day: number; cur?: boolean };

const RING_SIZE = 58;
const RING_STROKE = 5;

// Four arc segments approximating the mockup's conic-gradient hue stops
// (from 0deg: ember 0°, sage ~122°, honey ~193°, lut ~289°, back to ember).
// Reuses PhaseRing's clockwise-from-12 arc construction.
function ringArc(start: number, end: number): string {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const cx = RING_SIZE / 2;
  const cy = RING_SIZE / 2;
  const point = (a: number) => ({
    x: cx + r * Math.sin(a),
    y: cy - r * Math.cos(a),
  });
  const p0 = point(start);
  const p1 = point(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

function MiniRing({ day, cur }: { day: number; cur?: boolean }) {
  // Stop boundaries from the mockup conic (deg → radians).
  const stops: { from: number; to: number; color: string }[] = [
    { from: 0, to: 122, color: colors.period }, // ember
    { from: 122, to: 193, color: colors.profileSage }, // sage
    { from: 193, to: 289, color: colors.honey }, // honey
    { from: 289, to: 360, color: colors.lut }, // dusty rose / luteal
  ];
  const deg2rad = (d: number) => (d / 360) * Math.PI * 2;
  return (
    <View style={ringStyles.mring}>
      {cur && <View style={ringStyles.halo} />}
      <Svg width={RING_SIZE} height={RING_SIZE} style={ringStyles.svg}>
        {stops.map((s, i) => (
          <Path
            key={i}
            d={ringArc(deg2rad(s.from), deg2rad(s.to))}
            stroke={s.color}
            strokeWidth={RING_STROKE}
            strokeLinecap="butt"
            fill="none"
          />
        ))}
      </Svg>
      <View style={ringStyles.mc} pointerEvents="none">
        <Text style={ringStyles.mcText}>{day}</Text>
      </View>
    </View>
  );
}

export function CycleRings({ cycles }: { cycles: MiniCycle[] }) {
  return (
    <View style={ringStyles.row}>
      {cycles.map((c, i) => (
        <View key={i} style={ringStyles.mr}>
          <MiniRing day={c.day} cur={c.cur} />
          <Text style={[ringStyles.mrl, c.cur && ringStyles.mrlCur]}>{c.month}</Text>
        </View>
      ))}
    </View>
  );
}

const ringStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-around", gap: 10 },
  mr: { alignItems: "center" },
  mring: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    top: -7,
    left: -7,
    right: -7,
    bottom: -7,
    borderRadius: (RING_SIZE + 14) / 2,
    backgroundColor: colors.moodHalo,
    opacity: 0.6,
  },
  svg: { position: "absolute", top: 0, left: 0 },
  mc: { position: "absolute", alignItems: "center", justifyContent: "center" },
  mcText: {
    fontSize: 15,
    fontFamily: type.numeral.family,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  mrl: {
    fontSize: 9,
    letterSpacing: 1,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
    marginTop: 10,
  },
  mrlCur: { color: colors.ink },
});

// ===========================================================================
// <WeekDots /> — S M T W T F S labels + 20px circles, filled sage with white
// check when logged. Matches mockup .weekdots/.wd.
// ===========================================================================
export function WeekDots({
  logged,
  labels = ["S", "M", "T", "W", "T", "F", "S"],
}: {
  logged: boolean[];
  labels?: string[];
}) {
  return (
    <View style={weekStyles.row}>
      {labels.map((d, i) => (
        <View key={i} style={weekStyles.wd}>
          <Text style={weekStyles.wl}>{d}</Text>
          <View style={[weekStyles.wc, logged[i] && weekStyles.wcOn]}>
            {logged[i] && (
              <Svg width={20} height={20} viewBox="0 0 20 20" style={weekStyles.check}>
                <Path
                  d="M5.5 10.5 L8.5 13.5 L14.5 6.5"
                  stroke={colors.paper}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const weekStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  wd: { alignItems: "center", flex: 1 },
  wl: {
    fontSize: 8.5,
    letterSpacing: 0.5,
    color: colors.inkMuted,
    fontFamily: type.label.family,
  },
  wc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 7,
    borderWidth: 1.5,
    borderColor: colors.progressLine,
    alignItems: "center",
    justifyContent: "center",
  },
  wcOn: { backgroundColor: colors.profileSage, borderColor: colors.profileSage },
  check: { position: "absolute" },
});

// ===========================================================================
// <ProgressBar /> — 6px rounded track + slate fill. Matches mockup .prbar.
// ===========================================================================
export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={prStyles.track}>
      <View style={[prStyles.fill, { width: `${clamped}%` }]} />
    </View>
  );
}

const prStyles = StyleSheet.create({
  track: { height: 6, backgroundColor: colors.calmFill, borderRadius: 100, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.calm, borderRadius: 100 },
});
