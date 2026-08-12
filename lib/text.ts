// Display-only sanitizer for Coach chat text.
//
// The Coach SYSTEM_PROMPT already forbids markdown/asterisks/bullets, but the
// model occasionally emits them anyway. This strips that formatting at RENDER
// time so literal asterisks never reach the screen (including asterisks already
// stored in older chat history). It is a pure, side-effect-free string function.
//
// SCOPE: it only touches asterisk markdown and leading bullet markers. It must
// not alter URLs, phone numbers, digits, punctuation, or any safety-relevant
// content (crisis resources, disclaimers). It is applied to the COACH branch
// only — never to text the user typed.
export function stripChatFormatting(text: string): string {
  if (!text) return text;

  // Process line by line so we can strip leading bullet markers without
  // touching newlines (paragraph breaks must survive).
  const cleaned = text
    .split("\n")
    .map((line) => {
      // 1) Unwrap **bold** -> bold. Non-greedy, content must be non-empty.
      //    Run repeatedly so adjacent/nested pairs all unwrap.
      let out = line;
      let prev: string;
      do {
        prev = out;
        out = out.replace(/\*\*(.+?)\*\*/g, "$1");
      } while (out !== prev);

      // 2) Unwrap *italic* -> italic. Avoid matching across the single `*`
      //    cases by requiring non-asterisk content inside the pair.
      do {
        prev = out;
        out = out.replace(/\*([^*\n]+?)\*/g, "$1");
      } while (out !== prev);

      // 3) Strip a leading bullet marker (`* `, `- `, `• `) plus optional
      //    indentation. Only at the very start of the (trimmed-left) line.
      out = out.replace(/^(\s*)(?:\*|•|-)\s+/, "$1");

      // 4) Remove any remaining stray asterisks anywhere in the line.
      //    KNOWN EDGE: a bare `*` between digits joins them ("5*5" -> "55").
      //    Accepted because never-show-an-asterisk is the priority and the
      //    hardcoded crisis copy is asterisk-free. Do NOT widen this to strip
      //    other chars — that risks corrupting phone numbers / safety copy.
      out = out.replace(/\*/g, "");

      // 5) Collapse doubled (or more) spaces the removals created, and trim
      //    trailing spaces. Do NOT touch newlines (handled by the split/join).
      out = out.replace(/ {2,}/g, " ").replace(/[ \t]+$/g, "");

      return out;
    })
    .join("\n");

  return cleaned;
}
