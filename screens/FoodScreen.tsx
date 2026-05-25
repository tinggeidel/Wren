import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  Profile,
  FoodEntry,
  WATER_GOAL_CUPS,
  SavedFood,
  SavedMeal,
} from "../lib/types";
import { toISODate, parseISO, addDays } from "../lib/cycle";
import { targetForDate, planDayForDate } from "../lib/plan";
import { saveProfile } from "../lib/storage";
import {
  consumedTotals,
  remaining,
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
  FoodHit,
  ZERO,
  toSavedFood,
  saveFood,
  removeSavedFood,
  isFoodSaved,
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
};

const ACCENT = "#7c3aed";

type Mode = "search" | "saved" | "meals" | "manual";

function dateLabel(iso: string): string {
  const today = toISODate(new Date());
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return "Yesterday";
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function FoodScreen({
  profile,
  onProfileChange,
}: {
  profile: Profile;
  onProfileChange: (p: Profile) => void;
}) {
  const today = toISODate(new Date());
  // Calendar (Cal AI–style strip): the selected day drives everything below.
  const [selDate, setSelDate] = useState(today);
  const stripRef = useRef<ScrollView>(null);
  const logDays: string[] = [];
  for (let i = 41; i >= 0; i--) logDays.push(addDays(today, -i));

  // Target is cycled by the plan day's intensity (rest/light/moderate/hard) when
  // there's a plan for this date, else the base deterministic target.
  const target = targetForDate(profile, selDate);
  const planDay = planDayForDate(profile, selDate);
  const consumed = consumedTotals(profile, selDate);
  const entries = entriesFor(profile, selDate);
  const water = waterFor(profile, selDate);
  const left = target ? remaining(consumed, target) : null; // macro remaining (burn doesn't touch macros)
  // Calories burned on the selected day + the user's chosen accounting mode.
  const burned = caloriesBurnedFor(profile, selDate);
  const calMode = profile.calorieMode ?? "static";
  // "net" eat-back adds burn to the budget; "static" leaves the target as-is.
  // Either way the base target already has its BMR floor — burn never lowers it.
  const budgetCal = target ? (calMode === "net" ? target.calories + burned : target.calories) : 0;
  const calLeft = budgetCal - consumed.calories;

  // Add sheet
  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("search");

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");

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

  // Edit existing entry
  const [editEntry, setEditEntry] = useState<FoodEntry | null>(null);
  const [eName, setEName] = useState("");
  const [eQty, setEQty] = useState("");
  const [eCal, setECal] = useState("");
  const [eP, setEP] = useState("");
  const [eC, setEC] = useState("");
  const [eF, setEF] = useState("");

  async function persist(updated: Profile) {
    await saveProfile(updated);
    onProfileChange(updated);
  }

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
  function snapMeal() {
    if (estimating) return;
    Alert.alert("Add a meal", "Snap your food, a nutrition label, or scan a barcode.", [
      { text: "Take food photo", onPress: () => grabPhoto("camera", "meal") },
      { text: "Scan nutrition label", onPress: () => grabPhoto("camera", "label") },
      { text: "Scan barcode", onPress: openScanner },
      { text: "Choose from library", onPress: () => grabPhoto("library", "auto") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

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

  // Nutrition-label photo from inside the add sheet: close the sheet first so the
  // review card isn't a modal stacked on a modal.
  function scanLabelFromSheet() {
    setAddOpen(false);
    setTimeout(() => grabPhoto("camera", "label"), 350);
  }

  // --- Saved foods ---
  function logSavedFood(s: SavedFood) {
    persist(addEntry(profile, entryFromSaved(s, selDate)));
    setAddOpen(false);
  }
  function removeFav(id: string) {
    persist(removeSavedFood(profile, id));
  }
  function saveRecentFood(e: FoodEntry) {
    persist(saveFood(profile, toSavedFood(e)));
  }

  // --- Saved meals: one tap logs every item to the selected day ---
  function logMeal(m: SavedMeal) {
    let p = profile;
    for (const it of m.items) p = addEntry(p, entryFromSaved(it, selDate, "meal"));
    persist(p);
    setAddOpen(false);
  }
  function removeMeal(id: string) {
    persist(removeSavedMeal(profile, id));
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
      },
    ]);
  }
  function addBlankMealItem() {
    setMealItems((items) => [
      ...items,
      { id: newId(), name: "", quantity: "", calories: "", protein: "", carbs: "", fat: "" },
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
      items: items.map((d) =>
        toSavedFood({
          name: d.name.trim(),
          quantityLabel: d.quantity.trim() || undefined,
          calories: parseFloat(d.calories) || 0,
          protein: parseFloat(d.protein) || 0,
          carbs: parseFloat(d.carbs) || 0,
          fat: parseFloat(d.fat) || 0,
        })
      ),
    };
    await persist(saveMeal(profile, newMeal));
    setMealBuilderOpen(false);
  }

  function updateDraft(id: string, field: keyof Draft, val: string) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, [field]: val } : d)));
  }
  function removeDraft(id: string) {
    setDrafts((ds) => ds.filter((d) => d.id !== id));
  }

  async function savePhotoItems() {
    let p = profile;
    for (const d of drafts) {
      const entry = makeEntry(
        {
          name: d.name.trim() || "Food",
          quantityLabel: d.quantity.trim() || undefined,
          calories: parseFloat(d.calories) || 0,
          protein: parseFloat(d.protein) || 0,
          carbs: parseFloat(d.carbs) || 0,
          fat: parseFloat(d.fat) || 0,
          date: selDate,
        },
        "photo"
      );
      p = addEntry(p, entry);
    }
    await persist(p);
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
        per100g: pendingHit.per100g ?? undefined,
        barcode: pendingHit.barcode,
        date: selDate,
      },
      pendingHit.barcode ? "barcode" : "search"
    );
    let p = addEntry(profile, entry);
    if (saveFav) p = saveFood(p, toSavedFood(entry));
    await persist(p);
    setSaveFav(false);
    setAddOpen(false);
    setPendingHit(null);
  }

  async function addManual() {
    const name = mName.trim();
    const cal = parseFloat(mCal) || 0;
    if (!name || cal <= 0) return;
    const entry = makeEntry(
      {
        name,
        quantityLabel: mQty.trim() || undefined,
        calories: cal,
        protein: parseFloat(mP) || 0,
        carbs: parseFloat(mC) || 0,
        fat: parseFloat(mF) || 0,
        date: selDate,
      },
      "manual"
    );
    let p = addEntry(profile, entry);
    if (mSave) p = saveFood(p, toSavedFood(entry));
    await persist(p);
    setMName("");
    setMQty("");
    setMCal("");
    setMP("");
    setMC("");
    setMF("");
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
        per100g: e.per100g,
        barcode: e.barcode,
        date: selDate,
      },
      e.source
    );
    await persist(addEntry(profile, entry));
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
  }

  async function saveEdit() {
    if (!editEntry) return;
    const updated = updateEntry(profile, {
      ...editEntry,
      name: eName.trim() || editEntry.name,
      quantityLabel: eQty.trim() || undefined,
      calories: Math.round(parseFloat(eCal) || 0),
      protein: Math.round(parseFloat(eP) || 0),
      carbs: Math.round(parseFloat(eC) || 0),
      fat: Math.round(parseFloat(eF) || 0),
    });
    await persist(updated);
    setEditEntry(null);
  }

  async function deleteEdit() {
    if (!editEntry) return;
    await persist(removeEntry(profile, editEntry.date, editEntry.id));
    setEditEntry(null);
  }

  async function saveEditAsFood() {
    if (!editEntry) return;
    await persist(
      saveFood(
        profile,
        toSavedFood({
          name: eName.trim() || editEntry.name,
          brand: editEntry.brand,
          calories: parseFloat(eCal) || 0,
          protein: parseFloat(eP) || 0,
          carbs: parseFloat(eC) || 0,
          fat: parseFloat(eF) || 0,
          quantityLabel: eQty.trim() || undefined,
          per100g: editEntry.per100g,
          barcode: editEntry.barcode,
        })
      )
    );
    Alert.alert("Saved", "Added to your saved foods.");
  }

  const recents = recentFoods(profile);
  const preview = pendingHit ? scaleHit(pendingHit, resolveGrams(pendingHit, qtyUnit, qtyValue)) : ZERO;
  const calPct = target && budgetCal > 0 ? Math.min(1, consumed.calories / budgetCal) : 0;

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Food</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Text style={styles.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>

        {/* Cal AI–style day strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          ref={stripRef}
          onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={styles.strip}
        >
          {logDays.map((d) => {
            const sel = d === selDate;
            const isToday = d === today;
            const has = consumedTotals(profile, d).calories > 0;
            const dt = parseISO(d);
            return (
              <TouchableOpacity key={d} style={styles.stripCell} onPress={() => setSelDate(d)}>
                <Text style={[styles.stripDow, sel && styles.stripDowSel]}>
                  {dt.toLocaleDateString(undefined, { weekday: "narrow" })}
                </Text>
                <View
                  style={[
                    styles.stripCircle,
                    sel && styles.stripCircleSel,
                    isToday && !sel && styles.stripCircleToday,
                  ]}
                >
                  <Text style={[styles.stripNum, sel && styles.stripNumSel]}>{dt.getDate()}</Text>
                </View>
                <View style={[styles.stripDot, has && styles.stripDotOn]} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {selDate !== today && <Text style={styles.selDateLabel}>{dateLabel(selDate)}</Text>}

        <TouchableOpacity style={styles.snapBtn} onPress={snapMeal} disabled={estimating}>
          {estimating ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.snapBtnText}>📷  Snap a meal</Text>
          )}
        </TouchableOpacity>

        {/* Totals */}
        <View style={styles.totalsCard}>
          <View style={styles.totalsTop}>
            <Text style={styles.calBig}>{consumed.calories}</Text>
            <Text style={styles.calOf}>{target ? `of ${budgetCal} kcal` : "kcal logged"}</Text>
            {planDay && (
              <Text style={styles.dayType}>
                · {planDay.intensity === "rest" ? "rest day" : `${planDay.intensity} day`}
              </Text>
            )}
          </View>
          {target && (
            <>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${calPct * 100}%` }]} />
              </View>
              <Text style={styles.remainText}>
                {calLeft >= 0 ? `${calLeft} kcal left` : `${Math.abs(calLeft)} kcal over`}
              </Text>
            </>
          )}
          {burned > 0 && (
            <Text style={styles.burnedLine}>
              🔥 {burned} burned
              {target
                ? calMode === "net"
                  ? `  ·  +${burned} to today's budget`
                  : "  ·  awareness only"
                : ""}
            </Text>
          )}
          <View style={styles.macroRow}>
            <MacroStat label="Protein" value={consumed.protein} target={target?.protein} />
            <MacroStat label="Carbs" value={consumed.carbs} target={target?.carbs} />
            <MacroStat label="Fat" value={consumed.fat} target={target?.fat} />
          </View>
          {!target && (
            <Text style={styles.noTarget}>
              Add your age, height, and weight in Settings to see targets and what's left.
            </Text>
          )}
        </View>

        {/* Water */}
        <View style={styles.waterCard}>
          <Text style={styles.waterLabel}>💧 Water</Text>
          <View style={styles.waterControls}>
            <TouchableOpacity
              style={styles.waterBtn}
              onPress={() => persist(addWater(profile, selDate, -1))}
            >
              <Text style={styles.waterBtnText}>－</Text>
            </TouchableOpacity>
            <Text style={styles.waterCount}>
              {water} <Text style={styles.waterGoal}>/ {WATER_GOAL_CUPS} cups</Text>
            </Text>
            <TouchableOpacity
              style={styles.waterBtn}
              onPress={() => persist(addWater(profile, selDate, 1))}
            >
              <Text style={styles.waterBtnText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Logged foods */}
        {entries.length === 0 ? (
          <Text style={styles.empty}>
            Nothing logged for this day. Tap ＋ to search a food, scan a barcode, or just tell the
            Coach what you ate.
          </Text>
        ) : (
          entries.map((e) => (
            <TouchableOpacity key={e.id} style={styles.entryRow} onPress={() => openEdit(e)}>
              <View style={styles.entryMain}>
                <Text style={styles.entryName}>
                  {e.name}
                  {e.quantityLabel ? <Text style={styles.entryQty}>  {e.quantityLabel}</Text> : null}
                </Text>
                <Text style={styles.entrySub}>
                  {e.protein}P · {e.carbs}C · {e.fat}F
                  {e.source === "coach"
                    ? "  · via Coach"
                    : e.source === "photo"
                      ? "  · from photo"
                      : ""}
                </Text>
              </View>
              <Text style={styles.entryCal}>{e.calories}</Text>
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.disclaimer}>
          Macros are estimates — from Open Food Facts, your entries, or the Coach's best guess. Treat
          them as a guide, and edit any entry by tapping it.
        </Text>
      </ScrollView>

      {/* Add sheet */}
      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pendingHit ? "How much?" : "Log food"}</Text>
              <TouchableOpacity
                onPress={() => (pendingHit ? setPendingHit(null) : setAddOpen(false))}
                hitSlop={10}
              >
                <Text style={styles.modalClose}>{pendingHit ? "‹ Back" : "✕"}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {pendingHit ? (
                // ---- Quantity step (log by servings or grams) ----
                <>
                  <Text style={styles.editorSection}>{pendingHit.name}</Text>
                  {pendingHit.brand ? <Text style={styles.hitBrand}>{pendingHit.brand}</Text> : null}

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

                  <View style={styles.chipWrap}>
                    {(qtyUnit === "serving" ? ["0.25", "0.5", "0.75", "1"] : ["50", "100", "200"]).map(
                      (v) => {
                        const on = qtyValue === v;
                        return (
                          <TouchableOpacity
                            key={v}
                            style={[styles.chip, on && styles.chipActive]}
                            onPress={() => setQtyValue(v)}
                          >
                            <Text style={[styles.chipText, on && styles.chipTextActive]}>
                              {qtyUnit === "serving" ? `${v} ${v === "1" ? "serving" : "servings"}` : `${v} g`}
                            </Text>
                          </TouchableOpacity>
                        );
                      }
                    )}
                  </View>

                  <Text style={styles.editorSection}>{qtyUnit === "serving" ? "Servings" : "Grams"}</Text>
                  <TextInput
                    style={styles.input}
                    value={qtyValue}
                    onChangeText={setQtyValue}
                    keyboardType="numeric"
                    placeholder={qtyUnit === "serving" ? "number of servings" : "grams"}
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
                    <Text style={styles.previewCal}>{preview.calories} kcal</Text>
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
                    style={[styles.favBtn, saveFav && styles.favBtnOn]}
                    onPress={() => setSaveFav((v) => !v)}
                  >
                    <Text style={[styles.favBtnText, saveFav && styles.favBtnTextOn]}>
                      {saveFav ? "★ Saving to my foods" : "☆ Save to my foods"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.saveBtn} onPress={addPending}>
                    <Text style={styles.saveBtnText}>Add</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // ---- Mode picker ----
                <>
                  <View style={styles.modeTabs}>
                    {(["search", "saved", "meals", "manual"] as Mode[]).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.modeTab, mode === m && styles.modeTabActive]}
                        onPress={() => setMode(m)}
                      >
                        <Text style={[styles.modeTabText, mode === m && styles.modeTabTextActive]}>
                          {m === "search" ? "Search" : m === "saved" ? "Saved" : m === "meals" ? "Meals" : "Manual"}
                        </Text>
                      </TouchableOpacity>
                    ))}
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
                        <TextInput
                          style={[styles.input, styles.searchInput]}
                          value={query}
                          onChangeText={setQuery}
                          placeholder="Search foods (e.g. greek yogurt)"
                          autoCapitalize="none"
                          returnKeyType="search"
                          onSubmitEditing={doSearch}
                        />
                        <TouchableOpacity style={styles.searchBtn} onPress={doSearch}>
                          <Text style={styles.searchBtnText}>Go</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
                        <Text style={styles.scanBtnText}>📷  Scan barcode</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.scanBtn} onPress={scanLabelFromSheet}>
                        <Text style={styles.scanBtnText}>🏷️  Nutrition label</Text>
                      </TouchableOpacity>
                      {searching && <ActivityIndicator style={{ marginTop: 16 }} />}
                      {!!searchErr && <Text style={styles.searchErr}>{searchErr}</Text>}
                      {results.map((h) => (
                        <TouchableOpacity key={h.id} style={styles.hitRow} onPress={() => pickHit(h)}>
                          <View style={styles.flex}>
                            <Text style={styles.hitName}>{h.name}</Text>
                            <Text style={styles.hitSub}>
                              {h.brand ? `${h.brand} · ` : ""}
                              {h.per100g ? `${Math.round(h.per100g.calories)} kcal / 100g` : ""}
                            </Text>
                          </View>
                          <Text style={styles.hitArrow}>›</Text>
                        </TouchableOpacity>
                      ))}
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
                      <TouchableOpacity style={styles.scanBtn} onPress={openMealBuilder}>
                        <Text style={styles.scanBtnText}>＋  New meal</Text>
                      </TouchableOpacity>
                      {(profile.savedMeals ?? []).length === 0 ? (
                        <Text style={styles.searchErr}>
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
                      <Text style={styles.editorSection}>Name</Text>
                      <TextInput
                        style={styles.input}
                        value={mName}
                        onChangeText={setMName}
                        placeholder="e.g. Homemade stir fry"
                      />
                      <Text style={styles.editorSection}>Amount (optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={mQty}
                        onChangeText={setMQty}
                        placeholder="e.g. 1 bowl, 200 g"
                      />
                      <Text style={styles.editorSection}>Calories</Text>
                      <TextInput
                        style={styles.input}
                        value={mCal}
                        onChangeText={setMCal}
                        keyboardType="numeric"
                        placeholder="kcal"
                      />
                      <View style={styles.macroInputs}>
                        <MacroInput label="Protein" value={mP} onChange={setMP} />
                        <MacroInput label="Carbs" value={mC} onChange={setMC} />
                        <MacroInput label="Fat" value={mF} onChange={setMF} />
                      </View>
                      <TouchableOpacity
                        style={[styles.favBtn, mSave && styles.favBtnOn]}
                        onPress={() => setMSave((v) => !v)}
                      >
                        <Text style={[styles.favBtnText, mSave && styles.favBtnTextOn]}>
                          {mSave ? "★ Saving to my foods" : "☆ Save to my foods"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.saveBtn} onPress={addManual}>
                        <Text style={styles.saveBtnText}>Add</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit entry */}
      <Modal
        visible={!!editEntry}
        animationType="slide"
        transparent
        onRequestClose={() => setEditEntry(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit</Text>
              <TouchableOpacity onPress={() => setEditEntry(null)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.editorSection}>Name</Text>
              <TextInput style={styles.input} value={eName} onChangeText={setEName} />
              <Text style={styles.editorSection}>Amount</Text>
              <TextInput
                style={styles.input}
                value={eQty}
                onChangeText={setEQty}
                placeholder="e.g. 150 g"
              />
              <Text style={styles.editorSection}>Calories</Text>
              <TextInput
                style={styles.input}
                value={eCal}
                onChangeText={setECal}
                keyboardType="numeric"
              />
              <View style={styles.macroInputs}>
                <MacroInput label="Protein" value={eP} onChange={setEP} />
                <MacroInput label="Carbs" value={eC} onChange={setEC} />
                <MacroInput label="Fat" value={eF} onChange={setEF} />
              </View>
              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.favBtn, { marginTop: 10 }]} onPress={saveEditAsFood}>
                <Text style={styles.favBtnText}>☆ Save to my foods</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteEdit}>
                <Text style={styles.deleteBtnText}>Delete this entry</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Barcode scanner — full screen, never stacked on the add sheet */}
      <Modal visible={scanning} animationType="slide" onRequestClose={cancelScan}>
        <BarcodeScanner onScanned={handleScan} onClose={cancelScan} />
      </Modal>

      {/* Snap-a-meal review: confirm / edit the vision estimate before saving */}
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

      {/* Meal builder: name + items from search / saved / manual */}
      <Modal
        visible={mealBuilderOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setMealBuilderOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New meal</Text>
              <TouchableOpacity onPress={() => setMealBuilderOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.editorSection}>Meal name</Text>
              <TextInput
                style={styles.input}
                value={mealName}
                onChangeText={setMealName}
                placeholder="e.g. My usual breakfast"
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
                  </View>
                </View>
              ))}

              {/* Add items */}
              <Text style={styles.editorSection}>Add an item</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, styles.searchInput]}
                  value={bQuery}
                  onChangeText={setBQuery}
                  placeholder="Search foods (e.g. greek yogurt)"
                  autoCapitalize="none"
                  returnKeyType="search"
                  onSubmitEditing={doBuilderSearch}
                />
                <TouchableOpacity style={styles.searchBtn} onPress={doBuilderSearch}>
                  <Text style={styles.searchBtnText}>Go</Text>
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

              <TouchableOpacity style={styles.scanBtn} onPress={addBlankMealItem}>
                <Text style={styles.scanBtnText}>＋  Add manual item</Text>
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

              <TouchableOpacity
                style={[styles.saveBtn, (!mealName.trim() || !mealItems.some((d) => d.name.trim())) && styles.saveBtnDisabled]}
                onPress={saveMealDraft}
                disabled={!mealName.trim() || !mealItems.some((d) => d.name.trim())}
              >
                <Text style={styles.saveBtnText}>Save meal</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function MacroStat({ label, value, target }: { label: string; value: number; target?: number }) {
  return (
    <View style={styles.macroStat}>
      <Text style={styles.macroVal}>
        {value}
        {target != null ? <Text style={styles.macroTarget}>/{target}g</Text> : <Text style={styles.macroTarget}>g</Text>}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

function MacroInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
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
  container: { padding: 20, paddingBottom: 60 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: "700" },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: "#fff", fontSize: 22, fontWeight: "700", lineHeight: 24 },

  snapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0eef7",
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 16,
  },
  snapBtnText: { color: ACCENT, fontSize: 16, fontWeight: "700" },

  // Cal AI–style day strip
  strip: { gap: 6, paddingVertical: 4, paddingRight: 8, marginBottom: 6 },
  stripCell: { alignItems: "center", width: 44 },
  stripDow: { fontSize: 12, color: "#999", fontWeight: "600", marginBottom: 6 },
  stripDowSel: { color: ACCENT },
  stripCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f4f6",
  },
  stripCircleSel: { backgroundColor: ACCENT },
  stripCircleToday: { borderWidth: 2, borderColor: ACCENT, backgroundColor: "#fff" },
  stripNum: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  stripNumSel: { color: "#fff" },
  stripDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5, backgroundColor: "transparent" },
  stripDotOn: { backgroundColor: ACCENT },
  selDateLabel: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", marginBottom: 10 },

  totalsCard: { backgroundColor: "#f7f6fb", borderRadius: 16, padding: 18, marginBottom: 14 },
  totalsTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  calBig: { fontSize: 34, fontWeight: "800", color: "#1a1a1a" },
  calOf: { fontSize: 15, color: "#666", fontWeight: "600" },
  dayType: { fontSize: 13, color: ACCENT, fontWeight: "700", textTransform: "capitalize" },
  bar: { height: 8, borderRadius: 4, backgroundColor: "#e6e2f0", marginTop: 12, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: ACCENT },
  remainText: { fontSize: 13, color: "#666", marginTop: 6, fontWeight: "600" },
  burnedLine: { fontSize: 13, color: "#e8833a", marginTop: 8, fontWeight: "600" },
  macroRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  macroStat: { alignItems: "center", flex: 1 },
  macroVal: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  macroTarget: { fontSize: 13, fontWeight: "600", color: "#999" },
  macroLabel: { fontSize: 12, color: "#888", marginTop: 2 },
  noTarget: { fontSize: 13, color: "#888", marginTop: 14, lineHeight: 18 },

  waterCard: {
    backgroundColor: "#eef6fb",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  waterLabel: { fontSize: 16, fontWeight: "700", color: "#2f7fb3" },
  waterControls: { flexDirection: "row", alignItems: "center", gap: 14 },
  waterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#d4e9f5",
    alignItems: "center",
    justifyContent: "center",
  },
  waterBtnText: { fontSize: 20, fontWeight: "700", color: "#2f7fb3", lineHeight: 22 },
  waterCount: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", minWidth: 70, textAlign: "center" },
  waterGoal: { fontSize: 13, fontWeight: "600", color: "#888" },

  empty: { color: "#666", fontSize: 15, lineHeight: 22, marginTop: 8 },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  entryMain: { flex: 1, paddingRight: 10 },
  entryName: { fontSize: 16, color: "#1a1a1a", fontWeight: "600" },
  entryQty: { fontSize: 14, color: "#999", fontWeight: "400" },
  entrySub: { fontSize: 13, color: "#888", marginTop: 2 },
  entryCal: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },

  disclaimer: { fontSize: 12, color: "#999", marginTop: 18, lineHeight: 18 },

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
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
  modalClose: { fontSize: 16, color: ACCENT, fontWeight: "600" },
  modalScroll: { paddingHorizontal: 20, paddingBottom: 32 },

  editorSection: { fontSize: 15, fontWeight: "700", color: "#333", marginTop: 18, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },

  modeTabs: {
    flexDirection: "row",
    backgroundColor: "#f0eef7",
    borderRadius: 12,
    padding: 4,
    marginTop: 18,
  },
  modeTab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 9 },
  modeTabActive: { backgroundColor: "#fff" },
  modeTabText: { fontSize: 14, color: "#777", fontWeight: "600" },
  modeTabTextActive: { color: ACCENT },

  searchRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  searchInput: { flex: 1, marginTop: 0 },
  searchBtn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  searchErr: { color: "#888", fontSize: 14, marginTop: 16, lineHeight: 20 },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 10,
  },
  scanBtnText: { color: ACCENT, fontWeight: "700", fontSize: 15 },
  lookupRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  lookupText: { color: "#666", fontSize: 14 },

  favBtn: {
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    marginTop: 12,
  },
  favBtnOn: { borderColor: ACCENT, backgroundColor: "#f0eef7" },
  favBtnText: { color: "#777", fontWeight: "700", fontSize: 15 },
  favBtnTextOn: { color: ACCENT },
  favStar: { color: "#f5b301", fontSize: 20, fontWeight: "700", paddingHorizontal: 4 },
  favStarOutline: { color: "#bbb", fontSize: 20, fontWeight: "700", paddingHorizontal: 4 },

  hitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  hitName: { fontSize: 15, color: "#1a1a1a", fontWeight: "600" },
  hitSub: { fontSize: 13, color: "#888", marginTop: 2 },
  hitArrow: { fontSize: 20, color: ACCENT, fontWeight: "700", paddingLeft: 10 },
  hitBrand: { fontSize: 13, color: "#888", marginTop: -2, marginBottom: 4 },

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

  previewCard: {
    backgroundColor: "#f0eef7",
    borderRadius: 12,
    padding: 16,
    marginTop: 18,
    alignItems: "center",
  },
  previewCal: { fontSize: 24, fontWeight: "800", color: ACCENT },
  previewMacros: { fontSize: 14, color: "#555", marginTop: 4 },
  previewSub: { fontSize: 12, color: "#999", marginTop: 4 },
  servingHint: { fontSize: 13, color: "#888", marginTop: 8 },

  saveBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnDisabled: { backgroundColor: "#c9c2e0" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  photoThumb: { width: "100%", height: 180, borderRadius: 14, marginTop: 14, backgroundColor: "#eee" },
  photoHint: { fontSize: 13, color: "#888", marginTop: 10, lineHeight: 18 },
  draftCard: {
    backgroundColor: "#faf9fc",
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#eee",
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
  deleteBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  deleteBtnText: { color: "#e2556b", fontSize: 15, fontWeight: "600" },
});
