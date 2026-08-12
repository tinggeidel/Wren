import React, { useState } from "react";
import { View, Text, TouchableOpacity, Alert, StyleSheet } from "react-native";
import { colors, type, spacing, radius } from "../../lib/theme";
import { Profile } from "../../lib/types";
import {
  computeTargets,
  targetsFloorCalories,
  recomputeMacrosFromCalories,
} from "../../lib/targets";
import { toISODate } from "../../lib/cycle";
import { Stepper } from "../../components/Stepper";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

// SAFETY-CRITICAL. The BMR-floor guard, the sub-floor warning copy, and the
// two-step "Save it anyway" confirm are ported VERBATIM from the flat form's
// macros modal. Do not change any floor logic, thresholds, or copy.
export default function TargetsEditor({ initial, updateProfile, onBack }: Props) {
  // Effective targets from the live profile (custom override or auto-computed),
  // used to seed the steppers and as the fallback display when fields are sparse.
  const targets = computeTargets(initial);
  // Floor: max(BMR, 1200). Null when she hasn't filled in enough body fields.
  const floorCal = targetsFloorCalories(initial);
  const hasCustomTargets = !!initial.customTargets;

  const seed = targets ?? { calories: 2000, protein: 130, carbs: 220, fat: 70, fiber: 28 };
  const [editCal, setEditCal] = useState(seed.calories);
  const [editProtein, setEditProtein] = useState(seed.protein);
  const [editCarbs, setEditCarbs] = useState(seed.carbs);
  const [editFat, setEditFat] = useState(seed.fat);
  const [editFiber, setEditFiber] = useState(seed.fiber);

  const editBelowFloor = floorCal != null && editCal < floorCal;
  // Verbatim warning text — surfaced in the editor and (when she taps Save with a
  // sub-floor calorie value) the confirm Alert. Kept in one const so both copies
  // stay in sync. Soft + honest, non-alarmist, ED-safety-aware.
  const subFloorWarningCopy = floorCal
    ? `This is below your BMR (${floorCal} kcal). Sustained sub-BMR intake can affect energy, hormones, and recovery. You can save it if you want.`
    : "";

  // Recompute the three macro steppers from the current calorie stepper value,
  // via the same goal-aware formula the auto-targets path uses. No-op when weight
  // is missing. (Ported verbatim.)
  function autoCalcFromCalories() {
    const out = recomputeMacrosFromCalories(initial, editCal);
    if (!out) {
      Alert.alert(
        "Add your weight first",
        "I need your weight to auto-calculate macros from a calorie target. Add it in Your body and try again."
      );
      return;
    }
    setEditProtein(out.protein);
    setEditCarbs(out.carbs);
    setEditFat(out.fat);
    setEditFiber(out.fiber);
  }

  // Write only `customTargets` (+ when-set timestamp); read every sibling from
  // the latest `p` (wipe-guard). Returns to the hub on save.
  async function persistCustomTargets() {
    const next = {
      calories: editCal,
      protein: editProtein,
      carbs: editCarbs,
      fat: editFat,
      fiber: editFiber,
    };
    await updateProfile((p) => ({
      ...p,
      customTargets: next,
      customTargetsSetAt: toISODate(new Date()),
    }));
    onBack();
  }

  function handleSaveMacros() {
    if (editBelowFloor) {
      Alert.alert("Below your BMR floor", subFloorWarningCopy + "\n\nSave it anyway?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save it anyway",
          style: "destructive",
          onPress: () => void persistCustomTargets(),
        },
      ]);
      return;
    }
    void persistCustomTargets();
  }

  async function handleResetMacros() {
    await updateProfile((p) => ({
      ...p,
      customTargets: undefined,
      customTargetsSetAt: undefined,
    }));
    onBack();
  }

  // Format a number with thousands separators, matching the mockup ("1,780").
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <EditorScaffold
      eyebrow="TARGETS"
      title="daily targets"
      description="Auto-computed from your body and goal. Override anything if Coach got it wrong."
      onBack={onBack}
    >
      {/* Hero kcal tile. The displayed kcal is the live edited calorie target;
          the floor line uses the real targetsFloorCalories() value. (Both are
          already wired — no placeholder needed.) The "never below." line carries
          the BMR-floor framing. */}
      <View style={macroStyles.heroCard}>
        <Text style={macroStyles.heroEyebrow}>DAILY KCAL</Text>
        <Text style={macroStyles.heroNumber}>{fmt(editCal)}</Text>
        {floorCal != null ? (
          <Text style={macroStyles.heroFloor}>
            floor: {fmt(floorCal)} kcal (BMR). never below.
          </Text>
        ) : (
          <Text style={macroStyles.heroFloor}>
            add your body details to see your BMR floor.
          </Text>
        )}
      </View>

      {/* Sub-floor live summary (kept): custom-vs-auto + floor line, when targets
          are computable. */}
      {targets && (
        <Text style={macroStyles.summaryHint}>
          {hasCustomTargets ? "Custom — set by you." : "Auto-computed from your goal."}
        </Text>
      )}

      {/* Editing controls: the de-purpled Steppers (kept, per Ting's decision —
          NOT the mockup's editable number-grid). */}
      <Text style={s.label}>Calories (kcal)</Text>
      <Stepper
        value={editCal}
        min={800}
        max={5000}
        step={10}
        display={`${editCal} kcal`}
        onChange={setEditCal}
      />
      {/* SAFETY COPY — sub-floor BMR warning, copy untouched, kept legible. */}
      {editBelowFloor && <Text style={macroStyles.warnText}>{subFloorWarningCopy}</Text>}

      {/* RECOMPUTE FROM BODY & GOAL = the existing auto-calc affordance. */}
      <TouchableOpacity
        style={macroStyles.recomputeBtn}
        onPress={autoCalcFromCalories}
        accessibilityRole="button"
      >
        <Text style={macroStyles.recomputeBtnText}>RECOMPUTE FROM BODY & GOAL</Text>
      </TouchableOpacity>

      <Text style={s.label}>Protein (g)</Text>
      <Stepper
        value={editProtein}
        min={0}
        max={300}
        step={5}
        display={`${editProtein} g`}
        onChange={setEditProtein}
      />

      <Text style={s.label}>Carbs (g)</Text>
      <Stepper
        value={editCarbs}
        min={0}
        max={600}
        step={5}
        display={`${editCarbs} g`}
        onChange={setEditCarbs}
      />

      <Text style={s.label}>Fat (g)</Text>
      <Stepper
        value={editFat}
        min={0}
        max={200}
        step={5}
        display={`${editFat} g`}
        onChange={setEditFat}
      />

      <Text style={s.label}>Fiber (g)</Text>
      <Stepper
        value={editFiber}
        min={0}
        max={100}
        step={1}
        display={`${editFiber} g`}
        onChange={setEditFiber}
      />

      <View style={s.helperBlock}>
        <Text style={s.helperText}>
          Coach uses these as the day's shape. Goes up on training days (in Net
          mode), stays static if you prefer.
        </Text>
      </View>

      <TouchableOpacity style={s.primaryPill} onPress={handleSaveMacros} accessibilityRole="button">
        <Text style={s.primaryPillText}>SAVE</Text>
      </TouchableOpacity>

      {hasCustomTargets && (
        <TouchableOpacity
          style={[s.outlinePill, { marginTop: spacing.md }]}
          onPress={() => void handleResetMacros()}
          accessibilityRole="button"
        >
          <Text style={s.outlinePillText}>RESET TO AUTO</Text>
        </TouchableOpacity>
      )}
    </EditorScaffold>
  );
}

