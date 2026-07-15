import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FileDiff, Receipt, Verifier, VerifyOptions } from "../types.js";
import { stripAnsi } from "../util/color.js";

const PLACEHOLDER_TEST = /no test specified/i;
const MAX_RUNNERS = 6;

type Ecosystem = "node" | "python" | "go";

interface Runner {
  ecosystem: Ecosystem;
  cmd: string;
  args: string[];
  label: string;
}

/** A runner plus the project directory (relative to cwd) it runs in. */
interface DetectedRunner extends Runner {
  dir: string; // "." for the repo root, else e.g. "backend"
}

function detectPackageManager(dir: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  return "npm";
}

const PY_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini", "tox.ini", "conftest.py"];

/** Detect a runner in a single directory (no override handling). */
function runnerAt(dir: string): Runner | null {
  const pkgPath = path.join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const testScript: unknown = pkg.scripts?.test;
      if (typeof testScript === "string" && !PLACEHOLDER_TEST.test(testScript)) {
        const pm = detectPackageManager(dir);
        const args = pm === "npm" ? ["test", "--silent"] : ["test"];
        return { ecosystem: "node", cmd: pm, args, label: `${pm} test` };
      }
    } catch {
      /* unreadable package.json */
    }
  }
  if (PY_MARKERS.some((m) => existsSync(path.join(dir, m)))) {
    return { ecosystem: "python", cmd: "python3", args: ["-m", "pytest", "-q"], label: "pytest" };
  }
  if (existsSync(path.join(dir, "go.mod"))) {
    return { ecosystem: "go", cmd: "go", args: ["test", "./..."], label: "go test ./..." };
  }
  return null;
}

/** Walk from a changed file's directory up to the repo root, returning the
 *  nearest project that owns it. */
function ownerRunner(cwd: string, relDir: string): DetectedRunner | null {
  let d = relDir === "" ? "." : relDir;
  while (true) {
    const abs = d === "." ? cwd : path.join(cwd, d);
    const r = runnerAt(abs);
    if (r) return { ...r, dir: d };
    if (d === ".") return null;
    const parent = path.posix.dirname(d);
    d = parent === d ? "." : parent;
  }
}

/**
 * Find every project whose files were touched by the diff and that has a
 * runnable suite — so a monorepo run from the root still verifies the
 * sub-project (e.g. `backend/`) the agent actually changed.
 */
export function detectRunners(
  cwd: string,
  diff: FileDiff[],
  override?: string
): DetectedRunner[] {
  if (override) {
    const parts = override.split(" ").filter(Boolean);
    return [{ ecosystem: "node", cmd: parts[0]!, args: parts.slice(1), label: override, dir: "." }];
  }

  const byDir = new Map<string, DetectedRunner>();
  for (const f of diff) {
    const relDir = path.posix.dirname(f.path.replace(/\\/g, "/"));
    const owner = ownerRunner(cwd, relDir);
    if (owner && !byDir.has(owner.dir)) byDir.set(owner.dir, owner);
  }
  // No changed file mapped to a project — fall back to the repo root.
  if (byDir.size === 0) {
    const r = runnerAt(cwd);
    if (r) byDir.set(".", { ...r, dir: "." });
  }
  return [...byDir.values()].slice(0, MAX_RUNNERS);
}

interface Counts {
  passed?: number;
  failed?: number;
  noTests?: boolean;
}

export function parseCounts(output: string): Counts {
  const passM = /^#\s*pass\s+(\d+)/im.exec(output);
  const failM = /^#\s*fail\s+(\d+)/im.exec(output);
  if (passM || failM) return { passed: passM ? +passM[1]! : 0, failed: failM ? +failM[1]! : 0 };

  const seg = /\bTests:?\s+([^\n]*)/i.exec(output);
  if (seg) {
    const f = /(\d+)\s+failed/i.exec(seg[1]!);
    const p = /(\d+)\s+passed/i.exec(seg[1]!);
    if (f || p) return { failed: f ? +f[1]! : 0, passed: p ? +p[1]! : 0 };
  }
  return {};
}

export function parsePytestCounts(output: string): Counts {
  if (/no tests ran|collected 0 items/i.test(output)) return { noTests: true, passed: 0, failed: 0 };
  const f = /(\d+)\s+failed/i.exec(output);
  const e = /(\d+)\s+error/i.exec(output);
  const p = /(\d+)\s+passed/i.exec(output);
  if (f || p || e) {
    return { failed: (f ? +f[1]! : 0) + (e ? +e[1]! : 0), passed: p ? +p[1]! : 0 };
  }
  return {};
}

export function parseGoCounts(output: string): Counts {
  const failed = (output.match(/^--- FAIL:/gm) ?? []).length;
  const passed = (output.match(/^--- PASS:/gm) ?? []).length; // only with -v
  const noTests =
    /\[no test files\]/.test(output) && !/^ok\s/m.test(output) && !/--- FAIL/.test(output);
  if (noTests) return { noTests: true, passed: 0, failed: 0 };
  if (failed || passed) return { failed, passed };
  return {};
}

