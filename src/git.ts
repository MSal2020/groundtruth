import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FileDiff } from "./types.js";
import { parseUnifiedDiff, fileDiffFromContents } from "./diff.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function isGitRepo(cwd: string): boolean {
  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export interface DiffOptions {
  /** Diff against this ref instead of the working tree vs HEAD. */
  base?: string;
  /** Only look at staged changes. */
  staged?: boolean;
  /** Include untracked files as fully-added (default true). */
  includeUntracked?: boolean;
}

const BINARY_OR_HUGE = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|mp4|mp3|wasm|lock)$/i;

/**
 * Collect the change set the agent produced: tracked changes via `git diff`
 * plus untracked new files (which `git diff` omits) read from disk.
 */
export function getDiff(cwd: string, opts: DiffOptions = {}): FileDiff[] {
  const include = opts.includeUntracked ?? true;
  let args: string[];
  if (opts.base) args = ["diff", "--no-color", `${opts.base}...HEAD`];
  else if (opts.staged) args = ["diff", "--no-color", "--cached"];
  else args = ["diff", "--no-color", "HEAD"];

  let diffText = "";
  try {
    diffText = git(cwd, args);
  } catch {
    // e.g. no commits yet — fall back to staged, then nothing.
    try {
      diffText = git(cwd, ["diff", "--no-color", "--cached"]);
    } catch {
      diffText = "";
    }
  }

  const files = parseUnifiedDiff(diffText);

  if (include && !opts.base) {
    let untracked: string[] = [];
    try {
      untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"])
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      untracked = [];
    }
    for (const rel of untracked) {
      if (BINARY_OR_HUGE.test(rel)) continue;
      const abs = path.join(cwd, rel);
      try {
        if (statSync(abs).size > 2 * 1024 * 1024) continue;
        const contents = readFileSync(abs, "utf8");
        files.push(fileDiffFromContents(rel, contents));
      } catch {
        /* unreadable — skip */
      }
    }
  }

  return files.filter((f) => !BINARY_OR_HUGE.test(f.path));
}
