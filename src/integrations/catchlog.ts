// Local-only log of what the Stop hook decided — your own gallery of caught
// lies. Appends one JSON line per agent stop to ~/.groundtruth/catches.jsonl.
// Nothing ever leaves the machine.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CatchEntry {
  ts: string;
  cwd: string;
  result: "blocked" | "clean";
  failed: number;
  warnings: number;
  /** Titles of the failed receipts (what the agent lied about). */
  titles: string[];
  /** How many files the diff touched (0 = nothing to check). */
  diffFiles?: number;
  /** How many verifiable claims were extracted from the agent's message. */
  claims?: number;
  /** Test runners in scope, e.g. ["backend: npm test"]. Empty = tests not run. */
  runners?: string[];
}

export function catchLogPath(): string {
  const home = process.env.GROUNDTRUTH_HOME || path.join(os.homedir(), ".groundtruth");
  return path.join(home, "catches.jsonl");
}

/** Append an entry; must never throw (it runs inside the hook). */
export function appendCatch(entry: CatchEntry): void {
  try {
    const file = catchLogPath();
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    /* logging must never break the hook */
  }
}

export function readCatches(): CatchEntry[] {
  try {
    return readFileSync(catchLogPath(), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CatchEntry);
  } catch {
    return [];
  }
}

/** Human summary for `groundtruth catches`. */
export function summarizeCatches(entries: CatchEntry[]): string {
  if (entries.length === 0) {
    return "No agent stops recorded yet. Install the hook with `groundtruth init` and let your agent work.";
  }
  const blocked = entries.filter((e) => e.result === "blocked");
  const lines: string[] = [];
  lines.push(
    `${entries.length} agent stop(s) verified · ${blocked.length} blocked for overclaiming (${Math.round(
      (blocked.length / entries.length) * 100
    )}%)`
  );

  // Surface how substantive the checks were, so "clean" isn't ambiguous.
  const withRunnerInfo = entries.filter((e) => e.runners !== undefined);
  if (withRunnerInfo.length) {
    const noRunner = withRunnerInfo.filter((e) => (e.runners?.length ?? 0) === 0).length;
    if (noRunner) {
      lines.push(
        `note: ${noRunner}/${withRunnerInfo.length} stop(s) had no test suite in scope — the diff was audited but no tests were run there.`
      );
    }
  }

  if (blocked.length) {
    lines.push("", "Recent catches:");
    for (const e of blocked.slice(-10).reverse()) {
      const when = e.ts.replace("T", " ").slice(0, 16);
      const what = e.titles[0] ?? `${e.failed} overclaim(s)`;
      lines.push(`  ${when}  ${path.basename(e.cwd)}  —  ${what}`);
    }
  }
  return lines.join("\n");
}
