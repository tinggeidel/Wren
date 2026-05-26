import { useState, type ReactNode } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  TextInput,
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
  currentPhase,
  phaseForDate,
  periodDays,
  periodRanges,
  cycleStarts,
  observedCycleLength,
  observedPeriodLength,
  nextPredictedPeriod,
  isPredictedPeriodDay,
  PeriodRange,
} from "../lib/cycle";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Calm, distinct palette per phase. Framed as energy/training leans, not fertility.
const PHASE_COLORS: Record<string, { bg: string; ink: string }> = {
  menstrual: { bg: "#fde7ea", ink: "#e2556b" },
  follicular: { bg: "#e7f5ec", ink: "#3fae6b" },
  ovulatory: { bg: "#e4f3f7", ink: "#2f9bb3" },
  luteal: { bg: "#f0e9f8", ink: "#9b6fd4" },
};

const PERIOD = "#e2556b";
const ACCENT = "#7c3aed";

// "Many women find…" guidance — defaults the user's own feelings override.
const PHASE_GUIDANCE: Record<string, string> = {
  menstrual:
    "Many women find energy dips here. Lower-intensity movement, mobility and iron-rich food often feel good — but go by how you actually feel.",
  follicular:
    "Many women feel strongest now. A good stretch to push intensity or chase a PR if your energy's there.",
  ovulatory:
    "Often peak energy. Many women feel great training hard here — keep calories and water up.",
  luteal:
    "Many women feel steadier with endurance and lower-volume work now. More protein and magnesium-rich foods can ease symptoms. Be kind to yourself.",
};

