// Deterministic crisis-language backstop.
//
// Care mode in the Coach is a single in-context LLM judgment with no floor. This
// module is the guarantee: a pure, model-independent check that ALWAYS surfaces
// real support resources when a user's message contains UNAMBIGUOUS high-risk
// language. It does not replace the LLM care-mode reply — it runs alongside it,
// so support resources appear even if the model fails to trigger care mode.
//
// Detection is deliberately CONSERVATIVE. A rare false positive costs only a
// gentle "in case it helps, here's where to get support" message, which is
// acceptable. A false negative — missing a genuine crisis — is not. So we match
// only unambiguous phrasing and explicitly avoid mild/hyperbolic everyday
// expressions ("I'm starving, what's for dinner", "this workout is killing me").
//
// Resources are current as of 2024+: the NEDA *phone helpline was discontinued
// in 2023*, so we point to 988, the Crisis Text Line, and NEDA's online
// resources. Do not reintroduce a NEDA phone number.

// Warm, brief, non-clinical support message shown deterministically alongside the
// Coach's normal reply when detectCrisisLanguage trips. Plain text to match the
// chat bubble style (no markdown).
export const CRISIS_RESOURCES_MESSAGE =
  "I want to pause the coaching for a second because what you said matters more than any plan. You deserve real support from a person, not just an app. If things feel like too much, you can call or text 988 (the Suicide & Crisis Lifeline) any time, or text NEDA to 741741 to reach a trained crisis counselor. For eating-related support, nationaleatingdisorders.org has free resources. I'm still here, and reaching out to someone is a strong thing to do.";

