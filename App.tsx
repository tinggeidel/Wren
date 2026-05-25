import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Profile } from "./lib/types";
import { loadProfile } from "./lib/storage";
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

  useEffect(() => {
    loadProfile().then((p) => {
      setProfile(p);
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
          // First run: onboarding, no tabs until there's a profile.
          <SettingsScreen
            initial={null}
            onSaved={(p) => {
              setProfile(p);
              setTab("coach");
            }}
          />
        ) : (
          <View style={styles.flex}>
            {/* All screens stay mounted; inactive ones are hidden so the Coach's
                daily kickoff doesn't re-fire every time you switch tabs. */}
            <View style={styles.flex}>
              <View style={tab === "coach" ? styles.flex : styles.hidden}>
                <CoachScreen
                  profile={profile}
                  onProfileChange={setProfile}
                  onOpenSettings={() => setTab("settings")}
                />
              </View>
              <View style={tab === "food" ? styles.flex : styles.hidden}>
                <FoodScreen profile={profile} onProfileChange={setProfile} />
              </View>
              <View style={tab === "cycle" ? styles.flex : styles.hidden}>
                <CycleScreen profile={profile} onProfileChange={setProfile} />
              </View>
              <View style={tab === "workout" ? styles.flex : styles.hidden}>
                <WorkoutScreen
                  profile={profile}
                  onProfileChange={setProfile}
                  onOpenCoach={() => setTab("coach")}
                />
              </View>
              <View style={tab === "progress" ? styles.flex : styles.hidden}>
                <ProgressScreen profile={profile} onProfileChange={setProfile} />
              </View>
              <View style={tab === "settings" ? styles.flex : styles.hidden}>
                <SettingsScreen
                  initial={profile}
                  onSaved={(p) => {
                    setProfile(p);
                    setTab("coach");
                  }}
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
