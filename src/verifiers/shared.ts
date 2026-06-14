import { readFileSync } from "node:fs";
import path from "node:path";
import type { FileDiff } from "../types.js";

export const TEST_FILE_RE =
  /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:py|go)$|test_[^/]*\.py$/;

export const CODE_FILE_RE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|php|cs|swift)$/;

export function isTestFile(path: string): boolean {
  return TEST_FILE_RE.test(path);
}

export function isCodeFile(path: string): boolean {
  return CODE_FILE_RE.test(path);
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** Flatten all added lines across the diff, optionally filtered by file. */
export function addedLines(
  diff: FileDiff[],
  filter?: (path: string) => boolean
): AddedLine[] {
  const out: AddedLine[] = [];
  for (const f of diff) {
    if (filter && !filter(f.path)) continue;
    for (const a of f.added) out.push({ file: f.path, line: a.line, text: a.text });
  }
  return out;
}

export function truncate(s: string, n = 200): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export function readFileSafe(cwd: string, rel: string): string | null {
  try {
    return readFileSync(path.join(cwd, rel), "utf8");
  } catch {
    return null;
  }
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Common English words an agent's prose uses that look like, but aren't,
// checkable code identifiers.
const SYMBOL_STOPLIST = new Set([
  "the", "a", "an", "it", "this", "that", "them", "bug", "code", "test",
  "tests", "validation", "feature", "support", "logic", "handling", "error",
  "errors", "input", "output", "data", "function", "method", "everything",
  "all", "stuff", "things", "fix", "fixes", "changes", "files", "file",
]);

/**
 * Treat a captured word as a checkable symbol only when it looks like an
 * identifier (camelCase / PascalCase / snake_case / $). Plain lowercase
 * English words are rejected to avoid false "not found" noise.
 */
export function isCheckableSymbol(s: string): boolean {
  if (!s) return false;
  if (SYMBOL_STOPLIST.has(s.toLowerCase())) return false;
  return /[A-Z_$]/.test(s);
}
