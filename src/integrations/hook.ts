// Claude Code `Stop` hook adapter.
//
// Reads the hook payload on stdin, verifies the agent's claims against the
// repo, and — if the agent overclaimed — returns `decision: "block"` so Claude
// Code refuses to end the turn until the work is actually done.
//
// Wire it up in .claude/settings.json:
//   { "hooks": { "Stop": [ { "hooks": [
//       { "type": "command", "command": "npx groundtruth hook" } ] } ] } }

import type { Claim } from "../types.js";
import { getDiff, isGitRepo } from "../git.js";
import { parseTranscript } from "../claims/transcript.js";
import { extractClaims } from "../claims/extract.js";
import { verify } from "../verify.js";
import { detectRunners } from "../verifiers/tests.js";
import { renderMarkdown } from "../report/markdown.js";
import { readStdin } from "../util/stdin.js";
import { appendCatch } from "./catchlog.js";

interface HookInput {
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
}

export async function runHook(): Promise<number> {
  let input: HookInput = {};
  try {
    const raw = await readStdin(2000);
    if (raw.trim()) input = JSON.parse(raw);
  } catch {
    return 0; // fail open: never wedge the agent on our own parse error
  }

  // Avoid loops: if our previous block already forced a continuation, stand down.
  if (input.stop_hook_active) return 0;

  const cwd = input.cwd || process.cwd();
  if (!isGitRepo(cwd)) return 0;

  let claims: Claim[] = [];
  if (input.transcript_path) {
    try {
      const t = parseTranscript(input.transcript_path);
      claims = extractClaims(t.finalText);
    } catch {
      /* no claims — still run the diff battery */
    }
  }

  let verdict;
  let diffLen = 0;
  let runnerLabels: string[] = [];
  try {
    const diff = getDiff(cwd);
    diffLen = diff.length;
    runnerLabels = detectRunners(cwd, diff).map((r) => (r.dir === "." ? r.label : `${r.dir}: ${r.label}`));
    verdict = await verify({ cwd, claims, diff });
  } catch {
    return 0; // fail open
  }

  appendCatch({
    ts: new Date().toISOString(),
    cwd,
    result: verdict.ok ? "clean" : "blocked",
    failed: verdict.failed,
    warnings: verdict.warnings,
    titles: verdict.receipts
      .filter((r) => r.status === "failed")
      .map((r) => r.title)
      .slice(0, 10),
    diffFiles: diffLen,
    claims: claims.length,
    runners: runnerLabels,
  });

  if (verdict.ok) {
    // Allow the stop. Stay quiet so we don't clutter the session.
    process.stdout.write(JSON.stringify({ suppressOutput: true }));
    return 0;
  }

  const reason =
    renderMarkdown(verdict) +
    "\n\nFix the issues above, then finish. (groundtruth blocked the stop.)";

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason,
      systemMessage: `groundtruth: blocked — ${verdict.failed} overclaim(s) need fixing.`,
    })
  );
  return 0;
}
