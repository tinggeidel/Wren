import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { Profile } from "./lib/types";
import { colors } from "./lib/theme";
import { tabIcons, type TabIconKey } from "./components/TabIcons";
import { loadProfile, saveProfile, clearAllData, clearChat } from "./lib/storage";
import CoachScreen from "./screens/CoachScreen";
import FoodScreen from "./screens/FoodScreen";
import CycleScreen from "./screens/CycleScreen";
import WorkoutScreen from "./screens/WorkoutScreen";
import ProgressScreen from "./screens/ProgressScreen";
import SettingsScreen from "./screens/SettingsScreen";
import OnboardingScreen from "./screens/OnboardingScreen";

// "settings" is a valid screen but not a bottom-bar tab — it's opened from the
// gear in the Coach header.
type Tab = "coach" | "food" | "cycle" | "workout" | "progress" | "settings";

// Every bottom-bar tab's key is a TabIconKey (settings is opened from the gear,
// not the bar, so it never appears here). `icon` references the line-art SVG by
// key; TabBar resolves it through tabIcons.
const TABS: { key: TabIconKey; label: string; icon: TabIconKey }[] = [
  { key: "coach", label: "Coach", icon: "coach" },
  { key: "food", label: "Food", icon: "food" },
  { key: "cycle", label: "Cycle", icon: "cycle" },
  { key: "workout", label: "Workout", icon: "workout" },
  { key: "progress", label: "Progress", icon: "progress" },
];

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = t.key === tab;
        const Icon = tabIcons[t.icon];
        return (
          <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => onChange(t.key)}>
            <View style={styles.tabIcon}>
              <Icon active={active} color={colors.ink} />
            </View>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function App() {
  // Load Manrope (OFL, via @expo-google-fonts/manrope) as the app's single type
  // family. The @expo-google-fonts keys ARE the fontFamily strings used in
  // styles (e.g. "Manrope_700Bold"). Render is gated below until fontsLoaded so
  // the first paint doesn't flash the system font before Manrope is ready —
  // this reuses the existing loading gate (no new layout element).
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("coach");
  // Bumped when onboarding finishes on the "create a workout plan" path. The
  // Workout tab watches this counter and auto-opens its plan-setup sheet — a
  // counter (not a boolean) so a later re-trigger always fires the effect.
  const [planSetupSignal, setPlanSetupSignal] = useState(0);
  // Bumped when the user clears chat history from Settings. CoachScreen stays
  // mounted across tab switches, so its on-mount kickoff can't re-fire after a
  // Settings-side clear; it watches this counter and runs its own clear+reboot
  // so the Coach always lands on a fresh greeting (never an empty screen). A
  // counter (not a boolean) so repeated clears each refire CoachScreen's effect.
  const [chatClearSignal, setChatClearSignal] = useState(0);
  // Set when a Workout day card's "Or ask your Coach to adjust your plan →" link
  // is tapped. Carries the tapped day's real date + human label so CoachScreen
  // can inject a day-specific opener. Nonce'd (same pattern as the signals above)
  // so re-tapping the SAME day still fires CoachScreen's once-per-nonce effect.
  const [coachAdjustReq, setCoachAdjustReq] = useState<{
    dateISO: string;
    label: string;
    nonce: number;
  } | null>(null);

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

  // "Start over": erase everything on disk, then drop the in-memory profile so the
  // first-run gating (`!profile` below) re-triggers and OnboardingScreen renders.
  // profileRef MUST be cleared too — it's the single source of truth, and leaving a
  // stale profile here would let it leak into the next onboarding's initProfile.
  // Reset the tab back to the default (Coach) so re-onboarding lands cleanly.
  const resetApp = useCallback(async (): Promise<void> => {
    await clearAllData();
    profileRef.current = null;
    setProfile(null);
    setTab("coach");
  }, []);

  // "Clear chat history" (invoked from Settings, after its destructive confirm).
  // We clear the persisted chat here, then bump chatClearSignal so the mounted
  // CoachScreen reboots with a fresh kickoff. CoachScreen also calls clearChat()
  // itself (idempotent) and owns the in-memory message/summary reset + the
  // kickoff call, since those refs live there. Profile + all logs are untouched.
  const clearChatHistory = useCallback(async (): Promise<void> => {
    await clearChat();
    setChatClearSignal((n) => n + 1);
  }, []);

  useEffect(() => {
    loadProfile()
      .then((p) => {
        profileRef.current = p;
        setProfile(p);
        setLoading(false);
        // Pass 2a: loadProfile densified any stored plan in-memory (added the
        // missing weekday slots). Persist it back once so the migration sticks on
        // disk rather than only living for this session. Idempotent — densifyWeek
        // is a no-op on an already-dense plan, so re-launches don't keep rewriting.
        // Fire-and-forget; saveProfile swallows write errors and the in-memory
        // profile is already the source of truth for this session.
        if (p?.plan) void saveProfile(p);
      })
      .catch(() => {
        // Belt-and-suspenders: a rejection must never leave us stuck on the
        // spinner. Fall through to first-run (profile null) so the app recovers.
        profileRef.current = null;
        setProfile(null);
        setLoading(false);
      });
  }, []);

  // Onboarding renders full-bleed (outside the top/bottom-inset SafeAreaView) so
  // its ambient mesh paints behind the status bar; OnboardingScreen applies the
  // safe-area insets to its own content. The loading and main-app branches keep
  // the inset SafeAreaView so the tab screens are unchanged.
  if (loading || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
          <StatusBar style="dark" />
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!profile) {
    // First run: the guided onboarding flow, no tabs until there's a profile.
    // It builds the complete first Profile from scratch (same documented
    // shape — no widening) and persists it via initProfile, which makes it the
    // single source of truth, then lands on the chosen tab. Returning users
    // (a stored profile exists) skip this entirely; Settings (the gear) stays
    // the place to edit the profile later.
    //
    // onDone receives where she chose to start: "coach" (default) or
    // "workout". For "workout" we land on the Workout tab AND bump
    // planSetupSignal so that screen auto-opens its plan-setup sheet.
    //
    // Rendered outside the inset SafeAreaView (full-bleed) so the onboarding
    // ambient layer reaches the true top/bottom edges; OnboardingScreen reads
    // useSafeAreaInsets() itself to keep its content within the safe area.
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <OnboardingScreen
          initProfile={initProfile}
          onDone={(dest) => {
            if (dest === "workout") {
              setTab("workout");
              setPlanSetupSignal((n) => n + 1);
            } else {
              setTab("coach");
            }
          }}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <MainShell
        profile={profile}
        updateProfile={updateProfile}
        tab={tab}
        setTab={setTab}
        chatClearSignal={chatClearSignal}
        planSetupSignal={planSetupSignal}
        coachAdjustReq={coachAdjustReq}
        setCoachAdjustReq={setCoachAdjustReq}
        resetApp={resetApp}
        clearChatHistory={clearChatHistory}
      />
    </SafeAreaProvider>
  );
}

