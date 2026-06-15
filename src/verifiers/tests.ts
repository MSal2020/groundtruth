import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Receipt, Verifier, VerifyOptions } from "../types.js";
import { stripAnsi } from "../util/color.js";

const PLACEHOLDER_TEST = /no test specified/i;

type Ecosystem = "node" | "python" | "go";

interface Runner {
  ecosystem: Ecosystem;
  cmd: string;
  args: string[];
  label: string;
}

function detectPackageManager(cwd: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

const PY_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini", "tox.ini", "conftest.py"];

function detectRunner(cwd: string, override?: string): Runner | null {
  if (override) {
    const parts = override.split(" ").filter(Boolean);
    return { ecosystem: "node", cmd: parts[0]!, args: parts.slice(1), label: override };
  }

  // Node: a real `test` script.
  const pkgPath = path.join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const testScript: unknown = pkg.scripts?.test;
      if (typeof testScript === "string" && !PLACEHOLDER_TEST.test(testScript)) {
        const pm = detectPackageManager(cwd);
        const args = pm === "npm" ? ["test", "--silent"] : ["test"];
        return { ecosystem: "node", cmd: pm, args, label: `${pm} test` };
      }
    } catch {
      /* unreadable package.json */
    }
  }

  // Python: a pytest-ish project.
  if (PY_MARKERS.some((m) => existsSync(path.join(cwd, m)))) {
    return { ecosystem: "python", cmd: "python3", args: ["-m", "pytest", "-q"], label: "pytest" };
  }

  // Go modules.
  if (existsSync(path.join(cwd, "go.mod"))) {
    return { ecosystem: "go", cmd: "go", args: ["test", "./..."], label: "go test ./..." };
  }

  return null;
}

interface Counts {
  passed?: number;
  failed?: number;
  noTests?: boolean;
}

export function parseCounts(output: string): Counts {
  // node:test TAP summary (checked first; its "# tests" line resembles others)
  const passM = /^#\s*pass\s+(\d+)/im.exec(output);
  const failM = /^#\s*fail\s+(\d+)/im.exec(output);
  if (passM || failM) return { passed: passM ? +passM[1]! : 0, failed: failM ? +failM[1]! : 0 };

  // vitest ("Tests  3 failed | 11 passed (14)") and jest ("Tests: 3 failed,
  // 11 passed, 14 total") — read the numbers out of the "Tests" summary segment.
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

export const testsVerifier: Verifier = {
  name: "tests",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    if (opts.noTests) return [];
    const claim = opts.claims.find((c) => c.type === "tests");
    const runner = detectRunner(opts.cwd, opts.testCommand);

    if (!runner) {
      if (claim) {
        return [
          {
            status: "unchecked",
            verifier: "tests",
            title: "no test runner found",
            detail: `Agent claimed "${claim.text}" but no runnable test suite (npm/pytest/go) was detected.`,
            claim,
          },
        ];
      }
      return [];
    }

    const res = spawnSync(runner.cmd, runner.args, {
      cwd: opts.cwd,
      encoding: "utf8",
      timeout: 5 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });

    const output = stripAnsi(`${res.stdout ?? ""}\n${res.stderr ?? ""}`);

    // Tool not installed — report as unchecked, never as a failing suite.
    const toolMissing =
      !!res.error ||
      (runner.ecosystem === "python" && /No module named pytest|No module named '?pytest/i.test(output));
    if (toolMissing) {
      return claim
        ? [
            {
              status: "unchecked",
              verifier: "tests",
              title: `could not run ${runner.label}`,
              detail:
                runner.ecosystem === "python"
                  ? "pytest is not installed in this environment, so the claim couldn't be verified."
                  : `Could not execute \`${runner.label}\` (${res.error?.message ?? "missing toolchain"}).`,
              claim,
            },
          ]
        : [];
    }

    const counts = parse(runner.ecosystem, output);
    const noTests = counts.noTests || (runner.ecosystem === "python" && res.status === 5);
    const passed = res.status === 0;

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
              title: `"${claim.text}" — but the suite ran 0 tests`,
              detail: `Ran \`${runner.label}\`: no tests actually executed (all skipped, or none found).`,
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
          title: claim ? "tests pass — confirmed" : "test suite passes",
          detail:
            counts.passed != null
              ? `Ran \`${runner.label}\`: ${counts.passed} passed${counts.failed ? `, ${counts.failed} failed` : ""}.`
              : `Ran \`${runner.label}\`: exit code 0.`,
          ...(claim ? { claim } : {}),
        },
      ];
    }

    return [
      {
        status: "failed",
        verifier: "tests",
        title: claim ? `"${claim.text}" — but the suite is RED` : "test suite is failing",
        detail: counts.failed
          ? `Ran \`${runner.label}\`: ${counts.failed} test(s) failed.`
          : `Ran \`${runner.label}\`: exit code ${res.status}.`,
        evidence: tail,
        ...(claim ? { claim } : {}),
      },
    ];
  },
};
