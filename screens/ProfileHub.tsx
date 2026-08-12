import type { ReactNode } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, type, spacing, radius } from "../lib/theme";

// ============================================================================
// ProfileHub — PRESENTATIONAL profile-hub screen, mockup-matched to
// brand/Coach Tab/Mock Up/wren_profile_enhanced.html
//
// This component computes nothing and fetches nothing. Every value and every
// callback is supplied by the implementer via ProfileHubProps; this file only
// renders. (Step 1 of the IA refactor — navigation + detail editors + data
// are wired by the implementer afterward.)
// ============================================================================

type PhotoSlots = { filled: number; total: number }; // e.g. {filled:0,total:3}

export type ProfileHubProps = {
  // hero
  initials: string; // "TG"
  name: string; // "Ting"
  profilePhotoUri?: string; // if set, render the photo instead of initials
  bodyLine: string; // "28 · 5'4\" · 128 lb"  (may be "" if unknown)
  phaseText: string; // "luteal · cycle day 26" | "On birth control" | "Cycle not set"
  phaseDotColor: string; // a color string the impl passes (from phaseColors)
  onClose: () => void; // the × button
  onPickProfilePhoto: () => void; // the "+" badge
  // COACHING
  goalPreview: string;
  tonePreview: string;
  prefsPreview: string;
  onEditGoal: () => void;
  onEditTone: () => void;
  onEditPrefs: () => void;
  // BODY
  bodyPreview: string;
  activityPreview: string;
  photoSlots: PhotoSlots;
  onEditBody: () => void;
  onEditActivity: () => void;
  onEditPhotos: () => void;
  // TARGETS
  targetsPreview: string; // "1,780 kcal"
  goalModePreview: string; // "Static" | "Net"
  onEditTargets: () => void;
  onEditGoalMode: () => void;
  // CYCLE
  cyclePreview: string; // "28-day · day 26"
  onEditCycle: () => void;
  // COACH MEMORY
  memoryCount: number; // 3
  onEditMemory: () => void;
  // destructive
  onClearChat: () => void;
  onStartOver: () => void;
};

// --- Chevron (the › on every row) ------------------------------------------
// Rendered as a glyph in camel/handle per the mockup (color: #C8A989).
function Chevron() {
  return <Text style={styles.chevron}>{"›"}</Text>;
}

// --- Section header (color dot + uppercase label) --------------------------
function SectionHeader({ dotColor, label }: { dotColor: string; label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionDot, { backgroundColor: dotColor }]} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

// --- A single tappable hairline row ----------------------------------------
// `first` adds the top hairline; `last` adds the bottom hairline. The right
// side is `children` (the preview value + optional mini-viz) followed by the
// chevron, all baseline-aligned per the mockup.
function Row({
  label,
  onPress,
  first,
  last,
  wide,
  children,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
  // `wide` = the mockup's 8px right-cluster gap, used on rows whose preview
  // carries a mini-viz (calorie ring / phase dial / count badge). Plain rows
  // use the default 6px gap.
  wide?: boolean;
  children: ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, first && styles.rowTopRule, last && styles.rowBottomRule]}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={[styles.rowValueWrap, wide && styles.rowValueWrapWide]}>
        {children}
        <Chevron />
      </View>
    </TouchableOpacity>
  );
}

// --- Mini calorie ring (TARGETS) -------------------------------------------
// Decorative: vapor track + a fixed ~70% slate arc, per the mockup's inline
// SVG (track #E3E8E9, arc #8DA3A8). 18x18.
function CalorieRing() {
  return (
    <Svg width={18} height={18} viewBox="0 0 20 20">
      <Circle
        cx={10}
        cy={10}
        r={7.5}
        fill="none"
        stroke={colors.surfaceMuted}
        strokeWidth={2.5}
      />
      <Path
        d="M 10 2.5 A 7.5 7.5 0 1 1 2.6 7.0"
        fill="none"
        stroke={colors.profileSlate}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// --- Mini phase dial (CYCLE) -----------------------------------------------
// Decorative: the 4-segment ring + marker dot from the mockup, mapped to brand
// phase-family hues. Arc strokes (clockwise from top): warmAlert (menstrual
// warm), profileSage (follicular), vapor (neutral/empty), profileRose (luteal).
// Marker dot = ink with a white ring. 18x18.
function PhaseDial() {
  return (
    <Svg width={18} height={18} viewBox="0 0 20 20">
      <Path
        d="M 10 3 A 7 7 0 0 1 16.65 7.42"
        fill="none"
        stroke={colors.warmAlert}
        strokeWidth={2.4}
      />
      <Path
        d="M 16.65 7.42 A 7 7 0 0 1 14.5 16.0"
        fill="none"
        stroke={colors.profileSage}
        strokeWidth={2.4}
      />
      <Path
        d="M 14.5 16.0 A 7 7 0 0 1 6.0 16.36"
        fill="none"
        stroke={colors.surfaceMuted}
        strokeWidth={2.4}
      />
      <Path
        d="M 6.0 16.36 A 7 7 0 0 1 10 3"
        fill="none"
        stroke={colors.profileRose}
        strokeWidth={2.4}
      />
      <Circle
        cx={5.0}
        cy={14.8}
        r={1.8}
        fill={colors.ink}
        stroke={colors.paper}
        strokeWidth={0.8}
      />
    </Svg>
  );
}

// --- Photo-slot indicator (BODY > Body photos) -----------------------------
// `total` small dashed camel squares; the first `filled` rendered filled.
function PhotoSlotDots({ filled, total }: PhotoSlots) {
  return (
    <View style={styles.photoSlots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.photoSlot, i < filled && styles.photoSlotFilled]}
        />
      ))}
    </View>
  );
}

