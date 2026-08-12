import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  Animated,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  Profile,
  WeekPlan,
  WeightEntry,
  BodyPhotoEntry,
  BodyCompEntry,
  BodyCompSource,
  BODY_COMP_SOURCE_LABELS,
  WEEKDAY_LABELS,
} from "../lib/types";
import {
  toISODate,
  parseISO,
  addDays,
  daysBetween,
  cycleStarts,
  cycleLengthSeries,
  observedCycleLength,
  nextPredictedPeriod,
  currentPhase,
  periodDays,
} from "../lib/cycle";
import { dayComplete } from "../lib/plan";
import { colors, type } from "../lib/theme";
import {
  Bars,
  AreaSpark,
  MoodTimeline,
  MoodLegend,
  MarkRow,
  CycleRings,
  WeekDots,
  ProgressBar,
  MiniCycle,
} from "../components/ProgressViz";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSwipeDismiss } from "../components/useSwipeDismiss";
import {
  MoodFamily,
  MOOD_FAMILY_LABEL,
  weekWindow,
  monthWindow,
  yearWindow,
  weekMovementByDay,
  weekLoggedDays,
  monthSessionsByWeek,
  yearSessionsByMonth,
  sessionsInWindow,
  minutesInWindow,
  moodFamiliesInWindow,
  dominantMood,
  bucketWeights,
  daysLoggedStats,
  earliestDataISO,
  allTimeSessionsByMonth,
  cycleRingPoints,
  type DateWindow,
} from "../lib/progress";

// Soft, clearly-lifted card shadow approximating the mockup's --soft recipe
// (0 1px 2px contact + 0 14px 30px -24px ambient, both warm cocoa). RN renders
// one layer, so we reproduce the *feel*: warm ink color, a clear downward
// offset, a large soft radius, and a low-but-visible opacity. Deeper than the
// previous flat pass, consistent with the house deep-card recipe (Cycle/Workout).
const SOFT_SHADOW = {
  shadowColor: colors.ink,
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.14,
  shadowRadius: 22,
  elevation: 6,
};

// Tighter variant of the same warm-soft recipe for smaller elevated elements
// (photo frames, totals tiles) so they lift cohesively without the full card
// depth — a smaller offset/radius, same warm ink tone.
const SOFT_SHADOW_SM = {
  shadowColor: colors.ink,
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 4,
};

type RangeView = "week" | "month" | "year" | "all";
const RANGE_VIEWS: RangeView[] = ["week", "month", "year", "all"];
const RANGE_LABELS: Record<RangeView, string> = {
  week: "Week",
  month: "Month",
  year: "Year",
  all: "All",
};

// Section eyebrow dot colors (mockup C map).
const DOT = {
  week: colors.profileSage,
  move: colors.calm,
  mood: colors.profileRose,
  body: colors.inkMuted,
  weight: colors.calm,
  cycle: colors.lut,
  all: colors.ink,
};

