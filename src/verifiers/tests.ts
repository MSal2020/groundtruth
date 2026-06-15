import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Receipt, Verifier, VerifyOptions } from "../types.js";

const PLACEHOLDER_TEST = /no test specified/i;

interface Runner {
  cmd: string;
  args: string[];
  label: string;
}

function detectPackageManager(cwd: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectRunner(cwd: string, override?: string): Runner | null {
  if (override) {
    const parts = override.split(" ").filter(Boolean);
    return { cmd: parts[0]!, args: parts.slice(1), label: override };
  }
  const pkgPath = path.join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const testScript: unknown = pkg.scripts?.test;
      if (typeof testScript === "string" && !PLACEHOLDER_TEST.test(testScript)) {
        const pm = detectPackageManager(cwd);
        const args = pm === "npm" ? ["test", "--silent"] : ["test"];
        return { cmd: pm, args, label: `${pm} test` };
      }
    } catch {
      /* unreadable package.json */
    }
  }
  return null;
}

export function parseCounts(output: string): { passed?: number; failed?: number } {
  // node:test TAP summary (checked first; its "# tests" line resembles others)
  const passM = /^#\s*pass\s+(\d+)/im.exec(output);
  const failM = /^#\s*fail\s+(\d+)/im.exec(output);
  if (passM || failM) return { passed: passM ? +passM[1]! : 0, failed: failM ? +failM[1]! : 0 };

  // vitest ("Tests  3 failed | 11 passed (14)") and jest ("Tests: 3 failed,
  // 11 passed, 14 total") — handle all-pass / all-fail / mixed by reading the
  // numbers out of the single "Tests" summary segment.
  const seg = /\bTests:?\s+([^\n]*)/i.exec(output);
  if (seg) {
    const f = /(\d+)\s+failed/i.exec(seg[1]!);
    const p = /(\d+)\s+passed/i.exec(seg[1]!);
    if (f || p) return { failed: f ? +f[1]! : 0, passed: p ? +p[1]! : 0 };
  }
  return {};
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
            detail: `Agent claimed "${claim.text}" but no runnable test script was detected.`,
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

    // Strip ANSI so counts parse and evidence is readable even when a runner
    // forces color (vitest/jest sometimes ignore FORCE_COLOR=0).
    const raw = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const output = raw.replace(/\[[0-9;]*[a-zA-Z]/g, "");
    const counts = parseCounts(output);
    const passed = res.status === 0;

    if (res.error) {
      return [
        {
          status: "unchecked",
          verifier: "tests",
          title: "could not run tests",
          detail: `Failed to execute \`${runner.label}\`: ${res.error.message}`,
          ...(claim ? { claim } : {}),
        },
      ];
    }

    const allLines = output.split("\n").filter(Boolean);
    const signal = allLines.filter((l) =>
      /\b(not ok|fail|failed|✗|✖|×|assert|expected|received|# fail|FAIL )\b/i.test(l)
    );
    const tail = (signal.length ? signal : allLines).slice(0, 10).join("\n");

    if (passed) {
      // A green suite that ran zero tests is a classic way to fake "tests pass"
      // (e.g. skipping the only test).
      if (claim && counts.passed === 0) {
        return [
          {
            status: "warning",
            verifier: "tests",
            title: `"${claim.text}" — but the suite ran 0 tests`,
            detail: `Ran \`${runner.label}\`: exit code 0, but no tests actually executed (all skipped or none found).`,
            evidence: tail,
            claim,
          },
        ];
      }
      return [
        {
          status: "verified",
          verifier: "tests",
          title: claim ? "tests pass — confirmed" : "test suite passes",
          detail: counts.passed != null
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
