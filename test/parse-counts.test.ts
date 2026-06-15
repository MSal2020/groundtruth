import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCounts } from "../src/verifiers/tests.js";

// Real summary lines emitted by each runner, so we know we read them correctly.

test("parses vitest summary", () => {
  const out = "\n Test Files  1 failed (1)\n      Tests  3 failed | 11 passed (14)\n";
  assert.deepEqual(parseCounts(out), { failed: 3, passed: 11 });
});

test("parses vitest all-green summary", () => {
  const out = "      Tests  14 passed (14)\n";
  assert.deepEqual(parseCounts(out), { failed: 0, passed: 14 });
});

test("parses vitest all-failed summary (no passed segment)", () => {
  const out = " Test Files  1 failed (1)\n      Tests  2 failed (2)\n";
  assert.deepEqual(parseCounts(out), { failed: 2, passed: 0 });
});

test("parses jest summary", () => {
  const out = "Tests:       3 failed, 11 passed, 14 total\n";
  assert.deepEqual(parseCounts(out), { failed: 3, passed: 11 });
});

test("parses jest summary with skipped", () => {
  const out = "Tests:       2 skipped, 12 passed, 14 total\n";
  assert.deepEqual(parseCounts(out), { failed: 0, passed: 12 });
});

test("parses node:test TAP summary", () => {
  const out = "# tests 14\n# pass 11\n# fail 3\n";
  assert.deepEqual(parseCounts(out), { passed: 11, failed: 3 });
});

test("returns empty when nothing matches", () => {
  assert.deepEqual(parseCounts("some unrelated output"), {});
});
