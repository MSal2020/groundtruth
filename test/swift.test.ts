import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileDiff } from "../src/types.js";
import { detectRunners, parseSwiftCounts, pickScheme } from "../src/verifiers/tests.js";

function diffFile(p: string): FileDiff {
  return { path: p, isNew: true, added: [{ line: 1, text: "x" }], removed: [] };
}

function tmpRepo(files: Record<string, string>, dirs: string[] = []): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gt-swift-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const d of dirs) mkdirSync(path.join(dir, d), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Summary parsing. Every string below is verbatim output from a real run.
// ---------------------------------------------------------------------------

test("parses a passing Swift Testing run (xcodebuild)", () => {
  const out = "✔ Test run with 507 tests in 63 suites passed after 3.565 seconds.\n";
  assert.deepEqual(parseSwiftCounts(out), { passed: 507, failed: 0 });
});

test("parses a failing Swift Testing run (swift test)", () => {
  const out =
    "Test addIsBroken() failed after 0.001 seconds with 1 issue.\n" +
    "Test run with 2 tests in 0 suites failed after 0.001 seconds with 1 issue.\n";
  assert.deepEqual(parseSwiftCounts(out), { passed: 1, failed: 1 });
});

test("parses a passing SwiftPM run without suites", () => {
  const out = "Test run with 2 tests in 0 suites passed after 0.001 seconds.\n";
  assert.deepEqual(parseSwiftCounts(out), { passed: 2, failed: 0 });
});

test("parses legacy XCTest output", () => {
  const out = "Executed 42 tests, with 3 failures (0 unexpected) in 1.234 seconds\n";
  assert.deepEqual(parseSwiftCounts(out), { passed: 39, failed: 3 });
});

test("XCTest nests suite summaries — the outermost total wins", () => {
  const out =
    "Executed 5 tests, with 0 failures (0 unexpected) in 0.1 seconds\n" +
    "Executed 42 tests, with 3 failures (0 unexpected) in 1.2 seconds\n";
  assert.deepEqual(parseSwiftCounts(out), { passed: 39, failed: 3 });
});

test("a suite that ran nothing is reported as noTests, not as a pass", () => {
  assert.deepEqual(parseSwiftCounts("Executed 0 tests, with 0 failures (0 unexpected)\n"), {
    noTests: true,
    passed: 0,
    failed: 0,
  });
});

test("unrecognised output yields no counts rather than a false green", () => {
  assert.deepEqual(parseSwiftCounts("Build succeeded\n"), {});
});

// ---------------------------------------------------------------------------
// Scheme selection
// ---------------------------------------------------------------------------

test("prefers the scheme named after the project over SwiftPM dependency schemes", () => {
  // Verbatim scheme list from a real iOS app with an SPM dependency.
  const schemes = [
    "argmax-oss-swift-Package",
    "Ember",
    "EmberShare",
    "EmberWatch",
    "EmberWatch (Notification)",
    "EmberWidgets",
  ];
  assert.equal(pickScheme(schemes, "Ember"), "Ember");
});

test("falls back past -Package and extension schemes when no name matches", () => {
  const schemes = ["vendor-oss-Package", "App (Notification)", "App"];
  assert.equal(pickScheme(schemes, "Unrelated"), "App");
});

test("returns null when a project exposes no schemes", () => {
  assert.equal(pickScheme([], "Whatever"), null);
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

test("detects a SwiftPM package", () => {
  const repo = tmpRepo({ "Package.swift": "// swift-tools-version: 6.0" });
  try {
    const runners = detectRunners(repo, [diffFile("Sources/Demo/Demo.swift")]);
    assert.equal(runners.length, 1);
    assert.equal(runners[0]!.ecosystem, "swift");
    assert.equal(runners[0]!.label, "swift test");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("detects an Xcode project — the case that silently passed for weeks", () => {
  const repo = tmpRepo({}, ["Ember.xcodeproj"]);
  try {
    const runners = detectRunners(repo, [diffFile("Ember/Recipe.swift")]);
    assert.equal(runners.length, 1);
    assert.equal(runners[0]!.ecosystem, "swift");
    assert.equal(runners[0]!.xcode?.flag, "-project");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("prefers a workspace over a bare project", () => {
  const repo = tmpRepo({}, ["App.xcodeproj", "App.xcworkspace"]);
  try {
    const runners = detectRunners(repo, [diffFile("App/Main.swift")]);
    assert.equal(runners[0]!.xcode?.flag, "-workspace");
    assert.match(runners[0]!.xcode!.container, /App\.xcworkspace$/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a package.json still wins over a sibling xcodeproj (React Native)", () => {
  const repo = tmpRepo(
    { "package.json": JSON.stringify({ scripts: { test: "jest" } }) },
    ["ios/App.xcodeproj"]
  );
  try {
    assert.equal(detectRunners(repo, [diffFile("src/App.tsx")])[0]!.ecosystem, "node");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// "added tests" recognition. A language missing from TEST_CASE_RE turns honest
// work into a false accusation — the most damaging failure mode there is.
// ---------------------------------------------------------------------------

test("recognises Swift Testing and XCTest cases as added tests", async () => {
  const { claimsVerifier } = await import("../src/verifiers/claims.js");
  const swiftTests = [
    "@Test func multiplyWorks() { #expect(multiply(3, 4) == 12) }",
    "func testMultiplyWorks() { XCTAssertEqual(multiply(3, 4), 12) }",
  ];

  for (const line of swiftTests) {
    const receipts = await claimsVerifier.run({
      cwd: process.cwd(),
      claims: [{ type: "tests", text: "Added a test for multiply" }],
      diff: [
        {
          path: "Tests/DemoTests/MultiplyTests.swift",
          isNew: true,
          added: [{ line: 1, text: line }],
          removed: [],
        },
      ],
    });
    assert.deepEqual(
      receipts.filter((r) => r.status === "failed"),
      [],
      `should not accuse the agent over: ${line}`
    );
  }
});

test("still catches a tests claim with no test case anywhere in the diff", async () => {
  const { claimsVerifier } = await import("../src/verifiers/claims.js");
  const receipts = await claimsVerifier.run({
    cwd: process.cwd(),
    claims: [{ type: "tests", text: "Added tests for multiply" }],
    diff: [
      {
        path: "Sources/Demo/Demo.swift",
        isNew: false,
        added: [{ line: 1, text: "public func multiply(_ a: Int, _ b: Int) -> Int { a * b }" }],
        removed: [],
      },
    ],
  });
  assert.equal(receipts.filter((r) => r.status === "failed").length, 1);
});

test("recognises Swift test file layouts, and leaves production Swift alone", async () => {
  const { isTestFile } = await import("../src/verifiers/shared.js");
  // Real paths from an iOS app and a SwiftPM package.
  for (const p of [
    "EmberTests/ShelfReadTests.swift",
    "Tests/DemoTests/MultiplyTests.swift",
    "EmberTests/AisleTests.swift",
    "MyLibTests/ParserSpec.swift",
  ]) {
    assert.equal(isTestFile(p), true, `${p} should count as a test file`);
  }
  for (const p of ["Ember/Recipe.swift", "Sources/Demo/Demo.swift", "src/calc.js"]) {
    assert.equal(isTestFile(p), false, `${p} must not count as a test file`);
  }
});
