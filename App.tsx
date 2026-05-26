import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Profile } from "./lib/types";
import { loadProfile, saveProfile } from "./lib/storage";
import CoachScreen from "./screens/CoachScreen";
import FoodScreen from "./screens/FoodScreen";
import CycleScreen from "./screens/CycleScreen";
import WorkoutScreen from "./screens/WorkoutScreen";
import ProgressScreen from "./screens/ProgressScreen";
import SettingsScreen from "./screens/SettingsScreen";

// "settings" is a valid screen but not a bottom-bar tab — it's opened from the
// gear in the Coach header.
type Tab = "coach" | "food" | "cycle" | "workout" | "progress" | "settings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "coach", label: "Coach", icon: "💬" },
  { key: "food", label: "Food", icon: "🍎" },
  { key: "cycle", label: "Cycle", icon: "🌸" },
  { key: "workout", label: "Workout", icon: "🏋️" },
  { key: "progress", label: "Progress", icon: "📈" },
];

const ACCENT = "#7c3aed";

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = t.key === tab;
        return (
          <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => onChange(t.key)}>
            <Text style={[styles.tabIcon, { opacity: active ? 1 : 0.5 }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("coach");

  // SINGLE source of truth for the live profile. Every persistence path (Coach
  // tools AND all screens) routes through updateProfile, which always applies the
  // change to the FRESHEST profile via this ref — never a stale render snapshot.
  // This kills the save-race: two writes that land back-to-back (e.g. the Coach
  // logging food while the Food tab edits an entry) compose instead of one
  // silently clobbering the other. profileRef mirrors the `profile` state.
  const profileRef = useRef<Profile | null>(null);

  // Apply a pure transform to the latest profile, persist it, and return it.
  // The read->compute->set-ref->setState sequence runs SYNCHRONOUSLY before the
  // await, so two concurrent callers can't interleave their critical sections:
  // the second sees the first's result in profileRef.current. saveProfile is the
  // unchanged storage primitive; this only changes HOW we persist, not the shape.
  const updateProfile = useCallback(
    async (updater: (p: Profile) => Profile): Promise<Profile> => {
      const current = profileRef.current;
      // Guard: profile is non-null everywhere updateProfile is wired (the main
      // screens only mount once a profile exists; onboarding uses initProfile, not
      // this). If it's ever called pre-load that's a wiring bug, so throw loudly
      // rather than silently dropping the write. Callers all run inside try/catch
      // or after the profile guard, so this can't strand the UI.
      if (!current) {
        throw new Error("updateProfile called before a profile was loaded");
      }
      const next = updater(current);
      profileRef.current = next;
      setProfile(next);
      await saveProfile(next);
      return next;
    },
    []
  );

  // First-run / onboarding: create and persist the very first profile. Goes
  // through the ref so it becomes the single source of truth immediately, then
  // saves it (Settings' onboarding instance has already not saved it itself —
  // see SettingsScreen.handleSave routing below).
  const initProfile = useCallback(async (p: Profile): Promise<void> => {
    profileRef.current = p;
    setProfile(p);
    await saveProfile(p);
  }, []);

  useEffect(() => {
    loadProfile()
      .then((p) => {
        profileRef.current = p;
        setProfile(p);
        setLoading(false);
      })
      .catch(() => {
        // Belt-and-suspenders: a rejection must never leave us stuck on the
        // spinner. Fall through to first-run (profile null) so the app recovers.
        profileRef.current = null;
        setProfile(null);
        setLoading(false);
      });
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        ) : !profile ? (
          // First run: onboarding, no tabs until there's a profile. The form
          // builds the initial profile from scratch (latest p is irrelevant here
          // since none exists), so we persist it via initProfile and land on Coach.
          <SettingsScreen
            initial={null}
            // Onboarding: no profile exists yet, so the form builds one from
            // scratch. We feed updateProfile an empty base — buildProfileFromForm
            // overlays every field onto it, producing a complete first profile —
            // and persist via initProfile so it becomes the source of truth.
            updateProfile={async (updater) => {
              const next = updater({} as Profile);
              await initProfile(next);
              return next;
            }}
            onSaved={() => setTab("coach")}
          />
        ) : (
          <View style={styles.flex}>
            {/* All screens stay mounted; inactive ones are hidden so the Coach's
                daily kickoff doesn't re-fire every time you switch tabs. */}
            <View style={styles.flex}>
              <View style={tab === "coach" ? styles.flex : styles.hidden}>
                <CoachScreen
                  profile={profile}
                  updateProfile={updateProfile}
                  onOpenSettings={() => setTab("settings")}
                />
              </View>
              <View style={tab === "food" ? styles.flex : styles.hidden}>
                <FoodScreen profile={profile} updateProfile={updateProfile} />
              </View>
              <View style={tab === "cycle" ? styles.flex : styles.hidden}>
                <CycleScreen profile={profile} updateProfile={updateProfile} />
              </View>
              <View style={tab === "workout" ? styles.flex : styles.hidden}>
                <WorkoutScreen
                  profile={profile}
                  updateProfile={updateProfile}
                  onOpenCoach={() => setTab("coach")}
                />
              </View>
              <View style={tab === "progress" ? styles.flex : styles.hidden}>
                <ProgressScreen profile={profile} updateProfile={updateProfile} />
              </View>
              <View style={tab === "settings" ? styles.flex : styles.hidden}>
                <SettingsScreen
                  initial={profile}
                  updateProfile={updateProfile}
                  onSaved={() => setTab("coach")}
                />
              </View>
            </View>
            <TabBar tab={tab} onChange={setTab} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  hidden: { display: "none" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 6,
    backgroundColor: "#fff",
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 4 },
  tabIcon: { fontSize: 22 },
  tabLabel: { fontSize: 11, color: "#999", marginTop: 2, fontWeight: "600" },
  tabLabelActive: { color: ACCENT },
});
