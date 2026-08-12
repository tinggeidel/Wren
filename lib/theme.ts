// Wren brand tokens — derived from /brand SVGs. Reckless/Söhne not bundled;
// the app's single type family is Manrope (OFL, via @expo-google-fonts/manrope).
// There is no italic and no serif anywhere in the design.

// --- Colors ---------------------------------------------------------------
// Raw palette pulled directly from the wordmark + app-icon SVGs. Semantic
// aliases below are what screens should reach for; raw names exist so token
// audits can verify "is this hex coming from the brand palette?"
export const colors = {
  // Primary warm surface — the cream field behind the wordmark.
  cream: "#FBF7F0",
  // Cool secondary surface — the ground used on the app icon.
  vapor: "#E3E8E9",
  // Primary ink — body + headings, also the wordmark color.
  cocoa: "#3B2F22",
  // Mid-tone — taglines, secondary text, dividers, muted ink.
  clay: "#8A7B68",
  // Soft brand-period color, replacing the previous neon rose. Picked in the
  // warm terracotta/garnet family so it harmonizes with cocoa+cream rather
  // than fighting them. Sits between cocoa (deep) and cream (light) on the
  // warm axis and reads as "period" without looking medical or alarmist.
  ember: "#B4564B",
  // Quieter neutral for hairlines / disabled states — lighter than clay.
  mist: "#D6CFC2",
  // Pure white for modal/card surfaces where we want a clean lift off cream.
  paper: "#FFFFFF",

  // --- Semantic aliases ---
  // Always prefer these in screens. Raw palette names should only appear in
  // theme.ts itself and in brand-spec documents.
  surface: "#FBF7F0", // cream
  surfaceMuted: "#E3E8E9", // vapor — used for inset cards / secondary surfaces
  ink: "#3B2F22", // cocoa — primary text
  inkMuted: "#8A7B68", // clay — secondary text
  accent: "#3B2F22", // cocoa — primary interactive ink (calmer than a hue)
  period: "#B4564B", // ember — period/flow color, used sparingly
  divider: "#D6CFC2", // mist — hairlines, borders
  focus: "#3B2F22", // cocoa — focus ring / selected outline
  // FLAG (new token): warm-cream rest fill for day-log selection chips. The
  // mockup's unselected chips are a soft warm cream (matching the cream sheet
  // they sit on, defined by a hairline border) — NOT the cool grey-blue vapor
  // that surfaceMuted carries. Role-named so chips read warm, per mockup.
  chipRest: "#FBF7F0", // cream — unselected chip fill (warm, matches sheet)

  // FLAG (NEW ACCENT — brand-palette addition, auditor + Ting to review):
  // The Food mockup uses a muted slate-sage/teal for the calorie donut ring,
  // the macro progress bars, the active-date circle, the "Remaining" number,
  // and the water "+" button. None of the existing semantic tokens carry this
  // hue: `period` is warm terracotta, the phase `follicular` sage (#8A9A6B) is
  // greener/warmer than the mockup's cooler blue-leaning sage, and vapor is a
  // near-grey. Sampled from the mockup, `calm` is a desaturated teal-sage that
  // harmonizes with cream+cocoa while reading as the "neutral progress" accent
  // the Food screen needs. `calmFill` is its light track tint for progress
  // backgrounds. Role-named ("calm") rather than tied to one element so it can
  // be the screen's single calm-progress accent. NOT yet used elsewhere.
  calm: "#7E9AA0", // muted slate-sage/teal — Food progress + active-date accent
  calmFill: "#DCE5E4", // light track behind calm progress bars / ring

  // FLAG (NEW tokens — Food sub-sheet purple sweep, auditor + Ting to review):
  // The Food log sub-sheets (How much?, New meal, Manual) had a default-purple
  // (#7C3AED) treatment that's being swept to the warm cocoa register. Three
  // hues in the sweep spec have no existing semantic alias:
  //   creamTile (#F5EFE6) — the calorie-summary tile fill on the How much?
  //     sheet. Warmer/softer than `cream` (#FBF7F0); reads as a faint inset
  //     card on the white modal. Role-named for the summary tile surface.
  //   cocoaSoft (#6B5641) — the macro line under the kcal number. A lighter
  //     cocoa than `ink`, darker/warmer than `clay`; spec name "Cocoa".
  //   mistDark (#4F6B70) — inactive segmented-control label text. A darker,
  //     cooler slate than `calm`; spec name "Mist-dark". Reads as a quiet but
  //     legible inactive tab label on the vapor track.
  creamTile: "#F5EFE6", // warm cream — calorie-summary tile fill (How much?)
  cocoaSoft: "#6B5641", // soft cocoa — macro line under the kcal number
  mistDark: "#4F6B70", // dark slate — inactive segmented-control label text
  // FLAG (NEW token — Food sub-sheet cleanup pass, auditor + Ting to review):
  // The Food log sub-sheets' reference shows a soft tan/"camel" used in two
  // spots: the sheet drag handle and the "(optional)" label tint on the Manual
  // tab. No existing alias carries this warm light tan (clay #8A7B68 is browner
  // and darker; mist #D6CFC2 is greyer/cooler). Role-named "handle" for the
  // grabber but reused for the optional-label tint per the reference.
  handle: "#C8A989", // warm camel/tan — sheet drag handle + "(optional)" tint
  // FLAG (NEW token — Food Edit-sheet cleanup pass, auditor + Ting to review):
  // warm clay, used for the quiet destructive action (Edit sheet "DELETE THIS
  // ENTRY" text button + the confirm sheet's filled "DELETE" pill). Deliberately
  // NOT iOS destructive red, and NOT the period ember #B4564B — severity is
  // conveyed by the two-tap confirmation, not by an alarming hue. Stays in the
  // cocoa-on-cream warm register.
  warmAlert: "#B8765E", // warm clay — quiet destructive action
  // FLAG (NEW token — Coach editorial data cards, auditor + Ting to review):
  // the Coach mockup's full-width LOGGED/SUGGESTED data cards use a WARM cocoa
  // hairline at low alpha (rgba(59,47,34,0.12)) for their top+bottom rules —
  // NOT the cooler grey-blue `divider` (mist #D6CFC2), which reads cold against
  // the warm cream chat. Role-named for the card rule so it stays the warm
  // cocoa register the mockup specifies.
  cardHairline: "rgba(59,47,34,0.12)", // warm cocoa @12% — editorial card rules
  // FLAG (NEW token — Profile hub editorial section rules, auditor + Ting to
  // review): the Profile mockup's hairline-separated list rows use a WARM cocoa
  // rule at a lighter alpha (rgba(59,47,34,0.08)) than the Coach cards' 0.12 —
  // a quieter divider that reads as a faint inset rule on the white hub rather
  // than the cooler grey-blue `divider` (mist #D6CFC2). Role-named "rowHairline"
  // for the profile/list-row register, distinct from cardHairline's heavier card
  // rule. Also used for the photo "+" badge border at a slightly higher alpha.
  rowHairline: "rgba(59,47,34,0.08)", // warm cocoa @8% — profile list-row rules
  badgeBorder: "rgba(59,47,34,0.15)", // warm cocoa @15% — photo "+" badge ring

  // FLAG (NEW ACCENTS — Profile hub section dots + mini-visuals, auditor + Ting
  // to review): the Profile mockup color-codes its sections with three soft
  // accent hues used ONLY for decorative section dots and the small SVG
  // mini-visuals (calorie ring, phase dial). None are text-on-color and none
  // are safety-relevant. Each is distinct from the closest existing token, so
  // approximating with the neighbor would silently shift the mockup's chosen
  // hue — added as role-named tokens instead:
  //   profileSlate (#8DA3A8) — TARGETS dot + the calorie-ring arc. Lighter and
  //     greyer than `calm` (#7E9AA0, the Food progress slate); the mockup author
  //     picked a distinct, softer slate for the hub.
  //   profileRose (#D4A89E) — CYCLE dot, the hero phase dot, and one phase-dial
  //     arc. A lighter, dustier blush than `phaseColors.luteal` (#C68D8A, deeper
  //     and redder).
  //   profileSage (#A8B89B) — COACH MEMORY dot + one phase-dial arc. A
  //     desaturated grey-leaning sage, far lighter/greyer than the green
  //     `phaseColors.follicular` (#8A9A6B).
  profileSlate: "#8DA3A8", // soft slate — TARGETS dot + calorie-ring arc
  profileRose: "#D4A89E", // dusty blush — CYCLE dot + hero phase dot + dial arc
  profileSage: "#A8B89B", // grey-sage — COACH MEMORY dot + phase-dial arc

  // FLAG (NEW tokens — Workout tab redesign, auditor + Ting to review): the
  // Workout mockup introduces two hues with no existing semantic alias:
  //   honey (#E8B86A) — the "trained" status dot on TODAY's day-strip cell
  //     (the non-today trained dots reuse the existing grey-sage profileSage
  //     #A8B89B). A warm amber accent used ONLY as a small decorative status
  //     dot; not text-on-color, not safety-relevant.
  //   checkDone (#94A684) — the filled "done"/completed checkbox in the plan
  //     day cards (border + the deeper edge of the check's sage gradient). A
  //     deeper, more saturated sage than profileSage (#A8B89B, used for the
  //     flat trained dot); the mockup gives the active check a richer green so
  //     a completed session reads as affirmatively "done". Role-named for the
  //     completion check so it isn't confused with the lighter dot sage.
  honey: "#E8B86A", // warm amber — TODAY trained-status dot on the day strip
  checkDone: "#94A684", // deep sage — filled "done" checkbox (plan day cards)

  // FLAG (NEW tokens — Onboarding 3rd fidelity pass ambient mesh, auditor + Ting
  // to review): the Onboarding mockup paints a warm ambient background behind the
  // content — five soft radial-gradient blooms (the .bg layer) plus a top-left
  // screen highlight (.screen:before). RN/Expo has no native CSS radial-gradient
  // and expo-linear-gradient is NOT installed (linear-only anyway), so the
  // faithful render is HANDED TO THE IMPLEMENTER (see the // TODO(implementer)
  // block in OnboardingScreen). These role-named tokens carry the mockup's exact
  // bloom colors so neither the placeholder scaffold nor the implementer's final
  // mesh hardcodes a raw rgba in the screen. Each maps to the brand cream/slate/
  // terracotta/sage/honey family the mockup pulls from; alphas are the mockup's:
  //   meshButter  — rgba(241,227,201,.95) bloom, top-left (brand butter/cream)
  //   meshVapor   — rgba(227,232,233,.85) bloom, top-right (brand vapor/slate-cool)
  //   meshRose    — rgba(212,168,158,.55) bloom, bottom-right (brand rose/terracotta)
  //   meshSage    — rgba(168,184,155,.42) bloom, bottom-left (brand sage)
  //   meshHoney   — rgba(232,184,106,.18) bloom, center (brand honey, faintest)
  //   meshBackdrop— #EFE7DA the warm body backdrop the blooms sit on (the mockup
  //                 body bg; very close to cream #FBF7F0 but a touch deeper/warmer)
  //   screenSheen — rgba(255,255,255,.35) the top-left .screen:before highlight
  // All are decorative, behind content, pointerEvents none; none are text-on-
  // color and none touch safety copy.
  meshButter: "rgba(241,227,201,0.95)",
  meshVapor: "rgba(227,232,233,0.85)",
  meshRose: "rgba(212,168,158,0.55)",
  meshSage: "rgba(168,184,155,0.42)",
  meshHoney: "rgba(232,184,106,0.18)",
  meshBackdrop: "#EFE7DA",
  screenSheen: "rgba(255,255,255,0.35)",

  // FLAG (NEW tokens — Progress tab redesign, auditor + Ting to review): the
  // Progress mockup (brand/progresstab/wren_progress_redesign.html) uses a
  // slightly warmer/deeper sand backdrop and card surface than the existing
  // cream/paper tokens, plus a handful of decorative accent hues for its viz
  // (mood dots, mini cycle rings, photo timeline). None are text-on-color and
  // none touch safety copy. Each is distinct from the closest existing token,
  // so approximating with a neighbor would silently shift the mockup's chosen
  // hue. Role-named:
  //   progressBg (#FCFAF6) — the screen's warm near-white page background. A
  //     near-white warm cream, lighter than `cream` (#FBF7F0); the Progress page
  //     now sits on this airy near-white so the warm-sand insight cards lift off
  //     it. (Swapped 2026-05-31 with progressCard so the page is the lighter
  //     surface and the cards carry the warm sand, per the mockup direction.)
  //   progressCard (#F3ECDF) — the insight-card surface. A warm sand, deeper/
  //     warmer than `cream` and meshBackdrop (#EFE7DA); reads as a soft warm
  //     card lifted off the near-white page by the soft shadow recipe. (Swapped
  //     2026-05-31 with progressBg.)
  //   progressLine (rgba(59,47,34,0.09)) — card-internal hairline / day-dot
  //     ring / date-nav button border (mockup --line). Warmer + slightly
  //     heavier than rowHairline's 0.08; kept distinct to match the mockup.
  //   progressLineSoft (rgba(59,47,34,0.05)) — the faint bar-track fill and
  //     the card divider above the caption (mockup --lineSoft).
  //   latte (#C8A989) — sheet drag-handle + tab-dot border accent (mockup
  //     --latte). Same warm camel already named `handle`; aliased here under
  //     the mockup's name for the Progress sheet handle for call-site clarity.
  //   lut (#C99B93) — the luteal hue stop in the mini cycle-ring conic gradient
  //     (mockup --lut). Close to phaseColors.luteal (#C68D8A) but the mockup's
  //     ring uses this exact dustier rose; kept as the ring's luteal stop.
  //   moodHalo (#F1E7D6) — the soft radial halo behind the current cycle ring
  //     (mockup .mring .halo). A pale warm cream glow; decorative only.
  progressBg: "#FCFAF6", // warm near-white — Progress page background
  progressCard: "#F3ECDF", // warm sand — Progress insight card surface
  progressLine: "rgba(59,47,34,0.09)", // warm cocoa @9% — card hairline / dot ring
  progressLineSoft: "rgba(59,47,34,0.05)", // warm cocoa @5% — bar track / divider
  latte: "#C8A989", // warm camel — Progress sheet handle + tab-dot border
  lut: "#C99B93", // dusty rose — luteal stop in mini cycle-ring conic gradient
  moodHalo: "#F1E7D6", // pale cream — halo behind the current cycle ring
} as const;

