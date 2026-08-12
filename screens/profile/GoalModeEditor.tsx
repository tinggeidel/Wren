import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Profile, CALORIE_MODE_LABELS, CalorieMode } from "../../lib/types";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

const CALORIE_MODES: CalorieMode[] = ["static", "net"];

// Short per-card paragraphs for the two-up cards. Drawn from the flat-form hint
// copy (kept in meaning) but trimmed to a card-sized blurb per the mockup.
const MODE_BLURB: Record<CalorieMode, string> = {
  static:
    "Your daily target stays the same. Calories burned are shown for awareness but don't change how much you should eat.",
  net: "Calories you burn add to your daily food budget, so a harder workout means more room to fuel. Never below your BMR.",
};

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

export default function GoalModeEditor({ initial, updateProfile, onBack }: Props) {
  const [calorieMode, setCalorieMode] = useState<CalorieMode>(
    initial.calorieMode ?? "static"
  );

  const select = (m: CalorieMode) => {
    setCalorieMode(m);
    void updateProfile((p) => ({ ...p, calorieMode: m }));
  };

  return (
    <EditorScaffold
      eyebrow="TARGETS"
      title="goal mode"
      description="How Coach handles the calories you burn when you log a workout."
      onBack={onBack}
    >
      <View style={s.modeGrid}>
        {CALORIE_MODES.map((m) => {
          const active = calorieMode === m;
          return (
            <TouchableOpacity
              key={m}
              onPress={() => select(m)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[s.modeCard, active && s.modeCardActive]}
            >
              <Text style={[s.modeCardTitle, active && s.modeCardTitleActive]}>
                {CALORIE_MODE_LABELS[m]}
              </Text>
              <Text style={[s.modeCardBody, active && s.modeCardBodyActive]}>
                {MODE_BLURB[m]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Full hint verbatim from the flat form, kept below the cards. */}
      <View style={s.helperBlock}>
        <Text style={s.helperText}>
          {calorieMode === "net"
            ? "Net (eat-back): calories you burn add to your daily food budget, so a harder workout means more room to fuel. Your base target never drops below your BMR."
            : "Static: your daily target stays the same. Calories burned are shown for awareness but don't change how much you should eat."}
        </Text>
      </View>

      {/* SAVE: selection already persists on press (select -> updateProfile,
          wipe-guarded); the pill returns to the hub. No double-write. */}
      <TouchableOpacity style={s.primaryPill} onPress={onBack} accessibilityRole="button">
        <Text style={s.primaryPillText}>SAVE</Text>
      </TouchableOpacity>
    </EditorScaffold>
  );
}
