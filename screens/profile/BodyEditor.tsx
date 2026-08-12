import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { colors } from "../../lib/theme";
import { Profile } from "../../lib/types";
import { targetsFloorCalories } from "../../lib/targets";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

// age/height/weight/goalWeight are free-text strings on Profile (tolerant unit
// parsing happens in lib/targets.ts). Same placeholders + keyboard types as the
// flat form.
export default function BodyEditor({ initial, updateProfile, onBack }: Props) {
  const [age, setAge] = useState(initial.age ?? "");
  const [height, setHeight] = useState(initial.height ?? "");
  const [weight, setWeight] = useState(initial.weight ?? "");
  const [goalWeight, setGoalWeight] = useState(initial.goalWeight ?? "");

  // Real BMR floor from the in-progress fields, so the helper updates live as she
  // types. Built from a draft profile (the fields targetsFloorCalories reads)
  // overlaid on `initial`. Null until age/height/weight are all parseable — then
  // the helper omits the "~X kcal" clause rather than showing NaN/undefined.
  const floor = targetsFloorCalories({
    ...initial,
    age: age.trim(),
    height: height.trim(),
    weight: weight.trim(),
  });

  // Persist on back. Write only the body fields; read siblings from latest `p`.
  const saveAndBack = () => {
    void updateProfile((p) => ({
      ...p,
      age: age.trim(),
      height: height.trim(),
      weight: weight.trim(),
      goalWeight: goalWeight.trim(),
    }));
    onBack();
  };

  return (
    <EditorScaffold
      eyebrow="BODY"
      title="your body"
      description="These help Coach pace what you do. Skip any you don't want to share — Coach still works."
      onBack={saveAndBack}
    >
      {/* AGE — full width */}
      <Text style={s.fieldLabel}>AGE</Text>
      <View style={s.fieldCard}>
        <TextInput
          style={s.fieldInput}
          value={age}
          onChangeText={setAge}
          placeholder="e.g. 31"
          placeholderTextColor={colors.inkMuted}
          keyboardType="number-pad"
        />
      </View>

      {/* HEIGHT — full width */}
      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>HEIGHT</Text>
        <View style={s.fieldCard}>
          <TextInput
            style={s.fieldInput}
            value={height}
            onChangeText={setHeight}
            placeholder={"e.g. 5'6\" or 168 cm"}
            placeholderTextColor={colors.inkMuted}
          />
        </View>
      </View>

      {/* WEIGHT + GOAL WEIGHT — 2-col grid */}
      <View style={[s.fieldGroup, s.fieldRow]}>
        <View style={s.fieldCol}>
          <Text style={s.fieldLabel}>WEIGHT</Text>
          <View style={s.fieldCard}>
            <TextInput
              style={s.fieldInput}
              value={weight}
              onChangeText={setWeight}
              placeholder="e.g. 140 lb"
              placeholderTextColor={colors.inkMuted}
            />
          </View>
        </View>
        <View style={s.fieldCol}>
          <Text style={s.fieldLabel}>GOAL WEIGHT</Text>
          <View style={s.fieldCard}>
            <TextInput
              style={s.fieldInput}
              value={goalWeight}
              onChangeText={setGoalWeight}
              placeholder="e.g. 130 lb"
              placeholderTextColor={colors.inkMuted}
            />
          </View>
        </View>
      </View>

      {/* Hairline-topped helper. Floor is the real targetsFloorCalories value,
          formatted with a thousands separator like the mockup ("~1,296 kcal").
          When body fields are incomplete (floor == null) the "~X kcal" clause is
          omitted rather than showing NaN. */}
      <View style={s.helperBlock}>
        <Text style={s.helperText}>
          <Text style={s.helperEmphasis}>Coach uses these for: </Text>
          {floor != null
            ? `BMR floor (~${floor.toLocaleString("en-US")} kcal), daily macro targets, and pacing through your cycle.`
            : "your BMR floor, daily macro targets, and pacing through your cycle."}
        </Text>
      </View>

      {/* SAVE: persists the trimmed body fields via saveAndBack (write only
          age/height/weight/goalWeight, read siblings from latest p — wipe-guard)
          then returns. The "‹ PROFILE" back also routes through saveAndBack. */}
      <TouchableOpacity style={s.primaryPill} onPress={saveAndBack} accessibilityRole="button">
        <Text style={s.primaryPillText}>SAVE</Text>
      </TouchableOpacity>
    </EditorScaffold>
  );
}
