import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDiff, sessionBase } from "../src/git.js";

function git(cwd: string, args: string[], dateIso?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      ...(dateIso ? { GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso } : {}),
    },
  });
}

/**
 * A repo whose history predates the session. The old commit is genuinely
 * backdated — if it fell inside the session window the session's oldest commit
 * would be the root, which is a different case (covered below).
 */
function repoWithHistory(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt-base-"));
  git(dir, ["init", "-q"]);
  writeFileSync(path.join(dir, "old.txt"), "old\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "before the session"], "2020-01-01T00:00:00Z");
  return dir;
}

test("recovers work the agent committed, which git diff HEAD cannot see", () => {
  const dir = repoWithHistory();
  try {
    const sessionStart = new Date(Date.now() - 60_000).toISOString();

    writeFileSync(path.join(dir, "feature.ts"), "export const shipped = true;\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "agent commits its work"]);

    // The failure this fixes: a clean tree reads as "nothing to check".
    assert.equal(getDiff(dir).length, 0, "working tree should be clean after committing");

    const base = sessionBase(dir, sessionStart);
    assert.ok(base, "expected a base covering the session's commits");

    const recovered = getDiff(dir, { base: base! });
    assert.deepEqual(
      recovered.map((f) => f.path),
      ["feature.ts"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("spans every commit the session made, not just the last one", () => {
  const dir = repoWithHistory();
  try {
    const sessionStart = new Date(Date.now() - 60_000).toISOString();

    for (const name of ["a.ts", "b.ts", "c.ts"]) {
      writeFileSync(path.join(dir, name), `export const ${name[0]} = 1;\n`);
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-qm", `add ${name}`]);
    }

    const base = sessionBase(dir, sessionStart);
    const recovered = getDiff(dir, { base: base! }).map((f) => f.path);
    assert.deepEqual(recovered.sort(), ["a.ts", "b.ts", "c.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not reach back past the session into older commits", () => {
  const dir = repoWithHistory();
  try {
    // Session starts now; the pre-existing commit must stay out of scope.
    const sessionStart = new Date(Date.now() + 1_000).toISOString();
    const base = sessionBase(dir, sessionStart);
    assert.equal(base, null, "a session that committed nothing has no base");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null instead of throwing when the session commit is the root", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt-root-"));
  try {
    git(dir, ["init", "-q"]);
    writeFileSync(path.join(dir, "only.txt"), "x\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "root commit"]);
    // No parent to diff against — must degrade quietly, not crash the hook.
    assert.equal(sessionBase(dir, new Date(Date.now() - 60_000).toISOString()), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
