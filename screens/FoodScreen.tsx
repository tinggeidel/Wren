import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  Animated,
} from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSwipeDismiss } from "../components/useSwipeDismiss";
import * as ImagePicker from "expo-image-picker";
import Svg, { Circle, Path } from "react-native-svg";
import {
  Profile,
  FoodEntry,
  WATER_GOAL_CUPS,
  SavedFood,
  SavedMeal,
} from "../lib/types";
import { toISODate, parseISO, addDays, phaseForDate } from "../lib/cycle";
import { targetForDate, planDayForDate } from "../lib/plan";
import { colors, type, radius, spacing } from "../lib/theme";
import {
  consumedTotals,
  entriesFor,
  recentFoods,
  addEntry,
  updateEntry,
  removeEntry,
  makeEntry,
  newId,
  addWater,
  waterFor,
  searchFoods,
  lookupBarcode,
  scaleHit,
  rescaleMacrosForQuantity,
  FoodHit,
  ZERO,
  toSavedFood,
  saveFood,
  removeSavedFood,
  isFoodSaved,
  findSavedFood,
  saveMeal,
  removeSavedMeal,
  entryFromSaved,
} from "../lib/food";
import { estimateFoodFromPhoto } from "../lib/coach";
import { caloriesBurnedFor } from "../lib/workouts";
import { toJpegBase64 } from "../lib/image";
import BarcodeScanner from "./BarcodeScanner";

type Draft = {
  id: string;
  name: string;
  quantity: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  // Fiber as a string so an EMPTY value can be distinguished from "0" — empty
  // = not provided (entry persists without fiber, doesn't contribute to the
  // day's sum); "0" = explicitly zero. Mirrors the manual/edit handlers.
  fiber: string;
};

type Mode = "search" | "saved" | "meals" | "manual";

