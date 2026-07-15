#!/usr/bin/env bash
#
# Self-contained demo: spin up a throwaway git repo, commit a clean baseline,
# then apply the kind of change a coding agent leaves behind when it overclaims
# ("✅ Done, all tests pass") — and let groundtruth call the bluff.
#
# Usage:  bash examples/demo/run.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/dist/cli.js"
if [ ! -f "$CLI" ]; then
  echo "Build first:  (cd $ROOT && npm run build)" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

git init -q
git config user.email demo@example.com
git config user.name "demo"

# ---- baseline: honest, working code + a passing test --------------------------
cat > package.json <<'JSON'
{
  "name": "checkout-service",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": { "test": "node --test" }
}
JSON

mkdir -p src test

cat > src/validate.js <<'JS'
function validateInput(order) {
  if (!order || typeof order !== "object") throw new Error("order required");
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error("order.items must be a non-empty array");
  }
  return true;
}
module.exports = { validateInput };
JS

cat > test/validate.test.js <<'JS'
const test = require("node:test");
const assert = require("node:assert");
const { validateInput } = require("../src/validate");

test("accepts a valid order", () => {
  assert.strictEqual(validateInput({ items: [{ sku: "A" }] }), true);
});

test("rejects an empty order", () => {
  assert.throws(() => validateInput({ items: [] }));
});
JS

git add -A
git commit -qm "baseline: working validation + passing tests"

# ---- the agent's change: looks done, isn't -----------------------------------
# 1) "implemented validateInput" -> actually a stub that throws TODO
cat > src/validate.js <<'JS'
const parse = require("fast-csv-parser-pro"); // hallucinated package

function validateInput(order) {
  // TODO: implement real validation
  throw new Error("not implemented yet");
}
module.exports = { validateInput };
JS

# 2) "added tests / all tests pass" -> skipped the real test, suite now red
cat > test/validate.test.js <<'JS'
const test = require("node:test");
const assert = require("node:assert");
const { validateInput } = require("../src/validate");

test("accepts a valid order", () => {
  assert.strictEqual(validateInput({ items: [{ sku: "A" }] }), true);
});

test.skip("rejects an empty order", () => {
  assert.throws(() => validateInput({ items: [] }));
});
JS

# 3) "uses fast-csv-parser-pro" -> add the fake dep to package.json too
cat > package.json <<'JSON'
{
  "name": "checkout-service",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": { "test": "node --test" },
  "dependencies": { "fast-csv-parser-pro": "^3.0.0" }
}
JSON

# ---- what the agent told the user --------------------------------------------
CLAIM="✅ Done. I implemented validateInput with full input validation, added tests, and all tests pass. It uses the \`fast-csv-parser-pro\` package for parsing. Ready to merge."

echo
echo "The agent said:"
echo "  \"$CLAIM\""
echo

node "$CLI" --claim "$CLAIM"
rc=$?
echo
echo "(groundtruth exit code: $rc — non-zero means overclaims were found)"