function parse(ecosystem: Ecosystem, output: string): Counts {
  if (ecosystem === "python") return parsePytestCounts(output);
  if (ecosystem === "go") return parseGoCounts(output);
  return parseCounts(output);
}

// The test *runner itself* isn't installed (e.g. a sub-project without
// node_modules) — that's "unchecked", not a failing suite. Deliberately narrow:
// a missing *application* module (e.g. a hallucinated import) is a real failure
// and must still read as RED, not be masked here.
const RUNNER_MISSING =
  /(?:command not found|: not found|not recognized as)|Cannot find (?:module|package) ['"`](?:vitest|jest|mocha|ava|tape?|jasmine|nyc|c8|@vitest\/|@jest\/)/i;

function runOne(
  cwd: string,
  runner: DetectedRunner,
  displayLabel: string,
  claim: import("../types.js").Claim | undefined
): Receipt[] {
  // Scrub the parent test-runner context so a spawned `node --test` (or pytest)
  // runs standalone instead of deferring to a surrounding test process.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CI: "1", FORCE_COLOR: "0" };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.PYTEST_CURRENT_TEST;

  const res = spawnSync(runner.cmd, runner.args, {
    cwd,
    encoding: "utf8",
    timeout: 4 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    env: childEnv,
  });

  const output = stripAnsi(`${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  const passed = res.status === 0;

  const toolMissing =
    !!res.error ||
    (runner.ecosystem === "python" && /No module named '?pytest/i.test(output)) ||
    (runner.ecosystem === "node" && !passed && RUNNER_MISSING.test(output));
  if (toolMissing) {
    return claim
      ? [
          {
            status: "unchecked",
            verifier: "tests",
            title: `could not run ${displayLabel}`,
            detail:
              runner.ecosystem === "python"
                ? "pytest is not installed here, so the claim couldn't be verified."
                : "the toolchain / dependencies aren't installed here, so the claim couldn't be verified.",
            claim,
          },
        ]
      : [];
  }

  const counts = parse(runner.ecosystem, output);
  const noTests = counts.noTests || (runner.ecosystem === "python" && res.status === 5);

  const allLines = output.split("\n").filter(Boolean);
  const signal = allLines.filter((l) =>
    /\b(not ok|fail|failed|✗|✖|×|assert|expected|received|# fail|FAIL |Error)\b/i.test(l)
  );
  const tail = (signal.length ? signal : allLines).slice(0, 10).join("\n");

  if (noTests) {
    return claim
      ? [
          {
            status: "warning",
            verifier: "tests",
            title: `"${claim.text}" — but ${displayLabel} ran 0 tests`,
            detail: `Ran \`${displayLabel}\`: no tests actually executed (all skipped, or none found).`,
            claim,
          },
        ]
      : [];
  }

  if (passed) {
    return [
      {
        status: "verified",
        verifier: "tests",
        title: claim ? `tests pass — confirmed (${displayLabel})` : `test suite passes (${displayLabel})`,
        detail:
          counts.passed != null
            ? `Ran \`${displayLabel}\`: ${counts.passed} passed${counts.failed ? `, ${counts.failed} failed` : ""}.`
            : `Ran \`${displayLabel}\`: exit code 0.`,
        ...(claim ? { claim } : {}),
      },
    ];
  }

  return [
    {
      status: "failed",
      verifier: "tests",
      title: claim ? `"${claim.text}" — but ${displayLabel} is RED` : `test suite is failing (${displayLabel})`,
      detail: counts.failed
        ? `Ran \`${displayLabel}\`: ${counts.failed} test(s) failed.`
        : `Ran \`${displayLabel}\`: exit code ${res.status}.`,
      evidence: tail,
      ...(claim ? { claim } : {}),
    },
  ];
}

export const testsVerifier: Verifier = {
  name: "tests",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    if (opts.noTests) return [];

    const testClaim = opts.claims.find((c) => c.type === "tests");
    const completionClaim = testClaim ?? opts.claims.find((c) => c.type === "done");
    // Only run suites when the agent actually claimed completion (or the CLI
    // forces it). Keeps the Stop hook fast — no running the whole suite on
    // every intermediate stop.
    if (!opts.forceTests && !completionClaim) return [];

    const runners = detectRunners(opts.cwd, opts.diff, opts.testCommand);

    if (runners.length === 0) {
      return testClaim
        ? [
            {
              status: "unchecked",
              verifier: "tests",
              title: "no test runner found",
              detail: `Agent claimed "${testClaim.text}" but no runnable suite (npm/pytest/go) was found at the repo root or in the changed directories.`,
              claim: testClaim,
            },
          ]
        : [];
    }

    const receipts: Receipt[] = [];
    for (const runner of runners) {
      const runDir = runner.dir === "." ? opts.cwd : path.join(opts.cwd, runner.dir);
      const displayLabel = runner.dir === "." ? runner.label : `${runner.dir}: ${runner.label}`;
      receipts.push(...runOne(runDir, runner, displayLabel, completionClaim));
    }
    return receipts;
  },
};
