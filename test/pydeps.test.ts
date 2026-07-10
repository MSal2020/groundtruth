import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileDiff } from "../src/types.js";
import { pydepsVerifier } from "../src/verifiers/pydeps.js";

const CWD = "/nonexistent-groundtruth-pydeps-test";

function diffOf(path: string, lines: string[]): FileDiff {
  return { path, isNew: true, added: lines.map((text, i) => ({ line: i + 1, text })), removed: [] };
}

test("pydeps stays silent on stdlib, relative, and alias imports", async () => {
  const diff = [
    diffOf("app/x.py", [
      "import os",
      "import json, sys",
      "from . import helper",
      "from .models import Thing",
      "import yaml",
      "import cv2",
    ]),
  ];
  const receipts = await pydepsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts.length, 0);
});

test("pydeps flags an added requirements dep (offline -> unchecked)", async () => {
  const diff = [diffOf("requirements.txt", ["ghost-pkg-zzz==1.0.0"])];
  const receipts = await pydepsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts[0]!.status, "unchecked");
});

test("pydeps ignores comments and options in requirements", async () => {
  const diff = [
    diffOf("requirements.txt", ["# a comment", "-r base.txt", "--index-url https://x", "  "]),
  ];
  const receipts = await pydepsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts.length, 0);
});

test("pydeps collects a non-stdlib third-party import", async () => {
  const diff = [diffOf("app/x.py", ["import superrarepkg_xyz"])];
  const receipts = await pydepsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts[0]!.status, "unchecked"); // would be a warning online
});

test("pyprojectDeclaredDeps reads dependency arrays but not keywords/classifiers", async () => {
  const { pyprojectDeclaredDeps } = await import("../src/verifiers/pydeps.js");
  const toml = `[project]
name = "demo"
keywords = ["ai", "agents", "totally-not-a-dep"]
classifiers = ["Programming Language :: Python"]
dependencies = [
  "requests>=2.31",
  'flask',
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[tool.other]
things = ["not-a-dep-either"]
`;
  const deps = pyprojectDeclaredDeps(toml);
  assert.deepEqual([...deps].sort(), ["flask", "pytest", "requests", "ruff"]);
});
