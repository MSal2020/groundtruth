import { test } from "node:test";
import assert from "node:assert/strict";
import { extractClaims } from "../src/claims/extract.js";

function types(text: string): string[] {
  return extractClaims(text).map((c) => c.type);
}

test("detects 'all tests pass'", () => {
  assert.ok(types("All tests pass now.").includes("tests"));
  assert.ok(types("The test suite is green.").includes("tests"));
  assert.ok(types("14 tests passing.").includes("tests"));
});

test("detects implementation with a symbol subject", () => {
  const claims = extractClaims("I implemented validateInput for the checkout flow.");
  const impl = claims.find((c) => c.type === "implementation");
  assert.ok(impl);
  assert.equal(impl!.subject, "validateInput");
});

test("detects a dependency reference in backticks", () => {
  const claims = extractClaims("It uses the `left-pad` package.");
  const dep = claims.find((c) => c.type === "dependency");
  assert.ok(dep);
  assert.equal(dep!.subject, "left-pad");
});

test("detects build and done claims", () => {
  assert.ok(types("It compiles with no type errors.").includes("build"));
  assert.ok(types("Ready to merge.").includes("done"));
});

test("returns nothing for prose with no claims", () => {
  assert.equal(extractClaims("Let me take a look at the code.").length, 0);
});