// --- Typography -----------------------------------------------------------
// Manrope (OFL, via @expo-google-fonts/manrope) is the single type family for
// the whole app — a geometric humanist sans. There is NO italic and NO serif
// anywhere in the new design; the previous Spectral italic-serif voice was
// fully retired. Manrope ships its weight in the family name itself
// (Manrope_700Bold etc.), so callers set ONLY fontFamily — never a companion
// fontWeight, and never fontStyle. Loaded via useFonts in App.tsx; the
// family-name strings below are the exact keys registered there.
//
// Role → weight mapping (see the brand spec):
//   bold (700)     — large headers, the wordmark, big display numbers
//   semibold (600) — data labels, weekly totals, list values
//   medium (500)   — UI labels, list item names, body emphasis, buttons
//   regular (400)  — body paragraphs, helper text
export const fontExtrabold = "Manrope_800ExtraBold";
export const fontBold = "Manrope_700Bold";
export const fontSemibold = "Manrope_600SemiBold";
export const fontMedium = "Manrope_500Medium";
export const fontRegular = "Manrope_400Regular";

export const type = {
  // Display/header + big-number voice. Replaces the old italic-serif title
  // role. Callers set fontFamily only (weight is in the family name) and add
  // negative letterSpacing per the mapping for large/bold text.
  display: {
    family: fontBold,
  },
  // FLAG (NEW token — Onboarding 2nd fidelity pass, auditor + Ting to review):
  // the Onboarding mockup uses Manrope ExtraBold (800) for the wordmark, the big
  // screen titles, and the large stepper-value numerals. The 700 `display` role
  // read too light on device vs. the mockup, so the heaviest display register
  // now resolves to the genuinely-bundled Manrope_800ExtraBold (added to
  // App.tsx useFonts). Role-named `displayHeavy` so only the true display/hero
  // type opts into 800 — body/label voice stays 700/600/500/400.
  displayHeavy: {
    family: fontExtrabold,
  },
  // Heavy voice for hero numerals (cycle-day glyph in PhaseRing, big stat
  // numbers). Same Manrope bold family; kept as a distinct token so hero-
  // numeral call sites read intentionally.
  numeral: {
    family: fontBold,
  },
  // Data labels, weekly totals, list values.
  label: {
    family: fontSemibold,
  },
  // UI labels, list item names, body emphasis, button text.
  ui: {
    family: fontMedium,
  },
  // Default body / helper voice.
  body: {
    family: fontRegular,
  },
  // Default body voice — explicit Manrope regular (no longer system sans).
  sans: {
    family: fontRegular as string | undefined,
  },
  // Size scale, in dp.
  size: {
    display: 32,
    title: 24,
    headline: 20,
    body: 16,
    callout: 14,
    caption: 12,
    micro: 11,
    // FLAG (NEW size token — Coach editorial card slot line, auditor + Ting to
    // review): the mockup's LOGGED/SUGGESTED slot label is 10px, one step below
    // `micro` (11). Role-named "nano" as the smallest editorial-label size.
    nano: 10,
  },
  // Letter-spacing presets.
  tracking: {
    tight: -0.4,
    normal: 0,
    wide: 0.5,
    // FLAG (NEW tracking tokens — Coach editorial cards + CTA pills, auditor +
    // Ting to review): the Coach mockup specs two wide-tracked uppercase
    // treatments that `wide` (0.5) is far too tight to match. `label` (2) is the
    // editorial card's LOGGED/SUGGESTED slot line; `button` (2.5) is the CTA
    // pill label spacing. Role-named so they read as the slot/button treatments,
    // not arbitrary numbers.
    label: 2,
    button: 2.5,
    // "A SOFTER SCIENCE" treatment from the wordmark SVG (letter-spacing 6).
    eyebrow: 6,
  },
  // React Native fontWeight string values.
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
} as const;

