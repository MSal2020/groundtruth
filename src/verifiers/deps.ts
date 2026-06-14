import type { Receipt, Verifier, VerifyOptions } from "../types.js";
import { addedLines, readFileSafe } from "./shared.js";
import {
  isBuiltin,
  packageExists,
  packageNameFromSpecifier,
} from "../util/registry.js";

// Catches hallucinated / slopsquatted dependencies: packages the agent
// imported or added that do not actually exist on the npm registry — while
// carefully NOT flagging path aliases, workspace packages, or private deps.

const IMPORT_RES: RegExp[] = [
  /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/, // import x from 'pkg'
  /\bimport\s*['"]([^'"]+)['"]/, // import 'pkg'
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/, // require('pkg')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/, // dynamic import('pkg')
];

const PROTOCOL_VERSION = /^(?:workspace|file|link|portal|git|github|https?|npm):/i;

/** Parse JSON that may contain comments / trailing commas (tsconfig-style). */
function looseJson(text: string): any {
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

interface ProjectInfo {
  ownName?: string;
  deps: Record<string, string>; // name -> version spec
  aliasPrefixes: string[]; // from tsconfig paths
}

function loadProject(cwd: string): ProjectInfo {
  const info: ProjectInfo = { deps: {}, aliasPrefixes: [] };

  const pkgRaw = readFileSafe(cwd, "package.json");
  const pkg = pkgRaw ? looseJson(pkgRaw) : null;
  if (pkg) {
    if (typeof pkg.name === "string") info.ownName = pkg.name;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const obj = pkg[field];
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string") info.deps[k] = v;
        }
      }
    }
  }

  for (const tsfile of ["tsconfig.json", "tsconfig.base.json"]) {
    const raw = readFileSafe(cwd, tsfile);
    const ts = raw ? looseJson(raw) : null;
    const paths = ts?.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      for (const key of Object.keys(paths)) {
        info.aliasPrefixes.push(key.replace(/\*$/, ""));
      }
    }
  }

  return info;
}

function matchesAlias(spec: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (!p) continue;
    if (spec === p || spec.startsWith(p)) return true;
  }
  return false;
}

interface Candidate {
  name: string;
  spec: string;
  loc: string;
  source: "import" | "package.json";
}

function collectCandidates(opts: VerifyOptions, proj: ProjectInfo): Candidate[] {
  const found = new Map<string, Candidate>();

  // package.json: which declared deps were *added* in this diff?
  const pkgAdded = addedLines(opts.diff, (p) => /(?:^|\/)package\.json$/.test(p));
  for (const name of Object.keys(proj.deps)) {
    const re = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
    if (pkgAdded.some((l) => re.test(l.text)) && !found.has(name)) {
      const loc = pkgAdded.find((l) => re.test(l.text));
      found.set(name, { name, spec: name, loc: loc ? `${loc.file}:${loc.line}` : "package.json", source: "package.json" });
    }
  }

  // imports in source
  for (const ln of addedLines(opts.diff, (p) => !/(?:^|\/)package\.json$/.test(p))) {
    for (const re of IMPORT_RES) {
      const m = re.exec(ln.text);
      if (!m) continue;
      const spec = m[1]!;
      if (matchesAlias(spec, proj.aliasPrefixes)) continue;
      const name = packageNameFromSpecifier(spec);
      if (name && !isBuiltin(name) && !found.has(name)) {
        found.set(name, { name, spec, loc: `${ln.file}:${ln.line}`, source: "import" });
      }
    }
  }

  // Filter out things that are definitely not public-registry hallucinations.
  const out: Candidate[] = [];
  for (const c of found.values()) {
    if (c.name === proj.ownName) continue;
    if (matchesAlias(c.spec, proj.aliasPrefixes)) continue;
    const declaredVersion = proj.deps[c.name];
    if (declaredVersion && PROTOCOL_VERSION.test(declaredVersion)) continue; // workspace/file/link/git
    out.push(c);
  }
  return out;
}

export const depsVerifier: Verifier = {
  name: "deps",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const proj = loadProject(opts.cwd);
    const candidates = collectCandidates(opts, proj);
    if (candidates.length === 0) return [];

    if (opts.offline) {
      return candidates.length
        ? [
            {
              status: "unchecked",
              verifier: "deps",
              title: "dependency check skipped (offline)",
              detail: `${candidates.length} new dependency reference(s) not verified against the registry.`,
            },
          ]
        : [];
    }

    const receipts: Receipt[] = [];
    const results = await Promise.all(
      candidates.map(async (c) => ({ c, result: await packageExists(c.name) }))
    );

    for (const { c, result } of results) {
      const scoped = c.name.startsWith("@");
      if (result === "missing") {
        receipts.push({
          // Unscoped missing package = strong hallucination signal (fail).
          // Scoped missing could be a private/internal package (warn only).
          status: scoped ? "warning" : "failed",
          verifier: "deps",
          title: `${scoped ? "unknown" : "hallucinated"} dependency: ${c.name}`,
          detail: scoped
            ? `\`${c.name}\` is not on the public npm registry. If it's a private/internal package this is fine; otherwise it's a hallucination.`
            : `\`${c.name}\` does not exist on the npm registry. This is a classic AI hallucination and a slopsquatting supply-chain risk.`,
          evidence: c.name,
          location: c.loc,
        });
      } else if (result === "unknown") {
        receipts.push({
          status: "warning",
          verifier: "deps",
          title: `could not verify dependency: ${c.name}`,
          detail: `Registry lookup for \`${c.name}\` was inconclusive (network?).`,
          location: c.loc,
        });
      }
    }

    return receipts;
  },
};