const PHASE_TITLE: Record<string, string> = {
  menstrual: "Menstrual",
  follicular: "Follicular",
  ovulatory: "Ovulatory",
  luteal: "Luteal",
};

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRange(r: PeriodRange): string {
  const len = `${r.length} day${r.length === 1 ? "" : "s"}`;
  if (r.start === r.end) return `${shortDate(r.start)} · ${len}`;
  return `${shortDate(r.start)} – ${shortDate(r.end)} · ${len}`;
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
}: {
  profile: Profile;
  // Shared updater (App.tsx): the dayLogs transform runs against the LATEST
  // profile, so a Coach check-in write can't be clobbered by a stale snapshot.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
}) {
  const today = toISODate(new Date());
  const [view, setView] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Day-log editor state.
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | undefined>(undefined);
  const [energy, setEnergy] = useState<EnergyLevel | undefined>(undefined);
  const [moods, setMoods] = useState<string[]>([]);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [digestion, setDigestion] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const logs = profile.dayLogs ?? {};
  const logged = new Set(periodDays(profile));
  const starts = cycleStarts(profile);
  const phase = currentPhase(profile);
  const obs = observedCycleLength(profile);
  const pred = nextPredictedPeriod(profile);
  const ranges = periodRanges(profile);
  const onPeriodToday = logged.has(today);

  function editorLabel(iso: string): string {
    if (iso === today) return "Today";
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

  const monthLabel = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const isCurrentMonth =
    view.getFullYear() === new Date().getFullYear() && view.getMonth() === new Date().getMonth();

  function shiftMonth(delta: number) {
    setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));
  }

  // --- Status card content ---
  let statusBody: ReactNode;
  if (phase.onBirthControl) {
    statusBody = (
      <>
        <Text style={styles.statusPhase}>On birth control</Text>
        <Text style={styles.statusGuidance}>
          You're on hormonal birth control, so Flux doesn't sync to a natural cycle — your plan stays
          steady. You can still log how you feel and any bleeds below.
        </Text>
      </>
    );
  } else if (!starts.length) {
    statusBody = (
      <>
        <Text style={styles.statusPhase}>No cycle data yet</Text>
        <Text style={styles.statusGuidance}>
          Tap ＋ or any day to log your period and how you feel. The more you log, the better Flux
          learns your real cycle and predicts the next one.
        </Text>
      </>
    );
  } else {
    const color = PHASE_COLORS[phase.phase]?.ink ?? ACCENT;
    const predText = onPeriodToday
      ? "On your period"
      : pred
        ? pred.daysUntil <= 0
          ? "Period likely today"
          : `Next period in ~${pred.daysUntil} day${pred.daysUntil === 1 ? "" : "s"} (around ${shortDate(pred.date)})`
        : "";
    statusBody = (
      <>
        <Text style={[styles.statusPhase, { color }]}>{PHASE_TITLE[phase.phase] ?? phase.phase}</Text>
        {phase.dayOfCycle ? <Text style={styles.statusDay}>Cycle day {phase.dayOfCycle}</Text> : null}
        {predText ? <Text style={styles.statusPredict}>{predText}</Text> : null}
        <Text style={styles.statusGuidance}>{PHASE_GUIDANCE[phase.phase] ?? ""}</Text>
      </>
    );
  }

  const editorHasEntry = !!editorDate && !!logs[editorDate];

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Cycle</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => openEditor(today)}>
            <Text style={styles.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statusCard}>{statusBody}</View>

        {/* Calendar */}
        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.monthBtn}>
            <Text style={styles.monthBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.monthBtn}>
            <Text style={styles.monthBtnText}>›</Text>
          </TouchableOpacity>
        </View>

        {!isCurrentMonth && (
          <TouchableOpacity
            style={styles.todayPill}
            onPress={() => setView(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          >
            <Text style={styles.todayPillText}>Jump to today</Text>
          </TouchableOpacity>
        )}

        <View style={styles.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={styles.weekday}>
              {w}
            </Text>
          ))}
        </View>

        {rows.map((row, ri) => (
          <View key={ri} style={styles.weekRow}>
            {row.map((iso, ci) => {
              if (!iso) return <View key={ci} style={styles.cell} />;
              const isToday = iso === today;
              const isFuture = iso > today;
              const isLogged = logged.has(iso);
              const isPredicted = !isLogged && isPredictedPeriodDay(profile, iso);
              const hasLog = !!logs[iso];
              const ph = phaseForDate(profile, parseISO(iso)).phase;
              const tint = PHASE_COLORS[ph];

              const cellStyle: any[] = [styles.cell, styles.dayCell];
              const txtStyle: any[] = [styles.dayText];

              if (isLogged) {
                cellStyle.push({ backgroundColor: PERIOD });
                txtStyle.push({ color: "#fff", fontWeight: "700" });
              } else if (isPredicted) {
                cellStyle.push(styles.predictedCell);
                txtStyle.push({ color: PERIOD, fontWeight: "600" });
              } else if (tint) {
                cellStyle.push({ backgroundColor: tint.bg });
                txtStyle.push({ color: "#333" });
              }
              if (isFuture && !isPredicted) txtStyle.push({ opacity: 0.55 });
              if (isToday) cellStyle.push(styles.todayCell);

              return (
                <TouchableOpacity
                  key={ci}
                  style={cellStyle}
                  activeOpacity={isFuture ? 1 : 0.6}
                  onPress={() => openEditor(iso)}
                  disabled={isFuture}
                >
                  <Text style={txtStyle}>{parseISO(iso).getDate()}</Text>
                  {!isLogged && hasLog && <View style={styles.logDot} />}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <Text style={styles.helpText}>Tap a day to log how you felt, or ＋ to log today.</Text>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: PERIOD }]} />
            <Text style={styles.legendText}>Period</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.predictedCell]} />
            <Text style={styles.legendText}>Predicted</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendDotSwatch]}>
              <View style={styles.logDotStatic} />
            </View>
            <Text style={styles.legendText}>Logged</Text>
          </View>
          {(["menstrual", "follicular", "ovulatory", "luteal"] as const).map((p) => (
            <View key={p} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: PHASE_COLORS[p].bg }]} />
              <Text style={styles.legendText}>{PHASE_TITLE[p]}</Text>
            </View>
          ))}
        </View>

        {/* History summary */}
        {!phase.onBirthControl && starts.length > 0 && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Your pattern</Text>
            <Text style={styles.summaryLine}>
              Average cycle: {obs.length} days{" "}
              {obs.fromHistory
                ? `(from your last ${obs.cycles} ${obs.cycles === 1 ? "cycle" : "cycles"})`
                : "(starting estimate — log more to refine)"}
            </Text>
            {ranges.length > 0 && (
              <Text style={styles.summaryLine}>Typical period: ~{observedPeriodLength(profile)} days</Text>
            )}
            {ranges.length > 0 && (
              <>
                <Text style={styles.summarySub}>Recent periods</Text>
                {ranges
                  .slice(-4)
                  .reverse()
                  .map((r) => (
                    <Text key={r.start} style={styles.summaryLine}>
                      {formatRange(r)}
                    </Text>
                  ))}
              </>
            )}
          </View>
        )}

        <Text style={styles.disclaimer}>
          Predictions are estimates from your own history and shift as you log more. Phases are
          defaults many women feel — yours may differ, so go by how you actually feel. This isn't
          medical or fertility advice.
        </Text>
      </ScrollView>

      {/* Day-log editor */}
      <Modal
        visible={!!editorDate}
        animationType="slide"
        transparent
        onRequestClose={() => setEditorDate(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editorDate ? editorLabel(editorDate) : ""}</Text>
              <TouchableOpacity onPress={() => setEditorDate(null)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.editorSection}>Period &amp; flow</Text>
              <View style={styles.chipWrap}>
                {FLOW_OPTIONS.map((o) => {
                  const on = flow === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, on && styles.chipActiveRose]}
                      onPress={() => setFlow(on ? undefined : o.key)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editorSection}>Energy</Text>
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

              <Text style={styles.editorSection}>Mood</Text>
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

              <Text style={styles.editorSection}>Symptoms</Text>
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

              <Text style={styles.editorSection}>Digestion</Text>
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

              <Text style={styles.editorSection}>Note</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Anything else you want the Coach to know…"
                multiline
              />

              <TouchableOpacity style={styles.saveBtn} onPress={saveEditor}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
              {editorHasEntry && (
                <TouchableOpacity style={styles.clearBtn} onPress={clearDay}>
                  <Text style={styles.clearBtnText}>Clear this day</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 60 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: "700" },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: "#fff", fontSize: 22, fontWeight: "700", lineHeight: 24 },

  statusCard: { backgroundColor: "#f7f6fb", borderRadius: 16, padding: 18, marginBottom: 20 },
  statusPhase: { fontSize: 20, fontWeight: "700", color: ACCENT },
  statusDay: { fontSize: 15, color: "#444", marginTop: 2, fontWeight: "600" },
  statusPredict: { fontSize: 14, color: PERIOD, marginTop: 6, fontWeight: "600" },
  statusGuidance: { fontSize: 14, color: "#555", marginTop: 10, lineHeight: 20 },

  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  monthBtn: { paddingHorizontal: 16, paddingVertical: 4 },
  monthBtnText: { fontSize: 26, color: ACCENT, fontWeight: "700" },
  monthLabel: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  todayPill: {
    alignSelf: "center",
    backgroundColor: "#f0eef7",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 8,
  },
  todayPillText: { color: ACCENT, fontWeight: "600", fontSize: 13 },

  weekRow: { flexDirection: "row" },
  weekday: {
    flex: 1,
    textAlign: "center",
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
    paddingVertical: 6,
  },
  cell: { flex: 1, aspectRatio: 1, padding: 2 },
  dayCell: { alignItems: "center", justifyContent: "center", borderRadius: 999, margin: 2 },
  dayText: { fontSize: 15, color: "#333" },
  predictedCell: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: PERIOD, borderStyle: "dashed" },
  todayCell: { borderWidth: 2, borderColor: ACCENT },
  logDot: { position: "absolute", bottom: 5, width: 5, height: 5, borderRadius: 3, backgroundColor: ACCENT },
  logDotStatic: { width: 5, height: 5, borderRadius: 3, backgroundColor: ACCENT },

  helpText: { textAlign: "center", color: "#888", fontSize: 13, marginTop: 12 },

  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 16, height: 16, borderRadius: 8 },
  legendDotSwatch: { backgroundColor: "#f0eef7", alignItems: "center", justifyContent: "center" },
  legendText: { fontSize: 12, color: "#666" },

  summaryCard: { backgroundColor: "#f7f6fb", borderRadius: 16, padding: 18, marginTop: 22 },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  summaryLine: { fontSize: 14, color: "#333", marginTop: 4, lineHeight: 20 },
  summarySub: { fontSize: 13, fontWeight: "700", color: "#666", marginTop: 12, marginBottom: 2 },

  disclaimer: { fontSize: 12, color: "#999", marginTop: 22, lineHeight: 18 },

  // Editor modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: "88%",
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  modalTitle: { fontSize: 19, fontWeight: "700", color: "#1a1a1a" },
  modalClose: { fontSize: 18, color: "#999", fontWeight: "600" },
  modalScroll: { paddingHorizontal: 20, paddingBottom: 32 },
  editorSection: { fontSize: 15, fontWeight: "700", color: "#333", marginTop: 18, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipActiveRose: { backgroundColor: PERIOD, borderColor: PERIOD },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  noteInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 64,
    textAlignVertical: "top",
  },
  saveBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  clearBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  clearBtnText: { color: PERIOD, fontSize: 15, fontWeight: "600" },
});
