# Wren audit log

Appended by `wren-auditor` after every implementer change. Each entry is timestamped and references the change being audited.

Severity legend: **BLOCK** (stop, fix before continuing) · **WARN** (fix soon) · **NOTE** (worth knowing).

---

---
## 2026-05-31T00:00:00Z — FoodScreen "How much?" quantity-step layout tweaks (kcal shrink-to-fit + numbers-only serving chips, forked styles)

### Summary
Clean — 0 blockers, 0 warnings, 2 notes. Presentation-only; no behavior, math, scope, dependency, or safety surface touched.

### Findings
- [NOTE] FoodScreen.tsx:1014-1031 — Preset-chip value logic unchanged and correct. Value arrays, setQtyValue(v), and qtyValue===v comparison all use raw v; only displayed <Text> changed (serving chips numbers-only, grams chips still "X g"). Label decoupled from value. Unit unambiguous given Servings/Grams segmented control + "SERVINGS" eyebrow + numeric input.
- [NOTE] FoodScreen.tsx:1053 & 2539 — adjustsFontSizeToFit + numberOfLines={1} on previewCal is cosmetic shrink-to-fit; rendered text still {preview.calories} kcal. lineHeight 36 / font 28 / letterSpacing -0.5 confirmed. No value hidden/altered.

### Verification detail
- Math untouched: resolveGrams/scaleHit/preview/addPending unchanged.
- Shared-style claim TRUE: chip/chipWrap/chipText (2224-2238) unmodified, used only at meal-builder saved-chips row (1690-1693). New presetChip* forks (2243-2252) used only at preset row (paddingHorizontal 12, gap 6, fontSize 12, presetChipWrap marginTop 20). Selected state reuses shared chipActive/chipTextActive — unchanged.
- No ED-safety/disclaimer/Coach/BC surface touched. No earn/burn/deficit framing; numbers-only chips neutral.
- No scope creep, no new deps, no fetch/axios, no new theme tokens. Confined to JSX render + StyleSheet.
- TS hygiene: no new any/casts/promises in edited region.

### Not checked
- On-device visual rendering: kcal fit at new lineHeight and four-serving-chips-on-one-line not statically verifiable; requires implementer device/simulator test.

---
## 2026-05-31T00:00:00Z — FoodScreen Search results card top margin (presentation-only)

### Summary
Clean — 0 blockers, 0 warnings. Trivial presentation-only change confirmed.

### Findings
- [NOTE] FoodScreen.tsx:1133 — Search-tab results card style changed from styles.groupCard to [styles.groupCard, { marginTop: 16 }], adding 16pt top margin so the card isn't flush against the search bar. Array-style override; does not mutate shared groupCard (line 2475, confirmed unchanged). RECENT card (line 1158, bare styles.groupCard) and other consumers unaffected.

Verified proportional to scope: no behavior/wiring/data/math change (pickHit, results.map, doSearch, state all untouched); no ED-safety/disclaimer/Coach/BC surface in this block; no scope creep, no new deps/tokens/network; shared groupCard object unmodified.

### Not checked
- Device visual rendering of the 16pt gap — requires implementer simulator check. Logic is sound.

## 2026-05-31 — Coach tab batch (rebrand migration + data cards + Clear→Settings)

**Scope:** CoachScreen.tsx (token migration / de-purpling, header redesign, white bg, "OR ASK ME" prompt list, glitch fix), SettingsScreen.tsx + App.tsx (Clear chat moved to Settings via clearSignal), lib/types.ts (CoachCard type), lib/coach.ts (new suggest_meal tool), lib/theme.ts (4 new tokens).

**Verdict: PASS** — no BLOCK. 2 WARN, 4 NOTE.

**Safety (all intact):**
- ED_SAFETY_RULES (coach.ts:44-75) byte-for-byte unchanged and still unconditionally in the system prompt.
- set_targets BMR-floor refusals intact (CoachScreen.tsx:617, :674).
- Crisis backstop (detectCrisisLanguage/CRISIS_RESOURCES_MESSAGE) unchanged, still deterministic in deliver() incl. error path.
- suggest_meal is READ-ONLY: emits a SUGGESTED CoachCard only; never calls updateProfile/addEntry/setTargets. Cannot mutate profile, logs, or targets.
- Birth-control / phase branching unchanged (phaseLabel; only .toUpperCase() styling).

