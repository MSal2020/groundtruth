import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePytestCounts, parseGoCounts } from "../src/verifiers/tests.js";

test("parses pytest mixed summary", () => {
  assert.deepEqual(parsePytestCounts("===== 3 failed, 11 passed in 0.12s ====="), {
    failed: 3,
    passed: 11,
  });
});

test("parses pytest all-green summary", () => {
  assert.deepEqual(parsePytestCounts("===== 14 passed in 0.02s ====="), {
    failed: 0,
    passed: 14,
  });
});

test("parses pytest all-failed summary", () => {
  assert.deepEqual(parsePytestCounts("===== 2 failed in 0.01s ====="), {
    failed: 2,
    passed: 0,
  });
});

test("counts pytest errors as failures", () => {
  assert.deepEqual(parsePytestCounts("== 1 failed, 2 passed, 1 error in 0.1s =="), {
    failed: 2,
    passed: 2,
  });
});

test("detects pytest no-tests", () => {
  assert.equal(parsePytestCounts("no tests ran in 0.00s").noTests, true);
  assert.equal(parsePytestCounts("collected 0 items").noTests, true);
});

test("counts go failures from --- FAIL lines", () => {
  const out = "--- FAIL: TestA (0.00s)\n--- FAIL: TestB (0.00s)\nFAIL\nexit status 1\n";
  assert.equal(parseGoCounts(out).failed, 2);
});

test("detects go no-test-files", () => {
  assert.equal(parseGoCounts("?   example/pkg   [no test files]\n").noTests, true);
});

test("go passing output has no failures", () => {
  assert.equal(parseGoCounts("ok   example/pkg   0.123s\n").failed, undefined);
});
