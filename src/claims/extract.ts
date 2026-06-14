import type { Claim } from "../types.js";

// Heuristic extraction of verifiable claims from the agent's final message.
// We deliberately keep this deterministic and offline: each pattern maps a
// common phrasing to a claim type the verifiers know how to check.

interface Pattern {
  type: Claim["type"];
  re: RegExp;
  /** Capture group index that holds the claim's subject (symbol/package), if any. */
  subjectGroup?: number;
}

const PATTERNS: Pattern[] = [
  // tests pass / green / N passing
  { type: "tests", re: /\b(?:all\s+)?(?:the\s+)?tests?\s+(?:are\s+|now\s+)?(?:pass(?:ing|ed|es)?|green)\b/i },
  { type: "tests", re: /\b(\d+)\s+tests?\s+pass(?:ing|ed)?\b/i, subjectGroup: 1 },
  { type: "tests", re: /\b(?:the\s+)?(?:test\s+suite|tests?)\s+(?:is|are)\s+(?:now\s+)?green\b/i },
  { type: "tests", re: /\b(?:everything|all)\s+passes\b/i },
  // added/wrote tests
  { type: "tests", re: /\b(?:added|wrote|created|included)\b[^.\n]*\btests?\b/i },
  // build / compiles / type-checks
  { type: "build", re: /\b(?:it\s+)?(?:compiles?|builds?\s+(?:cleanly|fine|successfully)|type[- ]?checks?(?:\s+cleanly)?)\b/i },
  { type: "build", re: /\bno\s+(?:type\s+|compile\s+|build\s+)?errors?\b/i },
  { type: "build", re: /\btsc\s+(?:passes|is\s+clean)\b/i },
  // no placeholders / TODOs left
  { type: "no-placeholders", re: /\bno\s+(?:placeholders?|todos?|stubs?|dummy\s+code)\b[^.\n]*\b(?:left|remaining)?\b/i },
  { type: "no-placeholders", re: /\b(?:fully|completely)\s+implemented\b/i },
  // implementation of a named symbol
  { type: "implementation", re: /\b(?:implemented|added|created|wrote|built|introduced)\s+(?:the\s+|a\s+|an\s+)?(?:function|method|class|component|endpoint|route|handler|helper)?\s*`?([A-Za-z_$][A-Za-z0-9_$]*)`?(?:\(\))?/i, subjectGroup: 1 },
  { type: "implementation", re: /\b(?:fixed|resolved)\s+(?:the\s+)?bug\b/i },
  // dependency usage
  { type: "dependency", re: /\b(?:use[sd]?|using|added|installed|import(?:ed|s)?|depend(?:s|ency)?\s+on)\s+(?:the\s+)?`([@a-z0-9][@a-z0-9._/-]*)`/i, subjectGroup: 1 },
  // generic done
  { type: "done", re: /\b(?:all\s+done|task\s+complete[d]?|implementation\s+complete|ready\s+to\s+merge|good\s+to\s+merge|production[- ]ready|fully\s+working|everything\s+works)\b/i },
];

/** Sentence-ish slice around a match, for showing the agent's own words. */
function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  let end = text.indexOf(".", index + length);
  if (end === -1) end = Math.min(text.length, index + length + 80);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function extractClaims(text: string): Claim[] {
  if (!text) return [];
  const claims: Claim[] = [];
  const seen = new Set<string>();

  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const subject = p.subjectGroup ? m[p.subjectGroup] : undefined;
      const key = `${p.type}:${subject ?? snippet(text, m.index, m[0].length)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        type: p.type,
        text: snippet(text, m.index, m[0].length),
        ...(subject ? { subject } : {}),
      });
      if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
    }
  }
  return claims;
}
