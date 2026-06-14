import type { Receipt, Verifier, VerifyOptions } from "../types.js";
import { addedLines } from "./shared.js";
import {
  isBuiltin,
  packageExists,
  packageNameFromSpecifier,
} from "../util/registry.js";

// Catches hallucinated / slopsquatted dependencies: packages the agent
// imported or added that do not actually exist on the npm registry.

const IMPORT_RES: RegExp[] = [
  /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/, // import x from 'pkg'
  /\bimport\s*['"]([^'"]+)['"]/, // import 'pkg'
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/, // require('pkg')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/, // dynamic import('pkg')
];

// A line inside a package.json dependencies block: `"pkg": "^1.2.3"`
const PKG_JSON_DEP_RE = /^\s*"([@a-z0-9][@a-z0-9._/-]*)"\s*:\s*"[^"]*"\s*,?\s*$/i;

function collectCandidates(opts: VerifyOptions): Map<string, string> {
  // name -> first location seen
  const found = new Map<string, string>();

  for (const ln of addedLines(opts.diff)) {
    const isPkgJson = /(?:^|\/)package\.json$/.test(ln.file);
    if (isPkgJson) {
      const m = PKG_JSON_DEP_RE.exec(ln.text);
      if (m && !/"(?:name|version|description|main|types|license|author|type|module|bin|scripts|keywords)"/.test(ln.text)) {
        const name = m[1]!;
        if (!found.has(name)) found.set(name, `${ln.file}:${ln.line}`);
      }
      continue;
    }
    for (const re of IMPORT_RES) {
      const m = re.exec(ln.text);
      if (m) {
        const name = packageNameFromSpecifier(m[1]!);
        if (name && !isBuiltin(name) && !found.has(name)) {
          found.set(name, `${ln.file}:${ln.line}`);
        }
      }
    }
  }
  return found;
}

export const depsVerifier: Verifier = {
  name: "deps",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const candidates = collectCandidates(opts);
    if (candidates.size === 0) return [];

    if (opts.offline) {
      return [
        {
          status: "unchecked",
          verifier: "deps",
          title: "dependency check skipped (offline)",
          detail: `${candidates.size} new dependency reference(s) not verified against the registry.`,
        },
      ];
    }

    const receipts: Receipt[] = [];
    const entries = [...candidates.entries()];
    const results = await Promise.all(
      entries.map(async ([name, loc]) => ({
        name,
        loc,
        result: await packageExists(name),
      }))
    );

    for (const { name, loc, result } of results) {
      if (result === "missing") {
        receipts.push({
          status: "failed",
          verifier: "deps",
          title: `hallucinated dependency: ${name}`,
          detail: `\`${name}\` does not exist on the npm registry. This is a classic AI hallucination and a slopsquatting supply-chain risk.`,
          evidence: name,
          location: loc,
        });
      } else if (result === "unknown") {
        receipts.push({
          status: "warning",
          verifier: "deps",
          title: `could not verify dependency: ${name}`,
          detail: `Registry lookup for \`${name}\` was inconclusive (network?).`,
          location: loc,
        });
      }
      // "exists" produces no noise.
    }

    return receipts;
  },
};
