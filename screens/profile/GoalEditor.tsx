import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Profile, GOAL_LABELS, Goal } from "../../lib/types";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";
import { OptionRow } from "./OptionRow";

const GOALS: Goal[] = ["lose_fat", "tone_up", "build_muscle", "feel_better", "maintain"];

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

export default function GoalEditor({ initial, updateProfile, onBack }: Props) {
  const [goal, setGoal] = useState<Goal>(initial.goal);

  // Write only `goal`; read every sibling from the latest `p` (wipe-guard).
  const select = (g: Goal) => {
    setGoal(g);
    void updateProfile((p) => ({ ...p, goal: g }));
  };

  return (
    <EditorScaffold
      eyebrow="COACHING"
      title="goal"
      description="What you want from this changes how Coach paces you. Pick one — you can switch any time."
      onBack={onBack}
    >
      <View style={s.optionList}>
        {GOALS.map((g) => (
          <OptionRow
            key={g}
            label={GOAL_LABELS[g]}
            selected={goal === g}
            onPress={() => select(g)}
          />
        ))}
      </View>

      {/* SAVE: selection already persists on press (select -> updateProfile,
          wipe-guarded); the pill returns to the hub. No double-write. */}
      <TouchableOpacity style={s.primaryPill} onPress={onBack} accessibilityRole="button">
        <Text style={s.primaryPillText}>SAVE</Text>
      </TouchableOpacity>
    </EditorScaffold>
  );
}
