import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileDiff } from "../src/types.js";
import { godepsVerifier, moduleFromGoImport } from "../src/verifiers/godeps.js";
import { encodeGoModule } from "../src/util/registry.js";

const CWD = "/nonexistent-groundtruth-godeps-test";

function diffOf(path: string, lines: string[]): FileDiff {
  return { path, isNew: true, added: lines.map((text, i) => ({ line: i + 1, text })), removed: [] };
}

test("moduleFromGoImport: stdlib and unknown hosts are skipped", () => {
  assert.equal(moduleFromGoImport("fmt"), null);
  assert.equal(moduleFromGoImport("net/http"), null);
  assert.equal(moduleFromGoImport("encoding/json"), null);
  assert.equal(moduleFromGoImport("example.internal/x/y"), null); // vanity host
});

test("moduleFromGoImport: three-segment hosts resolve to the module", () => {
  assert.equal(moduleFromGoImport("github.com/user/repo/pkg/sub"), "github.com/user/repo");
  assert.equal(moduleFromGoImport("golang.org/x/tools/imports"), "golang.org/x/tools");
});

test("encodeGoModule case-encodes per the proxy protocol", () => {
  assert.equal(encodeGoModule("github.com/Azure/azure-sdk"), "github.com/!azure/azure-sdk");
});

test("godeps collects a go.mod require (offline -> unchecked)", async () => {
  const diff = [diffOf("go.mod", ["require github.com/ghost/nonexistent-zzz v1.0.0"])];
  const receipts = await godepsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts[0]!.status, "unchecked");
});

test("godeps ignores module/replace/go directives and stdlib imports", async () => {
  const diff = [
    diffOf("go.mod", [
      "module github.com/me/myapp",
      "go 1.22",
      "replace github.com/x/y => ../local",
    ]),
    diffOf("main.go", [`import "fmt"`, `\t"net/http"`]),
  ];
  const receipts = await godepsVerifier.run({ cwd: CWD, claims: [], diff, offline: true });
  assert.equal(receipts.length, 0);
});
