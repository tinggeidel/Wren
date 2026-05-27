import { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

// --- Stepper (core RN only, no native dep) ---------------------------------
// A -/+ row with a centered value. Extracted from OnboardingScreen so other
// screens (notably WorkoutScreen's plan-setup sheet, which previously hosted
// an iOS countdown DateTimePicker that crashed on the onboarding → workout
// auto-open transition) can reuse the exact same control. No nested scroll
// views, so it never fights the page's vertical scroll.
//
// Tap = step once; press-and-hold = repeat. onPressIn does one immediate step,
// then starts a setInterval that keeps stepping while held; onPressOut (and
// unmount, via the effect) clear the interval so no timer leaks. Buttons
// disable + stop at min/max, and every step is clamped to [min, max] as a
// belt-and-braces guard. onChange fires only from a real press, so callers
// using a "touched" gate (Onboarding height/weight/goal-weight) are never
// tripped by mount/layout.
//
// `step` lets callers choose the increment (1 for height-inches / weight-lb,
// 5 for workout session minutes). Defaults to 1 to keep the original
// onboarding callsites unchanged.

const HOLD_REPEAT_MS = 100;

export function StepButton({
  label,
  disabled,
  onStep,
}: {
  label: string;
  disabled: boolean;
  onStep: () => void;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function clear() {
    if (timer.current != null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  function start() {
    if (disabled) return;
    onStep(); // immediate first step on press
    clear(); // never stack intervals
    timer.current = setInterval(onStep, HOLD_REPEAT_MS);
  }

  // Clear any running interval if the button unmounts mid-hold (e.g. the user
  // navigates away while holding) so we never leak a timer.
  useEffect(() => clear, []);

  return (
    <TouchableOpacity
      style={[styles.stepBtn, disabled && styles.stepBtnDisabled]}
      onPressIn={start}
      onPressOut={clear}
      // onBlur isn't a TouchableOpacity event; clear() in the effect cleanup and
      // onPressOut cover the leak cases. Keeping accessibility props explicit.
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === "−" ? "Decrease" : "Increase"}
    >
      <Text style={[styles.stepBtnText, disabled && styles.stepBtnTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  // When true, the centered value box is rendered in a "placeholder" style
  // (gray, italic) to visually signal that the displayed number is a default
  // PREVIEW and is NOT yet committed to anywhere. Used by onboarding's
  // touched-gated steppers (height/weight/goal-weight/waist/neck/hip) where
  // the Profile field stays undefined until the user actually presses −/+.
  // Default false preserves the original look for callers that always commit
  // (e.g. WorkoutScreen's session-minutes stepper).
  dimmed = false,
}: {
  value: number;
  min: number;
  max: number;
  // Increment per tap (and per repeat tick while held). Default 1.
  step?: number;
  display: string;
  onChange: (next: number) => void;
  dimmed?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <View style={styles.stepperRow}>
      <StepButton
        label="−"
        disabled={value <= min}
        onStep={() => onChange(clamp(value - step))}
      />
      <View style={[styles.stepperValueBox, dimmed && styles.stepperValueBoxDimmed]}>
        <Text style={[styles.stepperValue, dimmed && styles.stepperValueDimmed]}>
          {dimmed ? `${display} · not set` : display}
        </Text>
      </View>
      <StepButton
        label="+"
        disabled={value >= max}
        onStep={() => onChange(clamp(value + step))}
      />
    </View>
  );
}

// Styles copied verbatim from the original OnboardingScreen definitions so the
// height/weight steppers render pixel-identically after the extraction. The
// ACCENT color matches the Flux purple used across both screens.
const ACCENT = "#7c3aed";
const styles = StyleSheet.create({
  // Big −/+ buttons flanking a centered value.
  stepperRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginTop: 2 },
  stepBtn: {
    width: 64,
    height: 56,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#f0eef7",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: { backgroundColor: "#f7f7f7", borderColor: "#eee" },
  stepBtnText: { fontSize: 28, fontWeight: "700", color: ACCENT, lineHeight: 32 },
  stepBtnTextDisabled: { color: "#ccc" },
  stepperValueBox: {
    flex: 1,
    height: 56,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#fafafa",
    alignItems: "center",
    justifyContent: "center",
  },
  // "Not set" preview state: subtler border + lighter fill so the box visually
  // reads as a placeholder, not a committed value. Paired with stepperValueDimmed
  // text style (gray + italic + lighter weight) so the contrast carries even
  // when the dimmed box is glanced at quickly.
  stepperValueBoxDimmed: {
    borderColor: "#eee",
    backgroundColor: "#f7f7f7",
    borderStyle: "dashed",
  },
  stepperValue: { fontSize: 22, fontWeight: "700", color: "#1a1a1a" },
  stepperValueDimmed: { color: "#9a9aa3", fontWeight: "500", fontStyle: "italic", fontSize: 18 },
});
