import React, { useState } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  Profile,
  GOAL_LABELS,
  TONE_LABELS,
  ACTIVITY_LABELS,
  CALORIE_MODE_LABELS,
  Tone,
} from "../lib/types";
import { computeTargets } from "../lib/targets";
import { currentPhase } from "../lib/cycle";
import { phaseColors, colors } from "../lib/theme";
import ProfileHub from "./ProfileHub";
import GoalEditor from "./profile/GoalEditor";
import ToneEditor from "./profile/ToneEditor";
import PrefsEditor from "./profile/PrefsEditor";
import BodyEditor from "./profile/BodyEditor";
import ActivityEditor from "./profile/ActivityEditor";
import PhotosEditor from "./profile/PhotosEditor";
import TargetsEditor from "./profile/TargetsEditor";
import GoalModeEditor from "./profile/GoalModeEditor";
import CycleEditor from "./profile/CycleEditor";
import MemoryEditor from "./profile/MemoryEditor";

// Which detail editor is open. `null` = the profile hub.
type ProfileRoute =
  | null
  | "goal"
  | "tone"
  | "prefs"
  | "body"
  | "activity"
  | "photos"
  | "targets"
  | "goalMode"
  | "cycle"
  | "memory";

const TONES: Tone[] = ["hype", "bestie", "tough_love"];

