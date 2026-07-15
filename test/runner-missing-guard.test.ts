import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli.js");

function scenario(files: Record<string, string>, claim: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt-guard-"));
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
    git(["commit", "-qm", "base"]);
    writeFileSync(path.join(dir, "src/x.js"), files["src/x.js"]! + "\n// touch\n");
    const res = spawnSync("node", [CLI, "--claim", claim, "--offline", "--json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
    return JSON.parse(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NPM = `{ "name": "x", "version": "1.0.0", "type": "commonjs", "scripts": { "test": "node --test" } }\n`;

test(
  "a hallucinated application import reads as a RED suite (not masked as unchecked)",
  { skip: existsSync(CLI) ? false : "build first" },
  () => {
    const verdict = scenario(
      {
        "package.json": NPM,
        "src/x.js": `const ghost = require("totally-made-up-lib-xyz999");\nmodule.exports = { x: 1 };\n`,
        "test/x.test.js": `const t = require("node:test");\nconst { x } = require("../src/x");\nt("loads", () => { if (x !== 1) throw new Error("no"); });\n`,
      },
      "all tests pass"
    );
    const testFail = verdict.receipts.find(
      (r: any) => r.verifier === "tests" && r.status === "failed"
    );
    assert.ok(testFail, "expected the missing-module crash to be a failed test suite");
  }
);
