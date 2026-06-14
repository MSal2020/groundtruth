import type { Receipt, Verifier, VerifyOptions } from "../types.js";
import {
  addedLines,
  escapeRe,
  isCheckableSymbol,
  isTestFile,
  readFileSafe,
  truncate,
} from "./shared.js";

// Adjudicates claims whose subject can be checked directly against the diff:
// "added tests" and "implemented <symbol>".

const TEST_CASE_RE = /\b(?:it|test|describe)\s*\(|def\s+test_|func\s+Test[A-Z]/;

export const claimsVerifier: Verifier = {
  name: "claims",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const receipts: Receipt[] = [];
    const testAdded = addedLines(opts.diff, isTestFile);

    // Current contents of changed files, so "implemented X" matches even when X
    // was a pre-existing symbol whose body changed (declaration line is context).
    const changedContent: string[] = [];
    for (const f of opts.diff) {
      const c = readFileSafe(opts.cwd, f.path);
      if (c != null) changedContent.push(c);
    }
    const addedText = addedLines(opts.diff).map((l) => l.text);

    const seen = new Set<string>();
    for (const claim of opts.claims) {
      if (claim.type === "tests" && /\b(add|wrote|created|includ)/i.test(claim.text)) {
        if (seen.has("added-tests")) continue;
        seen.add("added-tests");
        const hasNewTestCase = testAdded.some((l) => TEST_CASE_RE.test(l.text));
        if (!hasNewTestCase) {
          receipts.push({
            status: "failed",
            verifier: "claims",
            title: `claimed to add tests, but none found`,
            detail: `Agent said "${truncate(claim.text, 80)}" — no new test cases appear in the diff.`,
            claim,
          });
        }
      }

      if (claim.type === "implementation" && claim.subject) {
        const sym = claim.subject;
        if (!isCheckableSymbol(sym)) continue;
        if (seen.has(`impl:${sym}`)) continue;
        seen.add(`impl:${sym}`);
        const re = new RegExp(`\\b${escapeRe(sym)}\\b`);
        const present =
          changedContent.some((c) => re.test(c)) || addedText.some((t) => re.test(t));
        if (!present) {
          receipts.push({
            status: "warning",
            verifier: "claims",
            title: `claimed to implement \`${sym}\`, not found in diff`,
            detail: `Agent said "${truncate(claim.text, 80)}" but \`${sym}\` does not appear in any changed file.`,
            claim,
          });
        }
      }
    }

    return receipts;
  },
};
