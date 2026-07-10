import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("appendCatch/readCatches round-trip via GROUNDTRUTH_HOME", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "gt-log-"));
  process.env.GROUNDTRUTH_HOME = home;
  try {
    const { appendCatch, readCatches, summarizeCatches } = await import(
      "../src/integrations/catchlog.js"
    );
    appendCatch({
      ts: "2026-06-15T12:00:00.000Z",
      cwd: "/tmp/proj",
      result: "blocked",
      failed: 2,
      warnings: 1,
      titles: ['"all tests pass" — but the suite is RED'],
    });
    appendCatch({
      ts: "2026-06-15T12:05:00.000Z",
      cwd: "/tmp/proj",
      result: "clean",
      failed: 0,
      warnings: 0,
      titles: [],
    });
    const entries = readCatches();
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.result, "blocked");
    const summary = summarizeCatches(entries);
    assert.match(summary, /2 agent stop\(s\) verified/);
    assert.match(summary, /1 blocked/);
    assert.match(summary, /suite is RED/);
  } finally {
    delete process.env.GROUNDTRUTH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
