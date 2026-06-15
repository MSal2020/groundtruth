import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli.js");

// Regression: the CLI must not deadlock when stdin is an open, empty pipe that
// never sends EOF (CI runners, hooks, subprocess invocations).
test(
  "CLI exits promptly with an open, empty stdin (no hang)",
  { skip: existsSync(CLI) ? false : "run `npm run build` first" },
  async () => {
    const child = spawn(
      process.execPath,
      [CLI, "--no-tests", "--offline", "--quiet"],
      { cwd: ROOT, stdio: ["pipe", "ignore", "ignore"] }
    );
    // Intentionally never write to or end child.stdin -> held-open empty pipe.
    const exitedCleanly = await new Promise<boolean>((resolve) => {
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(false);
      }, 5000);
      child.on("exit", () => {
        clearTimeout(killer);
        resolve(true);
      });
      child.on("error", () => {
        clearTimeout(killer);
        resolve(false);
      });
    });
    assert.ok(exitedCleanly, "CLI hung instead of exiting with empty stdin");
  }
);
