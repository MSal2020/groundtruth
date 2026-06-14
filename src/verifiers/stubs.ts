import type { Claim, Receipt, Verifier, VerifyOptions } from "../types.js";
import {
  addedLines,
  escapeRe,
  isCheckableSymbol,
  isCodeFile,
  isTestFile,
  readFileSafe,
  truncate,
} from "./shared.js";

// Detects placeholders and stubbed-out implementations the agent left behind
// while claiming the work was done.

interface Rule {
  re: RegExp;
  label: string;
  // `noisy` rules (a bare TODO, an empty catch) only surface when the agent
  // also claimed the work is done / has no placeholders. The strong rules (a
  // function that literally throws "not implemented") always surface.
  noisy?: boolean;
}

const RULES: Rule[] = [
  { re: /throw\s+new\s+\w*Error\(\s*[`'"][^`'"]*\b(?:not\s*implemented|unimplemented|todo|implement\s+this|implement\s+later)\b/i, label: "throws 'not implemented'" },
  { re: /\braise\s+NotImplementedError\b/, label: "raises NotImplementedError" },
  { re: /\bpanic\(\s*[`'"][^`'"]*\b(?:todo|not\s*implemented)/i, label: "panic('TODO')" },
  { re: /\bnot\s+yet\s+implemented\b/i, label: "placeholder text" },
  { re: /\/\/\s*(?:TODO|FIXME|XXX|HACK)\b/, label: "TODO/FIXME comment", noisy: true },
  { re: /#\s*(?:TODO|FIXME|XXX)\b/, label: "TODO/FIXME comment", noisy: true },
  { re: /\/\*\s*(?:TODO|FIXME)\b/, label: "TODO/FIXME comment", noisy: true },
  { re: /\b(?:coming\s+soon|implement(?:ed)?\s+later|stub(?:bed)?\s+out)\b/i, label: "placeholder text", noisy: true },
  { re: /catch\s*\([^)]*\)\s*\{\s*\}/, label: "empty catch block (swallows errors)", noisy: true },
];

export const stubsVerifier: Verifier = {
  name: "stubs",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const receipts: Receipt[] = [];

    // Map each changed file to an implementation claim whose symbol lives in it,
    // so a stub in that file is escalated from a warning to a hard failure.
    const claimedSymbols: Array<{ sym: string; claim: Claim }> = opts.claims
      .filter((c) => c.type === "implementation" && c.subject && isCheckableSymbol(c.subject))
      .map((c) => ({ sym: c.subject as string, claim: c }));

    const fileClaim = new Map<string, Claim>();
    if (claimedSymbols.length) {
      for (const f of opts.diff) {
        if (!isCodeFile(f.path) || isTestFile(f.path)) continue;
        const content = readFileSafe(opts.cwd, f.path) ?? f.added.map((a) => a.text).join("\n");
        for (const { sym, claim } of claimedSymbols) {
          if (new RegExp(`\\b${escapeRe(sym)}\\b`).test(content)) {
            if (!fileClaim.has(f.path)) fileClaim.set(f.path, claim);
            break;
          }
        }
      }
    }

    const hasCompletionClaim = opts.claims.some(
      (c) => c.type === "done" || c.type === "no-placeholders"
    );

    const lines = addedLines(opts.diff, (p) => isCodeFile(p) && !isTestFile(p));
    const failedFiles = new Set<string>(); // one hard failure per claimed file
    const seenWarnings = new Set<string>(); // dedupe warnings by file+label

    for (const ln of lines) {
      for (const rule of RULES) {
        if (!rule.re.test(ln.text)) continue;
        const claim = fileClaim.get(ln.file);

        // Suppress noisy placeholders unless the agent claimed completion.
        if (!claim && rule.noisy && !hasCompletionClaim) break;

        if (claim) {
          if (failedFiles.has(ln.file)) break; // already reported this file
          failedFiles.add(ln.file);
          receipts.push({
            status: "failed",
            verifier: "stubs",
            title: `claimed implemented, but it's a stub`,
            detail: `Agent claimed "${truncate(claim.text, 80)}" — but ${claim.subject ? `\`${claim.subject}\`` : "the code"} in this file is a placeholder (${rule.label}).`,
            evidence: truncate(ln.text, 160),
            location: `${ln.file}:${ln.line}`,
            claim,
          });
        } else {
          const key = `${ln.file}:${rule.label}`;
          if (seenWarnings.has(key)) break;
          seenWarnings.add(key);
          receipts.push({
            status: "warning",
            verifier: "stubs",
            title: `placeholder left in diff: ${rule.label}`,
            detail: `${rule.label} added in this change.`,
            evidence: truncate(ln.text, 160),
            location: `${ln.file}:${ln.line}`,
          });
        }
        break;
      }
    }

    return receipts;
  },
};
