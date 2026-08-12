import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { colors, type, spacing, radius } from "../../lib/theme";
import { Profile, CoachMemory } from "../../lib/types";
import { addMemory, removeMemory } from "../../lib/memory";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

export default function MemoryEditor({ initial, updateProfile, onBack }: Props) {
  // The list reads from the live `initial` prop (re-passed after each save) so a
  // delete/add refreshes in place. Both persist immediately and do NOT navigate
  // away; removeMemory/addMemory compose on the latest `p` (wipe-guard).
  const memory: CoachMemory[] = initial.coachMemory ?? [];

  // Inline add-a-memory entry (no Alert.prompt — that's iOS-only).
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const handleForget = (id: string) => {
    void updateProfile((p) => removeMemory(p, id));
  };

  // addMemory stamps today's date, trims, dedupes, and caps (see lib/memory).
  // Blank input is a no-op — just close the entry row.
  const commitAdd = () => {
    const text = draft.trim();
    if (!text) {
      setAdding(false);
      setDraft("");
      return;
    }
    void updateProfile((p) => addMemory(p, text));
    setDraft("");
    setAdding(false);
  };

  return (
    <EditorScaffold
      eyebrow="COACH MEMORY"
      title="what Coach remembers"
      description="Things you've said in chat that Coach should hold onto. Edit or delete any — it's yours."
      onBack={onBack}
    >
      {memory.length === 0 ? (
        <Text style={s.hint}>
          As you chat, your Coach will note lasting things about you here — like
          dietary preferences or injuries. You can forget anything.
        </Text>
      ) : (
        memory.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={memStyles.memoryItem}
            onPress={() => handleForget(m.id)}
            accessibilityRole="button"
            accessibilityLabel={`Forget: ${m.text}`}
          >
            <Text style={memStyles.memoryText}>{m.text}</Text>
            {/* "saved {date}" subline only when the memory carries a date; older
                memories without one omit it (don't fabricate). */}
            <Text style={memStyles.memoryMeta}>
              {m.date ? `saved ${m.date} · tap to forget` : "tap to forget"}
            </Text>
          </TouchableOpacity>
        ))
      )}

      {adding ? (
        <View style={memStyles.addRow}>
          <View style={[s.fieldCard, memStyles.addField]}>
            <TextInput
              style={s.fieldInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Something for Coach to remember"
              placeholderTextColor={colors.inkMuted}
              autoFocus
              multiline
              onSubmitEditing={commitAdd}
              returnKeyType="done"
            />
          </View>
          <TouchableOpacity
            style={[s.outlinePill, memStyles.addPill]}
            onPress={commitAdd}
            accessibilityRole="button"
          >
            <Text style={s.outlinePillText}>SAVE MEMORY</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[s.outlinePill, memStyles.addPill]}
          onPress={() => setAdding(true)}
          accessibilityRole="button"
        >
          <Text style={s.outlinePillText}>+ ADD A MEMORY</Text>
        </TouchableOpacity>
      )}

      <View style={s.helperBlock}>
        <Text style={s.helperText}>
          Coach proposes memories in chat; you confirm. Or add one here directly.
        </Text>
      </View>
    </EditorScaffold>
  );
}

const memStyles = StyleSheet.create({
  // Memory row — creamTile fill, hairline, r12, per the mockup .memory-item.
  memoryItem: {
    backgroundColor: colors.creamTile,
    borderWidth: 0.5,
    borderColor: colors.rowHairline,
    borderRadius: radius.md, // 12
    paddingVertical: spacing.lg - 2, // 14
    paddingHorizontal: spacing.lg, // 16
    marginBottom: spacing.sm, // 8
  },
  memoryText: {
    fontSize: type.size.callout, // 14
    fontFamily: type.body.family,
    color: colors.ink,
    lineHeight: 20,
  },
  memoryMeta: {
    fontSize: type.size.micro, // 11
    fontFamily: type.body.family,
    color: colors.inkMuted, // clay
    marginTop: spacing.xs, // 4
  },
  addRow: { marginTop: spacing.sm },
  addField: { marginBottom: spacing.sm },
  addPill: { alignSelf: "flex-start", marginTop: spacing.sm },
});
