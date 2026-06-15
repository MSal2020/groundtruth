import { existsSync } from "node:fs";
import path from "node:path";
import type { Receipt, Verifier, VerifyOptions } from "../types.js";
import { addedLines } from "./shared.js";
import { pypiExists } from "../util/registry.js";

// Catches hallucinated PyPI dependencies. Declared deps (requirements.txt) are
// reliable — a missing one is a hard failure. Bare imports are only a warning,
// because Python import names often differ from their PyPI distribution name
// (yaml -> PyYAML, cv2 -> opencv-python), which would otherwise false-positive.

const STDLIB = new Set([
  "__future__", "abc", "argparse", "array", "ast", "asyncio", "base64", "bisect",
  "builtins", "bz2", "calendar", "cgi", "cmath", "codecs", "collections",
  "concurrent", "configparser", "contextlib", "copy", "csv", "ctypes", "dataclasses",
  "datetime", "decimal", "difflib", "dis", "doctest", "email", "enum", "errno",
  "fnmatch", "fractions", "functools", "gc", "getpass", "gettext", "glob", "gzip",
  "hashlib", "heapq", "hmac", "html", "http", "imaplib", "importlib", "inspect",
  "io", "ipaddress", "itertools", "json", "keyword", "locale", "logging", "lzma",
  "mailbox", "math", "mimetypes", "mmap", "multiprocessing", "numbers", "operator",
  "os", "pathlib", "pickle", "platform", "pprint", "queue", "random", "re",
  "secrets", "select", "shlex", "shutil", "signal", "smtplib", "socket",
  "socketserver", "sqlite3", "ssl", "stat", "statistics", "string", "struct",
  "subprocess", "sys", "sysconfig", "tarfile", "tempfile", "textwrap", "threading",
  "time", "timeit", "tkinter", "token", "tokenize", "traceback", "types", "typing",
  "unicodedata", "unittest", "urllib", "uuid", "venv", "warnings", "weakref",
  "webbrowser", "wsgiref", "xml", "xmlrpc", "zipfile", "zlib", "zoneinfo",
]);

// Real packages whose import name differs from the PyPI distribution name (or
// namespace packages) — skip the import-based check to avoid false positives.
const IMPORT_ALIASES = new Set([
  "yaml", "cv2", "PIL", "sklearn", "bs4", "dateutil", "dotenv", "jwt", "serial",
  "Crypto", "Cryptodome", "OpenSSL", "win32api", "win32com", "pythoncom", "six",
  "attr", "google", "pkg_resources", "setuptools", "pip", "wheel", "_pytest",
  "pytest", "typing_extensions",
]);

function topLevel(mod: string): string {
  return (mod.split(".")[0] ?? mod).trim();
}

interface PyInfo {
  ownName?: string;
  localTops: Set<string>; // local module/package names in the repo
}

function collectLocalModules(cwd: string): Set<string> {
  // A top-level import is "local" if there's a matching file/dir in the repo.
  const tops = new Set<string>();
  for (const guess of ["src", "app", "lib", "tests", "test"]) {
    if (existsSync(path.join(cwd, guess))) tops.add(guess);
  }
  return tops;
}

function isLocal(cwd: string, top: string, locals: Set<string>): boolean {
  if (locals.has(top)) return true;
  return (
    existsSync(path.join(cwd, `${top}.py`)) ||
    existsSync(path.join(cwd, top, "__init__.py")) ||
    existsSync(path.join(cwd, top))
  );
}

interface Candidate {
  name: string;
  loc: string;
  source: "requirements" | "import";
}

const REQ_FILE = /(?:^|\/)requirements[^/]*\.txt$/;
const PY_FILE = /\.py$/;

function collectCandidates(opts: VerifyOptions): Candidate[] {
  const found = new Map<string, Candidate>();
  const locals = collectLocalModules(opts.cwd);

  // requirements.txt declared deps (clean, line-based, PyPI names)
  for (const ln of addedLines(opts.diff, (p) => REQ_FILE.test(p))) {
    const t = ln.text.trim();
    if (!t || t.startsWith("#") || t.startsWith("-") || /^(git\+|https?:|file:)/.test(t)) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(t);
    if (m) {
      const name = m[1]!;
      if (!found.has(`req:${name}`)) found.set(`req:${name}`, { name, loc: `${ln.file}:${ln.line}`, source: "requirements" });
    }
  }

  // imports in added .py lines
  const importRes = [
    /^\s*import\s+([A-Za-z0-9_.,\s]+)/,
    /^\s*from\s+([A-Za-z0-9_.]+)\s+import\b/,
  ];
  for (const ln of addedLines(opts.diff, (p) => PY_FILE.test(p))) {
    for (const re of importRes) {
      const m = re.exec(ln.text);
      if (!m) continue;
      // `import a, b as c` -> handle the comma list
      for (const piece of m[1]!.split(",")) {
        const mod = piece.trim().split(/\s+as\s+/)[0]!.trim();
        if (!mod || mod.startsWith(".")) continue; // relative
        const top = topLevel(mod);
        if (!top || STDLIB.has(top) || IMPORT_ALIASES.has(top)) continue;
        if (isLocal(opts.cwd, top, locals)) continue;
        if (!found.has(`imp:${top}`) && !found.has(`req:${top}`)) {
          found.set(`imp:${top}`, { name: top, loc: `${ln.file}:${ln.line}`, source: "import" });
        }
      }
    }
  }

  return [...found.values()];
}

export const pydepsVerifier: Verifier = {
  name: "pydeps",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const candidates = collectCandidates(opts);
    if (candidates.length === 0) return [];

    if (opts.offline) {
      return [
        {
          status: "unchecked",
          verifier: "pydeps",
          title: "PyPI check skipped (offline)",
          detail: `${candidates.length} Python dependency reference(s) not verified.`,
        },
      ];
    }

    const results = await Promise.all(
      candidates.map(async (c) => ({ c, result: await pypiExists(c.name) }))
    );

    const receipts: Receipt[] = [];
    for (const { c, result } of results) {
      if (result === "missing") {
        const declared = c.source === "requirements";
        receipts.push({
          status: declared ? "failed" : "warning",
          verifier: "pydeps",
          title: `${declared ? "hallucinated" : "unknown"} PyPI package: ${c.name}`,
          detail: declared
            ? `\`${c.name}\` is in requirements but does not exist on PyPI — a hallucination / slopsquatting risk.`
            : `\`${c.name}\` is imported but not found on PyPI (could be a private package or an import-name alias).`,
          evidence: c.name,
          location: c.loc,
        });
      } else if (result === "unknown") {
        receipts.push({
          status: "warning",
          verifier: "pydeps",
          title: `could not verify PyPI package: ${c.name}`,
          detail: `Lookup for \`${c.name}\` was inconclusive (network?).`,
          location: c.loc,
        });
      }
    }
    return receipts;
  },
};