const macroStyles = StyleSheet.create({
  // Hero kcal tile — creamTile fill, centered, per the mockup.
  heroCard: {
    backgroundColor: colors.creamTile,
    borderRadius: 14,
    padding: spacing.lg + 2, // 18
    alignItems: "center",
  },
  heroEyebrow: {
    fontSize: 9,
    fontFamily: type.label.family, // semibold
    letterSpacing: 2,
    color: colors.inkMuted, // clay
  },
  heroNumber: {
    fontSize: 36,
    fontFamily: type.numeral.family, // bold
    color: colors.ink,
    letterSpacing: -1,
    lineHeight: 38,
    marginTop: spacing.sm - 2, // 6
  },
  heroFloor: {
    fontSize: type.size.micro, // 11
    fontFamily: type.body.family,
    color: colors.cocoaSoft,
    marginTop: spacing.sm - 2, // 6
    textAlign: "center",
  },
  summaryHint: {
    fontSize: type.size.caption,
    fontFamily: type.body.family,
    color: colors.cocoaSoft,
    marginTop: spacing.md,
  },
  // SAFETY COPY — the sub-floor BMR warning. Copy is untouched. Restyled only:
  // warm cocoa text on a faint cream tile with a left accent rule so it reads as
  // a deliberate, visible caution in the warm register. Kept fully legible —
  // body voice (not shrunk), generous line-height, ink-dark warm tone. Do NOT
  // lower the contrast or size of this block.
  warnText: {
    fontSize: type.size.callout, // 14 — body-legible, not shrunk
    fontFamily: type.body.family,
    color: colors.warmAlert,
    marginTop: spacing.md,
    backgroundColor: colors.creamTile,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.warmAlert,
    lineHeight: 20,
  },
  // RECOMPUTE affordance — centered, mistDark, letter-spaced text button per
  // the mockup.
  recomputeBtn: {
    marginTop: spacing.md + 2, // 14
    alignItems: "center",
    paddingVertical: spacing.sm - 2, // 6
  },
  recomputeBtnText: {
    color: colors.mistDark, // #4F6B70
    fontFamily: type.label.family, // semibold
    fontSize: type.size.micro, // 11
    letterSpacing: type.tracking.label, // 2
  },
});