function rangeLabel(startISO: string): string {
  const a = parseISO(startISO);
  const b = parseISO(addDays(startISO, 6));
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(a)} – ${f(b)}`;
}

// --- Editorial section-eyebrow (mockup .secLabel) --------------------------
function SecLabel({ dot, label }: { dot: string; label: string }) {
  return (
    <View style={styles.secLabel}>
      <View style={[styles.secDot, { backgroundColor: dot }]} />
      <Text style={styles.secLabelText}>{label}</Text>
    </View>
  );
}

// --- Insight card shell (mockup card()) ------------------------------------
// headline + optional sub + optional chevron, optional viz body, optional
// divider+caption. onPress makes the whole card tappable (chevron affordance).
function InsightCard({
  headline,
  sub,
  chevron = true,
  onPress,
  children,
  caption,
}: {
  headline: string;
  sub?: string;
  chevron?: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
  caption?: React.ReactNode;
}) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.card} onPress={onPress} activeOpacity={onPress ? 0.85 : 1}>
      <View style={styles.ihead}>
        <View style={styles.flex}>
          <Text style={styles.ihl}>{headline}</Text>
          {sub ? <Text style={styles.isub}>{sub}</Text> : null}
        </View>
        {chevron ? <Text style={styles.chev}>›</Text> : null}
      </View>
      {children ? <View style={styles.ibody}>{children}</View> : null}
      {caption ? (
        <View style={styles.idiv}>
          <Text style={styles.icap}>{caption}</Text>
        </View>
      ) : null}
    </Wrapper>
  );
}

// --- Editorial photo frame (mockup .pframe) --------------------------------
// A real photo URI fills the frame when present; otherwise a warm placeholder
// tone. Grain/vignette overlays + optional "LATEST" tag, with a date caption.
function PhotoFrame({
  uri,
  date,
  tag,
  large,
  onPress,
}: {
  uri?: string;
  date: string;
  tag?: string;
  large?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.pcol} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.pframe, large && styles.pframeLg]}>
        {uri ? (
          <Image source={{ uri }} style={styles.pImg} resizeMode="cover" />
        ) : (
          <View style={[styles.pImg, styles.pPlaceholder]} />
        )}
        <View style={styles.pVignette} pointerEvents="none" />
        {tag ? (
          <View style={styles.pTag}>
            <Text style={styles.pTagText}>{tag}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.pcap}>{date}</Text>
    </TouchableOpacity>
  );
}

// --- 2x2 totals stat card (mockup .tcard) ----------------------------------
function TotalCard({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
}) {
  return (
    <View style={styles.tcard}>
      <Text style={styles.tk}>{label}</Text>
      <Text style={styles.tv}>
        {value}
        {unit ? <Text style={styles.tvSmall}>{unit}</Text> : null}
      </Text>
      <Text style={styles.td}>{detail}</Text>
    </View>
  );
}

// --- F3: Cycle look-back section (PRESERVED safety logic) ------------------
// Long-view answers (regularity, length, pattern over months). Distinct from
// CycleScreen's daily check-in surface. Two components: summary card and a
// cycle length chart. BC users skip the chart entirely — phase math doesn't
// apply on hormonal BC. The card visuals are re-skinned to the mockup but the
// BC branch, clinician note, and neutral (non-green/red) styling are UNCHANGED.

function monthShort(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: "short" });
}

function fullDate(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function renderCycleSection({
  profile,
  onJump,
}: {
  profile: Profile;
  onJump?: (day?: number) => void;
}) {
  const onBC = profile.onBirthControl;
  const starts = cycleStarts(profile);

  // --- Summary card data ---
  const observedCycles = Math.max(0, starts.length - 1);
  const obs = observedCycleLength(profile);
  const mostRecentStart = starts.length ? starts[starts.length - 1] : null;
  const currentCycleDay = !onBC && mostRecentStart ? currentPhase(profile).dayOfCycle : null;
  const pred = onBC ? null : nextPredictedPeriod(profile);

  const bleedDays = periodDays(profile).length;
  const mostRecentBleedStart = mostRecentStart;

  // --- Chart data (non-BC only) ---
  const lengthSeries = cycleLengthSeries(profile).slice(-6);
  const showChart = !onBC && lengthSeries.length >= 2;
  const chartAvg = lengthSeries.length
    ? Math.round(lengthSeries.reduce((a, b) => a + b.length, 0) / lengthSeries.length)
    : 0;
  // Soft clinician note: same single quiet line as F2's low-BF% note.
  const showClinicianNote = showChart && (chartAvg < 21 || chartAvg > 35);
  const chartMax = Math.max(1, ...lengthSeries.map((p) => p.length));

  return (
    <View>
      <SecLabel dot={DOT.cycle} label="CYCLE" />

      {/* 1. Summary card — tap jumps to the Cycle tab (current day passed). */}
      <TouchableOpacity
        style={styles.card}
        activeOpacity={onJump ? 0.85 : 1}
        onPress={onJump ? () => onJump(currentCycleDay ?? undefined) : undefined}
      >
        {onBC ? (
          <>
            <Text style={styles.cycleBcNote}>
              On hormonal birth control — phase math doesn't apply, but bleed and symptom patterns are still tracked here.
            </Text>
            <Text style={styles.cycleSummaryLine}>Bleed days logged: {bleedDays}</Text>
            {mostRecentBleedStart && (
              <Text style={styles.cycleSummaryLine}>
                Most recent bleed: started {fullDate(mostRecentBleedStart)}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.cycleSummaryLine}>Cycles tracked: {observedCycles}</Text>
            <Text style={styles.cycleSummaryLine}>
              Average length: {obs.length} days{" "}
              {observedCycles >= 1 && obs.fromHistory ? "(observed)" : "(default)"}
            </Text>
            {mostRecentStart && (
              <Text style={styles.cycleSummaryLine}>
                Most recent: started {fullDate(mostRecentStart)}
                {currentCycleDay ? `, day ${currentCycleDay}` : ""}
              </Text>
            )}
            {pred && (
              <Text style={styles.cycleSummaryLine}>
                Next period likely around {fullDate(pred.date)}
              </Text>
            )}
          </>
        )}
      </TouchableOpacity>

      {/* 2. Cycle length chart (non-BC, >=2 observed cycles) */}
      {showChart && (
        <View style={[styles.card, styles.cycleChartCard]}>
          <Text style={styles.cycleChartTitle}>Cycle length (last {lengthSeries.length})</Text>
          <View style={styles.cycleChartBox}>
            <View style={styles.cycleBarRow}>
              {lengthSeries.map((p, i) => (
                <View key={i} style={styles.cycleBarSlot}>
                  <View
                    style={[styles.cycleBar, { height: `${(p.length / chartMax) * 100}%` }]}
                  />
                </View>
              ))}
            </View>
            {/* Average reference line — subtle, no good/bad color. */}
            <View style={[styles.cycleAvgLine, { bottom: `${(chartAvg / chartMax) * 100}%` }]} />
          </View>
          <View style={styles.cycleBarLabelRow}>
            {lengthSeries.map((p, i) => (
              <Text key={i} style={styles.cycleBarLabel}>
                {monthShort(p.start)}
              </Text>
            ))}
          </View>
          <Text style={styles.cycleChartAvgText}>Average: {chartAvg} days</Text>
          {showClinicianNote && (
            <Text style={styles.cycleClinicianNote}>
              If you have questions about your cycle, your provider is the best resource.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function ProgressScreen({
  profile,
  updateProfile,
  onOpenSettings,
  onJumpToCycleDay,
  active = true,
}: {
  profile: Profile;
  // Shared updater (App.tsx): the weight-log transform runs against the LATEST
  // profile, so a concurrent write can't be clobbered by a stale snapshot.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  // Opens the Settings/Profile hub from the header avatar (same prop CoachScreen
  // receives). Wired in App.tsx to setTab("settings").
  onOpenSettings?: () => void;
  // Jumps to the Cycle tab. There is no cross-tab "deep-link to day N" signal in
  // the app yet, so the minimal correct behavior is just switching tabs (the day
  // is passed for future use). Wired in App.tsx to setTab("cycle").
  onJumpToCycleDay?: (day?: number) => void;
  // True only while Progress is the visible tab. App.tsx keeps every screen
  // mounted and toggles inactive ones to display:none. A <Modal> nested inside a
  // subtree that flips to display:none after the modal was shown strands its
  // native host view (RCTModalHostView) on top of Progress — it keeps eating
  // touches so the page renders but ignores taps ("frozen"). visible={false}
  // does NOT tear that host down in this situation; only a real React unmount
  // does. So we GATE every Modal on `active` (absent from the tree when Progress
  // is hidden) and force-close all sheet state when active flips false. Mirrors
  // the established FoodScreen fix. Defaults true so the screen still works if
  // mounted without the prop.
  active?: boolean;
}) {
  const today = toISODate(new Date());
  const plan = profile.plan;
  const current = plan?.current ?? null;

  // Weight log (optional). Day-to-day points are ED-unsafe to plot, so the
  // headline + sparkline below use weekly/monthly AVERAGES (see bucketWeights).
  const weights = useMemo(
    () => [...(profile.weightLog ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1)),
    [profile.weightLog]
  );

  // --- Range + date-nav state ----------------------------------------------
  const [view, setView] = useState<RangeView>("week");
  // `off` is the range-step offset (0 = current period, 1 = previous, …). The
  // ‹ › buttons step it; it never goes negative, so we never look at the future.
  const [off, setOff] = useState(0);

  const [viewWeek, setViewWeek] = useState<WeekPlan | null>(null);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighVal, setWeighVal] = useState("");

  // --- Feature F1: photo timeline state ------------------------------------
  const photoLog = useMemo<BodyPhotoEntry[]>(
    () => [...(profile.photoLog ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1)),
    [profile.photoLog]
  );
  const latestPhoto: BodyPhotoEntry | null = photoLog.length ? photoLog[photoLog.length - 1] : null;
  // Newest-first older frames for the horizontal timeline (excludes latest).
  const olderPhotos = photoLog.length > 1 ? photoLog.slice(0, -1).reverse() : [];

  // 4-week banner trigger (PRESERVED logic).
  const bannerVisible = (() => {
    if (!latestPhoto) {
      if (!profile.photoBannerDismissedAt) return true;
      return false;
    }
    const ageDays = daysBetween(latestPhoto.date, today);
    if (ageDays < 28) return false;
    const dismissed = profile.photoBannerDismissedAt;
    if (!dismissed) return true;
    const dismissedDate = dismissed.slice(0, 10);
    if (dismissedDate < latestPhoto.date) return true;
    return daysBetween(dismissedDate, today) >= 28;
  })();
  const bannerWeeks = latestPhoto ? Math.max(4, Math.round(daysBetween(latestPhoto.date, today) / 7)) : 0;

  const [detailEntry, setDetailEntry] = useState<BodyPhotoEntry | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newFrontUri, setNewFrontUri] = useState<string | null>(null);
  const [newSideUri, setNewSideUri] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [newSaving, setNewSaving] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareWithId, setCompareWithId] = useState<string | null>(null);
  const compareLeft: BodyPhotoEntry | null = (() => {
    if (!compareOpen || photoLog.length < 2) return null;
    const byId = compareWithId ? photoLog.find((e) => e.id === compareWithId) : null;
    if (byId && byId.id !== latestPhoto?.id) return byId;
    return photoLog[photoLog.length - 2];
  })();

  async function pickNewPhoto(slot: "front" | "side", source: "camera" | "library") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Allow camera access to add a photo.");
          return;
        }
      }
      const opts = { mediaTypes: "images" as const };
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      if (slot === "front") setNewFrontUri(asset.uri);
      else setNewSideUri(asset.uri);
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  function offerPickNew(slot: "front" | "side") {
    const title = slot === "front" ? "Add a front photo" : "Add a side photo";
    Alert.alert(title, "Same pose, same light works best.", [
      { text: "Take photo", onPress: () => void pickNewPhoto(slot, "camera") },
      { text: "Choose from library", onPress: () => void pickNewPhoto(slot, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function resetNewSheet() {
    setNewFrontUri(null);
    setNewSideUri(null);
    setNewNote("");
  }

  async function saveNewPhoto() {
    if (!newFrontUri) return;
    setNewSaving(true);
    const entry: BodyPhotoEntry = {
      id: `photo-${Date.now()}`,
      date: today,
      frontUri: newFrontUri,
      sideUri: newSideUri ?? undefined,
      note: newNote.trim() ? newNote.trim() : undefined,
    };
    try {
      await updateProfile((p) => {
        const next = [...(p.photoLog ?? []), entry];
        return { ...p, photoLog: next };
      });
    } finally {
      setNewSaving(false);
      resetNewSheet();
      setNewOpen(false);
    }
  }

  function dismissBanner() {
    void updateProfile((p) => ({ ...p, photoBannerDismissedAt: new Date().toISOString() }));
  }

  function deleteEntry(id: string) {
    Alert.alert(
      "Delete this entry?",
      "The photos and note for this date will be removed from your timeline.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void updateProfile((p) => ({
              ...p,
              photoLog: (p.photoLog ?? []).filter((e) => e.id !== id),
            }));
            setDetailEntry(null);
          },
        },
      ]
    );
  }

  function openCompareFromDetail() {
    if (!latestPhoto || photoLog.length < 2) return;
    setCompareWithId(null);
    setDetailEntry(null);
    setCompareOpen(true);
  }

  function photoDateLabel(iso: string): string {
    return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function photoDateShort(iso: string): string {
    return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // --- Feature F2: body-composition scan log (PRESERVED safety logic) ------
  const bodyCompLog = useMemo<BodyCompEntry[]>(
    () => [...(profile.bodyCompLog ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1)),
    [profile.bodyCompLog]
  );
  const latestComp: BodyCompEntry | null = bodyCompLog.length
    ? bodyCompLog[bodyCompLog.length - 1]
    : null;
  const previousComp: BodyCompEntry | null =
    bodyCompLog.length >= 2 ? bodyCompLog[bodyCompLog.length - 2] : null;
  const olderComp: BodyCompEntry[] = bodyCompLog.length > 1 ? bodyCompLog.slice(0, -1).reverse() : [];

  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  const [scanSaving, setScanSaving] = useState(false);
  const [scanSource, setScanSource] = useState<BodyCompSource>("dexa");
  const [scanBf, setScanBf] = useState("");
  const [scanLean, setScanLean] = useState("");
  const [scanMuscle, setScanMuscle] = useState("");
  const [scanNote, setScanNote] = useState("");
  const [compDetailEntry, setCompDetailEntry] = useState<BodyCompEntry | null>(null);

  // Swipe-down-to-dismiss for every bottom sheet. Grab zone = handle + header.
  // Pure RN PanResponder/Animated, no native dep.
  const weekSwipe = useSwipeDismiss({ visible: !!viewWeek, onClose: () => setViewWeek(null) });
  const detailSwipe = useSwipeDismiss({ visible: !!detailEntry, onClose: () => setDetailEntry(null) });
  // New-photos + scan sheets guard their close while saving (mirrors the × button).
  const newSwipe = useSwipeDismiss({
    visible: newOpen,
    onClose: () => {
      if (newSaving) return;
      resetNewSheet();
      setNewOpen(false);
    },
  });
  const compareSwipe = useSwipeDismiss({ visible: compareOpen, onClose: () => setCompareOpen(false) });
  const compDetailSwipe = useSwipeDismiss({ visible: !!compDetailEntry, onClose: () => setCompDetailEntry(null) });
  const scanSwipe = useSwipeDismiss({
    visible: scanSheetOpen,
    onClose: () => {
      if (scanSaving) return;
      resetScanSheet();
      setScanSheetOpen(false);
    },
  });
  const weighSwipe = useSwipeDismiss({ visible: weighOpen, onClose: () => setWeighOpen(false) });

  function resetScanSheet() {
    setScanSource("dexa");
    setScanBf("");
    setScanLean("");
    setScanMuscle("");
    setScanNote("");
  }

  async function saveScan() {
    const parseNum = (s: string): number | undefined => {
      const v = parseFloat(s);
      return isNaN(v) ? undefined : Math.round(v * 10) / 10;
    };
    const bf = parseNum(scanBf);
    const lean = parseNum(scanLean);
    const muscle = parseNum(scanMuscle);
    if (bf == null && lean == null && muscle == null) {
      return;
    }
    setScanSaving(true);
    const entry: BodyCompEntry = {
      id: `bc-${Date.now()}`,
      date: today,
      source: scanSource,
      bodyFatPct: bf,
      leanMassLbs: lean,
      muscleMassLbs: muscle,
      note: scanNote.trim() ? scanNote.trim() : undefined,
    };
    try {
      await updateProfile((p) => ({
        ...p,
        bodyCompLog: [...(p.bodyCompLog ?? []), entry],
      }));
    } finally {
      setScanSaving(false);
      resetScanSheet();
      setScanSheetOpen(false);
    }
  }

  function deleteScan(id: string) {
    Alert.alert("Delete this scan?", "The body-composition entry for this date will be removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void updateProfile((p) => ({
            ...p,
            bodyCompLog: (p.bodyCompLog ?? []).filter((e) => e.id !== id),
          }));
          setCompDetailEntry(null);
        },
      },
    ]);
  }

  // Plain factual delta — NO arrows, NO color-coding (ED-safety). Neutral.
  function bfDeltaLine(): string {
    if (!latestComp || !previousComp) return "";
    if (typeof latestComp.bodyFatPct !== "number" || typeof previousComp.bodyFatPct !== "number") {
      return "";
    }
    const delta = latestComp.bodyFatPct - previousComp.bodyFatPct;
    const sign = delta >= 0 ? "+" : "-";
    const mag = Math.abs(Math.round(delta * 10) / 10);
    const prevLabel = parseISO(previousComp.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${sign}${mag}% from ${prevLabel}`;
  }

  function compDateLabel(iso: string): string {
    return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  async function logWeight() {
    const lbs = parseFloat(weighVal);
    if (!lbs || lbs <= 0) return;
    const rounded = Math.round(lbs * 10) / 10;
    await updateProfile((p) => {
      const rest = (p.weightLog ?? []).filter((w) => w.date !== today);
      const next: WeightEntry[] = [...rest, { date: today, lbs: rounded }].sort((a, b) =>
        a.date < b.date ? -1 : 1
      );
      return { ...p, weightLog: next };
    });
    setWeighVal("");
    setWeighOpen(false);
  }

  // When Progress stops being the active tab, force every sheet/modal closed.
  // Two reasons: (1) it guarantees the active-gated Modals below are absent from
  // the tree while Progress is hidden (so no native modal host can be stranded
  // on top of Progress and eat touches when we come back), and (2) reactivating
  // Progress never re-shows a stale sheet. Only runs on the false transition;
  // reopening is always user-driven. Lists EVERY modal-open state var by its
  // real name. Mirrors the FoodScreen blur-effect.
  useEffect(() => {
    if (active) return;
    setViewWeek(null);
    setDetailEntry(null);
    setNewOpen(false);
    setCompareOpen(false);
    setCompDetailEntry(null);
    setScanSheetOpen(false);
    setWeighOpen(false);
  }, [active]);

  // Header avatar initials (mockup top-right). Falls back to bird glyph.
  const initials = (profile.name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  // --- Per-view body content -----------------------------------------------
  // The body is a list of section cards whose SET differs by view (mockup
  // weekView/monthView/yearView/allView). All series are real, derived from the
  // profile against the selected view + `off` window.

  // The active date window for the selected view + offset. "all" has no window
  // (it aggregates over everything), so we reuse a sentinel that callers ignore.
  const win: DateWindow =
    view === "week"
      ? weekWindow(today, off)
      : view === "month"
        ? monthWindow(today, off)
        : view === "year"
          ? yearWindow(today, off)
          : { start: earliestDataISO(profile) ?? today, end: today };

  function moveDate(d: number) {
    setOff((o) => Math.max(0, o + d));
  }

  // The body section that carries the real F1/F2/F3/weight features. Shown in
  // every view so the safety surfaces are always reachable. The view-specific
  // summary cards (this-week/month/year/all + movement + mood + cycle rings)
  // sit ABOVE this, matching the mockup's per-view card sets.
  function realFeatureSections() {
    return (
      <>
        {/* BODY — editorial photo timeline (F1) + body-composition (F2) */}
        <SecLabel dot={DOT.body} label="BODY" />

        {bannerVisible && (
          <View style={styles.photoBanner}>
            <Text style={styles.photoBannerText}>
              {latestPhoto
                ? `It's been ~${bannerWeeks} weeks since your last photos. Same pose, same light — add a new set to keep the timeline going.`
                : "Same pose, same light. Add your first set to see direction over time."}
            </Text>
            <TouchableOpacity onPress={dismissBanner} hitSlop={10}>
              <Text style={styles.photoBannerDismiss}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.ihead}>
            <View style={styles.flex}>
              <Text style={styles.ihl}>{latestPhoto ? "Your photos" : "No photos yet"}</Text>
              <Text style={styles.isub}>
                {latestPhoto
                  ? `progress photos · latest ${photoDateShort(latestPhoto.date)}`
                  : "progress photos · same pose, same light"}
              </Text>
            </View>
          </View>

          {/* Horizontal photo timeline — real frames; Add slot opens new sheet */}
          <View style={styles.ibody}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ptl}
            >
              {latestPhoto && (
                <PhotoFrame
                  uri={latestPhoto.frontUri ?? latestPhoto.sideUri}
                  date={photoDateShort(latestPhoto.date)}
                  tag="LATEST"
                  large
                  onPress={() => setDetailEntry(latestPhoto)}
                />
              )}
              {olderPhotos.map((e) => (
                <PhotoFrame
                  key={e.id}
                  uri={e.frontUri ?? e.sideUri}
                  date={photoDateShort(e.date)}
                  onPress={() => setDetailEntry(e)}
                />
              ))}
              {/* Dashed Add slot */}
              <TouchableOpacity style={styles.pcol} onPress={() => setNewOpen(true)} activeOpacity={0.85}>
                <View style={styles.padd}>
                  <View style={styles.paddPlus}>
                    <Text style={styles.paddPlusText}>＋</Text>
                  </View>
                </View>
                <Text style={[styles.pcap, styles.pcapMuted]}>Add</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Body composition row — neutral pill, no good/bad framing (F2) */}
            <TouchableOpacity
              style={styles.statrow}
              onPress={() => (latestComp ? setCompDetailEntry(latestComp) : setScanSheetOpen(true))}
              activeOpacity={0.85}
            >
              <View style={styles.flex}>
                <Text style={styles.sk}>Body composition</Text>
                {latestComp ? (
                  <Text style={styles.skd}>
                    {BODY_COMP_SOURCE_LABELS[latestComp.source]}
                    {typeof latestComp.bodyFatPct === "number"
                      ? ` · ${Math.round(latestComp.bodyFatPct * 10) / 10}%`
                      : ""}
                    {` · ${compDateLabel(latestComp.date)}`}
                  </Text>
                ) : (
                  <Text style={styles.skd}>Log a DEXA or InBody scan to track body composition.</Text>
                )}
              </View>
              {bfDeltaLine() ? (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{bfDeltaLine()}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setScanSheetOpen(true)} hitSlop={8}>
              <Text style={styles.link}>＋ Log scan</Text>
            </TouchableOpacity>
          </View>

          {/* ED-safety caption — preserved verbatim, legible cocoaSoft body */}
          <View style={styles.idiv}>
            <Text style={styles.icap}>
              Same pose, same light each time. Tap any two to compare — photos read direction better than the scale, and your Coach uses them to guide the plan, never as a verdict.
            </Text>
          </View>
        </View>

        {/* CYCLE look-back (F3) — preserved BC branch + clinician note. Hidden
            entirely when cycle tracking is off (no cycle surface anywhere). */}
        {currentPhase(profile).phase !== "off" &&
          renderCycleSection({ profile, onJump: onJumpToCycleDay })}

        {/* WEIGHT (optional) — ED-safety: averaged ONLY, never day-to-day. */}
        {(() => {
          // Cadence follows the view: weekly buckets in week/month, monthly in
          // year/all. The sparkline plots ONLY bucket averages (never raw days).
          const cadence: "weekly" | "monthly" =
            view === "year" || view === "all" ? "monthly" : "weekly";
          const buckets = bucketWeights(profile, cadence);
          const cadenceWord = cadence === "weekly" ? "weekly" : "monthly";
          // Range delta = last bucket avg − first bucket avg (softly phrased).
          const delta =
            buckets.length >= 2 ? buckets[buckets.length - 1].avg - buckets[0].avg : null;
          const currentAvg = buckets.length ? buckets[buckets.length - 1].avg : null;
          // Headline is a NON-VALENCED trend phrase, never the number and never
          // a magnitude. ED-safety: the down and up phrases are equally calm —
          // neither frames a direction as good or bad. A ±1.5 lb dead-band lets
          // normal water/phase fluctuation read as "Holding steady".
          const DEAD_BAND = 1.5;
          const headline =
            buckets.length === 0
              ? `Start your ${cadenceWord} average`
              : delta == null
                ? `Your ${cadenceWord} average` // single bucket: a trend is meaningless
                : Math.abs(delta) <= DEAD_BAND
                  ? "Holding steady"
                  : delta < 0
                    ? "Easing down"
                    : "Easing up";
          // Subtext mirrors the mockup: "149 lb · weekly average" — current
          // average only, no magnitude/delta phrasing.
          const sub =
            buckets.length === 0
              ? "add today's weight to begin"
              : `${currentAvg} lb · ${cadenceWord} average`;
          return (
            <>
              <SecLabel dot={DOT.weight} label="WEIGHT" />
              <InsightCard
                headline={headline}
                sub={sub}
                chevron={buckets.length > 0}
                onPress={buckets.length > 0 ? () => setWeighOpen(true) : undefined}
                caption={
                  <Text style={styles.icap}>
                    Shown as a {cadenceWord} average, alongside your cycle — never day to day, since daily weight bounces with water and phase. You decide if this is useful; Wren works fine without it.
                  </Text>
                }
              >
                {/* Two+ buckets → a smoothed average sparkline. A single bucket
                    shows its average as plain text, never a misleading 1-point
                    "trend". No buckets → nothing but the log link. */}
                {buckets.length >= 2 ? (
                  <AreaSpark data={buckets.map((b) => b.avg)} accent={colors.calm} />
                ) : buckets.length === 1 ? (
                  <Text style={styles.weightSingle}>
                    {buckets[0].avg} lb {cadenceWord} average · log a few more to see the trend
                  </Text>
                ) : null}
                <TouchableOpacity onPress={() => setWeighOpen(true)} hitSlop={8}>
                  <Text style={[styles.link, { marginTop: buckets.length >= 2 ? 14 : 4 }]}>＋ Log weight</Text>
                </TouchableOpacity>
              </InsightCard>
            </>
          );
        })()}
      </>
    );
  }

  // Mood card: real timeline + an honest "mostly X" headline, or an empty
  // state when nothing was logged in the window. `marks` labels the x-axis.
  function moodCard(families: (MoodFamily | null)[], marks: string[]) {
    const dom = dominantMood(families);
    return (
      <>
        <SecLabel dot={DOT.mood} label="MOOD" />
        {dom ? (
          <InsightCard
            headline={`mostly ${MOOD_FAMILY_LABEL[dom.family]}`}
            sub={`${dom.logged} ${dom.logged === 1 ? "day" : "days"} logged`}
            chevron={false}
          >
            <MoodTimeline days={families} />
            <MarkRow marks={marks} />
            <MoodLegend />
          </InsightCard>
        ) : (
          <InsightCard
            headline="No moods logged yet"
            sub="log how you feel on the Cycle tab"
            chevron={false}
          />
        )}
      </>
    );
  }

  // Real cycle-rings card, or — on BC / no observed cycles — nothing here (the
  // BC-safe look-back card in realFeatureSections is the single cycle surface).
  function cycleRingsCard() {
    const rings = cycleRingPoints(profile);
    if (!rings.length) return null;
    const avg = Math.round(rings.reduce((a, r) => a + r.day, 0) / rings.length);
    return (
      <>
        <SecLabel dot={DOT.cycle} label="CYCLE" />
        <InsightCard
          headline={`${avg} days`}
          sub={`average across ${rings.length} ${rings.length === 1 ? "cycle" : "cycles"}`}
          onPress={onJumpToCycleDay ? () => onJumpToCycleDay() : undefined}
        >
          <CycleRings cycles={rings as MiniCycle[]} />
        </InsightCard>
      </>
    );
  }

  function weekViewSummary() {
    const moveMins = weekMovementByDay(profile, win);
    const logged = weekLoggedDays(profile, win);
    const done = logged.filter(Boolean).length;
    const tot = moveMins.reduce((a, b) => a + b, 0);
    const families = moodFamiliesInWindow(profile, win);
    // Mon-anchored windows; mockup labels read S M T W T F S but our weeks start
    // Monday — label accordingly so the dots line up with the right days.
    const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];
    // CYCLE card: only the CURRENT week, non-BC, with a known phase may show a
    // day number. Never leak "day N" on BC / unknown phase / a past week.
    const phase = currentPhase(profile);
    // "off" (tracking disabled) is excluded everywhere here so no cycle card,
    // headline, or day number renders on Progress when she's turned it off.
    const cycleOff = phase.phase === "off";
    const showPhaseDay =
      off === 0 &&
      !cycleOff &&
      !profile.onBirthControl &&
      phase.dayOfCycle != null &&
      phase.phase !== "unknown";

    return (
      <>
        <SecLabel dot={DOT.week} label="THIS WEEK" />
        <InsightCard
          headline={`${done} ${done === 1 ? "session" : "sessions"}`}
          sub={rangeLabel(win.start)}
          chevron={false}
          caption={
            <Text style={styles.icap}>
              {tot > 0 ? (
                <>
                  <Text style={styles.icapB}>{tot} minutes</Text> moving across {done}{" "}
                  {done === 1 ? "day" : "days"}. Rest days are part of the plan, not a gap.
                </>
              ) : (
                <>No sessions logged this week yet — and that's allowed. Rest counts too.</>
              )}
            </Text>
          }
        >
          <WeekDots logged={logged} labels={dayLabels} />
        </InsightCard>

        <SecLabel dot={DOT.move} label="MOVEMENT" />
        <InsightCard headline={`${tot} minutes`} sub="active · by day" chevron={false}>
          <Bars data={moveMins} labels={dayLabels} curIdx={-1} />
        </InsightCard>

        {moodCard(families, dayLabels)}

        {(showPhaseDay || (!cycleOff && !profile.onBirthControl && phase.phase !== "unknown")) && (
          <>
            <SecLabel dot={DOT.cycle} label="CYCLE" />
            <InsightCard
              headline={showPhaseDay ? `${phase.phase} · day ${phase.dayOfCycle}` : phase.phase}
              sub="this week"
              onPress={
                onJumpToCycleDay ? () => onJumpToCycleDay(phase.dayOfCycle ?? undefined) : undefined
              }
            />
          </>
        )}
      </>
    );
  }

  function monthViewSummary() {
    const weeks = monthSessionsByWeek(profile, win);
    const sessions = sessionsInWindow(profile, win);
    const families = moodFamiliesInWindow(profile, win);
    const weekLabels = weeks.map((_, i) => `W${i + 1}`);
    return (
      <>
        <SecLabel dot={DOT.week} label="THIS MONTH" />
        <InsightCard
          headline={`${sessions} ${sessions === 1 ? "session" : "sessions"}`}
          sub="this month"
          chevron={false}
          caption={
            <Text style={styles.icap}>
              {sessions > 0 ? (
                <>
                  You trained <Text style={styles.icapB}>{sessions} times</Text> this month — about{" "}
                  {(sessions / Math.max(1, weeks.length)).toFixed(1)} a week. Steady is the goal, not maximal.
                </>
              ) : (
                <>Nothing logged this month yet. Log a session and it'll show up here.</>
              )}
            </Text>
          }
        >
          <Bars data={weeks} labels={weekLabels} curIdx={-1} />
        </InsightCard>

        {moodCard(families, weekLabels)}

        {cycleRingsCard()}
      </>
    );
  }

  function yearViewSummary() {
    const months = yearSessionsByMonth(profile, win);
    const sessions = months.reduce((a, b) => a + b, 0);
    return (
      <>
        <SecLabel dot={DOT.week} label="THIS YEAR" />
        <InsightCard
          headline={`${sessions} ${sessions === 1 ? "session" : "sessions"}`}
          sub={sessions > 0 ? `${(sessions / 12).toFixed(1)} a week on average` : "this year"}
          chevron={false}
          caption={
            <Text style={styles.icap}>
              {sessions > 0 ? (
                <>
                  <Text style={styles.icapB}>{sessions} sessions</Text> this year. Consistency over months
                  is the whole game — dips are expected, not failures.
                </>
              ) : (
                <>Nothing logged this year yet. It builds up one session at a time.</>
              )}
            </Text>
          }
        >
          <Bars
            data={months}
            labels={["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"]}
            curIdx={-1}
          />
        </InsightCard>

        {cycleRingsCard()}
      </>
    );
  }

  function allViewSummary() {
    const allWin: DateWindow = { start: earliestDataISO(profile) ?? today, end: today };
    const sessions = sessionsInWindow(profile, allWin);
    const rings = cycleRingPoints(profile);
    const cyclesTracked = Math.max(0, cycleStarts(profile).length - 1);
    const cycleAvg = rings.length
      ? Math.round(rings.reduce((a, r) => a + r.day, 0) / rings.length)
      : null;
    const dl = daysLoggedStats(profile, today);
    const mb = bucketWeights(profile, "monthly");
    const weightDelta = mb.length >= 2 ? mb[mb.length - 1].avg - mb[0].avg : null;
    const series = allTimeSessionsByMonth(profile, today);
    const first = earliestDataISO(profile);
    const sinceLabel = first
      ? parseISO(first).toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : "—";

    return (
      <>
        <SecLabel dot={DOT.all} label={`ALL TIME · SINCE ${sinceLabel.toUpperCase()}`} />
        <View style={styles.grid2}>
          <TotalCard
            label="Sessions"
            value={String(sessions)}
            detail={first ? `since ${sinceLabel}` : "none logged yet"}
          />
          <TotalCard
            label="Cycles"
            value={String(cyclesTracked)}
            detail={cycleAvg != null ? `~${cycleAvg} day average` : "tracked"}
          />
          <TotalCard
            label="Days logged"
            value={dl ? String(dl.pct) : "0"}
            unit="%"
            detail={dl ? `${dl.logged} of ${dl.span} days` : "of all days"}
          />
          <TotalCard
            label="Weight"
            value={weightDelta != null ? `${weightDelta <= 0 ? "−" : "+"}${Math.abs(Math.round(weightDelta * 10) / 10)}` : "—"}
            unit={weightDelta != null ? " lb" : undefined}
            detail={weightDelta != null ? "monthly average" : "log to begin"}
          />
        </View>

        {series.data.length >= 2 && (
          <>
            <SecLabel dot={DOT.move} label="MOVEMENT" />
            <InsightCard
              headline={sessions > 0 ? `${sessions} sessions` : "Nothing logged yet"}
              sub="sessions · by month"
              chevron={false}
              caption={
                sessions > 0 ? (
                  <Text style={styles.icap}>
                    <Text style={styles.icapB}>{sessions} sessions</Text> and counting. Consistency, not
                    intensity — exactly the point.
                  </Text>
                ) : undefined
              }
            >
              <Bars data={series.data} labels={series.labels} curIdx={series.data.length - 1} />
            </InsightCard>
          </>
        )}

        {cycleRingsCard()}
      </>
    );
  }

  const summary =
    view === "week"
      ? weekViewSummary()
      : view === "month"
        ? monthViewSummary()
        : view === "year"
          ? yearViewSummary()
          : allViewSummary();

  // Real date-nav label, derived from the active window / offset. "All" shows
  // the real "since <first-data month>"; the others show the window span.
  const earliestAll = earliestDataISO(profile);
  const allSinceLabel = earliestAll
    ? parseISO(earliestAll).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "the start";
  const navLabel =
    view === "all"
      ? `All time · since ${allSinceLabel}`
      : view === "year"
        ? String(parseISO(win.start).getFullYear())
        : view === "month"
          ? parseISO(win.start).toLocaleDateString(undefined, { month: "long", year: "numeric" })
          : rangeLabel(win.start);

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.page} contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.head}>
          <View>
            <Text style={styles.eyebrow}>YOUR ARC</Text>
            <Text style={styles.h1}>progress</Text>
          </View>
          <TouchableOpacity
            style={styles.avatar}
            onPress={onOpenSettings}
            activeOpacity={0.85}
            hitSlop={8}
          >
            {profile.profilePhotoUri ? (
              <Image source={{ uri: profile.profilePhotoUri }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarInitials}>{initials || "🐦"}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Range segmented pill */}
        <View style={styles.range}>
          {RANGE_VIEWS.map((v) => {
            const on = v === view;
            return (
              <TouchableOpacity
                key={v}
                style={[styles.rangeBtn, on && styles.rangeBtnOn]}
                onPress={() => {
                  setView(v);
                  setOff(0);
                }}
                activeOpacity={0.85}
              >
                <Text style={[styles.rangeText, on && styles.rangeTextOn]}>{RANGE_LABELS[v]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Date-nav */}
        <View style={styles.datenav}>
          {view === "all" ? (
            <Text style={styles.navLabelCenter}>{navLabel}</Text>
          ) : (
            <>
              <TouchableOpacity style={styles.navBtn} onPress={() => moveDate(1)} activeOpacity={0.7}>
                <Text style={styles.navBtnText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.navLabel}>{navLabel}</Text>
              <TouchableOpacity
                style={[styles.navBtn, off === 0 && styles.navBtnDisabled]}
                onPress={() => off !== 0 && moveDate(-1)}
                disabled={off === 0}
                activeOpacity={0.7}
              >
                <Text style={styles.navBtnText}>›</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Body — per-view summary cards, then the real feature sections */}
        {summary}
        {realFeatureSections()}
      </ScrollView>

      {/* All sheets below are gated on `active` so they're fully unmounted (not
          just visible={false}) whenever Progress isn't the visible tab,
          preventing a native modal host from being stranded on top of Progress
          and eating touches. Mirrors the established FoodScreen fix. */}
      {active && (
      <>
      {/* View a past week */}
      <Modal visible={!!viewWeek} animationType="slide" transparent onRequestClose={() => setViewWeek(null)}>
        {/* Per-Modal GestureHandlerRootView: a core RN Modal's children live in a
            separate native view tree not under the app-root provider, so in-Modal
            gestures need their own root here or they silently do nothing. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <GestureDetector gesture={weekSwipe.gesture}>
          <Animated.View style={[styles.sheet, weekSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {viewWeek ? `Week ${viewWeek.weekNumber} · ${viewWeek.programName}` : ""}
                </Text>
                <TouchableOpacity onPress={() => setViewWeek(null)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...weekSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll}>
              {(viewWeek?.days ?? []).map((d) => (
                <View key={d.weekday} style={styles.vwDay}>
                  <Text style={styles.vwDayName}>{WEEKDAY_LABELS[d.weekday]}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.vwTitle}>
                      {d.title}
                      {dayComplete(d) ? "  ✓" : ""}
                    </Text>
                    {d.kind === "strength"
                      ? (d.sections ?? []).flatMap((s) => s.exercises).map((e) => (
                          <Text key={e.id} style={styles.vwEx}>
                            {e.name}
                            {e.sets != null && e.reps ? `: ${e.sets} × ${e.reps}` : ""}
                            {e.weight != null ? ` @ ${e.weight} lb` : ""}
                          </Text>
                        ))
                      : d.kind !== "rest" && (d.activity || d.durationMin) ? (
                          <Text style={styles.vwEx}>
                            {[d.activity, d.durationMin ? `${d.durationMin} min` : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        ) : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* Photo detail */}
      <Modal visible={!!detailEntry} animationType="slide" transparent onRequestClose={() => setDetailEntry(null)}>
        {/* Per-Modal GestureHandlerRootView — see week-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <GestureDetector gesture={detailSwipe.gesture}>
          <Animated.View style={[styles.sheet, detailSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{detailEntry ? photoDateLabel(detailEntry.date) : ""}</Text>
                <TouchableOpacity onPress={() => setDetailEntry(null)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...detailSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll}>
              {detailEntry?.frontUri && (
                <Image source={{ uri: detailEntry.frontUri }} style={styles.detailPhoto} resizeMode="cover" />
              )}
              {detailEntry?.sideUri && (
                <Image source={{ uri: detailEntry.sideUri }} style={styles.detailPhoto} resizeMode="cover" />
              )}
              {detailEntry?.note ? <Text style={styles.detailNote}>{detailEntry.note}</Text> : null}
              {photoLog.length >= 2 && detailEntry?.id === latestPhoto?.id && (
                <TouchableOpacity style={styles.compareBtn} onPress={openCompareFromDetail}>
                  <Text style={styles.compareBtnText}>Compare with earlier…</Text>
                </TouchableOpacity>
              )}
              {detailEntry && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteEntry(detailEntry.id)}>
                  <Text style={styles.deleteBtnText}>Delete this entry</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* New photos sheet */}
      <Modal
        visible={newOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!newSaving) {
            resetNewSheet();
            setNewOpen(false);
          }
        }}
      >
        {/* Per-Modal GestureHandlerRootView — see week-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={newSwipe.gesture}>
          <Animated.View style={[styles.sheet, newSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>New photos</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (newSaving) return;
                    resetNewSheet();
                    setNewOpen(false);
                  }}
                  hitSlop={10}
                >
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...newSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll}>
              <Text style={styles.fieldLabel}>Front photo</Text>
              {newFrontUri ? (
                <View style={styles.photoSlotFilled}>
                  <Image source={{ uri: newFrontUri }} style={styles.newSheetThumb} />
                  <View style={styles.photoSlotActions}>
                    <TouchableOpacity style={styles.photoSlotBtn} onPress={() => offerPickNew("front")}>
                      <Text style={styles.photoSlotBtnText}>Replace</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.photoSlotBtn} onPress={() => setNewFrontUri(null)}>
                      <Text style={styles.photoSlotBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoSlotEmpty} onPress={() => offerPickNew("front")}>
                  <Text style={styles.photoSlotEmptyText}>Tap to add a front photo</Text>
                </TouchableOpacity>
              )}

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Side photo (optional)</Text>
              {newSideUri ? (
                <View style={styles.photoSlotFilled}>
                  <Image source={{ uri: newSideUri }} style={styles.newSheetThumb} />
                  <View style={styles.photoSlotActions}>
                    <TouchableOpacity style={styles.photoSlotBtn} onPress={() => offerPickNew("side")}>
                      <Text style={styles.photoSlotBtnText}>Replace</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.photoSlotBtn} onPress={() => setNewSideUri(null)}>
                      <Text style={styles.photoSlotBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoSlotEmpty} onPress={() => offerPickNew("side")}>
                  <Text style={styles.photoSlotEmptyText}>Tap to add a side photo · optional</Text>
                </TouchableOpacity>
              )}

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Note (optional)</Text>
              <TextInput
                style={styles.noteInput}
                value={newNote}
                onChangeText={setNewNote}
                placeholder="Anything you want to remember about today"
                placeholderTextColor={colors.inkMuted}
                multiline
              />

              <TouchableOpacity
                style={[styles.saveBtn, (!newFrontUri || newSaving) && styles.saveBtnDisabled]}
                onPress={saveNewPhoto}
                disabled={!newFrontUri || newSaving}
              >
                <Text style={styles.saveBtnText}>{newSaving ? "Saving…" : "Save"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>

      {/* Compare view — mockup compare sheet look */}
      <Modal visible={compareOpen} animationType="slide" transparent onRequestClose={() => setCompareOpen(false)}>
        {/* Per-Modal GestureHandlerRootView — see week-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <GestureDetector gesture={compareSwipe.gesture}>
          <Animated.View style={[styles.sheet, compareSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>compare</Text>
                <TouchableOpacity onPress={() => setCompareOpen(false)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...compareSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll}>
              {/* Date strip — pick the earlier entry to compare against. */}
              {photoLog.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dateStrip}
                >
                  {photoLog.slice(0, -1).map((e) => {
                    const selected =
                      (compareLeft && e.id === compareLeft.id) ||
                      (!compareWithId && photoLog.indexOf(e) === photoLog.length - 2);
                    return (
                      <TouchableOpacity
                        key={e.id}
                        style={[styles.dateChip, selected && styles.dateChipSelected]}
                        onPress={() => setCompareWithId(e.id)}
                      >
                        <Text style={[styles.dateChipText, selected && styles.dateChipTextSelected]}>
                          {parseISO(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <View style={styles.cmp}>
                <View style={styles.cmpCol}>
                  <Text style={styles.cmpHead}>
                    {compareLeft ? `Then · ${photoDateShort(compareLeft.date)}` : "Then"}
                  </Text>
                  {compareLeft?.frontUri ? (
                    <Image source={{ uri: compareLeft.frontUri }} style={styles.cmpBig} />
                  ) : (
                    <View style={[styles.cmpBig, styles.cmpEmpty]}>
                      <Text style={styles.cmpEmptyText}>No front photo</Text>
                    </View>
                  )}
                </View>
                <View style={styles.cmpCol}>
                  <Text style={styles.cmpHead}>
                    {latestPhoto ? `Now · ${photoDateShort(latestPhoto.date)}` : "Now"}
                  </Text>
                  {latestPhoto?.frontUri ? (
                    <Image source={{ uri: latestPhoto.frontUri }} style={styles.cmpBig} />
                  ) : (
                    <View style={[styles.cmpBig, styles.cmpEmpty]}>
                      <Text style={styles.cmpEmptyText}>No front photo</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Side-vs-side (only if at least one side exists) */}
              {(compareLeft?.sideUri || latestPhoto?.sideUri) && (
                <View style={styles.cmp}>
                  <View style={styles.cmpCol}>
                    {compareLeft?.sideUri ? (
                      <Image source={{ uri: compareLeft.sideUri }} style={styles.cmpBig} />
                    ) : (
                      <View style={[styles.cmpBig, styles.cmpEmpty]}>
                        <Text style={styles.cmpEmptyText}>No side photo</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.cmpCol}>
                    {latestPhoto?.sideUri ? (
                      <Image source={{ uri: latestPhoto.sideUri }} style={styles.cmpBig} />
                    ) : (
                      <View style={[styles.cmpBig, styles.cmpEmpty]}>
                        <Text style={styles.cmpEmptyText}>No side photo</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              <Text style={styles.cmpNote}>
                Same pose, same light. Photos read direction better than the scale — your Coach uses them to guide the plan, never to judge.
              </Text>
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* Body-comp detail */}
      <Modal
        visible={!!compDetailEntry}
        animationType="slide"
        transparent
        onRequestClose={() => setCompDetailEntry(null)}
      >
        {/* Per-Modal GestureHandlerRootView — see week-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <GestureDetector gesture={compDetailSwipe.gesture}>
          <Animated.View style={[styles.sheet, compDetailSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{compDetailEntry ? compDateLabel(compDetailEntry.date) : ""}</Text>
                <TouchableOpacity onPress={() => setCompDetailEntry(null)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...compDetailSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll}>
              {compDetailEntry && (
                <>
                  <Text style={styles.fieldLabel}>Source</Text>
                  <Text style={styles.detailValue}>{BODY_COMP_SOURCE_LABELS[compDetailEntry.source]}</Text>
                  {typeof compDetailEntry.bodyFatPct === "number" && (
                    <>
                      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Body fat</Text>
                      <Text style={styles.detailValue}>
                        {Math.round(compDetailEntry.bodyFatPct * 10) / 10}%
                      </Text>
                    </>
                  )}
                  {typeof compDetailEntry.leanMassLbs === "number" && (
                    <>
                      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Lean mass</Text>
                      <Text style={styles.detailValue}>
                        {Math.round(compDetailEntry.leanMassLbs * 10) / 10} lb
                      </Text>
                    </>
                  )}
                  {typeof compDetailEntry.muscleMassLbs === "number" && (
                    <>
                      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Muscle mass</Text>
                      <Text style={styles.detailValue}>
                        {Math.round(compDetailEntry.muscleMassLbs * 10) / 10} lb
                      </Text>
                    </>
                  )}
                  {compDetailEntry.note ? (
                    <>
                      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Note</Text>
                      <Text style={styles.detailNote}>{compDetailEntry.note}</Text>
                    </>
                  ) : null}
                  {/* ED-safety: medically-low BF% (< 14%) — single quiet line. */}
                  {typeof compDetailEntry.bodyFatPct === "number" && compDetailEntry.bodyFatPct < 14 && (
                    <Text style={styles.compLowBfNote}>
                      If you're working with a clinician on this, keep them in the loop.
                    </Text>
                  )}
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteScan(compDetailEntry.id)}>
                    <Text style={styles.deleteBtnText}>Delete this entry</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* Log scan sheet */}
      <Modal
        visible={scanSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!scanSaving) {
            resetScanSheet();
            setScanSheetOpen(false);
          }
        }}
      >
        {/* Per-Modal GestureHandlerRootView — see week-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={scanSwipe.gesture}>
          <Animated.View style={[styles.sheet, scanSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Log scan</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (scanSaving) return;
                    resetScanSheet();
                    setScanSheetOpen(false);
                  }}
                  hitSlop={10}
                >
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...scanSwipe.scrollViewProps} contentContainerStyle={styles.sheetScroll}>
              <Text style={styles.fieldLabel}>Source</Text>
              <View style={styles.sourceRow}>
                {(["dexa", "inbody", "other"] as BodyCompSource[]).map((s) => {
                  const selected = scanSource === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.sourceChip, selected && styles.sourceChipSelected]}
                      onPress={() => setScanSource(s)}
                    >
                      <Text style={[styles.sourceChipText, selected && styles.sourceChipTextSelected]}>
                        {BODY_COMP_SOURCE_LABELS[s]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Body fat (%)</Text>
              <TextInput
                style={styles.input}
                value={scanBf}
                onChangeText={setScanBf}
                keyboardType="decimal-pad"
                placeholder="e.g. 22.4"
                placeholderTextColor={colors.inkMuted}
              />

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Lean mass (lb) — optional</Text>
              <TextInput
                style={styles.input}
                value={scanLean}
                onChangeText={setScanLean}
                keyboardType="decimal-pad"
                placeholder="e.g. 112.5"
                placeholderTextColor={colors.inkMuted}
              />

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Muscle mass (lb) — optional</Text>
              <TextInput
                style={styles.input}
                value={scanMuscle}
                onChangeText={setScanMuscle}
                keyboardType="decimal-pad"
                placeholder="e.g. 64.0"
                placeholderTextColor={colors.inkMuted}
              />

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Note (optional)</Text>
              <TextInput
                style={styles.noteInput}
                value={scanNote}
                onChangeText={setScanNote}
                placeholder="Anything you want to remember about this scan"
                placeholderTextColor={colors.inkMuted}
                multiline
              />

              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  (scanSaving || (!scanBf.trim() && !scanLean.trim() && !scanMuscle.trim())) &&
                    styles.saveBtnDisabled,
                ]}
                onPress={saveScan}
                disabled={scanSaving || (!scanBf.trim() && !scanLean.trim() && !scanMuscle.trim())}
              >
                <Text style={styles.saveBtnText}>{scanSaving ? "Saving…" : "Save"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>

      {/* Log weight */}
      <Modal visible={weighOpen} animationType="slide" transparent onRequestClose={() => setWeighOpen(false)}>
        {/* Per-Modal GestureHandlerRootView — see week-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <GestureDetector gesture={weighSwipe.gesture}>
          <Animated.View style={[styles.sheet, weighSwipe.sheetAnimStyle]}>
            <View>
              <View style={styles.handle}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Log weight</Text>
                <TouchableOpacity onPress={() => setWeighOpen(false)} hitSlop={10}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.sheetScroll}>
              <Text style={styles.fieldLabel}>Today's weight (lb)</Text>
              <TextInput
                style={styles.input}
                value={weighVal}
                onChangeText={setWeighVal}
                keyboardType="numeric"
                placeholder="e.g. 142"
                placeholderTextColor={colors.inkMuted}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.saveBtn, !weighVal.trim() && styles.saveBtnDisabled]}
                onPress={logWeight}
                disabled={!weighVal.trim()}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.progressBg },
  container: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 60 },

  // --- Header (mockup .head) ---
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 2,
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 3,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
  },
  h1: {
    fontFamily: type.display.family,
    fontSize: 36,
    color: colors.ink,
    letterSpacing: -1.6,
    marginTop: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 4,
  },
  avatarImg: { width: 40, height: 40 },
  avatarInitials: {
    fontFamily: type.display.family,
    fontSize: 12.5,
    color: colors.surface,
    letterSpacing: -0.3,
  },

  // --- Range segmented pill (mockup .range) ---
  range: {
    marginTop: 16,
    backgroundColor: colors.creamTile,
    borderRadius: 100,
    padding: 4,
    flexDirection: "row",
    gap: 2,
  },
  rangeBtn: { flex: 1, paddingVertical: 10, borderRadius: 100, alignItems: "center" },
  rangeBtnOn: {
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  rangeText: { fontSize: 12.5, fontFamily: type.label.family, color: colors.inkMuted },
  rangeTextOn: { color: colors.ink },

  // --- Date-nav (mockup .datenav) ---
  datenav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  navLabel: { fontSize: 13.5, fontFamily: type.display.family, color: colors.ink, letterSpacing: -0.2 },
  navLabelCenter: {
    flex: 1,
    textAlign: "center",
    fontSize: 13.5,
    fontFamily: type.display.family,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  navBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.progressLine,
    backgroundColor: colors.progressCard,
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnDisabled: { opacity: 0.3 },
  navBtnText: { fontSize: 15, color: colors.cocoaSoft, fontFamily: type.ui.family, lineHeight: 18 },

  // --- Section eyebrow (mockup .secLabel) ---
  secLabel: { flexDirection: "row", alignItems: "center", marginTop: 24, marginBottom: 11, marginLeft: 4 },
  secDot: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  secLabelText: {
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
  },

  // --- Insight card (mockup .card) ---
  card: {
    backgroundColor: colors.progressCard,
    borderRadius: 18,
    padding: 20,
    ...SOFT_SHADOW,
  },
  ihead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  ihl: { fontSize: 25, fontFamily: type.display.family, letterSpacing: -1.1, color: colors.ink, lineHeight: 27 },
  isub: { fontSize: 13, color: colors.inkMuted, marginTop: 6, fontFamily: type.ui.family },
  chev: { color: colors.inkMuted, fontSize: 20, lineHeight: 22, marginTop: 0 },
  ibody: { marginTop: 20 },
  idiv: { marginTop: 18, paddingTop: 15, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.progressLineSoft },
  // ED-safety caption: cocoaSoft on warm card is legible (well above clay debt).
  icap: { fontSize: 14, color: colors.cocoaSoft, lineHeight: 22, fontFamily: type.body.family },
  icapB: { color: colors.ink, fontFamily: type.label.family },

  // --- stat row + pill + link (mockup .statrow/.pill/.link) ---
  statrow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  sk: { fontSize: 13.5, color: colors.ink, fontFamily: type.ui.family },
  skd: { fontSize: 11, color: colors.inkMuted, marginTop: 3, fontFamily: type.body.family },
  pill: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 100,
    backgroundColor: colors.calmFill,
  },
  pillText: {
    fontSize: 8.5,
    letterSpacing: 1,
    fontFamily: type.label.family,
    textTransform: "uppercase",
    color: colors.calm,
  },
  link: { fontSize: 13, color: colors.calm, fontFamily: type.label.family, marginTop: 16 },
  // Single-bucket weight: plain text, never a misleading 1-point sparkline.
  weightSingle: { fontSize: 13.5, color: colors.cocoaSoft, fontFamily: type.body.family, marginTop: 4 },

  // --- editorial photo timeline (mockup .ptl/.pframe) ---
  ptl: { flexDirection: "row", gap: 11, paddingBottom: 2 },
  pcol: { alignItems: "center" },
  pframe: {
    width: 104,
    height: 138,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.progressLine,
    ...SOFT_SHADOW_SM,
  },
  pframeLg: { width: 122, height: 160 },
  pImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  pPlaceholder: { backgroundColor: colors.creamTile },
  pVignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  pTag: {
    position: "absolute",
    top: 9,
    left: 9,
    backgroundColor: "rgba(40,28,16,0.4)",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 100,
  },
  pTagText: { color: colors.surface, fontSize: 8, letterSpacing: 1.5, fontFamily: type.label.family },
  pcap: {
    fontSize: 10,
    letterSpacing: 1,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    marginTop: 9,
    textAlign: "center",
    textTransform: "uppercase",
  },
  pcapMuted: { color: colors.inkMuted },
  padd: {
    width: 104,
    height: 138,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.progressLine,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  paddPlus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: colors.inkMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  paddPlusText: { fontSize: 18, color: colors.inkMuted, lineHeight: 20 },

  // --- totals grid (mockup .grid2/.tcard) ---
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: 11 },
  tcard: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: colors.progressCard,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    ...SOFT_SHADOW_SM,
  },
  tk: {
    fontSize: 9,
    letterSpacing: 2,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
  },
  tv: { fontSize: 26, fontFamily: type.display.family, letterSpacing: -1, color: colors.ink, marginTop: 8 },
  tvSmall: { fontSize: 13, fontFamily: type.label.family, color: colors.inkMuted },
  td: { fontSize: 11, color: colors.inkMuted, marginTop: 5, fontFamily: type.body.family },

  // --- F3 cycle look-back (preserved styles, re-tokened) ---
  cycleBcNote: { fontSize: 13, color: colors.cocoaSoft, marginBottom: 8, lineHeight: 18, fontFamily: type.body.family },
  cycleSummaryLine: { fontSize: 14, color: colors.ink, marginTop: 4, lineHeight: 20, fontFamily: type.body.family },
  cycleChartCard: { marginTop: 11 },
  cycleChartTitle: { fontSize: 14, fontFamily: type.label.family, color: colors.ink, marginBottom: 10 },
  cycleChartBox: { height: 90, position: "relative", justifyContent: "flex-end" },
  cycleAvgLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: colors.divider },
  cycleBarRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: "100%" },
  cycleBarSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  cycleBar: { backgroundColor: colors.calm, borderRadius: 4, minHeight: 4 },
  cycleBarLabelRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  cycleBarLabel: { flex: 1, textAlign: "center", fontSize: 11, color: colors.inkMuted, fontFamily: type.label.family },
  cycleChartAvgText: { fontSize: 12, color: colors.inkMuted, marginTop: 8, fontFamily: type.ui.family },
  cycleClinicianNote: { fontSize: 13, color: colors.cocoaSoft, marginTop: 10, lineHeight: 18, fontFamily: type.body.family },

  // --- photo banner (re-tokened, warm) ---
  photoBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.creamTile,
    borderRadius: 12,
    padding: 12,
    marginBottom: 11,
    gap: 12,
  },
  photoBannerText: { flex: 1, fontSize: 13, color: colors.cocoaSoft, lineHeight: 18, fontFamily: type.body.family },
  photoBannerDismiss: { color: colors.calm, fontFamily: type.label.family, fontSize: 13 },

  // --- Modals (warm cream sheets) ---
  backdrop: { flex: 1, backgroundColor: "rgba(26,16,10,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "90%",
    paddingTop: 0,
    // Soft warm lift off the scrim — same ink tone, cast upward (the sheet sits
    // at the bottom edge) so it reads as a raised surface, not a flat panel.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 16,
  },
  handle: { alignItems: "center", paddingTop: 11, paddingBottom: 2 },
  handleBar: { width: 36, height: 4, borderRadius: 100, backgroundColor: colors.latte },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 28, fontFamily: type.display.family, color: colors.ink, flex: 1, paddingRight: 8, letterSpacing: -1.2 },
  close: { fontSize: 23, color: colors.inkMuted, fontFamily: type.ui.family, padding: 4 },
  sheetScroll: { paddingHorizontal: 24, paddingBottom: 32 },

  vwDay: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.progressLine },
  vwDayName: { width: 44, fontSize: 13, fontFamily: type.label.family, color: colors.inkMuted },
  vwTitle: { fontSize: 15, fontFamily: type.ui.family, color: colors.ink },
  vwEx: { fontSize: 13, color: colors.inkMuted, marginTop: 3, fontFamily: type.body.family },

  fieldLabel: {
    fontSize: 9,
    letterSpacing: 2,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
  },
  fieldLabelSpaced: { marginTop: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.progressLine,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 6,
    color: colors.ink,
    fontFamily: type.body.family,
  },
  saveBtn: { backgroundColor: colors.ink, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: colors.surface, fontSize: 16, fontFamily: type.label.family },

  photoSlotFilled: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  photoSlotActions: { gap: 8 },
  photoSlotBtn: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.progressLine, borderRadius: 8 },
  photoSlotBtnText: { fontSize: 13, color: colors.ink, fontFamily: type.ui.family },
  photoSlotEmpty: {
    marginTop: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.progressLine,
    borderRadius: 12,
    paddingVertical: 22,
    alignItems: "center",
  },
  photoSlotEmptyText: { color: colors.inkMuted, fontSize: 14, fontFamily: type.ui.family },
  newSheetThumb: { width: 80, height: 110, borderRadius: 10, backgroundColor: colors.creamTile },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.progressLine,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: 6,
    minHeight: 70,
    textAlignVertical: "top",
    color: colors.ink,
    fontFamily: type.body.family,
  },

  detailPhoto: { width: "100%", height: 360, borderRadius: 12, marginBottom: 12, backgroundColor: colors.creamTile },
  detailNote: { fontSize: 14, color: colors.cocoaSoft, lineHeight: 20, marginTop: 4, marginBottom: 12, fontFamily: type.body.family },
  detailValue: { fontSize: 16, color: colors.ink, marginTop: 4, fontFamily: type.ui.family },
  compareBtn: {
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  compareBtnText: { color: colors.ink, fontFamily: type.label.family, fontSize: 15 },
  deleteBtn: { paddingVertical: 14, alignItems: "center", marginTop: 16 },
  deleteBtnText: { color: colors.warmAlert, fontFamily: type.label.family, fontSize: 15 },

  // --- compare sheet (mockup .cmp) ---
  dateStrip: { flexDirection: "row", gap: 8, paddingVertical: 4, marginBottom: 12 },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.progressLine,
    backgroundColor: colors.progressCard,
  },
  dateChipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  dateChipText: { fontSize: 13, color: colors.cocoaSoft, fontFamily: type.ui.family },
  dateChipTextSelected: { color: colors.surface },
  cmp: { flexDirection: "row", gap: 14, marginTop: 8 },
  cmpCol: { flex: 1 },
  cmpHead: {
    fontSize: 9,
    letterSpacing: 2,
    color: colors.inkMuted,
    fontFamily: type.label.family,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 9,
  },
  cmpBig: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.progressLine,
    backgroundColor: colors.creamTile,
  },
  cmpEmpty: { alignItems: "center", justifyContent: "center" },
  cmpEmptyText: { fontSize: 12, color: colors.inkMuted, fontFamily: type.body.family },
  cmpNote: {
    fontSize: 13,
    color: colors.cocoaSoft,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 18,
    paddingHorizontal: 6,
    fontFamily: type.body.family,
  },

  // --- body-comp scan chips ---
  sourceRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  sourceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.progressLine,
    backgroundColor: colors.progressCard,
  },
  sourceChipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  sourceChipText: { fontSize: 14, color: colors.cocoaSoft, fontFamily: type.ui.family },
  sourceChipTextSelected: { color: colors.surface },
  compLowBfNote: { fontSize: 13, color: colors.cocoaSoft, marginTop: 18, lineHeight: 18, fontFamily: type.body.family },
});