// Normalize for matching: lowercase, collapse whitespace, strip most punctuation
// (so "throw-up" / "throw up." / "throw  up" all compare the same) while keeping
// word boundaries via spaces.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Each pattern targets ONLY unambiguous high-risk phrasing. Patterns are tested
// against the normalized (punctuation-stripped, single-spaced) text.
//
// Two buckets:
//   (a) suicidal intent / self-harm
//   (b) eating-disorder behaviors (purging, deliberate starvation intent)
//
// Kept tight on purpose. We do NOT match standalone "starving" / "dying" /
// "killing me" because those are overwhelmingly hyperbolic in this app's domain.
const CRISIS_PATTERNS: RegExp[] = [
  // (a) Suicidal intent / self-harm — explicit, not idiomatic.
  /\bkill myself\b/,
  /\bkilling myself\b/,
  /\bend my life\b/,
  /\bending my life\b/,
  /\btake my own life\b/,
  /\bdon t want to (?:be alive|live anymore|live any more|be here anymore|be here any more|exist)\b/,
  /\bwant to die\b/,
  /\bwish i (?:was|were) dead\b/,
  /\bsuicidal\b/,
  /\bcommit suicide\b/,
  /\bharm myself\b/,
  /\bhurt myself\b/,
  /\bcut myself\b/,
  /\bcutting myself\b/,
  /\bself harm\b/,
  // "can't go on" — the bare "I can't go on" form reads as despair/can't-cope,
  // not as a benign everyday phrase. (It will also match "can't go on this diet
  // anymore"; that's an accepted gentle false positive — see runSafetyAssertions.)
  /\bcan t go on\b/,
  /\bdon t want to wake up\b/,
  /\bbetter off dead\b/,
  /\bbetter off without me\b/,
  /\bno reason to live\b/,
  /\bnothing to live for\b/,
  // Self-harm via overdose — gated to medication/intent contexts so benign
  // hyperbole ("overdosed on caffeine/sugar/coffee") does NOT match.
  /\b(?:overdose|od|overdosing) on (?:my )?(?:pills|meds|medication|medications|tylenol|advil|ibuprofen|acetaminophen|painkillers|sleeping pills|antidepressants)\b/,
  /\b(?:want to|going to|gonna|planning to|trying to) (?:overdose|od|take an overdose)\b/,
  /\b(?:thinking about|planning) (?:overdosing|taking an overdose)\b/,

  // (b) ED behaviors — purging.
  /\bmake myself (?:throw up|vomit|sick)\b/,
  /\bmade myself (?:throw up|vomit|sick)\b/,
  /\bmaking myself (?:throw up|vomit|sick)\b/,
  /\bthrow(?:ing)? up after (?:i |my |every |each )?(?:eat|eating|meal|meals|food)\b/,
  /\bthrew up after (?:i |my |every |each )?(?:eat|eating|meal|meals|food)\b/,
  /\bpurge after\b/,
  /\bpurging after\b/,
  /\bmake myself purge\b/,
  /\b(?:i |been |keep )?purg(?:e|ing) (?:my (?:food|meals)|what i (?:eat|ate))\b/,
  /\bforce myself to throw up\b/,
  // Broadened purge detection: "throw up" / "throwing up" / "vomit" gated on an
  // explicit ED/compensation/intent cue. We deliberately do NOT match bare
  // vomiting (e.g. "throwing up again", "I've been throwing up") because that's
  // overwhelmingly illness, not an ED-crisis target — gating on a cue keeps
  // plainly-medical contexts (flu, stomach bug, food poisoning) FALSE.
  /\b(?:throw|throwing|threw) up(?: again)? (?:after (?:i |my |every |each )?(?:eat|eating|meal|meals|food)|to (?:lose|get rid|avoid|undo)|on purpose|every time i eat)\b/,
  /\b(?:make myself |force myself to )?vomit (?:after (?:i |my |every |each )?(?:eat|eating|meal|meals|food)|to (?:lose|get rid|avoid|undo)|on purpose|every time i eat)\b/,
  /\bvomit (?:to lose weight|on purpose|to get rid of)\b/,
  // Purge-intent objects only — food/calories/meal/"what I ate". The bare "the"
  // branch was dropped: it matched benign phrases like "get rid of the clutter" or
  // "undo the change". These still catch "to get rid of the food/calories" etc.
  /\bto get rid of (?:what i (?:ate|eat)|the food|the calories|the meal)\b/,
  /\bto undo (?:what i (?:ate|eat)|the food|the calories|the meal)\b/,

  // (b) ED behaviors — explicit deliberate starvation intent (not bare
  // "starving", which is hyperbole). Requires an intent/plan framing.
  /\b(?:going to|gonna|want to|trying to|planning to|need to) starve myself\b/,
  /\bstarve myself (?:to lose|until|so i|for weight|skinny|thin)\b/,
  // Reflexive present/continuous "starving myself" / "starve myself" — reading
  // oneself as the deliberate agent of starvation is an ED disclosure, not the
  // bare hyperbolic "I'm starving" (hunger). Bare "I'm starving" stays FALSE
  // because "myself" is required here.
  /\b(?:i m|i am|im|i ve been|ive been|i have been|been|keep|keeps|kept) starving myself\b/,
  /\bstop eating (?:to lose|until|so i|for weight|completely|altogether|entirely)\b/,
  /\bnot (?:going to |gonna )?eat (?:anything |at all )?(?:until|to lose|so i)\b/,
];

