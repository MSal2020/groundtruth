#!/usr/bin/env node
// groundtruth evaluation harness.
// Stages each corpus case in a throwaway git repo, runs the built CLI against
// the agent's claim, and scores flagged-vs-expected into precision/recall.
//
//   npm run build && node eval/run.mjs            (online: real registry checks)
//   node eval/run.mjs --offline                   (skip registry — dep cases become N/A)

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { cases } from "./cases.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, "dist", "cli.js");
const OFFLINE = process.argv.includes("--offline");

if (!existsSync(CLI)) {
  console.error("Build first: npm run build");
  process.exit(1);
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

function git(dir, args) {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

function runCase(c) {
  const dir = path.join(os.tmpdir(), `gt-eval-${c.name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    writeFiles(dir, c.baseline);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "e@e.co"]);
    git(dir, ["config", "user.name", "e"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "baseline"]);

    if (c.deletes) for (const f of c.deletes) rmSync(path.join(dir, f), { force: true });
    if (c.change) writeFiles(dir, c.change);

    const args = ["--json"];
    if (c.claim) args.push("--claim", c.claim);
    if (OFFLINE) args.push("--offline");

    const res = spawnSync("node", [CLI, ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
    const verdict = JSON.parse(res.stdout);
    return { failed: verdict.failed, warnings: verdict.warnings, verified: verdict.verified, verdict };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rows = [];
let tp = 0, fp = 0, tn = 0, fn = 0, noise = 0;

for (const c of cases) {
  let out;
  try {
    out = runCase(c);
  } catch (e) {
    rows.push({ name: c.name, ok: false, note: `ERROR: ${String(e).slice(0, 80)}` });
    if (c.expectFlag) fn++; else fp++;
    continue;
  }
  const flagged = out.failed > 0;
  const correct = flagged === c.expectFlag;
  if (c.expectFlag && flagged) tp++;
  else if (c.expectFlag && !flagged) fn++;
  else if (!c.expectFlag && !flagged) tn++;
  else fp++;
  if (!c.expectFlag) noise += out.warnings; // warnings on honest cases = noise

  rows.push({
    name: c.name,
    ok: correct,
    expect: c.expectFlag ? "FLAG" : "pass",
    got: `${out.failed}✗ ${out.warnings}⚠ ${out.verified}✓`,
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log("\n  groundtruth evaluation\n  " + "─".repeat(56));
for (const r of rows) {
  const mark = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗ FAIL\x1b[0m";
  console.log(`  ${mark}  ${pad(r.name, 34)} ${r.note ?? `[want ${r.expect}] ${r.got}`}`);
}

const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = tp + fn ? tp / (tp + fn) : 1;
const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
const accuracy = (tp + tn) / cases.length;
const pct = (x) => (x * 100).toFixed(1) + "%";

console.log("  " + "─".repeat(56));
console.log(`  lying caught (TP):    ${tp}`);
console.log(`  lies missed  (FN):    ${fn}   <- false negatives`);
console.log(`  honest ok    (TN):    ${tn}`);
console.log(`  false alarms (FP):    ${fp}   <- false positives (credibility killers)`);
console.log(`  noise (warnings on honest cases): ${noise}`);
console.log("  " + "─".repeat(56));
console.log(`  precision: ${pct(precision)}   recall: ${pct(recall)}   F1: ${pct(f1)}   accuracy: ${pct(accuracy)}`);
console.log("");

const failures = rows.filter((r) => !r.ok).length;
process.exit(failures ? 1 : 0);
