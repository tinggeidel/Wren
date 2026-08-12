import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, type, spacing, radius } from "../../lib/theme";

// Shared updater signature for every profile editor. Mirrors App.updateProfile,
// which returns the next profile; editors don't need the return value but the
// type must match so the wipe-guard transform composes on the LATEST profile.
export type UpdateProfile = (
  updater: (p: import("../../lib/types").Profile) => import("../../lib/types").Profile
) => Promise<import("../../lib/types").Profile>;

/**
 * Shared chrome for every profile detail editor, matching the mockup
 * (brand/Coach Tab/Mock Up/wren_profile_subsheets.html) header lockup:
 *   1. a "‹ PROFILE" back row (cocoa chevron + letter-spaced "PROFILE" 11px)
 *   2. a section eyebrow (9px, clay, 2.5px tracking — e.g. COACHING / BODY)
 *   3. the lowercase wordmark title (32px display, -1.2 tracking, cocoa, with
 *      line-height room so descenders aren't clipped)
 *   4. an optional description line (13px, cocoaSoft, line-height ~1.5)
 * Tokens only (no raw hex, no fontWeight). Top padding is tightened so content
 * starts high and the dense, purposeful mockup rhythm is preserved.
 */
export function EditorScaffold({
  title,
  eyebrow,
  description,
  onBack,
  children,
}: {
  title: string;
  // Section eyebrow above the wordmark (e.g. COACHING / BODY / TARGETS / CYCLE /
  // COACH MEMORY). Defaults to EDIT if an editor doesn't pass one.
  eyebrow?: string;
  // One-line description under the wordmark (13px cocoaSoft). Optional.
  description?: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={chrome.safe} edges={["top"]}>
      {/* Back row — cocoa "‹ PROFILE" affordance per the mockup (cocoa chevron +
          letter-spaced PROFILE), at the hub's 24px gutter. */}
      <View style={chrome.headerRow}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={chrome.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back to profile"
        >
          <Text style={chrome.backChevron}>{"‹"}</Text>
          <Text style={chrome.backText}>PROFILE</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={chrome.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Title block — section eyebrow + lowercase wordmark + description,
            matching the mockup's dense header lockup. */}
        <Text style={chrome.eyebrow}>{eyebrow ?? "EDIT"}</Text>
        <Text style={chrome.title}>{title}</Text>
        {description != null && description !== "" && (
          <Text style={chrome.description}>{description}</Text>
        )}
        {children}
        <View style={{ height: spacing["4xl"] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const chrome = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing["2xl"], // 24 — match the hub gutter
    paddingTop: spacing.xs, // 4 — tighten so content starts high (mockup 16px)
    paddingBottom: 0,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
  },
  // Cocoa "‹" chevron per the mockup (not the old quieter clay).
  backChevron: {
    fontSize: type.size.body, // 16 — mockup chevron size
    lineHeight: type.size.body,
    color: colors.ink, // cocoa
    fontFamily: type.ui.family,
    marginRight: spacing.xs, // 4
    marginTop: -1,
  },
  // "PROFILE" — 11px, medium, 1.5px tracking, cocoa per the mockup.
  backText: {
    fontSize: type.size.micro, // 11
    color: colors.ink, // cocoa
    fontFamily: type.ui.family,
    letterSpacing: 1.5,
  },
  content: {
    paddingHorizontal: spacing["2xl"], // 24 — match the hub gutter
    paddingTop: spacing.lg + 2, // 18 — mockup eyebrow offset under the back row
  },
  // Section eyebrow — 9px, clay, 2.5px tracking (mockup).
  eyebrow: {
    fontFamily: type.ui.family, // medium, like the mockup
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.inkMuted, // clay
  },
  // Lowercase wordmark title — 32px display, -1.2 tracking, cocoa. lineHeight 38
  // gives descender room (the 'p'/'y' in goal/your body) so it never clips.
  title: {
    fontSize: type.size.display, // 32
    fontFamily: type.display.family,
    color: colors.ink,
    letterSpacing: -1.2, // mockup display tracking
    lineHeight: 38, // descender room — do NOT lower (clips lowercase tails)
    marginTop: spacing.sm - 2, // 6 — mockup gap under eyebrow
  },
  // Description line — 13px, cocoaSoft, line-height ~1.5 (mockup).
  description: {
    fontSize: 13,
    fontFamily: type.body.family,
    color: colors.cocoaSoft, // #6B5641
    lineHeight: 20, // ~1.5
    marginTop: spacing.sm, // 8
    marginBottom: spacing.xl + 2, // 22 — mockup gap before first content block
  },
});

/**
 * Shared field / option-row / button styles for the editors, matching the
 * mockup (brand/Coach Tab/Mock Up/wren_profile_subsheets.html). Replaces the
 * old floating-chip register with full-width stacked option rows, labeled
 * creamTile field cards, hairline-topped helpers, and a full-width SAVE pill.
 * Tokens only (no raw hex, no fontWeight).
 */
export const editorStyles = StyleSheet.create({
  // Kept for back-compat with editors not yet migrated. Uppercase prompt line.
  sectionLabel: {
    fontSize: type.size.caption, // 12
    fontFamily: type.label.family,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: type.tracking.wide,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },

  // --- Option list (Goal / Tone / Activity) --------------------------------
  // Full-width stacked rows, 8px gap. Rest = creamTile fill + cocoaSoft text +
  // 0.5px hairline, radius 14, padding 14×18, left-aligned. Selected = cocoa
  // (ink) fill + cream text + a check at right.
  optionList: { gap: spacing.sm }, // 8
  optionRow: {
    backgroundColor: colors.creamTile, // #F5EFE6 warm rest fill
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.rowHairline, // cocoa @10%-ish hairline (warm)
    paddingVertical: spacing.lg - 2, // 14
    paddingHorizontal: spacing.lg + 2, // 18
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionRowActive: {
    backgroundColor: colors.ink, // cocoa fill
    borderColor: colors.ink,
  },
  optionRowText: {
    fontSize: type.size.callout, // 14
    fontFamily: type.ui.family, // medium
    color: colors.cocoaSoft, // #6B5641 rest text
    flexShrink: 1,
  },
  optionRowTextActive: { color: colors.surface }, // cream on cocoa

  // --- Goal-mode two-up cards ----------------------------------------------
  modeGrid: { flexDirection: "row", gap: spacing.sm + 2 }, // 10
  modeCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.ink, // cocoa outline (unselected)
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg, // 16
    paddingHorizontal: spacing.lg - 2, // 14
  },
  modeCardActive: {
    backgroundColor: colors.ink, // cocoa fill (selected)
  },
  modeCardTitle: {
    fontSize: type.size.body, // 16
    fontFamily: type.label.family, // semibold
    color: colors.ink,
  },
  modeCardTitleActive: { color: colors.surface },
  modeCardBody: {
    fontSize: type.size.caption, // 12
    fontFamily: type.body.family,
    color: colors.cocoaSoft,
    lineHeight: 17,
    marginTop: spacing.sm - 2, // 6
  },
  modeCardBodyActive: { color: colors.surface },

  // --- Labeled field cards (Your body / Cycle / Daily targets) -------------
  // A small clay eyebrow + a creamTile field wrapping a TextInput.
  fieldLabel: {
    fontSize: 9,
    fontFamily: type.label.family, // semibold
    letterSpacing: 2,
    color: colors.inkMuted, // clay
    marginBottom: spacing.sm - 2, // 6
  },
  // The creamTile field wrapper (border + radius). Wraps `fieldInput`.
  fieldCard: {
    backgroundColor: colors.creamTile,
    borderWidth: 0.5,
    borderColor: colors.rowHairline,
    borderRadius: radius.sm + 2, // 10
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg - 2, // 14
  },
  // The TextInput inside a fieldCard — transparent so the card carries the fill.
  fieldInput: {
    flex: 1,
    paddingVertical: spacing.md, // 12
    fontSize: type.size.callout, // 14
    fontFamily: type.ui.family, // medium
    color: colors.ink,
  },
  // Trailing hint inside a field card (e.g. "starting estimate").
  fieldTrailingHint: {
    fontSize: type.size.micro, // 11
    fontFamily: type.body.family,
    color: colors.inkMuted,
    marginLeft: spacing.sm,
  },
  fieldGroup: { marginTop: spacing.md + 2 }, // 14 — gap between stacked fields
  fieldRow: { flexDirection: "row", gap: spacing.sm + 2 }, // 10 — 2-col grid
  fieldCol: { flex: 1 },

  // --- Hairline-topped helper ----------------------------------------------
  // A faint warm cocoa rule above a small helper paragraph. Used for the body /
  // targets / cycle / photos helper lines.
  helperBlock: {
    marginTop: spacing.xl + 2, // 22
    paddingTop: spacing.xl + 2, // 22
    borderTopWidth: 0.5,
    borderTopColor: colors.rowHairline,
  },
  helperText: {
    fontSize: type.size.micro, // 11
    fontFamily: type.body.family,
    color: colors.cocoaSoft,
    lineHeight: 17, // ~1.55
  },
  helperEmphasis: {
    fontFamily: type.label.family, // semibold
    color: colors.ink,
  },

  // Plain free-floating hint (back-compat).
  hint: {
    fontSize: type.size.caption,
    fontFamily: type.body.family,
    color: colors.inkMuted,
    lineHeight: 18,
    marginTop: spacing.sm,
  },

  // --- Free-text field (Preferences) ---------------------------------------
  label: {
    fontSize: type.size.callout,
    fontFamily: type.label.family,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  // Multiline free-text wrapped in the brand field-card treatment.
  input: {
    backgroundColor: colors.creamTile,
    borderRadius: radius.sm + 2, // 10
    borderWidth: 0.5,
    borderColor: colors.rowHairline,
    paddingHorizontal: spacing.lg - 2, // 14
    paddingVertical: spacing.md, // 12
    fontSize: type.size.callout, // 14
    fontFamily: type.body.family,
    color: colors.ink,
  },
  multiline: { minHeight: 110, textAlignVertical: "top", lineHeight: 20 },

  // --- Full-width SAVE / DONE pill -----------------------------------------
  // Cocoa fill, cream text, letter-spaced, full-width pill per the mockup.
  primaryPill: {
    backgroundColor: colors.ink, // cocoa
    borderRadius: radius.pill,
    paddingVertical: spacing.lg - 2, // 14
    alignItems: "center",
    marginTop: spacing["2xl"] + 2, // 26 — mockup gap before SAVE
  },
  primaryPillText: {
    color: colors.surface, // cream
    fontSize: 13,
    fontFamily: type.ui.family, // medium
    letterSpacing: type.tracking.button, // 2.5
  },

  // --- Cocoa-outline pill (Add a memory / secondary) -----------------------
  outlinePill: {
    borderWidth: 1.5,
    borderColor: colors.ink, // cocoa outline per mockup
    borderRadius: radius.pill,
    paddingVertical: spacing.md, // 12
    alignItems: "center",
    justifyContent: "center",
  },
  outlinePillText: {
    color: colors.ink,
    fontSize: type.size.caption, // 12
    fontFamily: type.ui.family,
    letterSpacing: type.tracking.label, // 2
  },
});
