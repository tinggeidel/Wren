import { useState } from "react";
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
} from "react-native";
import { Profile, WeekPlan, WeightEntry, WEEKDAY_LABELS } from "../lib/types";
import { toISODate, parseISO, addDays } from "../lib/cycle";
import { computeTargets } from "../lib/targets";
import { consumedTotals } from "../lib/food";
import { weekProgress, dayLogged } from "../lib/plan";

const ACCENT = "#7c3aed";

function rangeLabel(startISO: string): string {
  const a = parseISO(startISO);
  const b = parseISO(addDays(startISO, 6));
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(a)} – ${f(b)}`;
}

export default function ProgressScreen({
  profile,
  updateProfile,
}: {
  profile: Profile;
  // Shared updater (App.tsx): the weight-log transform runs against the LATEST
  // profile, so a concurrent write can't be clobbered by a stale snapshot.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
}) {
  const today = toISODate(new Date());
  const plan = profile.plan;
  const current = plan?.current ?? null;
  const history = plan?.history ?? [];
  const allWeeks: WeekPlan[] = [...history, ...(current ? [current] : [])];

  const target = computeTargets(profile);

  // Avg calories over the last 7 logged days.
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const dayCals = last7.map((d) => consumedTotals(profile, d).calories).filter((c) => c > 0);
  const avgCal = dayCals.length ? Math.round(dayCals.reduce((a, b) => a + b, 0) / dayCals.length) : 0;

  // Workouts/week bars (last 8 weeks).
  const bars = allWeeks.slice(-8).map((w) => weekProgress(w).done);
  const maxBar = Math.max(1, ...bars);

  // Weight log (optional).
  const weights = [...(profile.weightLog ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const wMin = Math.min(...weights.map((w) => w.lbs));
  const wMax = Math.max(...weights.map((w) => w.lbs));
  const wCurrent = weights.length ? weights[weights.length - 1].lbs : null;
  const wChange = weights.length >= 2 ? wCurrent! - weights[0].lbs : null;

  const [viewWeek, setViewWeek] = useState<WeekPlan | null>(null);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighVal, setWeighVal] = useState("");

  async function logWeight() {
    const lbs = parseFloat(weighVal);
    if (!lbs || lbs <= 0) return;
    const rounded = Math.round(lbs * 10) / 10;
    // Build the new weightLog from the LATEST profile inside the transform, so a
    // concurrent write to a different field isn't clobbered.
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

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Progress</Text>

        {/* This week (tap to view the plan) */}
        {current ? (
          <TouchableOpacity style={styles.card} onPress={() => setViewWeek(current)}>
            <Text style={styles.cardLabel}>This week</Text>
            <Text style={styles.bigLine}>
              Week {current.weekNumber} · {weekProgress(current).done}/{weekProgress(current).total} done
            </Text>
            <Text style={styles.sub}>{current.programName}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.empty}>
            Set up a tailored plan on the Workout tab and your weekly progress shows up here.
          </Text>
        )}

        {/* Past weeks — only finished weeks (not the current in-progress one) */}
        {history.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Past weeks</Text>
            {[...history].reverse().map((w) => {
              const p = weekProgress(w);
              return (
                <TouchableOpacity key={w.id} style={styles.weekRow} onPress={() => setViewWeek(w)}>
                  <View style={styles.flex}>
                    <Text style={styles.weekTitle}>
                      Week {w.weekNumber} · {w.programName}
                    </Text>
                    <Text style={styles.weekSub}>{rangeLabel(w.startDate)}</Text>
                  </View>
                  <Text style={[styles.weekDone, p.done >= p.total && p.total > 0 && styles.weekDoneFull]}>
                    {p.done}/{p.total}
                    {p.done >= p.total && p.total > 0 ? " ✓" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* Consistency */}
        {(bars.length > 0 || avgCal > 0) && (
          <>
            <Text style={styles.sectionLabel}>Consistency</Text>
            <View style={styles.card}>
              {bars.length > 0 && (
                <>
                  <Text style={styles.cardLabel}>Workouts / week</Text>
                  <View style={styles.barRow}>
                    {bars.map((b, i) => (
                      <View key={i} style={styles.barSlot}>
                        <View style={[styles.bar, { height: `${(b / maxBar) * 100}%` }]} />
                      </View>
                    ))}
                  </View>
                </>
              )}
              {avgCal > 0 && (
                <Text style={styles.statLine}>
                  Avg calories (7 days): {avgCal}
                  {target ? ` / ${target.calories} target` : ""}
                </Text>
              )}
            </View>
          </>
        )}

        {/* Weight (optional) */}
        <Text style={styles.sectionLabel}>Weight (optional)</Text>
        <View style={styles.card}>
          {weights.length === 0 ? (
            <Text style={styles.sub}>Track your weight if you want — totally optional.</Text>
          ) : (
            <>
              <View style={styles.weightTop}>
                <Text style={styles.bigLine}>{wCurrent} lb</Text>
                {wChange != null && (
                  <Text style={[styles.change, wChange <= 0 ? styles.changeDown : styles.changeUp]}>
                    {wChange > 0 ? "▲" : "▼"} {Math.abs(Math.round(wChange * 10) / 10)} lb
                  </Text>
                )}
              </View>
              {weights.length >= 2 && (
                <View style={styles.barRow}>
                  {weights.slice(-12).map((w, i) => {
                    const h = wMax === wMin ? 0.5 : (w.lbs - wMin) / (wMax - wMin);
                    return (
                      <View key={i} style={styles.barSlot}>
                        <View style={[styles.bar, styles.weightBar, { height: `${20 + h * 80}%` }]} />
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
          <TouchableOpacity style={styles.logWeightBtn} onPress={() => setWeighOpen(true)}>
            <Text style={styles.logWeightText}>＋ Log weight</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* View a past week */}
      <Modal visible={!!viewWeek} animationType="slide" transparent onRequestClose={() => setViewWeek(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {viewWeek ? `Week ${viewWeek.weekNumber} · ${viewWeek.programName}` : ""}
              </Text>
              <TouchableOpacity onPress={() => setViewWeek(null)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.sheetScroll}>
              {(viewWeek?.days ?? []).map((d) => (
                <View key={d.weekday} style={styles.vwDay}>
                  <Text style={styles.vwDayName}>{WEEKDAY_LABELS[d.weekday]}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.vwTitle}>
                      {d.title}
                      {dayLogged(d) ? "  ✓" : ""}
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
          </View>
        </View>
      </Modal>

      {/* Log weight */}
      <Modal visible={weighOpen} animationType="slide" transparent onRequestClose={() => setWeighOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Log weight</Text>
              <TouchableOpacity onPress={() => setWeighOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.sheetScroll}>
              <Text style={styles.cardLabel}>Today's weight (lb)</Text>
              <TextInput
                style={styles.input}
                value={weighVal}
                onChangeText={setWeighVal}
                keyboardType="numeric"
                placeholder="e.g. 142"
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 16 },

  card: {
    backgroundColor: "#f7f6fb",
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  cardLabel: { fontSize: 12, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5 },
  bigLine: { fontSize: 20, fontWeight: "800", color: "#1a1a1a", marginTop: 6 },
  sub: { fontSize: 14, color: "#666", marginTop: 4, lineHeight: 20 },
  empty: { fontSize: 15, color: "#666", lineHeight: 22, marginBottom: 8 },

  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 22,
    marginBottom: 8,
  },

  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  weekTitle: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  weekSub: { fontSize: 13, color: "#999", marginTop: 2 },
  weekDone: { fontSize: 15, fontWeight: "700", color: "#888" },
  weekDoneFull: { color: "#3fae6b" },

  barRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 56, marginTop: 12 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { backgroundColor: ACCENT, borderRadius: 4, minHeight: 4 },
  weightBar: { backgroundColor: "#9b6fd4" },
  statLine: { fontSize: 14, color: "#444", marginTop: 14, fontWeight: "600" },

  weightTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  change: { fontSize: 15, fontWeight: "700" },
  changeDown: { color: "#3fae6b" },
  changeUp: { color: "#888" },
  logWeightBtn: { marginTop: 14, alignSelf: "flex-start" },
  logWeightText: { color: ACCENT, fontWeight: "700", fontSize: 15 },

  // Modals
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "85%", paddingTop: 16 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: "#1a1a1a", flex: 1, paddingRight: 8 },
  close: { fontSize: 18, color: "#999", fontWeight: "600" },
  sheetScroll: { paddingHorizontal: 20, paddingBottom: 32 },

  vwDay: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  vwDayName: { width: 44, fontSize: 13, fontWeight: "700", color: "#999" },
  vwTitle: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  vwEx: { fontSize: 13, color: "#666", marginTop: 3 },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 6,
  },
  saveBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  saveBtnDisabled: { backgroundColor: "#c9c2e0" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
