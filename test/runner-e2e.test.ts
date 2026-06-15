import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli.js");

function toolOk(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

const HAVE_CLI = existsSync(CLI);
const HAVE_PYTEST = HAVE_CLI && toolOk("python3", ["-m", "pytest", "--version"]);
const HAVE_GO = HAVE_CLI && toolOk("go", ["version"]);

function runScenario(files: Record<string, string>, claim: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt-e2e-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    const git = (a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    git(["init", "-q"]);
    git(["config", "user.email", "e@e.co"]);
    git(["config", "user.name", "e"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "x"]);
    // overwrite a file to create a working-tree change the verifier inspects
    const firstSrc = Object.keys(files).find((f) => f.endsWith(".py") || f.endsWith(".go"));
    if (firstSrc) writeFileSync(path.join(dir, firstSrc), files[firstSrc]! + "\n// touched\n");

    const res = spawnSync("node", [CLI, "--claim", claim, "--json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    return JSON.parse(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(
  "pytest E2E: busts a false 'all tests pass'",
  { skip: HAVE_PYTEST ? false : "pytest not available" },
  () => {
    const verdict = runScenario(
      {
        "pyproject.toml": `[project]\nname = "x"\nversion = "0.0.0"\n`,
        "src/m.py": `def add(a, b):\n    return a + b\n`,
        "tests/test_m.py": `def test_add():\n    assert 1 == 2\n`,
      },
      "all tests pass"
    );
    assert.ok(verdict.failed >= 1, "expected the failing pytest suite to be flagged");
  }
);

test(
  "go E2E: busts a false 'all tests pass'",
  { skip: HAVE_GO ? false : "go not available" },
  () => {
    const verdict = runScenario(
      {
        "go.mod": `module example\n\ngo 1.21\n`,
        "calc.go": `package main\n\nfunc Add(a, b int) int { return a + b }\n`,
        "calc_test.go": `package main\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) { t.Fatal("nope") }\n`,
      },
      "all tests pass"
    );
    assert.ok(verdict.failed >= 1, "expected the failing go suite to be flagged");
  }
);