// Returns true only for UNAMBIGUOUS high-risk language. Safe on any input
// (empty / non-string-ish handled by the caller's typing).
export function detectCrisisLanguage(text: string): boolean {
  if (!text) return false;
  const t = normalize(text);
  if (!t) return false;
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

// --- Standalone assertions ------------------------------------------------------
// No test runner is wired into this Expo project, so the safety contract is
// encoded as an exported self-check that can be run on demand (it's a no-op for
// the app, which never calls it). Returns the list of failures; empty = all pass.
// Run via: `npx tsx -e "import('./lib/safety').then(s=>console.log(s.runSafetyAssertions()))"`.
export function runSafetyAssertions(): string[] {
  const failures: string[] = [];
  const must = (cond: boolean, label: string) => {
    if (!cond) failures.push(label);
  };

  // Clear crisis phrases -> true.
  must(detectCrisisLanguage("I want to kill myself"), "kill myself -> true");
  must(detectCrisisLanguage("honestly I just want to die"), "want to die -> true");
  must(detectCrisisLanguage("I make myself throw up after I eat"), "purge phrase -> true");
  must(detectCrisisLanguage("I've been throwing up after meals"), "throwing up after meals -> true");
  must(detectCrisisLanguage("I'm going to starve myself to lose weight"), "starve intent -> true");

  // Self-harm / suicidal intent — newly added phrasings -> true.
  must(detectCrisisLanguage("I can't go on"), "cant go on -> true");
  must(detectCrisisLanguage("I don't want to wake up"), "dont want to wake up -> true");
  must(detectCrisisLanguage("I'd be better off dead"), "better off dead -> true");
  must(detectCrisisLanguage("everyone would be better off without me"), "better off without me -> true");
  must(detectCrisisLanguage("there's no reason to live"), "no reason to live -> true");
  must(detectCrisisLanguage("I have nothing to live for"), "nothing to live for -> true");
  must(detectCrisisLanguage("I want to overdose on my pills"), "overdose on pills -> true");
  must(detectCrisisLanguage("I'm thinking about overdosing"), "thinking about overdosing -> true");

  // ED behaviors — newly added phrasings -> true.
  must(detectCrisisLanguage("I've been starving myself"), "starving myself continuous -> true");
  must(detectCrisisLanguage("I'm starving myself"), "starving myself present -> true");
  must(detectCrisisLanguage("I throw up after every meal"), "throw up after every meal -> true");
  must(detectCrisisLanguage("I make myself vomit to lose weight"), "vomit to lose weight -> true");
  must(detectCrisisLanguage("I throw up to get rid of the food"), "throw up to get rid -> true");

  // Everyday / hyperbolic phrases -> false.
  must(!detectCrisisLanguage("I'm starving, what should I eat?"), "starving hunger -> false");
  must(!detectCrisisLanguage("I'm starving, what's for dinner"), "starving dinner -> false");
  must(!detectCrisisLanguage("this class is killing me"), "class killing me -> false");
  must(!detectCrisisLanguage("that hill workout is killing my legs"), "workout killing -> false");
  must(!detectCrisisLanguage("I'm dying for a coffee"), "dying for coffee -> false");
  must(!detectCrisisLanguage("I threw up my hands and gave up on the recipe"), "threw up hands -> false");

  // Plainly-medical / illness vomiting -> false (must NOT trip on bare illness).
  must(!detectCrisisLanguage("I've been throwing up, I think I have the flu"), "flu vomiting -> false");
  must(!detectCrisisLanguage("throwing up all night, must be a stomach bug"), "stomach bug -> false");
  must(!detectCrisisLanguage("I keep vomiting, probably food poisoning"), "food poisoning -> false");

  // Benign "overdose" hyperbole -> false.
  must(!detectCrisisLanguage("I overdosed on caffeine this morning"), "overdose caffeine -> false");
  must(!detectCrisisLanguage("I think I overdosed on sugar at the party"), "overdose sugar -> false");

  // Benign "get rid of the …" / "undo the …" -> false (the bare "the" branch was
  // dropped so these no longer trip the purge-intent patterns).
  must(!detectCrisisLanguage("I need to get rid of the clutter"), "get rid of clutter -> false");
  must(!detectCrisisLanguage("let me undo the changes"), "undo the changes -> false");

  // …but the real purge phrasings still trip.
  must(detectCrisisLanguage("I want to get rid of the calories I ate"), "get rid of the calories -> true");
  must(detectCrisisLanguage("is there a way to undo the meal I just had"), "undo the meal -> true");

  // NOTE: "I can't go on this diet anymore" intentionally resolves to TRUE — it
  // matches the bare "can t go on" pattern. This is an accepted gentle false
  // positive (it shows the supportive resources message, not a hard block).
  must(detectCrisisLanguage("I can't go on this diet anymore"), "cant go on this diet -> true (accepted gentle FP)");

  return failures;
}
