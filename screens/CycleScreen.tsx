import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  Modal,
  TextInput,
  Animated,
} from "react-native";
import {
  Profile,
  DayLog,
  Flow,
  EnergyLevel,
  FLOW_OPTIONS,
  ENERGY_OPTIONS,
  MOOD_OPTIONS,
  SYMPTOM_OPTIONS,
  DIGESTION_OPTIONS,
} from "../lib/types";
import {
  toISODate,
  parseISO,
  addDays,
  currentPhase,
  phaseForDate,
  periodDays,
  periodRanges,
  cycleStarts,
  observedCycleLength,
  nextPredictedPeriod,
  isPredictedPeriodDay,
  isPreviousCycle,
  recurringLogsAroundDay,
  type RecurringLog,
  PHASE_COLORS,
} from "../lib/cycle";
import { colors, type, spacing, radius, fontBold, fontExtrabold } from "../lib/theme";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSwipeDismiss } from "../components/useSwipeDismiss";
import PhaseRing from "../components/PhaseRing";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const PHASES = ["menstrual", "follicular", "ovulatory", "luteal"] as const;
type PhaseKey = (typeof PHASES)[number];

// Local aliases — kept so the existing inline-style call sites read cleanly.
// All visual color/typography is sourced from lib/theme.ts.
const PERIOD = colors.period;
const ACCENT = colors.accent;

// --- Page-wide phase-color softening (Ting 2026-05-31) ---------------------
// Ting wants the phase colors softer/more transparent EVERYWHERE on the Cycle
// page — ring, legend, collapsed strip, AND the expanded month grid — so they
// read as a gentle washed pastel rather than saturated paint. We do this with
// alpha on the existing phase hexes (no new palette tokens): each phase hex is
// blended toward transparency via rgba. Because the cells sit on the light
// cream/paper surface, a translucent fill lands as a soft pastel.
//
// LEGIBILITY: softening forces a text-color decision. Cocoa `ink` on these
// washed pastels has strong contrast (the fills are now light), so painted
// day-cell numerals switch to cocoa ink. The two emphasis fills stay SOLID and
// keep white text: the logged-period cell (solid ember) and the today cell
// (solid cocoa) — their white numerals remain clearly legible. So softening
// never drops text below the body-text contrast bar.
const PHASE_FILL_ALPHA = 0.32; // washed pastel for strip + grid phase cells
const LEGEND_DOT_ALPHA = 0.55; // legend dots a touch stronger so they read

// Convert a #rrggbb hex to an rgba() string at the given alpha.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Daily Cycle message ------------------------------------------------------
// The line under the ring is composed fresh each day (composeDailyMessage below)
// instead of one static weekly quote. Every possible sentence lives in the
// module-level tables here so the register is auditable at a glance.
//
// VOICE: Ting-approved flat declarative. The "Many women find/feel…" framing was
// the ED-safety default; this override was discussed and signed off explicitly.
// The Cycle surface carries no on-screen feelings-override frame (dropped per
// Ting's 2026-05-29 ED-safety override). None of these strings use
// calorie/deficit/burn/earn framing, advise eating less, moralize, or compare to
// a norm — they reflect her own logged data as fact and offer gentle, practical
// tips in the existing register. The bottom-of-screen disclaimer is untouched.
// (PhaseKey — "menstrual" | "follicular" | "ovulatory" | "luteal" — is declared
// above from PHASES.)

// Daily-varying phase guidance (fallback, case 3). Each phase's approved
// sentence is split into early/late variants (luteal — the longest phase — gets
// early/mid/late) keyed off where the cycle-day sits within the phase's range,
// so the line evolves through the phase instead of holding one weekly string.
// Content anchors preserved: iron-rich foods (menstrual), strength peaks
// (follicular), peak energy (ovulatory), protein & magnesium (luteal). "Be soft
// with yourself" stays on every menstrual + luteal variant. Each variant ≤ 2
// sentences.
const PHASE_FALLBACK: Record<PhaseKey, string[]> = {
  menstrual: [
    "Energy often dips early in your period — gentle movement and iron-rich foods help. Be soft with yourself.",
    "Energy often starts to lift as your period winds down — ease back toward movement, and keep iron-rich foods up. Be soft with yourself.",
  ],
  follicular: [
    "Strength usually starts climbing this week. A good time to push intensity or chase a PR if energy's there.",
    "Strength usually peaks late this week. Push intensity or chase a PR if energy's there.",
  ],
  ovulatory: [
    "Peak energy is arriving. Train hard if it feels right — keep water and protein up.",
    "Peak energy holds through ovulation. Train hard if it feels right — keep water and protein up.",
  ],
  luteal: [
    "Endurance often feels steadier than intensity now — protein and magnesium-rich foods help. Be soft with yourself.",
    "Steady endurance work tends to feel best this stretch — protein and magnesium-rich foods help. Be soft with yourself.",
    "Energy often eases as your period nears — lighter movement, protein, and magnesium-rich foods help. Be soft with yourself.",
  ],
};

// One short phase-appropriate tip (case 2: pattern exists, nothing logged
// today). One sentence each, same register as PHASE_FALLBACK.
const PHASE_TIP: Record<PhaseKey, string> = {
  menstrual: "Iron-rich foods and gentle movement help.",
  follicular: "A good week to build if energy's there.",
  ovulatory: "Keep water and protein up.",
  luteal: "Protein and magnesium-rich foods help.",
};

// One safe, gentle tip per symptom in SYMPTOM_OPTIONS (case 1: she logged this
// today). Cravings is deliberately neutral-supportive (protein + regular meals),
// never restrictive. No tip advises eating less or frames a symptom as a failure.
const SYMPTOM_TIPS: Record<string, string> = {
  Cramps: "Warmth, magnesium-rich foods, and lower-intensity movement help.",
  Bloating: "Water, gentle movement, and magnesium-rich foods help.",
  Headache: "Water, rest, and magnesium-rich foods help.",
  "Breast tenderness": "A supportive fit and gentler, lower-impact movement help.",
  Backache: "Warmth, gentle mobility, and rest help.",
  Acne: "Water and steady sleep help.",
  Fatigue: "Lighter movement, iron-rich foods, and earlier sleep help.",
  Cravings: "Cravings are common here — protein and regular meals steady them.",
  Insomnia: "A wind-down routine, magnesium-rich foods, and a cooler room help.",
  Nausea: "Small, simple meals and ginger or peppermint help.",
};

// Tip for logged low energy (case 1). Low energy is the only energy level we
// reflect — medium/high are noise, not a signal worth surfacing.
const ENERGY_LOW_TIP = "Lighter movement and iron-rich foods help.";

// Where `day` sits within its phase, as 0..1. Uses the same phase boundaries as
// lib/cycle's phaseName (scaled by cycle length) so the variant switch lines up
// with the actual phase math. Clamped, so a predicted-late luteal day (past the
// cycle window) resolves to the last (late) variant.
function phaseProgress(day: number, len: number, phase: PhaseKey): number {
  const scale = len / 28;
  const bounds: Record<PhaseKey, [number, number]> = {
    menstrual: [0, 5 * scale],
    follicular: [5 * scale, 13 * scale],
    ovulatory: [13 * scale, 16 * scale],
    luteal: [16 * scale, len],
  };
  const [lo, hi] = bounds[phase];
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (day - lo) / (hi - lo)));
}

