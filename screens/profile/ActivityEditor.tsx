import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Profile, ACTIVITY_LABELS, ActivityLevel } from "../../lib/types";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";
import { OptionRow } from "./OptionRow";

const ACTIVITIES: ActivityLevel[] = ["sedentary", "light", "active", "very_active"];

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

export default function ActivityEditor({ initial, updateProfile, onBack }: Props) {
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(
    initial.activityLevel ?? "light"
  );

  const select = (a: ActivityLevel) => {
    setActivityLevel(a);
    void updateProfile((p) => ({ ...p, activityLevel: a }));
  };

  return (
    <EditorScaffold
      eyebrow="BODY"
      title="activity"
      description="Outside of intentional workouts. Honest beats optimistic."
      onBack={onBack}
    >
      <View style={s.optionList}>
        {ACTIVITIES.map((a) => (
          <OptionRow
            key={a}
            label={ACTIVITY_LABELS[a]}
            selected={activityLevel === a}
            onPress={() => select(a)}
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
