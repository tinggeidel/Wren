import type { JSX } from "react";
import Svg, { Path, Line, Circle, Rect } from "react-native-svg";

// --- TabIcons --------------------------------------------------------------
// Custom thin line-art icons for the bottom tab bar, matching Ting's mockup
// (Screenshot 2026-05-31 at 11.16.41 PM): COACH / FOOD / CYCLE / WORKOUT /
// PROGRESS. Pure presentational SVG — no state, no logic.
//
// Each icon takes `active` and `color`. Inactive renders as an outline at
// reduced opacity; active renders emphasized. Per the mockup the CYCLE drop is
// definitively FILLED when active. The other icons stay stroke-only and lean on
// full opacity + a heavier stroke when active, because filling a chat bubble or
// dumbbell reads as a blob rather than the recognizable outline the mockup
// shows. The TabBar still owns the active/inactive opacity for labels; here we
// also drive icon opacity so a single source (the `active` flag) controls both.

export type TabIconProps = {
  active: boolean;
  color: string;
  size?: number;
};

// Rendered footprint is a touch smaller than the 24 viewBox so the icons feel
// daintier and sit centered in App.tsx's 24×24 wrapper with a little breathing
// room. The viewBox stays 24 so all coordinates below are authored against a
// shared grid; every icon's drawn content is normalized to ~y6.5–17.5 centered
// on (12,12) so they read as one optically matched set.
const SIZE = 23;
const STROKE_INACTIVE = 1.4;
const STROKE_ACTIVE = 1.7;

// Inactive icons sit at half opacity to match the prior emoji behavior; active
// icons are full strength.
function iconOpacity(active: boolean) {
  return active ? 1 : 0.5;
}

function strokeWidth(active: boolean) {
  return active ? STROKE_ACTIVE : STROKE_INACTIVE;
}

// COACH — rounded-rectangle speech bubble with a small tail at bottom-left.
export function CoachIcon({ active, color, size = SIZE }: TabIconProps) {
  const sw = strokeWidth(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={iconOpacity(active)}>
      {/* bubble body — 13w × 8h, sitting so body + tail span ~y6.5–17.5 centered on 12 */}
      <Rect
        x={5.5}
        y={6.5}
        width={13}
        height={8}
        rx={2.7}
        ry={2.7}
        fill="none"
        stroke={color}
        strokeWidth={sw}
      />
      {/* tail dropping from the bottom-left */}
      <Path
        d="M9 14.5 L7.5 17.5 L11 14.5"
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// FOOD — a side-view bowl: a short rim line above a half-circle bowl body.
export function FoodIcon({ active, color, size = SIZE }: TabIconProps) {
  const sw = strokeWidth(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={iconOpacity(active)}>
      {/* rim / lip line above the bowl — raised so bowl is taller/centered */}
      <Line x1={6.5} y1={8} x2={17.5} y2={8} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* bowl body: a deeper downward half-circle bottoming near y=17.5 */}
      <Path
        d="M6.5 9.5 A5.5 7 0 0 0 17.5 9.5 Z"
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// CYCLE — a teardrop / water drop. FILLED solid when active (per the mockup),
// outline-only when inactive.
export function CycleIcon({ active, color, size = SIZE }: TabIconProps) {
  const sw = strokeWidth(active);
  // A symmetric teardrop normalized to ~y6.5–17.5: pointed top at (12,6.5),
  // rounded belly bottoming near y~17.5, so it no longer towers over the others.
  const drop = "M12 6.5 C12 6.5 16.8 11.3 16.8 13.2 a4.8 4.8 0 0 1 -9.6 0 C7.2 11.3 12 6.5 12 6.5 Z";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={iconOpacity(active)}>
      <Path
        d={drop}
        fill={active ? color : "none"}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// WORKOUT — horizontal dumbbell: a bar with a weight plate at each end.
export function WorkoutIcon({ active, color, size = SIZE }: TabIconProps) {
  const sw = strokeWidth(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={iconOpacity(active)}>
      {/* connecting bar */}
      <Line x1={8.3} y1={12} x2={15.7} y2={12} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* left end-weight pair — outer tall + inner shorter, tightly spaced */}
      <Line x1={6} y1={8.5} x2={6} y2={15.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1={8.3} y1={9.5} x2={8.3} y2={14.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* right end-weight pair */}
      <Line x1={15.7} y1={9.5} x2={15.7} y2={14.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1={18} y1={8.5} x2={18} y2={15.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}

// PROGRESS — ascending lollipop chart: bars dot-capped at the top, the dot
// sitting cleanly on the bar end (solid when active, hollow ring when inactive).
export function ProgressIcon({ active, color, size = SIZE }: TabIconProps) {
  const sw = strokeWidth(active);
  // Four bars of increasing height sharing a baseline at y=17.5, evenly spaced
  // at x = 6, 10, 14, 18, with dot-center tops climbing to y=7.1 so content
  // spans ~y6.5–17.5 centered on (12,12).
  const bars = [
    { x: 6, top: 14 },
    { x: 10, top: 11.7 },
    { x: 14, top: 9.4 },
    { x: 18, top: 7.1 },
  ];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={iconOpacity(active)}>
      {bars.map((b) => (
        <Line
          key={b.x}
          x1={b.x}
          y1={17.5}
          x2={b.x}
          y2={b.top + 1.15}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      ))}
      {/* dot caps sitting atop each bar (solid active / hollow inactive) */}
      {bars.map((b) => (
        <Circle
          key={`c-${b.x}`}
          cx={b.x}
          cy={b.top}
          r={1.15}
          fill={active ? color : "none"}
          stroke={color}
          strokeWidth={sw}
        />
      ))}
    </Svg>
  );
}

// Lookup by tab key so the TABS array can reference a component by key without
// importing each one individually at the call site.
export type TabIconKey = "coach" | "food" | "cycle" | "workout" | "progress";

export const tabIcons: Record<TabIconKey, (props: TabIconProps) => JSX.Element> = {
  coach: CoachIcon,
  food: FoodIcon,
  cycle: CycleIcon,
  workout: WorkoutIcon,
  progress: ProgressIcon,
};