// The mounted-tabs shell. Lives INSIDE SafeAreaProvider so it can call
// useSafeAreaInsets() — the top-inset band (below) needs the real inset height,
// which is only available under the provider. Splitting this out of App keeps
// the hook legal (App itself renders the provider, so it can't read insets).
function MainShell({
  profile,
  updateProfile,
  tab,
  setTab,
  chatClearSignal,
  planSetupSignal,
  coachAdjustReq,
  setCoachAdjustReq,
  resetApp,
  clearChatHistory,
}: {
  profile: Profile;
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  tab: Tab;
  setTab: (t: Tab) => void;
  chatClearSignal: number;
  planSetupSignal: number;
  coachAdjustReq: { dateISO: string; label: string; nonce: number } | null;
  setCoachAdjustReq: (
    updater: (
      p: { dateISO: string; label: string; nonce: number } | null
    ) => { dateISO: string; label: string; nonce: number } | null
  ) => void;
  resetApp: () => Promise<void>;
  clearChatHistory: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  return (
    // The shared SafeAreaView stays neutral white (styles.flex) for EVERY tab,
    // so each tab's existing top/bottom inset appearance is unchanged — Coach,
    // Food, Cycle, Workout and Settings all keep sitting on white at the top,
    // and the bottom inset below the white TabBar stays white on every tab.
    <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      {/* Progress-only: paint the top safe-area/status-bar strip with the warm
          Progress page background so its color runs THROUGH the notch with no
          white band above the header. This is an absolutely-positioned band of
          exactly the top-inset height, behind the (transparent at the top)
          Progress screen content. It only renders on the Progress tab, so no
          other tab's top strip is touched; the bottom inset is left white for
          all tabs (the warm color only needs to reach up, not down). */}
      {tab === "progress" && (
        <View
          pointerEvents="none"
          style={[styles.topInsetBand, { height: insets.top, backgroundColor: colors.progressBg }]}
        />
      )}
      <View style={styles.flex}>
        {/* All screens stay mounted; inactive ones are hidden so the Coach's
            daily kickoff doesn't re-fire every time you switch tabs. */}
        <View style={styles.flex}>
          <View style={tab === "coach" ? styles.flex : styles.hidden}>
            <CoachScreen
              profile={profile}
              updateProfile={updateProfile}
              onOpenSettings={() => setTab("settings")}
              clearSignal={chatClearSignal}
              adjustRequest={coachAdjustReq}
            />
          </View>
          <View style={tab === "food" ? styles.flex : styles.hidden}>
            <FoodScreen
              profile={profile}
              updateProfile={updateProfile}
              onOpenCoach={() => setTab("coach")}
              active={tab === "food"}
            />
          </View>
          <View style={tab === "cycle" ? styles.flex : styles.hidden}>
            <CycleScreen
              profile={profile}
              updateProfile={updateProfile}
              onOpenSettings={() => setTab("settings")}
            />
          </View>
          <View style={tab === "workout" ? styles.flex : styles.hidden}>
            <WorkoutScreen
              profile={profile}
              updateProfile={updateProfile}
              onOpenCoach={() => setTab("coach")}
              onAdjustDayWithCoach={(ref) => {
                setTab("coach");
                setCoachAdjustReq((p) => ({ ...ref, nonce: (p?.nonce ?? 0) + 1 }));
              }}
              onOpenSettings={() => setTab("settings")}
              openSetupSignal={planSetupSignal}
              active={tab === "workout"}
            />
          </View>
          <View style={tab === "progress" ? styles.flex : styles.hidden}>
            <ProgressScreen
              profile={profile}
              updateProfile={updateProfile}
              onOpenSettings={() => setTab("settings")}
              onJumpToCycleDay={() => setTab("cycle")}
              active={tab === "progress"}
            />
          </View>
          <View style={tab === "settings" ? styles.flex : styles.hidden}>
            <SettingsScreen
              initial={profile}
              updateProfile={updateProfile}
              onClose={() => setTab("coach")}
              onReset={resetApp}
              onClearChat={clearChatHistory}
            />
          </View>
        </View>
        <TabBar tab={tab} onChange={setTab} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  hidden: { display: "none" },
  // Progress-only top-inset band — covers exactly the status-bar/notch strip
  // (the SafeAreaView's top padding) so the Progress page's warm background
  // runs through the notch. Absolutely positioned across the top; height is set
  // inline to the live top inset. Behind content, non-interactive.
  topInsetBand: { position: "absolute", top: 0, left: 0, right: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 6,
    backgroundColor: "#fff",
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 4 },
  tabIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 11, color: "#999", marginTop: 2, fontFamily: "Manrope_600SemiBold" },
  tabLabelActive: { color: colors.ink },
});
