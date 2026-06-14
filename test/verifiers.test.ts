import { test } from "node:test";
import assert from "node:assert/strict";
import type { Claim, FileDiff } from "../src/types.js";
import { harnessVerifier } from "../src/verifiers/harness.js";
import { stubsVerifier } from "../src/verifiers/stubs.js";
import { claimsVerifier } from "../src/verifiers/claims.js";
import { depsVerifier } from "../src/verifiers/deps.js";

const CWD = "/nonexistent-groundtruth-test"; // forces added-lines fallback

function diffOf(path: string, lines: string[], isNew = true): FileDiff {
  return {
    path,
    isNew,
    added: lines.map((text, i) => ({ line: i + 1, text })),
    removed: [],
  };
}

test("harness: a skip with a 'tests pass' claim is a failure", async () => {
  const diff = [diffOf("src/a.test.ts", [`it.skip("x", () => {})`])];
  const claims: Claim[] = [{ type: "tests", text: "all tests pass" }];
  const receipts = await harnessVerifier.run({ cwd: CWD, claims, diff });
  assert.equal(receipts[0]!.status, "failed");
  assert.match(receipts[0]!.title, /skipped test/);
});

test("harness: an aliased skip (t.skip) without a claim is only a warning", async () => {
  const diff = [diffOf("test/c.test.js", [`t.skip("works", () => {})`])];
  const receipts = await harnessVerifier.run({ cwd: CWD, claims: [], diff });
  assert.equal(receipts[0]!.status, "warning");
  assert.match(receipts[0]!.title, /skipped test/);
});

test("harness: exit(0) inside a test is always a failure", async () => {
  const diff = [diffOf("test/b_test.py", ["    sys.exit(0)"])];
  const receipts = await harnessVerifier.run({ cwd: CWD, claims: [], diff });
  assert.equal(receipts[0]!.status, "failed");
});

test("harness: assert.ok(true) is a tautological failure", async () => {
  const diff = [diffOf("test/d.test.js", ["assert.ok(true);"])];
  const receipts = await harnessVerifier.run({ cwd: CWD, claims: [], diff });
  assert.equal(receipts[0]!.status, "failed");
  assert.match(receipts[0]!.title, /tautolog/);
});

test("stubs verifier escalates a stub on a claimed symbol to a failure", async () => {
  const claims: Claim[] = [
    { type: "implementation", text: "implemented parseOrder", subject: "parseOrder" },
  ];
  const diff = [
    diffOf("src/order.ts", [
      "function parseOrder() {",
      '  throw new Error("not implemented");',
      "}",
    ]),
  ];
  const receipts = await stubsVerifier.run({ cwd: CWD, claims, diff });
  const failed = receipts.find((r) => r.status === "failed");
  assert.ok(failed, "expected a hard failure for the stubbed claim");
  assert.match(failed!.title, /stub/);
});

test("stubs: a plain TODO with no completion claim is suppressed", async () => {
  const diff = [diffOf("src/x.ts", ["// TODO: handle the edge case"])];
  const receipts = await stubsVerifier.run({ cwd: CWD, claims: [], diff });
  assert.equal(receipts.length, 0);
});

test("stubs: a TODO surfaces as a warning once the agent claims it's done", async () => {
  const diff = [diffOf("src/x.ts", ["// TODO: handle the edge case"])];
  const claims: Claim[] = [{ type: "done", text: "all done, ready to merge" }];
  const receipts = await stubsVerifier.run({ cwd: CWD, claims, diff });
  assert.equal(receipts[0]!.status, "warning");
});

test("claims verifier busts 'added tests' when no test case is present", async () => {
  const claims: Claim[] = [
    { type: "tests", text: "added tests for the parser" },
  ];
  const diff = [diffOf("src/parser.ts", ["export const parse = () => 1;"])];
  const receipts = await claimsVerifier.run({ cwd: CWD, claims, diff });
  const failed = receipts.find((r) => r.status === "failed");
  assert.ok(failed);
  assert.match(failed!.title, /add tests/);
});

test("deps verifier stays silent without dependency references", async () => {
  const diff = [diffOf("src/x.ts", ["const a = 1;"])];
  const receipts = await depsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts.length, 0);
});

test("deps verifier reports offline skip when references exist", async () => {
  const diff = [diffOf("src/x.ts", [`import nope from "totally-made-up-pkg-xyz";`])];
  const receipts = await depsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts[0]!.status, "unchecked");
});

test("deps verifier ignores path aliases and subpath imports", async () => {
  const diff = [
    diffOf("src/x.ts", [
      `import a from "@/components/a";`,
      `import b from "~/lib/b";`,
      `import c from "#util/c";`,
      `import d from "./local";`,
      `import e from "node:fs";`,
    ]),
  ];
  const receipts = await depsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts.length, 0);
});
