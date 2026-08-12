import React from "react";
import { View, Text, TouchableOpacity, Image, Alert, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, type, spacing } from "../../lib/theme";
import { Profile } from "../../lib/types";
import { EditorScaffold, editorStyles as s, UpdateProfile } from "./editorChrome";

type Props = {
  initial: Profile;
  updateProfile: UpdateProfile;
  onBack: () => void;
};

// Three photo slots ("front" + "side" self-photos and "goal" direction), stored
// as separate URI fields on Profile. Logic ported verbatim from the flat form:
// every change goes through updateProfile so it composes on the LATEST profile
// (wipe-guard) and persists immediately. The photo URIs are read from the live
// `initial` prop (re-passed after each save) so a retake/delete reflects at once.
type PhotoSlot = "front" | "side" | "goal";

export default function PhotosEditor({ initial, updateProfile, onBack }: Props) {
  const currentFrontPhotoUri = initial.currentFrontPhotoUri;
  const currentSidePhotoUri = initial.currentSidePhotoUri;
  const goalPhotoUri = initial.goalPhotoUri;

  async function pickAndStorePhoto(slot: PhotoSlot, source: "camera" | "library") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Allow camera access to add a photo.");
          return;
        }
      }
      const opts = { mediaTypes: "images" as const };
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;
      const uri = res.assets[0].uri;
      await updateProfile((p) => {
        if (slot === "front") return { ...p, currentFrontPhotoUri: uri };
        if (slot === "side") return { ...p, currentSidePhotoUri: uri };
        return { ...p, goalPhotoUri: uri };
      });
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  function offerRetake(slot: PhotoSlot) {
    const title =
      slot === "front"
        ? "Replace your front photo"
        : slot === "side"
          ? "Replace your side photo"
          : "Replace your goal photo";
    Alert.alert(title, "Pick a new photo or skip.", [
      { text: "Take photo", onPress: () => void pickAndStorePhoto(slot, "camera") },
      { text: "Choose from library", onPress: () => void pickAndStorePhoto(slot, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function handleDeletePhoto(slot: PhotoSlot) {
    await updateProfile((p) => {
      if (slot === "front") return { ...p, currentFrontPhotoUri: undefined };
      if (slot === "side") return { ...p, currentSidePhotoUri: undefined };
      return { ...p, goalPhotoUri: undefined };
    });
  }

  // One 3:4 slot. Empty = dashed camel card with "+" and label. Filled = the
  // image with a small retake/delete overlay (keeps the existing handlers).
  const renderSlot = (slot: PhotoSlot, label: string, uri?: string) => (
    <View style={photoStyles.slotCol}>
      {uri ? (
        <>
          <View style={photoStyles.slotImageBox}>
            <TouchableOpacity
              style={photoStyles.slotImageBtn}
              onPress={() => offerRetake(slot)}
              accessibilityRole="button"
              accessibilityLabel={`Retake ${label} photo`}
            >
              <Image source={{ uri }} style={photoStyles.slotImage} />
            </TouchableOpacity>
            <TouchableOpacity
              style={photoStyles.slotDelete}
              onPress={() => void handleDeletePhoto(slot)}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${label} photo`}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={photoStyles.slotDeleteGlyph}>{"✕"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={photoStyles.slotLabelFilled}>{label}</Text>
        </>
      ) : (
        <TouchableOpacity
          style={photoStyles.slotEmpty}
          onPress={() => offerRetake(slot)}
          accessibilityRole="button"
          accessibilityLabel={`Add ${label} photo`}
        >
          <Text style={photoStyles.slotPlus}>+</Text>
          <Text style={photoStyles.slotLabel}>{label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <EditorScaffold
      eyebrow="BODY"
      title="body photos"
      description="Saved on your device only — never sent. Coach already saw them once and won't reference unless you ask."
      onBack={onBack}
    >
      <View style={photoStyles.grid}>
        {renderSlot("front", "FRONT", currentFrontPhotoUri)}
        {renderSlot("side", "SIDE", currentSidePhotoUri)}
        {renderSlot("goal", "GOAL", goalPhotoUri)}
      </View>

      <View style={s.helperBlock}>
        <Text style={s.helperText}>
          Front and side help you see change over time. Goal photo is whatever
          your body-feeling reference looks like — not a comparison trap.
        </Text>
      </View>

      {/* DONE: each photo already persists immediately on pick/delete
          (pickAndStorePhoto/handleDeletePhoto -> updateProfile, wipe-guarded), so
          DONE just returns to the hub. No save needed here. */}
      <TouchableOpacity style={s.primaryPill} onPress={onBack} accessibilityRole="button">
        <Text style={s.primaryPillText}>DONE</Text>
      </TouchableOpacity>
    </EditorScaffold>
  );
}

const photoStyles = StyleSheet.create({
  grid: { flexDirection: "row", gap: spacing.sm + 2 }, // 10
  slotCol: { flex: 1 },
  // Empty slot — dashed camel border, "+" and label, 3:4 aspect.
  slotEmpty: {
    aspectRatio: 3 / 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.handle, // warm camel dash
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "transparent",
  },
  slotPlus: {
    fontSize: type.size.title - 2, // 22
    fontFamily: type.numeral.family, // bold
    color: colors.ink,
    lineHeight: type.size.title - 2,
  },
  slotLabel: {
    fontSize: 9,
    fontFamily: type.label.family, // semibold
    letterSpacing: 1.5,
    color: colors.cocoaSoft,
  },
  // Filled slot — the image fills the 3:4 box, delete chip top-right, label
  // beneath (the label is a sibling so it doesn't get squeezed by aspectRatio).
  slotImageBox: { aspectRatio: 3 / 4, position: "relative", borderRadius: 14, overflow: "hidden" },
  slotImageBtn: { flex: 1 },
  slotImage: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceMuted,
  },
  slotDelete: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.creamTile,
    alignItems: "center",
    justifyContent: "center",
  },
  slotDeleteGlyph: {
    fontSize: type.size.caption, // 12
    fontFamily: type.label.family,
    color: colors.warmAlert, // warm clay destructive
  },
  slotLabelFilled: {
    fontSize: 9,
    fontFamily: type.label.family,
    letterSpacing: 1.5,
    color: colors.cocoaSoft,
    textAlign: "center",
    marginTop: spacing.sm - 2, // 6
  },
});