export function ProfileHub(props: ProfileHubProps) {
  const {
    initials,
    name,
    profilePhotoUri,
    bodyLine,
    phaseText,
    phaseDotColor,
    onClose,
    onPickProfilePhoto,
    goalPreview,
    tonePreview,
    prefsPreview,
    onEditGoal,
    onEditTone,
    onEditPrefs,
    bodyPreview,
    activityPreview,
    photoSlots,
    onEditBody,
    onEditActivity,
    onEditPhotos,
    targetsPreview,
    goalModePreview,
    onEditTargets,
    onEditGoalMode,
    cyclePreview,
    onEditCycle,
    memoryCount,
    onEditMemory,
    onClearChat,
    onStartOver,
  } = props;

  return (
    <View style={styles.container}>
      {/* Header: eyebrow + wordmark, with a × close top-right */}
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>YOUR WREN PROFILE</Text>
          <Text style={styles.wordmark}>profile</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close profile"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.closeGlyph}>{"×"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card */}
        <View style={styles.hero}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              {profilePhotoUri ? (
                <Image source={{ uri: profilePhotoUri }} style={styles.avatarPhoto} />
              ) : (
                <Text style={styles.avatarInitials}>{initials}</Text>
              )}
            </View>
            <TouchableOpacity
              onPress={onPickProfilePhoto}
              style={styles.photoBadge}
              accessibilityRole="button"
              accessibilityLabel="Add profile photo"
            >
              <Text style={styles.photoBadgePlus}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroName}>{name}</Text>
            {bodyLine !== "" && <Text style={styles.heroBodyLine}>{bodyLine}</Text>}
            <View style={styles.heroPhaseRow}>
              <View
                style={[styles.heroPhaseDot, { backgroundColor: phaseDotColor }]}
              />
              <Text style={styles.heroPhaseText}>{phaseText}</Text>
            </View>
          </View>
        </View>

        {/* COACHING */}
        <View style={styles.sectionFirst}>
          <SectionHeader dotColor={colors.ink} label="COACHING" />
          <Row label="Goal" onPress={onEditGoal} first>
            <Text style={styles.rowValue}>{goalPreview}</Text>
          </Row>
          <Row label={"Coach’s tone"} onPress={onEditTone} first>
            <Text style={styles.rowValue}>{tonePreview}</Text>
          </Row>
          <Row label="Preferences & rules" onPress={onEditPrefs} first last>
            <Text style={styles.rowValue}>{prefsPreview}</Text>
          </Row>
        </View>

        {/* BODY */}
        <View style={styles.section}>
          <SectionHeader dotColor={colors.handle} label="BODY" />
          <Row label="Your body" onPress={onEditBody} first>
            <Text style={styles.rowValue}>{bodyPreview}</Text>
          </Row>
          <Row label="Activity" onPress={onEditActivity} first>
            <Text style={styles.rowValue}>{activityPreview}</Text>
          </Row>
          <Row
            label="Body photos"
            onPress={onEditPhotos}
            first
            last
            accessibilityLabel={`Body photos, ${photoSlots.filled} of ${photoSlots.total}`}
          >
            <PhotoSlotDots filled={photoSlots.filled} total={photoSlots.total} />
            <Text style={styles.rowValue}>
              {photoSlots.filled} of {photoSlots.total}
            </Text>
          </Row>
        </View>

        {/* TARGETS */}
        <View style={styles.section}>
          <SectionHeader dotColor={colors.profileSlate} label="TARGETS" />
          <Row label="Daily targets" onPress={onEditTargets} first wide>
            <CalorieRing />
            <Text style={styles.rowValue}>{targetsPreview}</Text>
          </Row>
          <Row label="Goal mode" onPress={onEditGoalMode} first last>
            <Text style={styles.rowValue}>{goalModePreview}</Text>
          </Row>
        </View>

        {/* CYCLE */}
        <View style={styles.section}>
          <SectionHeader dotColor={colors.profileRose} label="CYCLE" />
          <Row label="Cycle settings" onPress={onEditCycle} first last wide>
            <PhaseDial />
            <Text style={styles.rowValue}>{cyclePreview}</Text>
          </Row>
        </View>

        {/* COACH MEMORY */}
        <View style={styles.section}>
          <SectionHeader dotColor={colors.profileSage} label="COACH MEMORY" />
          <Row
            label="What Coach remembers"
            onPress={onEditMemory}
            first
            last
            wide
            accessibilityLabel={`What Coach remembers, ${memoryCount} things saved`}
          >
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{memoryCount}</Text>
            </View>
            <Text style={styles.rowValue}>things saved</Text>
          </Row>
        </View>

        {/* Destructive area */}
        <View style={styles.destructiveWrap}>
          <TouchableOpacity
            onPress={onClearChat}
            style={styles.clearPill}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Clear chat history"
          >
            <Text style={styles.clearPillText}>CLEAR CHAT HISTORY</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.startOverWrap}>
          <TouchableOpacity
            onPress={onStartOver}
            accessibilityRole="button"
            accessibilityLabel="Start over"
          >
            <Text style={styles.startOverText}>START OVER</Text>
          </TouchableOpacity>
          <Text style={styles.startOverSubtitle}>
            erases everything and restarts onboarding
          </Text>
        </View>

        {/* Watermark */}
        <View style={styles.watermarkWrap}>
          <Text style={styles.watermarkWord}>wren</Text>
          <Text style={styles.watermarkTag}>A SOFTER SCIENCE</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper, // white hub surface per mockup (#FFFFFF)
  },

  // --- Header --------------------------------------------------------------
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing["2xl"], // 24
    paddingTop: spacing.lg, // 16 (status-bar area is owned by the host)
    paddingBottom: spacing.xs, // 4 — descender room below the wordmark
  },
  headerTextWrap: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: type.ui.family,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.inkMuted,
    marginBottom: spacing.xs, // 4
  },
  wordmark: {
    fontFamily: type.display.family,
    fontSize: 38,
    letterSpacing: -1.5,
    color: colors.ink,
    // Root cause of the on-device clip: lineHeight 38 == fontSize gave the
    // lowercase 'p' no descender room, so its tail was cut off (and on some
    // devices the tight box also truncated the eyebrow above). Raise to 46 so
    // the descender clears; includeFontPadding:false keeps the top from gaining
    // extra slack on Android. Do NOT lower lineHeight back to the font size.
    lineHeight: 46,
    includeFontPadding: false,
  },
  closeBtn: {
    padding: spacing.xs, // 4
    marginBottom: spacing.xs, // 4 — baseline-nudge to match mockup
  },
  closeGlyph: {
    fontFamily: type.ui.family,
    fontSize: 22,
    lineHeight: 22,
    color: colors.inkMuted,
  },

  scrollContent: {
    paddingBottom: spacing.sm, // tail handled by watermark padding
  },

  // --- Hero ----------------------------------------------------------------
  hero: {
    marginTop: 22,
    marginHorizontal: 18,
    backgroundColor: colors.creamTile, // #F5EFE6
    borderRadius: 18,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg, // 16
  },
  avatarWrap: {
    position: "relative",
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.ink, // cocoa
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarPhoto: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  avatarInitials: {
    fontFamily: type.display.family,
    fontSize: 26,
    letterSpacing: -0.5,
    color: colors.surface, // cream on cocoa
  },
  photoBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.paper, // white
    borderWidth: 0.5,
    borderColor: colors.badgeBorder, // cocoa @15%
    alignItems: "center",
    justifyContent: "center",
    // subtle lift per mockup: box-shadow 0 1px 4px rgba(0,0,0,0.06)
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  photoBadgePlus: {
    fontFamily: type.ui.family,
    fontSize: 18,
    lineHeight: 18,
    color: colors.ink,
    marginTop: -1,
  },
  heroText: {
    flex: 1,
  },
  heroName: {
    fontFamily: type.display.family,
    fontSize: 22,
    letterSpacing: -0.5,
    color: colors.ink,
    lineHeight: 24,
  },
  heroBodyLine: {
    fontFamily: type.body.family,
    fontSize: type.size.caption, // 12
    color: colors.cocoaSoft, // #6B5641
    marginTop: 5,
    lineHeight: 17,
  },
  heroPhaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: spacing.xs, // 4
  },
  heroPhaseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heroPhaseText: {
    fontFamily: type.body.family,
    fontSize: type.size.micro, // 11
    color: colors.mistDark, // #4F6B70
  },

  // --- Sections ------------------------------------------------------------
  sectionFirst: {
    marginTop: spacing["2xl"], // 24 (COACHING)
  },
  section: {
    marginTop: 22,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm - 2, // 6
    paddingHorizontal: spacing["2xl"], // 24
    paddingBottom: spacing.sm, // 8
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sectionLabel: {
    fontFamily: type.label.family, // semibold
    fontSize: 9,
    letterSpacing: 2,
    color: colors.inkMuted,
  },

  // --- Rows ----------------------------------------------------------------
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg - 2, // 14
    paddingHorizontal: spacing["2xl"], // 24
  },
  rowTopRule: {
    borderTopWidth: 0.5,
    borderTopColor: colors.rowHairline, // cocoa @8%
  },
  rowBottomRule: {
    borderBottomWidth: 0.5,
    borderBottomColor: colors.rowHairline, // cocoa @8%
  },
  rowLabel: {
    fontFamily: type.ui.family, // medium
    fontSize: type.size.callout, // 14
    color: colors.ink,
  },
  rowValueWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm - 2, // 6 — default right-cluster gap (plain rows)
    flexShrink: 1,
    marginLeft: spacing.md, // 12 — keep value off a long label
    justifyContent: "flex-end",
  },
  rowValueWrapWide: {
    gap: spacing.sm, // 8 — mini-viz rows (ring / dial / badge) per mockup
  },
  rowValue: {
    fontFamily: type.body.family,
    fontSize: type.size.caption, // 12
    color: colors.inkMuted,
    textAlign: "right",
    flexShrink: 1,
  },
  chevron: {
    fontFamily: type.body.family,
    fontSize: type.size.callout, // 14 — reads as the › glyph size in mockup
    lineHeight: type.size.callout,
    color: colors.handle, // camel
  },

  // --- Photo-slot dots -----------------------------------------------------
  photoSlots: {
    flexDirection: "row",
    gap: 3,
  },
  photoSlot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.handle, // camel dashed
  },
  photoSlotFilled: {
    backgroundColor: colors.handle, // filled slot = solid camel
    borderStyle: "solid",
  },

  // --- Count badge (COACH MEMORY) ------------------------------------------
  countBadge: {
    backgroundColor: colors.surfaceMuted, // vapor
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, // 8
    paddingVertical: 2,
  },
  countBadgeText: {
    fontFamily: type.numeral.family, // bold (700) — matches the mockup's badge weight
    fontSize: type.size.nano, // 10
    color: colors.mistDark, // #4F6B70
    letterSpacing: -0.2,
  },

  // --- Destructive ---------------------------------------------------------
  destructiveWrap: {
    paddingTop: 30,
    paddingHorizontal: spacing["2xl"], // 24
    paddingBottom: spacing.md, // 12
  },
  clearPill: {
    borderWidth: 1.5,
    borderColor: colors.warmAlert,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  clearPillText: {
    fontFamily: type.label.family, // semibold
    fontSize: type.size.caption, // 12
    letterSpacing: 2,
    color: colors.warmAlert,
  },
  startOverWrap: {
    paddingHorizontal: spacing["2xl"], // 24
    paddingBottom: spacing.sm, // 8
    alignItems: "center",
  },
  startOverText: {
    fontFamily: type.label.family, // semibold
    fontSize: type.size.micro, // 11
    letterSpacing: 2,
    color: colors.warmAlert,
    paddingVertical: spacing.sm, // 8
  },
  startOverSubtitle: {
    fontFamily: type.body.family,
    fontSize: type.size.nano, // 10
    color: colors.inkMuted,
    marginTop: 2,
  },

  // --- Watermark -----------------------------------------------------------
  watermarkWrap: {
    paddingTop: spacing["2xl"] + 2, // 26
    paddingHorizontal: spacing["2xl"], // 24
    paddingBottom: spacing["3xl"] - 4, // 28
    alignItems: "center",
  },
  watermarkWord: {
    fontFamily: type.display.family,
    fontSize: 20,
    letterSpacing: -0.5,
    color: colors.handle, // camel
    lineHeight: 20,
  },
  watermarkTag: {
    fontFamily: type.body.family,
    fontSize: 8,
    letterSpacing: 2.5,
    color: colors.handle, // camel
    marginTop: spacing.sm - 2, // 6
  },
});

export default ProfileHub;
