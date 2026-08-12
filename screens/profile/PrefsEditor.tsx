import React, { useState } from "react";
import { Text, TextInput } from "react-native";
import { colors } from "../../lib/theme";
import { Profile } from "../../lib/types";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

export default function PrefsEditor({ initial, updateProfile, onBack }: Props) {
  const [dietaryRules, setDietaryRules] = useState(initial.dietaryRules ?? "");

  // Persist on back. Write only `dietaryRules`; read siblings from latest `p`.
  const saveAndBack = () => {
    void updateProfile((p) => ({ ...p, dietaryRules: dietaryRules.trim() }));
    onBack();
  };

  return (
    <EditorScaffold
      eyebrow="COACHING"
      title="preferences"
      description="Things you set explicitly — dietary rules, schedule, anything Coach should keep in mind."
      onBack={saveAndBack}
    >
      <Text style={s.fieldLabel}>YOUR RULES</Text>
      <TextInput
        style={[s.input, s.multiline]}
        value={dietaryRules}
        onChangeText={setDietaryRules}
        placeholder="e.g. no dairy, prefers mornings, hates burpees"
        placeholderTextColor={colors.inkMuted}
        multiline
      />
      <Text style={s.hint}>Saved when you go back.</Text>
    </EditorScaffold>
  );
}