// Pick the early/late (or early/mid/late) variant for where the day sits.
function phaseFallback(phase: PhaseKey, day: number, len: number): string {
  const variants = PHASE_FALLBACK[phase];
  const t = phaseProgress(day, len, phase);
  const idx = Math.min(variants.length - 1, Math.floor(t * variants.length));
  return variants[idx];
}

// One item to reflect back from TODAY's log (case 1), with its tip.
type ReflectItem = { kind: RecurringLog["kind"]; value: string; label: string; tip: string };

// Items to reflect from today's log: symptoms first (each with its tip), then
// low energy. Capped at 2 so the line stays short. Moods / medium-high energy
// aren't reflected here (they carry no tip and would only pad the line).
function todayReflectItems(log?: DayLog): ReflectItem[] {
  if (!log) return [];
  const out: ReflectItem[] = [];
  for (const s of log.symptoms ?? []) {
    out.push({ kind: "symptom", value: s, label: s.toLowerCase(), tip: SYMPTOM_TIPS[s] ?? "" });
  }
  if (log.energy === "low") {
    out.push({ kind: "energy", value: "low", label: "low energy", tip: ENERGY_LOW_TIP });
  }
  return out.slice(0, 2);
}

// Human label for a recurring past-cycle item (case 2). Symptoms/moods/digestion
// lowercase to their chip word; energy reads "low energy".
function recurringLabel(r: RecurringLog): string {
  return r.kind === "energy" ? "low energy" : r.value.toLowerCase();
}

// "cramps" / "cramps and low energy".
function joinLabels(labels: string[]): string {
  return labels.length > 1 ? `${labels[0]} and ${labels[1]}` : labels[0];
}

// Weakest (minimum) distinct-cycle match count among the reflected items that
// recur around this day (case 1 pattern clause); 0 when nothing lines up. We use
// the MIN, not the max, so a clause applied to the whole reflected set never
// states a number larger than the weakest item's true count — otherwise a second
// item that matched fewer cycles would be overclaimed. `RecurringLog.cycles`
// counts DISTINCT past cycles an item appeared in, not consecutive/recent ones,
// so the caller's phrasing avoids "last N" and says "N of your recent cycles".
function minMatchCycles(recurring: RecurringLog[], reflected: ReflectItem[]): number {
  let min = 0;
  for (const ref of reflected) {
    let best = 0;
    for (const rec of recurring) {
      if (rec.kind === ref.kind && rec.value === ref.value && rec.cycles > best) {
        best = rec.cycles;
      }
    }
    if (best > 0) min = min === 0 ? best : Math.min(min, best);
  }
  return min;
}

// Compose the daily line under the ring. Priority: (1) reflect what she logged
// TODAY (+ pattern clause + tip), (2) a past-cycle pattern around this day (+
// phase tip), (3) daily-varying phase guidance. Only ever called for a real
// phase with a non-null cycle-day (the caller gates BC / off / unknown). When
// `predictedLate` (period overdue, luteal held), we suppress every pattern line
// — the app shouldn't imply a period-day pattern it can't confirm — and reflect
// only her own today-log or the luteal fallback.
function composeDailyMessage(
  profile: Profile,
  phase: PhaseKey,
  dayOfCycle: number,
  cycleLength: number,
  cyclesTracked: number,
  predictedLate: boolean,
  todayLog: DayLog | undefined,
): string {
  // (1) Today logged — reflect her own data as fact.
  const reflected = todayReflectItems(todayLog);
  if (reflected.length) {
    let clause = "";
    if (!predictedLate) {
      // matchCycles = weakest DISTINCT-cycle count among the reflected items that
      // recur here. `cycles` is a distinct-cycle count, not a run of recent ones,
      // so we only say "last cycle" when there is exactly ONE completed past cycle
      // (then it truly IS the last one). With multiple completed cycles we say
      // "N of your recent cycles" — count-accurate, no recency/consecutive claim.
      const matchCycles = minMatchCycles(recurringLogsAroundDay(profile, dayOfCycle), reflected);
      if (matchCycles > 0) {
        if (cyclesTracked === 1) {
          clause = " — that matches your last cycle around this point";
        } else if (matchCycles === 1) {
          clause = " — you've logged this in a past cycle around this point";
        } else {
          clause = ` — you've logged this in ${matchCycles} of your recent cycles`;
        }
      }
    }
    const lead = `You logged ${joinLabels(reflected.map((r) => r.label))} today${clause}.`;
    const tip = reflected[0].tip;
    return tip ? `${lead} ${tip}` : lead;
  }

  // (2) Nothing logged today, but a past-cycle pattern exists around this day.
  if (!predictedLate) {
    const recurring = recurringLogsAroundDay(profile, dayOfCycle);
    if (recurring.length) {
      const top = recurring[0].cycles;
      // Only mention items that recurred in the SAME number of cycles as the
      // lead, so the count phrasing stays true for every item named.
      const mention = recurring.filter((r) => r.cycles === top).slice(0, 2);
      const items = joinLabels(mention.map(recurringLabel));
      // `top` is a DISTINCT-cycle count, not a run of recent ones. Only claim
      // "last cycle" when exactly ONE completed past cycle exists; otherwise use
      // count-accurate phrasing with no recency/consecutive claim.
      let lead: string;
      if (cyclesTracked === 1) {
        lead = `Around this point last cycle you logged ${items}.`;
      } else if (top === 1) {
        lead = `Around this point in a past cycle you logged ${items}.`;
      } else {
        lead = `Around this point you've logged ${items} in ${top} of your recent cycles.`;
      }
      return `${lead} ${PHASE_TIP[phase]}`;
    }
  }

  // (3) Fallback — daily-varying phase guidance.
  return phaseFallback(phase, dayOfCycle, cycleLength);
}

const PHASE_TITLE: Record<string, string> = {
  menstrual: "Menstrual",
  follicular: "Follicular",
  ovulatory: "Ovulation",
  luteal: "Luteal",
};

// Inline-dot legend labels (mockup: ● MENSTRUAL ● FOLLICULAR ● OVULATION ●
// LUTEAL — small caps, clay). "Ovulation" matches the ring's phase label voice
// even though the phase key is "ovulatory".
const LEGEND_LABEL: Record<PhaseKey, string> = {
  menstrual: "MENSTRUAL",
  follicular: "FOLLICULAR",
  ovulatory: "OVULATION",
  luteal: "LUTEAL",
};

