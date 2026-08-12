import React from "react";
import { Text, TouchableOpacity } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "../../lib/theme";
import { editorStyles as s } from "./editorChrome";

// Full-width stacked option row, matching the mockup
// (brand/Coach Tab/Mock Up/wren_profile_subsheets.html):
//   rest      = creamTile fill + cocoaSoft text + 0.5px hairline, left-aligned
//   selected  = cocoa (ink) fill + cream text + a check SVG at right
// Purely presentational — the caller owns selection + onPress wiring.
export function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[s.optionRow, selected && s.optionRowActive]}
    >
      <Text style={[s.optionRowText, selected && s.optionRowTextActive]}>{label}</Text>
      {selected && (
        <Svg viewBox="0 0 14 14" width={14} height={14}>
          <Path
            d="M3 7.5 L6 10.5 L11.5 4.5"
            fill="none"
            stroke={colors.surface}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </TouchableOpacity>
  );
}
