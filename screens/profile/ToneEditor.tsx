import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Profile, TONE_LABELS, Tone } from "../../lib/types";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";
import { OptionRow } from "./OptionRow";

const TONES: Tone[] = ["hype", "bestie", "tough_love"];

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

export default function ToneEditor({ initial, updateProfile, onBack }: Props) {
  // Coerce any stored invalid tone to "bestie" (ported from the flat form).
  const [tone, setTone] = useState<Tone>(
    TONES.includes(initial.tone) ? initial.tone : "bestie"
  );

  const select = (t: Tone) => {
    setTone(t);
    void updateProfile((p) => ({ ...p, tone: t }));
  };

  return (
    <EditorScaffold
      eyebrow="COACHING"
      title="Coach's tone"
      description="How you want Coach to talk. Switch any time."
      onBack={onBack}
    >
      <View style={s.optionList}>
        {TONES.map((t) => (
          <OptionRow
            key={t}
            label={TONE_LABELS[t]}
            selected={tone === t}
            onPress={() => select(t)}
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
