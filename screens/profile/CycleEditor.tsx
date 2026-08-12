import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  StyleSheet,
} from "react-native";
import Svg, { Rect, Line } from "react-native-svg";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { colors, type, spacing } from "../../lib/theme";
import { Profile } from "../../lib/types";
import { toISODate } from "../../lib/cycle";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

// Parse a "YYYY-MM-DD" string to a Date; fall back to today if empty/invalid.
// (Ported verbatim from the flat form.)
function parseDateOrToday(str: string): Date {
  const d = new Date(str + "T00:00:00");
  return isNaN(d.getTime()) ? new Date() : d;
}

// Small calendar glyph for the LAST PERIOD START field, per the mockup.
function CalendarIcon() {
  return (
    <Svg viewBox="0 0 16 16" width={14} height={14}>
      <Rect x={2} y={3} width={12} height={11} rx={1.5} fill="none" stroke={colors.inkMuted} strokeWidth={1.3} />
      <Line x1={2} y1={6} x2={14} y2={6} stroke={colors.inkMuted} strokeWidth={1.3} />
      <Line x1={6} y1={1.5} x2={6} y2={4} stroke={colors.inkMuted} strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={10} y1={1.5} x2={10} y2={4} stroke={colors.inkMuted} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

// The three mutually-exclusive cycle modes. "track" = log her natural cycle;
// "bc" = on hormonal birth control (tracking on, phase predictions handled
// differently); "off" = cycle tracking fully disabled app-wide.
type CycleMode = "track" | "bc" | "off";

const MODE_OPTIONS: { key: CycleMode; label: string; subtitle: string }[] = [
  {
    key: "track",
    label: "Track my natural cycle",
    subtitle: "Coach paces around your phase and predicts your period.",
  },
  {
    key: "bc",
    label: "On hormonal birth control",
    subtitle: "Coach handles phase predictions differently.",
  },
  {
    key: "off",
    label: "Turn off cycle tracking",
    subtitle: "No cycle tracking or phase-based guidance. You can turn it back on anytime.",
  },
];

// Map an existing profile to its starting mode. === false so a missing
// cycleTrackingEnabled (legacy profile) reads as enabled, not off.
function modeFromProfile(initial: Profile): CycleMode {
  if (initial.cycleTrackingEnabled === false) return "off";
  if (initial.onBirthControl) return "bc";
  return "track";
}

export default function CycleEditor({ initial, updateProfile, onBack }: Props) {
  const [mode, setMode] = useState<CycleMode>(modeFromProfile(initial));
  const [lastPeriodStart, setLastPeriodStart] = useState(initial.lastPeriodStart ?? "");
  const [avgCycleLength, setAvgCycleLength] = useState(String(initial.avgCycleLength ?? 28));
  const [showPicker, setShowPicker] = useState(false);

  function openPicker() {
    if (!lastPeriodStart) setLastPeriodStart(toISODate(new Date()));
    setShowPicker((v) => !v);
  }

  function onChangeDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "set" && date) setLastPeriodStart(toISODate(date));
  }

  // Persist on back. Save relates lastPeriodStart/avgCycleLength to the profile
  // exactly as the flat form did (trimmed ISO string; numeric length with a 28
  // fallback). Write only the cycle fields; read siblings from latest `p`.
  const saveAndBack = () => {
    // Derive the two stored booleans from the single selected mode so they can
    // never contradict each other. "off" disables tracking; "bc" keeps tracking
    // on but flags birth control; "track" is the plain natural-cycle path.
    const cycleTrackingEnabled = mode !== "off";
    const onBirthControl = mode === "bc";
    void updateProfile((p) => ({
      ...p,
      cycleTrackingEnabled,
      onBirthControl,
      lastPeriodStart: lastPeriodStart.trim(),
      avgCycleLength: Number(avgCycleLength) || 28,
    }));
    onBack();
  };

  return (
    <EditorScaffold
      eyebrow="CYCLE"
      title="cycle settings"
      description="Helps Coach know which phase to pace around. Numbers refine as you log more cycles."
      onBack={saveAndBack}
    >
      {/* 3-way cycle mode selector — mutually exclusive. Replaces the old BC
          Switch. "off" fully disables cycle tracking app-wide. */}
      <View style={cycleStyles.modeGroup}>
        {MODE_OPTIONS.map((opt) => {
          const selected = mode === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[cycleStyles.modeCard, selected && cycleStyles.modeCardSelected]}
              onPress={() => setMode(opt.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={opt.label}
            >
              <View
                style={[cycleStyles.radioOuter, selected && cycleStyles.radioOuterSelected]}
              >
                {selected && <View style={cycleStyles.radioInner} />}
              </View>
              <View style={cycleStyles.modeTextWrap}>
                <Text style={cycleStyles.modeLabel}>{opt.label}</Text>
                <Text style={cycleStyles.modeSubtitle}>{opt.subtitle}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* SAFETY-CRITICAL: the date picker + avg-length show ONLY for the
          natural-cycle mode (hidden on birth control AND when tracking is off).
          Do not weaken this gating. */}
      {mode === "track" && (
        <>
          {/* LAST PERIOD START — creamTile field + calendar icon (opens picker) */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>LAST PERIOD START</Text>
            <View style={s.fieldCard}>
              <TextInput
                style={s.fieldInput}
                value={lastPeriodStart}
                onChangeText={setLastPeriodStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={openPicker}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Open date picker"
              >
                <CalendarIcon />
              </TouchableOpacity>
            </View>
          </View>

          {showPicker && (
            <View>
              <DateTimePicker
                value={parseDateOrToday(lastPeriodStart)}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                maximumDate={new Date()}
                onChange={onChangeDate}
              />
              {Platform.OS === "ios" && (
                <TouchableOpacity
                  style={cycleStyles.doneBtn}
                  onPress={() => setShowPicker(false)}
                >
                  <Text style={cycleStyles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* AVERAGE CYCLE LENGTH — creamTile field + "starting estimate" hint */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>AVERAGE CYCLE LENGTH</Text>
            <View style={s.fieldCard}>
              <TextInput
                style={s.fieldInput}
                value={avgCycleLength}
                onChangeText={setAvgCycleLength}
                placeholder="28"
                placeholderTextColor={colors.inkMuted}
                keyboardType="number-pad"
              />
              <Text style={s.fieldTrailingHint}>starting estimate</Text>
            </View>
          </View>
        </>
      )}

      {/* SAFETY HELPER — copy from the mockup. Kept legible (cocoaSoft body, not
          shrunk) and never softened: it carries the "not medical or fertility
          advice" guardrail. */}
      <View style={s.helperBlock}>
        <Text style={s.helperText}>
          Predictions are estimates from your own history and shift as you log
          more. Not medical advice.
        </Text>
      </View>

      {/* SAVE: persists onBirthControl + (when not on BC) lastPeriodStart/
          avgCycleLength via saveAndBack (write only cycle fields, read siblings
          from latest p — wipe-guard) then returns. The "‹ PROFILE" back also
          routes through saveAndBack. */}
      <TouchableOpacity style={s.primaryPill} onPress={saveAndBack} accessibilityRole="button">
        <Text style={s.primaryPillText}>SAVE</Text>
      </TouchableOpacity>
    </EditorScaffold>
  );
}

const cycleStyles = StyleSheet.create({
  // 3-way mode selector — stacked creamTile cards, each a radio row. Selected
  // card gets an Espresso-ink outline (no purple; existing tokens only).
  modeGroup: { gap: spacing.sm },
  modeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.creamTile,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: spacing.lg, // 16
    paddingVertical: spacing.lg - 2, // 14
  },
  modeCardSelected: {
    borderColor: colors.ink,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.handle,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    marginRight: spacing.md,
  },
  radioOuterSelected: {
    borderColor: colors.ink,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.ink,
  },
  modeTextWrap: { flex: 1 },
  modeLabel: {
    fontSize: type.size.callout, // 14
    fontFamily: type.ui.family, // medium
    color: colors.ink,
  },
  modeSubtitle: {
    fontSize: type.size.micro, // 11
    fontFamily: type.body.family,
    color: colors.inkMuted, // clay
    marginTop: 3,
  },
  doneBtn: {
    alignSelf: "flex-end",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  doneBtnText: {
    color: colors.accent,
    fontFamily: type.label.family,
    fontSize: type.size.callout,
  },
});