export default function SettingsScreen({
  initial,
  updateProfile,
  onClose,
  onReset,
  onClearChat,
}: {
  initial: Profile;
  // Single shared updater (App.tsx). Applies the editor's overlay to the LATEST
  // profile, never a render-time snapshot, so sibling maps and any out-of-band
  // Coach writes are preserved on save. Each editor writes only its own fields.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  // Return to the Coach tab (the profile is opened from the Coach avatar). The
  // hub's × close calls this. Replaces the old "Save & go to Coach" flow — saves
  // are now per-editor and return to the hub, not to Coach.
  onClose: () => void;
  // "Start over": wipe all data and return to onboarding (App.resetApp). Only
  // called after the destructive confirm in handleStartOver below.
  onReset: () => Promise<void>;
  // "Clear chat history": wipe only the Coach conversation. Only called after the
  // destructive confirm in handleClearChat below.
  onClearChat: () => Promise<void>;
}) {
  const [route, setRoute] = useState<ProfileRoute>(null);

  // ----- destructive confirms ------------------------------------------------
  // The hub fires its onClearChat/onStartOver raw; we route them through these
  // two-tap confirm Alerts (ported verbatim from the flat form) so a stray tap
  // can't wipe data.
  function handleStartOver() {
    Alert.alert(
      "Start over?",
      "This erases all your data — profile, logs, chat, plan, everything — and restarts onboarding. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Erase & restart", style: "destructive", onPress: () => void onReset() },
      ]
    );
  }

  function handleClearChat() {
    Alert.alert(
      "Clear chat history?",
      "This deletes your Coach conversation on this device. Your profile, targets, and logs stay.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: () => void onClearChat() },
      ]
    );
  }

  // ----- profile photo (hero "+") -------------------------------------------
  // Reuses the same expo-image-picker flow as the body-photo slots (camera or
  // library). Writes only `profilePhotoUri`; reads every sibling from the latest
  // `p` (wipe-guard). Lives here (not the hub) so all picker logic stays in the
  // functional layer.
  function pickProfilePhoto() {
    Alert.alert("Profile photo", "Pick a photo or skip.", [
      { text: "Take photo", onPress: () => void storeProfilePhoto("camera") },
      { text: "Choose from library", onPress: () => void storeProfilePhoto("library") },
      ...(initial.profilePhotoUri
        ? [
            {
              text: "Remove",
              style: "destructive" as const,
              onPress: () =>
                void updateProfile((p) => ({ ...p, profilePhotoUri: undefined })),
            },
          ]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  async function storeProfilePhoto(source: "camera" | "library") {
    // Same expo-image-picker flow as the body-photo slots (PhotosEditor).
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
      await updateProfile((p) => ({ ...p, profilePhotoUri: uri }));
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  // ----- detail editors ------------------------------------------------------
  const back = () => setRoute(null);
  if (route === "goal")
    return <GoalEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "tone")
    return <ToneEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "prefs")
    return <PrefsEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "body")
    return <BodyEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "activity")
    return <ActivityEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "photos")
    return <PhotosEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "targets")
    return <TargetsEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "goalMode")
    return <GoalModeEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "cycle")
    return <CycleEditor initial={initial} updateProfile={updateProfile} onBack={back} />;
  if (route === "memory")
    return <MemoryEditor initial={initial} updateProfile={updateProfile} onBack={back} />;

  // ----- hub preview values (the hub computes nothing) -----------------------
  // Initials — mirrors CoachScreen's derivation.
  const initials =
    (initial.name ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const tone: Tone = TONES.includes(initial.tone) ? initial.tone : "bestie";

  // bodyLine: non-empty age/height/weight joined with " · ".
  const bodyLine = [initial.age, initial.height, initial.weight]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" · ");

  // Phase line + dot color from currentPhase(profile).
  const phase = currentPhase(initial);
  let phaseText: string;
  let phaseDotColor: string;
  if (phase.phase === "off") {
    phaseText = "Cycle tracking off";
    phaseDotColor = colors.inkMuted;
  } else if (phase.onBirthControl) {
    phaseText = "On birth control";
    phaseDotColor = colors.inkMuted;
  } else if (phase.dayOfCycle != null) {
    phaseText = `${phase.phase} · cycle day ${phase.dayOfCycle}`;
    phaseDotColor = phaseColors[phase.phase]?.bg ?? colors.inkMuted;
  } else {
    phaseText = "Cycle not set";
    phaseDotColor = colors.inkMuted;
  }

  // Short, honest summary of the free-text rules.
  const rules = (initial.dietaryRules ?? "").trim();
  let prefsPreview: string;
  if (!rules) {
    prefsPreview = "Not set";
  } else {
    const clauses = rules
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    prefsPreview =
      clauses.length > 1 ? `${clauses[0]} · ${clauses.length} rules` : clauses[0] || rules;
  }

  // Photo slots: count of the three URI fields that are set.
  const filledPhotos = [
    initial.currentFrontPhotoUri,
    initial.currentSidePhotoUri,
    initial.goalPhotoUri,
  ].filter(Boolean).length;

  // Targets preview — computeTargets can be null when body fields are sparse.
  const targets = computeTargets(initial);
  const targetsPreview = targets ? `${targets.calories.toLocaleString()} kcal` : "Not set";

  // Cycle preview.
  let cyclePreview: string;
  if (phase.phase === "off") {
    cyclePreview = "Cycle tracking off";
  } else if (phase.onBirthControl) {
    cyclePreview = "On birth control";
  } else if (phase.dayOfCycle != null) {
    cyclePreview = `${initial.avgCycleLength || 28}-day · day ${phase.dayOfCycle}`;
  } else {
    cyclePreview = "Not set";
  }

  return (
    <ProfileHub
      name={initial.name}
      initials={initials}
      profilePhotoUri={initial.profilePhotoUri}
      onPickProfilePhoto={pickProfilePhoto}
      onClose={onClose}
      bodyLine={bodyLine}
      phaseText={phaseText}
      phaseDotColor={phaseDotColor}
      goalPreview={GOAL_LABELS[initial.goal]}
      tonePreview={TONE_LABELS[tone]}
      prefsPreview={prefsPreview}
      onEditGoal={() => setRoute("goal")}
      onEditTone={() => setRoute("tone")}
      onEditPrefs={() => setRoute("prefs")}
      bodyPreview={bodyLine || "Not set"}
      activityPreview={ACTIVITY_LABELS[initial.activityLevel ?? "light"]}
      photoSlots={{ filled: filledPhotos, total: 3 }}
      onEditBody={() => setRoute("body")}
      onEditActivity={() => setRoute("activity")}
      onEditPhotos={() => setRoute("photos")}
      targetsPreview={targetsPreview}
      goalModePreview={CALORIE_MODE_LABELS[initial.calorieMode ?? "static"]}
      onEditTargets={() => setRoute("targets")}
      onEditGoalMode={() => setRoute("goalMode")}
      cyclePreview={cyclePreview}
      onEditCycle={() => setRoute("cycle")}
      memoryCount={initial.coachMemory?.length ?? 0}
      onEditMemory={() => setRoute("memory")}
      onClearChat={handleClearChat}
      onStartOver={handleStartOver}
    />
  );
}
