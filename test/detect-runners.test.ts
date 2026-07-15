import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileDiff } from "../src/types.js";
import { detectRunners } from "../src/verifiers/tests.js";

function diffFile(p: string): FileDiff {
  return { path: p, isNew: true, added: [{ line: 1, text: "x" }], removed: [] };
}

function tmpRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt-detect-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

const NPM_TEST = JSON.stringify({ name: "x", scripts: { test: "node --test" } });

test("finds a runner in the sub-project that owns the changed file (monorepo)", () => {
  const repo = tmpRepo({ "backend/package.json": NPM_TEST });
  try {
    const runners = detectRunners(repo, [diffFile("backend/src/pay.js")]);
    assert.equal(runners.length, 1);
    assert.equal(runners[0]!.dir, "backend");
    assert.equal(runners[0]!.ecosystem, "node");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("does not run a sub-project the diff didn't touch", () => {
  const repo = tmpRepo({
    "backend/package.json": NPM_TEST,
    "frontend/package.json": NPM_TEST,
  });
  try {
    const runners = detectRunners(repo, [diffFile("backend/src/x.js")]);
    assert.deepEqual(runners.map((r) => r.dir), ["backend"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("detects multiple sub-projects when several are changed", () => {
  const repo = tmpRepo({
    "backend/package.json": NPM_TEST,
    "workers/pyproject.toml": "[project]\nname='w'\n",
  });
  try {
    const runners = detectRunners(repo, [diffFile("backend/a.js"), diffFile("workers/b.py")]);
    assert.deepEqual(runners.map((r) => r.dir).sort(), ["backend", "workers"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("falls back to the repo root when it holds the runner", () => {
  const repo = tmpRepo({ "package.json": NPM_TEST });
  try {
    const runners = detectRunners(repo, [diffFile("src/x.js")]);
    assert.equal(runners[0]!.dir, ".");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("returns nothing when no project has a runner", () => {
  const repo = tmpRepo({ "ios/App.swift": "// swift", "README.md": "# hi" });
  try {
    assert.equal(detectRunners(repo, [diffFile("ios/App.swift")]).length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("override wins and runs at root", () => {
  const repo = tmpRepo({ "package.json": NPM_TEST });
  try {
    const runners = detectRunners(repo, [diffFile("src/x.js")], "make test");
    assert.equal(runners[0]!.label, "make test");
    assert.equal(runners[0]!.cmd, "make");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
