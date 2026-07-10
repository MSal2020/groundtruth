import type { Receipt, Verifier, VerifyOptions } from "../types.js";
import { addedLines, readFileSafe } from "./shared.js";
import { goModuleExists } from "../util/registry.js";

// Catches hallucinated Go modules. Declared requires in go.mod are exact module
// paths — a missing one is a hard failure. Import lines in .go files only give
// a package path (the module boundary is ambiguous), so those are checked for
// well-known hosts and reported as warnings.

// go.mod require entry: `require github.com/x/y v1.2.3` or, inside a
// require ( ... ) block, `github.com/x/y v1.2.3`.
const REQUIRE_RE = /^\s*(?:require\s+)?([a-z0-9][\w.-]*\.[a-z]{2,}(?:\/[\w.~-]+)+)\s+v\d/i;

// Hosts where the module path is reliably the first three path segments.
const THREE_SEGMENT_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org", "golang.org"]);

interface GoModInfo {
  ownModule?: string;
  replaced: Set<string>; // modules with a replace directive (may be local)
}

function loadGoMod(cwd: string): GoModInfo {
  const info: GoModInfo = { replaced: new Set() };
  const raw = readFileSafe(cwd, "go.mod");
  if (!raw) return info;
  const mod = /^module\s+(\S+)/m.exec(raw);
  if (mod) info.ownModule = mod[1]!;
  for (const line of raw.split("\n")) {
    const rep = /^\s*(?:replace\s+)?(\S+)\s+(?:v\S+\s+)?=>/.exec(line);
    if (rep) info.replaced.add(rep[1]!);
  }
  return info;
}

/** Guess the module path for an import path, or null if not checkable. */
export function moduleFromGoImport(importPath: string): string | null {
  const segs = importPath.split("/");
  const host = segs[0] ?? "";
  if (!host.includes(".")) return null; // stdlib (fmt, os, net/http)
  if (THREE_SEGMENT_HOSTS.has(host)) {
    if (segs.length < 3) return null;
    return segs.slice(0, 3).join("/");
  }
  return null; // vanity hosts: module boundary unknowable without a fetch
}

interface Candidate {
  module: string;
  loc: string;
  source: "go.mod" | "import";
}

function collectCandidates(opts: VerifyOptions, info: GoModInfo): Candidate[] {
  const found = new Map<string, Candidate>();

  for (const ln of addedLines(opts.diff, (p) => /(?:^|\/)go\.mod$/.test(p))) {
    if (/^\s*(module|replace|exclude|go|toolchain)\b/.test(ln.text)) continue;
    if (ln.text.includes("=>")) continue;
    const m = REQUIRE_RE.exec(ln.text);
    if (m) {
      const module = m[1]!;
      if (!found.has(module)) {
        found.set(module, { module, loc: `${ln.file}:${ln.line}`, source: "go.mod" });
      }
    }
  }

  const importRes = [
    /^\s*import\s+(?:\w+\s+)?"([^"]+)"/, // import "x" / import alias "x"
    /^\s*(?:\w+\s+)?"([^"]+)"\s*$/, // a line inside an import ( ... ) block
  ];
  for (const ln of addedLines(opts.diff, (p) => /\.go$/.test(p))) {
    for (const re of importRes) {
      const m = re.exec(ln.text);
      if (!m) continue;
      const module = moduleFromGoImport(m[1]!);
      if (module && !found.has(module)) {
        found.set(module, { module, loc: `${ln.file}:${ln.line}`, source: "import" });
      }
      break;
    }
  }

  return [...found.values()].filter((c) => {
    if (info.ownModule && (c.module === info.ownModule || c.module.startsWith(info.ownModule + "/"))) return false;
    if (info.replaced.has(c.module)) return false; // may point at a local dir
    return true;
  });
}

export const godepsVerifier: Verifier = {
  name: "godeps",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const info = loadGoMod(opts.cwd);
    const candidates = collectCandidates(opts, info);
    if (candidates.length === 0) return [];

    if (opts.offline) {
      return [
        {
          status: "unchecked",
          verifier: "godeps",
          title: "Go module check skipped (offline)",
          detail: `${candidates.length} Go module reference(s) not verified.`,
        },
      ];
    }

    const results = await Promise.all(
      candidates.map(async (c) => ({ c, result: await goModuleExists(c.module) }))
    );

    const receipts: Receipt[] = [];
    for (const { c, result } of results) {
      if (result === "missing") {
        const declared = c.source === "go.mod";
        receipts.push({
          status: declared ? "failed" : "warning",
          verifier: "godeps",
          title: `${declared ? "hallucinated" : "unknown"} Go module: ${c.module}`,
          detail: declared
            ? `\`${c.module}\` is required in go.mod but does not exist on the Go module proxy — a hallucination.`
            : `\`${c.module}\` is imported but not found on the Go module proxy (could be private).`,
          evidence: c.module,
          location: c.loc,
        });
      } else if (result === "unknown") {
        receipts.push({
          status: "warning",
          verifier: "godeps",
          title: `could not verify Go module: ${c.module}`,
          detail: `Lookup for \`${c.module}\` was inconclusive (network?).`,
          location: c.loc,
        });
      }
    }
    return receipts;
  },
};
