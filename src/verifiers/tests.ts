import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { FileDiff, Receipt, Verifier, VerifyOptions } from "../types.js";
import { stripAnsi } from "../util/color.js";

const PLACEHOLDER_TEST = /no test specified/i;
const MAX_RUNNERS = 6;

type Ecosystem = "node" | "python" | "go" | "swift";

/** An Xcode container whose scheme/destination are resolved lazily at run time. */
interface XcodeTarget {
  /** Absolute path to the .xcodeproj / .xcworkspace. */
  container: string;
  flag: "-project" | "-workspace";
}

interface Runner {
  ecosystem: Ecosystem;
  cmd: string;
  args: string[];
  label: string;
  /**
   * Present for Xcode projects. Picking a scheme and a simulator costs two
   * subprocesses, so it is deferred until we actually intend to run — detection
   * happens on every Stop hook, execution only on a completion claim.
   */
  xcode?: XcodeTarget;
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
  const swift = swiftRunnerAt(dir);
  if (swift) return swift;
  return null;
}

/**
 * Swift comes in two flavours: SwiftPM (cheap, no simulator) and Xcode
 * projects (needs a scheme and a destination). A workspace wins over a bare
 * project when both exist, since that is what the developer actually opens.
 */
function swiftRunnerAt(dir: string): Runner | null {
  if (existsSync(path.join(dir, "Package.swift"))) {
    return { ecosystem: "swift", cmd: "swift", args: ["test"], label: "swift test" };
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  // A .xcworkspace inside a .xcodeproj is Xcode's own internal bookkeeping,
  // not something you build — readdir on `dir` never sees those, but be
  // explicit about preferring a top-level workspace.
  const workspace = entries.find((e) => e.endsWith(".xcworkspace"));
  const project = entries.find((e) => e.endsWith(".xcodeproj"));
  const chosen = workspace ?? project;
  if (!chosen) return null;

  return {
    ecosystem: "swift",
    cmd: "xcodebuild",
    args: [], // resolved in resolveXcodeInvocation()
    label: "xcodebuild test",
    xcode: {
      container: path.join(dir, chosen),
      flag: workspace ? "-workspace" : "-project",
    },
  };
}

function sh(cmd: string, args: string[], cwd: string, timeoutMs: number) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

/**
 * Prefer the scheme named after the container — in a project with SwiftPM
 * dependencies the schemes list also contains those (`foo-oss-Package`) and
 * extension targets (`App (Notification)`), neither of which owns the app's
 * tests.
 */
export function pickScheme(schemes: string[], containerName: string): string | null {
  if (schemes.length === 0) return null;
  const exact = schemes.find((s) => s === containerName);
  if (exact) return exact;
  const own = schemes.filter((s) => !/-Package$/.test(s) && !s.includes("("));
  return own[0] ?? schemes[0]!;
}

/** A simulator that is already booted costs no boot time — much the best pick. */
function pickDestination(cwd: string): string | null {
  const read = (args: string[]): Record<string, Array<Record<string, unknown>>> | null => {
    const res = sh("xcrun", args, cwd, 30_000);
    if (res.status !== 0 || !res.stdout) return null;
    try {
      return (JSON.parse(res.stdout) as { devices?: Record<string, Array<Record<string, unknown>>> })
        .devices ?? null;
    } catch {
      return null;
    }
  };

  const iosFirst = (devices: Record<string, Array<Record<string, unknown>>>, bootedOnly: boolean) => {
    // Newest runtime first: identifiers sort lexically close enough to version order.
    const runtimes = Object.keys(devices)
      .filter((r) => /iOS/i.test(r))
      .sort()
      .reverse();
    for (const r of runtimes) {
      const list = devices[r] ?? [];
      const match = list.find(
        (d) =>
          typeof d.udid === "string" &&
          (!bootedOnly || d.state === "Booted") &&
          (d.isAvailable !== false)
      );
      if (match) return match.udid as string;
    }
    return null;
  };

  const booted = read(["simctl", "list", "devices", "booted", "-j"]);
  const bootedUdid = booted && iosFirst(booted, true);
  if (bootedUdid) return `platform=iOS Simulator,id=${bootedUdid}`;

  const available = read(["simctl", "list", "devices", "available", "-j"]);
  const anyUdid = available && iosFirst(available, false);
  if (anyUdid) return `platform=iOS Simulator,id=${anyUdid}`;

  return null;
}

/**
 * Resolve the concrete `xcodebuild test` invocation. Returns a string when we
 * cannot — every such case must read as *unchecked*, never as a failing suite,
 * so a missing simulator can't be reported as the agent lying.
 */
function resolveXcodeInvocation(
  cwd: string,
  xcode: XcodeTarget
): { args: string[]; label: string } | { unavailable: string } {
  const rel = path.basename(xcode.container);
  const listed = sh("xcodebuild", ["-list", "-json", xcode.flag, xcode.container], cwd, 90_000);
  if (listed.error || listed.status !== 0) {
    return {
      unavailable: `\`xcodebuild -list\` failed for ${rel} — Xcode command line tools may not be configured.`,
    };
  }

  let schemes: string[] = [];
  let containerName = rel.replace(/\.(xcodeproj|xcworkspace)$/, "");
  try {
    const info = JSON.parse(listed.stdout) as {
      project?: { name?: string; schemes?: string[] };
      workspace?: { name?: string; schemes?: string[] };
    };
    const node = info.workspace ?? info.project;
    schemes = node?.schemes ?? [];
    if (node?.name) containerName = node.name;
  } catch {
    return { unavailable: `could not parse \`xcodebuild -list\` output for ${rel}.` };
  }

  const scheme = pickScheme(schemes, containerName);
  if (!scheme) return { unavailable: `${rel} exposes no shared schemes to test.` };

  const destination = pickDestination(cwd);
  if (!destination) {
    return { unavailable: "no iOS simulator is available to run the suite on." };
  }

  return {
    args: [
      "test",
      xcode.flag,
      xcode.container,
      "-scheme",
      scheme,
      "-destination",
      destination,
      // Simulator runs never need a signing identity, and demanding one turns
      // an ordinary test run into an infrastructure failure.
      "CODE_SIGNING_ALLOWED=NO",
    ],
    label: `xcodebuild test -scheme ${scheme}`,
  };
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

/**
 * Swift Testing (Xcode 16+) and legacy XCTest print different summaries; a
 * project can emit either, so read both.
 */
export function parseSwiftCounts(output: string): Counts {
  const st = /Test run with (\d+) tests?(?: in \d+ suites?)? (passed|failed)(?:[^\n]*?with (\d+) issues?)?/i.exec(
    output
  );
  if (st) {
    const total = Number(st[1]);
    if (total === 0) return { noTests: true, passed: 0, failed: 0 };
    if (st[2]!.toLowerCase() === "passed") return { passed: total, failed: 0 };
    const issues = st[3] ? Number(st[3]) : 0;
    return { passed: Math.max(0, total - issues), failed: issues || 1 };
  }

  // XCTest nests suite summaries; the outermost total is printed last.
  const runs = [...output.matchAll(/Executed (\d+) tests?, with (\d+) failures?/gi)];
  if (runs.length > 0) {
    const last = runs[runs.length - 1]!;
    const total = Number(last[1]);
    const failed = Number(last[2]);
    if (total === 0) return { noTests: true, passed: 0, failed: 0 };
    return { passed: total - failed, failed };
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
  if (ecosystem === "swift") return parseSwiftCounts(output);
  return parseCounts(output);
}

/**
 * Xcode fails for many reasons that say nothing about whether the agent was
 * honest: no simulator, no signing identity, a test target that was never
 * configured to build. Those must read as *unchecked*. Only an actually-red
 * suite may read as a failure. Checked before the generic build-failure text,
 * which accompanies these as well.
 */
const XCODE_INFRA =
  /(?:Early unexpected exit|never finished bootstrapping|Unable to find a destination|does not have an Info\.plist|requires a development team|No profiles for|Simulator device failed to boot|failed to boot|Could not find test host|xcodebuild: error:|Unable to boot|DVTCoreSimulator|No such simulator|Timed out waiting|unavailable\. Failed to (?:boot|load))/i;

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
  const unchecked = (title: string, detail: string): Receipt[] =>
    claim ? [{ status: "unchecked", verifier: "tests", title, detail, claim }] : [];

  // Xcode needs a scheme and a simulator; resolving those costs two
  // subprocesses, so it happens here rather than during detection.
  let args = runner.args;
  let label = displayLabel;
  if (runner.xcode) {
    const resolved = resolveXcodeInvocation(cwd, runner.xcode);
    if ("unavailable" in resolved) {
      return unchecked(`could not run ${label}`, `${resolved.unavailable} The claim was not verified.`);
    }
    args = resolved.args;
    label = runner.dir === "." ? resolved.label : `${runner.dir}: ${resolved.label}`;
  }

  // Scrub the parent test-runner context so a spawned `node --test` (or pytest)
  // runs standalone instead of deferring to a surrounding test process.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CI: "1", FORCE_COLOR: "0" };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.PYTEST_CURRENT_TEST;

  // Must stay under the Stop hook's own budget (300s by default) so we get to
  // report a clean "timed out" instead of being killed mid-run. xcodebuild in
  // particular can hang indefinitely bootstrapping a simulator.
  const timeoutMs = 4 * 60 * 1000;
  const res = spawnSync(runner.cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: childEnv,
  });

  const output = stripAnsi(`${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  const passed = res.status === 0;

  if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return unchecked(
      `${label} timed out`,
      `The suite did not finish within ${Math.round(timeoutMs / 60000)} minutes, so the claim couldn't be verified.`
    );
  }

  // A broken simulator, an unsigned bundle or a test target that was never
  // configured to build says nothing about the agent's honesty.
  if (runner.ecosystem === "swift" && !passed && XCODE_INFRA.test(output)) {
    const reason = (XCODE_INFRA.exec(output) ?? [""])[0];
    const detailLine = output
      .split("\n")
      .find((l) => XCODE_INFRA.test(l))
      ?.trim()
      .slice(0, 300);
    return unchecked(
      `could not run ${label}`,
      `Xcode could not get the suite running (${reason}), so the claim couldn't be verified. Fix the project setup and groundtruth will start checking it.${
        detailLine ? `\n\n${detailLine}` : ""
      }`
    );
  }

  const toolMissing =
    !!res.error ||
    (runner.ecosystem === "python" && /No module named '?pytest/i.test(output)) ||
    (runner.ecosystem === "node" && !passed && RUNNER_MISSING.test(output));
  if (toolMissing) {
    return unchecked(
      `could not run ${label}`,
      runner.ecosystem === "python"
        ? "pytest is not installed here, so the claim couldn't be verified."
        : "the toolchain / dependencies aren't installed here, so the claim couldn't be verified."
    );
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
            title: `"${claim.text}" — but ${label} ran 0 tests`,
            detail: `Ran \`${label}\`: no tests actually executed (all skipped, or none found).`,
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
        title: claim ? `tests pass — confirmed (${label})` : `test suite passes (${label})`,
        detail:
          counts.passed != null
            ? `Ran \`${label}\`: ${counts.passed} passed${counts.failed ? `, ${counts.failed} failed` : ""}.`
            : `Ran \`${label}\`: exit code 0.`,
        ...(claim ? { claim } : {}),
      },
    ];
  }

  return [
    {
      status: "failed",
      verifier: "tests",
      title: claim ? `"${claim.text}" — but ${label} is RED` : `test suite is failing (${label})`,
      detail: counts.failed
        ? `Ran \`${label}\`: ${counts.failed} test(s) failed.`
        : `Ran \`${label}\`: exit code ${res.status}.`,
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
              detail: `Agent claimed "${testClaim.text}" but no runnable suite (npm/pytest/go/swift) was found at the repo root or in the changed directories.`,
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
