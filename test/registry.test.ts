import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBuiltin,
  packageNameFromSpecifier,
} from "../src/util/registry.js";

test("normalises import specifiers to package names", () => {
  assert.equal(packageNameFromSpecifier("lodash"), "lodash");
  assert.equal(packageNameFromSpecifier("lodash/fp"), "lodash");
  assert.equal(packageNameFromSpecifier("@scope/pkg"), "@scope/pkg");
  assert.equal(packageNameFromSpecifier("@scope/pkg/sub"), "@scope/pkg");
  assert.equal(packageNameFromSpecifier("./relative"), null);
  assert.equal(packageNameFromSpecifier("../up"), null);
  assert.equal(packageNameFromSpecifier("node:fs"), null);
});

test("recognises node builtins", () => {
  assert.equal(isBuiltin("node:fs"), true);
  assert.equal(isBuiltin("fs"), true);
  assert.equal(isBuiltin("path"), true);
  assert.equal(isBuiltin("left-pad"), false);
});
