# Sourced by the VHS tape to stage a deterministic demo.
# Usage (from the repo root):  source examples/demo/gif-prepare.sh
#
# Creates a throwaway repo whose working tree contains the change a coding agent
# leaves behind when it overclaims, and defines two shell helpers:
#   agent   -> prints the agent's confident "Done" message
#   gt      -> runs groundtruth against that claim

GT_CLI="$PWD/dist/cli.js"
GT_WORK="$(mktemp -d)"

(
  cd "$GT_WORK" || exit
  git init -q
  git config user.email demo@example.com
  git config user.name demo

  cat > package.json <<'JSON'
{ "name": "checkout-service", "version": "1.0.0", "type": "commonjs",
  "scripts": { "test": "node --test" } }
JSON
  mkdir -p src test
  cat > src/validate.js <<'JS'
function validateInput(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
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
JS
  git add -A && git commit -qm baseline

  # ---- the agent's "finished" change ----
  cat > src/validate.js <<'JS'
const parse = require("fast-csv-parser-pro"); // hallucinated package
function validateInput(order) {
  // TODO: implement real validation
  throw new Error("not implemented yet");
}
module.exports = { validateInput };
JS
  cat > test/validate.test.js <<'JS'
const test = require("node:test");
const assert = require("node:assert");
const { validateInput } = require("../src/validate");
test.skip("accepts a valid order", () => {
  assert.strictEqual(validateInput({ items: [{ sku: "A" }] }), true);
});
JS
  cat > package.json <<'JSON'
{ "name": "checkout-service", "version": "1.0.0", "type": "commonjs",
  "scripts": { "test": "node --test" },
  "dependencies": { "fast-csv-parser-pro": "^3.0.0" } }
JSON
)

cd "$GT_WORK" || return

printf '%s' 'Done. I implemented validateInput with full input validation, added tests, and all tests pass. It uses the `fast-csv-parser-pro` package. Ready to merge.' > .agent-summary

agent() {
  printf '\n\033[32m●\033[0m \033[1mClaude\033[0m\n'
  printf '\033[2m  I implemented \033[0mvalidateInput\033[2m with full input validation,\033[0m\n'
  printf '\033[2m  added tests, and all 14 tests pass. It uses the\033[0m\n'
  printf '\033[2m  \033[0mfast-csv-parser-pro\033[2m package.\033[0m \033[32m✅ Ready to merge.\033[0m\n\n'
}

gt() { node "$GT_CLI" --claim "$(cat .agent-summary)"; }