// Initials for the header avatar (mockup "TG"), reused verbatim from the
// Workout header pattern so the two tabs render the same avatar. Up to two
// letters from the profile name; returns "" when there's no name so the avatar
// renders as a clean cocoa circle (no stray glyph) rather than a placeholder.
function profileInitials(name?: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

// Header eyebrow — leads with the CURRENT PHASE, e.g. "LUTEAL · MAY 2026"
// (clay small-caps, letter-spaced), matching the Workout eyebrow's "PHASE · …"
// lead and removing the old "CYCLE · …" / "cycle" title redundancy.
//
// ED-SAFETY: `phaseLabel` is only ever a REAL cycle phase here — the caller
// passes a non-null label exclusively for non-BC users with cycle data. For
// birth-control or no-data/unknown users it passes null and we fall back to
// just "{MONTH} {YEAR}" with NO phase prefix, so the eyebrow never implies a
// cycle phase/day for those users.
function headerEyebrow(d: Date, phaseLabel: string | null): string {
  const my = d
    .toLocaleDateString(undefined, { month: "long", year: "numeric" })
    .toUpperCase();
  return phaseLabel ? `${phaseLabel.toUpperCase()} · ${my}` : my;
}

// Editor eyebrow — "THU · MAY 28 · CYCLE DAY 24" (clay small-caps, letter-
// spaced). Weekday · month/day · cycle-day for the date being edited. We pass
// the resolved cycle day in so this helper stays pure string-formatting; the
// caller computes it via phaseForDate for the edited date (today OR a past day
// opened from the Progress tap).
//
// Binding verified (2026-05-29): the call site passes `editorDate` (the day the
// editor is actually open on) and `phaseForDate(profile, parseISO(editorDate))
// .dayOfCycle`. Because phaseForDate takes the EDITED date — not today — both
// the "+" path (editorDate === today) and the Progress look-back path
// (editorDate === a past ISO via selectDateSignal → openEditor) resolve the
// weekday/date/cycle-day for THAT day, not today's. When dayOfCycle is null (on
// birth control, or a date before the first logged period) the cycle-day
// segment is dropped — we render "THU · MAY 28" with no fabricated day.
function editorEyebrow(iso: string, cycleDay: number | null): string {
  const d = parseISO(iso);
  const wd = d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const md = d
    .toLocaleDateString(undefined, { month: "short", day: "numeric" })
    .toUpperCase();
  const base = `${wd} · ${md}`;
  return cycleDay != null ? `${base} · CYCLE DAY ${cycleDay}` : base;
}

// 7-day strip range — "MAY 29 - JUNE 4" (uppercase, full month names). Built
// from the strip's first/last ISO dates. Ting's art direction overrides the
// earlier lowercased-mockup pass: she wants full caps, spelled-out months.
// Full month names ("month: long") spell out across a month boundary, so a
// window like May 29 → June 4 reads "MAY 29 - JUNE 4".
function stripRange(startISO: string, endISO: string): string {
  const fmt = (iso: string) =>
    parseISO(iso)
      .toLocaleDateString(undefined, { month: "long", day: "numeric" })
      .toUpperCase();
  return `${fmt(startISO)} - ${fmt(endISO)}`;
}

// Build the 7-wide grid of ISO dates (with leading/trailing blanks) for a month.
function monthCells(view: Date): (string | null)[] {
  const year = view.getFullYear();
  const month = view.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISODate(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CycleScreen({
  profile,
  updateProfile,
  selectDateSignal,
  onOpenSettings,
}: {
  profile: Profile;
  // Top-right header avatar (mockup) routes through this — same pattern as
  // WorkoutScreen's onOpenSettings. Optional so other callers/tests can omit it;
  // when absent the avatar is rendered non-interactive rather than a dead button.
  // App.tsx passes onOpenSettings={() => setTab("settings")} (mirrors Workout).
  onOpenSettings?: () => void;
  // Shared updater (App.tsx): the dayLogs transform runs against the LATEST
  // profile, so a Coach check-in write can't be clobbered by a stale snapshot.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  // Feature F3 — when the Progress tab's "Cycle look-back" grid taps a day, App
  // bumps this signal with that day's ISO date. The nonce changes on every tap
  // (even repeats of the same date) so the effect re-fires. We then jump the
  // month view to that date and open the day-log editor. After consumption the
  // signal is stable until the next tap; ordinary tab navigation does NOT
  // re-fire it.
  selectDateSignal?: { date: string; nonce: number } | null;
}) {
  const today = toISODate(new Date());
  const todayDate = new Date();
  const [view, setView] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // NEXT 7 DAYS section — collapsed (default 7-day strip) vs expanded (full
  // month grid). Presentational toggle only; the data feeding both states is
  // the existing phase/period math. (wren-implementer: confirm the strip's
  // 7-day window + month-grid still read correctly against live profiles.)
  const [calendarExpanded, setCalendarExpanded] = useState(false);

  // Day-log editor state.
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | undefined>(undefined);
  const [energy, setEnergy] = useState<EnergyLevel | undefined>(undefined);
  const [moods, setMoods] = useState<string[]>([]);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [digestion, setDigestion] = useState<string[]>([]);
  const [note, setNote] = useState("");
  // True while a Progress signal-jump's editor is open. On close we reset the
  // calendar view to the current month so coming back to Cycle later doesn't
  // strand the user on a months-old view (per F3 "don't trap her on the old
  // date"). Cleared once the reset has been applied.
  const fromSignalRef = useRef(false);

  const logs = profile.dayLogs ?? {};
  const logged = new Set(periodDays(profile));
  const starts = cycleStarts(profile);
  const phase = currentPhase(profile);
  const obs = observedCycleLength(profile);
  const pred = nextPredictedPeriod(profile);
  const ranges = periodRanges(profile);
  const onPeriodToday = logged.has(today);

  // "Cycles tracked" subtracts 1 from starts.length because the FIRST period
  // start has no preceding cycle to measure — it's only a marker, not an
  // observation.
  const cyclesTracked = Math.max(0, starts.length - 1);

  // Cycle length used by the ring + "day N of M" math. Falls
  // back to 28 when there's no observed length (no logged starts yet).
  const cycleLength = obs.length > 0 ? obs.length : 28;

  function editorLabel(iso: string): string {
    if (iso === today) return "today";
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (iso === toISODate(y)) return "Yesterday";
    return parseISO(iso).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function openEditor(iso: string) {
    if (iso > today) return; // can't log the future
    const l = logs[iso];
    setFlow(l?.flow);
    setEnergy(l?.energy);
    setMoods(l?.moods ?? []);
    setSymptoms(l?.symptoms ?? []);
    setDigestion(l?.digestion ?? []);
    setNote(l?.note ?? "");
    setEditorDate(iso);
  }

  // F3 — react to a "jump to this day" signal from the Progress tab. We watch
  // the nonce specifically so re-tapping the same date refires; if we keyed on
  // the date alone, the second tap of the same day would no-op. Future-day taps
  // shouldn't happen (Progress disables them), but openEditor still guards.
  useEffect(() => {
    if (!selectDateSignal) return;
    const { date } = selectDateSignal;
    setView(new Date(parseISO(date).getFullYear(), parseISO(date).getMonth(), 1));
    // Expand the month grid so the jumped-to day is actually visible once the
    // editor closes. The collapsed strip is a fixed today+6 window and ignores
    // `view`, so without this a Progress tap on a past month would set `view`
    // to a month the user can never see. Pure presentational state, no write.
    setCalendarExpanded(true);
    openEditor(date);
    // openEditor is stable for our purposes — it only reads profile state via
    // logs/today closure, and the effect intentionally re-runs on each nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectDateSignal?.nonce]);

  // Apply a transform to the LATEST profile's dayLogs (not the render-time `logs`
  // snapshot), then recompute lastPeriodStart from the merged result so the
  // legacy single-date field stays in sync. Routes through the shared updater so
  // a Coach check-in that landed after render is preserved.
  async function persist(transform: (prev: Record<string, DayLog>) => Record<string, DayLog>) {
    await updateProfile((p) => {
      const dayLogs = transform(p.dayLogs ?? {});
      const newStarts = cycleStarts({ ...p, dayLogs });
      const latest = newStarts.length ? newStarts[newStarts.length - 1] : "";
      return { ...p, dayLogs, lastPeriodStart: latest };
    });
  }

  async function saveEditor() {
    if (!editorDate) return;
    const date = editorDate;
    const entry: DayLog = { date };
    if (flow) entry.flow = flow;
    if (energy) entry.energy = energy;
    if (moods.length) entry.moods = moods;
    if (symptoms.length) entry.symptoms = symptoms;
    if (digestion.length) entry.digestion = digestion;
    if (note.trim()) entry.note = note.trim();

    const isEmpty =
      !entry.flow &&
      !entry.energy &&
      !entry.moods &&
      !entry.symptoms &&
      !entry.digestion &&
      !entry.note;

    await persist((prev) => {
      const dayLogs = { ...prev };
      if (isEmpty) delete dayLogs[date];
      else dayLogs[date] = entry;
      return dayLogs;
    });
    setEditorDate(null);
  }

  async function clearDay() {
    if (!editorDate) return;
    const date = editorDate;
    await persist((prev) => {
      const dayLogs = { ...prev };
      delete dayLogs[date];
      return dayLogs;
    });
    setEditorDate(null);
  }

  function toggle(list: string[], setList: (v: string[]) => void, val: string) {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  }

  const cells = monthCells(view);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  // NEXT 7 DAYS strip — today plus the next six days (mockup: THU 28 … WED 3).
  const stripDays: string[] = [];
  for (let i = 0; i < 7; i++) stripDays.push(addDays(today, i));

  const monthLabel = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function shiftMonth(delta: number) {
    setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));
  }

  // --- Status card content (BC + no-data only) ---
  // The normal phase case is now the ring + coach-quote layout below; the
  // status card chrome survives only for the two fallback states the mockup
  // doesn't cover (on birth control, and brand-new account with no cycle data).
  let statusBody: ReactNode = null;
  if (phase.phase === "off") {
    // Cycle tracking turned fully off in Settings → Cycle. Distinct from the BC
    // and no-data states: no phase, no prediction, no logging prompt — just a
    // calm pointer back to where she can re-enable it.
    statusBody = (
      <>
        <Text style={styles.statusEyebrow}>CYCLE</Text>
        <Text style={styles.statusPhaseSerif}>Cycle tracking is off</Text>
        <Text style={styles.statusGuidance}>
          Turn it back on anytime in Settings → Cycle.
        </Text>
      </>
    );
  } else if (phase.onBirthControl) {
    statusBody = (
      <>
        <Text style={styles.statusEyebrow}>PHASE</Text>
        <Text style={styles.statusPhaseSerif}>On birth control</Text>
        <Text style={styles.statusGuidance}>
          You're on hormonal birth control, so Wren doesn't sync to a natural cycle — your plan stays
          steady. You can still log how you feel and any bleeds below.
        </Text>
      </>
    );
  } else if (!starts.length) {
    statusBody = (
      <>
        <Text style={styles.statusEyebrow}>PHASE</Text>
        <Text style={styles.statusPhaseSerif}>No cycle data yet</Text>
        <Text style={styles.statusGuidance}>
          Tap ＋ or any day to log your period and how you feel. The more you log, the better Wren
          learns your real cycle and predicts the next one.
        </Text>
      </>
    );
  }

  // Standard-user gate: ring, legend, coach quote, 7-day strip, calendar and
  // pattern card all show only when there's real cycle data and the user is
  // not on BC. BC + no-data fall back to the status card (mockup covers the
  // normal case; these branches preserve the existing safe behavior).
  const showCycleUI = phase.phase !== "off" && !phase.onBirthControl && starts.length > 0;

  const editorHasEntry = !!editorDate && !!logs[editorDate];

  // Swipe-down-to-dismiss for the day editor sheet (drag down anywhere at top).
  // react-native-gesture-handler + RN Animated — same hook the other tabs use.
  const editorSwipe = useSwipeDismiss({
    visible: !!editorDate,
    onClose: () => setEditorDate(null),
  });

  // Center-of-ring prediction line — "Period in ~5 days" (mockup). Branch order
  // matters:
  //   (a) a REAL logged bleed today wins → "On your period".
  //   (b) else if the projected start has passed with no logged bleed
  //       (phase.predictedLate) → "Period expected". This MUST beat (c): when
  //       late, nextPredictedPeriod has already skipped to the NEXT cycle and
  //       would wrongly read "Period in ~27 days". Copy is neutral/factual
  //       timing only (no feelings framing, no implication anything's wrong).
  //   (c) else the normal forward prediction → "Period in ~N days".
  const ringPrediction = onPeriodToday
    ? "On your period"
    : phase.predictedLate
      ? // Trimmed to just "Period expected" (dropped the "~N days later than
        // your average" clause) so it fits inside the ring hole.
        "Period expected"
      : pred && pred.daysUntil > 0
        ? `Period in ~${pred.daysUntil} day${pred.daysUntil === 1 ? "" : "s"}`
        : null;

  // Coach line under the ring — composed fresh each day (composeDailyMessage):
  // it reflects what she logged today, or a past-cycle pattern around this day,
  // else daily-varying phase guidance. Rendered as a large centered Manrope line
  // (mockup); flat declarative voice intact. Only composed for a real phase with
  // a known cycle-day — "unknown" (very-late) keeps its hero and shows no quote,
  // and BC / off never reach here (showCycleUI gate). The ED-safety disclaimer
  // below is unchanged.
  let coachQuote = "";
  if (
    phase.dayOfCycle != null &&
    (phase.phase === "menstrual" ||
      phase.phase === "follicular" ||
      phase.phase === "ovulatory" ||
      phase.phase === "luteal")
  ) {
    coachQuote = composeDailyMessage(
      profile,
      phase.phase,
      phase.dayOfCycle,
      cycleLength,
      cyclesTracked,
      !!phase.predictedLate,
      logs[today],
    );
  }

  // Last-period label for the pattern card's right column — "May 5 – 8"
  // (mockup: month + day range, no year, no day count).
  const lastPeriodLabel = (() => {
    if (!ranges.length) return null;
    const r = ranges[ranges.length - 1];
    const startTxt = parseISO(r.start).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    if (r.start === r.end) return startTxt;
    const endDay = parseISO(r.end).getDate();
    return `${startTxt} – ${endDay}`;
  })();

  // Inline-dot legend, shared by the ring section and the expanded calendar.
  const renderLegend = () => (
    <View style={styles.legend}>
      {PHASES.map((p) => (
        <View key={p} style={styles.legendItem}>
          <View
            style={[
              styles.legendDot,
              { backgroundColor: withAlpha(PHASE_COLORS[p].bg, LEGEND_DOT_ALPHA) },
            ]}
          />
          <Text style={styles.legendText}>{LEGEND_LABEL[p]}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header — eyebrow ("CYCLE · MAY 2026") over the lowercase "cycle"
            title, with the TG-style avatar at top-right (mockup; same pattern as
            WorkoutScreen). The avatar opens Settings when onOpenSettings is
            passed, and renders as a plain non-pressable circle otherwise. */}
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text style={styles.headerEyebrow}>
              {headerEyebrow(
                todayDate,
                // Lead with the real phase only when one is actually known —
                // i.e. the same gate that drives the ring (non-BC, has cycle
                // data). For BC OR no-data/unknown, pass null → month/year only,
                // never a fabricated phase (ED-safety).
                showCycleUI ? (PHASE_TITLE[phase.phase] ?? null) : null
              )}
            </Text>
            <Text style={styles.headerTitle}>cycle</Text>
          </View>
          {/* Right side — two round cocoa controls: the "+" quick-add, then the
              TG avatar. The "+" calls openEditor(today) (same handler the old
              standalone pill used) and lives OUTSIDE the showCycleUI gate, so
              BC/no-data users can still log. When tracking is OFF, the "+" is
              hidden — there is no cycle to log and we surface nothing cycle. */}
          <View style={styles.headerActions}>
            {phase.phase !== "off" && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => openEditor(today)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Log today"
              >
                <Text style={styles.addBtnPlus}>＋</Text>
              </TouchableOpacity>
            )}
            {(() => {
              // Empty string when the profile has no name → clean cocoa circle.
              // A saved profile photo takes precedence over initials (parity
              // with Progress/Coach).
              const initials = profileInitials(profile.name);
              const inner = profile.profilePhotoUri ? (
                <Image
                  source={{ uri: profile.profilePhotoUri }}
                  style={styles.avatarImg}
                  resizeMode="cover"
                />
              ) : initials ? (
                <Text style={styles.avatarText}>{initials}</Text>
              ) : null;
              return onOpenSettings ? (
                <TouchableOpacity
                  style={styles.avatar}
                  onPress={onOpenSettings}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                >
                  {inner}
                </TouchableOpacity>
              ) : (
                <View style={styles.avatar}>{inner}</View>
              );
            })()}
          </View>
        </View>

        {showCycleUI ? (
          <>
            {/* Very-late state: a history-having user is overdue beyond the
                grace window, so phaseForDate returned "unknown" (dayOfCycle
                null). PhaseRing always renders its "CYCLE DAY 1 · unknown" stat
                stack, which is meaningless here, so we render a compact calm
                message IN PLACE OF the ring instead. Neutral/factual only — no
                implication anything is wrong. */}
            {phase.phase === "unknown" ? (
              <View style={styles.lateHero}>
                <Text style={styles.lateHeroTitle}>Period expected</Text>
                <Text style={styles.lateHeroBody}>
                  Log it when it starts and Wren re-syncs your cycle.
                </Text>
              </View>
            ) : (
              /* Painted-ribbon donut ring with centered stat stack. */
              <View style={styles.ringBlock}>
                <PhaseRing
                  cycleDay={phase.dayOfCycle ?? 1}
                  cycleLength={cycleLength}
                  currentPhase={
                    phase.phase as "menstrual" | "follicular" | "ovulatory" | "luteal"
                  }
                  phaseLabel={PHASE_TITLE[phase.phase] ?? phase.phase}
                  prediction={ringPrediction}
                  // Hero size: the screen container pads spacing.xl (20dp) each
                  // side, so on a standard ~390dp phone the usable width is ~350dp.
                  // 348 fills that as a prominent hero with ~1dp of safety margin
                  // each side so the ring never touches the screen edge. (Ting:
                  // "make the circle bigger.") The ring is center-aligned by
                  // ringBlock, so it stays gutter-safe on narrower phones too —
                  // it just shrinks the visible margin, never overflows the pad.
                  size={348}
                />
              </View>
            )}

            {/* Inline-dot legend. */}
            {renderLegend()}

            {/* Coach line — large centered Manrope quote. */}
            {coachQuote ? <Text style={styles.coachQuote}>{coachQuote}</Text> : null}

            {/* NEXT 7 DAYS — collapsible. Collapsed = painted strip; expanded =
                full month grid. The chevron toggles between the two states. */}
            <View style={styles.next7Card}>
              <TouchableOpacity
                style={styles.next7Header}
                activeOpacity={0.6}
                onPress={() => setCalendarExpanded((v) => !v)}
              >
                <Text style={styles.next7Eyebrow}>NEXT 7 DAYS</Text>
                <View style={styles.next7HeaderRight}>
                  <Text style={styles.next7Range}>
                    {calendarExpanded
                      ? monthLabel.toUpperCase()
                      : stripRange(stripDays[0], stripDays[stripDays.length - 1])}
                  </Text>
                  <Text style={styles.next7Chevron}>{calendarExpanded ? "⌃" : "⌄"}</Text>
                </View>
              </TouchableOpacity>

              {!calendarExpanded ? (
                <>
                  {/* COLLAPSED — horizontal painted strip of 7 day cells. */}
                  <View style={styles.strip}>
                    {stripDays.map((iso, i) => {
                      const isToday = iso === today;
                      const isLogged = logged.has(iso);
                      const isPredicted = !isLogged && isPredictedPeriodDay(profile, iso);
                      const hasLog = !!logs[iso];
                      const ph = phaseForDate(profile, parseISO(iso)).phase;
                      const tint = PHASE_COLORS[ph];
                      const d = parseISO(iso);
                      const wd = d
                        .toLocaleDateString(undefined, { weekday: "short" })
                        .toUpperCase()
                        .slice(0, 3);

                      const cellStyle: any[] = [styles.stripCell];
                      const numStyle: any[] = [styles.stripNum];
                      const wdStyle: any[] = [styles.stripWeekday];
                      // Washed pastel phase fill (softened page-wide) with cocoa
                      // ink — the translucent fill on cream keeps cocoa numerals
                      // high-contrast. The logged-period and today cells below
                      // stay SOLID with white text for emphasis + legibility.
                      let fill = tint ? withAlpha(tint.bg, PHASE_FILL_ALPHA) : undefined;
                      let ink: string = colors.ink;
                      // Predicted-period cells read as an OUTLINED soft-ember
                      // period (ember wash + hairline ember border, cocoa ink),
                      // distinct from both the LOGGED period (solid ember, white
                      // text) and the luteal tail — so an upcoming predicted
                      // period is legible as a period, not "luteal forever".
                      let predictedBorder = false;
                      if (isLogged) {
                        fill = PERIOD; // solid ember
                        ink = colors.paper; // white on ember stays legible
                      } else if (isPredicted) {
                        fill = withAlpha(PERIOD, 0.2);
                        ink = colors.ink;
                        predictedBorder = true;
                      }
                      if (fill) cellStyle.push({ backgroundColor: fill });
                      // Suppress the outline on today — the cocoa today-tile
                      // below overrides everything, including a predicted day.
                      if (predictedBorder && !isToday)
                        cellStyle.push({ borderWidth: 1, borderColor: PERIOD });
                      numStyle.push({ color: ink });
                      wdStyle.push({ color: ink, opacity: 0.7 });
                      // Today reads darkest — a cocoa overlay tile.
                      if (isToday) {
                        cellStyle.push(styles.stripCellToday);
                        numStyle.push({ color: colors.paper });
                        wdStyle.push({ color: colors.paper, opacity: 0.85 });
                      }
                      // Left/right outer corners rounded so the strip reads as
                      // one painted ribbon block.
                      if (i === 0) cellStyle.push(styles.stripCellFirst);
                      if (i === stripDays.length - 1) cellStyle.push(styles.stripCellLast);

                      return (
                        <TouchableOpacity
                          key={iso}
                          style={cellStyle}
                          activeOpacity={iso > today ? 1 : 0.6}
                          disabled={iso > today}
                          onPress={() => openEditor(iso)}
                        >
                          <Text style={wdStyle}>{wd}</Text>
                          <Text style={numStyle}>{d.getDate()}</Text>
                          {isToday && hasLog && !isLogged ? (
                            <View style={styles.stripTodayDot} />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={styles.next7Footer}>
                    <Text style={styles.next7FooterLeft}>
                      {PHASE_TITLE[phase.phase] ? PHASE_TITLE[phase.phase].toLowerCase() : ""}
                    </Text>
                    {pred ? (
                      <Text style={styles.next7FooterRight}>predicted period →</Text>
                    ) : null}
                  </View>
                </>
              ) : (
                <>
                  {/* EXPANDED — full month grid, painted-ribbon square cells. */}
                  <View style={styles.monthNav}>
                    <View style={styles.monthNavLeft}>
                      <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={12}>
                        <Text style={styles.monthArrow}>‹</Text>
                      </TouchableOpacity>
                      <Text style={styles.monthNavLabel}>{monthLabel.toUpperCase()}</Text>
                      <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={12}>
                        <Text style={styles.monthArrow}>›</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.monthCycleLabel}>
                      {cyclesTracked > 0 ? `cycle ${cyclesTracked}` : "cycle 1"}
                    </Text>
                  </View>

                  <View style={styles.gridWeekRow}>
                    {WEEKDAYS.map((w, i) => (
                      <Text key={i} style={styles.gridWeekday}>
                        {w}
                      </Text>
                    ))}
                  </View>

                  <View style={styles.grid}>
                    {rows.map((row, ri) => (
                      <View key={ri} style={styles.gridRow}>
                        {row.map((iso, ci) => {
                          if (!iso) return <View key={ci} style={styles.gridCellEmpty} />;
                          const isToday = iso === today;
                          const isFuture = iso > today;
                          const isLogged = logged.has(iso);
                          const isPredicted =
                            !isLogged && isPredictedPeriodDay(profile, iso);
                          const hasLog = !!logs[iso];
                          const ph = phaseForDate(profile, parseISO(iso)).phase;
                          const tint = PHASE_COLORS[ph];
                          const isPrev = isPreviousCycle(profile, iso);

                          const cellStyle: any[] = [styles.gridCell];
                          const txtStyle: any[] = [styles.gridDayText];

                          if (isLogged) {
                            // Solid ember + white numerals — emphasis cell,
                            // stays saturated; white text remains legible.
                            cellStyle.push({ backgroundColor: PERIOD });
                            txtStyle.push({ color: colors.paper });
                          } else if (isPredicted) {
                            // Predicted-period — OUTLINED soft ember: an ember
                            // wash plus a hairline ember border, cocoa numerals.
                            // Distinct from the LOGGED period (solid ember, white
                            // text) and from the luteal tail, so an upcoming
                            // predicted period reads as a period, not "luteal
                            // forever". Alpha is on the FILL (not cell opacity)
                            // so the numeral stays full-strength cocoa.
                            cellStyle.push({
                              backgroundColor: withAlpha(PERIOD, 0.2),
                              borderWidth: 1,
                              borderColor: PERIOD,
                            });
                            txtStyle.push({ color: colors.ink });
                          } else if (tint) {
                            // Washed pastel phase fill (softened page-wide) via
                            // alpha — previous-cycle days drop a touch lower for
                            // recency. Cocoa numerals on the light wash stay
                            // high-contrast (no cell-level opacity that would
                            // also fade the text).
                            cellStyle.push({
                              backgroundColor: withAlpha(
                                tint.bg,
                                isPrev ? PHASE_FILL_ALPHA * 0.6 : PHASE_FILL_ALPHA
                              ),
                            });
                            txtStyle.push({ color: colors.ink });
                          }
                          if (isFuture && !isPredicted) txtStyle.push({ opacity: 0.55 });
                          // Today reads as a solid cocoa tile with white text —
                          // same emphasis as the collapsed strip's today cell.
                          // This OVERRIDES any washed phase fill above so the
                          // white "today" numeral keeps full contrast after the
                          // page-wide softening (white-on-pastel would fail).
                          if (isToday) {
                            // borderWidth:0 clears any predicted-period outline
                            // so the today tile is a clean solid cocoa square.
                            cellStyle.push({ backgroundColor: colors.ink, borderWidth: 0 });
                            txtStyle.push(styles.gridTodayText);
                          }

                          return (
                            <TouchableOpacity
                              key={ci}
                              style={cellStyle}
                              activeOpacity={isFuture ? 1 : 0.6}
                              onPress={() => openEditor(iso)}
                              disabled={isFuture}
                            >
                              <Text style={txtStyle}>{parseISO(iso).getDate()}</Text>
                              {/* Today marker — dot under the number. */}
                              {isToday ? (
                                <View style={styles.gridTodayDot} />
                              ) : !isLogged && hasLog ? (
                                <View style={styles.gridLogDot} />
                              ) : null}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>

                  <View style={styles.gridFooter}>
                    <Text style={styles.gridFooterLeft}>
                      tap a day to remember how it felt.
                    </Text>
                    {phase.dayOfCycle ? (
                      <Text style={styles.gridFooterRight}>
                        today · cycle day {phase.dayOfCycle}
                      </Text>
                    ) : null}
                  </View>

                  {renderLegend()}
                </>
              )}
            </View>

            {/* Pattern card — two columns: PATTERN / LAST PERIOD. */}
            <View style={styles.patternCard}>
              <View style={styles.patternCol}>
                <Text style={styles.patternEyebrow}>PATTERN</Text>
                <View style={styles.patternValueRow}>
                  <Text style={styles.patternBig}>{cyclesTracked}</Text>
                  <Text style={styles.patternBigMeta}>
                    {" "}
                    {cyclesTracked === 1 ? "cycle" : "cycles"}
                  </Text>
                </View>
                <Text style={styles.patternSub}>
                  {obs.fromHistory ? "from your logs" : "sharpens as you log"}
                </Text>
              </View>
              <View style={styles.patternCol}>
                <Text style={styles.patternEyebrow}>LAST PERIOD</Text>
                <Text style={styles.patternLast}>{lastPeriodLabel ?? "—"}</Text>
              </View>
            </View>
          </>
        ) : (
          // BC + no-data fall back to the original status card chrome.
          <View style={styles.statusCard}>{statusBody}</View>
        )}

        {/* ED-safety / medical-advice disclaimer — centered. Kept
            LEGIBLE at `ink` (clay would fail WCAG AA at this size). Do not
            soften the meaning. It scopes to predictions, so it's hidden when
            there are none to disclaim: on birth control or cycle tracking off. */}
        {!phase.onBirthControl && phase.phase !== "off" ? (
          <Text style={styles.disclaimer}>
            Predictions are estimates from your own history and shift as you log
            more. Not medical advice.
          </Text>
        ) : null}
      </ScrollView>

      {/* Day-log editor */}
      <Modal
        visible={!!editorDate}
        animationType="slide"
        transparent
        onRequestClose={() => setEditorDate(null)}
      >
        {/* Per-Modal GestureHandlerRootView: a core RN Modal hosts a separate
            native view tree not under the app-root provider, so in-Modal gestures
            need their own root here or they silently do nothing. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.modalBackdrop}>
          <GestureDetector gesture={editorSwipe.gesture}>
          <Animated.View style={[styles.modalCard, editorSwipe.sheetAnimStyle]}>
            <View>
              {/* Drag-handle pill — added to match the other tabs' swipe-to-dismiss
                  affordance (this sheet previously had no grabber). */}
              <View style={styles.dragHandleWrap}>
                <View style={styles.dragHandle} />
              </View>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderText}>
                  <Text style={styles.modalEyebrow}>
                    {editorDate
                      ? editorEyebrow(
                          editorDate,
                          phaseForDate(profile, parseISO(editorDate)).dayOfCycle
                        )
                      : ""}
                  </Text>
                  <Text style={styles.modalTitle}>
                    {editorDate ? editorLabel(editorDate) : ""}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Tell me about today — only what you want to share.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setEditorDate(null)} hitSlop={10}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              {...editorSwipe.scrollViewProps}
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.editorSection}>PERIOD &amp; FLOW</Text>
              <View style={styles.chipWrap}>
                {FLOW_OPTIONS.map((o) => {
                  const on = flow === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => setFlow(on ? undefined : o.key)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editorSection}>ENERGY</Text>
              <View style={styles.chipWrap}>
                {ENERGY_OPTIONS.map((o) => {
                  const on = energy === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => setEnergy(on ? undefined : o.key)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editorSection}>
                MOOD
                <Text style={styles.editorSectionHint}> · pick as many as fit</Text>
              </Text>
              <View style={styles.chipWrap}>
                {MOOD_OPTIONS.map((o) => {
                  const on = moods.includes(o);
                  return (
                    <TouchableOpacity
                      key={o}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => toggle(moods, setMoods, o)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editorSection}>
                SYMPTOMS
                <Text style={styles.editorSectionHint}> · pick as many as fit</Text>
              </Text>
              <View style={styles.chipWrap}>
                {SYMPTOM_OPTIONS.map((o) => {
                  const on = symptoms.includes(o);
                  return (
                    <TouchableOpacity
                      key={o}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => toggle(symptoms, setSymptoms, o)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editorSection}>DIGESTION</Text>
              <View style={styles.chipWrap}>
                {DIGESTION_OPTIONS.map((o) => {
                  const on = digestion.includes(o);
                  return (
                    <TouchableOpacity
                      key={o}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => toggle(digestion, setDigestion, o)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editorSection}>A NOTE FOR COACH</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Anything else you want me to know about today…"
                placeholderTextColor={colors.clay}
                multiline
              />

              <TouchableOpacity style={styles.saveBtn} onPress={saveEditor}>
                <Text style={styles.saveBtnText}>Save today</Text>
              </TouchableOpacity>
              <Text style={styles.editorFooter}>
                or close without saving — nothing here is required.
              </Text>
              {editorHasEntry && (
                <TouchableOpacity style={styles.clearBtn} onPress={clearDay}>
                  <Text style={styles.clearBtnText}>Clear this day</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: spacing.xl, paddingBottom: 60 },
  // --- Header — eyebrow over lowercase "cycle" title + TG avatar (cohesive
  // with Workout/Food). Row layout, avatar baseline-aligned to the title. ---
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  // "CYCLE · MAY 2026" — clay small-caps eyebrow. Matches Workout's eyebrow
  // voice (Manrope bold, 9px, 2.5 tracking, uppercase).
  headerEyebrow: {
    fontFamily: fontBold,
    fontSize: 9,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: colors.clay,
  },
  // Lowercase "cycle" — same treatment as Workout's "workout" title
  // (Manrope ExtraBold, 38px, -1.8 tracking, cocoa ink).
  headerTitle: {
    fontFamily: fontExtrabold,
    fontSize: 38,
    color: colors.ink,
    letterSpacing: -1.8,
    marginTop: 7,
  },
  // Header avatar (cocoa circle, cream initials) — reused from Workout's .avatar.
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 4,
  },
  avatarImg: { width: 42, height: 42, borderRadius: 21 },
  avatarText: { fontFamily: fontBold, fontSize: 13, color: colors.cream, letterSpacing: -0.3 },
  // Header right-side cluster — the "+" quick-add and the avatar as two round
  // cocoa controls, right-aligned with a small gap. Baseline-aligned to the
  // title via the row's alignItems: flex-end.
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // Round cocoa "+" — cohesive companion to the 42px avatar (matches its fill
  // and size). Cream "＋" glyph centered.
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  addBtnPlus: {
    color: colors.cream,
    fontSize: 20,
    fontFamily: fontBold,
    lineHeight: 24,
    textAlign: "center",
  },

  // --- Painted-ribbon ring ---
  ringBlock: { alignItems: "center", marginTop: spacing.xs, marginBottom: spacing.lg },

  // --- Very-late hero (replaces the ring when phase is "unknown") ---
  // Compact centered message. Sits in the ring's slot; short by design so it
  // fills the hero area cleanly. Serif title + body line reuse the status-card
  // type voice (statusPhaseSerif / statusGuidance), centered.
  lateHero: {
    alignItems: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  lateHeroTitle: {
    fontSize: type.size.title,
    fontFamily: type.display.family,
    color: colors.ink,
    letterSpacing: -1,
    textAlign: "center",
  },
  lateHeroBody: {
    fontSize: type.size.body,
    fontFamily: type.body.family,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.sm + 2,
    lineHeight: 22,
  },

  // --- Inline-dot legend (shared by ring + expanded grid) ---
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontSize: type.size.micro,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.clay,
  },

  // --- Coach quote — large centered guidance line (Manrope medium) ---
  coachQuote: {
    fontSize: type.size.body,
    lineHeight: 22,
    fontFamily: type.ui.family,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.xl,
    marginBottom: spacing["2xl"],
    paddingHorizontal: spacing.sm,
  },

  // --- NEXT 7 DAYS card (collapsible) ---
  // MID shadow tier (matches Workout/Food content cards) — {0,6}/.16/14/elev 5.
  // Safe to shadow: next7Card has no overflow:hidden (only its inner `strip`
  // does, which doesn't clip the card's own shadow).
  next7Card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  next7Header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  next7Eyebrow: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.clay,
  },
  next7HeaderRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  next7Range: {
    fontSize: type.size.callout,
    fontFamily: type.label.family,
    color: colors.clay,
  },
  next7Chevron: { fontSize: type.size.body, color: colors.clay, fontWeight: "700" },

  // Collapsed painted strip — 7 cells, no gaps, outer corners rounded.
  strip: { flexDirection: "row", borderRadius: radius.md, overflow: "hidden" },
  stripCell: {
    flex: 1,
    aspectRatio: 0.78,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  stripCellFirst: { borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
  stripCellLast: { borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  stripCellToday: { backgroundColor: colors.ink },
  stripWeekday: {
    fontSize: 9,
    fontWeight: type.weight.semibold,
    letterSpacing: type.tracking.wide,
    marginBottom: 4,
  },
  stripNum: {
    fontSize: type.size.headline,
    fontFamily: type.label.family,
  },
  stripTodayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper,
    marginTop: 3,
  },
  next7Footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  next7FooterLeft: {
    fontSize: type.size.caption,
    fontFamily: type.body.family,
    color: colors.clay,
  },
  next7FooterRight: {
    fontSize: type.size.caption,
    fontFamily: type.body.family,
    color: colors.clay,
  },

  // Expanded month grid.
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  monthNavLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  monthNavLabel: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.ink,
  },
  monthCycleLabel: {
    fontSize: type.size.caption,
    fontFamily: type.body.family,
    color: colors.clay,
  },
  monthArrow: { fontSize: 18, color: colors.ink, fontWeight: "700" },
  gridWeekRow: { flexDirection: "row", marginBottom: spacing.xs },
  gridWeekday: {
    flex: 1,
    textAlign: "center",
    color: colors.clay,
    fontSize: type.size.micro,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
  },
  // Painted cells — now gently ROUNDED (Ting: round out the calendar edges so
  // it reads soft/consistent with the rounded cards). Each cell carries
  // radius.sm and a hairline margin so the washed pastel tiles read as soft
  // separated cells. The container keeps a slightly larger radius (radius.md)
  // so the whole grid block rounds too. overflow is dropped from the grid since
  // the cells no longer need clipping to a shared rounded boundary.
  grid: { borderRadius: radius.md },
  gridRow: { flexDirection: "row" },
  gridCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    margin: 1,
  },
  gridCellEmpty: { flex: 1, aspectRatio: 1, margin: 1 },
  gridDayText: {
    fontSize: type.size.body,
    color: colors.ink,
    fontFamily: type.label.family,
  },
  gridTodayText: { color: colors.paper, fontWeight: type.weight.semibold },
  gridTodayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper,
    marginTop: 2,
  },
  gridLogDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ink,
    marginTop: 2,
  },
  gridFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  gridFooterLeft: { fontSize: type.size.caption, fontFamily: type.body.family, color: colors.clay },
  gridFooterRight: { fontSize: type.size.caption, fontFamily: type.body.family, color: colors.clay },

  // --- Status card (vapor surface) — BC + no-data fallback only ---
  // LIST shadow tier (matches Workout/Food list cards) — {0,3}/.10/8/elev 3.
  // No overflow:hidden here, so the shadow is safe without a wrapper.
  statusCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: spacing.lg,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statusEyebrow: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.clay,
    marginBottom: spacing.xs,
  },
  statusPhaseSerif: {
    fontSize: type.size.title,
    fontFamily: type.display.family,
    color: colors.ink,
    letterSpacing: -1,
  },
  statusGuidance: {
    fontSize: type.size.body,
    fontFamily: type.body.family,
    color: colors.ink,
    marginTop: spacing.sm + 2,
    lineHeight: 22,
  },

  // --- Pattern card (vapor) — two columns ---
  // LIST shadow tier — cohesive lift with the other Cycle content cards. No
  // overflow:hidden, so the shadow is safe without a wrapper.
  patternCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: 18,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    flexDirection: "row",
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  patternCol: { flex: 1 },
  patternEyebrow: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.clay,
    marginBottom: spacing.sm,
  },
  patternValueRow: { flexDirection: "row", alignItems: "baseline" },
  patternBig: {
    fontSize: type.size.title,
    fontFamily: type.numeral.family,
    color: colors.ink,
    letterSpacing: -1,
  },
  patternBigMeta: { fontSize: type.size.callout, color: colors.clay },
  patternSub: { fontSize: type.size.caption, color: colors.clay, marginTop: 2 },
  patternLast: {
    fontSize: type.size.headline,
    fontFamily: type.label.family,
    color: colors.ink,
  },

  // --- Disclaimer (ED-safety / medical-advice) — centered, ink ---
  // Manrope regular (was italic serif). Color/size unchanged so it stays
  // LEGIBLE at `ink` (clay would fail WCAG AA at this size). Do not soften.
  disclaimer: {
    fontSize: type.size.caption,
    fontFamily: type.body.family,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing["2xl"],
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },

  // --- Editor modal ---
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "88%",
    // Reduced from spacing.lg so the new drag-handle pill (which carries its own
    // 8px top padding) sits where the other tabs' handles do, not pushed down.
    paddingTop: spacing.sm,
  },
  // Drag-handle pill — 36×4 camel grabber, matching the Food/Workout/Progress
  // sheets. Added so this sheet has the same swipe-to-dismiss affordance.
  dragHandleWrap: { alignItems: "center", paddingTop: spacing.sm, paddingBottom: spacing.xs },
  dragHandle: { width: 36, height: 4, backgroundColor: colors.handle, borderRadius: radius.pill },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  modalHeaderText: { flex: 1, paddingRight: spacing.md },
  // "THU · MAY 28 · CYCLE DAY 24" — clay small-caps, wide eyebrow tracking
  // (matches the screen header eyebrow voice).
  modalEyebrow: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.eyebrow,
    color: colors.inkMuted,
    // Lower the whole text stack on the sheet — pushes the eyebrow (and the
    // title/subtitle below it) down. The eyebrow→title gap is the title's own
    // marginTop and is intentionally left unchanged.
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  // Screen-title voice — large Manrope bold (was bold italic serif). Big
  // display header → bold + negative tracking. Keeps the existing uppercase
  // transform (this is a title, not a button — no tracked-uppercase rule).
  modalTitle: {
    fontSize: 48,
    lineHeight: 55,
    // Drop the title down so it sits lower on the sheet — gap below the eyebrow.
    marginTop: spacing.lg,
    fontFamily: type.display.family,
    color: colors.ink,
    letterSpacing: -1.5,
    // Lowercase so the editor title reads "today" (and "may 28"), not shouted caps.
    textTransform: "lowercase",
  },
  // Reassuring low-pressure subtitle — Manrope regular, clay.
  modalSubtitle: {
    fontSize: type.size.body,
    fontFamily: type.body.family,
    color: colors.inkMuted,
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  modalClose: { fontSize: 18, color: colors.inkMuted, fontWeight: "600", marginTop: spacing.xs },
  modalScroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing["3xl"] },
  // Section label — clay small-caps eyebrow, letter-spaced.
  editorSection: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.eyebrow,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  // Inline hint after a multi-select label ("· pick as many as fit"). Manrope
  // regular; letterSpacing reset to normal so the phrase doesn't inherit the
  // eyebrow tracking and read as spaced-out caps.
  editorSectionHint: {
    fontFamily: type.body.family,
    fontSize: type.size.caption,
    letterSpacing: type.tracking.normal,
    color: colors.inkMuted,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.chipRest,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: type.size.callout, color: colors.ink },
  chipTextActive: { color: colors.surface, fontWeight: "600" },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: type.size.body,
    fontFamily: type.body.family,
    color: colors.ink,
    minHeight: 84,
    textAlignVertical: "top",
  },
  saveBtn: {
    backgroundColor: ACCENT,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginTop: spacing["2xl"],
  },
  saveBtnText: { color: colors.surface, fontSize: type.size.body, fontWeight: "700" },
  // Reassuring low-pressure footer — Manrope regular clay, centered under Save.
  editorFooter: {
    fontSize: type.size.callout,
    fontFamily: type.body.family,
    color: colors.inkMuted,
    textAlign: "center",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  clearBtn: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.md },
  clearBtnText: { color: PERIOD, fontSize: 15, fontWeight: "600" },
});