**WARN:**
1. colors.handle (#C8A989) arrow glyphs + camera icon on white (#FFFFFF) ≈1.9:1 — below 3:1 non-text minimum. Decorative, not safety copy. Consider inkMuted for icons if legibility matters.
2. inkMuted (#8A7B68) micro-labels on white ≈3.0:1 — fails AA for small text; consistent with the known/accepted clay tradeoff, marginally worse on white. Not safety-relevant. No new debt.

**NOTE:**
1. clearSignal reboot is skipped if a Coach turn is mid-flight when Clear is confirmed (guard returns early); storage cleared but in-memory messages persist until remount. Minor follow-up.
2. LOGGED card derivation reads log_food args at call time — no stale read / double-count.
3. CTA Save-for-later reuses findSavedFood/sameFood via shared updateProfile; Show-more uses normal send path.
4. 4 new theme tokens role-commented, brand-consistent, no new raw color (cardHairline = cocoa @12%).

Zero raw hexes, zero fontWeight in CoachScreen.tsx.

**Resolution (2026-05-31, same day):**
- WARN-1 (faint camel arrows on white): RESOLVED — `ArrowRightIcon` stroke bumped `colors.handle` → `colors.inkMuted` per Ting; camera icon was already `inkMuted`. `colors.handle` no longer referenced in CoachScreen.tsx. tsc clean.
- Clear-during-in-flight path: a conservative re-audit raised two WARNs — if a Coach turn is mid-flight when "Clear chat history" is confirmed in Settings, the `(sending||booting)` guard can drop the reboot and the in-flight reply may re-persist one orphaned assistant message. Bounded and self-healing (next clear / new day fixes it); NOT a blocker. Logged as a follow-up to harden (re-arm the signal on guard-reject, or await the in-flight turn).
- Verdict stands: no BLOCK; safe to proceed. Coach safety prompt / crisis backstop / BMR-floor / BC branching all confirmed intact.

## 2026-05-31T00:00:00Z — Profile/Settings batch (IA refactor: hub + 10 editors; sub-sheet redesign; per-editor save; add-a-memory; profilePhotoUri; Stepper de-purple)

# Audit report — 2026-05-31 Profile/Settings batch (IA refactor + sub-sheet redesign on safety-critical screen)

## Summary
Clean — 0 BLOCK, 2 WARN, 7 NOTE. All four safety-critical surfaces (BMR floor + two-step confirm, birth-control gating, destructive confirms, wipe-guard) intact and correctly ported. No Coach prompt / lib/coach.ts / lib/safety.ts / Anthropic change. No new dependency. Zero raw hex and zero fontWeight in all new/changed files. Scope respected (Notifications/Units/Sign-out NOT built). The two WARNs are a save-on-back durability window and a latent draft-loss edge in the per-editor model; neither is a safety regression.

## Findings

### SAFETY — all critical surfaces PASS (no blockers)
- [NOTE] screens/profile/TargetsEditor.tsx:38-95 — BMR floor intact. targetsFloorCalories is the live floor source; subFloorWarningCopy verbatim, one const, surfaced inline (:154) + in the confirm (:84). SAVE pill (:212) routes through handleSaveMacros, which gates on editBelowFloor and only calls persistCustomTargets from inside the "Save it anyway" destructive onPress (:89) or the non-sub-floor branch (:94). No path persists sub-floor calories without the two-step confirm. handleResetMacros clears the override (no calorie write). Hero floor line + warn block legible (callout/14 warmAlert on creamTile). Satisfies spec §6.
- [NOTE] screens/profile/CycleEditor.tsx:100-161 — BC gating intact: {!onBirthControl && (...)} hides last-period-date (+picker) and avg-length. No dayOfCycle computed/claimed/rendered (grep confirmed). Safety helper ("Not medical or fertility advice — phases are defaults; go by how you feel.") legible (cocoaSoft body/11), not softened. saveAndBack always persists onBirthControl; a stale lastPeriodStart can't surface a phase because currentPhase short-circuits on BC (cycle.ts:147). No Coach-context leak.
- [NOTE] screens/SettingsScreen.tsx:72-92 — Destructive confirms intact. handleStartOver/handleClearChat are two-tap Alerts (destructive + Cancel). The hub receives the WRAPPED confirmers (:262-263), never the raw App callbacks — cannot fire a raw wipe.
- [NOTE] Wipe-guard PASS across every write. All editors + profile-photo (SettingsScreen:109/134) + add/forget memory (MemoryEditor:25/37) use updateProfile((p)=>({...p,<ownFieldsOnly>})), reading siblings from latest p. PhotosEditor uses slot-conditional spreads each writing one URI field. No sibling map/array blanked. Wipe-bug class stays closed for the new IA.
- [NOTE] Add-a-memory PASS. commitAdd (MemoryEditor:30-40) trims, no-ops on blank, routes through addMemory (trim + case-insensitive dedupe + date stamp + MAX 40 cap, memory.ts:23-33). Manual memory is an ordinary CoachMemory read as labeled DATA below ED_SAFETY_RULES — no injection into system state, can't outrank safety.

### profilePhotoUri
- [NOTE] lib/types.ts:12, lib/storage.ts, CoachScreen.tsx:1148-1156 — Optional, round-trips with NO migration (loadProfile parses verbatim + additive normalization only; never strips optional fields). Every consumer guards (photo ? <Image> : <initials>). No crash if undefined; remove sets undefined (serializes away).

### Contrast / legibility
- [NOTE] Safety copy checked on actual surfaces: Targets hero-floor + warn (warmAlert/cocoaSoft on creamTile, AA at 14/11) and Cycle disclaimer (cocoaSoft on surface, AA). No new sub-AA safety text.
- [WARN] editorChrome.tsx:118-123/227-229 + ProfileHub.tsx:572-577 — 9px clay (inkMuted #8A7B68) eyebrows/field labels on white/creamTile are ~3.1:1, below AA. KNOWN/ACCEPTED clay-on-light debt (same token+role on shipped screens), none safety-relevant. Standing backlog, not a batch regression.

### New theme tokens
- [NOTE] lib/theme.ts:102-123 — profileSlate/profileRose/profileSage/rowHairline/badgeBorder role-commented, brand-consistent, each distinct from nearest token with rationale; used only for decorative dots / mini-SVG / hairlines (no text-on-color, none safety-relevant). No duplicates. No raw-color leak in components (literals only in theme.ts; component files reference colors.* with explanatory comments). Stepper de-purple reuses existing tokens.

### Scope / drift
- [NOTE] Notifications/Units/Sign-out NOT built (grep clean). No coach.ts/safety.ts/Anthropic/prompt change; CoachScreen change is avatar-render only. No fetch/axios/http in any editor. package.json unchanged (expo ^54.0.34; AGENTS.md SDK 54 — agree). All imports resolve to declared deps.
- [NOTE] Data model: only additive Profile change is optional profilePhotoUri. CoachMemory.date is the existing required field (always stamped by addMemory). No widen/narrow/rename of Profile/DayLog/ChatMessage beyond that; storage additive, no migration required.

### Robustness — per-editor draft vs save
- [WARN] saveAndBack ordering (BodyEditor:35-44, CycleEditor:64-72, PrefsEditor:17-20) is `void updateProfile(...); onBack();`. updateProfile updates ref+state synchronously before its await (App.tsx:106-108), so in-memory is correct at onBack(); the disk write is fire-and-forget (warn-don't-throw). Narrow risk: OS-kill in the ms before setItem resolves loses the edit from disk (correct in-session). Consistent with the app-wide void-updateProfile convention; not a regression — flagged so a future refactor doesn't assume durability at onBack(). No double-write.
- [WARN] Draft text editors (Body/Prefs/Cycle) persist only on saveAndBack. Today SAFE — both the back row and SAVE call saveAndBack, and the hub × is only reachable after returning to the hub (no bypass exit exists). Latent hazard if a future change adds gesture/hardware-back that skips saveAndBack → silent draft loss. Document the "every draft-editor exit routes through save" invariant. Selection/Photos/Memory editors persist per-interaction (no draft surface).
- [NOTE] No stacked-modal / no stranding. Editors are full-screen views swapped via SettingsScreen route state (no nested RN Modal); onBack → hub, hub × → setTab("coach"). All Alerts single, not stacked. onClose→setTab("coach") rewiring (App.tsx:242, replacing onSaved) correct now that saves are per-editor.
- [NOTE] MemoryEditor.tsx:67 — renders m.date ? ... : ... though CoachMemory.date is required; harmless defensive coding (addMemory always stamps). No action.

**Verdict: no BLOCK — safe to proceed.** Follow-ups (non-blocking): the two WARNs (save-on-back durability comment + document the draft-editor exit invariant) and the standing clay-on-light 9px label contrast debt.

---
## 2026-05-31T00:00:00Z — Progress tab round 2 (color swap + confident copy + top band + shadows)

## Summary
Clean. 0 BLOCK, 0 WARN, 4 NOTE. Presentation + copy-tone only. The confident-copy rewrite (the ED-sensitive change) stayed inside the confident-and-neutral lane — no pressure, deficit, streak, or verdict framing introduced, and every load-bearing safety clause survives verbatim. Color swap value-only; top band scoped to Progress; shadows presentation-only, warm colors.ink tone.

## Change #1 — Color swap (theme.ts) — PASS
theme.ts:198-199 — value swap: progressBg #F3ECDF→#FCFAF6 (page near-white), progressCard #FCFAF6→#F3ECDF (sand card). Keys unchanged, FLAG block updated (176-184), no other token touched. [NOTE] safety captions cocoaSoft #6B5641 on #F3ECDF card legible; separation improved slightly vs old card.

## Change #2 — Confident copy / dropped "(optional)" (ProgressScreen.tsx) — PASS (confident, not pressuring)
Eyebrows bare: CYCLE/BODY/WEIGHT. Checked vs 4 pressure tripwires — no weight-loss/deficit/calorie framing; no streak/"don't miss a day" (banner "add a new set to keep the timeline going" 723; alert "Same pose, same light works best." 473); no goal/on-track/verdict (body-comp empty "Log a DEXA or InBody scan…" 795; bf delta plain no arrows/color 627-640); no "you must track" (descriptive register). Load-bearing clauses VERBATIM: weight "never day to day…water and phase" (851); body "guide the plan, never as a verdict" (812); compare "never to judge" (1492); "Rest days are part of the plan, not a gap" (954); "dips are expected, not failures" (1036); BC bleed-framing (290); clinician note (348); low-BF%<14 note (1553-1555). "(optional)" KEPT on form fields (Side photo 1359/1374, Note 1378/1647, Lean 1627, Muscle 1637). [NOTE] 954 reassurance line is the GOOD direction — don't strip in future passes.

## Change #3 — Top-color band (App.tsx) — PASS (scoped to Progress)
App.tsx:241-340 — MainShell extracted under SafeAreaProvider; band (275-280) renders only when tab==="progress", pointerEvents none, height=insets.top, bg progressBg, absolute (349). Shared SafeAreaView stays #fff all tabs (266/343). StatusBar dark intact. TabBar (44-61)+styles unchanged. All six screens' props verbatim incl active gates. [NOTE] band non-interactive, behind content — no safe-area regression, no other-tab change.

## Change #4 — Deeper shadows (ProgressScreen.tsx) — PASS (shadows only, warm)
SOFT_SHADOW deepened (78-84) on card (1826); SOFT_SHADOW_SM (89-95) on photo frames (1869)+totals tiles (1931); active range pill lifted (1768-1775); sheets upward soft shadow (1982-1986). All shadowColor colors.ink (warm), no cool/black. No copy/wiring/color/safety rode along.

## Regression spot-check — all unchanged from prior PASS
Weight averaged-only (single bucket=plain text 858-864). BC no-day-N (936-937, 287-298). Neutral bf delta (627-640). Honest empty states. Zero purple in all four files. active-gated Modals + force-close-on-blur intact (1224-1709, 668-677). Tab bar not rebuilt; no SDK bump; no new native dep.

## Not checked
On-device contrast of cocoaSoft/ink on #F3ECDF + notch seam (device render). tsc confirmed exit 0 by orchestrator; reported CycleScreen/WorkoutScreen errors are ENOSPC sandbox artifacts, not real.

No BLOCK findings.

---
## 2026-06-02 — WorkoutScreen plan-generation loading sequence (presentation-only)

## Summary
Clean — 0 blockers, 0 warnings, 2 notes. Birth-control gate correct, ED-safety copy clean, timer cleanup sound, scope presentation-only.

## Findings
1. Coach safety prompt integrity — n/a. No Anthropic call site/system prompt touched. generatePlan still calls generateWeekPlan(profile, setup, …) unchanged (WorkoutScreen.tsx:545).
2. Birth-control branch integrity — PASS (critical). Cycle-line gate WorkoutScreen.tsx:576 (`!phase.onBirthControl && phase.dayOfCycle`) cannot leak to a BC user: currentPhase→phaseForDate returns onBirthControl:true, dayOfCycle:null for BC (cycle.ts:147-149) — fails gate twice. Unknown-phase users get dayOfCycle:null (cycle.ts:151-164) — also suppressed. Line shows only for a real natural phase.
3. ED-trigger copy — PASS. Lines: "Building your week…", "Shaping it around your goal…", "Factoring in where you are in your cycle…", "Working with your equipment…", "Keeping what you told us in mind…", "Almost ready…". No calorie/weight/body-size/deficit/burn/intensity language. Injury line never echoes raw spInjury free-text (:583-584).
4. Scope / drift — PASS. generatePlan (:525-559) unchanged. No new deps/network/storage-shape change. Change is useMemo + useState index + Animated.Value + one useEffect + static Text → Animated.Text (:1317-1319).
5. Timer hygiene — PASS. useEffect keyed [generating, planLoadingLines, planLoadingFade] (:609-643). false → reset + early return. true → one setInterval, cleanup clearInterval; torn down on success OR error (finally :557). Holds on last line (no loop). No artificial delay. Render clamps index Math.min (:1318).
12. TS hygiene — PASS. No any. planLoadingLines typed string[]. AccessibilityInfo has .catch (:598-600).

## Notes
- NOTE :576 — gate uses dayOfCycle truthiness; safe (never 0); fails closed. Consider `!= null` if touched.
- NOTE :593-601 — reduce-motion sampled once on mount; stale if toggled mid-session. Cosmetic.

## Not checked
- On-device crossfade legibility & contrast (requires device run).
- tsc confirmed clean by implementer (--noEmit, no new errors).

No BLOCK findings.

---
## 2026-06-02 — Workout generate-button rotating loading line (presentation-only)

## Summary
Clean — 0 blockers, 0 warnings, 2 notes. Presentation-only; ED-safety gating intact, no new copy, no new logic/timer/state.

## Findings
- NOTE :2084 vs :1318 — Button and plan-tab loader render byte-identical expr planLoadingLines[Math.min(planLoadingIdx, len-1)] at opacity planLoadingFade. Same useMemo (:571), same index (:590), same fade ref (:591). No new copy strings on button. Verified.
- NOTE :609-643 — Driving useEffect untouched. One interval, one index; button reuses it. No second timer, no new useState.

### Checklist cleared
- Coach safety prompt (§1): lib/coach.ts untouched.
- Prompt injection (§2): N/A; spInjury never echoed — fixed phrase "Keeping what you told us in mind…" (:584).
- ED-trigger (§3): pre-audited ED-safe strings; no deficit/burn/earn framing.
- Birth-control (§4): gating UNCHANGED. cycle line guarded !onBirthControl && dayOfCycle (:576); cycle.ts:147-152 returns dayOfCycle:null for BC AND unknown — neither sees cycle line on loader OR button. No day-N on button.
- Scope (§5): presentation-only; no new import/network/dep.
- Data model (§6)/deps (§7)/API key (§8): untouched.
- TS (§12): no new any; Math.min bounds index; array always >=1 (:572).
- Cost (§13): no model/cache/retry/call-count change.

## Not checked
- Device legibility: generating branch renders on saveBtnDisabled bg (colors.handle, tan) with cream text. Eyeball cream-on-tan contrast + confirm longest line fits via adjustsFontSizeToFit without truncating to an ED-relevant fragment.

No BLOCK findings.

---
## 2026-06-02 — Workout loading-text on generate button + Workout/Cycle avatar profile photos (presentation-only)

### Summary
Clean — 0 blockers, 0 warnings. Both presentation-only; pass ED-safety / birth-control / scope / data-model checks.

### Change A — rotating loading text on generate button (WorkoutScreen.tsx)
- WorkoutScreen.tsx:2092 — button reads identical expr as plan-tab loader (:1326): planLoadingLines[Math.min(planLoadingIdx, len-1)] at planLoadingFade. Same useMemo array, same state, same single setInterval (:610-644). No second timer, no new copy.
- WorkoutScreen.tsx:576-579 — BC/ED gating intact + centralized: cycle line pushed only when !phase.onBirthControl && phase.dayOfCycle. Button renders from same array → BC user cannot surface a cycle line. Injury line (:583-585) phrases as care, never echoes raw spInjury.
- WorkoutScreen.tsx:2082-2098 — change confined to `generating` render branch of saveBtn. onPress/disabled unchanged. No drift into generatePlan/Anthropic/persistence. New styles saveBtnLoadingRow/saveBtnLoadingText (:2636-2649) layout-only; numberOfLines=1 + adjustsFontSizeToFit guard overflow.

### Change B — profile photo on Workout + Cycle avatars (WorkoutScreen.tsx, CycleScreen.tsx)
- WorkoutScreen.tsx:1281-1289, CycleScreen.tsx:495-503 — fallback chain preserved exactly: profilePhotoUri → initials → null (clean cocoa circle for empty name). Image rendered only when profilePhotoUri truthy; no undefined-uri crash.
- onOpenSettings wrapper, activeOpacity, accessibility, non-pressable View fallback all unchanged.
- lib/types.ts:12 — profilePhotoUri?:string already optional on Profile. No model widening, no migration. overflow:"hidden" added to both avatar styles + avatarImg (42x42, r21). Image already imported in both.

Both: no Coach prompt, no lib/coach.ts change, no new dep, no networked call, no scope creep.

### Not checked
- Visual fit of adjustsFontSizeToFit on longest loading line in dark pill — needs device render.
- Runtime load of saved profilePhotoUri (file:// persistence) — confirm on device.

No BLOCK findings.

---
## 2026-06-02 — WorkoutScreen plan-loading motion change (spinner+crossfade → breathing opacity)

### Summary
Clean — 0 blockers, 0 warnings, 3 notes. Motion-only; ED-safety/birth-control gating intact, animation cleanup correct, scope held.

### Findings
- [PASS] Copy & gating — planLoadingLines useMemo (WorkoutScreen.tsx:582-599) unchanged in substance. Cycle gate `!phase.onBirthControl && phase.dayOfCycle` (:587) verified vs lib/cycle.ts:147-148 (BC → dayOfCycle:null + onBirthControl:true) — doubly defensive, no leak. Injury line phrased as care, never echoes raw text.
- [PASS] Animation cleanup — planLoadingFade→planLoadingBreath rename consistent. Teardown (:681-684) loop.stop()+removeListener; !generating branch (:630-634) resets idx→0, opacity→1. Reduce-motion path (:641-647) pins opacity + setInterval + clearInterval. Debounce (arm >0.85, fire <=0.45, once/breath, hold at last) correct. No leaked loop/listener/timer.
- [PASS] No artificial delay — generatePlan finally clears generating immediately; loader tears down on flip.
- [PASS] Scope — ActivityIndicator import (:14) + SPINNER const (:182) still live via "Reviewing your week…" loader (:2408); not dead. generatePlan/generateWeekPlan/persist untouched.
- [PASS] No Coach/data-model/dependency changes.

### Notes
- [NOTE] :653 — line-swap uses JS-thread addListener on a native-driven value; under JS load a swap could occasionally be visible vs hidden in trough. Cosmetic, no safety impact.
- [NOTE] :685 — effect deps include planLoadingLines; if profile/spEquip/spAccess/spInjury change mid-generation the breath restarts and line jumps to 0. Benign restart, not a leak.
- [NOTE] :606 — useRef(new Animated.Value(1)) allocates discarded value each render; pre-existing micro-wart, not a leak.

### Not checked
- Visual "breathing" feel & swap-invisibility — needs device test, reduce-motion on/off, both loader sites.
- tsc not re-run by auditor (implementer confirmed clean); no type-risky constructs.

No BLOCK findings.

---
## 2026-06-02 — Coach chat display-sanitization (stripChatFormatting)

### Summary
Clean — 0 blockers, 2 warnings, 2 notes. Crisis-path and safety-copy integrity verified intact; scope tightly contained to render-time presentation of the coach/assistant branch only.

### Findings
- [NOTE] lib/text.ts / CoachScreen.tsx:892,1259 — Crisis-path verified. CRISIS_RESOURCES_MESSAGE delivered as role:"assistant" → passes through stripChatFormatting at render. Traced exact string: no `*`/`**`/`*…*`, no leading bullet; 988, 741741, "(the Suicide & Crisis Lifeline)", "&", URL nationaleatingdisorders.org all asterisk-free, no double-spaces. Renders byte-for-byte identical.
- [NOTE] lib/text.ts:26,33,38,41 — Digit/phone/URL safety verified. No regex matches digits, parens, +, mid-token -, ., /. "(800) 273-8255" survives (leading-bullet regex needs marker at line start + ws). Space-collapse only 2+ spaces. Newlines preserved via split/join.
- [WARN] lib/text.ts:38 — Leading bullet stripping clips a leading "- "/"* "/"• " marker on a hyphen-led line; number/text survives, cosmetic only. Crisis copy is prose, unaffected. Keep future hardcoded safety strings as prose.
- [WARN] lib/text.ts:41 — Accepted tradeoff: digit-adjacent bare "*" joins digits ("5*5"->"55"). Crisis copy asterisk-free → immune. Residual only in LLM text, improbable + prompted-against. Code comment added flagging digit-join risk (addressed).
- [NOTE] lib/text.ts:13 — Robustness verified. Falsy returns early; empty/multiline/no-asterisk pass without throwing. Pure, no external calls. do/while loops terminate (monotone replaces; "*…*" needs non-asterisk interior).

### Scope checks (all pass)
- SYSTEM_PROMPT and all prompts NOT touched; safety prompt still attached via untouched askCoach/runConversation. PASS.
- Sanitizer render-only; does not feed any API call or alter roles. PASS.
- User branch untouched: CoachScreen.tsx:1259 `isUser ? m.content : stripChatFormatting(m.content)`. PASS.
- Crisis backstop (detectCrisisLanguage/CRISIS_RESOURCES_MESSAGE) byte-identical to prior audited state; appended deterministically in single save. PASS.
- No ChatMessage/Profile/DayLog change; no migration. lib/text.ts imports nothing; no new dep/network. PASS.

### Resolution
Auditor's recommended code comment (digit-join risk near step 4) added to lib/text.ts. Both WARNs accepted (cosmetic / immune crisis copy). No BLOCK findings.

### Not checked
- On-device visual: eyeball one coach reply with emitted **bold**/bullets + one triggered crisis message (confirm 988, 741741, URL intact).

---
## 2026-06-02 — CoachScreen calorie lineHeight + bubble row-wrap; coach.ts plan-gen OPUS

### Summary
Clean — 0 blockers, 0 warnings, 2 notes. All three changes exactly as described; no safety-prompt, ED-safety, scope, or data-model drift.

### Findings
- [NOTE] Change 1 — CoachScreen.tsx dataCardCals lineHeight 22→28, fontSize stays 22. Pure style tweak for digit-glyph headroom; right column alignItems:flex-end, unconstrained height → no reflow. Nothing else changed.
- [NOTE] Change 2 — CoachScreen.tsx:1248-1269 / styles — bubble wrapped in full-width bubbleRow (width:100%, flexDirection:row) + bubbleRowCoach/User justifyContent. Verified: coach Text has no numberOfLines/ellipsize, bubble no fixed height/overflow:hidden → full text wraps, NO truncation of any safety/ED text; stripChatFormatting still coach-branch-only; standalone TypingDots bubble (:206) unwrapped, fine; user-right/coach-left preserved. Root cause: maxWidth:82% had no definite parent width because alignSelf overrode stretch.
- [NOTE] Change 3 — coach.ts generateWeekPlan model SONNET→OPUS only. max_tokens 4000, PLAN_SYSTEM, GENERATE_PLAN_TOOL, tool_choice, request shape unchanged. OPUS=claude-opus-4-7, same const as calibration. No safety/ED content touched. SONNET still active at :435/:904/:965/:1133. Cost/latency-only; once per plan request.
- [NOTE] coach.ts:33 stale comment — RESOLVED: comment updated to note OPUS now drives both calibration AND plan generation.

### Cross-cutting
- Coach safety-prompt integrity untouched; PLAN_SYSTEM unmodified. No new deps/network (still only api.anthropic.com). Data model untouched. Prompt injection unchanged (plan-gen user content role:user). API key handling unchanged.

### Not checked
- On-device visual: confirm long coach messages wrap without clipping + calorie glyph tops no longer clipped.

No BLOCK findings.

---
## 2026-06-02 — Cycle 3-way mode (Track / Birth control / Off) across Settings + onboarding + weekday-row fix

### Summary
Feature complete + ED-safe after one BLOCK was found and fixed. 3-way cycle mode settable in Settings→Cycle AND onboarding; "off" hides ALL cycle UI app-wide + stops Coach referencing cycle.

### Verified correct
- Data model: lib/types.ts:17 cycleTrackingEnabled:boolean. Default-on back-compat lib/storage.ts:38 (`!== false → true`); only explicit false is off — NO silent opt-out. Onboarding (:950-953) + CycleEditor derive both booleans from a single mode → no contradictory state. Fixtures updated (patterns.ts:249, memory.ts:69).
- Phase: lib/cycle.ts adds "off" to PhaseInfo union; phaseForDate checks cycleTrackingEnabled===false FIRST (before BC), undefined→enabled.
- Coach safety prompt integrity: SYSTEM_PROMPT/ED_SAFETY_RULES/PROACTIVE_ED_SAFETY/PLAN_SYSTEM/PHOTO/SUMMARY/CALIBRATION all UNEDITED. Only dynamic context (buildContextBlock, planContext) + kickoff branch on cycleOff, emitting "Cycle tracking is OFF — do not mention/ask about cycle." patterns.ts:189 suppresses period heads-up.
- Off hides cycle on all surfaces: CycleScreen (showCycleUI :420, off status card :379, eyebrow :494, "+" :505), WorkoutScreen (hasPhase excludes off :362, no cycle cal math), CoachScreen (phaseLabel "" :856/:1187), SettingsScreen (:186/:227 "Cycle tracking off"), ProgressScreen (:847/:980 cycleOff guard).
- BC behavior unchanged.

### BLOCK found + resolved
- [BLOCK→FIXED] screens/FoodScreen.tsx:171 — Food eyebrow leaked "FOOD·…·OFF·…" (guard omitted "off"). FIXED: added `&& phaseInfo.phase !== "off"`. FoodScreen has no other phase surface. Re-audited clean.

### Follow-up (Ting request): predictions disclaimer gating
- [NOTE] screens/CycleScreen.tsx:821 — "Predictions are estimates…Not medical advice." was unconditional; now gated `!phase.onBirthControl && phase.phase !== "off"`. Hidden for BC + off, shown for natural-cycle (incl. no-data). ED-safe: disclaimer scopes to predictions, which only render in showCycleUI (false for BC/off) — nothing left unqualified. Only disclaimer on screen; no other safety copy touched.

### Cosmetic
- WorkoutScreen build-your-plan weekday row (dayRow/dayChip) fits Sun–Sat on one line.

### Note (non-blocking)
- OnboardingScreen dead switch* styles (~:2058-2094) left unused; safe to delete later.

No outstanding BLOCK findings.

---
## 2026-07-02T00:00:00Z — luteal phase color change (dusty rose #C68D8A → dusty plum #8E6B8E)

**Summary:** Clean. Presentation-only, single-token change (lib/theme.ts:341, `phaseColors.luteal.bg`; `ink` unchanged). 0 blockers, 0 warnings, 5 notes. Net legibility improvement over prior state. No safety / scope / data-model / Coach impact.

**Findings**
- [NOTE] lib/theme.ts:341 — Exactly the described edit; no other phase-block line moved. colors.lut (#C99B93, theme.ts:203) and colors.profileRose (#D4A89E, theme.ts:122) correctly left unchanged (separate decorative tokens).
- [NOTE] phaseColors.luteal.ink (#FFFFFF) is never rendered as text anywhere. All numeral colors in CycleScreen (620,626,634,715,728,739) and PhaseRing (302,330) are hardcoded colors.ink / colors.paper; consumers read only tint.bg. No white-on-plum text is drawn. The ink field is effectively dead metadata — safe.
- [NOTE] CycleScreen.tsx:619,625,723,736 — 32% plum wash on cream vs cocoa ink ≈7.9:1, well above the 4.5:1 body bar; predicted-period (0.22 alpha) is lighter still. Legend dot (55% alpha, :469) has no text over it. Achieves the goal: plum is hue-separated from menstrual-ember #B4564B.
- [NOTE] WorkoutScreen.tsx:388,1428 — Only site using luteal bg as literal text color: 9px bold eyebrow tint. Plum on cream ≈4.2:1 (just under AA for small text) but a strict improvement over the prior rose's ≈2.6:1; phase name is also shown as text, so meaning isn't color-dependent. Pre-existing pattern, not introduced here. Recommend on-device eyeball. SettingsScreen.tsx:194 phase dot is decorative — safe.
- [NOTE] ProgressScreen does NOT consume phaseColors.luteal (bars use colors.calm; mini-ring uses colors.lut via ProgressViz.tsx:251). Brief's "F3 grid inherits this token" does not hold in current code — zero Progress impact. Live consumers: CycleScreen, PhaseRing, WorkoutScreen, SettingsScreen — all consistent and safe.

**Out-of-scope confirmations:** Coach system prompt untouched (coach.ts "luteal" refs are prose only; API_KEY coach.ts:68 and CoachScreen template paths unaffected). BC branching untouched. No new files/network/deps, no data-model change, no key exposure.

**Not checked:** device pixel rendering — contrast values are computed (WCAG), not observed; the only near-threshold value is the 9px WorkoutScreen eyebrow (~4.2:1), which is still better than pre-change.