function dateLabel(iso: string): string {
  const today = toISODate(new Date());
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return "Yesterday";
  const tm = new Date();
  tm.setDate(tm.getDate() + 1);
  if (iso === toISODate(tm)) return "Tomorrow";
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function FoodScreen({
  profile,
  updateProfile,
  onOpenCoach,
  active = true,
}: {
  profile: Profile;
  // Shared updater (App.tsx): the transform runs against the LATEST profile, so
  // a Coach write between this screen's render and a save can't be clobbered.
  updateProfile: (updater: (p: Profile) => Profile) => Promise<Profile>;
  // Switch the app to the Coach tab (same callback-prop pattern App.tsx uses for
  // WorkoutScreen.onOpenCoach / CoachScreen.onOpenSettings). Optional so the
  // screen still renders if mounted without it.
  onOpenCoach?: () => void;
  // True only while Food is the visible tab. App.tsx keeps every screen mounted
  // and toggles inactive ones to display:none. A <Modal> nested inside a subtree
  // that flips to display:none after the modal was shown strands its native host
  // view (RCTModalHostView) on top of Food — it keeps eating touches so the page
  // renders but ignores taps ("frozen"). visible={false} does NOT tear that host
  // down in this situation; only a real React unmount does. So we GATE every
  // Modal on `active` (absent from the tree when Food is hidden) and force-close
  // all sheet state when active flips false. Defaults true so the screen still
  // works if mounted without the prop.
  active?: boolean;
}) {
  const today = toISODate(new Date());
  // Calendar (Cal AI–style strip): the selected day drives everything below.
  const [selDate, setSelDate] = useState(today);
  const stripRef = useRef<ScrollView>(null);
  // Strip range: ~6 weeks of history behind today (reviewable past) and ~4 weeks
  // ahead so meals can be planned/logged forward. Named so the window is tunable
  // without touching the loop. Order stays chronological: oldest → today → future.
  const STRIP_DAYS_BACK = 41; // 42 cells incl. today, ~6 weeks back
  const STRIP_DAYS_FWD = 28; // ~4 weeks ahead, a sensible planning horizon
  const logDays: string[] = [];
  for (let i = STRIP_DAYS_BACK; i >= 0; i--) logDays.push(addDays(today, -i));
  for (let i = 1; i <= STRIP_DAYS_FWD; i++) logDays.push(addDays(today, i));
  // Today's index in the strip is exactly STRIP_DAYS_BACK (the back window fills
  // indices 0..STRIP_DAYS_BACK, then today). Used to scroll today into view on
  // mount/content-size — replaces the old scrollToEnd (which now lands on the
  // far-future edge, not today).
  const todayIndex = STRIP_DAYS_BACK;

  // Target is cycled by the plan day's intensity (rest/light/moderate/hard) when
  // there's a plan for this date, else the base deterministic target.
  const target = targetForDate(profile, selDate);
  const planDay = planDayForDate(profile, selDate);
  const consumed = consumedTotals(profile, selDate);
  const entries = entriesFor(profile, selDate);
  const water = waterFor(profile, selDate);
  // Calories burned on the selected day + the user's chosen accounting mode.
  const burned = caloriesBurnedFor(profile, selDate);
  const calMode = profile.calorieMode ?? "static";
  // "net" eat-back adds burn to the budget; "static" leaves the target as-is.
  // Either way the base target already has its BMR floor — burn never lowers it.
  const budgetCal = target ? (calMode === "net" ? target.calories + burned : target.calories) : 0;
  const calLeft = budgetCal - consumed.calories;

  // --- Rest-day annotation ---
  // We keep the full calorie ring / Remaining / macros on every day (the wheel
  // is never hidden). When the selected day is a rest day we ADD a small,
  // informational "REST DAY" note to the calorie card head — it annotates, it
  // does not replace data. A day counts as rest when there's an explicit planned
  // rest day, OR it's a future day with no plan yet. Training days (light /
  // moderate / hard) get no note. Derived live each render, so the instant a
  // training day is planned the note flips off — no memoization, no stale state.
  const isFutureDay = selDate > today;
  const showRestNote = planDay?.intensity === "rest" || (isFutureDay && !planDay);

  // --- Header eyebrow: "FRI · MAY 29 · LUTEAL · REST DAY" ---
  // Composed from REAL values only. Phase comes from phaseForDate (dropped for
  // BC users / unknown phase); day-type comes from the plan day (dropped when
  // there's no plan for this date). No fabricated segments.
  const selDt = parseISO(selDate);
  const phaseInfo = phaseForDate(profile, selDt);
  const eyebrowParts: string[] = [
    selDt.toLocaleDateString(undefined, { weekday: "short" }),
    selDt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  ];
  // Only show a real phase (skip BC / unknown / tracking-off — no fabricated
  // phase and no cycle leakage when the user has cycle tracking off). On a FUTURE
  // day the phase is a forecast, not a confirmed fact, so qualify it as
  // "(expected)" rather than asserting a bare phase (matches the cycle surface's
  // forecast-vs-assertion invariant — never assert an unconfirmed phase).
  if (!phaseInfo.onBirthControl && phaseInfo.phase !== "unknown" && phaseInfo.phase !== "off") {
    eyebrowParts.push(isFutureDay ? `${phaseInfo.phase} (expected)` : phaseInfo.phase);
  }
  // Day-type from the plan (rest / light / moderate / hard); skip when no plan.
  const dayTypeLabel = planDay
    ? planDay.intensity === "rest"
      ? "rest day"
      : `${planDay.intensity} day`
    : null;
  if (dayTypeLabel) eyebrowParts.push(dayTypeLabel);
  // "FOOD" leads the eyebrow (the screen title now lives here, not as a separate
  // big title row). Real segments only — nothing fabricated.
  const eyebrow = ["FOOD", ...eyebrowParts].join(" · ").toUpperCase();

  // Add sheet
  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("search");

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  // RECENT only pops up while the search field is active (focused).
  const [searchFocused, setSearchFocused] = useState(false);

  // Quantity step (after picking a search hit): log by servings or grams.
  const [pendingHit, setPendingHit] = useState<FoodHit | null>(null);
  const [qtyUnit, setQtyUnit] = useState<"serving" | "gram">("gram");
  const [qtyValue, setQtyValue] = useState("100");
  const [saveFav, setSaveFav] = useState(false); // "save to my foods" in quantity step
  const [mSave, setMSave] = useState(false); // "save to my foods" in manual entry

  // Meal builder (My Meals)
  const [mealBuilderOpen, setMealBuilderOpen] = useState(false);
  const [mealName, setMealName] = useState("");
  const [mealItems, setMealItems] = useState<Draft[]>([]);
  const [bQuery, setBQuery] = useState("");
  const [bResults, setBResults] = useState<FoodHit[]>([]);
  const [bSearching, setBSearching] = useState(false);

  // Barcode scanning
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  // Snap a meal (photo -> vision estimate -> confirm/edit card)
  const [estimating, setEstimating] = useState(false);
  const [photoReview, setPhotoReview] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Manual entry
  const [mName, setMName] = useState("");
  const [mQty, setMQty] = useState("");
  const [mCal, setMCal] = useState("");
  const [mP, setMP] = useState("");
  const [mC, setMC] = useState("");
  const [mF, setMF] = useState("");
  const [mFi, setMFi] = useState(""); // fiber

  // Edit existing entry
  const [editEntry, setEditEntry] = useState<FoodEntry | null>(null);
  const [eName, setEName] = useState("");
  const [eQty, setEQty] = useState("");
  const [eCal, setECal] = useState("");
  const [eP, setEP] = useState("");
  const [eC, setEC] = useState("");
  const [eF, setEF] = useState("");
  const [eFi, setEFi] = useState(""); // fiber (empty string = leave undefined on save)
  // Inline "saved" highlight for the Edit sheet's Save-to-my-foods button.
  // Seeded from the real persisted state in openEdit (so a saved food reopens
  // filled) and flipped by toggleSaveFood as it saves/unsaves.
  const [savedToFoods, setSavedToFoods] = useState(false);

  // Swipe-down-to-dismiss for each bottom sheet (handle+header grab zone).
  // The qty sub-step lives inside the addOpen sheet, so a swipe there closes the
  // whole sheet (the BACK link stays for stepping back to search).
  const addSwipe = useSwipeDismiss({ visible: addOpen, onClose: () => setAddOpen(false) });
  const editSwipe = useSwipeDismiss({ visible: !!editEntry, onClose: () => setEditEntry(null) });
  const mealSwipe = useSwipeDismiss({ visible: mealBuilderOpen, onClose: () => setMealBuilderOpen(false) });

  // Delete-confirm sheet (Edit sheet → "DELETE THIS ENTRY" opens a two-tap
  // confirmation instead of deleting immediately). Presentation scaffold only;
  // the implementer wires show/hide + the actual delete. Gated on a placeholder
  // boolean so nothing renders/crashes until wired.
  // TODO(implementer): wire delete-confirm visibility + DELETE→remove entry, KEEP IT→dismiss
  const [confirmDelete, setConfirmDelete] = useState(false);

  // All persistence goes through the shared updater so the transform applies to
  // the LATEST profile (never the render-time `profile` prop). `persist` here is
  // just a local alias for readability at the call sites.
  const persist = updateProfile;

  // When Food stops being the active tab, force every sheet/modal closed. Two
  // reasons: (1) it guarantees the active-gated Modals below are absent from the
  // tree while Food is hidden (so no native modal host can be stranded on top of
  // Food and eat touches when we come back), and (2) reactivating Food never
  // re-shows a stale sheet. Only runs on the false transition; reopening is
  // always user-driven. Lists EVERY modal-open state var by its real name.
  useEffect(() => {
    if (active) return;
    setAddOpen(false);
    setPendingHit(null);
    setScanning(false);
    setLookingUp(false);
    setEstimating(false);
    setPhotoReview(false);
    setMealBuilderOpen(false);
    setEditEntry(null);
    setConfirmDelete(false);
  }, [active]);

  function openAdd() {
    setMode("search");
    setQuery("");
    setResults([]);
    setSearchErr("");
    setPendingHit(null);
    setSaveFav(false);
    setMSave(false);
    setAddOpen(true);
  }

  async function doSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchErr("");
    try {
      const hits = await searchFoods(q);
      setResults(hits);
      if (!hits.length) setSearchErr("No matches. Try another name, or add it manually.");
    } catch {
      setSearchErr("Couldn't reach Open Food Facts. Check your connection, or add it manually.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pickHit(hit: FoodHit) {
    setPendingHit(hit);
    setSaveFav(false);
    // Default to 1 serving when the product has a serving size, else 100 g.
    if (hit.serving) {
      setQtyUnit("serving");
      setQtyValue("1");
    } else {
      setQtyUnit("gram");
      setQtyValue("100");
    }
  }

  // Grams the chosen quantity resolves to (servings -> grams via the serving size).
  function resolveGrams(hit: FoodHit, unit: "serving" | "gram", value: string): number {
    const n = parseFloat(value) || 0;
    if (unit === "serving" && hit.serving) return n * hit.serving.grams;
    return n;
  }

  // Switch unit, converting the current amount so the quantity stays the same.
  function switchUnit(to: "serving" | "gram") {
    if (!pendingHit || to === qtyUnit) return;
    const g = resolveGrams(pendingHit, qtyUnit, qtyValue);
    if (to === "serving" && pendingHit.serving) {
      setQtyValue(String(Math.round((g / pendingHit.serving.grams) * 10) / 10));
    } else {
      setQtyValue(String(Math.round(g)));
    }
    setQtyUnit(to);
  }

  // The camera must never render on top of the add sheet (stacked modals lag and
  // misfire on iOS). So we close the sheet, let it animate out, then open the
  // full-screen scanner — and reverse it on the way back.
  function reopenAddLater() {
    setTimeout(() => setAddOpen(true), 350);
  }
  function openScanner() {
    setSearchErr("");
    setAddOpen(false);
    setTimeout(() => setScanning(true), 350);
  }
  function cancelScan() {
    setScanning(false);
    reopenAddLater();
  }

  async function handleScan(code: string) {
    setScanning(false);
    setLookingUp(true);
    setSearchErr("");
    reopenAddLater(); // bring the sheet back so the result is always visible
    try {
      const hit = await lookupBarcode(code);
      if (hit) pickHit(hit);
      else {
        setMode("manual");
        setSearchErr(`Barcode ${code} isn't in Open Food Facts. Add it manually below.`);
      }
    } catch {
      setMode("manual");
      setSearchErr("Couldn't reach Open Food Facts to look up that barcode. Add it manually below.");
    } finally {
      setLookingUp(false);
    }
  }

  // --- Snap a meal ---
  // The old top-level "Snap a meal" button was removed in the mockup re-skin.
  // The photo-meal estimate flow now lives inside the Log-food sheet's Search
  // tab, alongside "Scan barcode" / "Nutrition label" (see photoFromSheet).
  // grabPhoto + the review modal are unchanged; only the entry point moved.

  async function grabPhoto(source: "camera" | "library", kind: "meal" | "label" | "auto" = "auto") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Allow camera access to snap a meal or label.");
          return;
        }
      }
      const opts = { mediaTypes: "images" as const };
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      let base64: string;
      try {
        base64 = await toJpegBase64(asset.uri);
      } catch {
        Alert.alert("Couldn't read that photo", "Try another one.");
        return;
      }
      setEstimating(true);
      try {
        const items = await estimateFoodFromPhoto(base64, kind);
        if (!items.length) {
          Alert.alert(
            "No food found",
            "I couldn't read any food in that photo. Try a clearer shot, or add it manually."
          );
          return;
        }
        setPhotoUri(asset.uri);
        setDrafts(
          items.map((i) => ({
            id: newId(),
            name: i.name,
            quantity: i.quantity ?? "",
            calories: String(Math.round(i.calories || 0)),
            protein: String(Math.round(i.protein || 0)),
            carbs: String(Math.round(i.carbs || 0)),
            fat: String(Math.round(i.fat || 0)),
            // Empty string when the model didn't return fiber — leaves the
            // edit field blank rather than implying "this meal has 0 fiber".
            fiber: typeof i.fiber === "number" ? String(Math.round(i.fiber)) : "",
          }))
        );
        setPhotoReview(true);
      } catch (e: unknown) {
        Alert.alert("Couldn't estimate", e instanceof Error ? e.message : String(e));
      } finally {
        setEstimating(false);
      }
    } catch (e: unknown) {
      Alert.alert("Photo error", e instanceof Error ? e.message : String(e));
    }
  }

  // Photo from inside the add sheet (camera or library). Closes the sheet first
  // so the review card isn't a modal stacked on a modal. `kind` selects the path:
  // "meal" for the vision estimate, "label" for the nutrition-label scan.
  function photoFromSheet(source: "camera" | "library", kind: "meal" | "label" = "meal") {
    setAddOpen(false);
    setTimeout(() => grabPhoto(source, kind), 350);
  }

  // "Snap a meal" → let her pick camera or library before launching. Both
  // photoFromSheet branches already close the sheet themselves, so this just
  // routes the chosen option. Matches the Alert-based prompting used elsewhere.
  function snapMealFromSheet() {
    Alert.alert("Snap a meal", "Take a photo or pick one from your library.", [
      { text: "Camera", onPress: () => photoFromSheet("camera") },
      { text: "Choose from Library", onPress: () => photoFromSheet("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  // "Nutrition label" → same camera/library chooser as snapMealFromSheet, but
  // routes through the label scan path.
  function snapLabelFromSheet() {
    Alert.alert("Nutrition label", "Take a photo or pick one from your library.", [
      { text: "Camera", onPress: () => photoFromSheet("camera", "label") },
      { text: "Choose from Library", onPress: () => photoFromSheet("library", "label") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  // "Tell Coach" → close the add sheet and switch to the Coach tab in the SAME
  // update. onOpenCoach sets the active tab to "coach", which flips this screen's
  // `active` prop to false in the same render pass — and the active-gate below
  // then UNMOUNTS every Modal (clean native teardown) instead of animating the
  // add sheet out under a display:none parent. That unmount is exactly what stops
  // the transparent modal host from being stranded on top of Food and eating
  // touches. The blur effect (on `active`) also resets all sheet state, so
  // returning to Food never re-shows a stale sheet. No timer needed.
  function tellCoach() {
    setAddOpen(false);
    onOpenCoach?.();
  }

  // --- Saved foods ---
  // entryFromSaved builds a NEW entry (fresh id) each call, so wrapping the build
  // inside the transform keeps it deterministic for the single applied call.
  function logSavedFood(s: SavedFood) {
    persist((p) => addEntry(p, entryFromSaved(s, selDate)));
    setAddOpen(false);
  }
  function removeFav(id: string) {
    persist((p) => removeSavedFood(p, id));
  }
  function saveRecentFood(e: FoodEntry) {
    persist((p) => saveFood(p, toSavedFood(e)));
  }

  // --- Saved meals: one tap logs every item to the selected day ---
  function logMeal(m: SavedMeal) {
    persist((p) => {
      let next = p;
      for (const it of m.items) next = addEntry(next, entryFromSaved(it, selDate, "meal"));
      return next;
    });
    setAddOpen(false);
  }
  function removeMeal(id: string) {
    persist((p) => removeSavedMeal(p, id));
  }

  // --- Meal builder ---
  function openMealBuilder() {
    setMealName("");
    setMealItems([]);
    setBQuery("");
    setBResults([]);
    setAddOpen(false);
    setTimeout(() => setMealBuilderOpen(true), 300);
  }
  async function doBuilderSearch() {
    const q = bQuery.trim();
    if (!q) return;
    setBSearching(true);
    try {
      setBResults(await searchFoods(q));
    } catch {
      setBResults([]);
    } finally {
      setBSearching(false);
    }
  }
  function addBuilderHit(h: FoodHit) {
    const grams = h.serving?.grams ?? 100;
    const m = scaleHit(h, grams);
    setMealItems((items) => [
      ...items,
      {
        id: newId(),
        name: h.name,
        quantity: h.serving ? `1 serving (${grams} g)` : `${grams} g`,
        calories: String(m.calories),
        protein: String(m.protein),
        carbs: String(m.carbs),
        fat: String(m.fat),
        // OFF rows always carry a fiber number (0 when missing on the source);
        // surface it so the saved-meal template keeps it.
        fiber: String(m.fiber),
      },
    ]);
    setBQuery("");
    setBResults([]);
  }
  function addBuilderSaved(s: SavedFood) {
    setMealItems((items) => [
      ...items,
      {
        id: newId(),
        name: s.name,
        quantity: s.quantityLabel ?? "",
        calories: String(s.calories),
        protein: String(s.protein),
        carbs: String(s.carbs),
        fat: String(s.fat),
        fiber: typeof s.fiber === "number" ? String(s.fiber) : "",
      },
    ]);
  }
  function addBlankMealItem() {
    setMealItems((items) => [
      ...items,
      { id: newId(), name: "", quantity: "", calories: "", protein: "", carbs: "", fat: "", fiber: "" },
    ]);
  }
  function updateMealItem(id: string, field: keyof Draft, val: string) {
    setMealItems((items) => items.map((d) => (d.id === id ? { ...d, [field]: val } : d)));
  }
  function removeMealItem(id: string) {
    setMealItems((items) => items.filter((d) => d.id !== id));
  }
  async function saveMealDraft() {
    const name = mealName.trim();
    const items = mealItems.filter((d) => d.name.trim());
    if (!name || !items.length) return;
    const newMeal: SavedMeal = {
      id: newId(),
      name,
      items: items.map((d) => {
        const fiberStr = d.fiber.trim();
        const fiberVal = fiberStr === "" ? undefined : parseFloat(fiberStr) || 0;
        return toSavedFood({
          name: d.name.trim(),
          quantityLabel: d.quantity.trim() || undefined,
          calories: parseFloat(d.calories) || 0,
          protein: parseFloat(d.protein) || 0,
          carbs: parseFloat(d.carbs) || 0,
          fat: parseFloat(d.fat) || 0,
          fiber: fiberVal,
        });
      }),
    };
    await persist((p) => saveMeal(p, newMeal));
    setMealBuilderOpen(false);
  }

  function updateDraft(id: string, field: keyof Draft, val: string) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, [field]: val } : d)));
  }
  function removeDraft(id: string) {
    setDrafts((ds) => ds.filter((d) => d.id !== id));
  }

  async function savePhotoItems() {
    await persist((p) => {
      let next = p;
      for (const d of drafts) {
        const fiberStr = d.fiber.trim();
        const fiberVal = fiberStr === "" ? undefined : parseFloat(fiberStr) || 0;
        const entry = makeEntry(
          {
            name: d.name.trim() || "Food",
            quantityLabel: d.quantity.trim() || undefined,
            calories: parseFloat(d.calories) || 0,
            protein: parseFloat(d.protein) || 0,
            carbs: parseFloat(d.carbs) || 0,
            fat: parseFloat(d.fat) || 0,
            fiber: fiberVal,
            date: selDate,
          },
          "photo"
        );
        next = addEntry(next, entry);
      }
      return next;
    });
    setPhotoReview(false);
    setDrafts([]);
    setPhotoUri(null);
  }

  async function addPending() {
    if (!pendingHit) return;
    const g = resolveGrams(pendingHit, qtyUnit, qtyValue);
    if (g <= 0) return;
    const m = scaleHit(pendingHit, g);
    const n = parseFloat(qtyValue) || 0;
    const quantityLabel =
      qtyUnit === "serving" && pendingHit.serving
        ? `${n} serving${n === 1 ? "" : "s"} (${Math.round(g)} g)`
        : `${Math.round(g)} g`;
    const entry = makeEntry(
      {
        name: pendingHit.name,
        brand: pendingHit.brand,
        quantityLabel,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        // OFF carries fiber when available; scaleHit fills 0 when missing. Pass
        // through so the entry's fiber survives any future re-scale path.
        fiber: m.fiber,
        per100g: pendingHit.per100g ?? undefined,
        barcode: pendingHit.barcode,
        date: selDate,
      },
      pendingHit.barcode ? "barcode" : "search"
    );
    await persist((p) => {
      let next = addEntry(p, entry);
      if (saveFav) next = saveFood(next, toSavedFood(entry));
      return next;
    });
    setSaveFav(false);
    setAddOpen(false);
    setPendingHit(null);
  }

  async function addManual() {
    const name = mName.trim();
    const cal = parseFloat(mCal) || 0;
    if (!name || cal <= 0) return;
    // Treat a blank fiber input as "not provided" rather than 0 — consumedTotals
    // ignores `undefined` (back-compat with older entries), and persisting 0
    // would dishonestly assert the food has no fiber.
    const fiberStr = mFi.trim();
    const fiberVal = fiberStr === "" ? undefined : parseFloat(fiberStr) || 0;
    const entry = makeEntry(
      {
        name,
        quantityLabel: mQty.trim() || undefined,
        calories: cal,
        protein: parseFloat(mP) || 0,
        carbs: parseFloat(mC) || 0,
        fat: parseFloat(mF) || 0,
        fiber: fiberVal,
        date: selDate,
      },
      "manual"
    );
    await persist((p) => {
      let next = addEntry(p, entry);
      if (mSave) next = saveFood(next, toSavedFood(entry));
      return next;
    });
    setMName("");
    setMQty("");
    setMCal("");
    setMP("");
    setMC("");
    setMF("");
    setMFi("");
    setMSave(false);
    setAddOpen(false);
  }

  async function reAdd(e: FoodEntry) {
    const entry = makeEntry(
      {
        name: e.name,
        brand: e.brand,
        quantityLabel: e.quantityLabel,
        calories: e.calories,
        protein: e.protein,
        carbs: e.carbs,
        fat: e.fat,
        fiber: e.fiber,
        per100g: e.per100g,
        barcode: e.barcode,
        date: selDate,
      },
      e.source
    );
    await persist((p) => addEntry(p, entry));
    setAddOpen(false);
  }

  function openEdit(e: FoodEntry) {
    setEditEntry(e);
    setEName(e.name);
    setEQty(e.quantityLabel ?? "");
    setECal(String(e.calories));
    setEP(String(e.protein));
    setEC(String(e.carbs));
    setEF(String(e.fat));
    // Empty string when the entry pre-dates fiber tracking, so the input shows
    // blank rather than "0" (and Save won't fabricate a 0 fiber value).
    setEFi(typeof e.fiber === "number" ? String(e.fiber) : "");
    // Seed the star from the REAL persisted state so a previously-saved food
    // reopens filled. Identity matches what saveFood/isFoodSaved dedupe on
    // (name+brand via sameFood). Built from `e` here; the toggle below rebuilds
    // from the edited fields so save/check stay the same identity.
    setSavedToFoods(isFoodSaved(profile, toSavedFood(e)));
  }

  // AMOUNT field handler for the edit sheet: as she changes the serving, live-
  // update the macro inputs so they track the portion. Rescale is derived from
  // the ORIGINAL editEntry (not the current field values) so repeated edits are
  // deterministic and never compound. If a ratio can't be derived (null), the
  // fields are left exactly as she has them — manual entry still works, and we
  // never silently zero the macros. She can hand-override a macro after this;
  // only another AMOUNT change re-derives.
  function onEditQtyChange(text: string) {
    setEQty(text);
    if (!editEntry) return;
    // Live macro update only. We DON'T rewrite the field text here (that would
    // fight her cursor mid-type); the label's parenthetical grams are normalized
    // once at save time in saveEdit.
    const r = rescaleMacrosForQuantity(editEntry, text);
    if (!r) return;
    const m = r.macros;
    setECal(String(m.calories));
    setEP(String(m.protein));
    setEC(String(m.carbs));
    setEF(String(m.fat));
    // Preserve the blank-vs-zero fiber distinction: only fill fiber when the
    // original entry actually tracked it (older entries leave the field blank
    // so Save won't fabricate a 0 fiber value).
    setEFi(typeof editEntry.fiber === "number" ? String(m.fiber) : "");
  }

  async function saveEdit() {
    if (!editEntry) return;
    const fiberStr = eFi.trim();
    const fiberVal = fiberStr === "" ? undefined : Math.round(parseFloat(fiberStr) || 0);
    // Normalize a serving label's "(… g)" to the true grams (e.g. "2 servings
    // (340 g)"), keeping whatever macros she has in the fields (she may have hand-
    // overridden them after the live rescale). Falls back to her raw text.
    const normalizedLabel = rescaleMacrosForQuantity(editEntry, eQty)?.label ?? eQty.trim();
    const edited: FoodEntry = {
      ...editEntry,
      name: eName.trim() || editEntry.name,
      quantityLabel: normalizedLabel || undefined,
      calories: Math.round(parseFloat(eCal) || 0),
      protein: Math.round(parseFloat(eP) || 0),
      carbs: Math.round(parseFloat(eC) || 0),
      fat: Math.round(parseFloat(eF) || 0),
      fiber: fiberVal,
    };
    await persist((p) => updateEntry(p, edited));
    setEditEntry(null);
  }

  async function deleteEdit() {
    if (!editEntry) return;
    const { date, id } = editEntry;
    await persist((p) => removeEntry(p, date, id));
    // Clear the confirm flag here too: deleteEdit is the only path that closes
    // the Edit sheet after the confirm sheet was opened, so this guarantees we
    // never leave confirmDelete=true with editEntry=null (orphaned confirm modal).
    setConfirmDelete(false);
    setEditEntry(null);
  }

  // DELETE pill: close the confirm sheet, then remove the entry. deleteEdit also
  // clears confirmDelete + editEntry, so both sheets close cleanly on every path.
  async function confirmDeleteEntry() {
    setConfirmDelete(false);
    await deleteEdit();
  }

  // Build a SavedFood from the CURRENTLY EDITED fields (same fields saveEdit
  // reads), so what we save and what we check for are the same identity. The
  // generated id is only used for a fresh save; the unsave path ignores it and
  // matches on name+brand instead (sameFood / isFoodSaved logic).
  function currentEditedSavedFood(): SavedFood {
    const fiberStr = eFi.trim();
    const fiberVal = fiberStr === "" ? undefined : parseFloat(fiberStr) || 0;
    return toSavedFood({
      name: eName.trim() || (editEntry?.name ?? ""),
      brand: editEntry?.brand,
      calories: parseFloat(eCal) || 0,
      protein: parseFloat(eP) || 0,
      carbs: parseFloat(eC) || 0,
      fat: parseFloat(eF) || 0,
      fiber: fiberVal,
      quantityLabel: eQty.trim() || undefined,
      per100g: editEntry?.per100g,
      barcode: editEntry?.barcode,
    });
  }

  // Toggle the edited food in/out of saved foods. Identity is name+brand via
  // sameFood, so save/unsave stay in sync with the star. The transform runs
  // against the LATEST profile (the shared updater), and we flip the local star
  // to match the action we just persisted.
  async function toggleSaveFood() {
    if (!editEntry) return;
    const food = currentEditedSavedFood();
    if (isFoodSaved(profile, food)) {
      await persist((p) => {
        // Recompute against the LATEST profile (not the render-time prop) so a
        // Coach write between render and tap can't make us remove the wrong row.
        // findSavedFood shares food.ts's `sameFood` identity, so this can't
        // desync from isFoodSaved/saveFood.
        const match = findSavedFood(p, food);
        return match ? removeSavedFood(p, match.id) : p;
      });
      setSavedToFoods(false);
    } else {
      await persist((p) => saveFood(p, food));
      setSavedToFoods(true);
    }
  }

  const recents = recentFoods(profile);
  const preview = pendingHit ? scaleHit(pendingHit, resolveGrams(pendingHit, qtyUnit, qtyValue)) : ZERO;
  // Ring fill = fraction of the day's budget CONSUMED (progress through the
  // day), so an empty day shows an empty ring and a full budget shows a full
  // ring. The center reads "Remaining". Clamped to [0,1].
  const calPct = target && budgetCal > 0 ? Math.min(1, Math.max(0, consumed.calories / budgetCal)) : 0;

  // Number formatting: thousands separators on the calorie figures (mockup).
  const fmt = (n: number) => n.toLocaleString();

  // Per-macro progress row data (mockup order: Carbs, Protein, Fat, Fiber).
  const macroRows = [
    { label: "Carbs", value: consumed.carbs, target: target?.carbs },
    { label: "Protein", value: consumed.protein, target: target?.protein },
    { label: "Fat", value: consumed.fat, target: target?.fat },
    { label: "Fiber", value: consumed.fiber, target: target?.fiber },
  ];

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header — single-line eyebrow (leads with FOOD) + cocoa "+" */}
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Text style={styles.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>

        {/* Day strip — weekday letter over italic-serif day number; TODAY filled */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          ref={stripRef}
          onContentSizeChange={() => {
            // Land on TODAY, not the far-future edge. Each cell advances by its
            // fixed width (44) plus the strip's gap (spacing.xs = 4) = 48px.
            // Shift left by ~120px so today sits roughly centered, with past to
            // the left and a little future peeking on the right (hints scroll).
            const adv = 44 + spacing.xs;
            const x = Math.max(0, todayIndex * adv - 120);
            stripRef.current?.scrollTo({ x, animated: false });
          }}
          contentContainerStyle={styles.strip}
        >
          {logDays.map((d) => {
            const sel = d === selDate;
            const dt = parseISO(d);
            return (
              <TouchableOpacity key={d} style={styles.stripCell} onPress={() => setSelDate(d)}>
                <Text style={[styles.stripDow, sel && styles.stripDowSel]}>
                  {dt.toLocaleDateString(undefined, { weekday: "narrow" })}
                </Text>
                <View style={[styles.stripCircle, sel && styles.stripCircleSel]}>
                  <Text style={[styles.stripNum, sel && styles.stripNumSel]}>{dt.getDate()}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {selDate !== today && <Text style={styles.selDateLabel}>{dateLabel(selDate)}</Text>}

        {/* CALORIES REMAINING card */}
        <View style={styles.calCard}>
          <View style={styles.calCardHead}>
            {/* Eyebrow stays "CALORIES REMAINING"; on a rest day we append a
                quiet "· REST DAY" annotation so it reads as a note on the same
                line, without touching the ring/Remaining/macros below. */}
            <Text style={styles.cardEyebrow}>
              CALORIES REMAINING{showRestNote ? " · REST DAY" : ""}
            </Text>
            {/* Existing day-type pill for PLANNED training days (light/moderate/
                hard). Rest days are annotated in the eyebrow above instead, so
                we skip the pill for them to avoid saying "REST DAY" twice. */}
            {dayTypeLabel && planDay?.intensity !== "rest" && (
              <View style={styles.dayPill}>
                <Text style={styles.dayPillText}>{dayTypeLabel.toUpperCase()}</Text>
              </View>
            )}
          </View>

          {target ? (
            <View style={styles.calBody}>
              {/* Donut ring with Remaining in the center */}
              <View style={styles.ringWrap}>
                <Ring pct={calPct} />
                <View style={styles.ringCenter}>
                  <Text style={styles.ringNum}>{fmt(calLeft)}</Text>
                  <Text style={styles.ringLabel}>Remaining</Text>
                </View>
              </View>

              {/* Breakdown table */}
              <View style={styles.breakdown}>
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>Goal</Text>
                  <Text style={styles.breakVal}>{fmt(target.calories)}</Text>
                </View>
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>− Food</Text>
                  <Text style={styles.breakVal}>{fmt(consumed.calories)}</Text>
                </View>
                <View style={styles.breakRow}>
                  <Text style={[styles.breakLabel, calMode !== "net" && styles.breakLabelMuted]}>
                    + Exercise
                  </Text>
                  <View style={styles.exerciseRight}>
                    {/* Static mode: the burn STILL SHOWS but is NOT counted into
                        Remaining (Remaining = Goal − Food). The value stays in a
                        muted clay tone — no explanatory words — so it reads as
                        "shown but not counted" without the rows looking broken.
                        In net mode it's full-weight and IS counted. */}
                    <Text style={[styles.breakVal, calMode !== "net" && styles.breakValMuted]}>
                      {fmt(burned)}
                    </Text>
                  </View>
                </View>
                <View style={styles.breakDivider} />
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabelTotal}>Remaining</Text>
                  <Text style={styles.breakValTotal}>{fmt(calLeft)}</Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={styles.noTarget}>
              Add your age, height, and weight in Settings to see targets and what's left.
            </Text>
          )}

          {target && (
            <>
              <View style={styles.macroDivider} />
              {macroRows.map((m) => (
                <MacroBar key={m.label} label={m.label} value={m.value} target={m.target} />
              ))}
            </>
          )}
        </View>

        {/* FOOD section header — "FOOD TODAY" only for today; otherwise reflect
            the selected day ("FOOD · TOMORROW" / "FOOD · TUE JUN 3"). dateLabel
            handles Today/Yesterday/Tomorrow + a weekday/month/day fallback; this
            also fixes past days, which previously all read "FOOD TODAY". */}
        <View style={styles.foodTodayHead}>
          <Text style={styles.cardEyebrow}>
            {selDate === today ? "FOOD TODAY" : `FOOD · ${dateLabel(selDate).toUpperCase()}`}
          </Text>
          <Text style={styles.foodTodayMeta}>
            {fmt(consumed.calories)} kcal · {entries.length} item{entries.length === 1 ? "" : "s"}
          </Text>
        </View>

        {entries.length === 0 ? (
          <Text style={styles.empty}>
            Nothing logged for this day. Tap ＋ to search a food, scan a barcode, or just tell the
            Coach what you ate.
          </Text>
        ) : (
          entries.map((e) => (
            <TouchableOpacity key={e.id} style={styles.entryCard} onPress={() => openEdit(e)}>
              <View style={styles.entryMain}>
                <Text style={styles.entryName}>{e.name}</Text>
                <Text style={styles.entrySub}>
                  {e.quantityLabel ? e.quantityLabel : "1 serving"}
                  {" · "}
                  {new Date(e.createdAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {e.source === "coach" ? " · via Coach" : e.source === "photo" ? " · from photo" : ""}
                </Text>
              </View>
              <Text style={styles.entryCal}>{e.calories}</Text>
            </TouchableOpacity>
          ))
        )}

        {/* Add food — full-width cocoa outline pill (same trigger as before) */}
        <TouchableOpacity style={styles.addFoodBtn} onPress={openAdd}>
          <Text style={styles.addFoodBtnText}>＋ Add food</Text>
        </TouchableOpacity>

        {/* Water */}
        <View style={styles.waterCard}>
          <View style={styles.waterLabelRow}>
            <WaterDrop />
            <Text style={styles.waterLabel}>
              Water  <Text style={styles.waterCount}>{water} / {WATER_GOAL_CUPS} cups</Text>
            </Text>
          </View>
          <View style={styles.waterControls}>
            <TouchableOpacity
              style={styles.waterBtnMinus}
              onPress={() => persist((p) => addWater(p, selDate, -1))}
            >
              <Text style={styles.waterBtnMinusText}>－</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.waterBtnPlus}
              onPress={() => persist((p) => addWater(p, selDate, 1))}
            >
              <Text style={styles.waterBtnPlusText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.disclaimer}>
          Macros are estimates — from Open Food Facts, your entries, or the Coach's best guess. Treat
          them as a guide, and edit any entry by tapping it.
        </Text>
      </ScrollView>

      {/* Add sheet — gated on `active` so it's fully unmounted (not just
          visible={false}) whenever Food isn't the visible tab, preventing the
          native modal host from being stranded on top of Food. */}
      {active && (
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        {/* Per-Modal GestureHandlerRootView: a core RN Modal's children live in a
            separate native view tree not under the app-root provider, so in-Modal
            gestures need their own root here or they silently do nothing. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <GestureDetector gesture={addSwipe.gesture}>
          <Animated.View style={[styles.sheetCard, addSwipe.sheetAnimStyle]}>
            <View>
              <DragHandle />
              {pendingHit ? (
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>how much?</Text>
                  <TouchableOpacity onPress={() => setPendingHit(null)} hitSlop={10} style={styles.backLink}>
                    <BackChevronIcon size={14} />
                    <Text style={styles.backLinkText}>BACK</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>log food</Text>
                  <TouchableOpacity
                    style={styles.sheetClose}
                    onPress={() => setAddOpen(false)}
                    hitSlop={10}
                  >
                    <Text style={styles.sheetCloseText}>×</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            {!pendingHit && (
              <Text style={styles.sheetSubtitle}>Search, scan, or just tell me what you ate.</Text>
            )}

            <ScrollView {...addSwipe.scrollViewProps} contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {pendingHit ? (
                // ---- Quantity step (log by servings or grams) ----
                <>
                  <Text style={styles.qtyFoodName}>{pendingHit.name}</Text>
                  {pendingHit.brand ? <Text style={styles.qtyFoodBrand}>{pendingHit.brand}</Text> : null}

                  {pendingHit.serving ? (
                    <View style={styles.modeTabs}>
                      {(["serving", "gram"] as const).map((u) => (
                        <TouchableOpacity
                          key={u}
                          style={[styles.modeTab, qtyUnit === u && styles.modeTabActive]}
                          onPress={() => switchUnit(u)}
                        >
                          <Text style={[styles.modeTabText, qtyUnit === u && styles.modeTabTextActive]}>
                            {u === "serving" ? "Servings" : "Grams"}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.presetChipWrap}>
                    {(qtyUnit === "serving" ? ["0.25", "0.5", "0.75", "1"] : ["50", "100", "200"]).map(
                      (v) => {
                        const on = qtyValue === v;
                        return (
                          <TouchableOpacity
                            key={v}
                            style={[styles.presetChip, on && styles.chipActive]}
                            onPress={() => setQtyValue(v)}
                          >
                            <Text style={[styles.presetChipText, on && styles.chipTextActive]}>
                              {qtyUnit === "serving" ? v : `${v} g`}
                            </Text>
                          </TouchableOpacity>
                        );
                      }
                    )}
                  </View>

                  <Text style={styles.fieldEyebrow}>{qtyUnit === "serving" ? "SERVINGS" : "GRAMS"}</Text>
                  <TextInput
                    style={styles.sheetField}
                    value={qtyValue}
                    onChangeText={setQtyValue}
                    keyboardType="numeric"
                    placeholder={qtyUnit === "serving" ? "number of servings" : "grams"}
                    placeholderTextColor={colors.inkMuted}
                  />
                  {pendingHit.serving ? (
                    <Text style={styles.servingHint}>
                      1 serving = {pendingHit.serving.grams} g
                      {pendingHit.serving.label &&
                      pendingHit.serving.label !== `${pendingHit.serving.grams} g`
                        ? ` · ${pendingHit.serving.label}`
                        : ""}
                    </Text>
                  ) : null}

                  <View style={styles.previewCard}>
                    <Text style={styles.previewCal} numberOfLines={1}>
                      {preview.calories} kcal
                    </Text>
                    <Text style={styles.previewMacros}>
                      {preview.protein}g protein · {preview.carbs}g carbs · {preview.fat}g fat
                    </Text>
                    {qtyUnit === "serving" && pendingHit.serving ? (
                      <Text style={styles.previewSub}>
                        {Math.round(resolveGrams(pendingHit, qtyUnit, qtyValue))} g total
                      </Text>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={[styles.outlineBtn, styles.saveFoodBtn, saveFav && styles.saveFoodBtnOn]}
                    onPress={() => setSaveFav((v) => !v)}
                  >
                    {saveFav ? null : <StarOutlineIcon size={13} />}
                    <Text style={styles.saveFoodBtnText}>
                      {saveFav ? "★ Saving to my foods" : "Save to my foods"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.primaryBtn} onPress={addPending}>
                    <Text style={styles.primaryBtnText}>ADD</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // ---- Mode picker ----
                <>
                  <View style={styles.segGroup}>
                    {(["search", "saved", "meals", "manual"] as Mode[]).map((m) => {
                      const on = mode === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          style={[styles.segTab, on && styles.segTabActive]}
                          onPress={() => setMode(m)}
                        >
                          <Text style={[styles.segTabText, on && styles.segTabTextActive]}>
                            {m === "search" ? "Search" : m === "saved" ? "Saved" : m === "meals" ? "Meals" : "Manual"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {lookingUp && (
                    <View style={styles.lookupRow}>
                      <ActivityIndicator />
                      <Text style={styles.lookupText}>Looking up barcode…</Text>
                    </View>
                  )}

                  {mode === "search" && (
                    <>
                      <View style={styles.searchRow}>
                        <View style={styles.searchField}>
                          <SearchIcon />
                          <TextInput
                            style={styles.searchFieldInput}
                            value={query}
                            onChangeText={setQuery}
                            placeholder="e.g. greek yogurt"
                            placeholderTextColor={colors.inkMuted}
                            autoCapitalize="none"
                            returnKeyType="search"
                            onSubmitEditing={doSearch}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                          />
                        </View>
                        <TouchableOpacity style={styles.logSearchBtn} onPress={doSearch}>
                          <Text style={styles.logSearchBtnText}>SEARCH</Text>
                        </TouchableOpacity>
                      </View>

                      {searching && <ActivityIndicator style={{ marginTop: 16 }} />}
                      {!!searchErr && <Text style={styles.searchErr}>{searchErr}</Text>}
                      {results.length > 0 && (
                        <View style={[styles.groupCard, { marginTop: 16 }]}>
                          {results.map((h, i) => (
                            <TouchableOpacity
                              key={h.id}
                              style={[styles.recentRow, i === 0 && styles.recentRowFirst]}
                              onPress={() => pickHit(h)}
                            >
                              <View style={styles.flex}>
                                <Text style={styles.recentName}>{h.name}</Text>
                                <Text style={styles.recentSub}>
                                  {h.brand ? `${h.brand} · ` : ""}
                                  {h.per100g ? `${Math.round(h.per100g.calories)} kcal / 100g` : ""}
                                </Text>
                              </View>
                              <View style={styles.addCircle}>
                                <Text style={styles.addCircleText}>+</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {searchFocused && recents.length > 0 && (
                        <>
                          <Text style={styles.sheetEyebrow}>RECENT</Text>
                          <View style={styles.groupCard}>
                            {recents.map((e, i) => (
                              <View
                                key={e.id}
                                style={[styles.recentRow, i === 0 && styles.recentRowFirst]}
                              >
                                <View style={styles.flex}>
                                  <Text style={styles.recentName}>{e.name}</Text>
                                  <Text style={styles.recentSub}>
                                    {e.quantityLabel ? `${e.quantityLabel} · ` : ""}
                                    {e.calories} kcal
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.addCircle}
                                  onPress={() => reAdd(e)}
                                  hitSlop={8}
                                >
                                  <Text style={styles.addCircleText}>+</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        </>
                      )}

                      <Text style={styles.sheetEyebrow}>OR CAPTURE IT</Text>
                      <View style={styles.captureGrid}>
                        {/* Snap a meal → choose camera or library. */}
                        <TouchableOpacity
                          style={styles.captureCard}
                          onPress={snapMealFromSheet}
                        >
                          <CameraIcon />
                          <Text style={styles.captureLabel}>Snap a meal</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.captureCard} onPress={openScanner}>
                          <BarcodeIcon />
                          <Text style={styles.captureLabel}>Scan barcode</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.captureCard} onPress={snapLabelFromSheet}>
                          <LabelIcon />
                          <Text style={styles.captureLabel}>Nutrition label</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.captureCard} onPress={tellCoach}>
                          <WrenAvatar />
                          <Text style={styles.captureLabel}>Tell Coach</Text>
                        </TouchableOpacity>
                      </View>

                      {estimating && (
                        <View style={styles.lookupRow}>
                          <ActivityIndicator />
                          <Text style={styles.lookupText}>Reading your photo…</Text>
                        </View>
                      )}
                    </>
                  )}

                  {mode === "saved" && (
                    <>
                      {(profile.savedFoods ?? []).length === 0 && recents.length === 0 ? (
                        <Text style={styles.searchErr}>
                          Star foods to save them here, or log foods to build up Recents.
                        </Text>
                      ) : null}
                      {(profile.savedFoods ?? []).length > 0 && (
                        <>
                          <Text style={styles.editorSection}>Saved</Text>
                          {(profile.savedFoods ?? []).map((s) => (
                            <View key={s.id} style={styles.hitRow}>
                              <TouchableOpacity style={styles.flex} onPress={() => logSavedFood(s)}>
                                <Text style={styles.hitName}>
                                  {s.name}
                                  {s.brand ? ` · ${s.brand}` : ""}
                                </Text>
                                <Text style={styles.hitSub}>
                                  {s.quantityLabel ? `${s.quantityLabel} · ` : ""}
                                  {s.calories} kcal
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => removeFav(s.id)} hitSlop={8}>
                                <Text style={styles.favStar}>★</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </>
                      )}
                      {recents.length > 0 && (
                        <>
                          <Text style={styles.editorSection}>Recent</Text>
                          {recents.map((e) => {
                            const saved = isFoodSaved(profile, toSavedFood(e));
                            return (
                              <View key={e.id} style={styles.hitRow}>
                                <TouchableOpacity style={styles.flex} onPress={() => reAdd(e)}>
                                  <Text style={styles.hitName}>{e.name}</Text>
                                  <Text style={styles.hitSub}>
                                    {e.quantityLabel ? `${e.quantityLabel} · ` : ""}
                                    {e.calories} kcal
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => saveRecentFood(e)} hitSlop={8}>
                                  <Text style={saved ? styles.favStar : styles.favStarOutline}>
                                    {saved ? "★" : "☆"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </>
                      )}
                    </>
                  )}

                  {mode === "meals" && (
                    <>
                      <TouchableOpacity style={[styles.outlineBtn, styles.outlineBtnPlus]} onPress={openMealBuilder}>
                        <Text style={styles.outlineBtnPlusGlyph}>+</Text>
                        <Text style={styles.outlineBtnText}>NEW MEAL</Text>
                      </TouchableOpacity>
                      {(profile.savedMeals ?? []).length === 0 ? (
                        <Text style={styles.mealsEmpty}>
                          No saved meals yet. Build one you eat often and log it in a tap.
                        </Text>
                      ) : (
                        (profile.savedMeals ?? []).map((m) => {
                          const cal = m.items.reduce((s, it) => s + it.calories, 0);
                          return (
                            <View key={m.id} style={styles.hitRow}>
                              <TouchableOpacity style={styles.flex} onPress={() => logMeal(m)}>
                                <Text style={styles.hitName}>{m.name}</Text>
                                <Text style={styles.hitSub}>
                                  {m.items.length} item{m.items.length === 1 ? "" : "s"} · {cal} kcal
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => removeMeal(m.id)} hitSlop={8}>
                                <Text style={styles.favStarOutline}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })
                      )}
                    </>
                  )}

                  {mode === "manual" && (
                    <>
                      {!!searchErr && <Text style={styles.searchErr}>{searchErr}</Text>}
                      <Text style={styles.fieldEyebrow}>NAME</Text>
                      <TextInput
                        style={styles.sheetField}
                        value={mName}
                        onChangeText={setMName}
                        placeholder="e.g. Homemade stir fry"
                        placeholderTextColor={colors.inkMuted}
                      />
                      <Text style={styles.fieldEyebrow}>
                        AMOUNT <Text style={styles.fieldEyebrowOptional}>(optional)</Text>
                      </Text>
                      <TextInput
                        style={styles.sheetField}
                        value={mQty}
                        onChangeText={setMQty}
                        placeholder="e.g. 1 bowl, 200 g"
                        placeholderTextColor={colors.inkMuted}
                      />
                      <Text style={styles.fieldEyebrow}>CALORIES</Text>
                      <TextInput
                        style={styles.sheetField}
                        value={mCal}
                        onChangeText={setMCal}
                        keyboardType="numeric"
                        placeholder="kcal"
                        placeholderTextColor={colors.inkMuted}
                      />
                      <View style={styles.macroGrid}>
                        <MacroInput label="Protein" value={mP} onChange={setMP} variant="grid" />
                        <MacroInput label="Carbs" value={mC} onChange={setMC} variant="grid" />
                        <MacroInput label="Fat" value={mF} onChange={setMF} variant="grid" />
                        <MacroInput label="Fiber" value={mFi} onChange={setMFi} variant="grid" />
                      </View>
                      <TouchableOpacity
                        style={[styles.outlineBtn, styles.saveFoodBtn, mSave && styles.saveFoodBtnOn]}
                        onPress={() => setMSave((v) => !v)}
                      >
                        {mSave ? null : <StarOutlineIcon size={13} />}
                        <Text style={styles.saveFoodBtnText}>
                          {mSave ? "★ Saving to my foods" : "Save to my foods"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.primaryBtn} onPress={addManual}>
                        <Text style={styles.primaryBtnText}>ADD</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}

      {/* Edit entry — gated on `active` (see add-sheet note above). */}
      {active && (
      <Modal
        visible={!!editEntry}
        animationType="slide"
        transparent
        onRequestClose={() =>
          confirmDelete ? setConfirmDelete(false) : setEditEntry(null)
        }
      >
        {/* Per-Modal GestureHandlerRootView — see add-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <GestureDetector gesture={editSwipe.gesture}>
          <Animated.View style={[styles.sheetCard, editSwipe.sheetAnimStyle]}>
            <View>
              <DragHandle />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>edit</Text>
                <TouchableOpacity style={styles.sheetClose} onPress={() => setEditEntry(null)} hitSlop={10}>
                  <Text style={styles.sheetCloseText}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...editSwipe.scrollViewProps} contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldEyebrow}>NAME</Text>
              <TextInput style={styles.sheetField} value={eName} onChangeText={setEName} />
              <Text style={styles.fieldEyebrow}>AMOUNT</Text>
              <TextInput
                style={styles.sheetField}
                value={eQty}
                onChangeText={onEditQtyChange}
                placeholder="e.g. 150 g"
                placeholderTextColor={colors.inkMuted}
              />
              <Text style={styles.fieldEyebrow}>CALORIES</Text>
              <TextInput
                style={styles.sheetField}
                value={eCal}
                onChangeText={setECal}
                keyboardType="numeric"
                placeholderTextColor={colors.inkMuted}
              />
              <View style={styles.macroGrid}>
                <MacroInput label="Protein" value={eP} onChange={setEP} variant="grid" />
                <MacroInput label="Carbs" value={eC} onChange={setEC} variant="grid" />
                <MacroInput label="Fat" value={eF} onChange={setEF} variant="grid" />
                <MacroInput label="Fiber" value={eFi} onChange={setEFi} variant="grid" />
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={saveEdit}>
                <Text style={styles.primaryBtnText}>SAVE</Text>
              </TouchableOpacity>
              {/* Inline saved highlight: savedToFoods is seeded from real
                  persisted state in openEdit, and toggleSaveFood flips it as it
                  saves/unsaves so the star always reflects reality. */}
              <TouchableOpacity
                style={[
                  styles.outlineBtn,
                  styles.saveFoodBtn,
                  savedToFoods && styles.saveFoodBtnSaved,
                ]}
                onPress={toggleSaveFood}
              >
                {savedToFoods ? (
                  <StarFilledIcon size={13} />
                ) : (
                  <StarOutlineIcon size={13} />
                )}
                <Text
                  style={[
                    styles.saveFoodBtnText,
                    savedToFoods && styles.saveFoodBtnTextSaved,
                  ]}
                >
                  {savedToFoods ? "Saved to my foods" : "Save to my foods"}
                </Text>
              </TouchableOpacity>
              {/* Quiet destructive action — opens the two-tap confirm sheet
                  rather than deleting immediately. */}
              <TouchableOpacity
                style={styles.deleteQuiet}
                onPress={() => setConfirmDelete(true)}
              >
                <Text style={styles.deleteQuietText}>DELETE THIS ENTRY</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
          </GestureDetector>

          {/* Delete-confirm — rendered as an in-sheet overlay INSIDE the Edit
              Modal (not a second native Modal). Stacked native Modals misfire on
              iOS (same hazard the barcode scanner avoids), so this covers the
              Edit sheet with an absolute-fill backdrop instead. When deleteEdit
              sets editEntry null, the whole Edit Modal — and this overlay —
              unmounts together. Backdrop tap = KEEP IT (calm dismiss); pressing
              the card itself does not dismiss. */}
          {confirmDelete && (
            <TouchableWithoutFeedback onPress={() => setConfirmDelete(false)}>
              <View style={styles.confirmOverlay}>
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View style={styles.sheetCard}>
                    <DragHandle />
                    <View style={styles.sheetHeader}>
                      <Text style={styles.sheetTitle}>delete this entry?</Text>
                    </View>
                    <View style={styles.confirmBody}>
                      <TouchableOpacity
                        style={[styles.primaryBtn, styles.dangerBtn]}
                        onPress={confirmDeleteEntry}
                      >
                        <Text style={styles.dangerBtnText}>DELETE</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.outlineBtn, styles.keepItBtn]}
                        onPress={() => setConfirmDelete(false)}
                      >
                        <Text style={styles.outlineBtnText}>KEEP IT</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          )}
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}

      {/* Barcode scanner — full screen, never stacked on the add sheet. Gated on
          `active` (see add-sheet note above). */}
      {active && (
      <Modal visible={scanning} animationType="slide" onRequestClose={cancelScan}>
        <BarcodeScanner onScanned={handleScan} onClose={cancelScan} />
      </Modal>
      )}

      {/* Snap-a-meal review: confirm / edit the vision estimate before saving.
          Gated on `active` (see add-sheet note above). */}
      {active && (
      <Modal
        visible={photoReview}
        animationType="slide"
        transparent
        onRequestClose={() => setPhotoReview(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm your meal</Text>
              <TouchableOpacity onPress={() => setPhotoReview(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {photoUri ? <Image source={{ uri: photoUri }} style={styles.photoThumb} /> : null}
              <Text style={styles.photoHint}>
                My best guess from the photo — fix anything that's off, then save.
              </Text>

              {drafts.map((d) => (
                <View key={d.id} style={styles.draftCard}>
                  <View style={styles.draftHeader}>
                    <TextInput
                      style={styles.draftName}
                      value={d.name}
                      onChangeText={(t) => updateDraft(d.id, "name", t)}
                      placeholder="Food name"
                    />
                    <TouchableOpacity onPress={() => removeDraft(d.id)} hitSlop={8}>
                      <Text style={styles.draftRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.input}
                    value={d.quantity}
                    onChangeText={(t) => updateDraft(d.id, "quantity", t)}
                    placeholder="Amount (e.g. 1 cup, 150 g)"
                  />
                  <Text style={styles.draftLabel}>Calories</Text>
                  <TextInput
                    style={styles.input}
                    value={d.calories}
                    onChangeText={(t) => updateDraft(d.id, "calories", t)}
                    keyboardType="numeric"
                  />
                  <View style={styles.macroInputs}>
                    <MacroInput
                      label="Protein"
                      value={d.protein}
                      onChange={(t) => updateDraft(d.id, "protein", t)}
                    />
                    <MacroInput
                      label="Carbs"
                      value={d.carbs}
                      onChange={(t) => updateDraft(d.id, "carbs", t)}
                    />
                    <MacroInput
                      label="Fat"
                      value={d.fat}
                      onChange={(t) => updateDraft(d.id, "fat", t)}
                    />
                    <MacroInput
                      label="Fiber"
                      value={d.fiber}
                      onChange={(t) => updateDraft(d.id, "fiber", t)}
                    />
                  </View>
                </View>
              ))}

              {drafts.length === 0 ? (
                <Text style={styles.searchErr}>All items removed. Close and snap again.</Text>
              ) : (
                <Text style={styles.draftTotal}>
                  Total: {drafts.reduce((s, d) => s + (parseFloat(d.calories) || 0), 0)} kcal
                </Text>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, drafts.length === 0 && styles.saveBtnDisabled]}
                onPress={savePhotoItems}
                disabled={drafts.length === 0}
              >
                <Text style={styles.saveBtnText}>
                  Save {drafts.length > 1 ? `${drafts.length} items` : "to log"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      )}

      {/* Meal builder: name + items from search / saved / manual. Gated on
          `active` (see add-sheet note above). */}
      {active && (
      <Modal
        visible={mealBuilderOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setMealBuilderOpen(false)}
      >
        {/* Per-Modal GestureHandlerRootView — see add-sheet note above. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <GestureDetector gesture={mealSwipe.gesture}>
          <Animated.View style={[styles.sheetCard, mealSwipe.sheetAnimStyle]}>
            <View>
              <DragHandle />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>new meal</Text>
                <TouchableOpacity style={styles.sheetClose} onPress={() => setMealBuilderOpen(false)} hitSlop={10}>
                  <Text style={styles.sheetCloseText}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView {...mealSwipe.scrollViewProps} contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldEyebrow}>MEAL NAME</Text>
              <TextInput
                style={styles.sheetField}
                value={mealName}
                onChangeText={setMealName}
                placeholder="e.g. My usual breakfast"
                placeholderTextColor={colors.inkMuted}
              />

              {/* Items so far */}
              {mealItems.map((d) => (
                <View key={d.id} style={styles.draftCard}>
                  <View style={styles.draftHeader}>
                    <TextInput
                      style={styles.draftName}
                      value={d.name}
                      onChangeText={(t) => updateMealItem(d.id, "name", t)}
                      placeholder="Food name"
                    />
                    <TouchableOpacity onPress={() => removeMealItem(d.id)} hitSlop={8}>
                      <Text style={styles.draftRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.input}
                    value={d.quantity}
                    onChangeText={(t) => updateMealItem(d.id, "quantity", t)}
                    placeholder="Amount (optional)"
                  />
                  <Text style={styles.draftLabel}>Calories</Text>
                  <TextInput
                    style={styles.input}
                    value={d.calories}
                    onChangeText={(t) => updateMealItem(d.id, "calories", t)}
                    keyboardType="numeric"
                  />
                  <View style={styles.macroInputs}>
                    <MacroInput label="Protein" value={d.protein} onChange={(t) => updateMealItem(d.id, "protein", t)} />
                    <MacroInput label="Carbs" value={d.carbs} onChange={(t) => updateMealItem(d.id, "carbs", t)} />
                    <MacroInput label="Fat" value={d.fat} onChange={(t) => updateMealItem(d.id, "fat", t)} />
                    <MacroInput label="Fiber" value={d.fiber} onChange={(t) => updateMealItem(d.id, "fiber", t)} />
                  </View>
                </View>
              ))}

              {/* Add items */}
              <Text style={styles.fieldEyebrow}>ADD AN ITEM</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.sheetFieldPill}
                  value={bQuery}
                  onChangeText={setBQuery}
                  placeholder="Search foods (e.g. greek yogurt)"
                  placeholderTextColor={colors.inkMuted}
                  autoCapitalize="none"
                  returnKeyType="search"
                  onSubmitEditing={doBuilderSearch}
                />
                <TouchableOpacity style={styles.searchPillBtn} onPress={doBuilderSearch}>
                  <Text style={styles.searchPillBtnText}>SEARCH</Text>
                </TouchableOpacity>
              </View>
              {bSearching && <ActivityIndicator style={{ marginTop: 12 }} />}
              {bResults.map((h) => (
                <TouchableOpacity key={h.id} style={styles.hitRow} onPress={() => addBuilderHit(h)}>
                  <View style={styles.flex}>
                    <Text style={styles.hitName}>{h.name}</Text>
                    <Text style={styles.hitSub}>
                      {h.brand ? `${h.brand} · ` : ""}
                      {h.per100g ? `${Math.round(h.per100g.calories)} kcal / 100g` : ""}
                    </Text>
                  </View>
                  <Text style={styles.hitArrow}>＋</Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity style={[styles.outlineBtn, styles.outlineBtnPlus]} onPress={addBlankMealItem}>
                <Text style={styles.outlineBtnPlusGlyph}>+</Text>
                <Text style={styles.outlineBtnText}>ADD MANUAL ITEM</Text>
              </TouchableOpacity>

              {(profile.savedFoods ?? []).length > 0 && (
                <>
                  <Text style={styles.draftLabel}>From your saved foods</Text>
                  <View style={styles.chipWrap}>
                    {(profile.savedFoods ?? []).slice(0, 12).map((s) => (
                      <TouchableOpacity key={s.id} style={styles.chip} onPress={() => addBuilderSaved(s)}>
                        <Text style={styles.chipText}>{s.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {(() => {
                const canSave = !!mealName.trim() && mealItems.some((d) => d.name.trim());
                return (
                  <>
                    <TouchableOpacity
                      style={[styles.primaryBtn, !canSave && styles.primaryBtnDisabled]}
                      onPress={saveMealDraft}
                      disabled={!canSave}
                    >
                      <Text style={styles.primaryBtnText}>SAVE MEAL</Text>
                    </TouchableOpacity>
                    {!canSave && (
                      <Text style={styles.saveMealHelper}>add at least one item to save</Text>
                    )}
                  </>
                );
              })()}
            </ScrollView>
          </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>
      )}
    </View>
  );
}

// Calorie donut ring (react-native-svg, same dep PhaseRing already uses). A
// calmFill track circle + a calm progress arc drawn with strokeDasharray,
// rotated -90deg so the arc starts at 12 o'clock and sweeps clockwise. `pct` is
// the fraction of the day's budget CONSUMED (progress through the day): empty
// day → empty ring, full budget → full ring. Center stack ("Remaining") is
// rendered by the caller as an overlay.
function Ring({ pct }: { pct: number }) {
  const size = 156;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, pct));
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.calmFill} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={colors.calm}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

// Solid sage water-drop icon — replaces the 💧 emoji in the water card. Filled
// teardrop in colors.calm, sized to sit roughly emoji-height beside "Water".
function WaterDrop({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2 C12 2 4 11 4 15 a8 8 0 0 0 16 0 C20 11 12 2 12 2 Z" fill={colors.calm} />
    </Svg>
  );
}

// ---- Add-sheet line icons --------------------------------------------------
// Thin cocoa line icons matching the Log-food mockup's capture grid + header.
// All stroke colors come from brand tokens (no raw hex).
function CloseIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6 L18 18 M18 6 L6 18" stroke={colors.inkMuted} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={colors.inkMuted} strokeWidth={2} />
      <Path d="M16.5 16.5 L21 21" stroke={colors.inkMuted} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

// Left-pointing chevron for the "Back" link on the How much? sheet. Espresso
// (cocoa/ink) stroke, matching the inline-SVG-icon pattern used elsewhere.
function BackChevronIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5 L8 12 L15 19" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Outline star for "Save to my foods" affordances. Espresso (cocoa/ink) stroke,
// 1.5px — replaces the ☆ emoji, matching the CloseIcon/SearchIcon SVG pattern.
function StarOutlineIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 l2.6 5.3 5.9 0.86 -4.27 4.16 1.0 5.88 L12 16.9 l-5.27 2.77 1.0 -5.88 -4.27 -4.16 5.9 -0.86 Z"
        stroke={colors.ink}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Filled twin of StarOutlineIcon — identical star geometry, solid Espresso fill
// (no stroke). Used by the Edit sheet's "Saved to my foods" confirmed state.
function StarFilledIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3 l2.6 5.3 5.9 0.86 -4.27 4.16 1.0 5.88 L12 16.9 l-5.27 2.77 1.0 -5.88 -4.27 -4.16 5.9 -0.86 Z"
        fill={colors.ink}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Sheet drag handle — 36×4 camel pill, centered, with the reference's top
// padding. Presentation-only grabber rendered at the top of the cleaned-up
// Food sub-sheets (How much? / New meal / Log food). Not on the Edit or
// photo-review sheets (out of scope for this pass).
function DragHandle() {
  return (
    <View style={styles.dragHandleWrap}>
      <View style={styles.dragHandle} />
    </View>
  );
}

function CameraIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 8 a1 1 0 0 1 1-1 h2 l1.5-2 h5 L15 7 h5 a1 1 0 0 1 1 1 v10 a1 1 0 0 1-1 1 H4 a1 1 0 0 1-1-1 Z"
        stroke={colors.ink}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={13} r={3.2} stroke={colors.ink} strokeWidth={1.6} />
    </Svg>
  );
}

function BarcodeIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {[4, 7, 9, 12, 15, 17, 20].map((x, i) => (
        <Path
          key={x}
          d={`M${x} 5 L${x} 19`}
          stroke={colors.ink}
          strokeWidth={i % 2 === 0 ? 1.6 : 1}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

function LabelIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 3 h14 a1 1 0 0 1 1 1 v16 a1 1 0 0 1-1 1 H5 a1 1 0 0 1-1-1 V4 a1 1 0 0 1 1-1 Z"
        stroke={colors.ink}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d="M8 8 h8 M8 12 h8 M8 16 h5" stroke={colors.ink} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

// Small circular "wren" avatar — the Tell Coach card's icon. Uses the Food
// screen's blue accent (colors.calm) with a white "wren" wordmark.
function WrenAvatar({ size = 40 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.calm,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={styles.wrenAvatarText}>wren</Text>
    </View>
  );
}

// One macro progress row: label · thin sage bar · "consumed / target g · pct".
function MacroBar({ label, value, target }: { label: string; value: number; target?: number }) {
  const pct = target && target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const pctLabel = target && target > 0 ? `${Math.round((value / target) * 100)}%` : "—";
  return (
    <View style={styles.macroBarRow}>
      <View style={styles.macroBarTop}>
        <Text style={styles.macroBarLabel}>{label}</Text>
        <Text style={styles.macroBarMeta}>
          {value} / {target ?? "—"} g · {pctLabel}
        </Text>
      </View>
      <View style={styles.macroBarTrack}>
        <View style={[styles.macroBarFill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

function MacroInput({
  label,
  value,
  onChange,
  variant = "default",
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  // "grid" = the cleaned-up Manual-tab treatment: tiny tracked-caps "PROTEIN g"
  // label over a small centered field cell (radius 8, creamTile fill). "default"
  // keeps the legacy "Protein (g)" label + full-size input used by the Edit,
  // photo-review, and meal-builder sheets (out of scope for this pass).
  variant?: "default" | "grid";
}) {
  if (variant === "grid") {
    return (
      <View style={styles.macroGridCell}>
        <Text style={styles.macroGridLabel}>{label.toUpperCase()} g</Text>
        <TextInput
          style={styles.macroGridInput}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.inkMuted}
          textAlign="center"
        />
      </View>
    );
  }
  return (
    <View style={styles.macroInputWrap}>
      <Text style={styles.macroInputLabel}>{label} (g)</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="0"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: spacing.xl, paddingBottom: 60, backgroundColor: colors.paper },

  // --- Header — single-line eyebrow (leads with FOOD) + cocoa "+" ---
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  // Smaller size + tighter tracking than the old eyebrow so the longest line
  // ("FOOD · FRI · MAY 29 · LUTEAL · REST DAY") fits on ONE line at phone width.
  eyebrow: {
    fontSize: type.size.micro,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.clay,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: colors.paper, fontSize: 22, fontWeight: "700", lineHeight: 24 },

  // --- Day strip — weekday letter over italic-serif number; TODAY filled ---
  strip: { gap: spacing.xs, paddingVertical: spacing.xs, paddingRight: spacing.sm, marginBottom: spacing.md },
  stripCell: { alignItems: "center", width: 44 },
  stripDow: {
    fontSize: type.size.micro,
    color: colors.clay,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    marginBottom: spacing.xs,
  },
  stripDowSel: { color: colors.calm },
  stripCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  stripCircleSel: { backgroundColor: colors.calm },
  stripNum: {
    fontSize: type.size.headline,
    fontFamily: type.label.family,
    color: colors.clay,
  },
  stripNumSel: { color: colors.cream },
  selDateLabel: {
    fontSize: type.size.callout,
    fontWeight: type.weight.semibold,
    color: colors.ink,
    marginBottom: spacing.md,
  },

  // --- CALORIES REMAINING card ---
  calCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    // HERO depth — matches the Workout hero lift.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  calCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  cardEyebrow: {
    fontSize: type.size.caption,
    fontWeight: type.weight.medium,
    letterSpacing: type.tracking.wide,
    color: colors.clay,
  },
  dayPill: {
    backgroundColor: colors.calmFill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dayPillText: {
    fontSize: type.size.micro,
    fontWeight: type.weight.semibold,
    letterSpacing: type.tracking.wide,
    color: colors.calm,
  },
  calBody: { flexDirection: "row", alignItems: "center", gap: spacing.xl },

  // Donut ring — enlarged so it's the card's focal element.
  ringWrap: { width: 156, height: 156, alignItems: "center", justifyContent: "center" },
  ringCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  // Smaller center number than before (bigger ring, smaller number).
  // Matches the macro rows' font (Carbs/Protein/Fat/Fiber + their figures):
  // plain system sans, semibold — no serif/italic. Size 26 + centering kept.
  ringNum: {
    fontSize: 26,
    // Match the carbs/protein/fat/fiber macro numbers (macroBarLabel): system
    // font + real semibold. The Manrope family was ignoring the weight (faux),
    // which made the big "Remaining" number read thin; dropping the family lets
    // the semibold actually apply, matching the macro rows.
    fontWeight: type.weight.semibold,
    color: colors.ink,
  },
  ringLabel: { fontSize: type.size.micro, color: colors.clay, marginTop: 1 },

  // Breakdown table — compact small-text block (the ring is the focus).
  breakdown: { flex: 1 },
  breakRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  breakLabel: { fontSize: type.size.caption, color: colors.ink },
  breakLabelMuted: { color: colors.clay },
  // Numbers upright (NOT italic-serif) — regular sans number style.
  breakVal: { fontSize: type.size.caption, fontWeight: type.weight.semibold, color: colors.ink },
  breakValMuted: { color: colors.clay, fontWeight: type.weight.regular },
  exerciseRight: { alignItems: "flex-end" },
  breakDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  breakLabelTotal: { fontSize: type.size.caption, fontWeight: type.weight.semibold, color: colors.calm },
  breakValTotal: { fontSize: type.size.body, fontWeight: type.weight.bold, color: colors.calm },

  noTarget: { fontSize: type.size.callout, color: colors.clay, lineHeight: 18 },

  // Macro progress rows
  macroDivider: { height: 1, backgroundColor: colors.divider, marginTop: spacing.lg, marginBottom: spacing.sm },
  macroBarRow: { marginTop: spacing.md },
  macroBarTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: spacing.xs },
  macroBarLabel: { fontSize: type.size.body, fontWeight: type.weight.semibold, color: colors.ink },
  macroBarMeta: { fontSize: type.size.caption, color: colors.clay },
  macroBarTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.calmFill, overflow: "hidden" },
  macroBarFill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.calm },

  // --- FOOD TODAY ---
  foodTodayHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  foodTodayMeta: { fontSize: type.size.caption, color: colors.clay },

  empty: { color: colors.clay, fontSize: type.size.callout, lineHeight: 22, marginTop: spacing.xs, marginBottom: spacing.md },
  entryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    // LIST depth — gentle so a long list doesn't read heavy.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  entryMain: { flex: 1, paddingRight: spacing.md },
  entryName: { fontSize: type.size.body, color: colors.ink, fontWeight: type.weight.semibold },
  entrySub: { fontSize: type.size.caption, color: colors.clay, marginTop: 2 },
  entryCal: {
    fontSize: type.size.headline,
    fontFamily: type.label.family,
    color: colors.ink,
  },

  // --- Add food — full-width cocoa outline pill ---
  addFoodBtn: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  addFoodBtnText: { color: colors.ink, fontSize: type.size.body, fontWeight: type.weight.semibold },

  // --- Water ---
  waterCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // LIST depth — gentle lift for this compact utility row.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  waterLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  waterLabel: { fontSize: type.size.body, fontWeight: type.weight.semibold, color: colors.ink },
  waterCount: { fontSize: type.size.callout, fontWeight: type.weight.regular, color: colors.clay },
  waterControls: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  waterBtnMinus: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  waterBtnMinusText: { fontSize: 20, fontWeight: "700", color: colors.ink, lineHeight: 22 },
  waterBtnPlus: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.calm,
    alignItems: "center",
    justifyContent: "center",
  },
  waterBtnPlusText: { fontSize: 20, fontWeight: "700", color: colors.cream, lineHeight: 22 },

  disclaimer: { fontSize: type.size.caption, color: colors.clay, marginTop: spacing.md, lineHeight: 18 },

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  // Absolute-fill dim cover for the in-sheet delete confirmation. Sits on top of
  // the Edit sheet content (last child of the Edit Modal) — same dim as
  // modalBackdrop, anchored to the bottom so the confirm card slides up.
  confirmOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: "90%",
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  modalTitle: { fontSize: 19, fontWeight: "700", color: "#1a1a1a" },
  // "✕" close icon on legacy sheets (New meal / Edit). Taupe (clay), per spec.
  modalClose: { fontSize: 16, color: colors.clay, fontWeight: type.weight.medium },
  modalScroll: { paddingHorizontal: 20, paddingBottom: 32 },

  // "‹ Back" link (How much? top-right): Espresso (ink) chevron + text, Manrope
  // 500, no underline.
  backLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  backLinkText: { fontFamily: type.ui.family, fontSize: 16, color: colors.ink },

  editorSection: { fontSize: 15, fontWeight: "700", color: "#333", marginTop: 18, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Quick-preset pills (How much?): Inactive = transparent fill, Cocoa (ink)
  // text, 0.5px Espresso-20% border, 100px pill, 12px Manrope 500. Selected =
  // Espresso (ink) fill, Glaze (cream) text (kept consistent with the system).
  chip: {
    borderWidth: 0.5,
    borderColor: "rgba(59,47,34,0.20)", // Espresso 20%
    backgroundColor: "transparent",
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: type.ui.family, fontSize: 12, color: colors.ink },
  chipTextActive: { fontFamily: type.ui.family, color: colors.cream },
  // How-much preset row (servings: 0.25/0.5/0.75/1, grams: 50/100/200): forked
  // from chip/chipText so the four short serving chips fit one line and the row
  // gets breathing room below the Servings/Grams segmented control. Reuses the
  // shared chipActive/chipTextActive selected state.
  presetChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 20 },
  presetChip: {
    borderWidth: 0.5,
    borderColor: "rgba(59,47,34,0.20)", // Espresso 20%
    backgroundColor: "transparent",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetChipText: { fontFamily: type.ui.family, fontSize: 12, color: colors.ink },

  // Servings / Grams segmented selection (How much?): same pattern as the
  // Search/Saved/Meals/Manual segmented control. Track = Vapor; selected =
  // Glaze (cream) fill + Espresso (ink) text; inactive = Mist-dark text.
  // Servings / Grams segmented (How much?). Track = Vapor pill, 3px padding;
  // selected = Glaze (cream) fill + Espresso text Manrope 600; inactive =
  // Mist-dark text Manrope 500. Matches the reference's 100px-pill track.
  modeTabs: {
    flexDirection: "row",
    backgroundColor: colors.vapor,
    borderRadius: radius.pill,
    padding: 3,
    marginTop: 18,
  },
  modeTab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.pill },
  modeTabActive: { backgroundColor: colors.cream },
  modeTabText: { fontFamily: type.ui.family, fontSize: 12, color: colors.mistDark },
  modeTabTextActive: { fontFamily: type.label.family, color: colors.ink },

  searchRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  searchInput: { flex: 1, marginTop: 0 },
  // "SEARCH" button (New meal sheet, search row): Espresso pill, Glaze caps.
  searchBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  searchBtnText: {
    fontFamily: type.ui.family,
    color: colors.cream,
    fontSize: 15,
    letterSpacing: type.tracking.wide,
  },
  searchErr: { color: "#888", fontSize: 14, marginTop: 16, lineHeight: 20 },
  // Outlined pill: "+ New meal" (Meals tab) AND "+ Add manual item" (New meal
  // sheet). 1.5px Espresso border, transparent fill, Espresso text, Manrope
  // 500, tracked uppercase, 100px pill.
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 11,
    marginTop: 10,
  },
  scanBtnText: {
    fontFamily: type.ui.family,
    color: colors.ink,
    fontSize: 15,
    letterSpacing: type.tracking.wide,
    textTransform: "uppercase",
  },
  lookupRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  lookupText: { color: "#666", fontSize: 14 },

  // "Save to my foods" outlined pill (How much? + Manual + Edit): 1.5px Espresso
  // border, transparent fill, Espresso text, Manrope 500. SVG outline star.
  favBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 11,
    marginTop: 12,
  },
  favBtnOn: { borderColor: colors.ink, backgroundColor: colors.creamTile },
  favBtnText: { fontFamily: type.ui.family, color: colors.ink, fontSize: 15 },
  favBtnTextOn: { color: colors.ink },
  // Saved/recent list stars — swept off the amber/grey to the cocoa register.
  favStar: { color: colors.ink, fontSize: 20, fontWeight: "700", paddingHorizontal: 4 },
  favStarOutline: { color: colors.clay, fontSize: 20, fontWeight: "700", paddingHorizontal: 4 },

  hitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  hitName: { fontSize: 15, color: "#1a1a1a", fontWeight: "600" },
  hitSub: { fontSize: 13, color: "#888", marginTop: 2 },
  hitArrow: { fontSize: 20, color: colors.ink, fontWeight: "700", paddingLeft: 10 },
  hitBrand: { fontSize: 13, color: "#888", marginTop: -2, marginBottom: 4 },

  // ---- Log-food add sheet (mockup-matched) -------------------------------
  logHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  logTitle: {
    fontFamily: type.display.family,
    fontSize: type.size.display,
    color: colors.ink,
    letterSpacing: type.tracking.tight,
  },
  logSubtitle: {
    fontFamily: type.body.family,
    fontSize: type.size.body,
    color: colors.inkMuted,
    marginTop: spacing.xs,
  },
  logClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.md,
  },

  // Segmented pill tab group (Search / Saved / Meals / Manual). Track = Vapor
  // per sweep spec; border tinted to Vapor so the track reads as a flat field.
  segGroup: {
    flexDirection: "row",
    backgroundColor: colors.vapor,
    borderWidth: 1,
    borderColor: colors.vapor,
    borderRadius: radius.pill,
    padding: spacing.xs,
    marginTop: spacing.xl,
  },
  segTab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    borderRadius: radius.pill,
  },
  // Selected segment: Glaze (cream) fill, Espresso (ink) text. Per sweep spec
  // the active fill is Glaze rather than the earlier pass's mist.
  segTabActive: { backgroundColor: colors.cream },
  segTabText: {
    fontFamily: type.ui.family,
    fontSize: type.size.callout,
    color: colors.mistDark, // Mist-dark — inactive segment label, per spec
  },
  segTabTextActive: { fontFamily: type.ui.family, color: colors.ink },

  // Search field (magnifier + input) + cocoa SEARCH button.
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.chipRest,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  searchFieldInput: {
    flex: 1,
    fontFamily: type.body.family,
    fontSize: type.size.body,
    color: colors.ink,
    padding: 0,
  },
  logSearchBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  logSearchBtnText: {
    fontFamily: type.label.family,
    fontSize: type.size.callout,
    color: colors.paper,
    letterSpacing: type.tracking.wide,
  },

  // Eyebrow ("OR CAPTURE IT", "RECENT").
  sheetEyebrow: {
    fontFamily: type.label.family,
    fontSize: type.size.caption,
    color: colors.inkMuted,
    letterSpacing: type.tracking.wide,
    marginTop: spacing["2xl"],
    marginBottom: spacing.md,
  },

  // 2×2 capture grid.
  captureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  captureCard: {
    width: "47.5%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.chipRest,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    // MID depth — primary capture actions.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  captureLabel: {
    flex: 1,
    fontFamily: type.label.family,
    fontSize: type.size.body,
    color: colors.ink,
  },
  wrenAvatarText: {
    fontFamily: type.label.family,
    fontSize: type.size.caption,
    color: colors.paper,
  },

  // Grouped card (RECENT / live results) with hairline-divided rows.
  groupCard: {
    backgroundColor: colors.chipRest,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    // MID depth — grouped results / recent surface.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  recentRowFirst: { borderTopWidth: 0 },
  recentName: {
    fontFamily: type.label.family,
    fontSize: type.size.body,
    color: colors.ink,
  },
  recentSub: {
    fontFamily: type.body.family,
    fontSize: type.size.callout,
    color: colors.inkMuted,
    marginTop: 2,
  },
  addCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.calmFill,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.md,
  },
  addCircleText: {
    fontFamily: type.ui.family,
    fontSize: 22,
    lineHeight: 24,
    color: colors.ink,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 4,
  },
  macroInputs: { flexDirection: "row", gap: 10, marginTop: 8 },
  macroInputWrap: { flex: 1 },
  macroInputLabel: { fontSize: 13, color: "#666", fontWeight: "600", marginTop: 10 },

  // Calorie summary tile (How much?): Cream (#F5EFE6 creamTile) fill, kcal
  // number Espresso (ink) Manrope 700 28pt, macros below Cocoa (cocoaSoft).
  previewCard: {
    backgroundColor: colors.creamTile,
    borderRadius: 14,
    padding: 18,
    marginTop: 16,
    alignItems: "center",
    // LIST depth — quiet lift for this creamTile working surface.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  previewCal: { fontFamily: type.display.family, fontSize: 28, color: colors.ink, letterSpacing: -0.5, lineHeight: 36, alignSelf: "stretch", textAlign: "center" },
  previewMacros: { fontFamily: type.body.family, fontSize: 12, color: colors.cocoaSoft, marginTop: 6 },
  previewSub: { fontSize: 12, color: colors.clay, marginTop: 4 },
  // Grams/servings hint under the field: 11px clay. Reference "1 serving = 170 g".
  servingHint: { fontFamily: type.body.family, fontSize: 11, color: colors.clay, marginTop: 6 },

  // Primary "ADD" / "Save meal" button: Espresso (ink) fill, Glaze (cream)
  // text, Manrope 500, tracked uppercase, 100px pill. Disabled = Espresso 25%.
  saveBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnDisabled: { backgroundColor: "rgba(59,47,34,0.25)" }, // Espresso 25%
  saveBtnText: {
    fontFamily: type.ui.family,
    color: colors.cream,
    fontSize: 16,
    letterSpacing: type.tracking.wide,
    textTransform: "uppercase",
  },

  photoThumb: { width: "100%", height: 180, borderRadius: 14, marginTop: 14, backgroundColor: "#eee" },
  photoHint: { fontSize: 13, color: "#888", marginTop: 10, lineHeight: 18 },
  draftCard: {
    // Swept off the purple-tinted off-white to the warm cream tile fill.
    backgroundColor: colors.creamTile,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#eee",
    // LIST depth — quiet lift for this creamTile working surface.
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  draftHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  draftName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    paddingVertical: 4,
  },
  draftRemove: { fontSize: 16, color: "#bbb", fontWeight: "700", paddingHorizontal: 4 },
  draftLabel: { fontSize: 13, color: "#666", fontWeight: "600", marginTop: 12 },
  draftTotal: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", marginTop: 18, textAlign: "center" },

  // ===== Cleaned-up Food sub-sheets (How much? / New meal / Log food) =======
  // Forked from the shared modalCard/modalHeader/editorSection/input/saveBtn/
  // favBtn so the Edit + photo-review sheets (out of scope) keep their look.

  // Sheet card: Glaze (cream) fill, 24px top radius, soft shadow. (Bottom
  // corners are off-screen on a bottom sheet; rounding the top matches both the
  // reference card and the existing slide-up presentation.)
  sheetCard: {
    backgroundColor: colors.surface, // #FBF7F0 cream
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    paddingTop: 8,
    // Normalized off "#000" to the brand cocoa register; a touch more opacity so
    // the warmer cocoa still reads as lift. Offset/radius/elevation kept as-is.
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  // Drag handle — 36×4 camel pill, centered, 8px top padding per reference.
  dragHandleWrap: { alignItems: "center", paddingTop: 8 },
  dragHandle: { width: 36, height: 4, backgroundColor: colors.handle, borderRadius: radius.pill },

  // Sheet header row: lowercase display title + (× close | ‹ BACK link).
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  sheetTitle: {
    fontFamily: type.display.family, // Manrope 700
    fontSize: 28,
    lineHeight: 28,
    letterSpacing: -1,
    color: colors.ink,
  },
  sheetSubtitle: {
    fontFamily: type.body.family,
    fontSize: 13,
    color: colors.cocoaSoft,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sheetClose: { padding: 4 },
  sheetCloseText: { fontFamily: type.body.family, fontSize: 22, lineHeight: 22, color: colors.inkMuted },

  // Field eyebrow labels (NAME / GRAMS / MEAL NAME …): tiny tracked caps.
  fieldEyebrow: {
    fontFamily: type.label.family, // Manrope 600
    fontSize: 9,
    letterSpacing: 2,
    color: colors.inkMuted,
    marginTop: 18,
    marginBottom: 6,
  },
  // "(optional)" in the camel/handle tint, Manrope 500.
  fieldEyebrowOptional: { fontFamily: type.ui.family, color: colors.handle, letterSpacing: 0 },

  // Value boxes / text inputs: creamTile fill, 0.5px Espresso-10% border, r10.
  sheetField: {
    backgroundColor: colors.creamTile,
    borderWidth: 0.5,
    borderColor: "rgba(59,47,34,0.10)", // Espresso 10%
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: type.ui.family,
    fontSize: 16,
    color: colors.ink,
  },
  // Pill variant of the field — the New-meal "Add an item" search input.
  sheetFieldPill: {
    flex: 1,
    backgroundColor: colors.creamTile,
    borderWidth: 0.5,
    borderColor: "rgba(59,47,34,0.10)", // Espresso 10%
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: type.body.family,
    fontSize: 14,
    color: colors.ink,
  },

  // Macro 4-col grid (Manual tab): PROTEIN g / CARBS g / FAT g / FIBER g.
  macroGrid: { flexDirection: "row", gap: 8, marginTop: 14 },
  macroGridCell: { flex: 1 },
  macroGridLabel: {
    fontFamily: type.label.family,
    fontSize: 8,
    letterSpacing: 1.5,
    color: colors.inkMuted,
    marginBottom: 4,
  },
  macroGridInput: {
    backgroundColor: colors.creamTile,
    borderWidth: 0.5,
    borderColor: "rgba(59,47,34,0.10)", // Espresso 10%
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    fontFamily: type.ui.family,
    fontSize: 13,
    color: colors.ink,
  },

  // Primary button (ADD / SAVE MEAL): Espresso fill, Glaze caps, 100px pill,
  // tracked uppercase. Disabled = Espresso 25%.
  primaryBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 18,
  },
  primaryBtnDisabled: { backgroundColor: "rgba(59,47,34,0.25)" }, // Espresso 25%
  primaryBtnText: {
    fontFamily: type.ui.family, // Manrope 500
    color: colors.cream,
    fontSize: 13,
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  // Helper under disabled SAVE MEAL.
  saveMealHelper: {
    fontFamily: type.body.family,
    fontSize: 11,
    color: colors.inkMuted,
    textAlign: "center",
    marginTop: 8,
  },

  // Outline button base: transparent fill, 1.5px Espresso border, 100px pill.
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  // "+ NEW MEAL" / "+ ADD MANUAL ITEM": tracked uppercase with leading +.
  outlineBtnPlus: { paddingVertical: 12, gap: 6, marginTop: 12 },
  outlineBtnPlusGlyph: { fontFamily: type.ui.family, fontSize: 14, lineHeight: 14, color: colors.ink },
  outlineBtnText: {
    fontFamily: type.ui.family,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.ink,
    textTransform: "uppercase",
  },
  // "Save to my foods": sentence-case (NOT tracked), SVG star, 12px Manrope 500.
  saveFoodBtn: { paddingVertical: 11, gap: 8, marginTop: 12 },
  saveFoodBtnOn: { backgroundColor: colors.creamTile },
  saveFoodBtnText: { fontFamily: type.ui.family, fontSize: 12, color: colors.ink },
  // Confirmed "Saved to my foods" state on the Edit sheet — mirrors favBtnOn:
  // soft creamTile fill, keeping the 1.5px Espresso border (from outlineBtn) and
  // ink text. Calm confirmation, not a loud accent.
  saveFoodBtnSaved: { backgroundColor: colors.creamTile, borderColor: colors.ink },
  saveFoodBtnTextSaved: { color: colors.ink },

  // Quiet destructive action (Edit sheet "DELETE THIS ENTRY"): transparent, no
  // border, centered, warm-clay tracked caps. Reads smaller + quieter than the
  // SAVE pill so it's hard to mis-tap. Opens the two-tap confirm sheet.
  deleteQuiet: { alignItems: "center", paddingVertical: 8, marginTop: 16 },
  deleteQuietText: {
    fontFamily: type.label.family, // Manrope 600
    fontSize: 11,
    letterSpacing: 2,
    color: colors.warmAlert, // warm clay #B8765E
    textTransform: "uppercase",
  },

  // Confirm sheet body: stacked pills under the prompt.
  confirmBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22 },
  // Filled danger pill (confirm "DELETE"): warm-clay fill + glaze caps — a
  // warmAlert-tinted variant of primaryBtn. Severity is the two-tap flow, not
  // an alarming hue.
  dangerBtn: { backgroundColor: colors.warmAlert, marginTop: 0 },
  dangerBtnText: {
    fontFamily: type.ui.family, // Manrope 500
    color: colors.cream,
    fontSize: 13,
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  // "KEEP IT": Espresso outline pill (outlineBtn base) with vertical padding.
  keepItBtn: { paddingVertical: 14, marginTop: 10 },

  // SEARCH pill button (New-meal search row): Espresso pill, Glaze caps.
  searchPillBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  searchPillBtnText: {
    fontFamily: type.ui.family,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.cream,
  },

  // How-much food name + brand line.
  qtyFoodName: {
    fontFamily: type.label.family, // Manrope 600
    fontSize: 17,
    lineHeight: 20,
    color: colors.ink,
    marginTop: 18,
  },
  qtyFoodBrand: { fontFamily: type.body.family, fontSize: 12, color: colors.inkMuted, marginTop: 3 },

  // Meals-tab empty state: 13px clay, centered.
  mealsEmpty: {
    fontFamily: type.body.family,
    fontSize: 13,
    color: colors.inkMuted,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