// --- Spacing --------------------------------------------------------------
// 4-pt scale. Keys mirror Tailwind's t-shirt sizes so they're predictable.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

// --- Radii ----------------------------------------------------------------
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

// --- Phase color tokens ---------------------------------------------------
// Brand-aligned tints for each cycle phase. `bg` is the cell fill / ribbon
// segment color; `ink` is the readable numeral / accent color over it.
// Shared by CycleScreen (calendar + ribbon + legend) and ProgressScreen (F3
// look-back grid). Menstrual now uses ember so the rose/ember inconsistency
// the auditor flagged is closed — period swatches and the menstrual phase
// tint are the same color family.
//
// `cycle.ts` re-exports this as PHASE_COLORS so the existing call sites in
// ProgressScreen and CycleScreen keep working without an import churn.
export const phaseColors: Record<string, { bg: string; ink: string }> = {
  menstrual: { bg: "#B4564B", ink: "#FFFFFF" }, // ember, white numerals
  follicular: { bg: "#8A9A6B", ink: "#FFFFFF" }, // sage, white numerals
  ovulatory: { bg: "#BDD0D6", ink: "#3B2F22" }, // powder blue, cocoa numerals
  luteal: { bg: "#8E6B8E", ink: "#FFFFFF" }, // dusty plum, white numerals — moved out of the warm rose/ember family (Ting 2026-07-02) so luteal reads clearly apart from menstrual-ember on the softened calendar wash
} as const;
